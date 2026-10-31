import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, shell } from 'electron'
import { existsSync, promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Agent, ProxyAgent, setGlobalDispatcher } from 'undici'
import os from 'node:os'
import { basename, dirname, isAbsolute, join, normalize, parse, relative, resolve } from 'node:path'
import type {
  BackupCleanupRequest,
  ContentKind,
  ContentProvider,
  CurseForgeInstallRequest,
  CurseForgeServerPackDownloadRequest,
  DownloadSource,
  FileFilter,
  InstanceMetaPatch,
  InstanceSummary,
  InstanceSettingsPatch,
  InstanceTransferRequest,
  JavaAssignmentApply,
  LauncherSettings,
  LoaderInstanceRequest,
  ModInstallRequest,
  ModpackExportOptions,
  ModrinthInstallRequest,
  PresetInstallRequest,
  PresetModInput,
  PreviewableContentKind,
  ServerPackRequest,
  TaskParallelState,
  VanillaInstanceRequest,
  VersionCleanupPreview,
  VersionCleanupResult,
  VersionUsageRef
} from '../shared/types'
import {
  getCacheDir,
  getConfigDir,
  getLogDir,
  getSettings,
  loadConfig,
  ensureDirs,
  updateSettings
} from './core/config'
import {
  pickCustomBackground,
  pruneBackgrounds,
  registerBackgroundProtocol
} from './core/background'
import {
  cacheStats,
  clearContentCache,
  setContentCacheDir,
  setContentCacheLimit
} from './core/contentCache'
import {
  activateAccount,
  addOfflineAccount,
  cancelMicrosoftLogin,
  deleteAccount,
  pollMicrosoftLogin,
  setAccountNotifier,
  startMicrosoftLogin
} from './core/auth'
import { accountsPayload } from './core/config'
import {
  bindMissingInstanceBaseDirs,
  deleteInstance,
  getInstance,
  getInstanceDir,
  getInstanceGameDir,
  getInstanceMinecraftDir,
  listInstances,
  requireInstanceId,
  updateInstanceLoader,
  updateInstanceMeta,
  updateInstanceSettings
} from './core/instances'
import { clearJavaCache, chooseJava, detectJava, ensureJavaForVersion } from './core/java'
import { applyJavaAssignments, buildJavaAssignments } from './core/javaAssignments'
import { installVanillaVersion } from './core/installer'
import {
  createLoaderInstance,
  createVanillaInstance,
  ensureLaunchProfile,
  getLoaderRollbackState,
  loaderVersionKey,
  rollbackLoaderForInstance,
  updateLoaderForInstance
} from './core/loaderInstances'
import { listLoaderVersions } from './core/loaders'
import {
  listCurseForgeModpackVersions,
  searchCurseForgeModpacks,
  searchCurseForgeMods
} from './core/curseforge'
import {
  downloadCurseForgeServerPack,
  installCurseForgeModpack
} from './core/curseforgePack'
import { getAiConfigView, updateAiConfig } from './core/ai'
import { analyzeWithAi } from './core/aiDoctor'
import { answerKubeJsQuestion } from './core/kubeJsQa'
import { verifyKubeJsRuntime } from './core/kubeJsRuntime'
import { inspectServerPack, verifyServerPack } from './core/serverPackCheck'
import {
  exportWorkshopPack,
  generateKubeJsScript,
  getWorkshopReport,
  kubeJsTemplates,
  listKubeJsFiles,
  listKubeJsHistory,
  pruneKubeJsHistory,
  readKubeJsFile,
  readKubeJsHistory,
  removeKubeJsFile,
  renameKubeJsFile,
  restoreKubeJsHistory,
  saveKubeJsFile
} from './core/packWorkshop'
import { explainKubeJsScript } from './core/kubeJsExplain'
import {
  buildKubeJsIndex,
  cancelKubeJsIndexBuild,
  getKubeJsIndexStatus,
  getKubeJsItemIcons,
  getKubeJsRecipeDetail,
  searchKubeJsIndex
} from './core/kubeJsIndex'
import { lintKubeJsFile, lintKubeJsProject } from './core/kubeJsDiagnostics'
import { readKubeJsLogs } from './core/kubeJsLogs'
import {
  clearIgnored,
  ignoreIssue,
  markKnownGood,
  runDiagnostics
} from './core/diagnostics'
import {
  checkContentUpdates,
  getContentChangelog,
  rollbackContentUpdate,
  scanContentLedger,
  updateContent
} from './core/contentLedger'
import { explainContentUpdate } from './core/updateExplain'
import {
  previewContentDir,
  previewContentFile,
  previewContentPack,
  searchContentPack
} from './core/contentPreview'
import {
  downloadModPackage,
  importModFiles,
  installMod,
  listInstalledMods,
  listModVersions,
  removeMod,
  searchModrinthMods,
  toggleMod
} from './core/mods'
import { importModpack } from './core/modpacks'
import {
  addPresetMod,
  checkPresetMods,
  installPresetMods,
  listPresetMods,
  parsePresetInstallRequest,
  presetManualMessage,
  removePresetMod,
  setPresetAutoInstall
} from './core/presetMods'
import {
  importCustomSearchAlias,
  listCustomSearchAliases,
  loadCustomSearchAliases,
  removeCustomSearchAlias
} from './core/customSearchAliases'
import { CancellationError, setUserAgentVersion } from './core/net'
import { emptyDetail } from './core/progress'
import {
  importInstalledPack,
  parseLocalPackImportRequest,
  scanLocalPacks
} from './core/localPacks'
import {
  downloadModpackArchive,
  listModpackVersions,
  pickModpackVersion,
  searchModpacks
} from './core/modrinth'
import {
  cancelLaunch,
  getLatestLogPath,
  getLaunchLogs,
  getLaunchState,
  isGameActive,
  launchGame,
  setLauncherEvents,
  stopGame
} from './core/launcher'
import { getVersionManifest, versionView } from './core/mojang'
import {
  addServer,
  launchServer,
  listServers,
  pingAllServers,
  pingServer,
  probeServer,
  removeServer,
  requireServerId,
  updateServer
} from './core/servers'
import { transferInstance } from './core/instanceTransfer'
import {
  listJvmPresets,
  removeJvmPreset,
  saveJvmPreset
} from './core/jvmPresets'
import {
  createServerPack,
  previewServerPack,
  suggestServerPackExclusions
} from './core/serverPack'
import { getPlaytimeReport, setPlaytimeChangedListener } from './core/playtime'
import { inspectRunningGame, stopRunningGame } from './core/runningGame'
import {
  copyScreenshot,
  listScreenshots,
  openScreenshot,
  registerScreenshotProtocol,
  removeScreenshot
} from './core/screenshots'
import { getPlayerSkinDataUrl, getSkinDataUrl } from './core/skins'
import { taskManager } from './core/tasks'
import { writeStoreZip, type StoreZipEntry } from './core/zipStore'
import {
  invalidateVersionCache,
  listInstalledVersions,
  listVersionIds,
  readVersionChain,
  removeVersionFolder,
  versionFolderSize
} from './core/versions'
import { resolveVersion } from './core/version'
import {
  listVersionFolders,
  mergeVersionFolders
} from './core/versionFolders'
import {
  backupWorlds,
  deleteWorldBackup,
  listWorldBackups,
  listWorlds,
  restoreWorldBackup,
  worldVaultPaths,
  type WorldVaultContext
} from './core/worldVault'
import { cleanupBackups, getBackupOverview } from './core/backupManager'
import {
  cancelLauncherUpdate,
  checkForLauncherUpdate,
  downloadLauncherUpdate,
  getLauncherUpdateState,
  installLauncherUpdate,
  setUpdaterListener
} from './core/updater'

app.setName('风信启动器')
setUserAgentVersion(app.getVersion())

function resolveDataRoot(): string {
  const override =
    process.env.WINDLETTER_DATA_DIR?.trim() || process.env.CYAN_DATA_DIR?.trim()
  if (override) return resolve(override)
  if (app.isPackaged) {
    // 数据目录跟随安装盘，默认放在安装目录旁边，避免占用系统盘。
    return join(dirname(process.execPath), '..', 'WindletterData')
  }
  return join(app.getPath('appData'), 'Windletter')
}

function applyDownloadProxy(raw: string): void {
  const value = raw.trim()
  if (!value) {
    setGlobalDispatcher(new Agent())
    return
  }
  try {
    setGlobalDispatcher(new ProxyAgent(value))
  } catch {
    setGlobalDispatcher(new Agent())
  }
}

app.setPath('userData', resolveDataRoot())
app.setAppUserModelId('com.windletter.launcher')

// 省内存模式：默认开启。关闭硬件加速，并让 Chromium 主动回收后台窗口内存。
// 必须在 app ready 之前决定，切换后需要重启。
let memorySaver = true
try {
  memorySaver = getSettings().memorySaver !== false
} catch {
  memorySaver = true
}
if (memorySaver) {
  app.commandLine.appendSwitch('disable-gpu')
  app.commandLine.appendSwitch('enable-features', 'CalculateNativeWinOcclusion')
}

let mainWindow: BrowserWindow | null = null
let allowClose = false
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()

function send(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

function launchInstanceFromArgv(argv: string[]): string | null {
  const prefix = '--launch-instance='
  const hit = argv.find((arg) => arg.startsWith(prefix))
  if (!hit) return null
  const id = hit.slice(prefix.length)
  return /^[a-z0-9][a-z0-9-]{1,63}$/.test(id) ? id : null
}

function requireVersionId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 128) throw new Error('无效的版本名称')
  if (value.includes('/') || value.includes('\\') || value.includes('..')) throw new Error('无效的版本名称')
  return value
}

function requireSource(value: unknown): DownloadSource | undefined {
  return value === 'official' || value === 'mirror' ? value : undefined
}

async function latestLogFile(): Promise<string | null> {
  const current = getLatestLogPath()
  if (current && existsSync(current)) return current
  try {
    const files = await fs.readdir(getLogDir())
    const logs = files.filter((name) => name.startsWith('launch-') && name.endsWith('.log')).sort()
    return logs.length ? join(getLogDir(), logs[logs.length - 1]) : null
  } catch {
    return null
  }
}

async function finalizeModpack(instance: InstanceSummary): Promise<{ instanceId: string }> {
  invalidateVersionCache(getSettings().gameDir)
  await updateSettings({
    lastVersionId: instance.gameVersion,
    lastInstanceId: instance.id
  }).catch(() => undefined)
  return { instanceId: instance.id }
}

function parseModrinthRequest(raw: unknown): ModrinthInstallRequest {
  if (!raw || typeof raw !== 'object') throw new Error('无效的整合包请求')
  const value = raw as Record<string, unknown>
  const projectId =
    typeof value.projectId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value.projectId)
      ? value.projectId
      : null
  if (!projectId) throw new Error('无效的整合包标识')
  const title = typeof value.title === 'string' ? value.title.trim().slice(0, 160) : ''
  if (!title) throw new Error('整合包名称不能为空')
  let iconUrl: string | null = null
  if (typeof value.iconUrl === 'string' && value.iconUrl.trim()) {
    try {
      const url = new URL(value.iconUrl)
      if (url.protocol === 'https:') iconUrl = url.toString()
    } catch {
      iconUrl = null
    }
  }
  const summary = typeof value.summary === 'string' ? value.summary.trim().slice(0, 600) : ''
  const versionId =
    typeof value.versionId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value.versionId)
      ? value.versionId
      : null
  return { projectId, title, iconUrl, summary, versionId }
}

function parseCurseForgeRequest(raw: unknown): CurseForgeInstallRequest {
  if (!raw || typeof raw !== 'object') throw new Error('无效的 CurseForge 整合包请求')
  const value = raw as Record<string, unknown>
  const projectId =
    typeof value.projectId === 'string' && /^\d{1,20}$/.test(value.projectId)
      ? value.projectId
      : null
  const fileId =
    typeof value.fileId === 'string' && /^\d{1,20}$/.test(value.fileId) ? value.fileId : null
  if (!projectId || !fileId) throw new Error('无效的 CurseForge 项目或文件标识')
  const title = typeof value.title === 'string' ? value.title.trim().slice(0, 160) : ''
  if (!title) throw new Error('整合包名称不能为空')
  let iconUrl: string | null = null
  if (typeof value.iconUrl === 'string' && value.iconUrl.trim()) {
    try {
      const url = new URL(value.iconUrl)
      if (url.protocol === 'https:') iconUrl = url.toString()
    } catch {
      iconUrl = null
    }
  }
  const summary = typeof value.summary === 'string' ? value.summary.trim().slice(0, 600) : ''
  const manualFiles: string[] = []
  if (Array.isArray(value.manualFiles)) {
    for (const item of value.manualFiles.slice(0, 200)) {
      if (typeof item === 'string') {
        const path = item.trim()
        if (path && isAbsolute(path)) manualFiles.push(path)
      }
    }
  }
  return {
    projectId,
    fileId,
    title,
    iconUrl,
    summary,
    ...(manualFiles.length ? { manualFiles } : {})
  }
}

function parseCurseForgeServerPackRequest(raw: unknown): CurseForgeServerPackDownloadRequest {
  if (!raw || typeof raw !== 'object') throw new Error('无效的 CurseForge 服务端包请求')
  const value = raw as Record<string, unknown>
  const projectId =
    typeof value.projectId === 'string' && /^\d{1,20}$/.test(value.projectId)
      ? value.projectId
      : null
  const fileId =
    typeof value.fileId === 'string' && /^\d{1,20}$/.test(value.fileId) ? value.fileId : null
  if (!projectId || !fileId) throw new Error('无效的 CurseForge 项目或文件标识')
  const title = typeof value.title === 'string' ? value.title.trim().slice(0, 160) : ''
  if (!title) throw new Error('整合包名称不能为空')
  const slug =
    typeof value.slug === 'string' && /^[A-Za-z0-9._-]{1,120}$/.test(value.slug.trim())
      ? value.slug.trim()
      : null
  return { projectId, fileId, title, ...(slug ? { slug } : {}) }
}

const LOADER_TITLES: Record<string, string> = {
  fabric: 'Fabric',
  quilt: 'Quilt',
  forge: 'Forge',
  neoforge: 'NeoForge',
  optifine: 'OptiFine'
}

function loaderTitle(loader: string): string {
  return LOADER_TITLES[loader] ?? loader.charAt(0).toUpperCase() + loader.slice(1)
}

function parseLoaderRequest(raw: unknown): LoaderInstanceRequest {
  if (!raw || typeof raw !== 'object') throw new Error('无效的加载器请求')
  const value = raw as Record<string, unknown>
  const gameVersion =
    typeof value.gameVersion === 'string' && /^[A-Za-z0-9._+\-]{1,64}$/.test(value.gameVersion)
      ? value.gameVersion
      : null
  if (!gameVersion) throw new Error('无效的 Minecraft 版本')
  const loader = value.loader
  if (
    loader !== 'fabric' &&
    loader !== 'quilt' &&
    loader !== 'forge' &&
    loader !== 'neoforge' &&
    loader !== 'optifine'
  ) {
    throw new Error('无效的加载器')
  }
  const loaderVersion =
    typeof value.loaderVersion === 'string' && value.loaderVersion.trim()
      ? value.loaderVersion.trim().slice(0, 64)
      : null
  const name = typeof value.name === 'string' ? value.name.trim().slice(0, 80) : ''
  return { gameVersion, loader, loaderVersion, name }
}

function parseVanillaRequest(raw: unknown): VanillaInstanceRequest {
  if (!raw || typeof raw !== 'object') throw new Error('无效的原版实例请求')
  const value = raw as Record<string, unknown>
  const gameVersion =
    typeof value.gameVersion === 'string' && /^[A-Za-z0-9._+\-]{1,64}$/.test(value.gameVersion)
      ? value.gameVersion
      : null
  if (!gameVersion) throw new Error('无效的 Minecraft 版本')
  const name = typeof value.name === 'string' ? value.name.trim().slice(0, 80) : ''
  return { gameVersion, name }
}

function parseContentKind(raw: unknown): ContentKind {
  return raw === 'datapack' || raw === 'resourcepack' || raw === 'shader'
    ? raw
    : 'mod'
}

function parsePreviewableKind(raw: unknown): PreviewableContentKind {
  if (raw === 'datapack' || raw === 'resourcepack' || raw === 'shader') return raw
  throw new Error('无效的预览类型')
}

function parsePreviewFile(raw: unknown): string {
  if (typeof raw !== 'string') throw new Error('无效的资源文件')
  const file = raw.trim()
  if (!file || file.length > 240) throw new Error('无效的资源文件')
  return file
}

function parsePreviewPath(raw: unknown): string {
  if (raw === undefined || raw === null) return ''
  if (typeof raw !== 'string' || raw.length > 500) throw new Error('无效的预览路径')
  return raw
}

function parseModInstallRequest(raw: unknown): ModInstallRequest {
  if (!raw || typeof raw !== 'object') throw new Error('无效的模组请求')
  const value = raw as Record<string, unknown>
  const instanceId = requireInstanceId(value.instanceId)
  const provider: ContentProvider =
    value.provider === 'curseforge' ? 'curseforge' : value.provider === 'modrinth' ? 'modrinth' : 'modrinth'
  const projectId =
    typeof value.projectId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value.projectId)
      ? value.projectId
      : null
  if (!projectId) throw new Error('无效的模组标识')
  const title = typeof value.title === 'string' ? value.title.trim().slice(0, 160) : ''
  const versionId =
    typeof value.versionId === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value.versionId)
      ? value.versionId
      : null
  return {
    instanceId,
    provider,
    projectId,
    title,
    versionId,
    kind: parseContentKind(value.kind),
    includeDependencies: value.includeDependencies !== false
  }
}

function parseInstanceId(raw: unknown): string {
  return requireInstanceId(raw)
}

function worldVaultContextFor(instance: InstanceSummary): WorldVaultContext {
  const settings = getSettings()
  return {
    instance,
    instanceDir: getInstanceDir(instance.id),
    gameDir: instance.external?.gameDir ?? getInstanceMinecraftDir(instance.id),
    limit: settings.worldBackupLimit,
    maxAgeDays: settings.backupMaxAgeDays
  }
}

function assertWorldIdle(instance: InstanceSummary): void {
  const state = getLaunchState()
  if (
    state.instanceId === instance.id &&
    (state.status === 'preparing' || state.status === 'starting' || state.status === 'running')
  ) {
    throw new Error('请先退出这个实例的游戏，再操作存档')
  }
}

async function buildVersionUsageMap(
  gameDir: string
): Promise<Map<string, VersionUsageRef[]>> {
  const usage = new Map<string, VersionUsageRef[]>()
  for (const instance of await listInstances()) {
    const base = instance.external?.baseDir ?? instance.baseDir
    if (base && base.toLowerCase() !== gameDir.toLowerCase()) {
      continue
    }
    const ids = new Set([
      ...(await readVersionChain(gameDir, instance.versionId)),
      ...(await readVersionChain(gameDir, instance.gameVersion))
    ])
    for (const id of ids) {
      const list = usage.get(id) ?? []
      list.push({ id: instance.id, name: instance.name })
      usage.set(id, list)
    }
  }
  return usage
}

async function buildVersionCleanupPreview(): Promise<VersionCleanupPreview> {
  const settings = getSettings()
  const gameDir = settings.gameDir
  const views = await listInstalledVersions(gameDir)
  const info = new Map(views.map((view) => [view.id, view]))
  const usage = await buildVersionUsageMap(gameDir)
  const protectedIds = new Set(usage.keys())
  const addProtectedChain = async (id: string | null): Promise<void> => {
    if (!id) return
    for (const versionId of await readVersionChain(gameDir, id)) protectedIds.add(versionId)
  }
  await addProtectedChain(settings.lastVersionId)
  if (isGameActive()) await addProtectedChain(getLaunchState().versionId)

  const unused = new Set(views.map((view) => view.id).filter((id) => !protectedIds.has(id)))
  const parentOf = new Map<string, string>()
  for (const id of unused) {
    const parent = info.get(id)?.inheritsFrom
    if (parent && unused.has(parent)) parentOf.set(id, parent)
  }
  const rootOf = (id: string): string => {
    let current = id
    const seen = new Set<string>()
    while (parentOf.has(current) && !seen.has(current)) {
      seen.add(current)
      current = parentOf.get(current)!
    }
    return current
  }
  const grouped = new Map<string, string[]>()
  for (const id of unused) {
    const root = rootOf(id)
    const list = grouped.get(root) ?? []
    list.push(id)
    grouped.set(root, list)
  }

  const groups: VersionCleanupPreview['groups'] = []
  // 缺少 <id>.json 的文件夹无法启动，也不会出现在版本列表里，但仍然占空间。
  let folderNames: string[] = []
  try {
    folderNames = (
      await fs.readdir(join(gameDir, 'versions'), { withFileTypes: true })
    )
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    folderNames = []
  }
  for (const id of folderNames) {
    if (info.has(id) || protectedIds.has(id)) continue
    groups.push({
      ids: [id],
      label: id + '（配置缺失）',
      sizeBytes: await versionFolderSize(gameDir, id),
      suggested: false
    })
  }
  for (const ids of grouped.values()) {
    ids.sort((left, right) => {
      const leftBase = info.get(left)?.inheritsFrom ? 1 : 0
      const rightBase = info.get(right)?.inheritsFrom ? 1 : 0
      return leftBase - rightBase || left.localeCompare(right)
    })
    let sizeBytes = 0
    for (const id of ids) sizeBytes += await versionFolderSize(gameDir, id)
    groups.push({
      ids,
      label:
        ids.length === 1 ? ids[0] : ids[0] + ' + ' + (ids.length - 1) + ' 个启动档案',
      sizeBytes,
      suggested: ids.some((id) => Boolean(info.get(id)?.inheritsFrom))
    })
  }
  groups.sort(
    (left, right) =>
      Number(right.suggested) - Number(left.suggested) || left.label.localeCompare(right.label)
  )
  return {
    groups,
    totalBytes: groups.reduce((sum, group) => sum + group.sizeBytes, 0),
    suggestedBytes: groups
      .filter((group) => group.suggested)
      .reduce((sum, group) => sum + group.sizeBytes, 0)
  }
}

async function cleanupUnusedVersions(rawIds: unknown): Promise<VersionCleanupResult> {
  if (!Array.isArray(rawIds)) throw new Error('无效的清理列表')
  const selected = new Set(
    rawIds
      .filter((id): id is string => typeof id === 'string' && /^[A-Za-z0-9._+-]{1,128}$/.test(id))
      .slice(0, 1000)
  )
  const preview = await buildVersionCleanupPreview()
  const groupOf = new Map<string, VersionCleanupPreview['groups'][number]>()
  for (const group of preview.groups) for (const id of group.ids) groupOf.set(id, group)
  const toRemove = new Set<string>()
  const skipped = new Set<string>()
  for (const group of preview.groups) {
    const chosen = group.ids.filter((id) => selected.has(id))
    if (chosen.length === 0) continue
    if (chosen.length !== group.ids.length) {
      for (const id of chosen) skipped.add(id)
      continue
    }
    for (const id of group.ids) toRemove.add(id)
  }
  for (const id of selected) if (!groupOf.has(id)) skipped.add(id)

  const gameDir = getSettings().gameDir
  const ordered = await Promise.all(
    [...toRemove].map(async (id) => ({ id, depth: (await readVersionChain(gameDir, id)).length }))
  )
  ordered.sort((left, right) => right.depth - left.depth || left.id.localeCompare(right.id))
  const removed: string[] = []
  for (const { id } of ordered) {
    try {
      await removeVersionFolder(gameDir, id)
      removed.push(id)
    } catch {
      skipped.add(id)
    }
  }
  if (removed.length > 0) {
    const settings = getSettings()
    if (settings.lastVersionId && removed.includes(settings.lastVersionId)) {
      await updateSettings({ lastVersionId: null }).catch(() => undefined)
    }
  }
  return { removed, skipped: [...skipped] }
}

async function cleanupVersionsAfterInstanceDelete(instance: InstanceSummary): Promise<string[]> {
  if (instance.external) return []
  // 原版版本是所有实例共享的游戏文件，也可能被直接启动使用。
  // 删除原版实例只删隔离的 mods/config/saves，版本本身交给版本管理清理。
  if (instance.loader === 'vanilla') return []
  const settings = getSettings()
  const gameDir = instance.baseDir ?? settings.gameDir
  const candidates: string[] = []
  const addChain = async (id: string): Promise<void> => {
    for (const versionId of await readVersionChain(gameDir, id)) {
      if (!candidates.includes(versionId)) candidates.push(versionId)
    }
  }
  // 先加载器档案，再基础版本；只有不再被任何实例或已安装档案引用时才删除。
  await addChain(instance.versionId)
  await addChain(instance.gameVersion)

  const protectedIds = new Set<string>()
  for (const item of await listInstances()) {
    const itemBase = item.external?.baseDir ?? item.baseDir ?? settings.gameDir
    if (itemBase.toLowerCase() !== gameDir.toLowerCase()) {
      continue
    }
    for (const versionId of await readVersionChain(gameDir, item.versionId)) {
      protectedIds.add(versionId)
    }
    for (const versionId of await readVersionChain(gameDir, item.gameVersion)) {
      protectedIds.add(versionId)
    }
  }

  const installed = await listVersionIds(gameDir)
  const removed = new Set<string>()
  for (const id of candidates) {
    if (protectedIds.has(id)) continue
    if (!installed.includes(id)) continue
    let usedByAnother = false
    for (const other of installed) {
      if (other === id || removed.has(other)) continue
      const chain = await readVersionChain(gameDir, other)
      if (chain.slice(1).includes(id)) {
        usedByAnother = true
        break
      }
    }
    if (usedByAnother) continue
    await removeVersionFolder(gameDir, id).catch(() => undefined)
    removed.add(id)
  }
  return [...removed]
}

let serverPackVerifier: AbortController | null = null
let kubeJsRuntimeController: AbortController | null = null

function registerIpc(): void {
  app.on('before-quit', () => {
    serverPackVerifier?.abort()
    kubeJsRuntimeController?.abort()
    cancelLauncherUpdate()
  })
  ipcMain.handle('window:minimize', () => mainWindow?.minimize())
  ipcMain.handle('window:toggle-maximize', () => {
    if (!mainWindow) return false
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
    return mainWindow.isMaximized()
  })
  ipcMain.handle('window:close', () => mainWindow?.close())
  ipcMain.handle('window:is-maximized', () => mainWindow?.isMaximized() ?? false)

  ipcMain.handle('app:info', async () => {
    const settings = getSettings()
    let diskFreeGb = 0
    let diskTotalGb = 0
    try {
      const stats = await fs.statfs(getConfigDir())
      diskFreeGb = Math.round((Number(stats.bavail) * Number(stats.bsize)) / 1024 ** 3 * 10) / 10
      diskTotalGb = Math.round((Number(stats.blocks) * Number(stats.bsize)) / 1024 ** 3 * 10) / 10
    } catch {
      /* 磁盘信息不可用时保持 0 */
    }
    return {
      name: '风信启动器',
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      totalMemoryGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
      diskFreeGb,
      diskTotalGb,
      gameDir: settings.gameDir,
      configDir: getConfigDir(),
      logDir: getLogDir()
    }
  })

  ipcMain.handle('updater:state', () => getLauncherUpdateState())
  ipcMain.handle('updater:check', (_event, silent?: unknown) =>
    checkForLauncherUpdate(silent === true)
  )
  ipcMain.handle('updater:download', () => downloadLauncherUpdate())
  ipcMain.handle('updater:cancel', () => cancelLauncherUpdate())
  ipcMain.handle('updater:install', () => installLauncherUpdate())

  ipcMain.handle('app:disk-space', async () => {
    try {
      const stats = await fs.statfs(getConfigDir())
      return {
        freeGb: Math.round((Number(stats.bavail) * Number(stats.bsize)) / 1024 ** 3 * 10) / 10,
        totalGb: Math.round((Number(stats.blocks) * Number(stats.bsize)) / 1024 ** 3 * 10) / 10
      }
    } catch {
      return { freeGb: 0, totalGb: 0 }
    }
  })

  const iconMemo = new Map<string, string>()
  ipcMain.handle('app:icon', async (_event, rawUrl: unknown) => {
    if (typeof rawUrl !== 'string' || !rawUrl.trim()) return null
    let target: URL
    try {
      target = new URL(rawUrl.trim())
    } catch {
      return null
    }
    if (target.protocol !== 'https:') return null
    const key = createHash('sha1').update(target.toString()).digest('hex')
    const memo = iconMemo.get(key)
    if (memo) return memo
    const dir = join(getConfigDir(), 'cache', 'icons')
    const file = join(dir, `${key}.png`)
    try {
      const cached = await fs.readFile(file)
      const dataUrl = `data:image/png;base64,${cached.toString('base64')}`
      if (iconMemo.size >= 400) iconMemo.clear()
      iconMemo.set(key, dataUrl)
      return dataUrl
    } catch {
      /* not cached yet */
    }
    try {
      const response = await fetch(target, {
        signal: AbortSignal.timeout(20000),
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'image/*' }
      })
      if (!response.ok) return null
      const buffer = Buffer.from(await response.arrayBuffer())
      if (!buffer.length || buffer.length > 12 * 1024 * 1024) return null
      let image: ReturnType<typeof nativeImage.createFromBuffer> | null = null
      try {
        image = nativeImage.createFromBuffer(buffer)
      } catch {
        image = null
      }
      if (!image || image.isEmpty()) {
        const isWebp =
          buffer.length > 12 &&
          buffer.toString('ascii', 0, 4) === 'RIFF' &&
          buffer.toString('ascii', 8, 12) === 'WEBP'
        if (isWebp) return `data:image/webp;base64,${buffer.toString('base64')}`
        return null
      }
      const size = image.getSize()
      const scale = Math.min(1, 64 / Math.max(size.width, size.height, 1))
      const resized =
        scale < 1
          ? image.resize({
              width: Math.max(1, Math.round(size.width * scale)),
              height: Math.max(1, Math.round(size.height * scale)),
              quality: 'good'
            })
          : image
      const png = resized.toPNG()
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(file, png)
      const dataUrl = `data:image/png;base64,${png.toString('base64')}`
      if (iconMemo.size >= 400) iconMemo.clear()
      iconMemo.set(key, dataUrl)
      return dataUrl
    } catch {
      return null
    }
  })

  ipcMain.handle('app:restart', () => {
    app.relaunch()
    app.exit(0)
  })

  ipcMain.handle('app:release-memory-elevated', async () => {
    if (process.platform !== 'win32') return { cancelled: true }
    const dir = join(os.tmpdir(), 'windletter-memory')
    await fs.mkdir(dir, { recursive: true })
    const resultFile = join(dir, 'memory-elevated.json')
    const scriptFile = join(dir, 'memory-elevated.ps1')
    await fs.rm(resultFile, { force: true }).catch(() => undefined)
    const script = `$ErrorActionPreference = 'Stop'
$resultPath = '${resultFile.replace(/'/g, "''")}'
try {
$code = @'
using System;
using System.Runtime.InteropServices;
public static class WindletterDeepMemory {
  [DllImport("ntdll.dll")] public static extern int NtSetSystemInformation(int infoClass, ref int info, int length);
  [DllImport("advapi32.dll", SetLastError = true)] public static extern bool OpenProcessToken(IntPtr handle, uint access, out IntPtr token);
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] public static extern bool LookupPrivilegeValue(string system, string name, out LUID luid);
  [DllImport("advapi32.dll", SetLastError = true)] public static extern bool AdjustTokenPrivileges(IntPtr token, bool disableAll, ref TOKEN_PRIVILEGES state, uint length, IntPtr previous, IntPtr returned);
  [StructLayout(LayoutKind.Sequential)] public struct LUID { public uint Low; public int High; }
  [StructLayout(LayoutKind.Sequential)] public struct LUID_AND_ATTRIBUTES { public LUID Luid; public uint Attributes; }
  [StructLayout(LayoutKind.Sequential)] public struct TOKEN_PRIVILEGES { public uint Count; public LUID_AND_ATTRIBUTES Privilege; }
  public static bool EnablePrivilege() {
    IntPtr token;
    if (!OpenProcessToken(System.Diagnostics.Process.GetCurrentProcess().Handle, 0x28, out token)) return false;
    LUID luid;
    if (!LookupPrivilegeValue(null, "SeProfileSingleProcessPrivilege", out luid)) return false;
    TOKEN_PRIVILEGES tp = new TOKEN_PRIVILEGES();
    tp.Count = 1; tp.Privilege.Luid = luid; tp.Privilege.Attributes = 2;
    return AdjustTokenPrivileges(token, false, ref tp, 0, IntPtr.Zero, IntPtr.Zero);
  }
  public static int Purge(int command) {
    int info = command;
    return NtSetSystemInformation(80, ref info, 4);
  }
}
'@
Add-Type -TypeDefinition $code
$before = (Get-CimInstance Win32_Process | Measure-Object -Property WorkingSetSize -Sum).Sum
$privilege = [WindletterDeepMemory]::EnablePrivilege()
$flush = [WindletterDeepMemory]::Purge(3)
$standby = [WindletterDeepMemory]::Purge(4)
$empty = [WindletterDeepMemory]::Purge(2)
Start-Sleep -Milliseconds 800
$after = (Get-CimInstance Win32_Process | Measure-Object -Property WorkingSetSize -Sum).Sum
$payload = [pscustomobject]@{ before = [double]$before; after = [double]$after; privilege = $privilege; flush = $flush; standby = $standby; empty = $empty }
} catch {
  $payload = [pscustomobject]@{ error = $_.Exception.Message }
}
$payload | ConvertTo-Json -Compress | Set-Content -Path $resultPath -Encoding UTF8`
    await fs.writeFile(scriptFile, '\uFEFF' + script, 'utf8')
    try {
      await promisify(execFile)(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          `Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File','${scriptFile.replace(/'/g, "''")}')`
        ],
        { windowsHide: true, timeout: 120000 }
      )
    } catch {
      return { cancelled: true }
    }
    const raw = await fs.readFile(resultFile, 'utf8').catch(() => '')
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, '').trim() || '{}') as {
      before?: number
      after?: number
      privilege?: boolean
      flush?: number
      standby?: number
      empty?: number
    }
    if (typeof parsed.before !== 'number' || typeof parsed.after !== 'number') {
      return { cancelled: false }
    }
    return {
      cancelled: false,
      beforeKb: Math.round(parsed.before / 1024),
      afterKb: Math.round(parsed.after / 1024),
      privilege: Boolean(parsed.privilege),
      flush: parsed.flush,
      standby: parsed.standby,
      empty: parsed.empty
    }
  })

  ipcMain.handle('app:release-memory', async (_event, rawScope: unknown) => {
    const scope = rawScope === 'system' ? 'system' : 'app'
    const totalKb = () =>
      app
        .getAppMetrics()
        .reduce((sum, metric) => sum + (metric.memory?.workingSetSize ?? 0), 0)
    const beforeKb = totalKb()
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        const dbg = win.webContents.debugger
        if (!dbg.isAttached()) dbg.attach('1.3')
        await dbg.sendCommand('HeapProfiler.collectGarbage').catch(() => undefined)
        await dbg
          .sendCommand('Memory.simulatePressureNotification', { level: 'critical' })
          .catch(() => undefined)
        dbg.detach()
      } catch {
        /* 调试器不可用时只做系统级回收 */
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250))

    if (process.platform === 'win32' && scope === 'system') {
      const script = `$code = @'
using System;
using System.Runtime.InteropServices;
public static class WindletterMemory {
  [DllImport("psapi.dll")] public static extern bool EmptyWorkingSet(IntPtr hProcess);
}
'@
Add-Type -TypeDefinition $code
$before = (Get-CimInstance Win32_Process | Measure-Object -Property WorkingSetSize -Sum).Sum
$count = 0
Get-Process | ForEach-Object { try { if ([WindletterMemory]::EmptyWorkingSet($_.Handle)) { $script:count++ } } catch {} }
Start-Sleep -Milliseconds 600
$after = (Get-CimInstance Win32_Process | Measure-Object -Property WorkingSetSize -Sum).Sum
[pscustomobject]@{ before = [double]$before; after = [double]$after; count = $script:count } | ConvertTo-Json -Compress`
      try {
        const { stdout } = await promisify(execFile)(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
          { windowsHide: true, timeout: 45000 }
        )
        const parsed = JSON.parse(stdout.trim() || '{}') as {
          before?: number
          after?: number
          count?: number
        }
        if (typeof parsed.before === 'number' && typeof parsed.after === 'number') {
          return {
            beforeKb: Math.round(parsed.before / 1024),
            afterKb: Math.round(parsed.after / 1024),
            processes: Number(parsed.count) || 0
          }
        }
      } catch {
        /* 回退到只回收启动器自身 */
      }
    }

    const pids = [...new Set([process.pid, ...app.getAppMetrics().map((metric) => metric.pid)])]
    if (process.platform === 'win32' && pids.length > 0) {
      const script = `$code = @'
using System;
using System.Runtime.InteropServices;
public static class WindletterMemory {
  [DllImport("psapi.dll")] public static extern bool EmptyWorkingSet(IntPtr hProcess);
}
'@
Add-Type -TypeDefinition $code
Get-Process -Id ${pids.join(',')} -ErrorAction SilentlyContinue | ForEach-Object { [WindletterMemory]::EmptyWorkingSet($_.Handle) | Out-Null }`
      await promisify(execFile)(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
        { windowsHide: true, timeout: 15000 }
      ).catch(() => undefined)
    }
    await new Promise((resolve) => setTimeout(resolve, 700))
    return { beforeKb, afterKb: totalKb() }
  })

  ipcMain.handle('app:image-data-url', async (_event, rawPath: unknown) => {
    if (typeof rawPath !== 'string' || !isAbsolute(rawPath)) return null
    try {
      const stat = await fs.stat(rawPath)
      if (!stat.isFile() || stat.size > 10 * 1024 * 1024) return null
      const image = nativeImage.createFromBuffer(await fs.readFile(rawPath))
      if (image.isEmpty()) return null
      const size = image.getSize()
      const scale = Math.min(1, 128 / Math.max(size.width, size.height, 1))
      const resized =
        scale < 1
          ? image.resize({
              width: Math.max(1, Math.round(size.width * scale)),
              height: Math.max(1, Math.round(size.height * scale)),
              quality: 'good'
            })
          : image
      return `data:image/png;base64,${resized.toPNG().toString('base64')}`
    } catch {
      return null
    }
  })

  ipcMain.handle('app:open-external', async (_event, url: unknown) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) throw new Error('无效的链接')
    await shell.openExternal(url)
  })

  ipcMain.handle('app:open-path', async (_event, path: unknown) => {
    if (typeof path !== 'string' || !path) throw new Error('无效的路径')
    const error = await shell.openPath(path)
    if (error) throw new Error(error)
  })

  ipcMain.handle('app:reveal-path', (_event, path: unknown) => {
    if (typeof path !== 'string' || !path) throw new Error('无效的路径')
    shell.showItemInFolder(path)
  })

  ipcMain.handle('app:pick-directory', async (_event, title?: unknown, defaultPath?: unknown) => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: typeof title === 'string' ? title : '选择文件夹',
      defaultPath: typeof defaultPath === 'string' ? defaultPath : undefined,
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : result.filePaths[0] ?? null
  })

  ipcMain.handle('app:pick-file', async (_event, title?: unknown, filters?: unknown) => {
    if (!mainWindow) return null
    const safeFilters = Array.isArray(filters)
      ? (filters as FileFilter[]).filter(
          (filter) => filter && typeof filter.name === 'string' && Array.isArray(filter.extensions)
        )
      : undefined
    const result = await dialog.showOpenDialog(mainWindow, {
      title: typeof title === 'string' ? title : '选择文件',
      properties: ['openFile'],
      filters: safeFilters
    })
    return result.canceled ? null : result.filePaths[0] ?? null
  })

  ipcMain.handle(
    'app:pick-save-file',
    async (_event, title?: unknown, defaultPath?: unknown, filters?: unknown) => {
      if (!mainWindow) return null
      const safeFilters = Array.isArray(filters)
        ? (filters as FileFilter[]).filter(
            (filter) =>
              filter && typeof filter.name === 'string' && Array.isArray(filter.extensions)
          )
        : undefined
      const result = await dialog.showSaveDialog(mainWindow, {
        title: typeof title === 'string' ? title : '保存文件',
        defaultPath: typeof defaultPath === 'string' ? defaultPath : undefined,
        filters: safeFilters
      })
      return result.canceled ? null : result.filePath ?? null
    }
  )

  ipcMain.handle('serverpack:preview', async (_event, rawId: unknown) => {
    return previewServerPack(requireInstanceId(rawId))
  })

  ipcMain.handle('serverpack:ai-suggest', async (_event, rawId: unknown) => {
    return suggestServerPackExclusions(requireInstanceId(rawId))
  })

  ipcMain.handle('serverpack:create', async (_event, raw: unknown) => {
    if (!raw || typeof raw !== 'object') throw new Error('无效的服务端包参数')
    const value = raw as Record<string, unknown>
    const instanceId = requireInstanceId(value.instanceId)
    const outputPath = typeof value.outputPath === 'string' ? value.outputPath.trim() : ''
    if (!outputPath || !isAbsolute(outputPath) || !/\.zip$/i.test(outputPath)) {
      throw new Error('请选择有效的 .zip 保存路径')
    }
    const includeMods = Array.isArray(value.includeMods)
      ? [...new Set(value.includeMods.filter((file): file is string => typeof file === 'string' && file.length > 0))]
      : []
    const propertiesRaw =
      value.properties && typeof value.properties === 'object'
        ? (value.properties as Record<string, unknown>)
        : {}
    const properties = {
      motd: typeof propertiesRaw.motd === 'string' ? propertiesRaw.motd.slice(0, 120) : '风信服务端',
      port: typeof propertiesRaw.port === 'number' ? propertiesRaw.port : 25565,
      maxPlayers: typeof propertiesRaw.maxPlayers === 'number' ? propertiesRaw.maxPlayers : 20,
      onlineMode: propertiesRaw.onlineMode !== false,
      viewDistance: typeof propertiesRaw.viewDistance === 'number' ? propertiesRaw.viewDistance : 10
    }
    if (taskManager.findRunning('serverPack')) {
      throw new Error('已有服务端包任务正在进行，请等待完成')
    }
    const instance = await getInstance(instanceId)
    const request: ServerPackRequest = {
      instanceId,
      outputPath,
      includeMods,
      includeConfigs: value.includeConfigs !== false,
      includeBootstrap: value.includeBootstrap !== false,
      properties
    }
    return taskManager.start({
      kind: 'serverPack',
      title: `制作服务端包 ${instance.name}`,
      instanceId,
      run: async ({ signal, progress }) => {
        const result = await createServerPack(request, progress, signal)
        return { message: result.message }
      }
    })
  })

  ipcMain.handle('serverpack:inspect', async (_event, rawId: unknown, rawPath: unknown) => {
    const instanceId = requireInstanceId(rawId)
    if (typeof rawPath !== 'string' || !rawPath.trim()) throw new Error('请选择服务端包')
    const raw = rawPath.trim()
    if (!isAbsolute(raw) || raw.length > 4096 || !/\.zip$/i.test(raw)) {
      throw new Error('请选择有效的 .zip 服务端包')
    }
    return inspectServerPack(instanceId, resolve(raw))
  })

  ipcMain.handle(
    'serverpack:verify',
    async (event, rawId: unknown, rawPath: unknown) => {
      const instanceId = requireInstanceId(rawId)
      if (typeof rawPath !== 'string' || !rawPath.trim()) throw new Error('请选择服务端包')
      const raw = rawPath.trim()
      if (!isAbsolute(raw) || raw.length > 4096 || !/\.zip$/i.test(raw)) {
        throw new Error('请选择有效的 .zip 服务端包')
      }
      if (serverPackVerifier) throw new Error('已有一个服务端启动测试正在进行')
      const controller = new AbortController()
      serverPackVerifier = controller
      const sender = event.sender
      try {
        return await verifyServerPack(
          instanceId,
          resolve(raw),
          (progress) => {
            if (!sender.isDestroyed()) sender.send('serverpack:verify-progress', progress)
          },
          controller.signal
        )
      } finally {
        if (serverPackVerifier === controller) serverPackVerifier = null
      }
    }
  )

  ipcMain.handle('serverpack:verify-cancel', () => {
    if (!serverPackVerifier) return false
    serverPackVerifier.abort()
    return true
  })

  ipcMain.handle('workshop:report', async (_event, rawId: unknown) => {
    return getWorkshopReport(requireInstanceId(rawId))
  })

  ipcMain.handle('workshop:kubejs-files', async (_event, rawId: unknown) => {
    return listKubeJsFiles(requireInstanceId(rawId))
  })

  ipcMain.handle(
    'workshop:kubejs-read',
    async (_event, rawId: unknown, rawPath: unknown) => {
      if (typeof rawPath !== 'string' || !rawPath.trim()) throw new Error('无效的 KubeJS 路径')
      return readKubeJsFile(requireInstanceId(rawId), rawPath)
    }
  )

  ipcMain.handle('workshop:kubejs-save', async (_event, raw: unknown) => {
    if (!raw || typeof raw !== 'object') throw new Error('无效的 KubeJS 保存请求')
    const value = raw as Record<string, unknown>
    const instanceId = requireInstanceId(value.instanceId)
    if (typeof value.path !== 'string' || !value.path.trim()) throw new Error('无效的 KubeJS 路径')
    if (typeof value.content !== 'string') throw new Error('无效的 KubeJS 内容')
    if (value.content.length > 2 * 1024 * 1024) throw new Error('KubeJS 脚本超过 2 MB')
    return saveKubeJsFile({
      instanceId,
      path: value.path,
      content: value.content,
      bom: value.bom === true,
      lineEnding: value.lineEnding === 'crlf' ? 'crlf' : 'lf',
      expectedModified:
        typeof value.expectedModified === 'number' && Number.isFinite(value.expectedModified)
          ? value.expectedModified
          : null,
      force: value.force === true
    })
  })

  ipcMain.handle('workshop:kubejs-rename', async (_event, raw: unknown) => {
    if (!raw || typeof raw !== 'object') throw new Error('无效的 KubeJS 重命名请求')
    const value = raw as Record<string, unknown>
    if (typeof value.from !== 'string' || !value.from.trim()) throw new Error('无效的 KubeJS 路径')
    if (typeof value.to !== 'string' || !value.to.trim()) throw new Error('无效的 KubeJS 路径')
    return renameKubeJsFile({
      instanceId: requireInstanceId(value.instanceId),
      from: value.from,
      to: value.to
    })
  })

  ipcMain.handle(
    'workshop:kubejs-remove',
    async (_event, rawId: unknown, rawPath: unknown) => {
      if (typeof rawPath !== 'string' || !rawPath.trim()) throw new Error('无效的 KubeJS 路径')
      await removeKubeJsFile(requireInstanceId(rawId), rawPath)
    }
  )

  ipcMain.handle('workshop:kubejs-history', async (_event, rawId: unknown) => {
    return listKubeJsHistory(requireInstanceId(rawId))
  })

  ipcMain.handle(
    'workshop:kubejs-history-read',
    async (_event, rawId: unknown, rawStamp: unknown, rawPath: unknown) => {
      if (typeof rawStamp !== 'string' || !rawStamp.trim()) throw new Error('无效的 KubeJS 历史版本')
      if (typeof rawPath !== 'string' || !rawPath.trim()) throw new Error('无效的 KubeJS 路径')
      return readKubeJsHistory(requireInstanceId(rawId), rawStamp, rawPath)
    }
  )

  ipcMain.handle('workshop:kubejs-history-restore', async (_event, raw: unknown) => {
    if (!raw || typeof raw !== 'object') throw new Error('无效的 KubeJS 恢复请求')
    const value = raw as Record<string, unknown>
    if (typeof value.stamp !== 'string' || !value.stamp.trim()) {
      throw new Error('无效的 KubeJS 历史版本')
    }
    if (typeof value.path !== 'string' || !value.path.trim()) throw new Error('无效的 KubeJS 路径')
    return restoreKubeJsHistory({
      instanceId: requireInstanceId(value.instanceId),
      stamp: value.stamp,
      path: value.path
    })
  })

  ipcMain.handle(
    'workshop:kubejs-history-clean',
    async (_event, rawId: unknown, rawKeep: unknown) => {
      const settings = getSettings()
      const keep =
        typeof rawKeep === 'number' && Number.isFinite(rawKeep)
          ? Math.floor(rawKeep)
          : settings.kubeJsBackupLimit
      return pruneKubeJsHistory(
        requireInstanceId(rawId),
        keep,
        settings.backupMaxAgeDays
      )
    }
  )

  ipcMain.handle('workshop:kubejs-index-status', async (_event, rawId: unknown) => {
    return getKubeJsIndexStatus(requireInstanceId(rawId))
  })

  ipcMain.handle('workshop:kubejs-index-build', async (event, rawId: unknown) => {
    const instanceId = requireInstanceId(rawId)
    const sender = event.sender
    return buildKubeJsIndex(instanceId, (progress) => {
      if (!sender.isDestroyed()) sender.send('workshop:kubejs-index-progress', progress)
    })
  })

  ipcMain.handle(
    'workshop:kubejs-item-icons',
    async (_event, rawId: unknown, rawIds: unknown) => {
      if (!Array.isArray(rawIds)) return {}
      const ids = rawIds
        .filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length < 240)
        .slice(0, 80)
      return getKubeJsItemIcons(requireInstanceId(rawId), ids)
    }
  )

  ipcMain.handle('workshop:kubejs-index-cancel', () => cancelKubeJsIndexBuild())

  ipcMain.handle(
    'workshop:kubejs-recipe-detail',
    async (_event, rawId: unknown, rawRecipeId: unknown) => {
      if (typeof rawRecipeId !== 'string') throw new Error('无效的配方 ID')
      const recipeId = rawRecipeId.trim()
      if (!recipeId || recipeId.length > 240) throw new Error('无效的配方 ID')
      return getKubeJsRecipeDetail(requireInstanceId(rawId), recipeId)
    }
  )

  ipcMain.handle('workshop:kubejs-lint', async (_event, raw: unknown) => {
    return lintKubeJsFile(raw)
  })

  ipcMain.handle('workshop:kubejs-lint-project', async (_event, raw: unknown) => {
    return lintKubeJsProject(raw)
  })

  ipcMain.handle('workshop:kubejs-logs', async (_event, rawId: unknown) => {
    return readKubeJsLogs(requireInstanceId(rawId))
  })

  ipcMain.handle('workshop:kubejs-index-search', async (_event, raw: unknown) => {
    if (!raw || typeof raw !== 'object') throw new Error('无效的索引搜索请求')
    const value = raw as Record<string, unknown>
    const kind =
      value.kind === 'recipe' ? 'recipe' : value.kind === 'tag' ? 'tag' : 'item'
    return searchKubeJsIndex({
      instanceId: requireInstanceId(value.instanceId),
      kind,
      query: typeof value.query === 'string' ? value.query.slice(0, 80) : '',
      modId: typeof value.modId === 'string' ? value.modId.slice(0, 80) : '',
      page:
        typeof value.page === 'number' && Number.isFinite(value.page)
          ? Math.max(1, Math.round(value.page))
          : 1,
      pageSize:
        typeof value.pageSize === 'number' && Number.isFinite(value.pageSize)
          ? Math.max(10, Math.min(80, Math.round(value.pageSize)))
          : 30
    })
  })

  ipcMain.handle('workshop:kubejs-templates', () => kubeJsTemplates())

  ipcMain.handle('workshop:kubejs-explain', async (_event, raw: unknown) => {
    if (!raw || typeof raw !== 'object') throw new Error('无效的 KubeJS 释意请求')
    const value = raw as Record<string, unknown>
    const instanceId = requireInstanceId(value.instanceId)
    if (typeof value.path !== 'string' || !value.path.trim()) throw new Error('无效的 KubeJS 路径')
    if (typeof value.content !== 'string') throw new Error('无效的 KubeJS 内容')
    if (value.content.length > 2 * 1024 * 1024) throw new Error('KubeJS 脚本超过 2 MB')
    return explainKubeJsScript({
      instanceId,
      path: value.path.slice(0, 400),
      content: value.content.slice(0, 12000),
      mode: value.mode === 'ai' ? 'ai' : 'local'
    })
  })

  ipcMain.handle('workshop:kubejs-ai', async (_event, raw: unknown) => {
    if (!raw || typeof raw !== 'object') throw new Error('无效的 AI 请求')
    const value = raw as Record<string, unknown>
    if (typeof value.prompt !== 'string' || !value.prompt.trim()) {
      throw new Error('请先描述你想要的 KubeJS 效果')
    }
    const rawSelection =
      value.selection && typeof value.selection === 'object'
        ? (value.selection as Record<string, unknown>)
        : null
    const selectionText =
      rawSelection && typeof rawSelection.text === 'string'
        ? rawSelection.text.slice(0, 12000)
        : ''
    const startLine =
      rawSelection && typeof rawSelection.startLine === 'number'
        ? Math.max(1, Math.round(rawSelection.startLine))
        : 1
    const endLine =
      rawSelection && typeof rawSelection.endLine === 'number'
        ? Math.max(startLine, Math.round(rawSelection.endLine))
        : startLine
    return generateKubeJsScript({
      instanceId: requireInstanceId(value.instanceId),
      prompt: value.prompt.slice(0, 4000),
      currentPath: typeof value.currentPath === 'string' ? value.currentPath : null,
      currentContent:
        typeof value.currentContent === 'string' ? value.currentContent.slice(0, 8000) : null,
      selection: selectionText.trim() ? { startLine, endLine, text: selectionText } : null
    })
  })

  ipcMain.handle('workshop:kubejs-qa', async (_event, raw: unknown) => {
    if (!raw || typeof raw !== 'object') throw new Error('无效的问答请求')
    const value = raw as Record<string, unknown>
    if (typeof value.question !== 'string' || !value.question.trim()) {
      throw new Error('请输入要问的物品或配方问题')
    }
    return answerKubeJsQuestion({
      instanceId: requireInstanceId(value.instanceId),
      question: value.question.slice(0, 500)
    })
  })

  ipcMain.handle('workshop:kubejs-runtime', async (event, rawId: unknown) => {
    const instanceId = requireInstanceId(rawId)
    if (kubeJsRuntimeController) throw new Error('已有一个 KubeJS 运行验证正在进行')
    const controller = new AbortController()
    kubeJsRuntimeController = controller
    try {
      return await verifyKubeJsRuntime(
        instanceId,
        (progress) => {
          const sender = event.sender
          if (!sender.isDestroyed()) sender.send('workshop:kubejs-runtime-progress', progress)
        },
        controller.signal
      )
    } finally {
      if (kubeJsRuntimeController === controller) kubeJsRuntimeController = null
    }
  })

  ipcMain.handle('workshop:kubejs-runtime-cancel', () => {
    if (!kubeJsRuntimeController) return false
    kubeJsRuntimeController.abort()
    return true
  })

  ipcMain.handle('workshop:export-pack', async (event, raw: unknown) => {
    if (!raw || typeof raw !== 'object') throw new Error('无效的导出请求')
    const value = raw as Record<string, unknown>
    const instanceId = requireInstanceId(value.instanceId)
    const outputPath = typeof value.outputPath === 'string' ? value.outputPath.trim() : ''
    if (!outputPath || !isAbsolute(outputPath) || !/\.mrpack$/i.test(outputPath)) {
      throw new Error('请选择 .mrpack 保存路径')
    }
    const optionsRaw =
      value.options && typeof value.options === 'object'
        ? (value.options as Record<string, unknown>)
        : {}
    const includeMods = Array.isArray(optionsRaw.includeMods)
      ? [
          ...new Set(
            optionsRaw.includeMods.filter(
              (file): file is string => typeof file === 'string' && file.length > 0
            )
          )
        ].slice(0, 5000)
      : []
    if (includeMods.length === 0) throw new Error('至少选择一个模组')
    const options = {
      includeMods,
      includeConfigs: optionsRaw.includeConfigs !== false,
      includeKubejs: optionsRaw.includeKubejs !== false,
      includeResourcepacks: optionsRaw.includeResourcepacks !== false,
      includeShaderpacks: optionsRaw.includeShaderpacks !== false,
      includeDatapacks: optionsRaw.includeDatapacks !== false
    }
    const sender = event.sender
    return exportWorkshopPack(
      { instanceId, outputPath, options },
      (progress) => {
        if (!sender.isDestroyed()) sender.send('workshop:export-progress', progress)
      }
    )
  })

  ipcMain.handle('jvm:presets', async () => listJvmPresets())
  ipcMain.handle('jvm:save-preset', async (_event, raw: unknown) => {
    if (!raw || typeof raw !== 'object') throw new Error('无效的 JVM 预设')
    const value = raw as Record<string, unknown>
    return saveJvmPreset({
      id: typeof value.id === 'string' ? value.id : null,
      name: typeof value.name === 'string' ? value.name : '',
      args: typeof value.args === 'string' ? value.args : '',
      description: typeof value.description === 'string' ? value.description : undefined
    })
  })
  ipcMain.handle('jvm:remove-preset', async (_event, rawId: unknown) => {
    if (typeof rawId !== 'string') throw new Error('无效的预设')
    return removeJvmPreset(rawId)
  })

  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:choose-background', () => pickCustomBackground(mainWindow))
  ipcMain.handle('settings:update', async (_event, patch: unknown) => {
    if (!patch || typeof patch !== 'object') throw new Error('无效的设置')
    const before = getSettings()
    const next = { ...(patch as Partial<LauncherSettings>) }
    if (next.gameDir !== undefined) {
      if (typeof next.gameDir !== 'string' || !next.gameDir.trim()) throw new Error('游戏目录不能为空')
      if (!isAbsolute(next.gameDir)) throw new Error('游戏目录必须是绝对路径')
      next.gameDir = normalize(resolve(next.gameDir))
    }
    if (next.externalLauncherPath !== undefined && next.externalLauncherPath !== null) {
      if (typeof next.externalLauncherPath !== 'string' || !next.externalLauncherPath.trim()) {
        next.externalLauncherPath = null
      } else {
        const raw = next.externalLauncherPath.trim()
        if (!isAbsolute(raw) || !/\.exe$/i.test(raw)) throw new Error('外部启动器必须是 .exe 绝对路径')
        next.externalLauncherPath = normalize(resolve(raw))
      }
    }
    if (next.javaPath !== undefined && next.javaPath !== null) {
      if (typeof next.javaPath !== 'string') throw new Error('无效的 Java 路径')
      next.javaPath = next.javaPath.trim() || null
    }
    if (next.gameDir !== undefined && next.gameDir !== before.gameDir) {
      if (isGameActive()) throw new Error('游戏运行中无法切换版本文件夹')
      await bindMissingInstanceBaseDirs(before.gameDir)
      next.versionFolders = mergeVersionFolders(
        before.versionFolders,
        ...(next.versionFolders ?? []),
        before.gameDir,
        next.gameDir
      )
      next.lastVersionId = null
    }
    const settings = await updateSettings(next)
    if (before.gameDir !== settings.gameDir) {
      clearJavaCache()
      invalidateVersionCache()
    }
    if (before.javaPath !== settings.javaPath) clearJavaCache()
    if (before.downloadProxy !== settings.downloadProxy) {
      applyDownloadProxy(settings.downloadProxy)
    }
    if (before.cacheLimitMb !== settings.cacheLimitMb) {
      setContentCacheLimit(settings.cacheLimitMb)
    }
    if (before.backgroundImage !== settings.backgroundImage) {
      await pruneBackgrounds(settings.backgroundImage)
    }
    return settings
  })

  ipcMain.handle('app:cache-stats', () => cacheStats())
  ipcMain.handle('app:clear-cache', async () => {
    const removed = await clearContentCache()
    return removed
  })

  ipcMain.handle('auth:list', () => accountsPayload())
  ipcMain.handle('auth:add-offline', async (_event, name: unknown) => {
    if (typeof name !== 'string') throw new Error('无效的用户名')
    return addOfflineAccount(name)
  })
  ipcMain.handle('auth:set-active', async (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('无效的账户')
    return activateAccount(id)
  })
  ipcMain.handle('auth:remove', async (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('无效的账户')
    return deleteAccount(id)
  })
  ipcMain.handle('auth:ms-start', async (_event, clientId: unknown) => {
    return startMicrosoftLogin(typeof clientId === 'string' ? clientId : undefined)
  })
  ipcMain.handle('auth:ms-poll', async (_event, sessionId: unknown) => {
    if (typeof sessionId !== 'string') throw new Error('无效的登录会话')
    return pollMicrosoftLogin(sessionId)
  })
  ipcMain.handle('auth:ms-cancel', async (_event, sessionId: unknown) => {
    if (typeof sessionId === 'string') cancelMicrosoftLogin(sessionId)
  })
  ipcMain.handle('auth:skin', async (_event, uuid: unknown) => getSkinDataUrl(uuid))
  ipcMain.handle('servers:player-skin', async (_event, name: unknown, uuid: unknown) => {
    return getPlayerSkinDataUrl(name, uuid)
  })

  ipcMain.handle('versions:installed', async () => {
    const gameDir = getSettings().gameDir
    const usage = await buildVersionUsageMap(gameDir)
    return (await listInstalledVersions(gameDir)).map((version) => ({
      ...version,
      usedBy: usage.get(version.id) ?? []
    }))
  })

  ipcMain.handle('versions:folders', async () => listVersionFolders(getSettings()))

  ipcMain.handle('playtime:report', async () => getPlaytimeReport())

  ipcMain.handle('versions:cleanup-preview', async () => buildVersionCleanupPreview())

  ipcMain.handle('versions:cleanup', async (_event, rawIds: unknown) => {
    return cleanupUnusedVersions(rawIds)
  })

  ipcMain.handle('versions:manifest', async (_event, source?: unknown) => {
    const selected = requireSource(source) ?? getSettings().source
    const manifest = await getVersionManifest(selected)
    return versionView(manifest, selected)
  })

  ipcMain.handle('versions:install', async (_event, rawId: unknown) => {
    const versionId = requireVersionId(rawId)
    const settings = getSettings()
    await fs.mkdir(settings.gameDir, { recursive: true })
    const running = taskManager.findRunning('install', versionId)
    if (running) return running
    return taskManager.start({
      kind: 'install',
      title: `安装 Minecraft ${versionId}`,
      versionId,
      run: async ({ signal, progress }) => {
        await installVanillaVersion({
          gameDir: settings.gameDir,
          versionId,
          source: settings.source,
          concurrency: settings.downloadConcurrency,
          signal,
          onProgress: progress
        })
        invalidateVersionCache(settings.gameDir)
        await updateSettings({ lastVersionId: versionId }).catch(() => undefined)
      }
    })
  })

  ipcMain.handle('versions:remove', async (_event, rawId: unknown) => {
    const versionId = requireVersionId(rawId)
    const state = getLaunchState()
    if (state.versionId === versionId && isGameActive()) throw new Error('该版本正在运行，无法删除')
    const usedBy = (await listInstances()).find(
      (instance) => instance.gameVersion === versionId || instance.versionId === versionId
    )
    if (usedBy) {
      throw new Error(`该版本正被实例「${usedBy.name}」使用，请先删除这个实例`)
    }
    const settings = getSettings()
    await removeVersionFolder(settings.gameDir, versionId)
    if (settings.lastVersionId === versionId) {
      await updateSettings({ lastVersionId: null })
    }
  })

  ipcMain.handle('versions:open-folder', async (_event, rawId: unknown) => {
    const versionId = requireVersionId(rawId)
    const folder = join(getSettings().gameDir, 'versions', versionId)
    if (!existsSync(folder)) throw new Error('版本文件夹不存在')
    const error = await shell.openPath(folder)
    if (error) throw new Error(error)
  })

  ipcMain.handle('versions:export-json', async (_event, rawId: unknown) => {
    const versionId = requireVersionId(rawId)
    const source = join(getSettings().gameDir, 'versions', versionId, `${versionId}.json`)
    if (!existsSync(source)) throw new Error('该版本的配置文件不存在')
    if (!mainWindow) return false
    const picked = await dialog.showSaveDialog(mainWindow, {
      title: '导出版本配置',
      defaultPath: `${versionId}.json`,
      filters: [{ name: '版本配置', extensions: ['json'] }]
    })
    if (picked.canceled || !picked.filePath) return false
    await fs.copyFile(source, picked.filePath)
    return true
  })

  ipcMain.handle('instances:list', () => listInstances())

  ipcMain.handle('instances:import-file', async () => {
    if (!mainWindow) return null
    const picked = await dialog.showOpenDialog(mainWindow, {
      title: '导入整合包（.mrpack / .zip）',
      properties: ['openFile'],
      filters: [{ name: '整合包（.mrpack / .zip）', extensions: ['mrpack', 'zip'] }]
    })
    if (picked.canceled || !picked.filePaths[0]) return null
    const archivePath = picked.filePaths[0]
    if (!/\.(?:mrpack|zip)$/i.test(archivePath)) {
      throw new Error('请选择 .mrpack 或 .zip 整合包文件')
    }
    const settings = getSettings()
    const label =
      basename(archivePath).replace(/\.(?:mrpack|zip)$/i, '').slice(0, 80) || '本地整合包'
    return taskManager.start({
      kind: 'modpack',
      title: `导入整合包 ${label}`,
      run: async ({ signal, progress }) => {
        const result = await importModpack({
          archivePath,
          displayName: label,
          source: 'local',
          gameDir: settings.gameDir,
          settings,
          downloadSource: settings.source,
          concurrency: settings.downloadConcurrency,
          signal,
          onProgress: progress
        })
        return finalizeModpack(result.instance)
      }
    })
  })

  ipcMain.handle('local-packs:scan', async (_event, rawExtra: unknown) => {
    const extras = (Array.isArray(rawExtra) ? rawExtra : [rawExtra])
      .filter(
        (path): path is string =>
          typeof path === 'string' && path.trim().length > 0 && isAbsolute(path.trim())
      )
      .map((path) => path.trim())
    return scanLocalPacks(extras)
  })

  ipcMain.handle('local-packs:import', async (_event, rawRequest: unknown) => {
    const request = parseLocalPackImportRequest(rawRequest)
    const settings = getSettings()
    if (request.kind === 'instance' && !existsSync(request.path)) {
      throw new Error('本地整合包目录不存在')
    }
    if (request.kind === 'archive' && !/\.(?:mrpack|zip)$/i.test(request.path)) {
      throw new Error('本地整合包文件必须是 .mrpack 或 .zip')
    }
    const label =
      basename(request.path).replace(/\.(?:mrpack|zip)$/i, '').slice(0, 80) || '本地整合包'
    const title = `导入本地整合包 ${label}`
    const running = taskManager
      .list()
      .find(
        (task) =>
          task.status === 'running' &&
          task.kind === 'modpack' &&
          task.title === title
      )
    if (running) return running
    return taskManager.start({
      kind: 'modpack',
      title,
      run: async ({ signal, progress }) => {
        if (request.kind === 'archive') {
          const result = await importModpack({
            archivePath: request.path,
            displayName: label,
            source: 'local',
            gameDir: settings.gameDir,
            settings,
            downloadSource: settings.source,
            concurrency: settings.downloadConcurrency,
            signal,
            onProgress: progress
          })
          return finalizeModpack(result.instance)
        }
        const result = await importInstalledPack({
          path: request.path,
          settings,
          signal,
          onProgress: progress
        })
        return finalizeModpack(result.instance)
      }
    })
  })

  ipcMain.handle('instances:install-modrinth', async (_event, rawRequest: unknown) => {
    const request = parseModrinthRequest(rawRequest)
    const running = taskManager
      .list()
      .find(
        (task) =>
          task.status === 'running' &&
          task.kind === 'modpack' &&
          task.projectId === request.projectId
      )
    if (running) return running

    const settings = getSettings()
    return taskManager.start({
      kind: 'modpack',
      title: `安装整合包 ${request.title}`,
      projectId: request.projectId,
      run: async ({ signal, progress }) => {
        const selection = await pickModpackVersion(
          request.projectId,
          signal,
          request.versionId ?? undefined
        )
        progress({
          stage: `准备 ${selection.versionNumber}`,
          percent: 1,
          detail: { current: 0, total: 0, bytesDone: 0, bytesTotal: 0, speed: 0 }
        })
        const tempDir = join(app.getPath('temp'), 'windletter-modpacks')
        let downloaded = 0
        let archiveSpeed = 0
        let archiveTick = Date.now()
        let archiveLastDone = 0
        let archiveLastReport = 0
        const archivePath = await downloadModpackArchive(
          selection,
          tempDir,
          signal,
          (bytes) => {
            downloaded += bytes
            const now = Date.now()
            if (now - archiveTick >= 500) {
              archiveSpeed = (downloaded - archiveLastDone) / ((now - archiveTick) / 1000)
              archiveTick = now
              archiveLastDone = downloaded
            }
            if (now - archiveLastReport < 300) return
            archiveLastReport = now
            progress({
              stage: `下载 ${selection.file.filename}`,
              percent: 2 + (downloaded / Math.max(1, selection.file.size ?? 1)) * 8,
              detail: {
                current: 0,
                total: 1,
                bytesDone: downloaded,
                bytesTotal: selection.file.size ?? 0,
                speed: archiveSpeed,
                activeFiles: [
                  {
                    label: selection.file.filename,
                    bytes: downloaded,
                    size: selection.file.size ?? 0
                  }
                ]
              }
            })
          },
          settings.modrinthMirror
        )
        try {
          const result = await importModpack({
            archivePath,
            displayName: request.title,
            summary: request.summary,
            iconUrl: request.iconUrl,
            source: 'modrinth',
            projectId: request.projectId,
            gameDir: settings.gameDir,
            settings,
            downloadSource: settings.source,
            concurrency: settings.downloadConcurrency,
            signal,
            onProgress: (info) => progress({ ...info, percent: 10 + info.percent * 0.9 })
          })
          return finalizeModpack(result.instance)
        } finally {
          await fs.rm(archivePath, { force: true }).catch(() => undefined)
        }
      }
    })
  })

  ipcMain.handle('instances:install-curseforge', async (_event, rawRequest: unknown) => {
    const request = parseCurseForgeRequest(rawRequest)
    const running = taskManager
      .list()
      .find(
        (task) =>
          task.status === 'running' &&
          task.kind === 'modpack' &&
          task.projectId === request.projectId
      )
    if (running) return running
    const settings = getSettings()
    return taskManager.start({
      kind: 'modpack',
      title: `安装整合包 ${request.title}`,
      projectId: request.projectId,
      run: async ({ signal, progress }) => {
        const result = await installCurseForgeModpack({
          projectId: request.projectId,
          fileId: request.fileId,
          title: request.title,
          summary: request.summary,
          iconUrl: request.iconUrl,
          manualFiles: request.manualFiles,
          settings,
          signal,
          onProgress: progress
        })
        return finalizeModpack(result.instance)
      }
    })
  })

  ipcMain.handle('instances:create-loader', async (_event, rawRequest: unknown) => {
    const request = parseLoaderRequest(rawRequest)
    const settings = getSettings()
    const label = loaderTitle(request.loader)
    const title = `创建 ${label} ${request.gameVersion} 实例`
    const running = taskManager
      .list()
      .find(
        (task) =>
          task.kind === 'instance' &&
          task.title === title &&
          (task.status === 'running' || task.status === 'paused')
      )
    if (running) return running
    return taskManager.start({
      kind: 'instance',
      title,
      run: async ({ signal, progress }) => {
        const instance = await createLoaderInstance({ request, settings, signal, onProgress: progress })
        return finalizeModpack(instance)
      }
    })
  })

  ipcMain.handle('instances:create-vanilla', async (_event, rawRequest: unknown) => {
    const request = parseVanillaRequest(rawRequest)
    const settings = getSettings()
    const title = `创建原版 ${request.gameVersion} 实例`
    const running = taskManager
      .list()
      .find(
        (task) =>
          task.kind === 'instance' &&
          task.title === title &&
          (task.status === 'running' || task.status === 'paused')
      )
    if (running) return running
    return taskManager.start({
      kind: 'instance',
      title,
      versionId: request.gameVersion,
      run: async ({ signal, progress }) => {
        const instance = await createVanillaInstance({ request, settings, signal, onProgress: progress })
        return finalizeModpack(instance)
      }
    })
  })

  ipcMain.handle('instances:update-loader', async (_event, rawRequest: unknown) => {
    if (!rawRequest || typeof rawRequest !== 'object') throw new Error('无效的加载器更新请求')
    const value = rawRequest as Record<string, unknown>
    const instanceId = parseInstanceId(value.instanceId)
    if (
      typeof value.loaderVersion !== 'string' ||
      !/^[A-Za-z0-9._+\-]{1,64}$/.test(value.loaderVersion.trim())
    ) {
      throw new Error('无效的加载器版本')
    }
    const loaderVersion = value.loaderVersion.trim()
    const instance = await getInstance(instanceId)
    if (instance.loader === 'vanilla') throw new Error('原版实例没有加载器')
    if (
      loaderVersionKey(instance.loader, instance.gameVersion, instance.loaderVersion) ===
      loaderVersionKey(instance.loader, instance.gameVersion, loaderVersion)
    ) {
      throw new Error('这已经是当前加载器版本')
    }
    const label = loaderTitle(instance.loader)
    return taskManager.start({
      kind: 'loader',
      title: `更新 ${label} ${instance.loaderVersion ?? '未知版本'} → ${loaderVersion}`,
      instanceId: instance.id,
      versionId: instance.versionId,
      run: async ({ signal, progress }) => {
        const updated = await updateLoaderForInstance({
          instanceId,
          loaderVersion,
          settings: getSettings(),
          signal,
          onProgress: progress
        })
        return { instanceId: updated.id }
      }
    })
  })

  ipcMain.handle('instances:loader-rollback-state', async (_event, rawInstance: unknown) => {
    return getLoaderRollbackState(parseInstanceId(rawInstance))
  })

  ipcMain.handle('instances:rollback-loader', async (_event, rawInstance: unknown) => {
    const instanceId = parseInstanceId(rawInstance)
    const instance = await getInstance(instanceId)
    const record = await getLoaderRollbackState(instance.id)
    if (!record) throw new Error('没有可回滚的加载器更新')
    const label = loaderTitle(instance.loader)
    return taskManager.start({
      kind: 'loader',
      title: `回滚 ${label} ${record.toLoaderVersion} → ${record.fromLoaderVersion}`,
      instanceId: instance.id,
      versionId: instance.versionId,
      run: async ({ signal, progress }) => {
        const updated = await rollbackLoaderForInstance({
          instanceId,
          settings: getSettings(),
          signal,
          onProgress: progress
        })
        return { instanceId: updated.id }
      }
    })
  })

  ipcMain.handle('loaders:versions', async (_event, rawGameVersion: unknown, rawLoader: unknown) => {
    const gameVersion =
      typeof rawGameVersion === 'string' && /^[A-Za-z0-9._+\-]{1,64}$/.test(rawGameVersion)
        ? rawGameVersion
        : null
    if (!gameVersion) throw new Error('无效的 Minecraft 版本')
    if (
      rawLoader !== 'fabric' &&
      rawLoader !== 'quilt' &&
      rawLoader !== 'forge' &&
      rawLoader !== 'neoforge' &&
      rawLoader !== 'optifine'
    ) {
      throw new Error('无效的加载器')
    }
    return listLoaderVersions(gameVersion, rawLoader)
  })

  ipcMain.handle(
    'mods:search-catalog',
    async (
      _event,
      rawProvider: unknown,
      rawQuery: unknown,
      rawGameVersion: unknown,
      rawLoader: unknown,
      rawOffset: unknown,
      rawKind: unknown
    ) => {
      const provider: ContentProvider = rawProvider === 'curseforge' ? 'curseforge' : 'modrinth'
      const query = typeof rawQuery === 'string' ? rawQuery.trim().slice(0, 100) : ''
      const gameVersion =
        typeof rawGameVersion === 'string' && /^[A-Za-z0-9._+\-]{1,64}$/.test(rawGameVersion)
          ? rawGameVersion
          : ''
      const loader = typeof rawLoader === 'string' ? rawLoader.toLowerCase() : ''
      const offset = Number.isFinite(Number(rawOffset)) ? Math.max(0, Math.round(Number(rawOffset))) : 0
      const kind = parseContentKind(rawKind)
      if (provider === 'curseforge') {
        return searchCurseForgeMods(query, gameVersion, loader, offset, getSettings(), kind)
      }
      return searchModrinthMods(query, gameVersion, loader, offset, kind)
    }
  )

  ipcMain.handle('mods:versions', async (_event, rawProvider: unknown, rawProject: unknown, rawKind: unknown) => {
    const provider: ContentProvider = rawProvider === 'curseforge' ? 'curseforge' : 'modrinth'
    const projectId =
      typeof rawProject === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(rawProject) ? rawProject : null
    if (!projectId) throw new Error('无效的模组标识')
    return listModVersions(provider, projectId, getSettings(), parseContentKind(rawKind))
  })

  ipcMain.handle('mods:download', async (_event, rawRequest: unknown) => {
    if (!rawRequest || typeof rawRequest !== 'object') throw new Error('无效的模组请求')
    const value = rawRequest as Record<string, unknown>
    const provider: ContentProvider = value.provider === 'curseforge' ? 'curseforge' : 'modrinth'
    const projectId =
      typeof value.projectId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value.projectId)
        ? value.projectId
        : null
    const gameVersion =
      typeof value.gameVersion === 'string' && /^[A-Za-z0-9._+\-]{1,64}$/.test(value.gameVersion)
        ? value.gameVersion
        : null
    if (!projectId || !gameVersion) throw new Error('无效的模组下载参数')
    const loader = typeof value.loader === 'string' ? value.loader.toLowerCase() : ''
    const versionId =
      typeof value.versionId === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value.versionId)
        ? value.versionId
        : null
    return downloadModPackage(
      {
        provider,
        projectId,
        gameVersion,
        loader,
        versionId,
        kind: parseContentKind(value.kind),
        includeDependencies: value.includeDependencies !== false
      },
      getSettings()
    )
  })

  ipcMain.handle('local-packs:import-many', async (_event, rawRequests: unknown) => {
    if (!Array.isArray(rawRequests) || rawRequests.length === 0) {
      throw new Error('请选择要添加的本地整合包')
    }
    const requests = rawRequests.map(parseLocalPackImportRequest)
    if (requests.length > 50) {
      throw new Error('一次最多批量添加 50 个本地整合包')
    }
    const settings = getSettings()
    const singleLabel =
      basename(requests[0].path).replace(/\.(?:mrpack|zip)$/i, '').slice(0, 80) || '本地整合包'
    const title =
      requests.length === 1
        ? `导入本地整合包 ${singleLabel}`
        : `批量添加 ${requests.length} 个本地整合包`
    const running = taskManager
      .list()
      .find(
        (task) =>
          task.status === 'running' && task.kind === 'modpack' && task.title === title
      )
    if (running) return running
    return taskManager.start({
      kind: 'modpack',
      title,
      run: async ({ signal, progress }) => {
        let lastInstanceId: string | undefined
        for (let index = 0; index < requests.length; index += 1) {
          if (signal.aborted) throw new CancellationError()
          const request = requests[index]
          const label =
            basename(request.path).replace(/\.(?:mrpack|zip)$/i, '').slice(0, 80) || '本地整合包'
          if (request.kind === 'instance' && !existsSync(request.path)) {
            throw new Error(`本地整合包目录不存在：${label}`)
          }
          if (request.kind === 'archive' && !/\.(?:mrpack|zip)$/i.test(request.path)) {
            throw new Error(`本地整合包文件必须是 .mrpack 或 .zip：${label}`)
          }
          const basePercent = (index / requests.length) * 100
          const span = 100 / requests.length
          const scaledProgress = (info: {
            stage: string
            percent: number
            detail: {
              current: number
              total: number
              bytesDone: number
              bytesTotal: number
              speed: number
            }
            parallel?: TaskParallelState
          }) =>
            progress({
              stage: `(${index + 1}/${requests.length}) ${info.stage}`,
              percent: basePercent + (Math.max(0, Math.min(100, info.percent)) / 100) * span,
              detail: info.detail,
              parallel: info.parallel
            })
          progress({
            stage: `(${index + 1}/${requests.length}) ${label}`,
            percent: basePercent,
            detail: { current: index, total: requests.length, bytesDone: 0, bytesTotal: 0, speed: 0 }
          })
          const result =
            request.kind === 'archive'
              ? await importModpack({
                  archivePath: request.path,
                  displayName: label,
                  source: 'local',
                  gameDir: settings.gameDir,
                  settings,
                  downloadSource: settings.source,
                  concurrency: settings.downloadConcurrency,
                  signal,
                  onProgress: scaledProgress
                })
              : await importInstalledPack({
                  path: request.path,
                  settings,
                  signal,
                  onProgress: scaledProgress
                })
          lastInstanceId = result.instance.id
        }
        if (lastInstanceId) {
          const last = await getInstance(lastInstanceId)
          await finalizeModpack(last)
          return { instanceId: lastInstanceId }
        }
        return {}
      }
    })
  })

  ipcMain.handle(
    'mods:search',
    async (_event, rawProvider: unknown, rawQuery: unknown, rawInstance: unknown, rawOffset: unknown) => {
      const provider: ContentProvider =
        rawProvider === 'curseforge' ? 'curseforge' : 'modrinth'
      const query = typeof rawQuery === 'string' ? rawQuery.trim().slice(0, 100) : ''
      const instanceId = parseInstanceId(rawInstance)
      const offset = Number.isFinite(Number(rawOffset)) ? Math.max(0, Math.round(Number(rawOffset))) : 0
      const instance = await getInstance(instanceId)
      if (instance.loader === 'vanilla') {
        throw new Error('这个实例没有安装加载器，无法安装模组')
      }
      const settings = getSettings()
      if (provider === 'curseforge') {
        return searchCurseForgeMods(query, instance.gameVersion, instance.loader, offset, settings)
      }
      return searchModrinthMods(query, instance.gameVersion, instance.loader, offset)
    }
  )

  ipcMain.handle('mods:install', async (_event, rawRequest: unknown) => {
    const request = parseModInstallRequest(rawRequest)
    return installMod(request, getSettings())
  })

  ipcMain.handle('presets:list', () => listPresetMods())

  ipcMain.handle('presets:add', async (_event, rawInput: unknown) => {
    if (!rawInput || typeof rawInput !== 'object') throw new Error('无效的预设模组')
    return addPresetMod(rawInput as PresetModInput)
  })

  ipcMain.handle(
    'presets:remove',
    async (_event, rawProvider: unknown, rawProjectId: unknown) => {
      return removePresetMod(rawProvider, rawProjectId)
    }
  )

  ipcMain.handle('presets:set-auto', async (_event, rawEnabled: unknown) => {
    return setPresetAutoInstall(rawEnabled === true)
  })

  ipcMain.handle('presets:check', async (_event, rawInstance: unknown) => {
    return checkPresetMods(rawInstance)
  })

  ipcMain.handle('presets:install', async (_event, rawRequest: unknown) => {
    const request = parsePresetInstallRequest(rawRequest)
    const instance = await getInstance(request.instanceId)
    if (instance.loader === 'vanilla') throw new Error('原版实例不能安装模组')
    const title = `安装预设模组 · ${instance.name}`
    const running = taskManager
      .list()
      .find(
        (task) =>
          task.kind === 'preset' &&
          task.title === title &&
          (task.status === 'running' || task.status === 'paused')
      )
    if (running) return running
    const settings = getSettings()
    return taskManager.start({
      kind: 'preset',
      title,
      instanceId: instance.id,
      versionId: instance.versionId,
      run: async ({ signal, progress }) => {
        const result = await installPresetMods({
          request,
          settings,
          signal,
          onProgress: progress
        })
        return {
          instanceId: result.instanceId,
          message: presetManualMessage(result.manual),
          manualMods: result.manual
        }
      }
    })
  })

  ipcMain.handle('search-aliases:list', () => listCustomSearchAliases())

  ipcMain.handle('search-aliases:import-mcmod', async (_event, rawUrl: unknown) => {
    return importCustomSearchAlias(rawUrl)
  })

  ipcMain.handle('search-aliases:remove', async (_event, rawId: unknown) => {
    return removeCustomSearchAlias(rawId)
  })

  ipcMain.handle('ledger:scan', async (_event, rawInstance: unknown, rawForce: unknown) => {
    return scanContentLedger(parseInstanceId(rawInstance), rawForce === true)
  })

  ipcMain.handle('ledger:check', async (_event, rawInstance: unknown, rawForce: unknown) => {
    return checkContentUpdates(parseInstanceId(rawInstance), rawForce === true)
  })

  ipcMain.handle('ledger:explain-update', async (_event, rawInstance: unknown) => {
    return explainContentUpdate(parseInstanceId(rawInstance))
  })

  ipcMain.handle('ledger:update', async (event, rawRequest: unknown) => {
    if (!rawRequest || typeof rawRequest !== 'object') throw new Error('无效的更新请求')
    const value = rawRequest as Record<string, unknown>
    const instanceId = parseInstanceId(value.instanceId)
    const files: { kind: ContentKind; file: string }[] = []
    for (const entry of Array.isArray(value.files) ? value.files.slice(0, 500) : []) {
      if (!entry || typeof entry !== 'object') continue
      const item = entry as Record<string, unknown>
      if (
        (item.kind === 'mod' ||
          item.kind === 'datapack' ||
          item.kind === 'resourcepack' ||
          item.kind === 'shader') &&
        typeof item.file === 'string'
      ) {
        files.push({ kind: item.kind, file: item.file.slice(0, 500) })
      }
    }
    return updateContent(instanceId, { instanceId, files }, (progress) => {
      if (!event.sender.isDestroyed()) event.sender.send('ledger:progress', progress)
    })
  })

  ipcMain.handle('ledger:rollback', async (event, rawInstance: unknown) => {
    const instanceId = parseInstanceId(rawInstance)
    return rollbackContentUpdate(instanceId, (progress) => {
      if (!event.sender.isDestroyed()) event.sender.send('ledger:progress', progress)
    })
  })

  ipcMain.handle(
    'ledger:changelog',
    async (_event, rawProvider: unknown, rawProject: unknown, rawVersion: unknown) => {
      const provider = rawProvider === 'curseforge' ? 'curseforge' : 'modrinth'
      if (
        typeof rawProject !== 'string' ||
        !/^[A-Za-z0-9_-]{1,64}$/.test(rawProject) ||
        typeof rawVersion !== 'string' ||
        !/^[A-Za-z0-9_-]{1,80}$/.test(rawVersion)
      ) {
        throw new Error('无效的更新日志请求')
      }
      return getContentChangelog(provider, rawProject, rawVersion)
    }
  )

  ipcMain.handle(
    'ledger:preview-pack',
    async (_event, rawInstance: unknown, rawKind: unknown, rawFile: unknown) => {
      return previewContentPack(
        parseInstanceId(rawInstance),
        parsePreviewableKind(rawKind),
        parsePreviewFile(rawFile)
      )
    }
  )

  ipcMain.handle(
    'ledger:preview-dir',
    async (
      _event,
      rawInstance: unknown,
      rawKind: unknown,
      rawFile: unknown,
      rawPath: unknown
    ) => {
      return previewContentDir(
        parseInstanceId(rawInstance),
        parsePreviewableKind(rawKind),
        parsePreviewFile(rawFile),
        parsePreviewPath(rawPath)
      )
    }
  )

  ipcMain.handle(
    'ledger:preview-file',
    async (
      _event,
      rawInstance: unknown,
      rawKind: unknown,
      rawFile: unknown,
      rawPath: unknown
    ) => {
      const path = parsePreviewPath(rawPath)
      if (!path) throw new Error('无效的预览路径')
      return previewContentFile(
        parseInstanceId(rawInstance),
        parsePreviewableKind(rawKind),
        parsePreviewFile(rawFile),
        path
      )
    }
  )

  ipcMain.handle(
    'ledger:preview-search',
    async (
      _event,
      rawInstance: unknown,
      rawKind: unknown,
      rawFile: unknown,
      rawQuery: unknown
    ) => {
      if (typeof rawQuery !== 'string') throw new Error('无效的搜索词')
      return searchContentPack(
        parseInstanceId(rawInstance),
        parsePreviewableKind(rawKind),
        parsePreviewFile(rawFile),
        rawQuery
      )
    }
  )

  ipcMain.handle('mods:list', async (_event, rawInstance: unknown) => {
    return listInstalledMods(parseInstanceId(rawInstance))
  })

  ipcMain.handle('mods:remove', async (_event, rawInstance: unknown, rawFile: unknown) => {
    const instanceId = parseInstanceId(rawInstance)
    if (typeof rawFile !== 'string' || !/^[^\\/]{1,200}$/.test(rawFile)) {
      throw new Error('无效的模组文件')
    }
    return removeMod(instanceId, rawFile)
  })

  ipcMain.handle(
    'mods:toggle',
    async (_event, rawInstance: unknown, rawFile: unknown, rawEnabled: unknown) => {
      const instanceId = parseInstanceId(rawInstance)
      if (typeof rawFile !== 'string' || !/^[^\\/]{1,200}$/.test(rawFile)) {
        throw new Error('无效的模组文件')
      }
      return toggleMod(instanceId, rawFile, Boolean(rawEnabled))
    }
  )

  ipcMain.handle('mods:import-files', async (_event, rawInstance: unknown) => {
    const instanceId = parseInstanceId(rawInstance)
    if (!mainWindow) return null
    const picked = await dialog.showOpenDialog(mainWindow, {
      title: '导入模组 jar',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Minecraft 模组', extensions: ['jar'] }]
    })
    if (picked.canceled || picked.filePaths.length === 0) return null
    return importModFiles(instanceId, picked.filePaths)
  })

  ipcMain.handle('mods:open-folder', async (_event, rawInstance: unknown) => {
    const instanceId = parseInstanceId(rawInstance)
    const folder = join(await getInstanceGameDir(instanceId), 'mods')
    await fs.mkdir(folder, { recursive: true })
    const error = await shell.openPath(folder)
    if (error) throw new Error(error)
  })

  ipcMain.handle(
    'instances:remove',
    async (_event, rawId: unknown, rawDeleteExternal: unknown) => {
      const id = requireInstanceId(rawId)
      const launch = getLaunchState()
      if (launch.instanceId === id && isGameActive()) throw new Error('该实例正在运行，无法删除')
      const instance = await getInstance(id)
      await deleteInstance(id, { deleteExternalFiles: rawDeleteExternal === true })
      const removedVersions = await cleanupVersionsAfterInstanceDelete(instance)
      if (getSettings().lastInstanceId === id) {
        await updateSettings({ lastInstanceId: null, lastVersionId: null }).catch(() => undefined)
      }
      return removedVersions
    }
  )

  ipcMain.handle('instances:update-settings', async (_event, rawId: unknown, rawPatch: unknown) => {
    const id = requireInstanceId(rawId)
    if (!rawPatch || typeof rawPatch !== 'object') throw new Error('无效的实例设置')
    const value = rawPatch as Record<string, unknown>
    const patch: InstanceSettingsPatch = {}
    if ('memoryMb' in value) {
      if (value.memoryMb === null) patch.memoryMb = null
      else if (typeof value.memoryMb === 'number' && Number.isFinite(value.memoryMb)) {
        patch.memoryMb = Math.max(512, Math.min(32768, Math.round(value.memoryMb)))
      } else throw new Error('无效的内存大小')
    }
    if ('extraJvmArgs' in value) {
      if (typeof value.extraJvmArgs !== 'string') throw new Error('无效的 JVM 参数')
      patch.extraJvmArgs = value.extraJvmArgs.slice(0, 4000)
    }
    if ('javaPath' in value) {
      if (value.javaPath === null) patch.javaPath = null
      else if (typeof value.javaPath === 'string' && value.javaPath.length <= 1024) {
        patch.javaPath = value.javaPath
      } else throw new Error('无效的 Java 路径')
    }
    return updateInstanceSettings(id, patch)
  })

  ipcMain.handle('instances:update-meta', async (_event, rawId: unknown, rawPatch: unknown) => {
    const id = requireInstanceId(rawId)
    if (!rawPatch || typeof rawPatch !== 'object') throw new Error('无效的实例信息')
    const value = rawPatch as Record<string, unknown>
    const patch: InstanceMetaPatch = {}
    if ('name' in value) {
      if (typeof value.name !== 'string') throw new Error('无效的实例名称')
      patch.name = value.name
    }
    if ('summary' in value) {
      if (typeof value.summary !== 'string') throw new Error('无效的实例描述')
      patch.summary = value.summary
    }
    if ('category' in value) {
      if (typeof value.category !== 'string') throw new Error('无效的分类')
      patch.category = value.category
    }
    if ('favorite' in value) patch.favorite = Boolean(value.favorite)
    if ('iconUrl' in value) {
      if (value.iconUrl === null) patch.iconUrl = null
      else if (typeof value.iconUrl === 'string') patch.iconUrl = value.iconUrl
      else throw new Error('无效的实例图标')
    }
    return updateInstanceMeta(id, patch)
  })

  ipcMain.handle('instances:open-folder', async (_event, rawId: unknown, rawKind: unknown) => {
    const id = requireInstanceId(rawId)
    await getInstance(id)
    const root = await getInstanceGameDir(id)
    const kind =
      rawKind === 'saves' ||
      rawKind === 'mods' ||
      rawKind === 'screenshots' ||
      rawKind === 'kubejs'
        ? rawKind
        : 'version'
    const folder = kind === 'version' ? root : join(root, kind)
    await fs.mkdir(folder, { recursive: true })
    const error = await shell.openPath(folder)
    if (error) throw new Error(error)
  })

  ipcMain.handle('instances:export-script', async (_event, rawId: unknown) => {
    const id = requireInstanceId(rawId)
    const instance = await getInstance(id)
    const folder = await getInstanceGameDir(id)
    const safeName = instance.name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)
    const result = await dialog.showSaveDialog({
      title: '导出启动脚本',
      defaultPath: join(folder, `启动-${safeName}.bat`),
      filters: [{ name: '批处理文件', extensions: ['bat'] }]
    })
    if (result.canceled || !result.filePath) return null
    const content = `@echo off\r\ncd /d "${folder}"\r\nstart "" "${process.execPath}" "--launch-instance=${id}"\r\n`
    await fs.writeFile(result.filePath, content, 'utf8')
    return result.filePath
  })

  ipcMain.handle('instances:repair', async (_event, rawId: unknown) => {
    const id = requireInstanceId(rawId)
    const instance = await getInstance(id)
    const settings = getSettings()
    const running = taskManager.findRunning('install', instance.versionId)
    if (running) return running
    return taskManager.start({
      kind: 'install',
      title: `补全实例 ${instance.name}`,
      versionId: instance.versionId,
      instanceId: instance.id,
      projectId: instance.projectId ?? undefined,
      run: async ({ signal, progress }) => {
        const ensured = await ensureLaunchProfile({
          instance,
          gameVersion: instance.gameVersion,
          loader: instance.loader,
          loaderVersion: instance.loaderVersion,
          versionId: instance.versionId,
          javaMajor: instance.javaMajor,
          settings,
          signal,
          report: (stage, percent, detail) =>
            progress({ stage, percent, detail: detail ?? emptyDetail() }),
          start: 0,
          span: 100
        })
        if (
          instance.loader !== 'vanilla' &&
          ensured.loaderVersion &&
          (ensured.versionId !== instance.versionId ||
            ensured.loaderVersion !== instance.loaderVersion)
        ) {
          await updateInstanceLoader(instance.id, {
            versionId: ensured.versionId,
            loaderVersion: ensured.loaderVersion
          })
        }
        return { instanceId: instance.id }
      }
    })
  })

  ipcMain.handle('instances:transfer', async (_event, rawRequest: unknown) => {
    const value =
      rawRequest && typeof rawRequest === 'object'
        ? (rawRequest as Record<string, unknown>)
        : {}
    const id = requireInstanceId(value.instanceId)
    if (value.mode !== 'move' && value.mode !== 'clone') throw new Error('无效的实例操作')
    const targetDir = typeof value.targetDir === 'string' ? value.targetDir.trim() : ''
    if (!targetDir || !isAbsolute(targetDir)) throw new Error('请选择有效的目标版本文件夹')
    if (value.name !== undefined && typeof value.name !== 'string') {
      throw new Error('无效的实例名称')
    }
    if (isGameActive()) throw new Error('游戏运行中无法迁移或克隆实例')
    const running = taskManager.findRunning('instance')
    if (running) throw new Error('已有实例任务正在进行，请等待完成')
    const instance = await getInstance(id)
    const request: InstanceTransferRequest = {
      instanceId: id,
      mode: value.mode,
      targetDir,
      name: typeof value.name === 'string' ? value.name : undefined
    }
    return taskManager.start({
      kind: 'instance',
      title: `${request.mode === 'move' ? '迁移' : '克隆'}实例 ${instance.name}`,
      instanceId: id,
      run: async ({ signal, progress }) => {
        const result = await transferInstance(request, progress, signal)
        invalidateVersionCache()
        clearJavaCache()
        return { instanceId: result.instanceId, message: result.message }
      }
    })
  })

  ipcMain.handle(
    'instances:export-modpack',
    async (event, rawId: unknown, rawOptions: unknown, rawPath: unknown) => {
      const id = requireInstanceId(rawId)
      const instance = await getInstance(id)
      if (
        typeof rawPath !== 'string' ||
        !isAbsolute(rawPath) ||
        !/\.mrpack$/i.test(rawPath)
      ) {
        throw new Error('请选择 .mrpack 保存路径')
      }
      const value =
        rawOptions && typeof rawOptions === 'object'
          ? (rawOptions as Record<string, unknown>)
          : {}
      const options: ModpackExportOptions = {
        mods: value.mods !== false,
        config: value.config !== false,
        resourcepacks: value.resourcepacks !== false,
        shaderpacks: value.shaderpacks !== false,
        datapacks: value.datapacks !== false
      }
      const gameDir = await getInstanceGameDir(id)
      const dependencies: Record<string, string> = { minecraft: instance.gameVersion }
      if (instance.loader !== 'vanilla' && instance.loaderVersion) {
        const key =
          instance.loader === 'fabric'
            ? 'fabric-loader'
            : instance.loader === 'quilt'
              ? 'quilt-loader'
              : instance.loader
        dependencies[key] = instance.loaderVersion
      }
      const entries: StoreZipEntry[] = [
        {
          name: 'modrinth.index.json',
          data: Buffer.from(
            JSON.stringify(
              {
                formatVersion: 1,
                game: 'minecraft',
                name: instance.name.slice(0, 120),
                summary: instance.summary.slice(0, 600),
                files: [],
                dependencies
              },
              null,
              2
            )
          )
        }
      ]
      const collect = async (folder: string): Promise<void> => {
        const root = join(gameDir, folder)
        if (!existsSync(root)) return
        const walk = async (dir: string): Promise<void> => {
          const items = await fs.readdir(dir, { withFileTypes: true })
          for (const item of items) {
            if (item.name === '.DS_Store' || item.name === 'desktop.ini') continue
            const full = join(dir, item.name)
            if (item.isDirectory()) {
              await walk(full)
              continue
            }
            if (!item.isFile()) continue
            const rel = relative(root, full).replace(/\\/g, '/')
            if (!rel) continue
            entries.push({ name: `overrides/${folder}/${rel}`, source: full })
          }
        }
        await walk(root)
      }
      if (options.mods) await collect('mods')
      if (options.config) {
        await collect('config')
        await collect('defaultconfigs')
      }
      if (options.resourcepacks) await collect('resourcepacks')
      if (options.shaderpacks) await collect('shaderpacks')
      if (options.datapacks) await collect('datapacks')
      if (entries.length === 1) throw new Error('没有可导出的文件')
      const result = await writeStoreZip(rawPath, entries, {
        onProgress: (done, total, bytes) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send('instances:export-progress', { done, total, bytes })
          }
        }
      })
      return {
        path: rawPath,
        done: result.files,
        total: entries.length,
        bytes: result.bytes
      }
    }
  )

  ipcMain.handle('instances:launch', async (_event, rawId: unknown) => {
    const id = requireInstanceId(rawId)
    const instance = await getInstance(id)
    await launchGame(instance.versionId, instance.id)
  })

  ipcMain.handle('screenshots:list', async (_event, rawId: unknown) => {
    return listScreenshots(requireInstanceId(rawId))
  })

  ipcMain.handle('screenshots:remove', async (_event, rawId: unknown, rawName: unknown) => {
    if (typeof rawName !== 'string' || !rawName) throw new Error('无效的截图文件名')
    await removeScreenshot(requireInstanceId(rawId), rawName)
  })

  ipcMain.handle('screenshots:copy', async (_event, rawId: unknown, rawName: unknown) => {
    if (typeof rawName !== 'string' || !rawName) throw new Error('无效的截图文件名')
    await copyScreenshot(requireInstanceId(rawId), rawName)
  })

  ipcMain.handle('screenshots:open', async (_event, rawId: unknown, rawName: unknown) => {
    if (typeof rawName !== 'string' || !rawName) throw new Error('无效的截图文件名')
    await openScreenshot(requireInstanceId(rawId), rawName)
  })

  ipcMain.handle('backups:overview', () => getBackupOverview())
  ipcMain.handle('backups:cleanup', async (_event, rawRequest: unknown) => {
    if (!rawRequest || typeof rawRequest !== 'object') {
      throw new Error('无效的备份清理请求')
    }
    return cleanupBackups(rawRequest as BackupCleanupRequest)
  })

  ipcMain.handle('worlds:list', async (_event, rawId: unknown) => {
    const instance = await getInstance(requireInstanceId(rawId))
    return listWorlds(worldVaultContextFor(instance))
  })

  ipcMain.handle('worlds:backups', async (_event, rawId: unknown, rawFolder: unknown) => {
    const instance = await getInstance(requireInstanceId(rawId))
    const folder = typeof rawFolder === 'string' ? rawFolder.trim() : ''
    if (!folder) throw new Error('无效的存档文件夹名')
    return listWorldBackups(worldVaultContextFor(instance), folder)
  })

  ipcMain.handle('worlds:backup', async (_event, rawId: unknown, rawFolder: unknown) => {
    const instance = await getInstance(requireInstanceId(rawId))
    assertWorldIdle(instance)
    const running = taskManager.findRunning('world')
    if (running) throw new Error('已有存档任务正在进行，请等待完成')
    const folder =
      typeof rawFolder === 'string' && rawFolder.trim() ? rawFolder.trim() : null
    const context = worldVaultContextFor(instance)
    return taskManager.start({
      kind: 'world',
      title: folder ? `备份存档 · ${instance.name}` : `备份全部存档 · ${instance.name}`,
      run: async ({ signal, progress }) => {
        const result = await backupWorlds({
          context,
          worldFolders: folder ? [folder] : null,
          kind: 'manual',
          signal,
          onProgress: progress
        })
        return {
          instanceId: instance.id,
          message:
            result.created > 0
              ? `已备份 ${result.created} 个存档`
              : '没有可备份的存档'
        }
      }
    })
  })

  ipcMain.handle(
    'worlds:restore',
    async (_event, rawId: unknown, rawFolder: unknown, rawBackupId: unknown) => {
      const instance = await getInstance(requireInstanceId(rawId))
      assertWorldIdle(instance)
      const folder = typeof rawFolder === 'string' ? rawFolder.trim() : ''
      const backupId = typeof rawBackupId === 'string' ? rawBackupId.trim() : ''
      if (!folder) throw new Error('无效的存档文件夹名')
      if (!/^[A-Za-z0-9-]{1,80}$/.test(backupId)) throw new Error('无效的备份编号')
      const running = taskManager.findRunning('world')
      if (running) throw new Error('已有存档任务正在进行，请等待完成')
      const context = worldVaultContextFor(instance)
      return taskManager.start({
        kind: 'world',
        title: `恢复存档 · ${instance.name}`,
        run: async ({ signal, progress }) => {
          const result = await restoreWorldBackup({
            context,
            worldFolder: folder,
            backupId,
            signal,
            onProgress: progress
          })
          return {
            instanceId: instance.id,
            message: `已恢复「${result.worldName}」`
          }
        }
      })
    }
  )

  ipcMain.handle(
    'worlds:delete-backup',
    async (_event, rawId: unknown, rawFolder: unknown, rawBackupId: unknown) => {
      const instance = await getInstance(requireInstanceId(rawId))
      const running = taskManager.findRunning('world')
      if (running) throw new Error('已有存档任务正在进行，请等待完成')
      const folder = typeof rawFolder === 'string' ? rawFolder.trim() : ''
      const backupId = typeof rawBackupId === 'string' ? rawBackupId.trim() : ''
      if (!folder) throw new Error('无效的存档文件夹名')
      await deleteWorldBackup(worldVaultContextFor(instance), folder, backupId)
    }
  )

  ipcMain.handle(
    'worlds:open-folder',
    async (_event, rawId: unknown, rawKind: unknown) => {
      const instance = await getInstance(requireInstanceId(rawId))
      const kind = rawKind === 'backups' ? 'backups' : 'saves'
      const paths = worldVaultPaths(worldVaultContextFor(instance))
      const folder = paths[kind]
      await fs.mkdir(folder, { recursive: true })
      const error = await shell.openPath(folder)
      if (error) throw new Error(error)
    }
  )

  ipcMain.handle('diagnostics:run', async (_event, rawId: unknown) => {
    return runDiagnostics(requireInstanceId(rawId))
  })
  ipcMain.handle('diagnostics:mark-known-good', async (_event, rawId: unknown) => {
    return markKnownGood(requireInstanceId(rawId))
  })
  ipcMain.handle('diagnostics:ignore-issue', async (_event, rawId: unknown, rawIssue: unknown) => {
    if (typeof rawIssue !== 'string') throw new Error('无效的问题标识')
    await ignoreIssue(requireInstanceId(rawId), rawIssue)
  })
  ipcMain.handle('diagnostics:clear-ignored', async (_event, rawId: unknown) => {
    await clearIgnored(requireInstanceId(rawId))
  })

  ipcMain.handle('ai:get-config', () => getAiConfigView())
  ipcMain.handle('ai:update-config', (_event, patch: unknown) => updateAiConfig(patch))
  ipcMain.handle('ai:analyze', async (_event, rawId: unknown) => {
    return analyzeWithAi(requireInstanceId(rawId))
  })

  ipcMain.handle('servers:list', () => listServers())
  ipcMain.handle('servers:add', (_event, input: unknown) => addServer(input))
  ipcMain.handle('servers:update', (_event, rawId: unknown, input: unknown) =>
    updateServer(requireServerId(rawId), input)
  )
  ipcMain.handle('servers:remove', (_event, rawId: unknown) =>
    removeServer(requireServerId(rawId))
  )
  ipcMain.handle('servers:ping', (_event, rawId: unknown) =>
    pingServer(requireServerId(rawId))
  )
  ipcMain.handle('servers:ping-all', () => pingAllServers())
  ipcMain.handle('servers:probe', (_event, rawAddress: unknown) => {
    if (typeof rawAddress !== 'string' || rawAddress.length > 300) {
      throw new Error('无效的服务器地址')
    }
    return probeServer(rawAddress)
  })
  ipcMain.handle('servers:launch', (_event, rawId: unknown) =>
    launchServer(requireServerId(rawId))
  )

  ipcMain.handle('modrinth:search', async (_event, rawQuery: unknown, rawOffset: unknown) => {
    const query = typeof rawQuery === 'string' ? rawQuery.slice(0, 100) : ''
    const offset =
      typeof rawOffset === 'number' && Number.isFinite(rawOffset)
        ? Math.max(0, Math.min(5000, Math.round(rawOffset)))
        : 0
    return searchModpacks(query, offset)
  })

  ipcMain.handle('modrinth:versions', async (_event, rawProjectId: unknown) => {
    const projectId =
      typeof rawProjectId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(rawProjectId)
        ? rawProjectId
        : null
    if (!projectId) throw new Error('无效的整合包标识')
    return listModpackVersions(projectId)
  })

  ipcMain.handle(
    'curseforge:modpacks',
    async (
      _event,
      rawQuery: unknown,
      rawGameVersion: unknown,
      rawLoader: unknown,
      rawOffset: unknown
    ) => {
      const query = typeof rawQuery === 'string' ? rawQuery.trim().slice(0, 100) : ''
      const gameVersion =
        typeof rawGameVersion === 'string' && /^[A-Za-z0-9._+\-]{1,64}$/.test(rawGameVersion)
          ? rawGameVersion
          : ''
      const loader = typeof rawLoader === 'string' ? rawLoader.toLowerCase() : ''
      const offset = Number.isFinite(Number(rawOffset)) ? Math.max(0, Math.round(Number(rawOffset))) : 0
      return searchCurseForgeModpacks(query, gameVersion, loader, offset, getSettings())
    }
  )

  ipcMain.handle(
    'curseforge:modpack-versions',
    async (_event, rawProjectId: unknown, rawScope: unknown) => {
      const projectId =
        typeof rawProjectId === 'string' && /^\d{1,20}$/.test(rawProjectId)
          ? rawProjectId
          : null
      if (!projectId) throw new Error('无效的 CurseForge 整合包标识')
      const scope = rawScope === 'server' ? 'server' : 'client'
      return listCurseForgeModpackVersions(projectId, getSettings(), scope)
    }
  )

  ipcMain.handle('curseforge:download-server-pack', async (_event, raw: unknown) => {
    const request = parseCurseForgeServerPackRequest(raw)
    const title = `下载服务端包 ${request.title}`
    const running = taskManager
      .list()
      .find(
        (task) =>
          task.kind === 'serverPack' &&
          task.projectId === request.projectId &&
          (task.status === 'running' || task.status === 'paused')
      )
    if (running) return running
    const settings = getSettings()
    return taskManager.start({
      kind: 'serverPack',
      title,
      projectId: request.projectId,
      run: async ({ signal, progress }) => {
        const result = await downloadCurseForgeServerPack({
          projectId: request.projectId,
          fileId: request.fileId,
          title: request.title,
          slug: request.slug,
          settings,
          signal,
          onProgress: progress,
          onComplete: (path) => shell.showItemInFolder(path)
        })
        return { message: `已保存到 ${result.path}` }
      }
    })
  })

  ipcMain.handle('java:detect', async (_event, refresh: unknown) => {
    const settings = getSettings()
    return detectJava(settings.gameDir, settings.javaPath, refresh === true)
  })

  ipcMain.handle('java:assignments', () => buildJavaAssignments())

  ipcMain.handle('java:apply-assignments', async (_event, rawList: unknown) => {
    if (!Array.isArray(rawList)) throw new Error('无效的 Java 分配请求')
    const list: JavaAssignmentApply[] = rawList.slice(0, 100).map((raw) => {
      if (!raw || typeof raw !== 'object') throw new Error('无效的 Java 分配项')
      const value = raw as Record<string, unknown>
      const instanceId = requireInstanceId(value.instanceId)
      const javaPath = value.javaPath === null ? null : typeof value.javaPath === 'string' ? value.javaPath : null
      return { instanceId, javaPath }
    })
    return applyJavaAssignments(list)
  })

  ipcMain.handle('java:download-for-version', async (_event, rawId: unknown) => {
    const versionId = requireVersionId(rawId)
    const running = taskManager.findRunning('java', versionId)
    if (running) return running
    const settings = getSettings()
    const resolved = await resolveVersion(settings.gameDir, versionId)
    const requiredMajor = resolved.json.javaVersion?.majorVersion ?? null
    const component = resolved.json.javaVersion?.component
    return taskManager.start({
      kind: 'java',
      title: `补齐 Java ${requiredMajor ?? ''} 运行时`,
      versionId,
      run: async ({ signal, progress }) => {
        if (!requiredMajor) throw new Error('该版本未声明需要的 Java 版本')
        await ensureJavaForVersion({
          gameDir: settings.gameDir,
          settings: { ...settings, autoJava: true },
          requiredMajor,
          preferredComponent: component,
          source: settings.source,
          signal,
          onProgress: progress
        })
        clearJavaCache()
        progress({
          stage: 'Java 已就绪',
          percent: 100,
          detail: { current: 1, total: 1, bytesDone: 0, bytesTotal: 0, speed: 0 }
        })
      }
    })
  })

  ipcMain.handle('launch:start', async (_event, rawId: unknown) => {
    const versionId = requireVersionId(rawId)
    await launchGame(versionId)
  })
  ipcMain.handle('launch:cancel', () => cancelLaunch())
  ipcMain.handle('launch:stop', () => stopGame())
  ipcMain.handle('launch:get-state', () => getLaunchState())
  ipcMain.handle('launch:get-logs', () => getLaunchLogs())
  ipcMain.handle('running-game:inspect', () => inspectRunningGame())
  ipcMain.handle('running-game:stop', () => stopRunningGame())

  ipcMain.handle('tasks:list', () => taskManager.list())
  ipcMain.handle('tasks:cancel', (_event, id: unknown) => {
    if (typeof id === 'string') taskManager.cancel(id)
  })
  ipcMain.handle('tasks:pause', (_event, id: unknown) => {
    if (typeof id === 'string') taskManager.pause(id)
  })
  ipcMain.handle('tasks:resume', (_event, id: unknown) => {
    if (typeof id === 'string') taskManager.resume(id)
  })

  ipcMain.handle('logs:open-folder', async () => {
    await fs.mkdir(getLogDir(), { recursive: true })
    const error = await shell.openPath(getLogDir())
    if (error) throw new Error(error)
  })
  ipcMain.handle('logs:latest-path', async () => latestLogFile())
  ipcMain.handle('logs:read-latest', async () => {
    const path = await latestLogFile()
    if (!path) return ''
    try {
      const text = await fs.readFile(path, 'utf8')
      return text.length > 500_000 ? text.slice(-500_000) : text
    } catch {
      return ''
    }
  })
}

function createWindow(): void {
  const platformBackground = nativeTheme.shouldUseDarkColors ? '#181d23' : '#edf1f5'
  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 980,
    minHeight: 660,
    show: false,
    frame: false,
    backgroundColor: platformBackground,
    hasShadow: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  mainWindow = win
  allowClose = false

  win.once('ready-to-show', () => win.show())
  win.on('maximize', () => send('window:maximized', true))
  win.on('unmaximize', () => send('window:maximized', false))
  win.on('closed', () => {
    mainWindow = null
  })

  win.on('close', (event) => {
    if (allowClose || !isGameActive()) return
    event.preventDefault()
    void dialog
      .showMessageBox(win, {
        type: 'question',
        title: '游戏正在运行',
        message: 'Minecraft 仍在运行。退出启动器不会结束游戏。',
        buttons: ['最小化到任务栏', '退出启动器', '取消'],
        defaultId: 0,
        cancelId: 2,
        noLink: true
      })
      .then(({ response }) => {
        if (response === 0) win.minimize()
        else if (response === 1) {
          allowClose = true
          win.close()
        }
      })
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault()
  })
  win.webContents.on('before-input-event', (event, input) => {
    if (!app.isPackaged && input.key === 'F12' && input.type === 'keyDown') {
      win.webContents.toggleDevTools()
      event.preventDefault()
    }
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.on('second-instance', (_event, argv) => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  const launchId = launchInstanceFromArgv(argv)
  if (launchId) {
    void getInstance(launchId)
      .then((instance) => launchGame(instance.versionId, instance.id))
      .catch(() => undefined)
  }
})

app.whenReady().then(async () => {
  await loadConfig()
  await registerBackgroundProtocol()
  await registerScreenshotProtocol()
  await loadCustomSearchAliases()
  applyDownloadProxy(getSettings().downloadProxy)
  await ensureDirs()
  setContentCacheDir(join(getCacheDir(), 'objects'))
  setContentCacheLimit(getSettings().cacheLimitMb)
  Menu.setApplicationMenu(null)

  taskManager.setListener((task) => send('tasks:update', task))
  setAccountNotifier((payload) => send('auth:changed', payload))
  setLauncherEvents({
    onState: (state) => send('launch:state', state),
    onLog: (line) => send('launch:log', line),
    onGameStarted: () => {
      if (getSettings().hideAfterLaunch) mainWindow?.minimize()
    }
  })
  setPlaytimeChangedListener(() => send('playtime:changed', null))
  setUpdaterListener((payload) => send('updater:state', payload))

  registerIpc()
  createWindow()

  const launchId = launchInstanceFromArgv(process.argv)
  if (launchId) {
    setTimeout(() => {
      void getInstance(launchId)
        .then((instance) => launchGame(instance.versionId, instance.id))
        .catch(() => undefined)
    }, 1200)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  app.quit()
})
