import { createHash } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative as pathRelative } from 'node:path'
import type {
  ContentChangelogView,
  ContentKind,
  ContentLedgerCheckState,
  ContentLedgerEntryView,
  ContentLedgerKindSummary,
  ContentLedgerSource,
  ContentLedgerUpdateSummary,
  ContentLedgerView,
  ContentProvider,
  ContentRollbackResult,
  ContentUpdateChange,
  ContentUpdateProgress,
  ContentUpdateRequest,
  ContentUpdateResult,
  ManualModDownload
} from '../../shared/types'
import { getSettings } from './config'
import {
  getCurseForgeFileChangelog,
  getCurseForgeProjectLink,
  getCurseForgeProjectsInfo,
  identifyCurseForgeFingerprints,
  pickCurseForgeModFile,
  type CurseForgeFingerprintMatch
} from './curseforge'
import { markKnownGood } from './diagnostics'
import { getInstance, getInstanceDir, getInstanceGameDir } from './instances'
import {
  installMod,
  latestModrinthVersionInfo,
  toggleMod,
  type LatestContentVersion
} from './mods'
import { fetchJson, USER_AGENT } from './net'

const MODRINTH_BASE = 'https://api.modrinth.com/v2'
const CHECK_TTL = 6 * 60 * 60 * 1000
const IDENTIFY_RETRY_TTL = 7 * 24 * 60 * 60 * 1000
const HASH_CONCURRENCY = 2
const CHECK_CONCURRENCY = 3
const MAX_MEMORY_HASH = 192 * 1024 * 1024
const MODRINTH_HASH_BATCH = 100
const MODRINTH_PROJECTS_BATCH = 50
const UPDATE_STATE_FILE = 'content-updates.json'
const DEFAULT_UPDATE_BACKUP_KEEP = 6
const DAY_MS = 24 * 60 * 60 * 1000
const WHITESPACE = new Set([9, 10, 13, 32])

const KIND_ORDER: ContentKind[] = ['mod', 'datapack', 'resourcepack', 'shader']

const CONTENT_DIRS: { kind: ContentKind; dir: string; extensions: string[] }[] = [
  { kind: 'mod', dir: 'mods', extensions: ['.jar', '.jar.disabled'] },
  { kind: 'datapack', dir: 'datapacks', extensions: ['.zip'] },
  { kind: 'resourcepack', dir: 'resourcepacks', extensions: ['.zip'] },
  { kind: 'shader', dir: 'shaderpacks', extensions: ['.zip'] }
]

const KIND_DIR: Record<ContentKind, string> = {
  mod: 'mods',
  datapack: 'datapacks',
  resourcepack: 'resourcepacks',
  shader: 'shaderpacks'
}

interface StoredLedgerEntry {
  kind: ContentKind
  file: string
  size: number
  mtime: number
  enabled: boolean
  sha1: string
  fingerprint: number | null
  provider: ContentProvider | null
  projectId: string | null
  projectTitle: string | null
  slug: string | null
  versionId: string | null
  versionNumber: string | null
  identifiedAt: number | null
  latestVersionId: string | null
  latestVersionNumber: string | null
  latestFileName: string | null
  latestFileSize: number | null
  latestCheckedAt: number | null
  latestError: string | null
}

interface StoredLedger {
  version: 1
  scannedAt: number
  checkedAt: number | null
  entries: StoredLedgerEntry[]
}

interface ContentFile {
  kind: ContentKind
  file: string
  absolute: string
  size: number
  mtime: number
  enabled: boolean
}

interface StoredUpdateFile {
  kind: ContentKind
  file: string
  size: number
  mtime: number
}

interface StoredUpdateRecord {
  id: string
  createdAt: number
  backupDir: string
  files: StoredUpdateFile[]
  beforeFiles: string[]
  beforeTemps: string[]
  addedFiles: string[]
  changes: ContentUpdateChange[]
  diagnosticsSnapshot: string | null
  rolledBackAt: number | null
  error: string | null
}

interface StoredUpdateState {
  version: 1
  updates: StoredUpdateRecord[]
}

interface HashResult {
  sha1: string
  fingerprint: number | null
}

interface ModrinthHashMatch {
  projectId: string
  versionId: string
  versionNumber: string
  fileName: string | null
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const runners = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (true) {
        const index = cursor
        cursor += 1
        if (index >= items.length) return
        results[index] = await worker(items[index])
      }
    }
  )
  await Promise.all(runners)
  return results
}

/* ---------- CurseForge 指纹 ---------- */
/**
 * CurseForge 官方指纹：Murmur2 变体，固定忽略 9/10/13/32 四类空白字符，
 * 长度取过滤后的字节数，返回 32 位无符号整数。
 */
function murmur2(buffer: Buffer): number {
  const m = 1540483477
  let length = 0
  for (let index = 0; index < buffer.length; index += 1) {
    if (!WHITESPACE.has(buffer[index])) length += 1
  }
  let hash = (1 ^ length) >>> 0
  let block = 0
  let bytesInBlock = 0
  for (let index = 0; index < buffer.length; index += 1) {
    const byte = buffer[index]
    if (WHITESPACE.has(byte)) continue
    block |= byte << (bytesInBlock * 8)
    bytesInBlock += 1
    if (bytesInBlock === 4) {
      const mixed = Math.imul(block >>> 0, m) >>> 0
      hash = (Math.imul(hash, m) ^ Math.imul(mixed ^ (mixed >>> 24), m)) >>> 0
      block = 0
      bytesInBlock = 0
    }
  }
  if (bytesInBlock > 0) {
    hash = Math.imul(hash ^ block, m) >>> 0
  }
  const final = Math.imul(hash ^ (hash >>> 13), m) >>> 0
  return (final ^ (final >>> 15)) >>> 0
}

async function streamSha1(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha1')
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

async function hashContentFile(path: string): Promise<HashResult> {
  const stat = await fs.stat(path)
  if (stat.size <= MAX_MEMORY_HASH) {
    const buffer = await fs.readFile(path)
    return {
      sha1: createHash('sha1').update(buffer).digest('hex'),
      fingerprint: murmur2(buffer)
    }
  }
  return { sha1: await streamSha1(path), fingerprint: null }
}

/* ---------- 本地内容扫描 ---------- */
async function listContentFiles(gameDir: string): Promise<ContentFile[]> {
  const files: ContentFile[] = []
  for (const entry of CONTENT_DIRS) {
    const dir = join(gameDir, entry.dir)
    let names: string[]
    try {
      names = await fs.readdir(dir)
    } catch {
      continue
    }
    for (const name of names) {
      const lower = name.toLowerCase()
      if (!entry.extensions.some((extension) => lower.endsWith(extension))) continue
      try {
        const stat = await fs.stat(join(dir, name))
        if (!stat.isFile()) continue
        files.push({
          kind: entry.kind,
          file: `${entry.dir}/${name}`,
          absolute: join(dir, name),
          size: stat.size,
          mtime: stat.mtimeMs,
          enabled: entry.kind === 'mod' ? lower.endsWith('.jar') : true
        })
      } catch {
        /* ignore */
      }
    }
  }
  files.sort((left, right) => left.file.localeCompare(right.file))
  return files
}

/** 下载中断后留在内容目录里的分片临时文件（.part / .part.json / .part.seg*）。 */
async function listDownloadTemps(gameDir: string): Promise<string[]> {
  const files: string[] = []
  for (const entry of CONTENT_DIRS) {
    const dir = join(gameDir, entry.dir)
    let names: string[]
    try {
      names = await fs.readdir(dir)
    } catch {
      continue
    }
    for (const name of names) {
      if (!/\.(jar|zip)\.part(\.|$)/i.test(name)) continue
      files.push(`${entry.dir}/${name}`)
    }
  }
  return files
}

/* ---------- 账本读写 ---------- */
function ledgerPath(instanceId: string): string {
  return join(getInstanceDir(instanceId), 'content-ledger.json')
}
function normalizeEntry(raw: unknown): StoredLedgerEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Partial<StoredLedgerEntry>
  if (
    typeof value.file !== 'string' ||
    typeof value.sha1 !== 'string' ||
    !KIND_ORDER.includes(value.kind as ContentKind)
  ) {
    return null
  }
  return {
    kind: value.kind as ContentKind,
    file: value.file,
    size: typeof value.size === 'number' ? value.size : 0,
    mtime: typeof value.mtime === 'number' ? value.mtime : 0,
    enabled: value.enabled !== false,
    sha1: value.sha1,
    fingerprint: typeof value.fingerprint === 'number' ? value.fingerprint : null,
    provider: value.provider === 'modrinth' || value.provider === 'curseforge' ? value.provider : null,
    projectId: typeof value.projectId === 'string' ? value.projectId : null,
    projectTitle: typeof value.projectTitle === 'string' ? value.projectTitle : null,
    slug: typeof value.slug === 'string' ? value.slug : null,
    versionId: typeof value.versionId === 'string' ? value.versionId : null,
    versionNumber: typeof value.versionNumber === 'string' ? value.versionNumber : null,
    identifiedAt: typeof value.identifiedAt === 'number' ? value.identifiedAt : null,
    latestVersionId: typeof value.latestVersionId === 'string' ? value.latestVersionId : null,
    latestVersionNumber:
      typeof value.latestVersionNumber === 'string' ? value.latestVersionNumber : null,
    latestFileName: typeof value.latestFileName === 'string' ? value.latestFileName : null,
    latestFileSize: typeof value.latestFileSize === 'number' ? value.latestFileSize : null,
    latestCheckedAt: typeof value.latestCheckedAt === 'number' ? value.latestCheckedAt : null,
    latestError: typeof value.latestError === 'string' ? value.latestError : null
  }
}

async function loadLedger(instanceId: string): Promise<StoredLedger> {
  try {
    const raw = JSON.parse(await fs.readFile(ledgerPath(instanceId), 'utf8')) as Partial<StoredLedger>
    const entries = Array.isArray(raw.entries)
      ? raw.entries
          .map((entry) => normalizeEntry(entry))
          .filter((entry): entry is StoredLedgerEntry => Boolean(entry))
      : []
    return {
      version: 1,
      scannedAt: typeof raw.scannedAt === 'number' ? raw.scannedAt : 0,
      checkedAt: typeof raw.checkedAt === 'number' ? raw.checkedAt : null,
      entries
    }
  } catch {
    return { version: 1, scannedAt: 0, checkedAt: null, entries: [] }
  }
}

async function saveLedger(instanceId: string, ledger: StoredLedger): Promise<void> {
  const path = ledgerPath(instanceId)
  await fs.mkdir(getInstanceDir(instanceId), { recursive: true })
  const tmp = `${path}.tmp`
  await fs.writeFile(tmp, JSON.stringify(ledger, null, 2), 'utf8')
  await fs.rename(tmp, path)
}

function contentAbsolute(gameDir: string, contentFile: string): string {
  const normalized = contentFile.replace(/\\/g, '/')
  if (
    normalized.includes('..') ||
    !CONTENT_DIRS.some((entry) => normalized.startsWith(`${entry.dir}/`))
  ) {
    throw new Error('无效的内容文件路径')
  }
  const absolute = join(gameDir, normalized)
  const rel = pathRelative(gameDir, absolute)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('内容文件超出实例目录')
  }
  return absolute
}

function updateStatePath(instanceId: string): string {
  return join(getInstanceDir(instanceId), UPDATE_STATE_FILE)
}

async function loadUpdateState(instanceId: string): Promise<StoredUpdateState> {
  try {
    const raw = JSON.parse(
      await fs.readFile(updateStatePath(instanceId), 'utf8')
    ) as Partial<StoredUpdateState>
    const updates = Array.isArray(raw.updates)
      ? raw.updates
          .filter(
            (record): record is StoredUpdateRecord =>
              Boolean(record) &&
              typeof record.id === 'string' &&
              typeof record.createdAt === 'number' &&
              typeof record.backupDir === 'string' &&
              Array.isArray(record.files) &&
              Array.isArray(record.addedFiles) &&
              Array.isArray(record.changes)
          )
          .map((record) => ({
            ...record,
            beforeFiles: Array.isArray(record.beforeFiles)
              ? record.beforeFiles.filter((file): file is string => typeof file === 'string')
              : record.files?.map((file) => file.file) ?? [],
            beforeTemps: Array.isArray(record.beforeTemps)
              ? record.beforeTemps.filter((file): file is string => typeof file === 'string')
              : [],
            rolledBackAt:
              typeof record.rolledBackAt === 'number' ? record.rolledBackAt : null,
            error: typeof record.error === 'string' ? record.error : null,
            diagnosticsSnapshot:
              typeof record.diagnosticsSnapshot === 'string'
                ? record.diagnosticsSnapshot
                : null
          }))
      : []
    return { version: 1, updates }
  } catch {
    return { version: 1, updates: [] }
  }
}

async function saveUpdateState(
  instanceId: string,
  state: StoredUpdateState
): Promise<void> {
  const path = updateStatePath(instanceId)
  await fs.mkdir(getInstanceDir(instanceId), { recursive: true })
  const tmp = `${path}.tmp`
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), 'utf8')
  await fs.rename(tmp, path)
}

function updateSummary(state: StoredUpdateState): ContentLedgerUpdateSummary | null {
  const latest = [...state.updates]
    .sort((left, right) => right.createdAt - left.createdAt)
    .find((record) => !record.rolledBackAt)
  if (!latest) return null
  return {
    createdAt: latest.createdAt,
    updatedCount: latest.changes.length,
    canRollback: true,
    changes: latest.changes
  }
}

export interface LatestContentUpdateDetail {
  createdAt: number
  changes: ContentUpdateChange[]
  addedFiles: string[]
}

/** 读取最近一次未回滚的内容更新，供“更新解读”使用。 */
export async function getLatestContentUpdate(
  instanceId: string
): Promise<LatestContentUpdateDetail | null> {
  const state = await loadUpdateState(instanceId)
  const latest = [...state.updates]
    .sort((left, right) => right.createdAt - left.createdAt)
    .find((record) => !record.rolledBackAt)
  if (!latest) return null
  return {
    createdAt: latest.createdAt,
    changes: latest.changes,
    addedFiles: latest.addedFiles
  }
}

/* ---------- Modrinth 识别 ---------- */
interface RawVersionFile {
  id?: string
  project_id?: string
  version_number?: string
  name?: string
  files?: { filename?: string; size?: number }[]
}

interface RawVersionDetail extends RawVersionFile {
  changelog?: string | null
  date_published?: string
}

async function modrinthRequest<T>(
  url: string,
  init: RequestInit = {}
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
      ...(init.headers ?? {})
    },
    signal: AbortSignal.timeout(30_000)
  })
  if (!response.ok) throw new Error(`Modrinth API 返回 HTTP ${response.status}`)
  return (await response.json()) as T
}

async function identifyModrinthHashes(
  hashes: string[]
): Promise<Map<string, ModrinthHashMatch>> {
  const unique = [...new Set(hashes.filter(Boolean))]
  const result = new Map<string, ModrinthHashMatch>()
  for (let index = 0; index < unique.length; index += MODRINTH_HASH_BATCH) {
    const batch = unique.slice(index, index + MODRINTH_HASH_BATCH)
    const data = await modrinthRequest<Record<string, RawVersionFile>>(
      `${MODRINTH_BASE}/version_files`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hashes: batch, algorithm: 'sha1' })
      }
    )
    for (const [hash, version] of Object.entries(data ?? {})) {
      if (!version?.id || !version.project_id) continue
      result.set(hash, {
        projectId: version.project_id,
        versionId: version.id,
        versionNumber: (version.version_number ?? version.name ?? '').slice(0, 160),
        fileName: version.files?.[0]?.filename ?? null
      })
    }
  }
  return result
}

async function modrinthProjects(
  ids: string[]
): Promise<Map<string, { title: string; slug: string }>> {
  const unique = [...new Set(ids.filter(Boolean))]
  const result = new Map<string, { title: string; slug: string }>()
  for (let index = 0; index < unique.length; index += MODRINTH_PROJECTS_BATCH) {
    const batch = unique.slice(index, index + MODRINTH_PROJECTS_BATCH)
    const url = `${MODRINTH_BASE}/projects?ids=${encodeURIComponent(JSON.stringify(batch))}`
    const data = await fetchJson<{ id?: string; title?: string; slug?: string }[]>([url], {
      timeoutMs: 30_000
    })
    for (const project of data ?? []) {
      if (!project.id) continue
      result.set(project.id, {
        title: (project.title ?? project.id).slice(0, 160),
        slug: project.slug ?? project.id
      })
    }
  }
  return result
}

/* ---------- 扫描与识别 ---------- */
export async function scanContentLedger(
  instanceId: string,
  force = false
): Promise<ContentLedgerView> {
  const instance = await getInstance(instanceId)
  const gameDir = await getInstanceGameDir(instance.id)
  const settings = getSettings()
  const previous = await loadLedger(instance.id)
  const previousByFile = new Map(previous.entries.map((entry) => [entry.file, entry]))
  const files = await listContentFiles(gameDir)
  const errors: string[] = []
  const entries: StoredLedgerEntry[] = []
  const hashTargets: ContentFile[] = []

  for (const file of files) {
    const old = previousByFile.get(file.file)
    if (
      !force &&
      old &&
      old.size === file.size &&
      old.mtime === file.mtime &&
      old.sha1
    ) {
      entries.push({ ...old, kind: file.kind, enabled: file.enabled })
    } else {
      hashTargets.push(file)
    }
  }

  const hashed = await mapLimit(hashTargets, HASH_CONCURRENCY, async (file) => {
    try {
      const result = await hashContentFile(file.absolute)
      return { file, result }
    } catch (error) {
      errors.push(`${file.file} 读取失败：${errorText(error)}`)
      return null
    }
  })
  for (const item of hashed) {
    if (!item) continue
    entries.push({
      kind: item.file.kind,
      file: item.file.file,
      size: item.file.size,
      mtime: item.file.mtime,
      enabled: item.file.enabled,
      sha1: item.result.sha1,
      fingerprint: item.result.fingerprint,
      provider: null,
      projectId: null,
      projectTitle: null,
      slug: null,
      versionId: null,
      versionNumber: null,
      identifiedAt: null,
      latestVersionId: null,
      latestVersionNumber: null,
      latestFileName: null,
      latestFileSize: null,
      latestCheckedAt: null,
      latestError: null
    })
  }

  const now = Date.now()
  const identifyTargets = entries.filter(
    (entry) =>
      !entry.provider &&
      (force ||
        !entry.identifiedAt ||
        now - entry.identifiedAt > IDENTIFY_RETRY_TTL)
  )

  const mrHashes = [...new Set(identifyTargets.map((entry) => entry.sha1).filter(Boolean))]
  if (mrHashes.length > 0) {
    try {
      const matches = await identifyModrinthHashes(mrHashes)
      for (const entry of identifyTargets) {
        const match = matches.get(entry.sha1)
        if (match) {
          entry.provider = 'modrinth'
          entry.projectId = match.projectId
          entry.versionId = match.versionId
          entry.versionNumber = match.versionNumber
        }
        entry.identifiedAt = now
      }
    } catch (error) {
      errors.push(`Modrinth 识别失败：${errorText(error)}`)
    }
  }

  const cfTargets = identifyTargets.filter((entry) => !entry.provider)
  const fingerprintValues: number[] = [
    ...new Set(
      cfTargets
        .map((entry) => entry.fingerprint)
        .filter((value): value is number => typeof value === 'number')
    )
  ]
  if (fingerprintValues.length > 0) {
    try {
      const matches = await identifyCurseForgeFingerprints(fingerprintValues, settings)
      for (const entry of cfTargets) {
        const match: CurseForgeFingerprintMatch | null =
          entry.fingerprint != null ? matches.get(entry.fingerprint) ?? null : null
        if (match) {
          entry.provider = 'curseforge'
          entry.projectId = match.projectId
          entry.versionId = match.fileId
          entry.versionNumber = match.versionNumber
          entry.slug = null
        }
        entry.identifiedAt = now
      }
    } catch (error) {
      errors.push(`CurseForge 指纹识别失败：${errorText(error)}`)
    }
  }

  const mrProjectIds = [
    ...new Set(
      entries
        .filter((entry) => entry.provider === 'modrinth' && entry.projectId && !entry.projectTitle)
        .map((entry) => entry.projectId as string)
    )
  ]
  if (mrProjectIds.length > 0) {
    try {
      const meta = await modrinthProjects(mrProjectIds)
      for (const entry of entries) {
        if (entry.provider !== 'modrinth' || !entry.projectId || entry.projectTitle) continue
        const info = meta.get(entry.projectId)
        if (info) {
          entry.projectTitle = info.title
          entry.slug = info.slug
        }
      }
    } catch (error) {
      errors.push(`Modrinth 项目信息获取失败：${errorText(error)}`)
    }
  }

  const cfProjectIds = [
    ...new Set(
      entries
        .filter((entry) => entry.provider === 'curseforge' && entry.projectId && !entry.projectTitle)
        .map((entry) => entry.projectId as string)
    )
  ]
  if (cfProjectIds.length > 0) {
    let info: Map<string, { id: string; title: string; slug: string; url: string }> | null = null
    try {
      info = await getCurseForgeProjectsInfo(cfProjectIds, settings)
    } catch {
      info = null
    }
    if (!info || info.size === 0) {
      const fallback = await mapLimit(cfProjectIds.slice(0, 40), 3, async (id) => {
        try {
          const link = await getCurseForgeProjectLink(id, settings)
          const slug = link.url.match(/mc-mods\/([^/]+)/)?.[1] ?? id
          return { id, title: link.title, slug }
        } catch {
          return null
        }
      })
      info = new Map(
        fallback
          .filter((item): item is { id: string; title: string; slug: string } => Boolean(item))
          .map((item) => [item.id, { ...item, url: '' }])
      )
    }
    for (const entry of entries) {
      if (entry.provider !== 'curseforge' || !entry.projectId || entry.projectTitle) continue
      const project = info.get(entry.projectId)
      if (project) {
        entry.projectTitle = project.title
        entry.slug = project.slug
      }
    }
  }

  const ledger: StoredLedger = {
    version: 1,
    scannedAt: now,
    checkedAt: previous.checkedAt,
    entries
  }
  await saveLedger(instance.id, ledger)
  const updateState = await loadUpdateState(instance.id)
  return toView(instance.id, ledger, errors, updateSummary(updateState))
}

/* ---------- 更新检查 ---------- */
type LatestCheckResult =
  | { ok: true; latest: LatestContentVersion | null }
  | { ok: false; error: string }

async function latestForEntry(
  entry: StoredLedgerEntry,
  gameVersion: string,
  loader: string,
  settings: ReturnType<typeof getSettings>
): Promise<LatestCheckResult> {
  try {
    if (entry.provider === 'modrinth' && entry.projectId) {
      const info = await latestModrinthVersionInfo(
        entry.projectId,
        gameVersion,
        entry.kind === 'mod' ? loader : '',
        entry.kind
      )
      if (info) return { ok: true, latest: info }
      if (entry.kind !== 'mod') {
        const fallback = await latestModrinthVersionInfo(entry.projectId, '', '', entry.kind)
        if (fallback) return { ok: true, latest: fallback }
      }
      return { ok: false, error: '没有找到兼容当前版本与加载器的更新' }
    }
    if (entry.provider === 'curseforge' && entry.projectId) {
      const selection = await pickCurseForgeModFile(
        entry.projectId,
        gameVersion,
        entry.kind === 'mod' ? loader : '',
        settings,
        null,
        entry.kind
      )
      return {
        ok: true,
        latest: {
          versionId: selection.fileId || selection.filename,
          versionNumber: selection.versionNumber || selection.filename,
          fileName: selection.filename,
          fileSize: selection.size
        }
      }
    }
    return { ok: true, latest: null }
  } catch (error) {
    return { ok: false, error: errorText(error) }
  }
}

export async function checkContentUpdates(
  instanceId: string,
  force = false
): Promise<ContentLedgerView> {
  let ledger = await loadLedger(instanceId)
  if (ledger.entries.length === 0) {
    await scanContentLedger(instanceId, force)
    ledger = await loadLedger(instanceId)
  }
  const instance = await getInstance(instanceId)
  const settings = getSettings()
  const now = Date.now()
  const errors: string[] = []
  const groups = new Map<string, StoredLedgerEntry[]>()
  for (const entry of ledger.entries) {
    if (!entry.provider || !entry.projectId) continue
    if (!force && entry.latestCheckedAt && now - entry.latestCheckedAt <= CHECK_TTL) continue
    const key = `${entry.provider}:${entry.projectId}:${entry.kind}`
    const list = groups.get(key) ?? []
    list.push(entry)
    groups.set(key, list)
  }

  const results = await mapLimit([...groups.entries()], CHECK_CONCURRENCY, async ([key, group]) => {
    const sample = group[0]
    const result = await latestForEntry(sample, instance.gameVersion, instance.loader, settings)
    return { key, result }
  })

  for (const { key, result } of results) {
    const group = groups.get(key) ?? []
    for (const entry of group) {
      entry.latestCheckedAt = now
      if (result.ok) {
        entry.latestVersionId = result.latest?.versionId ?? null
        entry.latestVersionNumber = result.latest?.versionNumber ?? null
        entry.latestFileName = result.latest?.fileName ?? null
        entry.latestFileSize = result.latest?.fileSize ?? null
        entry.latestError = result.latest ? null : '没有找到兼容当前版本与加载器的更新'
      } else {
        entry.latestVersionId = null
        entry.latestVersionNumber = null
        entry.latestFileName = null
        entry.latestFileSize = null
        entry.latestError = result.error
        errors.push(`${sampleLabel(key)}：${result.error}`)
      }
    }
  }

  if (groups.size > 0) ledger.checkedAt = now
  await saveLedger(instance.id, ledger)
  const updateState = await loadUpdateState(instance.id)
  return toView(instance.id, ledger, errors, updateSummary(updateState))
}

function sampleLabel(key: string): string {
  const [, projectId] = key.split(':')
  return `项目 ${projectId}`
}

/* ---------- 安全更新与回滚 ---------- */
type UpdateProgressCallback = (progress: ContentUpdateProgress) => void

function createUpdateProgress(
  instanceId: string,
  emit?: UpdateProgressCallback
): {
  stage: (
    phase: ContentUpdateProgress['phase'],
    stage: string,
    percent: number
  ) => void
  reset: () => void
  plan: (filesTotal: number, bytesTotal: number) => void
  file: (file: string, index: number, total: number) => void
  bytes: (delta: number, base: number, span: number) => void
} {
  let lastEmit = 0
  let state: ContentUpdateProgress = {
    instanceId,
    phase: 'prepare',
    stage: '',
    percent: 0,
    filesDone: 0,
    filesTotal: 0,
    file: null,
    bytesDone: 0,
    bytesTotal: 0
  }
  const clamp = (value: number): number => Math.max(0, Math.min(100, value))
  const send = (force: boolean): void => {
    if (!emit) return
    const now = Date.now()
    if (!force && now - lastEmit < 180) return
    lastEmit = now
    emit({ ...state })
  }
  return {
    stage(phase, stage, percent) {
      state = { ...state, phase, stage, percent: clamp(percent) }
      send(true)
    },
    reset() {
      state = {
        ...state,
        filesDone: 0,
        filesTotal: 0,
        file: null,
        bytesDone: 0,
        bytesTotal: 0
      }
    },
    plan(filesTotal, bytesTotal) {
      state = {
        ...state,
        filesDone: 0,
        filesTotal,
        bytesDone: 0,
        bytesTotal: Math.max(0, bytesTotal)
      }
      send(true)
    },
    file(file, index, total) {
      const backup = state.phase === 'backup'
      const verb = backup ? '正在备份' : '正在下载'
      state = {
        ...state,
        phase: backup ? 'backup' : 'download',
        stage: `${verb} ${file}${backup ? `（${index}/${total}）` : ''}`,
        file,
        filesDone: index,
        filesTotal: total
      }
      send(true)
    },
    bytes(delta, base, span) {
      const nextDone = state.bytesDone + Math.max(0, delta)
      state = {
        ...state,
        phase: 'download',
        bytesDone:
          state.bytesTotal > 0 ? Math.min(nextDone, state.bytesTotal) : nextDone
      }
      const ratio =
        state.bytesTotal > 0
          ? Math.min(1, state.bytesDone / state.bytesTotal)
          : state.filesTotal > 0
            ? Math.min(1, state.filesDone / state.filesTotal)
            : 0
      state.percent = clamp(base + ratio * span)
      send(false)
    }
  }
}

async function refreshLedgerView(instanceId: string): Promise<ContentLedgerView> {
  await scanContentLedger(instanceId, false)
  return checkContentUpdates(instanceId, false)
}

async function safeRefreshLedgerView(
  instanceId: string,
  updateState: StoredUpdateState,
  extraErrors: string[] = []
): Promise<ContentLedgerView> {
  try {
    return await refreshLedgerView(instanceId)
  } catch (error) {
    const ledger = await loadLedger(instanceId)
    return toView(instanceId, ledger, [
      ...extraErrors,
      `账本刷新失败：${errorText(error)}`
    ], updateSummary(updateState))
  }
}

async function restoreUpdateRecord(
  instanceId: string,
  record: StoredUpdateRecord,
  cleanUntracked = false
): Promise<string | null> {
  const gameDir = await getInstanceGameDir(instanceId)
  const instanceDir = getInstanceDir(instanceId)
  const errors: string[] = []
  for (const relative of record.addedFiles) {
    try {
      await fs.rm(contentAbsolute(gameDir, relative), { force: true })
    } catch (error) {
      errors.push(`删除 ${relative} 失败：${errorText(error)}`)
    }
  }
  if (cleanUntracked) {
    const before = new Set(record.beforeFiles)
    const oldFiles = new Set(record.files.map((file) => file.file))
    try {
      for (const file of await listContentFiles(gameDir)) {
        if (before.has(file.file) || oldFiles.has(file.file)) continue
        await fs.rm(file.absolute, { force: true }).catch(() => undefined)
      }
    } catch (error) {
      errors.push(`清理未跟踪文件失败：${errorText(error)}`)
    }
    const beforeTemps = new Set(record.beforeTemps)
    try {
      for (const temp of await listDownloadTemps(gameDir)) {
        if (beforeTemps.has(temp)) continue
        await fs.rm(contentAbsolute(gameDir, temp), { force: true }).catch(() => undefined)
      }
    } catch (error) {
      errors.push(`清理未完成下载失败：${errorText(error)}`)
    }
  }
  for (const file of record.files) {
    try {
      const backupPath = join(instanceDir, record.backupDir, file.file)
      const destination = contentAbsolute(gameDir, file.file)
      await fs.mkdir(dirname(destination), { recursive: true })
      await fs.copyFile(backupPath, destination)
    } catch (error) {
      errors.push(`恢复 ${file.file} 失败：${errorText(error)}`)
    }
  }
  if (record.diagnosticsSnapshot) {
    try {
      await fs.writeFile(
        join(instanceDir, 'diagnostics.json'),
        record.diagnosticsSnapshot,
        'utf8'
      )
    } catch (error) {
      errors.push(`恢复已知可运行快照失败：${errorText(error)}`)
    }
  }
  return errors.length > 0 ? errors.join('；') : null
}

async function pruneUpdateBackups(
  instanceId: string,
  state: StoredUpdateState
): Promise<{ removed: number; bytes: number }> {
  const settings = getSettings()
  const limit = Math.max(
    1,
    Math.min(30, Math.round(settings.contentBackupLimit) || DEFAULT_UPDATE_BACKUP_KEEP)
  )
  const cutoff =
    settings.backupMaxAgeDays > 0
      ? Date.now() - Math.min(3650, settings.backupMaxAgeDays) * DAY_MS
      : null
  const sorted = [...state.updates].sort((left, right) => right.createdAt - left.createdAt)
  const keep: StoredUpdateRecord[] = []
  const remove: StoredUpdateRecord[] = []
  for (const [index, record] of sorted.entries()) {
    const tooOld = cutoff !== null && record.createdAt < cutoff
    if (index < limit && !tooOld) keep.push(record)
    else remove.push(record)
  }
  let bytes = 0
  for (const record of remove) {
    bytes += record.files.reduce((sum, file) => sum + Math.max(0, file.size), 0)
    await fs
      .rm(join(getInstanceDir(instanceId), record.backupDir), {
        recursive: true,
        force: true
      })
      .catch(() => undefined)
  }
  state.updates = keep
  return { removed: remove.length, bytes }
}

/** 按当前保留策略清理内容更新备份，保留 content-updates.json 中仍可用回滚的记录。 */
export async function pruneContentUpdateBackups(
  instanceId: string
): Promise<{ removed: number; bytes: number }> {
  const state = await loadUpdateState(instanceId)
  if (state.updates.length === 0) return { removed: 0, bytes: 0 }
  const result = await pruneUpdateBackups(instanceId, state)
  if (result.removed > 0) await saveUpdateState(instanceId, state)
  return result
}

/** 备份管理页删除内容更新备份后，同步移除对应的回滚记录。 */
export async function forgetContentUpdateBackups(
  instanceId: string,
  backupDirs: string[]
): Promise<number> {
  if (backupDirs.length === 0) return 0
  const targets = new Set(backupDirs)
  const state = await loadUpdateState(instanceId)
  const before = state.updates.length
  state.updates = state.updates.filter((record) => !targets.has(record.backupDir))
  const removed = before - state.updates.length
  if (removed > 0) await saveUpdateState(instanceId, state)
  return removed
}

export async function updateContent(
  instanceId: string,
  request: ContentUpdateRequest,
  onProgress?: UpdateProgressCallback
): Promise<ContentUpdateResult> {
  const instance = await getInstance(instanceId)
  const settings = getSettings()
  const gameDir = await getInstanceGameDir(instance.id)
  const progress = createUpdateProgress(instance.id, onProgress)
  progress.stage('prepare', '正在校验更新内容…', 2)
  let ledger = await loadLedger(instance.id)
  if (ledger.entries.length === 0) {
    await scanContentLedger(instance.id, false)
    ledger = await loadLedger(instance.id)
  }
  const entryMap = new Map(
    ledger.entries.map((entry) => [`${entry.kind}:${entry.file}`, entry])
  )
  const selected = new Map<string, StoredLedgerEntry>()
  for (const selection of Array.isArray(request.files) ? request.files : []) {
    if (
      !selection ||
      !KIND_ORDER.includes(selection.kind) ||
      typeof selection.file !== 'string'
    ) {
      continue
    }
    const entry = entryMap.get(`${selection.kind}:${selection.file}`)
    const updateAvailable =
      Boolean(
        entry &&
          entry.provider &&
          entry.projectId &&
          entry.latestVersionId &&
          entry.versionId &&
          entry.versionId !== entry.latestVersionId
      )
    if (!entry || !updateAvailable) continue
    selected.set(`${entry.kind}:${entry.file}`, entry)
  }
  const targets = [...selected.values()]
  if (targets.length === 0) {
    const updateState = await loadUpdateState(instance.id)
    return {
      ok: false,
      rolledBack: false,
      updated: [],
      addedFiles: [],
      manual: [],
      error: '没有可更新的内容，请先刷新账本',
      ledger: toView(instance.id, ledger, [], updateSummary(updateState))
    }
  }

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const backupDir = `backups/content/${id}`
  const backupRoot = join(getInstanceDir(instance.id), backupDir)
  const record: StoredUpdateRecord = {
    id,
    createdAt: Date.now(),
    backupDir,
    files: [],
    beforeFiles: (await listContentFiles(gameDir)).map((file) => file.file),
    beforeTemps: await listDownloadTemps(gameDir),
    addedFiles: [],
    changes: [],
    diagnosticsSnapshot: null,
    rolledBackAt: null,
    error: null
  }
  try {
    progress.plan(targets.length, 0)
    progress.stage('backup', `正在备份原文件（0/${targets.length}）…`, 4)
    let backedUp = 0
    for (const entry of targets) {
      const source = contentAbsolute(gameDir, entry.file)
      const stat = await fs.stat(source)
      const backupPath = join(backupRoot, entry.file)
      await fs.mkdir(dirname(backupPath), { recursive: true })
      await fs.copyFile(source, backupPath)
      backedUp += 1
      progress.stage(
        'backup',
        `正在备份原文件（${backedUp}/${targets.length}）…`,
        4 + (backedUp / targets.length) * 8
      )
      progress.file(entry.file, backedUp, targets.length)
      record.files.push({
        kind: entry.kind,
        file: entry.file,
        size: stat.size,
        mtime: stat.mtimeMs
      })
    }
    progress.stage('snapshot', '正在保存已知可运行快照…', 13)
    await markKnownGood(instance.id)
    record.diagnosticsSnapshot = await fs
      .readFile(join(getInstanceDir(instance.id), 'diagnostics.json'), 'utf8')
      .catch(() => null)
  } catch (error) {
    await fs.rm(backupRoot, { recursive: true, force: true }).catch(() => undefined)
    const updateState = await loadUpdateState(instance.id)
    return {
      ok: false,
      rolledBack: false,
      updated: [],
      addedFiles: [],
      manual: [],
      error: `更新前备份失败：${errorText(error)}`,
      ledger: toView(instance.id, ledger, [], updateSummary(updateState))
    }
  }

  const updateState = await loadUpdateState(instance.id)
  updateState.updates.push(record)
  await saveUpdateState(instance.id, updateState)

  const addedFiles = new Set<string>()
  const manual: ManualModDownload[] = []
  const changes: ContentUpdateChange[] = []
  try {
    const span = 72 / targets.length
    for (let index = 0; index < targets.length; index += 1) {
      const entry = targets[index]
      const base = 16 + index * span
      const title = entry.projectTitle ?? basename(entry.file)
      progress.reset()
      progress.stage('install', `正在解析 ${title} 的版本与前置…`, base)
      const oldPath = contentAbsolute(gameDir, entry.file)
      await fs.rm(oldPath, { force: true })
      const result = await installMod(
        {
          instanceId: instance.id,
          provider: entry.provider as ContentProvider,
          projectId: entry.projectId as string,
          title: entry.projectTitle ?? undefined,
          versionId: entry.latestVersionId,
          kind: entry.kind,
          includeDependencies: true
        },
        settings,
        {
          onPlan: ({ files, bytesTotal }) => {
            progress.plan(files, bytesTotal)
            progress.stage(
              'install',
              files > 0
                ? `正在下载 ${title} 与前置（${files} 个文件）…`
                : `正在安装 ${title}…`,
              base
            )
          },
          onFile: ({ file, index: fileIndex, total }) =>
            progress.file(file, fileIndex, total),
          onBytes: (delta) => progress.bytes(delta, base, span)
        }
      )
      for (const installed of result.installed) {
        addedFiles.add(`${KIND_DIR[entry.kind]}/${installed.file}`)
      }
      manual.push(...result.manual)

      if (!entry.enabled && result.installed.length > 0) {
        const target =
          result.installed.find((item) => item.file === entry.latestFileName) ??
          result.installed[0]
        try {
          await toggleMod(instance.id, target.file, false)
          addedFiles.add(`${KIND_DIR[entry.kind]}/${target.file}.disabled`)
        } catch {
          /* 保持启用，不阻断更新 */
        }
      }

      changes.push({
        kind: entry.kind,
        file: entry.file,
        title: entry.projectTitle ?? basename(entry.file),
        fromVersionId: entry.versionId,
        fromVersion: entry.versionNumber,
        toVersionId: entry.latestVersionId ?? '',
        toVersion: entry.latestVersionNumber,
        newFile: entry.latestFileName ?? result.installed[0]?.file ?? null,
        provider: entry.provider,
        projectId: entry.projectId
      })
      record.addedFiles = [...addedFiles]
      record.changes = changes
      await saveUpdateState(instance.id, updateState)
      progress.stage(
        'install',
        `已更新 ${title}（${index + 1}/${targets.length}）…`,
        16 + (index + 1) * span
      )
    }

    await pruneUpdateBackups(instance.id, updateState)
    await saveUpdateState(instance.id, updateState)
    progress.stage('refresh', '正在刷新账本…', 92)
    const view = await safeRefreshLedgerView(instance.id, updateState)
    progress.stage('done', '更新完成', 100)
    return {
      ok: true,
      rolledBack: false,
      updated: changes,
      addedFiles: [...addedFiles],
      manual,
      error: null,
      ledger: view
    }
  } catch (error) {
    const message = errorText(error)
    progress.stage('rollback', '更新失败，正在恢复原文件与快照…', 95)
    const restoreError = await restoreUpdateRecord(instance.id, record, true)
    record.addedFiles = [...addedFiles]
    record.changes = changes
    record.rolledBackAt = Date.now()
    record.error = restoreError ? `${message}；回滚失败：${restoreError}` : message
    await saveUpdateState(instance.id, updateState)
    const view = await safeRefreshLedgerView(instance.id, updateState)
    return {
      ok: false,
      rolledBack: !restoreError,
      updated: [],
      addedFiles: [...addedFiles],
      manual,
      error: record.error,
      ledger: view
    }
  }
}

export async function rollbackContentUpdate(
  instanceId: string,
  onProgress?: UpdateProgressCallback
): Promise<ContentRollbackResult> {
  const instance = await getInstance(instanceId)
  const progress = createUpdateProgress(instance.id, onProgress)
  progress.stage('rollback', '正在读取上次更新记录…', 5)
  const state = await loadUpdateState(instance.id)
  const record = [...state.updates]
    .sort((left, right) => right.createdAt - left.createdAt)
    .find((item) => !item.rolledBackAt)
  if (!record) {
    const ledger = await loadLedger(instance.id)
    return {
      ok: false,
      error: '没有可回滚的更新',
      ledger: toView(instance.id, ledger, [], null)
    }
  }
  progress.stage('rollback', '正在恢复原文件与已知可运行快照…', 35)
  const restoreError = await restoreUpdateRecord(instance.id, record)
  if (restoreError) {
    record.error = restoreError
    await saveUpdateState(instance.id, state)
    const ledger = await loadLedger(instance.id)
    return {
      ok: false,
      error: restoreError,
      ledger: toView(instance.id, ledger, [], updateSummary(state))
    }
  }
  record.rolledBackAt = Date.now()
  record.error = null
  await saveUpdateState(instance.id, state)
  progress.stage('rollback', '正在刷新账本…', 88)
  const view = await safeRefreshLedgerView(instance.id, state)
  progress.stage('done', '回滚完成', 100)
  return { ok: true, error: null, ledger: view }
}

export async function getContentChangelog(
  provider: ContentProvider,
  projectId: string,
  versionId: string
): Promise<ContentChangelogView> {
  if (provider === 'modrinth') {
    const version = await modrinthRequest<RawVersionDetail>(
      `${MODRINTH_BASE}/version/${encodeURIComponent(versionId)}`
    )
    const file = version.files?.[0]
    return {
      provider,
      projectId,
      versionId,
      versionNumber: (version.version_number ?? version.name ?? versionId).slice(0, 160),
      changelog: (version.changelog ?? '').slice(0, 20_000),
      datePublished: version.date_published ?? '',
      fileName: file?.filename ?? null,
      fileSize: typeof file?.size === 'number' ? file.size : null,
      url: `https://modrinth.com/project/${encodeURIComponent(projectId)}/version/${encodeURIComponent(versionId)}`
    }
  }
  const settings = getSettings()
  const changelog = await getCurseForgeFileChangelog(projectId, versionId, settings)
  return {
    provider,
    projectId,
    versionId,
    versionNumber: changelog.versionNumber || versionId,
    changelog: changelog.changelog.slice(0, 20_000),
    datePublished: changelog.datePublished,
    fileName: changelog.fileName,
    fileSize: changelog.fileSize,
    url: null
  }
}

/* ---------- 视图 ---------- */
function checkState(entry: StoredLedgerEntry): ContentLedgerCheckState {
  if (!entry.provider) return 'unchecked'
  if (entry.latestError) return 'error'
  if (!entry.latestCheckedAt) return 'unchecked'
  if (!entry.latestVersionId) return 'error'
  return entry.versionId && entry.versionId === entry.latestVersionId ? 'current' : 'update'
}

function toView(
  instanceId: string,
  ledger: StoredLedger,
  errors: string[],
  lastUpdate: ContentLedgerUpdateSummary | null
): ContentLedgerView {
  const entries: ContentLedgerEntryView[] = ledger.entries
    .map((entry) => {
      const state = checkState(entry)
      return {
        kind: entry.kind,
        file: entry.file,
        name: basename(entry.file),
        size: entry.size,
        enabled: entry.enabled,
        sha1: entry.sha1,
        provider: entry.provider,
        source: (entry.provider ?? 'local') as ContentLedgerSource,
        projectId: entry.projectId,
        projectTitle: entry.projectTitle,
        slug: entry.slug,
        versionId: entry.versionId,
        versionNumber: entry.versionNumber,
        latestVersionId: entry.latestVersionId,
        latestVersionNumber: entry.latestVersionNumber,
        latestFileName: entry.latestFileName,
        latestFileSize: entry.latestFileSize,
        updateAvailable: state === 'update',
        checkState: state,
        checkMessage: entry.latestError,
        latestCheckedAt: entry.latestCheckedAt
      }
    })
    .sort((left, right) => {
      const kind = KIND_ORDER.indexOf(left.kind) - KIND_ORDER.indexOf(right.kind)
      if (kind !== 0) return kind
      if (left.updateAvailable !== right.updateAvailable) return left.updateAvailable ? -1 : 1
      const identified = Number(Boolean(right.provider)) - Number(Boolean(left.provider))
      if (identified !== 0) return identified
      return (left.projectTitle ?? left.name).localeCompare(right.projectTitle ?? right.name)
    })

  const summary: ContentLedgerKindSummary[] = KIND_ORDER.map((kind) => {
    const list = entries.filter((entry) => entry.kind === kind)
    return {
      kind,
      total: list.length,
      identified: list.filter((entry) => Boolean(entry.provider)).length,
      updates: list.filter((entry) => entry.updateAvailable).length
    }
  })

  return {
    instanceId,
    scannedAt: ledger.scannedAt,
    checkedAt: ledger.checkedAt,
    entries,
    summary,
    lastUpdate,
    errors
  }
}