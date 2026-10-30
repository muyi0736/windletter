import { app } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import os from 'node:os'
import { BUNDLED_CURSEFORGE_API_KEY, DEFAULT_UPDATE_FEED } from './buildSecrets'
import type {
  AccountView,
  AccountsPayload,
  AccentName,
  DownloadSource,
  LauncherSettings,
  StoredAccount,
  ThemeMode
} from '../../shared/types'

interface VersionStat {
  lastPlayed: number
}

interface ConfigData {
  settings: LauncherSettings
  accounts: StoredAccount[]
  activeAccountId: string | null
  versionStats: Record<string, VersionStat>
}

const THEMES: ThemeMode[] = ['light', 'dark', 'system']
const ACCENTS: AccentName[] = ['cyan', 'blue', 'green', 'orange', 'pink', 'violet', 'red', 'slate']
const SOURCES: DownloadSource[] = ['official', 'mirror']

let data: ConfigData | null = null
let configPath = ''
let saveQueue: Promise<void> = Promise.resolve()

export function getConfigDir(): string {
  return app.getPath('userData')
}

export function getLogDir(): string {
  return join(getConfigDir(), 'logs')
}

export function getRuntimeDir(): string {
  return join(getConfigDir(), 'runtime')
}

export function getCacheDir(): string {
  return join(getConfigDir(), 'cache')
}

export function getDefaultGameDir(): string {
  if (!app.isPackaged) return join(app.getPath('appData'), '.minecraft')
  return join(getConfigDir(), 'minecraft')
}

export function defaultSettings(): LauncherSettings {
  const halfRam = Math.floor(os.totalmem() / 1024 / 1024 / 2)
  const memory = Math.min(8192, Math.max(2048, Math.round(halfRam / 512) * 512))
  return {
    theme: 'system',
    accent: 'cyan',
    homeLayout: 'simple',
    backgroundImage: null,
    backgroundDim: 35,
    backgroundBlur: 0,
    source: 'mirror',
    modrinthMirror: true,
    localPackFolders: [],
    cacheLimitMb: 4096,
    gameDir: getDefaultGameDir(),
    versionFolders: [],
    javaPath: null,
    autoJava: true,
    maxMemoryMb: memory,
    extraJvmArgs: '',
    downloadProxy: '',
    downloadConcurrency: 32,
    lastVersionId: null,
    lastInstanceId: null,
    externalLauncherPath: null,
    msClientId: 'aa15c755-3620-4340-9218-38823f890f1a',
    curseForgeApiKey: BUNDLED_CURSEFORGE_API_KEY,
    curseForgeApiBase: 'https://api.curseforge.com',
    curseForgeCompatDownloads: false,
    curseForgeUseMirror: false,
    autoModDependencies: true,
    autoWorldBackup: true,
    worldBackupLimit: 10,
    kubeJsBackupLimit: 50,
    contentBackupLimit: 6,
    backupMaxAgeDays: 0,
    memorySaver: true,
    hideAfterLaunch: false,
    customResolution: false,
    windowWidth: 1280,
    windowHeight: 720,
    autoCheckUpdates: true,
    updateFeed: DEFAULT_UPDATE_FEED
  }
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return fallback
  return Math.min(max, Math.max(min, Math.round(num)))
}

function sanitizeVersionFolders(list: unknown[], fallback: string[]): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  for (const folder of list) {
    if (
      typeof folder !== 'string' ||
      !folder.trim() ||
      folder.length > 1024 ||
      !isAbsolute(folder.trim())
    ) {
      continue
    }
    const path = resolve(folder.trim())
    const key = path.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(path)
    if (result.length >= 20) break
  }
  return result
}

function sanitizeSettings(input: Partial<LauncherSettings>, base: LauncherSettings): LauncherSettings {
  const merged = { ...base, ...input }
  return {
    theme: THEMES.includes(merged.theme) ? merged.theme : base.theme,
    accent: ACCENTS.includes(merged.accent) ? merged.accent : base.accent,
    homeLayout: merged.homeLayout === 'classic' ? 'classic' : 'simple',
    backgroundImage: (() => {
      const value = merged.backgroundImage
      return typeof value === 'string' &&
        /^custom-[a-z0-9-]+\.(?:png|jpe?g|webp|gif|bmp|avif)$/i.test(value)
        ? value
        : null
    })(),
    backgroundDim: clamp(merged.backgroundDim, 0, 80, base.backgroundDim),
    backgroundBlur: clamp(merged.backgroundBlur, 0, 24, base.backgroundBlur),
    source: SOURCES.includes(merged.source) ? merged.source : base.source,
    modrinthMirror: Boolean(merged.modrinthMirror),
    localPackFolders: Array.isArray(merged.localPackFolders)
      ? [
          ...new Set(
            merged.localPackFolders
              .filter(
                (folder): folder is string =>
                  typeof folder === 'string' &&
                  folder.trim().length > 0 &&
                  folder.length <= 1024 &&
                  isAbsolute(folder.trim())
              )
              .map((folder) => resolve(folder.trim()))
          )
        ].slice(0, 20)
      : base.localPackFolders,
    cacheLimitMb: clamp(merged.cacheLimitMb, 0, 65536, base.cacheLimitMb),
    gameDir: typeof merged.gameDir === 'string' && merged.gameDir.trim() ? merged.gameDir.trim() : base.gameDir,
    versionFolders: Array.isArray(merged.versionFolders)
      ? sanitizeVersionFolders(merged.versionFolders, base.versionFolders)
      : base.versionFolders,
    javaPath: typeof merged.javaPath === 'string' && merged.javaPath.trim() ? merged.javaPath.trim() : null,
    autoJava: Boolean(merged.autoJava),
    maxMemoryMb: clamp(merged.maxMemoryMb, 512, 32768, base.maxMemoryMb),
    extraJvmArgs: typeof merged.extraJvmArgs === 'string' ? merged.extraJvmArgs.slice(0, 4000) : '',
    downloadProxy:
      typeof merged.downloadProxy === 'string'
        ? merged.downloadProxy.trim().slice(0, 300)
        : '',
    downloadConcurrency: clamp(merged.downloadConcurrency, 4, 128, base.downloadConcurrency),
    lastVersionId: typeof merged.lastVersionId === 'string' && merged.lastVersionId ? merged.lastVersionId : null,
    lastInstanceId:
      typeof merged.lastInstanceId === 'string' && merged.lastInstanceId ? merged.lastInstanceId : null,
    externalLauncherPath:
      typeof merged.externalLauncherPath === 'string' && merged.externalLauncherPath.trim()
        ? merged.externalLauncherPath.trim()
        : null,
    msClientId:
      typeof merged.msClientId === 'string' && merged.msClientId.trim()
        ? merged.msClientId.trim()
        : 'aa15c755-3620-4340-9218-38823f890f1a',
    curseForgeApiKey:
      typeof merged.curseForgeApiKey === 'string' && merged.curseForgeApiKey.trim()
        ? merged.curseForgeApiKey.trim().slice(0, 512)
        : BUNDLED_CURSEFORGE_API_KEY,
    curseForgeCompatDownloads: Boolean(merged.curseForgeCompatDownloads),
    curseForgeUseMirror: Boolean(merged.curseForgeUseMirror),
    autoModDependencies: merged.autoModDependencies !== false,
    autoWorldBackup: merged.autoWorldBackup !== false,
    worldBackupLimit: clamp(merged.worldBackupLimit, 1, 30, 10),
    kubeJsBackupLimit: clamp(merged.kubeJsBackupLimit, 1, 500, 50),
    contentBackupLimit: clamp(merged.contentBackupLimit, 1, 30, 6),
    backupMaxAgeDays: clamp(merged.backupMaxAgeDays, 0, 3650, 0),
    memorySaver: merged.memorySaver !== false,
    curseForgeApiBase: (() => {
      const raw =
        typeof merged.curseForgeApiBase === 'string' && merged.curseForgeApiBase.trim()
          ? merged.curseForgeApiBase.trim().replace(/\/+$/, '')
          : 'https://api.curseforge.com'
      try {
        const url = new URL(raw)
        return url.protocol === 'https:' ? url.toString().replace(/\/+$/, '') : 'https://api.curseforge.com'
      } catch {
        return 'https://api.curseforge.com'
      }
    })(),
    hideAfterLaunch: Boolean(merged.hideAfterLaunch),
    customResolution: Boolean(merged.customResolution),
    windowWidth: clamp(merged.windowWidth, 320, 7680, base.windowWidth),
    windowHeight: clamp(merged.windowHeight, 240, 4320, base.windowHeight),
    autoCheckUpdates: merged.autoCheckUpdates !== false,
    updateFeed:
      typeof merged.updateFeed === 'string' ? merged.updateFeed.trim().slice(0, 500) : ''
  }
}

export async function loadConfig(): Promise<void> {
  configPath = join(getConfigDir(), 'config.json')
  const defaults = defaultSettings()
  let parsed: Partial<ConfigData> = {}
  try {
    const raw = await fs.readFile(configPath, 'utf8')
    parsed = JSON.parse(raw) as Partial<ConfigData>
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      try {
        const broken = `${configPath}.broken-${Date.now()}`
        await fs.rename(configPath, broken)
        console.warn(`[config] 配置文件读取失败，已备份到 ${broken}`)
      } catch {
        /* ignore */
      }
    }
  }

  const accounts = Array.isArray(parsed.accounts)
    ? parsed.accounts.filter(
        (a): a is StoredAccount =>
          !!a &&
          typeof a.id === 'string' &&
          typeof a.name === 'string' &&
          typeof a.uuid === 'string' &&
          (a.type === 'offline' || a.type === 'microsoft')
      )
    : []
  const activeId =
    typeof parsed.activeAccountId === 'string' && accounts.some((a) => a.id === parsed.activeAccountId)
      ? parsed.activeAccountId
      : accounts[0]?.id ?? null

  data = {
    settings: sanitizeSettings(parsed.settings ?? {}, defaults),
    accounts,
    activeAccountId: activeId,
    versionStats:
      parsed.versionStats && typeof parsed.versionStats === 'object' ? (parsed.versionStats as Record<string, VersionStat>) : {}
  }
  await fs.mkdir(getConfigDir(), { recursive: true }).catch(() => undefined)
  await persist()
}

function requireData(): ConfigData {
  if (!data) throw new Error('配置尚未加载')
  return data
}

async function persist(): Promise<void> {
  if (!data) return
  // 构建注入的共享 key 不落盘成明文；用户自填 key 仍保留在本地配置。
  const snapshot = {
    ...data,
    settings: {
      ...data.settings,
      curseForgeApiKey:
        data.settings.curseForgeApiKey === BUNDLED_CURSEFORGE_API_KEY
          ? ''
          : data.settings.curseForgeApiKey
    }
  }
  const next = JSON.stringify(snapshot, null, 2)
  saveQueue = saveQueue.then(async () => {
    await fs.mkdir(getConfigDir(), { recursive: true })
    const tmp = `${configPath}.tmp`
    await fs.writeFile(tmp, next, 'utf8')
    await fs.rename(tmp, configPath)
  })
  return saveQueue
}

export function getSettings(): LauncherSettings {
  return { ...requireData().settings }
}

export async function updateSettings(patch: Partial<LauncherSettings>): Promise<LauncherSettings> {
  const current = requireData()
  current.settings = sanitizeSettings(patch, current.settings)
  await persist()
  return getSettings()
}

function toView(account: StoredAccount): AccountView {
  return { id: account.id, type: account.type, name: account.name, uuid: account.uuid }
}

export function accountsPayload(): AccountsPayload {
  const current = requireData()
  return {
    accounts: current.accounts.map(toView),
    activeId: current.activeAccountId
  }
}

export function listStoredAccounts(): StoredAccount[] {
  return requireData().accounts.map((a) => ({ ...a }))
}

export function getActiveAccount(): StoredAccount | null {
  const current = requireData()
  return current.accounts.find((a) => a.id === current.activeAccountId) ?? null
}

export function setActiveAccount(id: string): AccountsPayload {
  const current = requireData()
  if (!current.accounts.some((a) => a.id === id)) throw new Error('账户不存在')
  current.activeAccountId = id
  void persist()
  return accountsPayload()
}

export function saveAccount(account: StoredAccount): AccountsPayload {
  const current = requireData()
  const index = current.accounts.findIndex((a) => a.id === account.id)
  if (index >= 0) current.accounts[index] = account
  else current.accounts.push(account)
  current.activeAccountId = account.id
  void persist()
  return accountsPayload()
}

export function removeAccount(id: string): AccountsPayload {
  const current = requireData()
  current.accounts = current.accounts.filter((a) => a.id !== id)
  if (current.activeAccountId === id) current.activeAccountId = current.accounts[0]?.id ?? null
  void persist()
  return accountsPayload()
}

export function markVersionPlayed(id: string): void {
  const current = requireData()
  current.versionStats[id] = { lastPlayed: Date.now() }
  void persist()
}

export function getVersionStats(): Record<string, VersionStat> {
  return { ...requireData().versionStats }
}

export function getLastPlayed(id: string): number | null {
  return requireData().versionStats[id]?.lastPlayed ?? null
}

export function ensureDirs(): Promise<unknown> {
  return Promise.all([fs.mkdir(getLogDir(), { recursive: true }), fs.mkdir(getCacheDir(), { recursive: true })])
}

export function exists(path: string): boolean {
  return existsSync(path)
}

export function offlineUuid(name: string): string {
  const hash = createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest()
  hash[6] = (hash[6] & 0x0f) | 0x30
  hash[8] = (hash[8] & 0x3f) | 0x80
  return hash.toString('hex')
}
