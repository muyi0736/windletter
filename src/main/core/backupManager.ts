import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type {
  BackupCleanupRequest,
  BackupCleanupResult,
  BackupInstanceUsage,
  BackupKind,
  BackupKindUsage,
  BackupOverview,
  InstanceSummary
} from '../../shared/types'
import { getSettings } from './config'
import { forgetContentUpdateBackups } from './contentLedger'
import { getInstance, getInstanceDir, getInstanceMinecraftDir, listInstances } from './instances'
import { listKubeJsHistory, pruneKubeJsHistory } from './packWorkshop'
import {
  deleteWorldBackup,
  listAllWorldBackups,
  pruneWorldBackupsForInstance,
  type WorldVaultContext
} from './worldVault'

const DAY_MS = 24 * 60 * 60 * 1000
const KINDS: BackupKind[] = ['worlds', 'kubejs', 'content']
const KUBEJS_STAMP = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}-[0-9a-z]+$/
const CONTENT_STAMP = /^(\d{10,16})-[0-9a-z]+$/i
const SAFE_DIR = /^[A-Za-z0-9._-]{1,120}$/
const MAX_SCAN_FILES = 200_000

function kindUsage(kind: BackupKind): BackupKindUsage {
  return { kind, count: 0, bytes: 0, oldestAt: null, newestAt: null }
}

function addUsage(
  usage: BackupKindUsage,
  count: number,
  bytes: number,
  at: number | null
): void {
  if (count <= 0 && bytes <= 0) return
  usage.count += Math.max(0, count)
  usage.bytes += Math.max(0, bytes)
  if (at !== null && Number.isFinite(at) && at > 0) {
    usage.oldestAt = usage.oldestAt === null ? at : Math.min(usage.oldestAt, at)
    usage.newestAt = usage.newestAt === null ? at : Math.max(usage.newestAt, at)
  }
}

function sumUsage(usage: BackupKindUsage[]): number {
  return usage.reduce((sum, item) => sum + item.bytes, 0)
}

function countUsage(usage: BackupKindUsage[]): number {
  return usage.reduce((sum, item) => sum + item.count, 0)
}

async function dirStats(root: string): Promise<{ bytes: number; files: number }> {
  let bytes = 0
  let files = 0
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 24 || files >= MAX_SCAN_FILES) return
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (files >= MAX_SCAN_FILES) return
      const path = join(dir, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        await walk(path, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      try {
        const stat = await fs.stat(path)
        bytes += stat.size
        files += 1
      } catch {
        /* 文件在扫描过程中消失 */
      }
    }
  }
  await walk(root, 0)
  return { bytes, files }
}

async function listChildDirs(root: string): Promise<string[]> {
  try {
    return (await fs.readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && SAFE_DIR.test(entry.name))
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

function parseKubeJsStamp(stamp: string): number | null {
  const match = stamp.match(
    /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})-(\d{3})/
  )
  if (!match) return null
  const value = Date.parse(
    `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.${match[7]}Z`
  )
  return Number.isFinite(value) ? value : null
}

function parseContentStamp(name: string): number | null {
  const match = name.match(CONTENT_STAMP)
  if (!match) return null
  const value = Number(match[1])
  return Number.isFinite(value) && value > 0 ? value : null
}

function backupContext(instance: InstanceSummary): WorldVaultContext {
  const settings = getSettings()
  return {
    instance,
    instanceDir: getInstanceDir(instance.id),
    gameDir: instance.external?.gameDir ?? getInstanceMinecraftDir(instance.id),
    limit: settings.worldBackupLimit,
    maxAgeDays: settings.backupMaxAgeDays
  }
}

async function worldUsage(instance: InstanceSummary): Promise<BackupKindUsage> {
  const usage = kindUsage('worlds')
  const backups = await listAllWorldBackups(backupContext(instance))
  for (const backup of backups) {
    addUsage(usage, 1, backup.bytes, backup.createdAt)
  }
  return usage
}

async function kubeJsUsage(instance: InstanceSummary): Promise<BackupKindUsage> {
  const usage = kindUsage('kubejs')
  const entries = await listKubeJsHistory(instance.id, 200_000)
  const stamps = new Map<string, { bytes: number; at: number | null }>()
  for (const entry of entries) {
    const group = stamps.get(entry.stamp) ?? {
      bytes: 0,
      at: parseKubeJsStamp(entry.stamp) ?? entry.modified
    }
    group.bytes += entry.size
    if (group.at === null && entry.modified > 0) group.at = entry.modified
    stamps.set(entry.stamp, group)
  }
  for (const group of stamps.values()) addUsage(usage, 1, group.bytes, group.at)
  return usage
}

async function contentUsage(instance: InstanceSummary): Promise<BackupKindUsage> {
  const usage = kindUsage('content')
  const root = join(getInstanceDir(instance.id), 'backups', 'content')
  for (const name of await listChildDirs(root)) {
    const dir = join(root, name)
    const stats = await dirStats(dir)
    let at = parseContentStamp(name)
    if (at === null) {
      try {
        at = (await fs.stat(dir)).mtimeMs
      } catch {
        at = null
      }
    }
    addUsage(usage, 1, stats.bytes, at)
  }
  return usage
}

async function otherUsage(instance: InstanceSummary): Promise<number> {
  const root = join(getInstanceDir(instance.id), 'backups')
  let bytes = 0
  let entries
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    if (entry.name === 'worlds' || entry.name === 'kubejs' || entry.name === 'content') continue
    if (entry.isSymbolicLink()) continue
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      bytes += (await dirStats(path)).bytes
    } else if (entry.isFile()) {
      bytes += await fs.stat(path).then((stat) => stat.size).catch(() => 0)
    }
  }
  return bytes
}

export async function getBackupOverview(): Promise<BackupOverview> {
  const instances = await listInstances()
  const totals = new Map<BackupKind, BackupKindUsage>(
    KINDS.map((kind) => [kind, kindUsage(kind)])
  )
  const rows: BackupInstanceUsage[] = []
  let otherBytes = 0
  for (const instance of instances) {
    const [worlds, kubejs, content, other] = await Promise.all([
      worldUsage(instance),
      kubeJsUsage(instance),
      contentUsage(instance),
      otherUsage(instance)
    ])
    otherBytes += other
    const kinds = [worlds, kubejs, content]
    for (const item of kinds) {
      const total = totals.get(item.kind)
      if (!total) continue
      total.count += item.count
      total.bytes += item.bytes
      if (item.oldestAt !== null) {
        total.oldestAt =
          total.oldestAt === null ? item.oldestAt : Math.min(total.oldestAt, item.oldestAt)
      }
      if (item.newestAt !== null) {
        total.newestAt =
          total.newestAt === null ? item.newestAt : Math.max(total.newestAt, item.newestAt)
      }
    }
    const totalBytes = sumUsage(kinds)
    if (totalBytes > 0 || countUsage(kinds) > 0) {
      rows.push({
        instanceId: instance.id,
        instanceName: instance.name,
        gameVersion: instance.gameVersion,
        totalBytes,
        totalCount: countUsage(kinds),
        otherBytes: other,
        kinds
      })
    }
  }
  rows.sort(
    (left, right) =>
      right.totalBytes - left.totalBytes ||
      left.instanceName.localeCompare(right.instanceName, 'zh-CN')
  )
  const kinds = KINDS.map((kind) => totals.get(kind) ?? kindUsage(kind))
  const knownBytes = kinds.reduce((sum, item) => sum + item.bytes, 0)
  const totalCount = kinds.reduce((sum, item) => sum + item.count, 0)
  return {
    totalBytes: knownBytes + otherBytes,
    totalCount,
    otherBytes,
    kinds,
    instances: rows,
    scannedAt: Date.now()
  }
}

function normalizeKinds(raw: unknown): BackupKind[] {
  if (!Array.isArray(raw)) throw new Error('请选择备份类型')
  const kinds = KINDS.filter((kind) => raw.includes(kind))
  if (kinds.length === 0) throw new Error('请选择至少一种备份类型')
  return kinds
}

async function selectedInstances(request: BackupCleanupRequest): Promise<InstanceSummary[]> {
  if (typeof request.instanceId === 'string' && request.instanceId.trim()) {
    return [await getInstance(request.instanceId)]
  }
  return listInstances()
}

function shouldRemove(at: number | null, mode: 'older-than' | 'all', cutoff: number | null): boolean {
  if (mode === 'all') return true
  if (cutoff === null) return false
  return at !== null && at < cutoff
}

async function contentBackupEntries(
  instance: InstanceSummary
): Promise<{ name: string; at: number | null; bytes: number }[]> {
  const root = join(getInstanceDir(instance.id), 'backups', 'content')
  const entries: { name: string; at: number | null; bytes: number }[] = []
  for (const name of await listChildDirs(root)) {
    const dir = join(root, name)
    let at = parseContentStamp(name)
    if (at === null) {
      at = await fs.stat(dir).then((stat) => stat.mtimeMs).catch(() => null)
    }
    entries.push({ name, at, bytes: (await dirStats(dir)).bytes })
  }
  entries.sort((left, right) => (right.at ?? 0) - (left.at ?? 0))
  return entries
}

async function cleanupContentManual(
  instance: InstanceSummary,
  mode: 'older-than' | 'all',
  cutoff: number | null
): Promise<{ removed: number; bytes: number; skipped: number }> {
  const root = join(getInstanceDir(instance.id), 'backups', 'content')
  let removed = 0
  let bytes = 0
  let skipped = 0
  const removedDirs: string[] = []
  for (const entry of await contentBackupEntries(instance)) {
    if (!shouldRemove(entry.at, mode, cutoff)) continue
    try {
      await fs.rm(join(root, entry.name), { recursive: true, force: true })
      removed += 1
      bytes += entry.bytes
      removedDirs.push(`backups/content/${entry.name}`)
    } catch {
      skipped += 1
    }
  }
  if (removedDirs.length > 0) {
    await forgetContentUpdateBackups(instance.id, removedDirs).catch(() => undefined)
  }
  return { removed, bytes, skipped }
}

async function cleanupContentPolicy(
  instance: InstanceSummary
): Promise<{ removed: number; bytes: number }> {
  const settings = getSettings()
  const limit = Math.max(1, Math.min(30, Math.round(settings.contentBackupLimit) || 6))
  const cutoff =
    settings.backupMaxAgeDays > 0
      ? Date.now() - Math.min(3650, settings.backupMaxAgeDays) * DAY_MS
      : null
  const root = join(getInstanceDir(instance.id), 'backups', 'content')
  let removed = 0
  let bytes = 0
  const removedDirs: string[] = []
  for (const [index, entry] of (await contentBackupEntries(instance)).entries()) {
    const tooOld = cutoff !== null && entry.at !== null && entry.at < cutoff
    if (index < limit && !tooOld) continue
    try {
      await fs.rm(join(root, entry.name), { recursive: true, force: true })
      removed += 1
      bytes += entry.bytes
      removedDirs.push(`backups/content/${entry.name}`)
    } catch {
      /* 单个备份删除失败不影响其它备份 */
    }
  }
  if (removedDirs.length > 0) {
    await forgetContentUpdateBackups(instance.id, removedDirs).catch(() => undefined)
  }
  return { removed, bytes }
}

async function cleanupManual(
  instances: InstanceSummary[],
  kinds: BackupKind[],
  mode: 'older-than' | 'all',
  days: number
): Promise<BackupCleanupResult> {
  const cutoff =
    mode === 'older-than' ? Date.now() - Math.max(1, Math.min(3650, days)) * DAY_MS : null
  let removed = 0
  let bytes = 0
  let skipped = 0
  let touchedInstances = 0
  for (const instance of instances) {
    let instanceRemoved = 0
    if (kinds.includes('worlds')) {
      const context = backupContext(instance)
      for (const backup of await listAllWorldBackups(context)) {
        if (!shouldRemove(backup.createdAt, mode, cutoff)) continue
        try {
          await deleteWorldBackup(context, backup.folder, backup.id)
          instanceRemoved += 1
          bytes += backup.bytes
        } catch {
          skipped += 1
        }
      }
    }
    if (kinds.includes('kubejs')) {
      const root = join(getInstanceDir(instance.id), 'backups', 'kubejs')
      for (const name of await listChildDirs(root)) {
        if (!KUBEJS_STAMP.test(name)) continue
        const dir = join(root, name)
        let at = parseKubeJsStamp(name)
        if (at === null) {
          at = await fs.stat(dir).then((stat) => stat.mtimeMs).catch(() => null)
        }
        if (!shouldRemove(at, mode, cutoff)) continue
        const stats = await dirStats(dir)
        try {
          await fs.rm(dir, { recursive: true, force: true })
          instanceRemoved += 1
          bytes += stats.bytes
        } catch {
          skipped += 1
        }
      }
    }
    if (kinds.includes('content')) {
      const result = await cleanupContentManual(instance, mode, cutoff)
      instanceRemoved += result.removed
      bytes += result.bytes
      skipped += result.skipped
    }
    removed += instanceRemoved
    if (instanceRemoved > 0) touchedInstances += 1
  }
  return { removed, bytes, instances: touchedInstances, skipped }
}

async function cleanupPolicy(
  instances: InstanceSummary[],
  kinds: BackupKind[]
): Promise<BackupCleanupResult> {
  const settings = getSettings()
  let removed = 0
  let bytes = 0
  let touchedInstances = 0
  for (const instance of instances) {
    let instanceRemoved = 0
    if (kinds.includes('worlds')) {
      const result = await pruneWorldBackupsForInstance(backupContext(instance))
      instanceRemoved += result.removed
      bytes += result.bytes
    }
    if (kinds.includes('kubejs')) {
      const result = await pruneKubeJsHistory(
        instance.id,
        settings.kubeJsBackupLimit,
        settings.backupMaxAgeDays
      )
      instanceRemoved += result.removed
      bytes += result.bytes
    }
    if (kinds.includes('content')) {
      const result = await cleanupContentPolicy(instance)
      instanceRemoved += result.removed
      bytes += result.bytes
    }
    removed += instanceRemoved
    if (instanceRemoved > 0) touchedInstances += 1
  }
  return { removed, bytes, instances: touchedInstances, skipped: 0 }
}

export async function cleanupBackups(raw: BackupCleanupRequest): Promise<BackupCleanupResult> {
  const request = raw && typeof raw === 'object' ? raw : ({} as BackupCleanupRequest)
  const kinds = normalizeKinds(request.kinds)
  const mode = request.mode
  if (mode !== 'policy' && mode !== 'older-than' && mode !== 'all') {
    throw new Error('无效的清理方式')
  }
  const instances = await selectedInstances(request)
  if (instances.length === 0) return { removed: 0, bytes: 0, instances: 0, skipped: 0 }
  if (mode === 'policy') return cleanupPolicy(instances, kinds)
  const days =
    mode === 'older-than'
      ? Math.max(1, Math.min(3650, Math.round(Number(request.days) || 30)))
      : 30
  return cleanupManual(instances, kinds, mode, days)
}
