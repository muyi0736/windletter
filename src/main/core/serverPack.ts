import AdmZip from 'adm-zip'
import { promises as fs } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  ServerPackAiSuggestion,
  ServerPackModSide,
  ServerPackModView,
  ServerPackPreview,
  ServerPackProperties,
  ServerPackRequest
} from '../../shared/types'
import { getAiRuntimeConfig } from './ai'
import { getCacheDir, getSettings } from './config'
import { getInstance, getInstanceGameDir } from './instances'
import { CancellationError } from './net'
import { downloadFile, fetchText } from './net'
import type { TaskProgress } from './progress'
import { orderedUrls } from './source'
import { pathExists, resolveVersion } from './version'
import { writeStoreZip, type StoreZipEntry } from './zipStore'

const MAX_AI_MODS = 360
const AI_TIMEOUT_MS = 65_000
const CONFIG_DIRS = ['config', 'defaultconfigs', 'serverconfig', 'scripts', 'kubejs']
const CLIENT_ONLY_IDS = new Set([
  'sodium',
  'sodium-extra',
  'sodiumextra',
  'reeses-sodium-options',
  'sodiumoptionsapi',
  'iris',
  'oculus',
  'embeddium',
  'rubidium',
  'optifine',
  'optifabric',
  'optigui',
  'entityculling',
  'entity_texture_features',
  'entitytexturefeatures',
  'etf',
  'dynamiclights',
  'lambdynamiclights',
  'zoomify',
  'controllable',
  'mousetweaks',
  'inventorytweaks',
  'inventoryprofilesnext',
  'betterf3',
  'fancymenu',
  'drippyloadingscreen',
  'drippy',
  'konkrete',
  'melody',
  'essential',
  'imblocker',
  'inputmethodblocker',
  'lootbeams',
  'mafglib',
  'minecraftcapes',
  'tweakerge',
  'shut_up_gl_error',
  'jecharacters',
  'justenoughcharacters',
  'modmenu',
  'mod-menu',
  'chatheads',
  'chat_heads',
  'notenoughanimations',
  'eatinganimation',
  'freshanimations',
  'continuity',
  'indium',
  'citresewn',
  'capes',
  'skinlayers3d',
  '3dskinlayers',
  'xaerosminimap',
  'xaeroworldmap',
  'journeymap',
  'appleskin',
  'litematica',
  'minihud',
  'malilib',
  'tweakeroo',
  'itemscroller',
  'screenshotviewer',
  'betteradvancements'
])
const CLIENT_ONLY_NAME = /(?:sodium|iris|oculus|optifine|embeddium|rubidium|entityculling|zoomify|fancymenu|drippyloadingscreen|drippy|konkrete|melody|modmenu|controllable|mousetweaks|inventorytweaks|chatheads|notenoughanimations|freshanimations|xaeros?minimap|xaeros?worldmap|journeymap|appleskin|skinlayers|screenshotviewer|litematica|minihud|malilib|tweakeroo|itemscroller|imblocker|inputmethodblocker|lootbeams|mafglib|minecraftcapes|tweakerge|shut_up_gl_error|jecharacters|justenoughcharacters)/i
const ESSENTIAL_CLIENT = /(?:^|[^a-z])essential(?:[_\-.\s]|$)/i
const CONFIG_FILE = /\.(?:properties|json5?|toml|ya?ml|txt|cfg|conf|ini|snbt)$/i

export interface ModMeta {
  id: string | null
  name: string
  version: string | null
  environment: 'client' | 'server' | 'both' | null
  requires: string[]
}

interface EntryWithSize extends StoreZipEntry {
  bytes: number
}

function modsDir(gameDir: string): string {
  return join(gameDir, 'mods')
}

function cleanText(value: unknown, fallback: string, max: number): string {
  if (typeof value !== 'string') return fallback
  const text = value.replace(/[\u0000-\u001f]/g, ' ').trim()
  return text ? text.slice(0, max) : fallback
}

const BUILTIN_DEPENDENCIES = new Set([
  'minecraft',
  'forge',
  'neoforge',
  'java',
  'fabricloader',
  'quilt_loader',
  'fml'
])

function cleanRequires(list: unknown[]): string[] {
  const result = new Set<string>()
  for (const item of list) {
    if (typeof item !== 'string') continue
    const id = item.trim().toLowerCase()
    if (!/^[a-z0-9][a-z0-9_.-]{0,100}$/.test(id)) continue
    if (BUILTIN_DEPENDENCIES.has(id)) continue
    result.add(id)
  }
  return [...result].slice(0, 80)
}

function parseForgeRequires(text: string): string[] {
  const ids: string[] = []
  for (const match of text.matchAll(/\[\[dependencies(?:\.[^\]]*)?\]\]([\s\S]*?)(?=\n\s*\[\[|$)/gi)) {
    const block = match[1]
    const id = block.match(/^\s*modId\s*=\s*["']([^"']+)["']/im)?.[1]
    if (!id) continue
    if (/^\s*mandatory\s*=\s*false/im.test(block)) continue
    const side = block.match(/^\s*side\s*=\s*["']([^"']+)["']/im)?.[1]?.toUpperCase()
    if (side === 'SERVER') continue
    ids.push(id)
  }
  return cleanRequires(ids)
}

export function readModMeta(path: string): ModMeta | null {
  let zip: AdmZip
  try {
    zip = new AdmZip(path)
  } catch {
    return null
  }
  try {
    const fabric = zip.getEntry('fabric.mod.json')
    if (fabric) {
      try {
        const data = JSON.parse(fabric.getData().toString('utf8')) as Record<string, unknown>
        if (typeof data.id === 'string') {
          const depends =
            data.depends && typeof data.depends === 'object' && !Array.isArray(data.depends)
              ? Object.keys(data.depends as Record<string, unknown>)
              : []
          return {
            id: data.id.toLowerCase(),
            name: String(data.name || data.id),
            version: typeof data.version === 'string' ? data.version : null,
            environment:
              data.environment === 'client'
                ? 'client'
                : data.environment === 'server'
                  ? 'server'
                  : 'both',
            requires: cleanRequires(depends)
          }
        }
      } catch {
        /* try next */
      }
    }
    const quilt = zip.getEntry('quilt.mod.json')
    if (quilt) {
      try {
        const data = JSON.parse(quilt.getData().toString('utf8')) as {
          quilt_loader?: {
            id?: string
            version?: string
            environment?: string
            metadata?: { name?: string }
            depends?: { id?: string }[]
          }
        }
        const loader = data.quilt_loader
        if (loader?.id) {
          return {
            id: loader.id.toLowerCase(),
            name: String(loader.metadata?.name || loader.id),
            version: loader.version ?? null,
            environment:
              loader.environment === 'client'
                ? 'client'
                : loader.environment === 'server'
                  ? 'server'
                  : 'both',
            requires: cleanRequires(
              Array.isArray(loader.depends) ? loader.depends.map((item) => item?.id) : []
            )
          }
        }
      } catch {
        /* try next */
      }
    }
    for (const entryName of ['META-INF/neoforge.mods.toml', 'META-INF/mods.toml']) {
      const entry = zip.getEntry(entryName)
      if (!entry || entry.header.size > 1_000_000) continue
      try {
        const text = entry.getData().toString('utf8')
        const section = text.match(/\[\[mods\]\]([\s\S]*?)(?=\n\s*\[\[|$)/i)?.[1] ?? ''
        const id = section.match(/^\s*modId\s*=\s*["']([^"']+)["']/im)?.[1]
        if (id) {
          const name = section.match(/^\s*displayName\s*=\s*["']([^"']+)["']/im)?.[1]
          const version = section.match(/^\s*version\s*=\s*["']([^"']+)["']/im)?.[1]
          return {
            id: id.toLowerCase(),
            name: name || id,
            version: version ?? null,
            environment: null,
            requires: parseForgeRequires(text)
          }
        }
      } catch {
        /* try next */
      }
    }
    const legacy = zip.getEntry('mcmod.info')
    if (legacy) {
      try {
        const raw = JSON.parse(legacy.getData().toString('utf8')) as
          | { modList?: { modid?: string; name?: string; version?: string }[] }
          | { modid?: string; name?: string; version?: string }[]
        const first = (Array.isArray(raw) ? raw : raw.modList ?? [])[0]
        if (first?.modid) {
          return {
            id: first.modid.toLowerCase(),
            name: first.name || first.modid,
            version: first.version ?? null,
            environment: null,
            requires: []
          }
        }
      } catch {
        /* ignore */
      }
    }
  } catch {
    return null
  }
  return null
}

/** 快速按文件名判断常见的仅客户端模组，供导出后的静态检查使用。 */
export function looksClientOnlyMod(file: string): boolean {
  const name = basename(file)
  return CLIENT_ONLY_NAME.test(name) || ESSENTIAL_CLIENT.test(name)
}

export function classifyMod(file: string, meta: ModMeta | null): {
  side: ServerPackModSide
  reason: string
} {
  const id = meta?.id?.toLowerCase() ?? ''
  const name = basename(file).toLowerCase()
  if (meta?.environment === 'client') {
    return { side: 'client', reason: 'Fabric/Quilt 标记为仅客户端' }
  }
  if (id && CLIENT_ONLY_IDS.has(id)) {
    return { side: 'client', reason: '常见客户端模组' }
  }
  if (
    CLIENT_ONLY_NAME.test(name) ||
    CLIENT_ONLY_NAME.test(meta?.name ?? '') ||
    ESSENTIAL_CLIENT.test(name) ||
    ESSENTIAL_CLIENT.test(meta?.name ?? '')
  ) {
    return { side: 'client', reason: '文件名/名称匹配常见客户端模组' }
  }
  if (meta?.environment === 'server') {
    return { side: 'server', reason: 'Fabric/Quilt 标记为仅服务端' }
  }
  if (meta) return { side: 'both', reason: '未声明仅客户端，按双端处理' }
  return { side: 'unknown', reason: '无法读取元数据，按未知处理' }
}

export async function scanServerPackMods(instanceId: string): Promise<ServerPackModView[]> {
  const instance = await getInstance(instanceId)
  const gameDir = await getInstanceGameDir(instance.id)
  const dir = modsDir(gameDir)
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const mods: ServerPackModView[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.jar')) continue
    const file = join(dir, entry.name)
    try {
      const stat = await fs.stat(file)
      const meta = readModMeta(file)
      const classification = classifyMod(entry.name, meta)
      mods.push({
        file: entry.name,
        size: stat.size,
        id: meta?.id ?? null,
        name: meta?.name ?? entry.name.replace(/\.jar$/i, ''),
        version: meta?.version ?? null,
        side: classification.side,
        reason: classification.reason,
        include: classification.side !== 'client'
      })
    } catch {
      /* ignore disappearing/broken jar in the scan */
    }
  }
  mods.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  return mods
}

export async function previewServerPack(instanceId: string): Promise<ServerPackPreview> {
  const instance = await getInstance(instanceId)
  const gameDir = await getInstanceGameDir(instance.id)
  const mods = await scanServerPackMods(instance.id)
  const directories: string[] = []
  for (const name of CONFIG_DIRS) {
    if (await pathExists(join(gameDir, name))) directories.push(name)
  }
  const hasServerProperties = await pathExists(join(gameDir, 'server.properties'))
  const supportsBootstrap = ['vanilla', 'fabric', 'forge', 'neoforge'].includes(instance.loader)
  const bootstrapNote =
    instance.loader === 'quilt'
      ? 'Quilt 服务端启动器需要手动准备；这里会生成 mods、配置和启动脚本。'
      : instance.loader === 'optifine'
        ? 'OptiFine 没有可用的服务端启动器，只生成模组和配置。'
        : null
  return {
    instanceId: instance.id,
    instanceName: instance.name,
    gameVersion: instance.gameVersion,
    loader: instance.loader,
    loaderVersion: instance.loaderVersion,
    supportsBootstrap,
    bootstrapNote,
    directories,
    hasServerProperties,
    mods
  }
}

async function downloadInstaller(
  urls: string[],
  destination: string,
  expected: { sha1?: string | null; size?: number | null },
  signal: AbortSignal,
  onBytes: (bytes: number) => void
): Promise<void> {
  await downloadFile(urls, destination, {
    sha1: expected.sha1 ?? null,
    size: expected.size ?? null,
    signal,
    onBytes,
    probeSources: false
  })
}

/**
 * NeoForge 安装器内部的下载地址在部分网络不可达；与客户端安装一致，
 * 把 maven.neoforged.net 替换成官方 CDN，导出包首次安装会更稳。
 */
function patchNeoForgeInstaller(file: string): void {
  const zip = new AdmZip(file)
  let changed = false
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue
    const data = entry.getData()
    if (!data.includes(Buffer.from('maven.neoforged.net'))) continue
    const text = data
      .toString('latin1')
      .split('https://maven.neoforged.net')
      .join('https://neoforged.forgecdn.net')
      .split('http://maven.neoforged.net')
      .join('https://neoforged.forgecdn.net')
    zip.updateFile(entry, Buffer.from(text, 'latin1'))
    changed = true
  }
  if (changed) zip.writeZip(file)
}

function loaderInstallerCandidates(loader: string, gameVersion: string, loaderVersion: string | null): string[] {
  if (!loaderVersion) return []
  if (loader === 'forge') {
    const full = `${gameVersion}-${loaderVersion}`
    return [
      `https://maven.minecraftforge.net/net/minecraftforge/forge/${full}/forge-${full}-installer.jar`
    ]
  }
  if (loader === 'neoforge') {
    return [
      `https://maven.neoforged.net/releases/net/neoforged/neoforge/${loaderVersion}/neoforge-${loaderVersion}-installer.jar`,
      `https://neoforged.forgecdn.net/releases/net/neoforged/neoforge/${loaderVersion}/neoforge-${loaderVersion}-installer.jar`,
      `https://maven.neoforged.net/releases/net/neoforged/forge/${gameVersion}-${loaderVersion}/forge-${gameVersion}-${loaderVersion}-installer.jar`,
      `https://neoforged.forgecdn.net/releases/net/neoforged/forge/${gameVersion}-${loaderVersion}/forge-${gameVersion}-${loaderVersion}-installer.jar`
    ]
  }
  return []
}

async function fabricInstallerUrl(signal: AbortSignal): Promise<string> {
  const text = await fetchText(['https://meta.fabricmc.net/v2/versions/installer'], {
    signal,
    timeoutMs: 20_000
  })
  const list = JSON.parse(text) as { url?: string; stable?: boolean }[]
  const stable = list.find((item) => item.stable && typeof item.url === 'string') ?? list.find((item) => typeof item.url === 'string')
  if (!stable?.url) throw new Error('无法读取 Fabric 安装器地址')
  return stable.url
}

async function collectConfigEntries(
  gameDir: string,
  dirs: string[],
  add: (entry: StoreZipEntry) => Promise<void>
): Promise<void> {
  async function walk(root: string, rel: string): Promise<void> {
    const dir = join(root, rel)
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const childRel = rel ? join(rel, entry.name) : entry.name
      if (entry.isDirectory()) {
        await walk(root, childRel)
      } else if (entry.isFile()) {
        await add({ name: childRel.replace(/\\/g, '/'), source: join(root, childRel) })
      }
    }
  }
  for (const dir of dirs) {
    await walk(gameDir, dir)
  }
}

function propertiesText(properties: ServerPackProperties): string {
  const motd = cleanText(properties.motd, '风信服务端', 120).replace(/[\r\n]/g, ' ')
  return [
    `motd=${motd}`,
    `server-port=${properties.port}`,
    `max-players=${properties.maxPlayers}`,
    `online-mode=${properties.onlineMode}`,
    `view-distance=${properties.viewDistance}`,
    'level-name=world',
    'allow-flight=false',
    'enable-command-block=true',
    'spawn-protection=16',
    'sync-chunk-writes=true',
    'pvp=true',
    'difficulty=easy',
    'gamemode=survival',
    ''
  ].join('\n')
}

function startScripts(
  loader: string,
  gameVersion: string,
  loaderVersion: string | null,
  includeBootstrap: boolean,
  installerName: string | null
): { bat: string; sh: string } {
  const forgeInstaller = loader === 'forge' || loader === 'neoforge' ? installerName : null
  const fabricInstaller = loader === 'fabric' ? installerName : null
  const bat: string[] = ['@echo off', 'cd /d "%~dp0"', 'title Windletter Server', '']
  const sh: string[] = ['#!/usr/bin/env sh', 'cd "$(dirname "$0")"', '']
  if (loader === 'vanilla') {
    bat.push('java -Xms1G -Xmx4G -jar server.jar nogui', 'pause')
    sh.push('java -Xms1G -Xmx4G -jar server.jar nogui')
  } else if (loader === 'fabric') {
    if (includeBootstrap) {
      bat.push(
        'if not exist fabric-server-launch.jar (',
        `  java -jar ${fabricInstaller} server -mcversion ${gameVersion} -loader ${loaderVersion ?? ''} -downloadMinecraft`,
        ')'
      )
      sh.push(
        'if [ ! -f fabric-server-launch.jar ]; then',
        `  java -jar ${fabricInstaller} server -mcversion ${gameVersion} -loader ${loaderVersion ?? ''} -downloadMinecraft`,
        'fi'
      )
    } else {
      bat.push('if not exist fabric-server-launch.jar (', '  echo 请先准备 fabric-server-launch.jar 并放在此目录。', '  pause', '  exit /b 1', ')')
      sh.push('if [ ! -f fabric-server-launch.jar ]; then', '  echo 请先准备 fabric-server-launch.jar 并放在此目录。', '  exit 1', 'fi')
    }
    bat.push('java -Xms1G -Xmx4G -jar fabric-server-launch.jar nogui', 'pause')
    sh.push('java -Xms1G -Xmx4G -jar fabric-server-launch.jar nogui')
  } else if (loader === 'forge' || loader === 'neoforge') {
    if (includeBootstrap) {
      bat.push(
        'if not exist run.bat (',
        `  echo 正在安装 ${loader === 'forge' ? 'Forge' : 'NeoForge'} 服务端...`,
        `  java -jar ${forgeInstaller} --installServer`,
        ')'
      )
      sh.push(
        'if [ ! -f run.sh ]; then',
        `  echo 正在安装 ${loader === 'forge' ? 'Forge' : 'NeoForge'} 服务端...`,
        `  java -jar ${forgeInstaller} --installServer`,
        'fi'
      )
    }
    bat.push(
      'if not exist user_jvm_args.txt (',
      '  echo -Xms1G -Xmx4G > user_jvm_args.txt',
      ')',
      'if exist run.bat (',
      '  call run.bat nogui',
      ') else (',
      '  echo 服务端安装未完成，请检查 Java 与安装器输出。',
      ')',
      'pause'
    )
    sh.push(
      '[ -f user_jvm_args.txt ] || printf -- "-Xms1G\\n-Xmx4G\\n" > user_jvm_args.txt',
      'if [ -f run.sh ]; then',
      '  sh run.sh nogui',
      'else',
      '  echo 服务端安装未完成，请检查 Java 与安装器输出。',
      'fi'
    )
  } else {
    bat.push('echo 此加载器没有自动服务端启动器，请使用对应加载器安装服务端。', 'pause')
    sh.push('echo 此加载器没有自动服务端启动器，请使用对应加载器安装服务端。')
  }
  return { bat: bat.join('\r\n') + '\r\n', sh: sh.join('\n') + '\n' }
}

function readmeText(options: {
  instanceName: string
  gameVersion: string
  loader: string
  loaderVersion: string | null
  javaMajor: number | null
  included: string[]
  excluded: string[]
  includeBootstrap: boolean
  properties: ServerPackProperties
}): string {
  return [
    `风信启动器 · ${options.instanceName} 服务端包`,
    '',
    `Minecraft：${options.gameVersion}`,
    `加载器：${options.loader === 'vanilla' ? '原版' : options.loader}${options.loaderVersion ? ` ${options.loaderVersion}` : ''}`,
    `建议 Java：${options.javaMajor ? `Java ${options.javaMajor}` : '与客户端需要的主版本一致'}`,
    `端口：${options.properties.port} · 最大玩家：${options.properties.maxPlayers} · 正版验证：${options.properties.onlineMode ? '开启' : '关闭'}`,
    '',
    '使用方法：',
    '1. 先阅读并同意 Minecraft EULA，把 eula.txt 中的 eula=false 改成 eula=true。',
    '2. 双击 start-server.bat（Windows）或 chmod +x start-server.sh 后运行。',
    '3. 如果启动脚本提示缺少服务端启动器，请按脚本提示放置对应 jar；首次安装需要联网和 Java。',
    '',
    `已包含模组：${options.included.length} 个`,
    ...options.included.slice(0, 40).map((file) => `  ${file}`),
    options.included.length > 40 ? `  ... 还有 ${options.included.length - 40} 个` : '',
    '',
    `未包含的客户端/排除模组：${options.excluded.length} 个`,
    ...options.excluded.slice(0, 40).map((file) => `  ${file}`),
    options.excluded.length > 40 ? `  ... 还有 ${options.excluded.length - 40} 个` : '',
    '',
    '配置目录已按选项复制；world、logs、crash-reports、资源包和光影不会进入服务端包。',
    options.includeBootstrap
      ? '启动脚本会在首次运行时调用已包含的加载器安装器。'
      : '本次没有包含加载器安装器，请自行准备对应服务端 jar/安装器。',
    ''
  ].join('\n')
}

export async function suggestServerPackExclusions(
  instanceId: string
): Promise<ServerPackAiSuggestion> {
  const config = await getAiRuntimeConfig()
  if (!config.enabled) throw new Error('AI 辅助还没有启用')
  if (!config.baseUrl || !config.model) throw new Error('请先填写 AI 服务地址和模型')
  const preview = await previewServerPack(instanceId)
  const mods = preview.mods.slice(0, MAX_AI_MODS).map((mod) => ({
    file: mod.file,
    id: mod.id,
    name: mod.name,
    side: mod.side,
    reason: mod.reason
  }))
  const system = `你是 Minecraft 服务端整合包助手。你会收到一个客户端整合包的模组列表；请找出应当从服务端包中排除的明确客户端模组。
只依据文件、模组 ID、名称和给定的 side 信息判断；不要排除服务端前置、API、库或不确定的模组；不要编造列表外的文件名。
只返回一个 JSON 对象，不要 Markdown 代码块：
{"exclude":[{"file":"列表中的精确文件名","reason":"一句话原因"}],"notes":"给用户的一段简短说明"}
exclude 最多 80 条。`
  const payload = JSON.stringify(
    {
      instance: {
        name: preview.instanceName,
        gameVersion: preview.gameVersion,
        loader: preview.loader,
        loaderVersion: preview.loaderVersion
      },
      mods
    },
    null,
    2
  )
  const endpoint = /\/chat\/completions$/i.test(config.baseUrl)
    ? config.baseUrl
    : `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.key ? { Authorization: `Bearer ${config.key}` } : {})
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: payload }
        ],
        temperature: 0.1,
        max_tokens: 1800,
        stream: false
      }),
      signal: controller.signal
    })
  } catch (error) {
    if (controller.signal.aborted) throw new Error('AI 建议超时，请检查网络或换一个模型')
    throw new Error(`无法连接 AI 服务：${error instanceof Error ? error.message : '网络错误'}`)
  } finally {
    clearTimeout(timer)
  }
  const raw = await response.text()
  if (!response.ok) {
    throw new Error(`AI 服务返回 ${response.status}：${raw.slice(0, 240)}`)
  }
  let content = ''
  try {
    const parsed = JSON.parse(raw) as {
      choices?: { message?: { content?: string } }[]
      model?: string
    }
    content = parsed.choices?.[0]?.message?.content ?? ''
    return normalizeSuggestion(content, preview.mods, parsed.model ?? config.model)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('AI 没有')) throw error
    throw new Error('AI 返回内容无法解析')
  }
}

function normalizeSuggestion(
  content: string,
  mods: ServerPackModView[],
  model: string
): ServerPackAiSuggestion {
  const cleaned = content
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('AI 没有返回可解析的排除建议')
  const data = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>
  const files = new Set(mods.map((mod) => mod.file))
  const seen = new Set<string>()
  const exclude: { file: string; reason: string }[] = []
  if (Array.isArray(data.exclude)) {
    for (const item of data.exclude) {
      if (!item || typeof item !== 'object') continue
      const value = item as Record<string, unknown>
      if (typeof value.file !== 'string' || !files.has(value.file)) continue
      if (seen.has(value.file)) continue
      seen.add(value.file)
      exclude.push({
        file: value.file,
        reason: cleanText(value.reason, 'AI 建议排除', 240)
      })
      if (exclude.length >= 80) break
    }
  }
  if (exclude.length === 0) throw new Error('AI 没有返回可用的排除项')
  return {
    exclude,
    notes: cleanText(data.notes, 'AI 建议已生成，请逐项确认后再生成服务端包。', 1000),
    model
  }
}

export async function createServerPack(
  request: ServerPackRequest,
  progress: TaskProgress,
  signal: AbortSignal
): Promise<{ path: string; message: string }> {
  const instance = await getInstance(request.instanceId)
  if (!/\.zip$/i.test(request.outputPath)) throw new Error('服务端包必须是 .zip 文件')
  const gameDir = await getInstanceGameDir(instance.id)
  progress({
    stage: '扫描实例',
    percent: 1,
    detail: { current: 0, total: 0, bytesDone: 0, bytesTotal: 0, speed: 0 }
  })
  const mods = await scanServerPackMods(instance.id)
  const included = new Set(request.includeMods.filter((file) => mods.some((mod) => mod.file === file)))
  const includedMods = mods.filter((mod) => included.has(mod.file))
  if (includedMods.length === 0 && mods.length > 0 && request.includeMods.length > 0) {
    throw new Error('没有选中可用的模组')
  }
  if (signal.aborted) throw new CancellationError()
  const sourceBase = instance.external?.baseDir ?? instance.baseDir ?? getSettings().gameDir
  const temp = join(getCacheDir(), `serverpack-${randomUUID()}`)
  await fs.mkdir(temp, { recursive: true })
  const entries: EntryWithSize[] = []
  const addSource = async (name: string, source: string): Promise<void> => {
    const stat = await fs.stat(source)
    entries.push({ name: name.replace(/\\/g, '/'), source, bytes: stat.size })
  }
  const addData = (name: string, data: Buffer | string): void => {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8')
    entries.push({ name: name.replace(/\\/g, '/'), data: buffer, bytes: buffer.length })
  }

  try {
    for (const mod of includedMods) {
      await addSource(`mods/${mod.file}`, join(modsDir(gameDir), mod.file))
    }
    if (request.includeConfigs) {
      const dirs: string[] = []
      for (const name of CONFIG_DIRS) {
        if (await pathExists(join(gameDir, name))) dirs.push(name)
      }
      await collectConfigEntries(gameDir, dirs, async (entry) => {
        await addSource(entry.name, entry.source!)
      })
      const icon = join(gameDir, 'server-icon.png')
      if (await pathExists(icon)) await addSource('server-icon.png', icon)
    }

    const properties: ServerPackProperties = {
      motd: cleanText(request.properties.motd, '风信服务端', 120),
      port: Math.max(1, Math.min(65535, Math.round(request.properties.port))),
      maxPlayers: Math.max(1, Math.min(1000, Math.round(request.properties.maxPlayers))),
      onlineMode: Boolean(request.properties.onlineMode),
      viewDistance: Math.max(2, Math.min(32, Math.round(request.properties.viewDistance)))
    }

    let installerName: string | null = null
    if (request.includeBootstrap && ['vanilla', 'fabric', 'forge', 'neoforge'].includes(instance.loader)) {
      progress({
        stage: '准备服务端启动器',
        percent: 5,
        detail: { current: 0, total: 1, bytesDone: 0, bytesTotal: 0, speed: 0 }
      })
      if (instance.loader === 'vanilla') {
        const version = await resolveVersion(sourceBase, instance.versionId)
        const server = version.json.downloads?.server
        if (!server?.url) throw new Error('该版本没有可下载的服务端 jar')
        const target = join(temp, 'server.jar')
        await downloadInstaller(orderedUrls(server.url, getSettings().source), target, {
          sha1: server.sha1 ?? null,
          size: server.size ?? null
        }, signal, (bytes) =>
          progress({
            stage: '下载服务端 jar',
            percent: Math.min(34, 5 + Math.round((bytes / Math.max(server.size, 1)) * 29)),
            detail: { current: bytes, total: server.size ?? bytes, bytesDone: bytes, bytesTotal: server.size ?? bytes, speed: 0 }
          })
        )
        await addSource('server.jar', target)
      } else if (instance.loader === 'fabric') {
        const url = await fabricInstallerUrl(signal)
        const target = join(temp, 'fabric-installer.jar')
        await downloadInstaller([url], target, {}, signal, (bytes) =>
          progress({
            stage: '下载 Fabric 安装器',
            percent: 30,
            detail: { current: bytes, total: bytes, bytesDone: bytes, bytesTotal: bytes, speed: 0 }
          })
        )
        installerName = 'fabric-installer.jar'
        await addSource(installerName, target)
      } else {
        const urls = loaderInstallerCandidates(instance.loader, instance.gameVersion, instance.loaderVersion)
        if (urls.length === 0) throw new Error('无法确定加载器安装器地址')
        installerName = instance.loader === 'neoforge' ? 'neoforge-installer.jar' : 'forge-installer.jar'
        const target = join(temp, installerName)
        await downloadInstaller(urls, target, {}, signal, (bytes) =>
          progress({
            stage: `下载 ${instance.loader === 'forge' ? 'Forge' : 'NeoForge'} 安装器`,
            percent: 30,
            detail: { current: bytes, total: bytes, bytesDone: bytes, bytesTotal: bytes, speed: 0 }
          })
        )
        if (instance.loader === 'neoforge') patchNeoForgeInstaller(target)
        await addSource(installerName, target)
      }
    }

    const scripts = startScripts(
      instance.loader,
      instance.gameVersion,
      instance.loaderVersion,
      request.includeBootstrap,
      installerName
    )
    addData('server.properties', propertiesText(properties))
    addData('eula.txt', 'eula=false\n')
    addData('start-server.bat', scripts.bat)
    addData('start-server.sh', scripts.sh)
    const excluded = mods.filter((mod) => !included.has(mod.file)).map((mod) => mod.file)
    addData(
      'README-服务端.txt',
      readmeText({
        instanceName: instance.name,
        gameVersion: instance.gameVersion,
        loader: instance.loader,
        loaderVersion: instance.loaderVersion,
        javaMajor: instance.javaMajor,
        included: includedMods.map((mod) => mod.file),
        excluded,
        includeBootstrap: request.includeBootstrap,
        properties
      })
    )

    const totalBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0)
    await fs.mkdir(dirname(request.outputPath), { recursive: true })
    progress({
      stage: '写入服务端包',
      percent: 40,
      detail: { current: 0, total: entries.length, bytesDone: 0, bytesTotal: totalBytes, speed: 0 }
    })
    await writeStoreZip(
      request.outputPath,
      entries.map(({ bytes: _bytes, ...entry }) => entry),
      {
        signal,
        onProgress: (done, total, bytes) => {
          progress({
            stage: '写入服务端包',
            percent: 40 + Math.min(59, Math.round((bytes / Math.max(totalBytes, 1)) * 59)),
            detail: {
              current: done,
              total,
              bytesDone: bytes,
              bytesTotal: totalBytes,
              speed: 0,
              activeFiles: entries[Math.min(done, entries.length - 1)]
                ? [{ label: basename(entries[Math.min(done, entries.length - 1)].name), bytes: entries[Math.min(done, entries.length - 1)].bytes, size: entries[Math.min(done, entries.length - 1)].bytes }]
                : []
            }
          })
        }
      }
    )
    return {
      path: request.outputPath,
      message: `服务端包已生成：${request.outputPath}（${includedMods.length} 个模组）`
    }
  } catch (error) {
    await fs.rm(request.outputPath, { force: true }).catch(() => undefined)
    throw error
  } finally {
    await fs.rm(temp, { recursive: true, force: true }).catch(() => undefined)
  }
}