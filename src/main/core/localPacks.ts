import AdmZip from 'adm-zip'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import type {
  DownloadSource,
  InstanceLoader,
  InstanceSummary,
  LauncherSettings,
  LocalPackImportRequest,
  LocalPackRootView,
  LocalPackScanResult,
  LocalPackView
} from '../../shared/types'
import { getConfigDir } from './config'
import {
  countMods,
  getInstanceDir,
  getInstanceMinecraftDir,
  getInstancesRoot,
  listInstances,
  makeInstanceId,
  writeInstance
} from './instances'
import { installLoaderProfile } from './loaders'
import { installVanillaVersion } from './installer'
import { ensureJavaForVersion } from './java'
import { CancellationError } from './net'
import { emptyDetail, type TaskProgress } from './progress'
import { pathExists, safeJoin } from './version'

const SAFE_VERSION = /^[A-Za-z0-9._+\-]{1,128}$/
const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024
const MAX_SCAN_ARCHIVES = 200
const MAX_SCAN_INSTANCES = 300
const ARCHIVE_DEPTH = 3

const SKIP_COPY_TOP = new Set([
  'libraries',
  'versions',
  'assets',
  'runtime',
  'logs',
  'crash-reports',
  'saves',
  'screenshots',
  '.cache',
  '.mixin.out',
  'pcl',
  'natives',
  '.fabric',
  '.quilt',
  'minecraftinstance.json',
  'mmc-pack.json',
  'instance.cfg',
  'profile.json',
  'instance.json',
  'modrinth.index.json',
  'launcher_profiles.json',
  'usercache.json'
])

interface LocalPackRoot {
  label: string
  path: string
}

interface InstalledPackDetails extends LocalPackView {
  gameDir: string
  baseDir: string | null
  versionId: string | null
}

interface MrpackFile {
  path?: string
  env?: { client?: string }
}

interface MrpackIndex {
  formatVersion?: number
  game?: string
  name?: string
  versionId?: string
  dependencies?: Record<string, string>
  files?: MrpackFile[]
}

interface CurseForgeLoader {
  name?: string
  kind?: number
  forgeVersion?: string
  fabricVersion?: string
  quiltVersion?: string
  neoForgeVersion?: string
}

interface CurseForgeInstance {
  name?: string
  gameVersion?: string
  baseModLoader?: CurseForgeLoader
  installedAddons?: unknown[]
}

interface PrismComponent {
  uid?: string
  version?: string
}

interface PrismPack {
  components?: PrismComponent[]
}

interface ModrinthProfile {
  name?: string
  game_version?: string
  loader?: string
  loader_version?: string | null
}

interface VersionMeta {
  id?: string
  inheritsFrom?: string
  clientVersion?: string
  arguments?: { game?: unknown[] }
  libraries?: { name?: string }[]
}

function cleanText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function safeVersion(value: unknown): string | null {
  return typeof value === 'string' && SAFE_VERSION.test(value.trim()) ? value.trim() : null
}

function loaderOf(value: string | null | undefined): InstanceLoader {
  const normalized = (value ?? '').toLowerCase()
  if (normalized === 'fabric' || normalized === 'quilt' || normalized === 'forge' || normalized === 'neoforge') {
    return normalized
  }
  return 'vanilla'
}

function loaderLabel(loader: InstanceLoader): string {
  if (loader === 'fabric') return 'Fabric'
  if (loader === 'quilt') return 'Quilt'
  if (loader === 'forge') return 'Forge'
  if (loader === 'neoforge') return 'NeoForge'
  return '原版'
}

async function countJars(dir: string): Promise<number> {
  try {
    const entries = await fs.readdir(join(dir, 'mods'))
    return entries.filter((entry) => entry.toLowerCase().endsWith('.jar')).length
  } catch {
    return 0
  }
}

async function pickGameDir(root: string): Promise<string> {
  for (const candidate of [root, join(root, 'minecraft'), join(root, '.minecraft')]) {
    if (await pathExists(join(candidate, 'mods'))) return candidate
  }
  for (const candidate of [join(root, 'minecraft'), join(root, '.minecraft'), root]) {
    if (await pathExists(candidate)) return candidate
  }
  return root
}

function archiveKey(path: string): string {
  return `archive:${resolve(path)}`
}

function instanceKey(path: string): string {
  return `instance:${resolve(path)}`
}

function baseRoots(): LocalPackRoot[] {
  const home = homedir()
  const appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming')
  const roots: LocalPackRoot[] = [
    { label: '风信下载目录', path: join(getConfigDir(), 'downloads') },
    { label: '系统下载', path: join(home, 'Downloads') },
    { label: '桌面', path: join(home, 'Desktop') },
    { label: '文档', path: join(home, 'Documents') },
    { label: 'CurseForge', path: join(home, 'curseforge', 'minecraft', 'Instances') },
    {
      label: 'CurseForge（文档）',
      path: join(home, 'Documents', 'curseforge', 'minecraft', 'Instances')
    },
    {
      label: 'CurseForge（旧版）',
      path: join(home, 'Documents', 'Curse', 'Minecraft', 'Instances')
    },
    { label: 'Prism Launcher', path: join(appData, 'PrismLauncher', 'instances') },
    { label: 'MultiMC', path: join(appData, 'MultiMC', 'instances') },
    { label: 'Modrinth App', path: join(appData, 'ModrinthApp', 'profiles') },
    { label: 'ATLauncher', path: join(appData, 'ATLauncher', 'instances') },
    { label: '本地 .minecraft 版本', path: join(home, '.minecraft', 'versions') }
  ]
  if (process.platform === 'win32') {
    for (const letter of ['C', 'D', 'E', 'F', 'G', 'H']) {
      roots.push({
        label: `${letter} 盘 .minecraft 版本`,
        path: join(`${letter}:\\`, '.minecraft', 'versions')
      })
    }
  }
  return roots
}

async function readMrpack(path: string): Promise<LocalPackView | null> {
  let stat
  try {
    stat = await fs.stat(path)
  } catch {
    return null
  }
  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_ARCHIVE_BYTES) return null
  let zip: AdmZip
  try {
    zip = new AdmZip(path)
  } catch {
    return null
  }
  try {
    const entry = zip.getEntry('modrinth.index.json')
    if (!entry) return null
    const index = JSON.parse(entry.getData().toString('utf8')) as MrpackIndex
    if (index.formatVersion !== 1 || index.game !== 'minecraft') return null
    const dependencies = index.dependencies ?? {}
    const gameVersion = safeVersion(dependencies.minecraft) ?? ''
    const declared: [InstanceLoader, string | undefined][] = [
      ['fabric', dependencies['fabric-loader']],
      ['quilt', dependencies['quilt-loader']],
      ['forge', dependencies.forge],
      ['neoforge', dependencies.neoforge]
    ]
    const present = declared.filter(([, version]) => Boolean(version))
    const loader = present.length === 1 ? present[0][0] : 'vanilla'
    const loaderVersion = present.length === 1 ? safeVersion(present[0][1]) : null
    const files = (index.files ?? []).filter((file) => file.env?.client !== 'unsupported')
    const reason =
      present.length > 1
        ? '整合包同时声明了多个加载器，无法确定使用哪一个'
        : !gameVersion
          ? '没有声明有效的 Minecraft 版本'
          : files.length > 20_000
            ? '文件数量过多'
            : null
    const name =
      cleanText(index.name, 120) ||
      basename(path).replace(/\.(?:mrpack|zip)$/i, '').slice(0, 120) ||
      '本地整合包'
    return {
      key: archiveKey(path),
      kind: 'archive',
      name,
      path,
      source: '本地整合包文件',
      gameVersion,
      loader,
      loaderVersion,
      modCount: files.length,
      detail: index.versionId ? `版本 ${index.versionId}` : 'Modrinth 整合包',
      importable: reason === null,
      reason,
      external: false,
      versionId: null
    }
  } catch {
    return null
  }
}

function parseCurseForgeLoader(raw: CurseForgeLoader | undefined): {
  loader: InstanceLoader
  loaderVersion: string | null
} {
  if (!raw) return { loader: 'vanilla', loaderVersion: null }
  const kindMap: Record<number, InstanceLoader> = {
    1: 'forge',
    4: 'fabric',
    5: 'quilt',
    6: 'neoforge'
  }
  let loader = raw.kind ? kindMap[raw.kind] ?? 'vanilla' : 'vanilla'
  const name = (raw.name ?? '').toLowerCase()
  for (const candidate of ['neoforge', 'fabric', 'quilt', 'forge'] as InstanceLoader[]) {
    if (name.startsWith(`${candidate}-`) || name.startsWith(`${candidate} `)) {
      loader = candidate
      break
    }
  }
  const fromName = raw.name?.match(/^(?:neoforge|fabric|quilt|forge)[-_ ](.+)$/i)?.[1]
  const version =
    fromName ??
    (loader === 'fabric'
      ? raw.fabricVersion
      : loader === 'quilt'
        ? raw.quiltVersion
        : loader === 'neoforge'
          ? raw.neoForgeVersion
          : loader === 'forge'
            ? raw.forgeVersion
            : null)
  return { loader, loaderVersion: safeVersion(version) }
}

async function readInstanceCfgName(root: string): Promise<string> {
  try {
    const text = await fs.readFile(join(root, 'instance.cfg'), 'utf8')
    const line = text
      .split(/\r?\n/)
      .find((entry) => entry.trim().toLowerCase().startsWith('name='))
    return cleanText(line?.slice(line.indexOf('=') + 1), 120)
  } catch {
    return ''
  }
}

async function readCurseForgePack(root: string): Promise<InstalledPackDetails | null> {
  const metaPath = join(root, 'minecraftinstance.json')
  if (!(await pathExists(metaPath))) return null
  let raw: CurseForgeInstance
  try {
    raw = JSON.parse(await fs.readFile(metaPath, 'utf8')) as CurseForgeInstance
  } catch {
    return null
  }
  const gameVersion = safeVersion(raw.gameVersion) ?? ''
  const { loader, loaderVersion } = parseCurseForgeLoader(raw.baseModLoader)
  const gameDir = await pickGameDir(root)
  const modCount = Array.isArray(raw.installedAddons)
    ? raw.installedAddons.length
    : await countJars(gameDir)
  const name = cleanText(raw.name, 120) || basename(root)
  const reason = !gameVersion ? '没有找到 Minecraft 版本' : null
  return {
    key: instanceKey(root),
    kind: 'instance',
    name,
    path: root,
    source: 'CurseForge',
    gameVersion,
    loader,
    loaderVersion,
    modCount,
    detail: '',
    importable: reason === null,
    reason,
    external: false,
    versionId: null,
    gameDir,
    baseDir: null
  }
}

async function readPrismPack(
  root: string
): Promise<InstalledPackDetails | null> {
  const metaPath = join(root, 'mmc-pack.json')
  if (!(await pathExists(metaPath))) return null
  let raw: PrismPack
  try {
    raw = JSON.parse(await fs.readFile(metaPath, 'utf8')) as PrismPack
  } catch {
    return null
  }
  const components = raw.components ?? []
  const component = (uid: string) =>
    components.find((entry) => entry.uid?.toLowerCase() === uid)
  const gameVersion = safeVersion(component('net.minecraft')?.version) ?? ''
  const loaderMap: [string, InstanceLoader][] = [
    ['net.fabricmc.fabric-loader', 'fabric'],
    ['org.quiltmc.quilt-loader', 'quilt'],
    ['net.minecraftforge', 'forge'],
    ['net.neoforged', 'neoforge']
  ]
  const matched = loaderMap.find(([uid]) => component(uid))
  const loader = matched?.[1] ?? 'vanilla'
  const loaderVersion = matched ? safeVersion(component(matched[0])?.version) : null
  const gameDir = await pickGameDir(root)
  const modCount = await countJars(gameDir)
  const name =
    (await readInstanceCfgName(root)) ||
    cleanText(basename(root), 120)
  const reason = !gameVersion ? '没有找到 Minecraft 版本' : null
  const resolvedSource = /prismlauncher/i.test(root)
    ? 'Prism Launcher'
    : /multimc/i.test(root)
      ? 'MultiMC'
      : 'Prism / MultiMC'
  return {
    key: instanceKey(root),
    kind: 'instance',
    name,
    path: root,
    source: resolvedSource,
    gameVersion,
    loader,
    loaderVersion,
    modCount,
    detail: '',
    importable: reason === null,
    reason,
    external: false,
    versionId: null,
    gameDir,
    baseDir: null
  }
}

function minecraftVersionFrom(value: string | undefined): string {
  if (!value) return ''
  const direct = safeVersion(value)
  if (direct && /^\d+\.\d+(?:\.\d+)?$/.test(direct)) return direct
  const tail = value.match(/(\d+\.\d+(?:\.\d+)?)$/)
  if (tail?.[1]) return tail[1]
  const head = value.match(/^(\d+\.\d+(?:\.\d+)?)(?:-|$)/)
  if (head?.[1]) return head[1]
  return direct ?? ''
}

function fmlArgument(meta: VersionMeta | null, key: string): string | null {
  const args = meta?.arguments?.game
  if (!Array.isArray(args)) return null
  const index = args.findIndex((value) => value === key)
  const next = index >= 0 ? args[index + 1] : null
  return typeof next === 'string' ? next : null
}

function loaderFromVersionMeta(
  meta: VersionMeta | null,
  folder: string,
  gameVersion: string
): { loader: InstanceLoader; loaderVersion: string | null } {
  let loader: InstanceLoader = 'vanilla'
  let version: string | null = null
  const neoForgeArg = fmlArgument(meta, '--fml.neoForgeVersion')
  const forgeArg = fmlArgument(meta, '--fml.forgeVersion')
  const launchTarget = fmlArgument(meta, '--launchTarget') ?? ''
  if (neoForgeArg) {
    loader = 'neoforge'
    version = safeVersion(neoForgeArg)
  } else if (forgeArg || /forge(client|server)?$/.test(launchTarget)) {
    loader = 'forge'
    version = safeVersion(forgeArg)
  } else {
    for (const library of meta?.libraries ?? []) {
      const name = library.name ?? ''
      const lower = name.toLowerCase()
      if (lower.includes('fabric-loader')) loader = 'fabric'
      else if (lower.includes('quilt-loader')) loader = 'quilt'
      else continue
      version = safeVersion(name.split(':').pop() ?? null)
      break
    }
  }
  const text = `${meta?.id ?? ''} ${meta?.inheritsFrom ?? ''} ${folder}`.toLowerCase()
  if (loader === 'vanilla') {
    if (text.includes('neoforge')) loader = 'neoforge'
    else if (text.includes('fabric')) loader = 'fabric'
    else if (text.includes('quilt')) loader = 'quilt'
    else if (text.includes('forge')) loader = 'forge'
  }
  if (!version && loader !== 'vanilla') {
    const match = text.match(
      new RegExp(`(?:${loader})[-_ ]?v?([0-9][0-9A-Za-z.+_-]*)`)
    )
    version = safeVersion(match?.[1])
  }
  if (version && gameVersion && version.startsWith(`${gameVersion}-`)) {
    version = version.slice(gameVersion.length + 1)
  }
  return { loader, loaderVersion: version }
}

async function readVersionPack(root: string): Promise<InstalledPackDetails | null> {
  if (!(await pathExists(join(root, 'mods')))) return null
  const folder = basename(root)
  let meta: VersionMeta | null = null
  try {
    meta = JSON.parse(
      await fs.readFile(join(root, `${folder}.json`), 'utf8')
    ) as VersionMeta
  } catch {
    meta = null
  }
  const gameVersion =
    minecraftVersionFrom(meta?.inheritsFrom) ||
    minecraftVersionFrom(meta?.clientVersion) ||
    minecraftVersionFrom(fmlArgument(meta, '--fml.mcVersion') ?? undefined) ||
    minecraftVersionFrom(meta?.id) ||
    minecraftVersionFrom(folder)
  const { loader, loaderVersion } = loaderFromVersionMeta(meta, folder, gameVersion)
  const modCount = await countJars(root)
  const parent = dirname(root)
  const candidateBase = basename(parent).toLowerCase() === 'versions' ? dirname(parent) : null
  const external =
    Boolean(candidateBase) &&
    (await pathExists(join(candidateBase as string, 'libraries'))) &&
    (await pathExists(join(candidateBase as string, 'assets')))
  const reason = !meta
    ? '缺少版本 JSON，无法确定加载器'
    : !gameVersion
      ? '没有找到 Minecraft 版本'
      : null
  return {
    key: instanceKey(root),
    kind: 'instance',
    name: folder.slice(0, 120),
    path: root,
    source: external ? '本地 .minecraft（直接使用）' : '本地 .minecraft',
    gameVersion,
    loader,
    loaderVersion,
    modCount,
    detail: external ? '使用原目录与原运行库' : '',
    importable: reason === null,
    reason,
    external,
    versionId: folder,
    gameDir: root,
    baseDir: external ? candidateBase : null
  }
}

async function scanVersionRoot(
  root: string,
  packs: LocalPackView[]
): Promise<void> {
  const direct = await readVersionPack(root)
  if (direct) {
    packs.push(direct)
    return
  }
  let entries
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries
    .filter((item) => item.isDirectory() && !item.name.startsWith('.'))
    .slice(0, MAX_SCAN_INSTANCES)) {
    const found = await readVersionPack(join(root, entry.name))
    if (found) packs.push(found)
  }
}

async function readModrinthPack(root: string): Promise<InstalledPackDetails | null> {
  const metaPath = join(root, 'profile.json')
  if (!(await pathExists(metaPath))) return null
  let raw: ModrinthProfile
  try {
    raw = JSON.parse(await fs.readFile(metaPath, 'utf8')) as ModrinthProfile
  } catch {
    return null
  }
  const gameVersion = safeVersion(raw.game_version) ?? ''
  const loader = loaderOf(raw.loader)
  const loaderVersion = safeVersion(raw.loader_version)
  const gameDir = await pickGameDir(root)
  const modCount = await countJars(gameDir)
  const name = cleanText(raw.name, 120) || basename(root)
  const reason = !gameVersion ? '没有找到 Minecraft 版本' : null
  return {
    key: instanceKey(root),
    kind: 'instance',
    name,
    path: root,
    source: 'Modrinth App',
    gameVersion,
    loader,
    loaderVersion,
    modCount,
    detail: '',
    importable: reason === null,
    reason,
    external: false,
    versionId: null,
    gameDir,
    baseDir: null
  }
}

async function readInstalledPack(
  root: string
): Promise<InstalledPackDetails | null> {
  const instancesRoot = resolve(getInstancesRoot()).toLowerCase()
  if (resolve(root).toLowerCase().startsWith(instancesRoot + sep)) return null
  return (
    (await readCurseForgePack(root)) ??
    (await readPrismPack(root)) ??
    (await readModrinthPack(root)) ??
    (await readVersionPack(root))
  )
}

async function walkArchives(
  root: string,
  depth: number,
  result: string[]
): Promise<void> {
  if (depth > ARCHIVE_DEPTH || result.length >= MAX_SCAN_ARCHIVES) return
  let entries
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (result.length >= MAX_SCAN_ARCHIVES) return
    if (entry.name.startsWith('.')) continue
    const full = join(root, entry.name)
    if (entry.isDirectory()) {
      if (
        ['node_modules', 'instances', 'libraries', 'versions', 'assets', 'cache'].includes(
          entry.name.toLowerCase()
        )
      ) {
        continue
      }
      await walkArchives(full, depth + 1, result)
    } else if (
      entry.isFile() &&
      /\.(?:mrpack|zip)$/i.test(entry.name)
    ) {
      result.push(full)
    }
  }
}

async function scanInstalledRoot(
  root: string,
  packs: LocalPackView[]
): Promise<void> {
  const direct = await readInstalledPack(root)
  if (direct) {
    packs.push(direct)
    return
  }
  let entries
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return
  }
  const folders = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .slice(0, MAX_SCAN_INSTANCES)
  for (const entry of folders) {
    const found = await readInstalledPack(join(root, entry.name))
    if (found) packs.push(found)
  }
}

export async function scanLocalPacks(
  extraPaths?: string[] | string | null
): Promise<LocalPackScanResult> {
  const roots: LocalPackRoot[] = [...baseRoots()]
  const extras = (
    Array.isArray(extraPaths)
      ? extraPaths
      : typeof extraPaths === 'string'
        ? [extraPaths]
        : []
  )
    .filter((path): path is string => typeof path === 'string' && path.trim().length > 0)
    .map((path) => resolve(path.trim()))
  for (const path of [...new Set(extras)].slice(0, 20)) {
    roots.push({ label: '已保存目录', path })
  }
  const packs: LocalPackView[] = []
  const seen = new Set<string>()

  const archiveFiles: string[] = []
  for (const root of roots) {
    if (!(await pathExists(root.path))) continue
    await walkArchives(root.path, 0, archiveFiles)
  }
  for (const archive of [...new Set(archiveFiles.map((path) => resolve(path)))]) {
    const pack = await readMrpack(archive)
    if (!pack || seen.has(pack.key)) continue
    seen.add(pack.key)
    packs.push(pack)
  }

  const savedRoots = roots.filter((root) => root.label === '已保存目录')
  const versionRoots = roots.filter((root) => root.label.includes('.minecraft 版本'))
  const instanceRoots = roots.filter(
    (root) =>
      !savedRoots.includes(root) &&
      !versionRoots.includes(root) &&
      !['风信下载目录', '系统下载', '桌面', '文档'].includes(root.label)
  )
  for (const root of instanceRoots) {
    if (!(await pathExists(root.path))) continue
    await scanInstalledRoot(root.path, packs)
  }
  for (const root of versionRoots) {
    if (!(await pathExists(root.path))) continue
    await scanVersionRoot(root.path, packs)
  }
  for (const root of savedRoots) {
    if (!(await pathExists(root.path))) continue
    const versions = join(root.path, 'versions')
    if (await pathExists(versions)) {
      await scanVersionRoot(versions, packs)
    }
    if (basename(root.path).toLowerCase() === 'versions') {
      await scanVersionRoot(root.path, packs)
    }
    await scanInstalledRoot(root.path, packs)
    await scanVersionRoot(root.path, packs)
  }

  const unique = [...new Map(packs.map((pack) => [pack.key, pack])).values()]
  const resolvedRoots: LocalPackRootView[] = []
  for (const root of roots) {
    resolvedRoots.push({
      label: root.label,
      path: root.path,
      exists: await pathExists(root.path)
    })
  }
  unique.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'instance' ? -1 : 1
    return left.name.localeCompare(right.name, 'zh-CN')
  })
  return { packs: unique, roots: resolvedRoots, scannedAt: Date.now() }
}

async function readJavaMajor(gameDir: string, versionId: string): Promise<number | null> {
  try {
    const raw = await fs.readFile(
      join(gameDir, 'versions', versionId, `${versionId}.json`),
      'utf8'
    )
    const json = JSON.parse(raw) as { javaVersion?: { majorVersion?: number } }
    const major = json.javaVersion?.majorVersion
    return typeof major === 'number' && Number.isFinite(major) ? major : null
  } catch {
    return null
  }
}

async function nextInstanceId(name: string): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const id = makeInstanceId(name)
    if (!(await pathExists(getInstanceDir(id)))) return id
  }
  throw new Error('无法创建实例目录，请重试')
}

export interface ImportInstalledOptions {
  path: string
  settings: LauncherSettings
  signal: AbortSignal
  onProgress: TaskProgress
}

export interface ImportInstalledResult {
  instance: InstanceSummary
}

function copyFilter(
  sourceDir: string,
  extraSkip: Set<string>
): (source: string) => boolean {
  return (source: string) => {
    const rel = relative(sourceDir, source)
    if (!rel) return true
    const top = rel.split(sep)[0].toLowerCase()
    if (top === 'pcl' || top.endsWith('-natives')) return false
    return !SKIP_COPY_TOP.has(top) && !extraSkip.has(top)
  }
}

export async function importInstalledPack(
  options: ImportInstalledOptions
): Promise<ImportInstalledResult> {
  const { signal, onProgress } = options
  const report = (stage: string, percent: number, detail = emptyDetail()) =>
    onProgress({ stage, percent: Math.max(0, Math.min(100, percent)), detail })

  report('读取本地实例', 1)
  const pack = await readInstalledPack(options.path)
  if (!pack || pack.kind !== 'instance') throw new Error('所选目录不是可识别的整合包实例')
  if (!pack.importable) throw new Error(pack.reason ?? '这个实例缺少必要的版本信息')
  if (!(await pathExists(pack.gameDir))) throw new Error('实例的游戏目录不存在')

  if (pack.external && pack.baseDir && pack.versionId) {
    const existing = (await listInstances()).find(
      (instance) =>
        instance.external?.gameDir.toLowerCase() === pack.gameDir.toLowerCase()
    )
    if (existing) {
      report('外部实例已在列表中', 100)
      return { instance: existing }
    }
    report('添加外部实例引用', 30)
    const id = await nextInstanceId(pack.name)
    const javaMajor = await readJavaMajor(pack.baseDir, pack.versionId)
    const instance: InstanceSummary = {
      id,
      name: pack.name,
      summary: `直接使用外部安装 · ${pack.gameDir}`,
      iconUrl: null,
      gameVersion: pack.gameVersion,
      loader: pack.loader,
      loaderVersion: pack.loaderVersion,
      versionId: pack.versionId,
      javaMajor,
      modCount: pack.modCount,
      source: 'external',
      projectId: null,
      lastPlayed: null,
      installedAt: Date.now(),
      external: { baseDir: pack.baseDir, gameDir: pack.gameDir }
    }
    await writeInstance(instance)
    report('外部实例已添加', 100)
    return { instance }
  }

  if (signal.aborted) throw new CancellationError()

  const gameVersion = pack.gameVersion
  const loader = pack.loader
  const loaderVersion = pack.loaderVersion
  const settings = options.settings
  const id = await nextInstanceId(pack.name)
  const instanceDir = getInstanceDir(id)
  const minecraftDir = getInstanceMinecraftDir(id)
  await fs.mkdir(minecraftDir, { recursive: true })

  try {
    report('准备原版', 3)
    await installVanillaVersion({
      gameDir: settings.gameDir,
      versionId: gameVersion,
      source: settings.source as DownloadSource,
      concurrency: settings.downloadConcurrency,
      signal,
      onProgress: (info) => {
        report(`安装原版 · ${info.stage}`, 3 + info.percent * 0.42, info.detail)
      }
    })

    const javaMajor = await readJavaMajor(settings.gameDir, gameVersion)
    if (signal.aborted) throw new CancellationError()
    if (loader === 'quilt' && javaMajor !== null && javaMajor > 21) {
      throw new Error(
        `当前 Quilt 加载器尚未支持 Java ${javaMajor}（Minecraft ${gameVersion}）。请选择 1.21.x 或更早的 Quilt 整合包。`
      )
    }

    let versionId = gameVersion
    if (loader !== 'vanilla') {
      let javaPath: string | undefined
      if (loader === 'forge' || loader === 'neoforge') {
        report(`准备 ${loaderLabel(loader)} Java`, 47)
        const java = await ensureJavaForVersion({
          gameDir: settings.gameDir,
          settings,
          requiredMajor: javaMajor,
          exact: true,
          source: settings.source as DownloadSource,
          signal,
          onProgress: (info) => {
            report(`准备 Java · ${info.stage}`, 47 + info.percent * 0.03, info.detail)
          }
        })
        javaPath = java.path
      }
      if (signal.aborted) throw new CancellationError()
      const result = await installLoaderProfile({
        gameDir: settings.gameDir,
        gameVersion,
        loader,
        loaderVersion,
        javaPath,
        concurrency: settings.downloadConcurrency,
        signal,
        onProgress: (info) => {
          report(`安装 ${loaderLabel(loader)} · ${info.stage}`, 50 + info.percent * 0.14, info.detail)
        }
      })
      versionId = result.versionId
    }

    if (signal.aborted) throw new CancellationError()
    report('复制模组与配置', 66)
    const sourceName = basename(pack.gameDir).toLowerCase()
    await fs.cp(pack.gameDir, minecraftDir, {
      recursive: true,
      force: true,
      filter: copyFilter(
        pack.gameDir,
        new Set([`${sourceName}.json`, `${sourceName}.jar`])
      )
    })
    if (signal.aborted) throw new CancellationError()
    report('写入实例信息', 94)
    const modCount = await countMods(minecraftDir)
    const instance: InstanceSummary = {
      id,
      name: pack.name,
      summary: `从 ${pack.source} 导入 · Minecraft ${gameVersion}`,
      iconUrl: null,
      gameVersion,
      loader,
      loaderVersion,
      versionId,
      baseDir: settings.gameDir,
      javaMajor,
      modCount,
      source: 'local',
      projectId: null,
      lastPlayed: null,
      installedAt: Date.now()
    }
    await writeInstance(instance)
    report('导入完成', 100)
    return { instance }
  } catch (error) {
    await fs.rm(instanceDir, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

export function parseLocalPackImportRequest(raw: unknown): LocalPackImportRequest {
  if (!raw || typeof raw !== 'object') throw new Error('无效的本地整合包请求')
  const value = raw as Record<string, unknown>
  const path = typeof value.path === 'string' ? value.path.trim() : ''
  if (!path || path.length > 4096) throw new Error('无效的整合包路径')
  const kind = value.kind === 'archive' ? 'archive' : value.kind === 'instance' ? 'instance' : null
  if (!kind) throw new Error('无效的整合包类型')
  return { path: resolve(path), kind }
}
