import { promises as fs } from 'node:fs'
import { isIP } from 'node:net'
import { dirname, join, resolve, sep } from 'node:path'
import type { LauncherSettings } from '../../shared/types'
import type { ArgumentEntry, Library } from './mojangTypes'
import { currentOsName, isRuleAllowed, nativeArchSuffix, type FeatureFlags } from './rules'

export const LIBRARY_BASE_URL = 'https://libraries.minecraft.net/'

export function safeJoin(root: string, relative: string): string {
  const base = resolve(root)
  const target = resolve(base, relative)
  if (target !== base && !target.startsWith(base + sep)) {
    throw new Error(`非法的文件路径：${relative}`)
  }
  return target
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

export async function writeFileAtomic(path: string, content: string): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  await fs.writeFile(tmp, content, 'utf8')
  await fs.rename(tmp, path)
}

export function featuresForSettings(settings: LauncherSettings): FeatureFlags {
  return {
    is_demo_user: false,
    has_custom_resolution: settings.customResolution,
    has_quick_plays_support: false,
    is_quick_play_singleplayer: false,
    is_quick_play_multiplayer: false,
    is_quick_play_realms: false
  }
}

export interface ParsedMavenName {
  group: string
  artifact: string
  version: string
  classifier?: string
  extension: string
}

export function parseMavenName(name: string): ParsedMavenName | null {
  const at = name.lastIndexOf('@')
  const extension = at >= 0 ? name.slice(at + 1) : 'jar'
  const coords = at >= 0 ? name.slice(0, at) : name
  const parts = coords.split(':')
  if (parts.length < 3) return null
  return {
    group: parts[0],
    artifact: parts[1],
    version: parts[2],
    classifier: parts[3] || undefined,
    extension
  }
}

export interface ArtifactRef {
  path: string
  url: string
  sha1?: string
  size?: number
}

export function computedArtifact(lib: Library, classifierOverride?: string): ArtifactRef | null {
  const parsed = parseMavenName(lib.name)
  if (!parsed) return null
  const classifier = classifierOverride ?? parsed.classifier
  const file = `${parsed.artifact}-${parsed.version}${classifier ? `-${classifier}` : ''}.${parsed.extension}`
  const base = parsed.group.replace(/\./g, '/')
  const path = `${base}/${parsed.artifact}/${parsed.version}/${file}`
  const baseUrl = lib.url || LIBRARY_BASE_URL
  return {
    path,
    url: `${baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`}${path}`,
    sha1: classifier ? undefined : lib.sha1,
    size: classifier ? undefined : lib.size
  }
}

export function mainArtifact(lib: Library): ArtifactRef | null {
  const artifact = lib.downloads?.artifact
  if (artifact) {
    return {
      path: artifact.path ?? computedArtifact(lib)?.path ?? lib.name,
      url: artifact.url,
      sha1: artifact.sha1,
      size: artifact.size
    }
  }
  return computedArtifact(lib)
}

export function nativeClassifier(lib: Library): string | null {
  const template = lib.natives?.[currentOsName()]
  if (!template) return null
  return template.replace('${arch}', nativeArchSuffix())
}

export function nativeArtifact(lib: Library): ArtifactRef | null {
  const classifier = nativeClassifier(lib)
  if (!classifier) return null
  const artifact = lib.downloads?.classifiers?.[classifier]
  if (artifact) {
    return {
      path: artifact.path ?? computedArtifact(lib, classifier)?.path ?? lib.name,
      url: artifact.url,
      sha1: artifact.sha1,
      size: artifact.size
    }
  }
  return computedArtifact(lib, classifier)
}

export interface ResolvedVersion {
  json: import('./mojangTypes').VersionJson
  chain: string[]
  jarId: string
}

async function readVersionJsonFile(gameDir: string, id: string): Promise<import('./mojangTypes').VersionJson> {
  const path = join(gameDir, 'versions', id, `${id}.json`)
  let text: string
  try {
    text = await fs.readFile(path, 'utf8')
  } catch {
    throw new Error(`未找到版本 ${id} 的配置文件，请先在下载页安装该版本`)
  }
  try {
    return JSON.parse(text) as import('./mojangTypes').VersionJson
  } catch {
    throw new Error(`版本 ${id} 的配置文件已损坏`)
  }
}

function mergeArguments(
  base: ArgumentEntry[] | undefined,
  child: ArgumentEntry[] | undefined
): ArgumentEntry[] | undefined {
  if (!base && !child) return undefined
  return [...(base ?? []), ...(child ?? [])]
}

function libraryOverrideKey(lib: Library): string {
  const parsed = parseMavenName(lib.name)
  if (!parsed) return `name:${lib.name}`
  // 版本号故意不参与 key：加载器档案覆盖原版的同名运行库（例如 asm 9.7.1 覆盖 9.6），
  // 否则两代 jar 会同时进入 classpath，Fabric 会直接报 duplicate ASM classes。
  return `${parsed.group}:${parsed.artifact}:${parsed.classifier ?? ''}:${parsed.extension}`
}

function mergeLibraries(base: Library[] | undefined, child: Library[] | undefined): Library[] | undefined {
  if (!base && !child) return undefined
  const merged = new Map<string, Library>()
  for (const lib of base ?? []) merged.set(libraryOverrideKey(lib), lib)
  for (const lib of child ?? []) {
    const key = libraryOverrideKey(lib)
    merged.delete(key)
    merged.set(key, lib)
  }
  return [...merged.values()]
}

function mergeVersionJson(
  base: import('./mojangTypes').VersionJson,
  child: import('./mojangTypes').VersionJson
): import('./mojangTypes').VersionJson {
  return {
    ...base,
    ...child,
    downloads: { ...(base.downloads ?? {}), ...(child.downloads ?? {}) },
    arguments: {
      game: mergeArguments(base.arguments?.game, child.arguments?.game),
      jvm: mergeArguments(base.arguments?.jvm, child.arguments?.jvm)
    },
    libraries: mergeLibraries(base.libraries, child.libraries),
    assetIndex: child.assetIndex ?? base.assetIndex,
    assets: child.assets ?? base.assets,
    javaVersion: child.javaVersion ?? base.javaVersion,
    logging: child.logging ?? base.logging,
    minecraftArguments: child.minecraftArguments ?? base.minecraftArguments,
    releaseTime: child.releaseTime ?? base.releaseTime,
    type: child.type ?? base.type,
    mainClass: child.mainClass ?? base.mainClass
  }
}

function hasQuickPlayMultiplayer(entries: ArgumentEntry[] | undefined): boolean {
  if (!entries) return false
  return entries.some((entry) => {
    const values =
      typeof entry === 'string'
        ? [entry]
        : Array.isArray(entry.value)
          ? entry.value
          : [entry.value]
    return values.includes('--quickPlayMultiplayer')
  })
}

export async function resolveVersion(gameDir: string, id: string): Promise<ResolvedVersion> {
  const chain: string[] = []
  let current: import('./mojangTypes').VersionJson | null = null
  let cursor: string | undefined = id
  const visited = new Set<string>()

  while (cursor) {
    if (visited.has(cursor)) break
    visited.add(cursor)
    chain.push(cursor)
    const json = await readVersionJsonFile(gameDir, cursor)
    current = current ? mergeVersionJson(json, current) : json
    cursor = json.inheritsFrom
  }

  if (!current) throw new Error(`版本 ${id} 无法解析`)

  let jarId = current.jar ?? chain[0]
  if (!current.jar) {
    for (const candidate of chain) {
      if (await pathExists(join(gameDir, 'versions', candidate, `${candidate}.jar`))) {
        jarId = candidate
        break
      }
    }
  }

  return { json: current, chain, jarId }
}

export function flattenArguments(entries: ArgumentEntry[] | undefined, features: FeatureFlags): string[] {
  if (!entries) return []
  const result: string[] = []
  for (const entry of entries) {
    if (typeof entry === 'string') {
      result.push(entry)
      continue
    }
    if (isRuleAllowed(entry.rules, features)) {
      if (Array.isArray(entry.value)) result.push(...entry.value)
      else result.push(entry.value)
    }
  }
  return result
}

export function splitCommandLine(input: string): string[] {
  const result: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaped = false
  for (const char of input) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === '\\' && quote === '"') {
      escaped = true
      continue
    }
    if (quote) {
      if (char === quote) quote = null
      else current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (/\s/.test(char)) {
      if (current) {
        result.push(current)
        current = ''
      }
      continue
    }
    current += char
  }
  if (current) result.push(current)
  return result
}

export interface LaunchAccount {
  name: string
  uuid: string
  accessToken: string
  type: 'msa' | 'legacy'
  clientId?: string
  xuid?: string
}

export interface BuildCommandOptions {
  gameDir: string
  baseDir?: string
  version: ResolvedVersion
  account: LaunchAccount
  settings: LauncherSettings
  javaPath: string
  launcherVersion: string
  loggingPath?: string | null
  server?: { host: string; port: number } | null
}

export interface BuiltCommand {
  executable: string
  args: string[]
  mainClass: string
  classpath: string
  nativesDir: string
  versionDir: string
}

export function buildLaunchCommand(options: BuildCommandOptions): BuiltCommand {
  const { gameDir, version, account, settings, javaPath, launcherVersion, loggingPath } = options
  const baseDir = options.baseDir ?? gameDir
  const json = version.json
  const features = featuresForSettings(settings)
  const serverHost = options.server
    ? isIP(options.server.host) === 6
      ? `[${options.server.host}]`
      : options.server.host
    : ''
  const quickPlayMultiplayer = options.server ? `${serverHost}:${options.server.port}` : ''
  const quickPlaySupported = hasQuickPlayMultiplayer(json.arguments?.game)
  const gameFeatures =
    options.server && quickPlaySupported
      ? { ...features, is_quick_play_multiplayer: true }
      : features
  const assetsDir = join(baseDir, 'assets')
  const libraryDir = join(baseDir, 'libraries')
  const versionDir = join(baseDir, 'versions', version.chain[0])
  const nativesDir = join(versionDir, 'natives')

  const classpathEntries: string[] = []
  const appendLibrary = (lib: Library) => {
    if (!isRuleAllowed(lib.rules, features)) return
    const artifact = mainArtifact(lib)
    if (!artifact) return
    const absolute = safeJoin(libraryDir, artifact.path)
    if (!classpathEntries.includes(absolute)) classpathEntries.push(absolute)
  }
  for (const lib of json.libraries ?? []) appendLibrary(lib)
  classpathEntries.push(safeJoin(join(baseDir, 'versions'), `${version.jarId}/${version.jarId}.jar`))
  const classpath = classpathEntries.join(';')

  const assetsIndexName = json.assetIndex?.id ?? json.assets ?? 'legacy'
  const placeholders: Record<string, string> = {
    auth_player_name: account.name,
    version_name: version.chain[0],
    game_directory: gameDir,
    assets_root: assetsDir,
    game_assets: join(assetsDir, 'virtual', 'legacy'),
    assets_index_name: assetsIndexName,
    auth_uuid: account.uuid.replace(/-/g, ''),
    auth_access_token: account.accessToken,
    auth_session: `token:${account.accessToken}:${account.uuid.replace(/-/g, '')}`,
    clientid: account.clientId ?? '',
    auth_xuid: account.xuid ?? '',
    user_type: account.type,
    version_type: json.type ?? 'release',
    natives_directory: nativesDir,
    launcher_name: 'Windletter',
    launcher_version: launcherVersion,
    classpath,
    classpath_separator: ';',
    library_directory: libraryDir,
    resolution_width: String(settings.windowWidth),
    resolution_height: String(settings.windowHeight),
    user_properties: '{}',
    quickPlayPath: '',
    quickPlaySingleplayer: '',
    quickPlayMultiplayer,
    quickPlayRealms: '',
    path: loggingPath ?? ''
  }

  const replaceWith = (value: string, versionName: string): string =>
    value.replace(/\$\{([^}]+)\}/g, (_match, key: string) =>
      key === 'version_name' ? versionName : placeholders[key] ?? ''
    )

  const replace = (value: string): string => replaceWith(value, version.chain[0])

  const isNeoForge =
    /neoforge/i.test(json.id ?? '') || /neoforge/i.test(version.chain[0] ?? '')
  // Forge 忽略自身 profile jar，让原版 jar 提供 minecraft 模块；
  // NeoForge 的 client jar 需要提供 minecraft 模块，因此忽略父级原版 jar。
  const ignoreListVersion = isNeoForge ? (json.inheritsFrom ?? version.chain[0]) : version.chain[0]
  const jvmEntryArgs = flattenArguments(json.arguments?.jvm, features).map((arg) =>
    replaceWith(arg, arg.startsWith('-DignoreList=') ? ignoreListVersion : version.chain[0])
  )
  const hasClasspathArg = jvmEntryArgs.includes('-cp') || jvmEntryArgs.includes('-classpath')
  const defaultJvmArgs: string[] = []
  if (!hasClasspathArg) {
    defaultJvmArgs.push(`-Djava.library.path=${nativesDir}`, '-cp', classpath)
  }
  if (json.arguments?.jvm) {
    defaultJvmArgs.push(
      '-Dminecraft.launcher.brand=Windletter',
      `-Dminecraft.launcher.version=${launcherVersion}`
    )
  }

  const memoryArgs = [
    `-Xms${Math.min(settings.maxMemoryMb, 1024)}M`,
    `-Xmx${settings.maxMemoryMb}M`
  ]
  const extraArgs = splitCommandLine(settings.extraJvmArgs)
  const loggingArgs: string[] = []
  if (loggingPath) {
    const loggingArg = json.logging?.client?.argument
    loggingArgs.push(loggingArg ? replace(loggingArg) : `-Dlog4j.configurationFile=${loggingPath}`)
  }

  const jvmArgs = [
    ...memoryArgs,
    '-Dfile.encoding=UTF-8',
    '-Dlog4j2.formatMsgNoLookups=true',
    ...extraArgs,
    ...defaultJvmArgs,
    ...jvmEntryArgs,
    ...loggingArgs
  ]

  const modernGameArgs = flattenArguments(json.arguments?.game, gameFeatures).map(replace)
  let gameArgs: string[]
  if (modernGameArgs.length) {
    gameArgs = modernGameArgs
  } else if (json.minecraftArguments) {
    gameArgs = splitCommandLine(json.minecraftArguments).map(replace)
    if (settings.customResolution) {
      gameArgs.push('--width', String(settings.windowWidth), '--height', String(settings.windowHeight))
    }
  } else {
    gameArgs = [
      '--username',
      account.name,
      '--version',
      version.chain[0],
      '--gameDir',
      gameDir,
      '--assetsDir',
      assetsDir,
      '--assetIndex',
      assetsIndexName,
      '--uuid',
      account.uuid.replace(/-/g, ''),
      '--accessToken',
      account.accessToken,
      '--userType',
      account.type,
      '--versionType',
      json.type ?? 'release'
    ]
  }

  if (options.server) {
    const hasServerArgument =
      gameArgs.includes('--server') || gameArgs.includes('--quickPlayMultiplayer')
    if (!hasServerArgument) {
      gameArgs.push('--server', serverHost, '--port', String(options.server.port))
    }
  }

  return {
    executable: javaPath,
    args: [...jvmArgs, json.mainClass ?? 'net.minecraft.client.main.Main', ...gameArgs],
    mainClass: json.mainClass ?? 'net.minecraft.client.main.Main',
    classpath,
    nativesDir,
    versionDir
  }
}
