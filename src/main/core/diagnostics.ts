import AdmZip from 'adm-zip'
import { createHash } from 'node:crypto'
import { constants as fsConstants, promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import os from 'node:os'
import type {
  CrashReportView,
  DiagnosticIssue,
  DiagnosticReport,
  InstanceLoader,
  InstanceSummary,
  JavaInfo,
  KnownGoodSnapshot,
  ModFingerprintDiff
} from '../../shared/types'
import { getSettings } from './config'
import { getInstance, getInstanceDir, getInstanceGameDir } from './instances'
import { detectJava } from './java'
import { resolveVersion, type ResolvedVersion } from './version'

const BUILTIN_MOD_IDS = new Set([
  'minecraft',
  'fabricloader',
  'fabric-loader',
  'quilt_loader',
  'quilt-loader',
  'forge',
  'neoforge',
  'java',
  'javafml',
  'fml',
  'mixinextras'
])

interface ModDependency {
  id: string
  range: string | null
  side: 'client' | 'server' | 'both'
}

interface ScannedMod {
  file: string
  enabled: boolean
  id: string
  name: string
  version: string
  environment: 'client' | 'server' | 'both'
  requires: ModDependency[]
  loader: 'fabric' | 'quilt' | 'forge' | 'unknown'
}

interface ModScan {
  mods: ScannedMod[]
  issues: DiagnosticIssue[]
}

interface ModSnapshot {
  file: string
  size: number
  enabled: boolean
}

interface StoredKnownGood {
  fingerprint: string
  recordedAt: number
  mods: ModSnapshot[]
  gameVersion: string
  loader: InstanceLoader
  loaderVersion: string | null
  javaMajor: number | null
  memoryMb: number
}

interface StoredDiagnosticState {
  version: 1
  knownGood: StoredKnownGood | null
  ignored: { issueId: string; fingerprint: string; recordedAt: number }[]
}

interface CrashRead {
  file: string
  createdAt: number
  text: string
}

function statePath(instanceId: string): string {
  return join(getInstanceDir(instanceId), 'diagnostics.json')
}

async function loadDiagnosticState(instanceId: string): Promise<StoredDiagnosticState> {
  try {
    const raw = JSON.parse(await fs.readFile(statePath(instanceId), 'utf8')) as Partial<StoredDiagnosticState>
    const known = raw.knownGood
    const knownGood: StoredKnownGood | null =
      known &&
      typeof known === 'object' &&
      typeof known.fingerprint === 'string' &&
      typeof known.recordedAt === 'number' &&
      Array.isArray(known.mods) &&
      typeof known.gameVersion === 'string' &&
      typeof known.loader === 'string'
        ? {
            fingerprint: known.fingerprint,
            recordedAt: known.recordedAt,
            mods: known.mods
              .filter(
                (entry): entry is ModSnapshot =>
                  Boolean(entry) &&
                  typeof entry.file === 'string' &&
                  typeof entry.size === 'number' &&
                  typeof entry.enabled === 'boolean'
              )
              .map((entry) => ({ file: entry.file, size: entry.size, enabled: entry.enabled })),
            gameVersion: known.gameVersion,
            loader: known.loader as InstanceLoader,
            loaderVersion:
              typeof known.loaderVersion === 'string' ? known.loaderVersion : null,
            javaMajor: typeof known.javaMajor === 'number' ? known.javaMajor : null,
            memoryMb: typeof known.memoryMb === 'number' ? known.memoryMb : 0
          }
        : null
    const ignored = Array.isArray(raw.ignored)
      ? raw.ignored
          .filter(
            (entry): entry is { issueId: string; fingerprint: string; recordedAt: number } =>
              Boolean(entry) &&
              typeof entry.issueId === 'string' &&
              typeof entry.fingerprint === 'string' &&
              typeof entry.recordedAt === 'number'
          )
          .slice(-60)
      : []
    return { version: 1, knownGood, ignored }
  } catch {
    return { version: 1, knownGood: null, ignored: [] }
  }
}

async function saveDiagnosticState(instanceId: string, state: StoredDiagnosticState): Promise<void> {
  const path = statePath(instanceId)
  await fs.mkdir(getInstanceDir(instanceId), { recursive: true })
  const tmp = `${path}.tmp`
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), 'utf8')
  await fs.rename(tmp, path)
}

async function collectModSnapshot(gameDir: string): Promise<ModSnapshot[]> {
  const dir = join(gameDir, 'mods')
  let entries: string[]
  try {
    entries = await fs.readdir(dir)
  } catch {
    return []
  }
  const snapshot: ModSnapshot[] = []
  for (const file of entries) {
    const lower = file.toLowerCase()
    const enabled = lower.endsWith('.jar')
    const disabled = lower.endsWith('.jar.disabled')
    if (!enabled && !disabled) continue
    try {
      const stat = await fs.stat(join(dir, file))
      if (!stat.isFile()) continue
      snapshot.push({ file, size: stat.size, enabled })
    } catch {
      /* ignore */
    }
  }
  snapshot.sort((left, right) => left.file.localeCompare(right.file))
  return snapshot
}

function buildFingerprint(
  instance: InstanceSummary,
  settings: ReturnType<typeof getSettings>,
  snapshot: ModSnapshot[]
): string {
  const memory = instance.memoryMb ?? settings.maxMemoryMb
  const args = [settings.extraJvmArgs, instance.extraJvmArgs ?? '']
    .filter((value) => value.trim())
    .join(' ')
  const lines = [
    `version:${instance.versionId}`,
    `game:${instance.gameVersion}`,
    `loader:${instance.loader}`,
    `loaderVersion:${instance.loaderVersion ?? ''}`,
    `java:${instance.javaMajor ?? ''}`,
    `memory:${memory}`,
    `args:${args}`,
    ...snapshot.map((mod) => `mod:${mod.file}:${mod.size}:${mod.enabled ? 1 : 0}`)
  ]
  return createHash('sha1').update(lines.join('\n')).digest('hex')
}

function diffSnapshots(previous: ModSnapshot[], current: ModSnapshot[]): ModFingerprintDiff {
  const previousMap = new Map(previous.map((mod) => [mod.file, mod]))
  const currentMap = new Map(current.map((mod) => [mod.file, mod]))
  const added = current.filter((mod) => !previousMap.has(mod.file)).map((mod) => mod.file)
  const removed = previous.filter((mod) => !currentMap.has(mod.file)).map((mod) => mod.file)
  const changed = current
    .filter((mod) => {
      const old = previousMap.get(mod.file)
      return Boolean(old && (old.size !== mod.size || old.enabled !== mod.enabled))
    })
    .map((mod) => mod.file)
  return {
    added: added.slice(0, 60),
    removed: removed.slice(0, 60),
    changed: changed.slice(0, 60)
  }
}

function knownGoodView(record: StoredKnownGood | null): KnownGoodSnapshot | null {
  if (!record) return null
  return {
    fingerprint: record.fingerprint,
    recordedAt: record.recordedAt,
    modCount: record.mods.length,
    gameVersion: record.gameVersion,
    loader: record.loader,
    javaMajor: record.javaMajor,
    memoryMb: record.memoryMb
  }
}

export async function markKnownGood(instanceId: string): Promise<KnownGoodSnapshot> {
  const instance = await getInstance(instanceId)
  const settings = getSettings()
  const gameDir = await getInstanceGameDir(instance.id)
  const snapshot = await collectModSnapshot(gameDir)
  const fingerprint = buildFingerprint(instance, settings, snapshot)
  const state = await loadDiagnosticState(instance.id)
  const unchanged = state.knownGood?.fingerprint === fingerprint
  state.knownGood = {
    fingerprint,
    recordedAt: Date.now(),
    mods: snapshot,
    gameVersion: instance.gameVersion,
    loader: instance.loader,
    loaderVersion: instance.loaderVersion,
    javaMajor: instance.javaMajor,
    memoryMb: instance.memoryMb ?? settings.maxMemoryMb
  }
  if (!unchanged) state.ignored = []
  await saveDiagnosticState(instance.id, state)
  return knownGoodView(state.knownGood) as KnownGoodSnapshot
}

export async function ignoreIssue(instanceId: string, issueId: string): Promise<void> {
  if (typeof issueId !== 'string' || !/^[A-Za-z0-9_.:-]{1,160}$/.test(issueId)) {
    throw new Error('无效的问题标识')
  }
  const instance = await getInstance(instanceId)
  const settings = getSettings()
  const gameDir = await getInstanceGameDir(instance.id)
  const snapshot = await collectModSnapshot(gameDir)
  const fingerprint = buildFingerprint(instance, settings, snapshot)
  const state = await loadDiagnosticState(instance.id)
  if (!state.ignored.some((entry) => entry.issueId === issueId && entry.fingerprint === fingerprint)) {
    state.ignored.push({ issueId, fingerprint, recordedAt: Date.now() })
    state.ignored = state.ignored.slice(-60)
    await saveDiagnosticState(instance.id, state)
  }
}

export async function clearIgnored(instanceId: string): Promise<void> {
  const instance = await getInstance(instanceId)
  const state = await loadDiagnosticState(instance.id)
  if (state.ignored.length === 0) return
  state.ignored = []
  await saveDiagnosticState(instance.id, state)
}

export async function runDiagnostics(instanceId: string): Promise<DiagnosticReport> {
  const instance = await getInstance(instanceId)
  const settings = getSettings()
  const gameDir = await getInstanceGameDir(instance.id)
  const baseDir = instance.external?.baseDir ?? instance.baseDir ?? settings.gameDir
  const diagnosticState = await loadDiagnosticState(instance.id)
  const modSnapshot = await collectModSnapshot(gameDir)
  const fingerprint = buildFingerprint(instance, settings, modSnapshot)
  const knownGoodMatch = Boolean(
    diagnosticState.knownGood && diagnosticState.knownGood.fingerprint === fingerprint
  )
  const changes =
    diagnosticState.knownGood && !knownGoodMatch
      ? diffSnapshots(diagnosticState.knownGood.mods, modSnapshot)
      : null

  let resolved: ResolvedVersion | null = null
  const issues: DiagnosticIssue[] = []

  try {
    resolved = await resolveVersion(baseDir, instance.versionId)
  } catch (error) {
    issues.push(
      issue(
        'files-version',
        'files',
        'error',
        '版本文件缺失或损坏',
        `${error instanceof Error ? error.message : '无法读取版本配置'}。请尝试在实例管理里执行「补全文件」，或重新安装该实例。`,
        []
      )
    )
  }

  const scan = await scanMods(gameDir)
  issues.push(...scan.issues)
  const enabledMods = scan.mods.filter((mod) => mod.enabled)

  await checkJava(instance, baseDir, settings, resolved, enabledMods, issues)
  checkMemory(instance, settings, enabledMods.length, issues)
  await checkGameFiles(instance, gameDir, baseDir, resolved, issues)
  checkModConflicts(scan.mods, issues)

  const crash = await analyzeLatestCrash(gameDir, scan.mods)
  const adjustedIssues = issues.map((item): DiagnosticIssue => {
    if (!knownGoodMatch || item.category !== 'mods') return item
    return {
      ...item,
      severity: 'info',
      detail: `${item.detail}

上次成功启动时也是同一组模组，加载器已经容忍了这条规则；当前只作为提示保留。`
    }
  })
  const ignoredIds = new Set(
    diagnosticState.ignored
      .filter((entry) => entry.fingerprint === fingerprint)
      .map((entry) => entry.issueId)
  )
  const visibleIssues = adjustedIssues
    .filter((item) => !ignoredIds.has(item.id))
    .sort((left, right) => severityRank(right.severity) - severityRank(left.severity))
  const ignoredCount = adjustedIssues.length - visibleIssues.length
  const allIssues = [...visibleIssues, ...(crash?.issues ?? [])]
  allIssues.sort((left, right) => severityRank(right.severity) - severityRank(left.severity))

  return {
    instanceId: instance.id,
    instanceName: instance.name,
    checkedAt: Date.now(),
    status: allIssues.some((item) => item.severity === 'error')
      ? 'error'
      : allIssues.some((item) => item.severity === 'warning')
        ? 'warning'
        : 'healthy',
    fingerprint,
    knownGood: knownGoodView(diagnosticState.knownGood),
    knownGoodMatch,
    changes,
    ignoredCount,
    issues: visibleIssues,
    crash
  }
}

function issue(
  id: string,
  category: DiagnosticIssue['category'],
  severity: DiagnosticIssue['severity'],
  title: string,
  detail: string,
  evidence: string[] = [],
  modFiles: string[] = []
): DiagnosticIssue {
  return { id, category, severity, title, detail, evidence, modFiles }
}

function severityRank(severity: DiagnosticIssue['severity']): number {
  return severity === 'error' ? 3 : severity === 'warning' ? 2 : 1
}

function highestModJavaRequirement(
  mods: ScannedMod[]
): { major: number; mod: ScannedMod } | null {
  let best: { major: number; mod: ScannedMod } | null = null
  for (const mod of mods) {
    if (!mod.enabled || mod.environment === 'server') continue
    for (const dependency of mod.requires) {
      if (dependency.id !== 'java' || !dependency.range) continue
      const match =
        dependency.range.match(/>=\s*(\d+)/) ?? dependency.range.match(/(\d+)/)
      if (!match) continue
      const major = Number(match[1])
      if (!Number.isFinite(major) || major <= 0) continue
      if (!best || major > best.major) best = { major, mod }
    }
  }
  return best
}

async function checkJava(
  instance: InstanceSummary,
  baseDir: string,
  settings: ReturnType<typeof getSettings>,
  resolved: ResolvedVersion | null,
  mods: ScannedMod[],
  issues: DiagnosticIssue[]
): Promise<void> {
  const required =
    instance.javaMajor ?? resolved?.json.javaVersion?.majorVersion ?? null
  if (!required) return
  const modJava = highestModJavaRequirement(mods)

  let javas: JavaInfo[] = []
  try {
    javas = await detectJava(baseDir, instance.javaPath ?? settings.javaPath)
  } catch {
    javas = []
  }

  if (instance.javaPath) {
    try {
      await fs.access(instance.javaPath, fsConstants.X_OK)
    } catch {
      issues.push(
        issue(
          'java-path-missing',
          'java',
          'error',
          '指定的 Java 路径不存在',
          `${instance.javaPath} 无法访问。实例会按自动检测结果或启动前弹窗重新选择 Java。`
        )
      )
      return
    }
  }

  if (modJava && modJava.major > required) {
    const selected = instance.javaPath
      ? javas.find((java) => java.path === instance.javaPath)
      : null
    if (!selected || selected.major < modJava.major) {
      const available = [
        ...new Set(javas.filter((java) => java.major >= modJava.major).map((java) => java.major))
      ].sort((left, right) => left - right)
      const guidance =
        available.length > 0
          ? `本机已检测到 Java ${available.join(' / ')}，请在实例启动设置里指定它。`
          : `本机没有检测到 Java ${modJava.major}，请先在设置里检测或下载对应运行时，再在实例启动设置里指定。`
      const selectedText = selected
        ? `实例当前指定的是 Java ${selected.major}`
        : instance.javaPath
          ? '实例指定的 Java 无法确认主版本'
          : ''
      issues.push(
        issue(
          'java-mod-requirement',
          'java',
          'error',
          `模组要求 Java ${modJava.major}`,
          `${modJava.mod.name || modJava.mod.file} 声明需要 Java ${modJava.major} 及以上，但 Minecraft ${instance.gameVersion} 默认使用 Java ${required}${selectedText ? `，${selectedText}` : ''}。${guidance}否则 Fabric/Forge 会在加载阶段以“模组不兼容”退出。`,
          [],
          [modJava.mod.file]
        )
      )
    }
  }

  const strict =
    instance.loader === 'forge' || instance.loader === 'neoforge'
  const matching = javas.filter((java) =>
    strict ? java.major === required : java.major >= required
  )
  if (matching.length > 0) {
    const preferred = instance.javaPath
      ? javas.find((java) => java.path === instance.javaPath)
      : null
    if (instance.javaPath && preferred && !matching.some((java) => java.path === preferred.path)) {
      issues.push(
        issue(
          'java-preferred-mismatch',
          'java',
          'warning',
          '实例指定的 Java 与版本不匹配',
          `实例指定 Java ${preferred.major}，但 Minecraft ${instance.gameVersion} 需要 Java ${required}。启动时会自动改用兼容运行时。`
        )
      )
    }
    return
  }

  if (settings.autoJava) {
    issues.push(
      issue(
        'java-missing-auto',
        'java',
        'warning',
        `未找到 Java ${required}`,
        `启动时会从 ${settings.source === 'mirror' ? 'BMCLAPI' : 'Mojang'} 自动准备对应运行时；如果准备失败，游戏会无法启动。`
      )
    )
  } else {
    issues.push(
      issue(
        'java-missing',
        'java',
        'error',
        `缺少 Java ${required}`,
        '自动准备 Java 已关闭，请在设置或实例启动设置里指定一个兼容的 java.exe。'
      )
    )
  }
}

function checkMemory(
  instance: InstanceSummary,
  settings: ReturnType<typeof getSettings>,
  modCount: number,
  issues: DiagnosticIssue[]
): void {
  const allocated = instance.memoryMb ?? settings.maxMemoryMb
  const totalMb = Math.round(os.totalmem() / 1024 / 1024)
  const recommendedMin = modCount > 120 ? 6144 : modCount > 40 ? 4096 : 2048

  if (allocated > totalMb * 0.8) {
    issues.push(
      issue(
        'memory-too-high',
        'memory',
        'error',
        '内存分配超过系统可用范围',
        `实例分配 ${allocated} MB，系统总计约 ${totalMb} MB。给系统留出至少 20% 内存，否则启动器、驱动和游戏都可能被系统终止。`,
        [],
        []
      )
    )
    return
  }
  if (allocated > totalMb * 0.6) {
    issues.push(
      issue(
        'memory-high',
        'memory',
        'warning',
        '内存分配偏高',
        `实例分配 ${allocated} MB，系统总计约 ${totalMb} MB。大型整合包之外建议控制在 ${Math.floor(totalMb * 0.6)} MB 以内。`
      )
    )
  }
  if (allocated < 1024) {
    issues.push(
      issue(
        'memory-too-low',
        'memory',
        'error',
        '内存分配过低',
        `实例只分配了 ${allocated} MB，Minecraft 可能无法启动。建议至少 2048 MB。`
      )
    )
  } else if (allocated < recommendedMin && modCount > 0) {
    issues.push(
      issue(
        'memory-low',
        'memory',
        'warning',
        '内存分配可能偏低',
        `当前实例有 ${modCount} 个启用模组，分配 ${allocated} MB；这个规模建议至少 ${recommendedMin} MB。`
      )
    )
  }
}

async function checkGameFiles(
  instance: InstanceSummary,
  gameDir: string,
  baseDir: string,
  resolved: ResolvedVersion | null,
  issues: DiagnosticIssue[]
): Promise<void> {
  try {
    await fs.access(gameDir, fsConstants.W_OK)
  } catch {
    issues.push(
      issue(
        'game-dir-readonly',
        'files',
        'warning',
        '游戏目录不可写',
        `${gameDir} 当前不可写。游戏无法保存设置、存档或日志，请检查目录权限。`
      )
    )
  }

  if (!resolved) return

  const versionDir = join(baseDir, 'versions', resolved.jarId)
  const clientJar = join(versionDir, `${resolved.jarId}.jar`)
  if (!(await exists(clientJar))) {
    issues.push(
      issue(
        'files-client-jar',
        'files',
        'error',
        '客户端 jar 缺失',
        '游戏核心文件不完整。请在实例管理里执行「补全文件」后再启动。'
      )
    )
  }

  const librariesDir = join(baseDir, 'libraries')
  if (!(await exists(librariesDir))) {
    issues.push(
      issue(
        'files-libraries',
        'files',
        'warning',
        '运行库目录缺失',
        '没有找到 libraries 目录，启动时可能无法加载 Forge/NeoForge/Fabric 依赖。'
      )
    )
  }

  const assetIndex = resolved.json.assetIndex?.id ?? resolved.json.assets
  if (assetIndex) {
    const indexPath = join(baseDir, 'assets', 'indexes', `${assetIndex}.json`)
    if (!(await exists(indexPath))) {
      issues.push(
        issue(
          'files-assets',
          'files',
          'warning',
          '资源索引缺失',
          `没有找到 assets/indexes/${assetIndex}.json，游戏可能缺少贴图或声音；可以在下载页补全文件。`
        )
      )
    }
  }

  const modsDir = join(gameDir, 'mods')
  if (!(await exists(modsDir)) && instance.modCount > 0) {
    issues.push(
      issue(
        'files-mods-missing',
        'files',
        'error',
        '模组目录缺失',
        '实例记录里有模组，但 mods 目录不存在。实例可能被移动或未完整安装。'
      )
    )
  }
}

async function scanMods(gameDir: string): Promise<ModScan> {
  const dir = join(gameDir, 'mods')
  let entries: string[]
  try {
    entries = await fs.readdir(dir)
  } catch {
    return { mods: [], issues: [] }
  }

  const mods: ScannedMod[] = []
  const providedIds = new Set<string>()
  const issues: DiagnosticIssue[] = []
  for (const entry of entries) {
    const lower = entry.toLowerCase()
    const enabled = lower.endsWith('.jar')
    const disabled = lower.endsWith('.jar.disabled')
    if (!enabled && !disabled) continue
    const filePath = join(dir, entry)
    let stat
    try {
      stat = await fs.stat(filePath)
    } catch {
      continue
    }
    if (!stat.isFile()) continue

    let zip: AdmZip
    try {
      zip = new AdmZip(filePath)
    } catch (error) {
      if (enabled) issues.push(unreadableModIssue(entry, error))
      continue
    }

    let metadata: Omit<ScannedMod, 'file' | 'enabled'> | null = null
    try {
      metadata = readModMetadata(zip, entry)
      for (const providedId of [...readProvidedIds(zip), ...readNestedIds(zip)]) {
        providedIds.add(providedId)
      }
    } catch (error) {
      // 有些模组（例如 ReplayMod）jar 内会重复打包 assets/ 目录。
      // adm-zip 出于安全考虑拒绝这种条目，但 Fabric/Forge 能正常读取；
      // 这只影响风信的元数据扫描，不应该让整次体检失败或误报文件损坏。
      if (enabled) issues.push(unreadableModIssue(entry, error))
      continue
    }
    if (!metadata) continue
    mods.push({ ...metadata, file: entry, enabled })
  }

  issues.push(...checkModDependencies(mods, providedIds))
  return { mods, issues }
}

function dependencyRange(value: unknown): string | null {
  // 数组形式可能代表多组可选范围；不做猜测，只检查明确可判定的单条范围。
  if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 120)
  return null
}

function unreadableModIssue(file: string, error: unknown): DiagnosticIssue {
  if (error instanceof Error && /Duplicate entry name/i.test(error.message)) {
    return issue(
      'mod-scan-skipped',
      'mods',
      'info',
      '模组扫描已跳过',
      `${file} 的 jar 内含有重复的目录条目。Minecraft 和加载器通常可以正常读取它，风信只是跳过了它的元数据检查，不需要重新下载；如果游戏本身报错，再把这个文件作为排查对象。`,
      [],
      [file]
    )
  }
  return issue(
    'mod-corrupt',
    'mods',
    'error',
    '模组文件无法读取',
    `${file} 可能下载不完整或已损坏。建议重新下载这个文件，或先禁用它再启动。`,
    [],
    [file]
  )
}

function readModMetadata(zip: AdmZip, file: string): Omit<ScannedMod, 'file' | 'enabled'> | null {
  const fabric = zip.getEntry('fabric.mod.json')
  if (fabric) {
    try {
      const data = JSON.parse(fabric.getData().toString('utf8')) as {
        id?: string
        name?: string
        version?: string
        environment?: string
        depends?: Record<string, unknown>
      }
      if (data.id) {
        return {
          id: String(data.id).toLowerCase(),
          name: String(data.name || data.id),
          version: String(data.version || ''),
          environment:
            data.environment === 'server'
              ? 'server'
              : data.environment === 'client'
                ? 'client'
                : 'both',
          requires: Object.entries(data.depends ?? {}).map(([key, value]) => ({
            id: key.toLowerCase(),
            range: dependencyRange(value),
            side: 'both' as const
          })),
          loader: 'fabric'
        }
      }
    } catch {
      /* try other metadata */
    }
  }

  const quilt = zip.getEntry('quilt.mod.json')
  if (quilt) {
    try {
      const data = JSON.parse(quilt.getData().toString('utf8')) as {
        quilt_loader?: {
          id?: string
          version?: string
          metadata?: { name?: string }
          depends?: { id?: string; versions?: unknown; optional?: boolean }[]
        }
      }
      const loader = data.quilt_loader
      if (loader?.id) {
        return {
          id: String(loader.id).toLowerCase(),
          name: String(loader.metadata?.name || loader.id),
          version: String(loader.version || ''),
          environment: 'both',
          requires: (loader.depends ?? [])
            .filter((dependency) => dependency.optional !== true)
            .filter((dependency): dependency is { id: string; versions?: unknown } =>
              typeof dependency.id === 'string'
            )
            .map((dependency) => ({
              id: dependency.id.toLowerCase(),
              range: dependencyRange(dependency.versions),
              side: 'both' as const
            })),
          loader: 'quilt'
        }
      }
    } catch {
      /* ignore */
    }
  }

  for (const path of ['META-INF/neoforge.mods.toml', 'META-INF/mods.toml']) {
    const entry = zip.getEntry(path)
    if (!entry || entry.header.size > 1_000_000) continue
    try {
      const parsed = parseForgeToml(entry.getData().toString('utf8'))
      if (parsed.id) {
        return {
          id: parsed.id.toLowerCase(),
          name: parsed.name || parsed.id,
          version: parsed.version,
          environment: 'both',
          requires: parsed.dependencies,
          loader: 'forge'
        }
      }
    } catch {
      /* ignore */
    }
  }

  const legacy = zip.getEntry('mcmod.info')
  if (legacy) {
    try {
      const raw = JSON.parse(legacy.getData().toString('utf8')) as
        | { modList?: { modid?: string; name?: string; version?: string }[] }
        | { modid?: string; name?: string; version?: string }[]
      const list = Array.isArray(raw) ? raw : raw.modList ?? []
      const first = list[0]
      if (first?.modid) {
        return {
          id: String(first.modid).toLowerCase(),
          name: String(first.name || first.modid),
          version: String(first.version || ''),
          environment: 'both',
          requires: [],
          loader: 'forge'
        }
      }
    } catch {
      /* ignore */
    }
  }

  return null
}

function readProvidedIds(zip: AdmZip): string[] {
  const ids: string[] = []
  const fabric = zip.getEntry('fabric.mod.json')
  if (fabric) {
    try {
      const data = JSON.parse(fabric.getData().toString('utf8')) as { provides?: unknown }
      if (Array.isArray(data.provides)) {
        for (const id of data.provides) {
          if (typeof id === 'string' && id.trim()) ids.push(id.toLowerCase())
        }
      }
    } catch {
      /* ignore */
    }
  }
  const quilt = zip.getEntry('quilt.mod.json')
  if (quilt) {
    try {
      const data = JSON.parse(quilt.getData().toString('utf8')) as {
        quilt_loader?: { provides?: unknown }
      }
      const provides = data.quilt_loader?.provides
      if (Array.isArray(provides)) {
        for (const entry of provides) {
          if (typeof entry === 'string') ids.push(entry.toLowerCase())
          else if (entry && typeof entry === 'object') {
            const id = (entry as { id?: unknown }).id
            if (typeof id === 'string') ids.push(id.toLowerCase())
          }
        }
      }
    } catch {
      /* ignore */
    }
  }
  return ids
}

function readNestedIds(zip: AdmZip): string[] {
  const ids: string[] = []
  let count = 0
  for (const entry of zip.getEntries()) {
    if (count >= 24) break
    if (entry.isDirectory) continue
    const name = entry.entryName.replace(/\\/g, '/')
    if (!/META-INF\/(jars|library)\//i.test(name)) continue
    if (!name.toLowerCase().endsWith('.jar')) continue
    if (entry.header.size > 20 * 1024 * 1024) continue
    count += 1
    try {
      const nested = new AdmZip(entry.getData())
      const metadata = readModMetadata(nested, name)
      if (metadata?.id) ids.push(metadata.id)
    } catch {
      /* ignore nested malformed jar */
    }
  }
  return ids
}

function parseForgeToml(text: string): {
  id: string
  name: string
  version: string
  dependencies: ModDependency[]
} {
  let id = ''
  let name = ''
  let version = ''
  const dependencies: ModDependency[] = []
  let section: 'mods' | 'dependencies' | null = null
  let dependencyId = ''
  let dependencyRange: string | null = null
  let dependencySide: ModDependency['side'] = 'both'
  let dependencyRequired = true
  let dependencySeen = false

  const finishDependency = () => {
    if (dependencyId && dependencyRequired) {
      dependencies.push({
        id: dependencyId.toLowerCase(),
        range: dependencyRange,
        side: dependencySide
      })
    }
    dependencyId = ''
    dependencyRange = null
    dependencySide = 'both'
    dependencyRequired = true
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('[[mods]]')) {
      section = 'mods'
      continue
    }
    if (line.startsWith('[[dependencies.')) {
      if (section === 'dependencies' && dependencySeen) finishDependency()
      section = 'dependencies'
      dependencySeen = false
      continue
    }
    if (/^\[\[.*\]\]$/.test(line) || /^\[.*\]$/.test(line)) {
      if (section === 'dependencies' && dependencySeen) finishDependency()
      section = null
      continue
    }

    if (section === 'mods') {
      const modId = line.match(/^modId\s*=\s*["']([^"']+)["']/)
      if (modId && !id) id = modId[1]
      const displayName = line.match(/^displayName\s*=\s*["']([^"']+)["']/)
      if (displayName && !name) name = displayName[1]
      const modVersion = line.match(/^version\s*=\s*["']([^"']+)["']/)
      if (modVersion && !version) version = modVersion[1]
      continue
    }

    if (section === 'dependencies') {
      const depId = line.match(/^modId\s*=\s*["']([^"']+)["']/)
      if (depId) {
        if (dependencySeen) finishDependency()
        dependencyId = depId[1]
        dependencySeen = true
      }
      const range = line.match(/^versionRange\s*=\s*["']([^"']+)["']/)
      if (range) dependencyRange = range[1]
      const side = line.match(/^side\s*=\s*["']([^"']+)["']/i)
      if (side) {
        const value = side[1].toUpperCase()
        dependencySide = value === 'SERVER' ? 'server' : value === 'CLIENT' ? 'client' : 'both'
      }
      if (/^mandatory\s*=\s*false/i.test(line)) dependencyRequired = false
      if (/^type\s*=\s*["']optional["']/i.test(line)) dependencyRequired = false
      if (/^type\s*=\s*["']required["']/i.test(line)) dependencyRequired = true
    }
  }
  if (section === 'dependencies' && dependencySeen) finishDependency()

  return { id, name, version, dependencies }
}

function checkModDependencies(
  mods: ScannedMod[],
  providedIds: Set<string>
): DiagnosticIssue[] {
  const issues: DiagnosticIssue[] = []
  const enabled = mods.filter((mod) => mod.enabled)
  const clientEnabled = enabled.filter((mod) => mod.environment !== 'server')
  const byId = new Map<string, ScannedMod[]>()
  for (const mod of mods) {
    if (!mod.id) continue
    const list = byId.get(mod.id) ?? []
    list.push(mod)
    byId.set(mod.id, list)
  }

  for (const [id, list] of byId) {
    const active = list.filter((mod) => mod.enabled && mod.environment !== 'server')
    if (active.length <= 1) continue
    issues.push(
      issue(
        'mod-duplicate',
        'mods',
        'warning',
        `模组 ID 重复：${id}`,
        '同一个模组 ID 出现在多个文件中。部分加载器会警告并跳过其中一个，部分版本会拒绝启动；建议只保留一个版本。',
        active.map((mod) => mod.file),
        active.map((mod) => mod.file)
      )
    )
  }

  const availableIds = new Set([...byId.keys(), ...providedIds, ...BUILTIN_MOD_IDS])
  const hasFabricApi = availableIds.has('fabric-api')
  const missing = new Map<string, ScannedMod[]>()
  const disabledOnly = new Map<string, ScannedMod[]>()
  const mismatched: { dependency: string; range: string; installed: string; source: ScannedMod }[] = []

  for (const mod of clientEnabled) {
    for (const dependency of mod.requires) {
      if (!dependency.id || BUILTIN_MOD_IDS.has(dependency.id)) continue
      if (dependency.side === 'server') continue
      if (dependency.id.startsWith('fabric-') && hasFabricApi) continue
      if (dependency.id === 'fabric-api' && !hasFabricApi) {
        const from = missing.get(dependency.id) ?? []
        from.push(mod)
        missing.set(dependency.id, from)
        continue
      }
      const installed = byId.get(dependency.id)
      if (availableIds.has(dependency.id)) {
        if (installed?.length && !installed.some((entry) => entry.enabled)) {
          const from = disabledOnly.get(dependency.id) ?? []
          from.push(mod)
          disabledOnly.set(dependency.id, from)
        } else if (dependency.range && installed?.length) {
          const installedVersion = installed.find((entry) => entry.enabled)?.version ?? ''
          const satisfied = satisfiesVersion(installedVersion, dependency.range)
          if (satisfied === false) {
            mismatched.push({
              dependency: dependency.id,
              range: dependency.range,
              installed: installedVersion,
              source: mod
            })
          }
        }
        continue
      }
      const from = missing.get(dependency.id) ?? []
      from.push(mod)
      missing.set(dependency.id, from)
    }
  }

  const fabricApiSources = missing.get('fabric-api')
  if (fabricApiSources) {
    issues.push(
      issue(
        'mod-missing-fabric-api',
        'mods',
        'error',
        '缺少 Fabric API',
        `${fabricApiSources.map((mod) => mod.name || mod.file).slice(0, 3).join('、')} 需要 Fabric API，但 mods 目录里没有找到。`,
        fabricApiSources.slice(0, 6).map((mod) => mod.file)
      )
    )
    missing.delete('fabric-api')
  }
  if (missing.size > 0) {
    const lines = [...missing.entries()]
      .slice(0, 10)
      .map(
        ([dependency, sources]) =>
          `${dependency} ← ${sources
            .slice(0, 3)
            .map((mod) => mod.name || mod.file)
            .join('、')}`
      )
    issues.push(
      issue(
        'mod-missing-dependencies',
        'mods',
        'warning',
        `有 ${missing.size} 个前置没有直接找到`,
        '这些 ID 可能由 Jar-in-Jar 或 Fabric API 提供，也可能是真的缺少。如果游戏启动时报缺少前置，再按日志里的模组名处理。',
        lines
      )
    )
  }
  for (const [dependency, sources] of disabledOnly) {
    const installed = (byId.get(dependency) ?? []).filter((mod) => !mod.enabled)
    issues.push(
      issue(
        `mod-disabled-${dependency}`,
        'mods',
        'warning',
        `前置模组被禁用：${dependency}`,
        `${sources.map((mod) => mod.name || mod.file).slice(0, 3).join('、')} 需要 ${dependency}，但它当前是禁用状态。请到内容管理里重新启用它。`,
        installed.map((mod) => mod.file)
      )
    )
  }
  if (mismatched.length > 0) {
    const unique = [...new Map(mismatched.map((entry) => [entry.dependency, entry])).values()]
    issues.push(
      issue(
        'mod-version-mismatch',
        'mods',
        'warning',
        `有 ${unique.length} 个前置版本可能不匹配`,
        '已安装的前置版本可能不满足模组声明的范围。如果游戏能正常启动，可以先保留；出现 NoSuchMethodError 等异常时再检查。',
        unique
          .slice(0, 8)
          .map(
            (entry) =>
              `${entry.dependency}：已安装 ${entry.installed || '未知'}，需要 ${entry.range}（来自 ${entry.source.name || entry.source.file}）`
          )
      )
    )
  }

  return issues
}

function satisfiesVersion(version: string, range: string): boolean | null {
  const trimmed = range.trim()
  if (!trimmed || trimmed === '*' || trimmed.toLowerCase() === 'any') return true
  if (/[|,()[\]]/.test(trimmed)) return null
  const tokens = trimmed.split(/\s+/).filter(Boolean)
  if (!tokens.length) return true
  const current = parseVersion(version)
  if (!current) return null
  let checked = false
  for (const token of tokens) {
    const match = token.match(/^(>=|<=|>|<|=|~|\^)(.+)$/)
    const operator = match?.[1] ?? '='
    const targetText = match?.[2] ?? token
    if (!/^\d/.test(targetText)) return null
    const target = parseVersion(targetText)
    if (!target) return null
    checked = true
    const comparison = compareVersion(current, target)
    if (operator === '>=' && comparison < 0) return false
    if (operator === '<=' && comparison > 0) return false
    if (operator === '>' && comparison <= 0) return false
    if (operator === '<' && comparison >= 0) return false
    if (operator === '=' && comparison !== 0) return false
    if (operator === '~') {
      if (comparison < 0) return false
      if (current[0] !== target[0]) return false
      if ((current[1] ?? 0) !== (target[1] ?? 0)) return false
    }
    if (operator === '^') {
      if (comparison < 0) return false
      if (current[0] !== target[0]) return false
    }
  }
  return checked ? true : null
}

function parseVersion(value: string): [number, number, number] | null {
  const match = value
    .trim()
    .match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+][0-9A-Za-z.-]+)?$/i)
  if (!match) return null
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)]
}

function compareVersion(
  left: [number, number, number],
  right: [number, number, number]
): number {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index]
  }
  return 0
}

function checkModConflicts(mods: ScannedMod[], issues: DiagnosticIssue[]): void {
  const enabledIds = new Map(
    mods
      .filter((mod) => mod.enabled && mod.environment !== 'server' && mod.id)
      .map((mod) => [mod.id, mod.file])
  )
  const optifine = enabledIds.get('optifine') ?? enabledIds.get('optifabric')
  const sodium = enabledIds.get('sodium') ?? enabledIds.get('rubidium') ?? enabledIds.get('embeddium')
  if (optifine && sodium) {
    issues.push(
      issue(
        'mod-optifine-conflict',
        'mods',
        'error',
        'OptiFine 与 Sodium/Embeddium 冲突',
        '两者都会接管渲染管线，放在同一个实例通常会崩溃或黑屏。请保留其中一个。',
        [optifine, sodium],
        [optifine, sodium]
      )
    )
  }
}

async function analyzeLatestCrash(
  gameDir: string,
  mods: ScannedMod[]
): Promise<CrashReportView | null> {
  const crash = await readLatestCrash(gameDir)
  if (!crash) return null
  const issues = analyzeCrashText(crash.text, mods)
  const excerpt = collectExcerpt(crash.text, issues)
  if (!issues.length) {
    issues.push(
      issue(
        'crash-generic',
        'crash',
        'error',
        '游戏上次异常退出',
        '没有匹配到常见错误规则。下面是日志尾部，建议打开日志目录查看完整堆栈。',
        excerpt.slice(-8)
      )
    )
  }
  const summary =
    findCrashSummary(crash.text) || issues[0]?.title || '游戏异常退出'
  return {
    found: true,
    file: crash.file,
    createdAt: crash.createdAt,
    summary,
    excerpt,
    issues
  }
}

async function readLatestCrash(gameDir: string): Promise<CrashRead | null> {
  const crashDir = join(gameDir, 'crash-reports')
  try {
    const entries = await fs.readdir(crashDir, { withFileTypes: true })
    const candidates: { path: string; name: string; mtime: number }[] = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.txt')) continue
      const path = join(crashDir, entry.name)
      try {
        const stat = await fs.stat(path)
        candidates.push({ path, name: entry.name, mtime: stat.mtimeMs })
      } catch {
        /* ignore */
      }
    }
    candidates.sort((left, right) => right.mtime - left.mtime)
    if (candidates[0]) {
      return {
        file: `crash-reports/${candidates[0].name}`,
        createdAt: candidates[0].mtime,
        text: await readTail(candidates[0].path)
      }
    }
  } catch {
    /* no crash folder */
  }

  const latestLog = join(gameDir, 'logs', 'latest.log')
  try {
    const stat = await fs.stat(latestLog)
    if (Date.now() - stat.mtimeMs > 12 * 60 * 60 * 1000) return null
    const text = await readTail(latestLog)
    if (
      !/Exception in thread|FATAL|A fatal error|crash report|Minecraft Crash|Incompatible mods found|Some of your mods are incompatible|需要.*?java.*?\d+.*?及以上|requires (?:Java|JDK)\s*\d+/i.test(
        text
      )
    ) {
      return null
    }
    return { file: 'logs/latest.log', createdAt: stat.mtimeMs, text }
  } catch {
    return null
  }
}

async function readTail(path: string, length = 220_000): Promise<string> {
  const stat = await fs.stat(path)
  const size = Math.min(stat.size, length)
  if (size <= 0) return ''
  const handle = await fs.open(path, 'r')
  try {
    const buffer = Buffer.alloc(size)
    await handle.read(buffer, 0, size, stat.size - size)
    return buffer.toString('utf8')
  } finally {
    await handle.close()
  }
}

const CRASH_RULES: {
  id: string
  pattern: RegExp
  category: DiagnosticIssue['category']
  severity: DiagnosticIssue['severity']
  title: string
  detail: string
}[] = [
  {
    id: 'crash-oom',
    pattern: /OutOfMemoryError|Java heap space|GC overhead limit exceeded/i,
    category: 'memory',
    severity: 'error',
    title: '游戏内存不足',
    detail: 'Java 堆已经耗尽。可以在实例启动设置里提高内存，或减少模组/光影。'
  },
  {
    id: 'crash-java',
    pattern: /UnsupportedClassVersionError|class file (?:major )?version|Java \d+ .*required/i,
    category: 'java',
    severity: 'error',
    title: 'Java 版本不匹配',
    detail: '当前 Java 与游戏或加载器要求不一致。在实例启动设置里换成对应主版本的 Java。'
  },
  {
    id: 'crash-java-mod',
    pattern: /需要.*?java.*?\d+.*?及以上|requires (?:Java|JDK)\s*\d+|requires.*?Java.*?version/i,
    category: 'java',
    severity: 'error',
    title: '模组要求更高的 Java 版本',
    detail: '日志显示有模组要求比本次启动更高的 Java。打开实例的「启动设置」，把 Java 换到日志中要求的主版本（例如 Java 21）再启动；本机没有时先在设置里检测或下载对应 Java。'
  },
  {
    id: 'crash-dependency',
    pattern: /Missing or unsupported mandatory dependencies|which is missing|Missing required|requires .+? which is missing|Mod ID: '?([^'\n]+)'?/i,
    category: 'mods',
    severity: 'error',
    title: '缺少前置模组',
    detail: '日志指出有模组的前置未满足。请打开模组列表，补装日志里提到的前置。'
  },
  {
    id: 'crash-duplicate',
    pattern: /Duplicate mods|duplicate mod id|two mods with the same id|duplicate mods/i,
    category: 'mods',
    severity: 'error',
    title: '模组 ID 重复',
    detail: '同一个模组被放了多个版本，加载器无法决定加载哪一个。禁用其中一个。'
  },
  {
    id: 'crash-mixin',
    pattern: /Mixin apply failed|MixinTransformerError|Critical injection failure|mixin.*(failed|error)/i,
    category: 'mods',
    severity: 'error',
    title: 'Mixin 注入失败',
    detail: '通常是两个模组修改了同一个类，或模组版本与 Minecraft 不匹配。把堆栈里出现的模组作为排查起点。'
  },
  {
    id: 'crash-corrupt',
    pattern: /Invalid mod file|not a valid mod file|ZipException|invalid LOC header|Error reading zip/i,
    category: 'mods',
    severity: 'error',
    title: '模组文件损坏',
    detail: '有一个模组 jar 无法读取。重新下载日志里出现的文件，或先禁用它。'
  },
  {
    id: 'crash-graphics',
    pattern: /Pixel format not accelerated|Failed to create GL context|GLFW error|OpenGL.*(?:error|not supported)|libGL error/i,
    category: 'graphics',
    severity: 'warning',
    title: '图形环境初始化失败',
    detail: '可能是显卡驱动、远程桌面或 OpenGL 不可用。更新显卡驱动，或移除光影/渲染类模组后再试。'
  },
  {
    id: 'crash-module',
    pattern: /module .* does not export|InaccessibleObjectException|IllegalAccessError/i,
    category: 'java',
    severity: 'error',
    title: 'Java 模块访问失败',
    detail: '加载器与 Java 版本组合不兼容。优先尝试该 Minecraft 版本对应的官方 Java 主版本。'
  },
  {
    id: 'crash-binary',
    pattern: /NoSuchMethodError|NoSuchFieldError|IncompatibleClassChangeError/i,
    category: 'mods',
    severity: 'error',
    title: '模组与游戏版本不兼容',
    detail: '模组调用了不存在的类/方法。检查堆栈里出现的模组是否适用于当前 Minecraft 版本。'
  },
  {
    id: 'crash-main',
    pattern: /Could not find or load main class|Unable to access jarfile/i,
    category: 'files',
    severity: 'error',
    title: '游戏主文件缺失',
    detail: '客户端 jar 或类路径不完整。请在实例管理里补全文件。'
  }
]

function analyzeCrashText(text: string, mods: ScannedMod[]): DiagnosticIssue[] {
  const lines = text.split(/\r?\n/)
  const issues: DiagnosticIssue[] = []
  const seen = new Set<string>()
  for (const rule of CRASH_RULES) {
    let matchIndex = -1
    for (let index = 0; index < lines.length; index += 1) {
      if (rule.pattern.test(lines[index])) {
        matchIndex = index
        break
      }
    }
    if (matchIndex < 0 || seen.has(rule.id)) continue
    seen.add(rule.id)
    const evidence = lines
      .slice(Math.max(0, matchIndex - 2), matchIndex + 4)
      .map((line, offset) => `${Math.max(1, matchIndex - 2 + offset + 1)}: ${line}`)
      .slice(0, 8)
    const jarNames =
      rule.category === 'mods'
        ? findJarNames(
            lines.slice(Math.max(0, matchIndex - 3), matchIndex + 8).join('\n'),
            mods
          )
        : []
    issues.push(
      issue(rule.id, rule.category, rule.severity, rule.title, rule.detail, evidence, jarNames)
    )
  }
  return issues
}

function findJarNames(text: string, mods: ScannedMod[]): string[] {
  const fileSet = new Set(mods.map((mod) => mod.file.toLowerCase()))
  const result: string[] = []
  const matches = text.match(/[A-Za-z0-9_.+\-]+\.jar/gi) ?? []
  for (const match of matches) {
    const name = basename(match)
    if (fileSet.has(name.toLowerCase()) && !result.includes(name)) result.push(name)
  }
  return result.slice(0, 4)
}

function collectExcerpt(text: string, issues: DiagnosticIssue[]): string[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim())
  const evidence = new Set<string>()
  for (const issue of issues) {
    for (const line of issue.evidence) evidence.add(line)
  }
  if (evidence.size > 0) return [...evidence].slice(0, 40)
  return lines.slice(-24).map((line) => line.slice(0, 500))
}

function findCrashSummary(text: string): string | null {
  const lines = text.split(/\r?\n/)
  for (const line of lines) {
    if (/(Exception|Error|Caused by):/.test(line) && line.trim().length > 8) {
      return line.trim().slice(0, 240)
    }
  }
  return null
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}
