import { createReadStream, createWriteStream, promises as fs } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { dirname, join, relative } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type {
  InstanceSummary,
  WorldBackupKind,
  WorldBackupView,
  WorldSummary
} from '../../shared/types'
import { CancellationError } from './net'
import { readLevelDat } from './nbt'
import { emptyDetail, type TaskProgress } from './progress'
import { pathExists, safeJoin, writeFileAtomic } from './version'

const SAFE_WORLD_FOLDER = /^[^\\/:*?"<>|]{1,120}$/
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
const MAX_FILES = 200_000
const MAX_ICON_BYTES = 128 * 1024
const BACKUP_LABELS: Record<WorldBackupKind, string> = {
  manual: '手动备份',
  loader: '加载器更新前',
  restore: '恢复前'
}

export interface WorldVaultContext {
  instance: InstanceSummary
  instanceDir: string
  gameDir: string
  limit: number
  /** 0 表示不按天数清理。 */
  maxAgeDays: number
}

const DAY_MS = 24 * 60 * 60 * 1000

interface WorldFile {
  rel: string
  abs: string
  size: number
}

interface BackupPlan {
  folder: string
  name: string
  files: WorldFile[]
  bytes: number
}

interface BackupManifest {
  version: 1
  id: string
  worldFolder: string
  worldName: string
  gameVersion: string | null
  instanceName: string
  createdAt: number
  kind: WorldBackupKind
  bytes: number
  files: number
}

function isSafeWorldFolder(name: string): boolean {
  const trimmed = name.trim()
  return (
    trimmed === name &&
    SAFE_WORLD_FOLDER.test(name) &&
    name !== '.' &&
    name !== '..' &&
    !name.endsWith('.') &&
    !name.endsWith(' ') &&
    !WINDOWS_RESERVED.test(name)
  )
}

function savesDir(context: WorldVaultContext): string {
  return join(context.gameDir, 'saves')
}

function backupsRoot(context: WorldVaultContext): string {
  return join(context.instanceDir, 'backups', 'worlds')
}

function worldBackupsRoot(context: WorldVaultContext, folder: string): string {
  if (!isSafeWorldFolder(folder)) throw new Error('无效的存档文件夹名')
  return safeJoin(backupsRoot(context), folder)
}

function assertSafeFolder(folder: string): string {
  if (!isSafeWorldFolder(folder)) throw new Error('无效的存档文件夹名')
  return folder
}

function backupLabel(kind: WorldBackupKind): string {
  return BACKUP_LABELS[kind] ?? '备份'
}

function parseManifest(
  raw: unknown,
  expectedFolder: string,
  expectedId: string
): WorldBackupView | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Partial<BackupManifest>
  if (
    value.version !== 1 ||
    value.id !== expectedId ||
    value.worldFolder !== expectedFolder ||
    typeof value.worldName !== 'string' ||
    !value.worldName.trim() ||
    typeof value.createdAt !== 'number' ||
    !Number.isFinite(value.createdAt) ||
    value.createdAt <= 0 ||
    typeof value.bytes !== 'number' ||
    !Number.isFinite(value.bytes) ||
    value.bytes < 0 ||
    typeof value.files !== 'number' ||
    !Number.isFinite(value.files) ||
    value.files < 0 ||
    (value.kind !== 'manual' &&
      value.kind !== 'loader' &&
      value.kind !== 'restore')
  ) {
    return null
  }
  return {
    id: value.id,
    worldFolder: value.worldFolder,
    worldName: value.worldName.trim().slice(0, 120),
    createdAt: value.createdAt,
    kind: value.kind,
    label: backupLabel(value.kind),
    bytes: Math.round(value.bytes),
    files: Math.round(value.files)
  }
}

async function readManifest(
  context: WorldVaultContext,
  folder: string,
  id: string
): Promise<WorldBackupView | null> {
  try {
    const root = worldBackupsRoot(context, folder)
    const backupDir = safeJoin(root, id)
    const text = await fs.readFile(join(backupDir, 'manifest.json'), 'utf8')
    return parseManifest(JSON.parse(text), folder, id)
  } catch {
    return null
  }
}

async function listBackupViews(
  context: WorldVaultContext,
  folder: string
): Promise<WorldBackupView[]> {
  const root = worldBackupsRoot(context, folder)
  let entries
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const list: WorldBackupView[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[A-Za-z0-9-]{1,80}$/.test(entry.name)) continue
    const view = await readManifest(context, folder, entry.name)
    if (view) list.push(view)
  }
  list.sort((a, b) => b.createdAt - a.createdAt)
  return list
}

async function listSavesFolders(context: WorldVaultContext): Promise<string[]> {
  try {
    const entries = await fs.readdir(savesDir(context), { withFileTypes: true })
    return entries
      .filter(
        (entry) =>
          entry.isDirectory() &&
          !entry.isSymbolicLink() &&
          !entry.name.startsWith('.windletter-') &&
          isSafeWorldFolder(entry.name)
      )
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

async function collectFiles(root: string): Promise<WorldFile[]> {
  const files: WorldFile[] = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 16) return
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const absolute = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(absolute, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      if (entry.name === 'session.lock' && dir === root) continue
      let stat
      try {
        stat = await fs.stat(absolute)
      } catch {
        continue
      }
      files.push({
        rel: relative(root, absolute),
        abs: absolute,
        size: stat.size
      })
      if (files.length > MAX_FILES) throw new Error('存档文件过多，已停止备份')
    }
  }
  await walk(root, 0)
  return files
}

function bytesOf(files: WorldFile[]): number {
  return files.reduce((sum, file) => sum + file.size, 0)
}

async function readWorldIcon(root: string): Promise<string | null> {
  try {
    const path = join(root, 'icon.png')
    const stat = await fs.stat(path)
    if (stat.size <= 0 || stat.size > MAX_ICON_BYTES) return null
    const data = await fs.readFile(path)
    if (
      data.length < 8 ||
      data[0] !== 0x89 ||
      data[1] !== 0x50 ||
      data[2] !== 0x4e ||
      data[3] !== 0x47
    ) {
      return null
    }
    return `data:image/png;base64,${data.toString('base64')}`
  } catch {
    return null
  }
}

async function worldSummary(
  context: WorldVaultContext,
  folder: string
): Promise<WorldSummary | null> {
  const path = safeJoin(savesDir(context), folder)
  let stat
  try {
    stat = await fs.lstat(path)
  } catch {
    return null
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) return null
  const level = await readLevelDat(join(path, 'level.dat'))
  const files = await collectFiles(path)
  const backups = await listBackupViews(context, folder)
  return {
    folder,
    name: level?.name?.trim() || folder,
    version: level?.version ?? null,
    size: bytesOf(files),
    files: files.length,
    lastPlayed: level?.lastPlayed ?? stat.mtimeMs,
    iconDataUrl: await readWorldIcon(path),
    backupCount: backups.length,
    backupBytes: backups.reduce((sum, backup) => sum + backup.bytes, 0),
    latestBackupAt: backups[0]?.createdAt ?? null,
    present: true
  }
}

async function orphanSummary(
  context: WorldVaultContext,
  folder: string
): Promise<WorldSummary | null> {
  const backups = await listBackupViews(context, folder)
  if (backups.length === 0) return null
  const latest = backups[0]
  let version: string | null = null
  try {
    const raw = JSON.parse(
      await fs.readFile(
        join(worldBackupsRoot(context, folder), latest.id, 'manifest.json'),
        'utf8'
      )
    ) as Partial<BackupManifest>
    version = typeof raw.gameVersion === 'string' ? raw.gameVersion : null
  } catch {
    version = null
  }
  return {
    folder,
    name: latest.worldName,
    version,
    size: 0,
    files: 0,
    lastPlayed: latest.createdAt,
    iconDataUrl: null,
    backupCount: backups.length,
    backupBytes: backups.reduce((sum, backup) => sum + backup.bytes, 0),
    latestBackupAt: latest.createdAt,
    present: false
  }
}

export async function listWorlds(context: WorldVaultContext): Promise<WorldSummary[]> {
  const worlds = new Map<string, WorldSummary>()
  for (const folder of await listSavesFolders(context)) {
    const summary = await worldSummary(context, folder)
    if (summary) worlds.set(folder, summary)
  }
  let backupFolders: string[] = []
  try {
    backupFolders = (await fs.readdir(backupsRoot(context), { withFileTypes: true }))
      .filter(
        (entry) => entry.isDirectory() && !entry.isSymbolicLink() && isSafeWorldFolder(entry.name)
      )
      .map((entry) => entry.name)
  } catch {
    backupFolders = []
  }
  for (const folder of backupFolders) {
    if (worlds.has(folder)) continue
    const orphan = await orphanSummary(context, folder)
    if (orphan) worlds.set(folder, orphan)
  }
  return [...worlds.values()].sort((a, b) => {
    if (a.present !== b.present) return a.present ? -1 : 1
    const left = a.lastPlayed ?? a.latestBackupAt ?? 0
    const right = b.lastPlayed ?? b.latestBackupAt ?? 0
    return right - left
  })
}

export async function listWorldBackups(
  context: WorldVaultContext,
  folder: string
): Promise<WorldBackupView[]> {
  return listBackupViews(context, assertSafeFolder(folder))
}

async function copyFiles(
  files: WorldFile[],
  destinationRoot: string,
  onChunk: (file: WorldFile, chunkBytes: number, fileBytes: number) => void,
  onFileDone: (file: WorldFile) => void,
  signal: AbortSignal
): Promise<void> {
  for (const file of files) {
    if (signal.aborted) throw new CancellationError()
    const destination = safeJoin(destinationRoot, file.rel)
    await fs.mkdir(dirname(destination), { recursive: true })
    let fileBytes = 0
    try {
      await pipeline(
        createReadStream(file.abs),
        new Transform({
          transform(chunk, _encoding, callback) {
            if (signal.aborted) {
              callback(new CancellationError())
              return
            }
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
            fileBytes += buffer.length
            onChunk(file, buffer.length, fileBytes)
            callback(null, buffer)
          }
        }),
        createWriteStream(destination),
        { signal }
      )
    } catch (error) {
      if (signal.aborted || error instanceof CancellationError) throw new CancellationError()
      throw error
    }
    try {
      const stat = await fs.stat(file.abs)
      await fs.utimes(destination, stat.atime, stat.mtime)
    } catch {
      /* 时间戳不影响存档内容 */
    }
    onFileDone(file)
  }
}

class CopyProgress {
  private bytesDone = 0
  private filesDone = 0
  private speed = 0
  private lastAt = Date.now()
  private lastBytes = 0
  private lastEmit = 0

  constructor(
    private readonly totalBytes: number,
    private readonly totalFiles: number,
    private readonly stage: (worldName: string) => string,
    private readonly progress: TaskProgress,
    private readonly rangeStart: number,
    private readonly rangeEnd: number
  ) {}

  private percent(): number {
    if (this.totalBytes <= 0) return this.rangeEnd
    return this.rangeStart + (this.bytesDone / this.totalBytes) * (this.rangeEnd - this.rangeStart)
  }

  update(
    worldName: string,
    kind: 'backup' | 'restore',
    file: WorldFile,
    fileBytes: number,
    force = false
  ): void {
    const now = Date.now()
    if (!force && now - this.lastEmit < 220) return
    const deltaSeconds = (now - this.lastAt) / 1000
    if (deltaSeconds >= 0.2) {
      const instant = (this.bytesDone - this.lastBytes) / deltaSeconds
      this.speed = this.speed > 0 ? this.speed * 0.65 + instant * 0.35 : instant
      this.lastAt = now
      this.lastBytes = this.bytesDone
    }
    this.lastEmit = now
    this.progress({
      stage: this.stage(worldName),
      percent: Math.min(99, this.percent()),
      detail: {
        current: this.filesDone,
        total: this.totalFiles,
        bytesDone: this.bytesDone,
        bytesTotal: this.totalBytes,
        speed: Math.max(0, Math.round(this.speed)),
        activeFiles: [
          {
            label: file.rel,
            bytes: Math.min(fileBytes, file.size),
            size: file.size
          }
        ]
      }
    })
  }

  addChunk(
    worldName: string,
    kind: 'backup' | 'restore',
    file: WorldFile,
    chunkBytes: number,
    fileBytes: number
  ): void {
    this.bytesDone += chunkBytes
    this.update(worldName, kind, file, fileBytes)
  }

  finishFile(worldName: string, kind: 'backup' | 'restore', file: WorldFile): void {
    this.filesDone += 1
    this.update(worldName, kind, file, file.size, true)
  }

  done(stage: string): void {
    this.progress({
      stage,
      percent: this.rangeEnd,
      detail: {
        current: this.totalFiles,
        total: this.totalFiles,
        bytesDone: this.totalBytes,
        bytesTotal: this.totalBytes,
        speed: 0
      }
    })
  }
}

async function pruneBackups(
  context: WorldVaultContext,
  folder: string,
  limit: number,
  kind?: WorldBackupKind,
  maxAgeDays = 0
): Promise<WorldBackupView[]> {
  const keep = Math.max(1, Math.min(30, Math.round(limit)))
  const cutoff =
    maxAgeDays > 0 ? Date.now() - Math.min(3650, Math.round(maxAgeDays)) * DAY_MS : null
  const backups = await listBackupViews(context, folder)
  const scoped = kind ? backups.filter((backup) => backup.kind === kind) : backups
  const removed: WorldBackupView[] = []
  for (const [index, backup] of scoped.entries()) {
    const tooOld = cutoff !== null && backup.createdAt < cutoff
    if (index < keep && !tooOld) continue
    try {
      await fs.rm(worldBackupsRoot(context, folder) + `/${backup.id}`, {
        recursive: true,
        force: true
      })
      removed.push(backup)
    } catch {
      /* 单个备份删除失败不影响其它备份 */
    }
  }
  return removed
}

async function pruneAllWorldKinds(
  context: WorldVaultContext,
  folder: string
): Promise<WorldBackupView[]> {
  const removed: WorldBackupView[] = []
  for (const kind of ['manual', 'loader', 'restore'] as WorldBackupKind[]) {
    removed.push(
      ...(await pruneBackups(context, folder, context.limit, kind, context.maxAgeDays))
    )
  }
  return removed
}

/** 按设置对实例的全部世界备份执行保留策略；供备份管理页和恢复流程共用。 */
export async function pruneWorldBackupsForInstance(
  context: WorldVaultContext
): Promise<{ removed: number; bytes: number }> {
  let folders: string[] = []
  try {
    folders = (await fs.readdir(backupsRoot(context), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && isSafeWorldFolder(entry.name))
      .map((entry) => entry.name)
  } catch {
    return { removed: 0, bytes: 0 }
  }
  let removed = 0
  let bytes = 0
  for (const folder of folders) {
    for (const backup of await pruneAllWorldKinds(context, folder)) {
      removed += 1
      bytes += backup.bytes
    }
  }
  return { removed, bytes }
}

export interface WorldBackupItem extends WorldBackupView {
  folder: string
}

export async function listAllWorldBackups(
  context: WorldVaultContext
): Promise<WorldBackupItem[]> {
  let folders: string[] = []
  try {
    folders = (await fs.readdir(backupsRoot(context), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && isSafeWorldFolder(entry.name))
      .map((entry) => entry.name)
  } catch {
    return []
  }
  const result: WorldBackupItem[] = []
  for (const folder of folders) {
    for (const backup of await listBackupViews(context, folder)) {
      result.push({ ...backup, folder })
    }
  }
  return result
}

export interface BackupWorldsResult {
  created: number
  bytes: number
  files: number
  worlds: string[]
}

export async function backupWorlds(options: {
  context: WorldVaultContext
  worldFolders?: string[] | null
  kind: WorldBackupKind
  signal: AbortSignal
  onProgress: TaskProgress
  prune?: boolean
}): Promise<BackupWorldsResult> {
  const { context, signal, onProgress } = options
  const folders = options.worldFolders?.length
    ? options.worldFolders.map(assertSafeFolder)
    : await listSavesFolders(context)
  if (folders.length === 0) {
    onProgress({ stage: '没有需要备份的存档', percent: 100, detail: emptyDetail() })
    return { created: 0, bytes: 0, files: 0, worlds: [] }
  }

  const plans: BackupPlan[] = []
  for (const folder of folders) {
    const path = safeJoin(savesDir(context), folder)
    let stat
    try {
      stat = await fs.lstat(path)
    } catch {
      throw new Error(`存档「${folder}」不存在`)
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('无效的存档目录')
    const level = await readLevelDat(join(path, 'level.dat'))
    const files = await collectFiles(path)
    if (files.length === 0) throw new Error(`存档「${level?.name ?? folder}」为空`)
    plans.push({
      folder,
      name: level?.name?.trim() || folder,
      files,
      bytes: bytesOf(files)
    })
  }

  const totalBytes = plans.reduce((sum, plan) => sum + plan.bytes, 0)
  const totalFiles = plans.reduce((sum, plan) => sum + plan.files.length, 0)
  const progress = new CopyProgress(
    totalBytes,
    totalFiles,
    (worldName) => `正在备份 ${worldName}`,
    onProgress,
    2,
    96
  )
  onProgress({
    stage: `准备备份 ${plans.length} 个存档`,
    percent: 2,
    detail: {
      current: 0,
      total: totalFiles,
      bytesDone: 0,
      bytesTotal: totalBytes,
      speed: 0
    }
  })

  let created = 0
  let bytes = 0
  let files = 0
  const backedUp: string[] = []
  for (const plan of plans) {
    if (signal.aborted) throw new CancellationError()
    const id = `${Date.now()}-${randomBytes(3).toString('hex')}`
    const backupDir = join(worldBackupsRoot(context, plan.folder), id)
    const worldDir = join(backupDir, 'world')
    try {
      await fs.mkdir(worldDir, { recursive: true })
      await copyFiles(
        plan.files,
        worldDir,
        (file, chunkBytes, fileBytes) =>
          progress.addChunk(plan.name, 'backup', file, chunkBytes, fileBytes),
        (file) => progress.finishFile(plan.name, 'backup', file),
        signal
      )
      const manifest: BackupManifest = {
        version: 1,
        id,
        worldFolder: plan.folder,
        worldName: plan.name,
        gameVersion: context.instance.gameVersion ?? null,
        instanceName: context.instance.name,
        createdAt: Date.now(),
        kind: options.kind,
        bytes: plan.bytes,
        files: plan.files.length
      }
      await writeFileAtomic(join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
      if (options.prune !== false) {
        await pruneBackups(
          context,
          plan.folder,
          context.limit,
          options.kind,
          context.maxAgeDays
        )
      }
      created += 1
      bytes += plan.bytes
      files += plan.files.length
      backedUp.push(plan.name)
    } catch (error) {
      await fs.rm(backupDir, { recursive: true, force: true }).catch(() => undefined)
      if (signal.aborted || error instanceof CancellationError) throw new CancellationError()
      throw error
    }
  }

  const stage = created > 0 ? `已备份 ${created} 个存档` : '备份完成'
  progress.done(stage)
  return { created, bytes, files, worlds: backedUp }
}

async function copyBackupToSaves(
  context: WorldVaultContext,
  folder: string,
  backupId: string,
  signal: AbortSignal,
  onProgress: TaskProgress
): Promise<{ tempDir: string; target: string; view: WorldBackupView }> {
  const view = await readManifest(context, folder, backupId)
  if (!view) throw new Error('备份记录不存在或已损坏')
  const source = safeJoin(join(worldBackupsRoot(context, folder), backupId), 'world')
  if (!(await pathExists(join(source, 'level.dat')))) throw new Error('备份中缺少 level.dat')
  const files = await collectFiles(source)
  if (files.length === 0) throw new Error('备份内容为空')
  const totalBytes = bytesOf(files)
  const saves = savesDir(context)
  await fs.mkdir(saves, { recursive: true })
  const tempName = `.windletter-restore-${Date.now()}-${randomBytes(3).toString('hex')}`
  const tempDir = safeJoin(saves, tempName)
  const progress = new CopyProgress(
    totalBytes,
    files.length,
    () => '正在恢复存档文件',
    onProgress,
    4,
    48
  )
  try {
    await fs.mkdir(tempDir, { recursive: true })
    await copyFiles(
      files,
      tempDir,
      (file, chunkBytes, fileBytes) =>
        progress.addChunk(view.worldName, 'restore', file, chunkBytes, fileBytes),
      (file) => progress.finishFile(view.worldName, 'restore', file),
      signal
    )
    if (!(await pathExists(join(tempDir, 'level.dat')))) {
      throw new Error('恢复的存档缺少 level.dat')
    }
    progress.done('存档文件已准备')
    return { tempDir, target: safeJoin(saves, folder), view }
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
    if (signal.aborted || error instanceof CancellationError) throw new CancellationError()
    throw error
  }
}

export async function restoreWorldBackup(options: {
  context: WorldVaultContext
  worldFolder: string
  backupId: string
  signal: AbortSignal
  onProgress: TaskProgress
}): Promise<{ worldFolder: string; worldName: string }> {
  const { context, signal, onProgress } = options
  const folder = assertSafeFolder(options.worldFolder)
  if (!/^[A-Za-z0-9-]{1,80}$/.test(options.backupId)) throw new Error('无效的备份编号')
  const prepared = await copyBackupToSaves(
    context,
    folder,
    options.backupId,
    signal,
    onProgress
  )
  const target = prepared.target
  const tempDir = prepared.tempDir
  const oldDir = safeJoin(
    savesDir(context),
    `.windletter-old-${Date.now()}-${randomBytes(3).toString('hex')}`
  )
  let movedOld = false
  try {
    const targetExists = await pathExists(target)
    if (targetExists) {
      const targetStat = await fs.lstat(target)
      if (targetStat.isSymbolicLink() || !targetStat.isDirectory()) {
        throw new Error('当前存档目录无效，已拒绝覆盖')
      }
      onProgress({
        stage: '恢复前先备份当前存档',
        percent: 50,
        detail: emptyDetail()
      })
      const safety = await backupWorlds({
        context,
        worldFolders: [folder],
        kind: 'restore',
        signal,
        prune: false,
        onProgress: (info) => {
          onProgress({
            stage: `恢复前先备份 · ${info.stage}`,
            percent: 50 + Math.min(32, info.percent * 0.32),
            detail: info.detail
          })
        }
      })
      if (safety.created === 0) throw new Error('恢复前的安全备份失败')
    }
    if (signal.aborted) throw new CancellationError()
    if (await pathExists(target)) {
      await fs.rename(target, oldDir)
      movedOld = true
    }
    try {
      await fs.rename(tempDir, target)
    } catch (error) {
      if (movedOld) await fs.rename(oldDir, target).catch(() => undefined)
      throw error
    }
    if (movedOld) await fs.rm(oldDir, { recursive: true, force: true }).catch(() => undefined)
    // 手动、加载器更新前、恢复前三类各自计数，避免恢复时的安全备份挤掉手动备份。
    await pruneAllWorldKinds(context, folder)
    onProgress({
      stage: '存档已恢复',
      percent: 100,
      detail: emptyDetail()
    })
    return { worldFolder: folder, worldName: prepared.view.worldName }
  } catch (error) {
    if (movedOld && !(await pathExists(target))) {
      await fs.rename(oldDir, target).catch(() => undefined)
    }
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
    if (signal.aborted || error instanceof CancellationError) throw new CancellationError()
    throw error
  }
}

export async function deleteWorldBackup(
  context: WorldVaultContext,
  folder: string,
  backupId: string
): Promise<void> {
  assertSafeFolder(folder)
  if (!/^[A-Za-z0-9-]{1,80}$/.test(backupId)) throw new Error('无效的备份编号')
  const view = await readManifest(context, folder, backupId)
  if (!view) throw new Error('备份记录不存在或已损坏')
  await fs.rm(safeJoin(worldBackupsRoot(context, folder), backupId), {
    recursive: true,
    force: true
  })
}

export function worldVaultPaths(context: WorldVaultContext): { saves: string; backups: string } {
  return { saves: savesDir(context), backups: backupsRoot(context) }
}
