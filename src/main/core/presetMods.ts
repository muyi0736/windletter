import AdmZip from 'adm-zip'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type {
  ContentProvider,
  InstanceLoader,
  LauncherSettings,
  ManualModDownload,
  PresetCheckEntry,
  PresetCheckResult,
  PresetInstallItem,
  PresetInstallRequest,
  PresetModInput,
  PresetModView,
  PresetModsPayload
} from '../../shared/types'
import { getConfigDir, getSettings } from './config'
import { pickCurseForgeModFile } from './curseforge'
import { getInstance, getInstanceGameDir, requireInstanceId } from './instances'
import { installMod, latestModrinthVersionInfo } from './mods'
import { CancellationError } from './net'
import { emptyDetail, type TaskProgress } from './progress'
import { localizedNameFor } from './searchAliases'

interface PresetStoreData {
  version: 1
  autoInstall: boolean
  items: PresetModView[]
}

interface JarIdentity {
  ids: string[]
  names: string[]
}

const MAX_PRESETS = 200
const MAX_JAR_IDENTITIES = 16
const PRESET_FILE = 'preset-mods.json'
const PROJECT_ID = /^[A-Za-z0-9_-]{1,64}$/
const VERSION_ID = /^[A-Za-z0-9._-]{1,80}$/

let saveQueue: Promise<void> = Promise.resolve()

function presetPath(): string {
  return join(getConfigDir(), PRESET_FILE)
}

function normalizeText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '')
}

function safeProvider(raw: unknown): ContentProvider {
  if (raw === 'modrinth' || raw === 'curseforge') return raw
  throw new Error('无效的模组来源')
}

function safeProjectId(raw: unknown): string {
  if (typeof raw !== 'string' || !PROJECT_ID.test(raw.trim())) {
    throw new Error('无效的模组项目标识')
  }
  return raw.trim()
}

function safeVersionId(raw: unknown): string | null {
  if (raw == null || raw === '') return null
  if (typeof raw !== 'string' || !VERSION_ID.test(raw.trim())) {
    throw new Error('无效的模组版本标识')
  }
  return raw.trim()
}

function safeIcon(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

function cleanTitle(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw.replace(/\s+/g, ' ').trim().slice(0, 160)
}

function cleanSlug(raw: unknown, fallback: string): string {
  if (typeof raw === 'string' && /^[A-Za-z0-9._-]{1,120}$/.test(raw.trim())) {
    return raw.trim()
  }
  return fallback
}

function cleanAuthor(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.replace(/\s+/g, ' ').trim().slice(0, 80)
  return value || null
}

function normalizePreset(raw: unknown): PresetModView | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  if (value.provider !== 'modrinth' && value.provider !== 'curseforge') return null
  if (typeof value.projectId !== 'string' || !PROJECT_ID.test(value.projectId)) return null
  const title = cleanTitle(value.title)
  if (!title) return null
  const slug = cleanSlug(value.slug, value.projectId)
  const addedAt =
    typeof value.addedAt === 'number' && Number.isFinite(value.addedAt)
      ? Math.max(0, Math.trunc(value.addedAt))
      : Date.now()
  return {
    provider: value.provider,
    projectId: value.projectId,
    slug,
    title,
    localizedName: localizedNameFor(slug, title, 'mod'),
    iconUrl: safeIcon(value.iconUrl),
    author: cleanAuthor(value.author),
    addedAt
  }
}

export function presetKey(provider: ContentProvider, projectId: string): string {
  return `${provider}:${projectId}`
}

async function readPresetStore(): Promise<PresetStoreData> {
  try {
    const raw = await fs.readFile(presetPath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<PresetStoreData>
    const items: PresetModView[] = []
    const seen = new Set<string>()
    for (const item of Array.isArray(parsed.items) ? parsed.items : []) {
      const normalized = normalizePreset(item)
      if (!normalized) continue
      const key = presetKey(normalized.provider, normalized.projectId)
      if (seen.has(key)) continue
      seen.add(key)
      items.push(normalized)
      if (items.length >= MAX_PRESETS) break
    }
    return {
      version: 1,
      autoInstall: parsed.autoInstall === true,
      items
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      try {
        await fs.rename(presetPath(), `${presetPath()}.broken-${Date.now()}`)
      } catch {
        /* ignore */
      }
    }
    return { version: 1, autoInstall: false, items: [] }
  }
}

async function writePresetStore(data: PresetStoreData): Promise<PresetModsPayload> {
  const snapshot: PresetStoreData = {
    version: 1,
    autoInstall: data.autoInstall === true,
    items: data.items.slice(0, MAX_PRESETS)
  }
  const next = JSON.stringify(snapshot, null, 2)
  saveQueue = saveQueue.catch(() => undefined).then(async () => {
    await fs.mkdir(getConfigDir(), { recursive: true })
    const tmp = `${presetPath()}.tmp`
    await fs.writeFile(tmp, next, 'utf8')
    await fs.rename(tmp, presetPath())
  })
  await saveQueue
  return { items: snapshot.items, autoInstall: snapshot.autoInstall }
}

export async function listPresetMods(): Promise<PresetModsPayload> {
  const data = await readPresetStore()
  return { items: data.items, autoInstall: data.autoInstall }
}

export async function addPresetMod(input: PresetModInput): Promise<PresetModsPayload> {
  if (!input || typeof input !== 'object') throw new Error('无效的预设模组')
  const provider = safeProvider(input.provider)
  const projectId = safeProjectId(input.projectId)
  const title = cleanTitle(input.title)
  if (!title) throw new Error('预设模组名称不能为空')
  const slug = cleanSlug(input.slug, projectId)
  const item: PresetModView = {
    provider,
    projectId,
    slug,
    title,
    localizedName: localizedNameFor(slug, title, 'mod'),
    iconUrl: safeIcon(input.iconUrl),
    author: cleanAuthor(input.author),
    addedAt: Date.now()
  }
  const data = await readPresetStore()
  const key = presetKey(provider, projectId)
  if (data.items.some((entry) => presetKey(entry.provider, entry.projectId) === key)) {
    return { items: data.items, autoInstall: data.autoInstall }
  }
  if (data.items.length >= MAX_PRESETS) throw new Error(`最多只能预设 ${MAX_PRESETS} 个模组`)
  data.items.push(item)
  return writePresetStore(data)
}

export async function removePresetMod(
  rawProvider: unknown,
  rawProjectId: unknown
): Promise<PresetModsPayload> {
  const provider = safeProvider(rawProvider)
  const projectId = safeProjectId(rawProjectId)
  const data = await readPresetStore()
  const key = presetKey(provider, projectId)
  data.items = data.items.filter(
    (entry) => presetKey(entry.provider, entry.projectId) !== key
  )
  return writePresetStore(data)
}

export async function setPresetAutoInstall(rawEnabled: unknown): Promise<PresetModsPayload> {
  const data = await readPresetStore()
  data.autoInstall = rawEnabled === true
  return writePresetStore(data)
}

function normalizeIdentity(values: string[]): string[] {
  return [
    ...new Set(
      values
        .map((value) => normalizeText(value))
        .filter((value) => value.length > 0)
    )
  ]
}

function readJsonIdentities(
  zip: AdmZip,
  entryName: string,
  extract: (data: Record<string, unknown>) => { id?: unknown; name?: unknown; provides?: unknown }
): { ids: string[]; names: string[] } | null {
  const entry = zip.getEntry(entryName)
  if (!entry || entry.header.size > 1_000_000) return null
  try {
    const parsed = JSON.parse(entry.getData().toString('utf8')) as Record<string, unknown>
    const info = extract(parsed)
    const ids: string[] = []
    const names: string[] = []
    if (typeof info.id === 'string' && info.id.trim()) ids.push(info.id.trim())
    if (typeof info.name === 'string' && info.name.trim()) names.push(info.name.trim())
    if (Array.isArray(info.provides)) {
      for (const value of info.provides) {
        if (typeof value === 'string' && value.trim()) ids.push(value.trim())
        else if (value && typeof value === 'object') {
          const provided = (value as Record<string, unknown>).id
          if (typeof provided === 'string' && provided.trim()) ids.push(provided.trim())
        }
      }
    }
    return { ids: ids.slice(0, MAX_JAR_IDENTITIES), names: names.slice(0, MAX_JAR_IDENTITIES) }
  } catch {
    return null
  }
}

function readTomlIdentities(
  zip: AdmZip,
  entryName: string
): { ids: string[]; names: string[] } | null {
  const entry = zip.getEntry(entryName)
  if (!entry || entry.header.size > 1_000_000) return null
  try {
    const text = entry.getData().toString('utf8')
    const ids: string[] = []
    const names: string[] = []
    // 只读取 [[mods]] 段。[[dependencies.*]] 里的 modId 是前置，不是这个 jar 提供的模组；
    // 把它们当成自身会导致“装了一个依赖它的模组，就误判预设模组已存在”。
    for (const section of text.matchAll(/\[\[mods\]\]([\s\S]*?)(?=\n\s*\[\[|$)/gi)) {
      const body = section[1] ?? ''
      for (const match of body.matchAll(/^\s*modId\s*=\s*["']([^"']+)["']/gim)) {
        if (match[1]) ids.push(match[1])
      }
      for (const match of body.matchAll(/^\s*displayName\s*=\s*["']([^"']+)["']/gim)) {
        if (match[1]) names.push(match[1])
      }
    }
    if (ids.length === 0) return null
    return {
      ids: ids.slice(0, MAX_JAR_IDENTITIES),
      names: names.slice(0, MAX_JAR_IDENTITIES)
    }
  } catch {
    return null
  }
}

function readLegacyIdentities(
  zip: AdmZip
): { ids: string[]; names: string[] } | null {
  const entry = zip.getEntry('mcmod.info')
  if (!entry || entry.header.size > 1_000_000) return null
  try {
    const raw = JSON.parse(entry.getData().toString('utf8')) as unknown
    const list = Array.isArray(raw)
      ? raw
      : raw && typeof raw === 'object' && Array.isArray((raw as { modList?: unknown }).modList)
        ? ((raw as { modList: unknown[] }).modList)
        : []
    const ids: string[] = []
    const names: string[] = []
    for (const value of list) {
      if (!value || typeof value !== 'object') continue
      const item = value as Record<string, unknown>
      if (typeof item.modid === 'string' && item.modid.trim()) ids.push(item.modid.trim())
      if (typeof item.name === 'string' && item.name.trim()) names.push(item.name.trim())
    }
    if (ids.length === 0) return null
    return {
      ids: ids.slice(0, MAX_JAR_IDENTITIES),
      names: names.slice(0, MAX_JAR_IDENTITIES)
    }
  } catch {
    return null
  }
}

async function readJarIdentity(path: string): Promise<JarIdentity | null> {
  let zip: AdmZip
  try {
    zip = new AdmZip(path)
  } catch {
    return null
  }
  try {
    const found: { ids: string[]; names: string[] }[] = []
    const fabric = readJsonIdentities(zip, 'fabric.mod.json', (data) => ({
      id: data.id,
      name: data.name,
      provides: data.provides
    }))
    if (fabric) found.push(fabric)
    const quilt = readJsonIdentities(zip, 'quilt.mod.json', (data) => {
      const loader =
        data.quilt_loader && typeof data.quilt_loader === 'object'
          ? (data.quilt_loader as Record<string, unknown>)
          : {}
      const metadata =
        loader.metadata && typeof loader.metadata === 'object'
          ? (loader.metadata as Record<string, unknown>)
          : {}
      return {
        id: loader.id,
        name: metadata.name,
        provides: loader.provides
      }
    })
    if (quilt) found.push(quilt)
    for (const path of ['META-INF/neoforge.mods.toml', 'META-INF/mods.toml']) {
      const toml = readTomlIdentities(zip, path)
      if (toml) found.push(toml)
    }
    const legacy = readLegacyIdentities(zip)
    if (legacy) found.push(legacy)
    if (found.length === 0) return null
    return {
      ids: normalizeIdentity(found.flatMap((item) => item.ids)),
      names: normalizeIdentity(found.flatMap((item) => item.names))
    }
  } catch {
    // 重复目录条目等 adm-zip 拒绝但加载器可读的 jar：跳过识别即可。
    return null
  }
}

function filenameCanMatchPreset(filename: string, preset: PresetModView): boolean {
  if (!filename.toLowerCase().endsWith('.jar') && !filename.toLowerCase().endsWith('.jar.disabled')) {
    return false
  }
  const stem = filename
    .replace(/\.disabled$/i, '')
    .replace(/\.jar$/i, '')
  const normalized = normalizeText(stem)
  const candidates = [normalizeText(preset.slug), normalizeText(preset.title)].filter(Boolean)
  if (candidates.includes(normalized)) return true
  for (const candidate of candidates) {
    if (!normalized.startsWith(candidate)) continue
    const suffix = normalized.slice(candidate.length)
    if (!suffix) return true
    // sodium-fabric-0.5.8 / iris-1.7.6 / fabric-api-0.92.2 这类文件名允许版本后缀，
    // 但不会把 sodium-extra 误判成 sodium。
    if (
      /^(?:(?:fabric|quilt|forge|neoforge|mc)[-_]?)*\d/.test(suffix) ||
      /^(?:(?:fabric|quilt|forge|neoforge|mc)[-_]?)+$/.test(suffix)
    ) {
      return true
    }
  }
  return false
}

function identityMatchesPreset(identity: JarIdentity, preset: PresetModView): boolean {
  const candidates = new Set(
    [normalizeText(preset.slug), normalizeText(preset.title)].filter(Boolean)
  )
  return (
    identity.ids.some((value) => candidates.has(value)) ||
    identity.names.some((value) => candidates.has(value))
  )
}

interface ModFileInfo {
  name: string
  enabled: boolean
  path: string
}

async function listJarFiles(gameDir: string): Promise<ModFileInfo[]> {
  const modsDir = join(gameDir, 'mods')
  let entries
  try {
    entries = await fs.readdir(modsDir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => ({
      name: entry.name,
      enabled: !entry.name.toLowerCase().endsWith('.disabled'),
      path: join(modsDir, entry.name)
    }))
    .filter(
      (entry) =>
        entry.name.toLowerCase().endsWith('.jar') ||
        entry.name.toLowerCase().endsWith('.jar.disabled')
    )
    .slice(0, 2000)
}

async function detectPresence(
  gameDir: string,
  presets: PresetModView[]
): Promise<Map<string, { enabled: boolean }>> {
  const present = new Map<string, { enabled: boolean }>()
  if (presets.length === 0) return present
  const unresolved = new Map(presets.map((preset) => [presetKey(preset.provider, preset.projectId), preset]))
  const files = await listJarFiles(gameDir)

  // 先按文件名快速匹配，能覆盖绝大多数正常命名的 mod。
  for (const file of files) {
    if (unresolved.size === 0) break
    for (const [key, preset] of unresolved) {
      if (!filenameCanMatchPreset(file.name, preset)) continue
      present.set(key, { enabled: file.enabled })
      unresolved.delete(key)
      break
    }
  }
  if (unresolved.size === 0) return present

  const queue = files.slice()
  let cursor = 0
  const workers = Array.from(
    { length: Math.max(1, Math.min(6, files.length)) },
    async () => {
      while (true) {
        const index = cursor
        cursor += 1
        if (index >= queue.length || unresolved.size === 0) return
        const file = queue[index]
        const identity = await readJarIdentity(file.path)
        if (!identity) continue
        for (const [key, preset] of unresolved) {
          if (!identityMatchesPreset(identity, preset)) continue
          present.set(key, { enabled: file.enabled })
          unresolved.delete(key)
        }
      }
    }
  )
  await Promise.all(workers)
  return present
}

function loaderName(loader: InstanceLoader): string {
  if (loader === 'neoforge') return 'NeoForge'
  if (loader === 'fabric') return 'Fabric'
  if (loader === 'quilt') return 'Quilt'
  if (loader === 'forge') return 'Forge'
  return '原版'
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

async function resolvePresetVersion(
  preset: PresetModView,
  gameVersion: string,
  loader: InstanceLoader,
  settings: LauncherSettings
): Promise<{
  compatible: boolean
  versionId: string | null
  versionNumber: string | null
  fileSize: number | null
  message: string | null
}> {
  if (preset.provider === 'modrinth') {
    const version = await latestModrinthVersionInfo(
      preset.projectId,
      gameVersion,
      loader,
      'mod'
    )
    if (!version) {
      return {
        compatible: false,
        versionId: null,
        versionNumber: null,
        fileSize: null,
        message: `没有适用于 Minecraft ${gameVersion} · ${loaderName(loader)} 的版本`
      }
    }
    return {
      compatible: true,
      versionId: version.versionId,
      versionNumber: version.versionNumber,
      fileSize: version.fileSize,
      message: null
    }
  }
  const selection = await pickCurseForgeModFile(
    preset.projectId,
    gameVersion,
    loader,
    settings,
    null,
    'mod'
  )
  return {
    compatible: true,
    versionId: selection.fileId,
    versionNumber: selection.versionNumber,
    fileSize: selection.size,
    message: null
  }
}

export async function checkPresetMods(rawInstanceId: unknown): Promise<PresetCheckResult> {
  const instanceId = requireInstanceId(rawInstanceId)
  const instance = await getInstance(instanceId)
  const store = await readPresetStore()
  const base = {
    instanceId: instance.id,
    instanceName: instance.name,
    gameVersion: instance.gameVersion,
    loader: instance.loader,
    autoInstall: store.autoInstall
  }
  if (store.items.length === 0) {
    return {
      ...base,
      applicable: false,
      reason: '还没有预设模组，先在实例页添加常用模组。',
      entries: []
    }
  }
  if (instance.loader === 'vanilla') {
    return {
      ...base,
      applicable: false,
      reason: '原版实例不能安装模组；预设只检查带加载器的实例。',
      entries: store.items.map((item) => ({
        ...item,
        present: false,
        enabled: false,
        compatible: false,
        versionId: null,
        versionNumber: null,
        fileSize: null,
        message: '原版实例不能安装模组'
      }))
    }
  }

  const gameDir = await getInstanceGameDir(instance.id)
  let presence = new Map<string, { enabled: boolean }>()
  try {
    presence = await detectPresence(gameDir, store.items)
  } catch {
    presence = new Map()
  }
  const settings = getSettings()
  const entries = await mapLimit(store.items, 3, async (item): Promise<PresetCheckEntry> => {
    const key = presetKey(item.provider, item.projectId)
    const known = presence.get(key)
    if (known) {
      return {
        ...item,
        present: true,
        enabled: known.enabled,
        compatible: true,
        versionId: null,
        versionNumber: null,
        fileSize: null,
        message: known.enabled ? '整合包已包含' : '整合包已包含（当前已禁用）'
      }
    }
    try {
      const version = await resolvePresetVersion(
        item,
        instance.gameVersion,
        instance.loader,
        settings
      )
      return {
        ...item,
        present: false,
        enabled: false,
        compatible: version.compatible,
        versionId: version.versionId,
        versionNumber: version.versionNumber,
        fileSize: version.fileSize,
        message: version.message
      }
    } catch (error) {
      return {
        ...item,
        present: false,
        enabled: false,
        compatible: false,
        versionId: null,
        versionNumber: null,
        fileSize: null,
        message: `暂时无法获取兼容版本：${error instanceof Error ? error.message : '未知错误'}`
      }
    }
  })
  return { ...base, applicable: true, reason: null, entries }
}

export function parsePresetInstallRequest(raw: unknown): PresetInstallRequest {
  if (!raw || typeof raw !== 'object') throw new Error('无效的预设安装请求')
  const value = raw as Record<string, unknown>
  const instanceId = requireInstanceId(value.instanceId)
  const rawItems = Array.isArray(value.items) ? value.items : []
  if (rawItems.length === 0) throw new Error('没有选择要安装的预设模组')
  if (rawItems.length > MAX_PRESETS) throw new Error('一次安装的预设模组过多')
  const items: PresetInstallItem[] = []
  const seen = new Set<string>()
  for (const rawItem of rawItems) {
    if (!rawItem || typeof rawItem !== 'object') continue
    const item = rawItem as Record<string, unknown>
    const provider = safeProvider(item.provider)
    const projectId = safeProjectId(item.projectId)
    const key = presetKey(provider, projectId)
    if (seen.has(key)) continue
    seen.add(key)
    items.push({
      provider,
      projectId,
      versionId: safeVersionId(item.versionId),
      title: cleanTitle(item.title) || projectId
    })
  }
  if (items.length === 0) throw new Error('没有有效的预设模组')
  return { instanceId, items }
}

export interface InstallPresetOptions {
  request: PresetInstallRequest
  settings: LauncherSettings
  signal: AbortSignal
  onProgress: TaskProgress
}

export interface InstallPresetResult {
  instanceId: string
  installed: number
  skipped: number
  manual: ManualModDownload[]
}

export async function installPresetMods(
  options: InstallPresetOptions
): Promise<InstallPresetResult> {
  const request = parsePresetInstallRequest(options.request)
  await getInstance(request.instanceId)
  const total = request.items.length
  const manual: ManualModDownload[] = []
  let installed = 0
  let skipped = 0

  for (let index = 0; index < request.items.length; index += 1) {
    if (options.signal.aborted) throw new CancellationError()
    const item = request.items[index]
    const basePercent = (index / total) * 100
    const span = 100 / total
    let stage = `安装 ${item.title}（${index + 1}/${total}）`
    let filesDone = 0
    let filesTotal = 0
    let bytesDone = 0
    let bytesTotal = 0
    let speed = 0
    let lastTick = Date.now()
    let lastDone = 0
    let itemBytes = 0
    const report = (percent: number): void => {
      options.onProgress({
        stage,
        percent: Math.max(0, Math.min(99.5, percent)),
        detail: {
          current: filesDone,
          total: filesTotal,
          bytesDone,
          bytesTotal,
          speed
        }
      })
    }
    report(basePercent)
    const result = await installMod(
      {
        instanceId: request.instanceId,
        provider: item.provider,
        projectId: item.projectId,
        title: item.title,
        versionId: item.versionId,
        kind: 'mod',
        includeDependencies: true
      },
      options.settings,
      {
        signal: options.signal,
        onPlan: (info) => {
          filesTotal = info.files
          filesDone = 0
          bytesTotal = info.bytesTotal
          bytesDone = 0
          itemBytes = 0
          speed = 0
          lastTick = Date.now()
          lastDone = 0
          stage = `${item.title} · 准备 ${info.files} 个文件`
          report(basePercent)
        },
        onFile: (info) => {
          filesTotal = info.total
          filesDone = info.index
          stage = `${item.title} · ${info.file}（${info.index}/${info.total}）`
          const fileRatio = info.total > 0 ? (info.index - 1) / info.total : 0
          report(basePercent + span * Math.min(0.9, fileRatio * 0.9))
        },
        onBytes: (delta) => {
          if (delta <= 0) return
          itemBytes += delta
          bytesDone = bytesTotal > 0 ? Math.min(itemBytes, bytesTotal) : itemBytes
          const now = Date.now()
          if (now - lastTick >= 500) {
            speed = (itemBytes - lastDone) / ((now - lastTick) / 1000)
            lastTick = now
            lastDone = itemBytes
          }
          const ratio =
            bytesTotal > 0
              ? Math.min(1, itemBytes / bytesTotal)
              : filesTotal > 0
                ? Math.min(1, filesDone / filesTotal)
                : 0
          report(basePercent + span * Math.min(0.95, ratio * 0.95))
        }
      }
    )
    installed += result.installed.length
    skipped += result.skipped.length
    for (const entry of result.manual) {
      manual.push({
        ...entry,
        title: `${item.title}：${entry.title}`.slice(0, 180)
      })
    }
    stage = `已完成 ${item.title}（${index + 1}/${total}）`
    filesDone = filesTotal
    speed = 0
    options.onProgress({
      stage,
      percent: ((index + 1) / total) * 100,
      detail: {
        current: filesTotal,
        total: filesTotal,
        bytesDone: bytesTotal,
        bytesTotal,
        speed: 0
      }
    })
  }

  options.onProgress({
    stage: '预设模组安装完成',
    percent: 100,
    detail: emptyDetail()
  })
  return { instanceId: request.instanceId, installed, skipped, manual }
}

export function presetManualMessage(manual: ManualModDownload[]): string | undefined {
  if (manual.length === 0) return undefined
  return `${manual.length} 个文件需要手动下载：${manual
    .map((item) => item.title)
    .slice(0, 3)
    .join('、')}${manual.length > 3 ? ' 等' : ''}`
}
