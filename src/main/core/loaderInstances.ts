import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type {
  InstanceLoader,
  InstanceSummary,
  LauncherSettings,
  LoaderInstanceRequest,
  LoaderRollbackState,
  VanillaInstanceRequest
} from '../../shared/types'
import {
  getInstance,
  getInstanceDir,
  getInstanceMinecraftDir,
  listInstances,
  makeInstanceId,
  updateInstanceLoader,
  writeInstance
} from './instances'
import { installLoaderProfile } from './loaders'
import { installVanillaVersion } from './installer'
import { ensureJavaForVersion } from './java'
import { CancellationError } from './net'
import { emptyDetail, type TaskProgress } from './progress'
import { pathExists } from './version'
import { backupWorlds, type WorldVaultContext } from './worldVault'

const SAFE_VERSION = /^[A-Za-z0-9._+\-]{1,64}$/
const SAFE_ID = /^[A-Za-z0-9._+\-]{1,128}$/
const ROLLBACK_FILE = 'loader-rollback.json'
const LOADER_NAMES: Record<LoaderInstanceRequest['loader'], string> = {
  fabric: 'Fabric',
  quilt: 'Quilt',
  forge: 'Forge',
  neoforge: 'NeoForge',
  optifine: 'OptiFine'
}

/** 这些加载器需要先跑自己的 Java 安装器。 */
function needsInstallerJava(loader: InstanceLoader): boolean {
  return loader === 'forge' || loader === 'neoforge' || loader === 'optifine'
}

/** Forge/NeoForge 安装器对 Java 大版本敏感；OptiFine 安装器任何较新的 Java 都能跑。 */
function needsExactJava(loader: InstanceLoader): boolean {
  return loader === 'forge' || loader === 'neoforge'
}

function worldContext(instance: InstanceSummary, settings: LauncherSettings): WorldVaultContext {
  return {
    instance,
    instanceDir: getInstanceDir(instance.id),
    gameDir: instance.external?.gameDir ?? getInstanceMinecraftDir(instance.id),
    limit: settings.worldBackupLimit,
    maxAgeDays: settings.backupMaxAgeDays
  }
}

async function backupBeforeLoaderChange(
  instance: InstanceSummary,
  settings: LauncherSettings,
  signal: AbortSignal,
  report: (stage: string, percent: number, detail?: ReturnType<typeof emptyDetail>) => void,
  start: number,
  end: number
): Promise<void> {
  if (settings.autoWorldBackup === false) return
  report('备份存档', start)
  await backupWorlds({
    context: worldContext(instance, settings),
    kind: 'loader',
    signal,
    onProgress: (info) => {
      report(
        `备份存档 · ${info.stage}`,
        start + (info.percent / 100) * (end - start),
        info.detail
      )
    }
  })
}

function rollbackPath(instanceId: string): string {
  return join(getInstanceDir(instanceId), ROLLBACK_FILE)
}

function normalizeRollback(raw: unknown, instanceId: string): LoaderRollbackState | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Partial<LoaderRollbackState>
  if (
    value.instanceId !== instanceId ||
    typeof value.fromVersionId !== 'string' ||
    !SAFE_ID.test(value.fromVersionId) ||
    typeof value.fromLoaderVersion !== 'string' ||
    !SAFE_VERSION.test(value.fromLoaderVersion) ||
    typeof value.toVersionId !== 'string' ||
    !SAFE_ID.test(value.toVersionId) ||
    typeof value.toLoaderVersion !== 'string' ||
    !SAFE_VERSION.test(value.toLoaderVersion) ||
    typeof value.updatedAt !== 'number'
  ) {
    return null
  }
  return {
    instanceId,
    fromVersionId: value.fromVersionId,
    fromLoaderVersion: value.fromLoaderVersion,
    toVersionId: value.toVersionId,
    toLoaderVersion: value.toLoaderVersion,
    updatedAt: value.updatedAt
  }
}

async function readLoaderRollbackRecord(
  instanceId: string
): Promise<LoaderRollbackState | null> {
  try {
    const raw = JSON.parse(await fs.readFile(rollbackPath(instanceId), 'utf8')) as {
      version?: number
      record?: unknown
    }
    if (raw.version !== 1) return null
    return normalizeRollback(raw.record, instanceId)
  } catch {
    return null
  }
}

async function writeLoaderRollbackRecord(
  instanceId: string,
  record: LoaderRollbackState
): Promise<void> {
  await fs.writeFile(
    rollbackPath(instanceId),
    JSON.stringify({ version: 1, record }, null, 2),
    'utf8'
  )
}

async function clearLoaderRollbackRecord(instanceId: string): Promise<void> {
  await fs.rm(rollbackPath(instanceId), { force: true }).catch(() => undefined)
}

export async function getLoaderRollbackState(
  instanceId: string
): Promise<LoaderRollbackState | null> {
  const instance = await getInstance(instanceId)
  if (instance.loader === 'vanilla') return null
  const record = await readLoaderRollbackRecord(instance.id)
  if (!record) return null
  if (
    instance.versionId !== record.toVersionId ||
    instance.loaderVersion !== record.toLoaderVersion
  ) {
    return null
  }
  return record
}

async function readJavaMajor(gameDir: string, versionId: string): Promise<number | null> {
  try {
    const raw = await fs.readFile(join(gameDir, 'versions', versionId, `${versionId}.json`), 'utf8')
    const json = JSON.parse(raw) as { javaVersion?: { majorVersion?: number } }
    return typeof json.javaVersion?.majorVersion === 'number'
      ? json.javaVersion.majorVersion
      : null
  } catch {
    return null
  }
}

export interface EnsuredLaunchProfile {
  versionId: string
  loaderVersion: string | null
  javaMajor: number | null
  repaired: boolean
}

/**
 * 回滚实例前确认目标启动档案真的还在。
 * 版本文件夹可能被用户清理或随实例删除，光把 instance.json 改回去只会得到
 * “未找到版本 xxx 的配置文件”。缺失时先补原版，再按原加载器版本重装。
 */
export async function ensureLaunchProfile(options: {
  instance: InstanceSummary
  gameVersion: string
  loader: InstanceLoader
  loaderVersion: string | null
  versionId: string
  javaMajor?: number | null
  settings: LauncherSettings
  signal: AbortSignal
  report: (stage: string, percent: number, detail?: ReturnType<typeof emptyDetail>) => void
  start?: number
  span?: number
}): Promise<EnsuredLaunchProfile> {
  const { instance, settings, signal } = options
  if (!SAFE_VERSION.test(options.gameVersion)) throw new Error('无效的 Minecraft 版本')
  if (options.loader !== 'vanilla' && !SAFE_ID.test(options.versionId)) {
    throw new Error('回滚记录里的加载器版本无效')
  }
  const start = options.start ?? 0
  const span = options.span ?? 100
  const report = (
    stage: string,
    percent: number,
    detail: ReturnType<typeof emptyDetail> = emptyDetail()
  ) => {
    const ratio = Math.max(0, Math.min(100, percent)) / 100
    options.report(stage, start + ratio * span, detail)
  }
  const loaderGameDir = instance.external?.baseDir ?? instance.baseDir ?? settings.gameDir
  const baseVersionDir = join(loaderGameDir, 'versions', options.gameVersion)
  const baseReady =
    (await pathExists(join(baseVersionDir, `${options.gameVersion}.json`))) &&
    (await pathExists(join(baseVersionDir, `${options.gameVersion}.jar`)))
  let javaMajor =
    options.javaMajor ?? (await readJavaMajor(loaderGameDir, options.versionId)) ?? null
  let repaired = false

  if (!baseReady) {
    report(`安装原版 ${options.gameVersion}`, 1)
    await installVanillaVersion({
      gameDir: loaderGameDir,
      versionId: options.gameVersion,
      source: settings.source,
      concurrency: settings.downloadConcurrency,
      signal,
      onProgress: (info) => report(`原版 · ${info.stage}`, 5 + info.percent * 0.25, info.detail)
    })
    repaired = true
    javaMajor = (await readJavaMajor(loaderGameDir, options.gameVersion)) ?? javaMajor
  }

  if (options.loader === 'vanilla') {
    return { versionId: options.gameVersion, loaderVersion: null, javaMajor, repaired: !baseReady }
  }

  const label = LOADER_NAMES[options.loader as LoaderInstanceRequest['loader']]
  const profileJson = join(
    loaderGameDir,
    'versions',
    options.versionId,
    `${options.versionId}.json`
  )
  if (await pathExists(profileJson)) {
    return {
      versionId: options.versionId,
      loaderVersion: options.loaderVersion,
      javaMajor: (await readJavaMajor(loaderGameDir, options.gameVersion)) ?? javaMajor,
      repaired: !baseReady
    }
  }

  if (!options.loaderVersion || !SAFE_VERSION.test(options.loaderVersion)) {
    throw new Error(`旧${label}版本信息不完整，无法自动补回启动档案`)
  }

  if (signal.aborted) throw new CancellationError()
  let javaPath: string | undefined
  if (needsInstallerJava(options.loader)) {
    report(`准备 ${label} Java`, 35)
    try {
      const java = await ensureJavaForVersion({
        gameDir: loaderGameDir,
        settings,
        requiredMajor: javaMajor,
        exact: needsExactJava(options.loader),
        source: settings.source,
        signal,
        onProgress: (info) => report(`准备 Java · ${info.stage}`, 35 + info.percent * 0.05, info.detail)
      })
      javaPath = java.path
    } catch (error) {
      if (javaMajor !== null && javaMajor <= 8) {
        throw new Error(
          `这个加载器需要 Java ${javaMajor}，但本机没有可用的 Java ${javaMajor}，官方也不再提供自动下载。请先安装 Java ${javaMajor}，在设置中指定后重试。`
        )
      }
      throw error
    }
  }

  if (signal.aborted) throw new CancellationError()
  report(`补回 ${label} ${options.loaderVersion}`, 45)
  const installed = await installLoaderProfile({
    gameDir: loaderGameDir,
    gameVersion: options.gameVersion,
    loader: options.loader,
    loaderVersion: options.loaderVersion,
    javaPath,
    concurrency: settings.downloadConcurrency,
    signal,
    onProgress: (info) => {
      report(`补回 ${label} · ${info.stage}`, 45 + info.percent * 0.5, info.detail)
    }
  })
  return {
    versionId: installed.versionId,
    loaderVersion: installed.loaderVersion,
    javaMajor: (await readJavaMajor(loaderGameDir, options.gameVersion)) ?? javaMajor,
    repaired: true
  }
}

/**
 * NeoForge 实例记录完整版本（21.1.265），下载页/更新弹窗展示后缀（265）。
 * 比较“是否已经是当前版本”时必须用同一把尺子。
 */
export function loaderVersionKey(
  loader: InstanceLoader,
  gameVersion: string,
  value: string | null | undefined
): string {
  if (loader !== 'neoforge' || !value) return value ?? ''
  const parts = gameVersion.split('.')
  const prefix =
    parts[0] === '1'
      ? `${parts[1]}.${parts[2] ?? '0'}`
      : `${parts[0]}.${parts[1] ?? '0'}`
  return value.startsWith(`${prefix}.`) ? value.slice(prefix.length + 1) : value
}

async function nextInstanceId(name: string): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const id = makeInstanceId(name)
    if (!(await pathExists(getInstanceDir(id)))) return id
  }
  throw new Error('无法创建实例目录，请重试')
}

async function ensureBaseVersion(options: {
  gameDir: string
  gameVersion: string
  settings: LauncherSettings
  signal: AbortSignal
  report: (stage: string, percent: number, detail?: ReturnType<typeof emptyDetail>) => void
  start: number
  span: number
}): Promise<void> {
  const { gameDir, gameVersion, settings, signal, report, start, span } = options
  const baseVersionDir = join(gameDir, 'versions', gameVersion)
  const ready =
    (await pathExists(join(baseVersionDir, `${gameVersion}.json`))) &&
    (await pathExists(join(baseVersionDir, `${gameVersion}.jar`)))
  if (ready) {
    report('原版文件已就绪', start + span)
    return
  }
  report(`安装原版 ${gameVersion}`, start)
  await installVanillaVersion({
    gameDir,
    versionId: gameVersion,
    source: settings.source,
    concurrency: settings.downloadConcurrency,
    signal,
    onProgress: (info) => {
      report(`原版 · ${info.stage}`, start + (info.percent / 100) * span, info.detail)
    }
  })
}

/** 原版实例只接受真正的原版档案；加载器档案继承父版本，不能混用。 */
async function assertVanillaProfile(gameDir: string, versionId: string): Promise<void> {
  let raw: string
  try {
    raw = await fs.readFile(join(gameDir, 'versions', versionId, `${versionId}.json`), 'utf8')
  } catch {
    throw new Error('原版版本文件不完整，请先补全后再创建实例')
  }
  try {
    const json = JSON.parse(raw) as { inheritsFrom?: unknown }
    if (typeof json.inheritsFrom === 'string' && json.inheritsFrom.trim()) {
      throw new Error(`${versionId} 是加载器档案，请选择原版版本`)
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('加载器档案')) throw error
    throw new Error('版本配置损坏，无法创建原版实例')
  }
}

async function createInstanceRecord(options: {
  gameVersion: string
  loader: InstanceLoader
  loaderVersion: string | null
  versionId: string
  requestedName?: string
  label: string
  javaMajor: number | null
  baseDir: string
}): Promise<InstanceSummary> {
  const requestedName = options.requestedName?.trim().slice(0, 80)
  const baseName = requestedName || `${options.gameVersion} ${options.label}`
  const existingNames = new Set((await listInstances()).map((item) => item.name))
  let name = baseName
  let suffix = 2
  while (existingNames.has(name)) {
    name = `${baseName} ${suffix}`
    suffix += 1
  }
  const id = await nextInstanceId(name)
  await fs.mkdir(join(getInstanceMinecraftDir(id), 'mods'), { recursive: true })
  const instance: InstanceSummary = {
    id,
    name,
    summary: `Minecraft ${options.gameVersion} · ${options.label}${
      options.loaderVersion ? ` ${options.loaderVersion}` : ''
    }`,
    iconUrl: null,
    gameVersion: options.gameVersion,
    loader: options.loader,
    loaderVersion: options.loaderVersion,
    versionId: options.versionId,
    baseDir: options.baseDir,
    javaMajor: options.javaMajor,
    modCount: 0,
    source: 'local',
    projectId: null,
    lastPlayed: null,
    installedAt: Date.now()
  }
  await writeInstance(instance)
  return instance
}

export async function createVanillaInstance(options: {
  request: VanillaInstanceRequest
  settings: LauncherSettings
  signal: AbortSignal
  onProgress: TaskProgress
}): Promise<InstanceSummary> {
  const { request, settings, signal, onProgress } = options
  if (!SAFE_VERSION.test(request.gameVersion)) throw new Error('无效的 Minecraft 版本')
  const report = (stage: string, percent: number, detail = emptyDetail()) => {
    onProgress({ stage, percent: Math.max(0, Math.min(100, percent)), detail })
  }

  await ensureBaseVersion({
    gameDir: settings.gameDir,
    gameVersion: request.gameVersion,
    settings,
    signal,
    report,
    start: 1,
    span: 94
  })
  if (signal.aborted) throw new CancellationError()
  await assertVanillaProfile(settings.gameDir, request.gameVersion)
  const javaMajor = await readJavaMajor(settings.gameDir, request.gameVersion)

  if (signal.aborted) throw new CancellationError()
  report('创建实例', 97)
  const instance = await createInstanceRecord({
    gameVersion: request.gameVersion,
    loader: 'vanilla',
    loaderVersion: null,
    versionId: request.gameVersion,
    requestedName: request.name,
    label: '原版',
    javaMajor,
    baseDir: settings.gameDir
  })
  report('原版实例已创建', 100)
  return instance
}

export async function createLoaderInstance(options: {
  request: LoaderInstanceRequest
  settings: LauncherSettings
  signal: AbortSignal
  onProgress: TaskProgress
}): Promise<InstanceSummary> {
  const { request, settings, signal, onProgress } = options
  if (!SAFE_VERSION.test(request.gameVersion)) throw new Error('无效的 Minecraft 版本')
  if (!(request.loader in LOADER_NAMES)) throw new Error('无效的加载器')
  const report = (stage: string, percent: number, detail = emptyDetail()) => {
    onProgress({ stage, percent: Math.max(0, Math.min(100, percent)), detail })
  }

  await ensureBaseVersion({
    gameDir: settings.gameDir,
    gameVersion: request.gameVersion,
    settings,
    signal,
    report,
    start: 1,
    span: 39
  })
  if (signal.aborted) throw new CancellationError()

  const javaMajor = await readJavaMajor(settings.gameDir, request.gameVersion)
  let javaPath: string | undefined
  if (needsInstallerJava(request.loader)) {
    report('准备加载器 Java', 42)
    try {
      const java = await ensureJavaForVersion({
        gameDir: settings.gameDir,
        settings,
        requiredMajor: javaMajor,
        exact: needsExactJava(request.loader),
        source: settings.source,
        signal,
        onProgress: (info) => {
          report(`准备 Java · ${info.stage}`, 42 + info.percent * 0.03, info.detail)
        }
      })
      javaPath = java.path
    } catch (error) {
      if (javaMajor !== null && javaMajor <= 8) {
        throw new Error(
          `这个加载器需要 Java ${javaMajor}，但本机没有可用的 Java ${javaMajor}，官方也不再提供自动下载。请先安装 Java ${javaMajor}，在设置中指定后重试。`
        )
      }
      throw error
    }
  }

  if (signal.aborted) throw new CancellationError()
  const label = LOADER_NAMES[request.loader]
  report(`安装 ${label}`, 46)
  const loader = await installLoaderProfile({
    gameDir: settings.gameDir,
    gameVersion: request.gameVersion,
    loader: request.loader,
    loaderVersion: request.loaderVersion,
    javaPath,
    concurrency: settings.downloadConcurrency,
    signal,
    onProgress: (info) => {
      report(`安装 ${label} · ${info.stage}`, 46 + info.percent * 0.49, info.detail)
    }
  })

  if (signal.aborted) throw new CancellationError()
  report('创建实例', 97)
  const instance = await createInstanceRecord({
    gameVersion: request.gameVersion,
    loader: request.loader,
    loaderVersion: loader.loaderVersion,
    versionId: loader.versionId,
    requestedName: request.name,
    label,
    javaMajor,
    baseDir: settings.gameDir
  })
  report(`${label} 实例已创建`, 100)
  return instance
}

export async function updateLoaderForInstance(options: {
  instanceId: string
  loaderVersion: string
  settings: LauncherSettings
  signal: AbortSignal
  onProgress: TaskProgress
}): Promise<InstanceSummary> {
  const { settings, signal, onProgress } = options
  const instance = await getInstance(options.instanceId)
  if (instance.loader === 'vanilla') throw new Error('原版实例没有加载器')
  if (!SAFE_VERSION.test(instance.gameVersion)) throw new Error('无效的 Minecraft 版本')
  if (!SAFE_VERSION.test(options.loaderVersion)) throw new Error('无效的加载器版本')
  if (
    loaderVersionKey(instance.loader, instance.gameVersion, instance.loaderVersion) ===
    loaderVersionKey(instance.loader, instance.gameVersion, options.loaderVersion)
  ) {
    throw new Error('这已经是当前加载器版本')
  }
  const report = (stage: string, percent: number, detail = emptyDetail()) => {
    onProgress({ stage, percent: Math.max(0, Math.min(100, percent)), detail })
  }
  const label = LOADER_NAMES[instance.loader as LoaderInstanceRequest['loader']]
  const loaderGameDir = instance.external?.baseDir ?? instance.baseDir ?? settings.gameDir
  const previous = {
    versionId: instance.versionId,
    loaderVersion: instance.loaderVersion
  }

  report('检查游戏文件', 2)
  const baseVersionDir = join(loaderGameDir, 'versions', instance.gameVersion)
  if (
    !(await pathExists(join(baseVersionDir, `${instance.gameVersion}.json`))) ||
    !(await pathExists(join(baseVersionDir, `${instance.gameVersion}.jar`)))
  ) {
    throw new Error('这个实例的基础游戏文件不完整，请先在实例管理里补全文件')
  }

  await backupBeforeLoaderChange(instance, settings, signal, report, 3, 10)
  if (signal.aborted) throw new CancellationError()

  const javaMajor =
    instance.javaMajor ?? (await readJavaMajor(loaderGameDir, instance.gameVersion))
  let javaPath: string | undefined
  if (needsInstallerJava(instance.loader)) {
    report('准备加载器 Java', 11)
    try {
      const java = await ensureJavaForVersion({
        gameDir: loaderGameDir,
        settings,
        requiredMajor: javaMajor,
        exact: needsExactJava(instance.loader),
        source: settings.source,
        signal,
        onProgress: (info) => {
          report(`准备 Java · ${info.stage}`, 11 + info.percent * 0.03, info.detail)
        }
      })
      javaPath = java.path
    } catch (error) {
      if (javaMajor !== null && javaMajor <= 8) {
        throw new Error(
          `这个加载器需要 Java ${javaMajor}，但本机没有可用的 Java ${javaMajor}，官方也不再提供自动下载。请先安装 Java ${javaMajor}，在设置中指定后重试。`
        )
      }
      throw error
    }
  }

  if (signal.aborted) throw new CancellationError()
  report(`安装 ${label}`, 15)
  const loader = await installLoaderProfile({
    gameDir: loaderGameDir,
    gameVersion: instance.gameVersion,
    loader: instance.loader,
    loaderVersion: options.loaderVersion,
    javaPath,
    concurrency: settings.downloadConcurrency,
    signal,
    onProgress: (info) => {
      report(`安装 ${label} · ${info.stage}`, 15 + info.percent * 0.80, info.detail)
    }
  })

  if (signal.aborted) throw new CancellationError()
  report('更新实例记录', 97)
  const updated = await updateInstanceLoader(instance.id, {
    versionId: loader.versionId,
    loaderVersion: loader.loaderVersion
  })
  if (previous.loaderVersion && updated.loaderVersion) {
    await writeLoaderRollbackRecord(instance.id, {
      instanceId: instance.id,
      fromVersionId: previous.versionId,
      fromLoaderVersion: previous.loaderVersion,
      toVersionId: updated.versionId,
      toLoaderVersion: updated.loaderVersion,
      updatedAt: Date.now()
    }).catch(() => undefined)
  }
  report(`${label} 已更新到 ${loader.loaderVersion}`, 100)
  return updated
}

export async function rollbackLoaderForInstance(options: {
  instanceId: string
  settings: LauncherSettings
  signal: AbortSignal
  onProgress: TaskProgress
}): Promise<InstanceSummary> {
  const { settings, signal, onProgress } = options
  const instance = await getInstance(options.instanceId)
  if (instance.loader === 'vanilla') throw new Error('原版实例没有加载器')
  const record = await readLoaderRollbackRecord(instance.id)
  if (!record) throw new Error('没有可回滚的加载器更新')
  if (
    instance.versionId !== record.toVersionId ||
    instance.loaderVersion !== record.toLoaderVersion
  ) {
    throw new Error('当前加载器已变化，无法回滚上次更新')
  }
  const report = (stage: string, percent: number, detail = emptyDetail()) => {
    onProgress({ stage, percent: Math.max(0, Math.min(100, percent)), detail })
  }
  const label = LOADER_NAMES[instance.loader as LoaderInstanceRequest['loader']]

  await backupBeforeLoaderChange(instance, settings, signal, report, 2, 10)
  if (signal.aborted) throw new CancellationError()

  const ensured = await ensureLaunchProfile({
    instance,
    gameVersion: instance.gameVersion,
    loader: instance.loader,
    loaderVersion: record.fromLoaderVersion,
    versionId: record.fromVersionId,
    javaMajor: instance.javaMajor,
    settings,
    signal,
    report,
    start: 11,
    span: 83
  })

  if (signal.aborted) throw new CancellationError()
  report('切换实例加载器', 94)
  const updated = await updateInstanceLoader(instance.id, {
    versionId: ensured.versionId,
    loaderVersion: ensured.loaderVersion ?? record.fromLoaderVersion
  })
  await clearLoaderRollbackRecord(instance.id)
  report(`${label} 已回滚到 ${ensured.loaderVersion ?? record.fromLoaderVersion}`, 100)
  return updated
}
