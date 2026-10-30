import AdmZip from 'adm-zip'
import { spawn, type ChildProcess } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { createServer } from 'node:net'
import { basename, delimiter, dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline'
import type {
  InstanceSummary,
  JavaInfo,
  ServerPackCheckItem,
  ServerPackInspectReport,
  ServerPackVerifyProgress,
  ServerPackVerifyReport
} from '../../shared/types'
import { getCacheDir, getLogDir, getSettings } from './config'
import { getInstance } from './instances'
import { chooseJava, detectJava } from './java'
import { CancellationError } from './net'
import { looksClientOnlyMod } from './serverPack'
import { pathExists } from './version'

const RUNTIME_LOADERS = new Set(['vanilla', 'fabric', 'forge', 'neoforge'])
const INSTALL_TIMEOUT_MS = 15 * 60_000
const BOOT_TIMEOUT_MS = 8 * 60_000
const STOP_TIMEOUT_MS = 45_000
const MAX_LOG_CHARS = 12_000_000
const TAIL_LINES = 100
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g
// 必须匹配 Minecraft 的“Done (1.234s)!”，不能误中栈里的 awaitDone(。
const DONE = /Done \([0-9][0-9.,]*s\)!/i

interface ProcessOutcome {
  code: number | null
  timedOut: boolean
  aborted: boolean
}

interface InspectContext {
  instance: InstanceSummary
  path: string
  bytes: number
  fileCount: number
  checks: ServerPackCheckItem[]
  java: JavaInfo | null
  javaReason: string | null
}

function item(
  id: string,
  title: string,
  tone: ServerPackCheckItem['tone'],
  detail: string
): ServerPackCheckItem {
  return { id, title, tone, detail }
}

function cleanLine(value: string): string {
  const clean = value.replace(ANSI, '').replace(/\r/g, '').trimEnd().slice(0, 2000)
  if (/^Picked up JAVA_TOOL_OPTIONS:/.test(clean)) return ''
  return clean
}

function cleanError(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? '未知错误')
}

function tail(lines: string[], count = TAIL_LINES): string {
  return lines.slice(-count).join('\n')
}

function sizeLabel(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(0, bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function entryKey(name: string): string {
  return name.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase()
}

function readSmallEntry(entry: AdmZip.IZipEntry, limit = 1_000_000): string {
  if (entry.header.size > limit) return ''
  try {
    return entry.getData().toString('utf8')
  } catch {
    return ''
  }
}

function mainClassOf(text: string): string | null {
  const match = text.match(/^Main-Class:\s*(.+?)\s*$/im)
  return match?.[1]?.trim() || null
}

function parseProperties(text: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const clean = line.trim()
    if (!clean || clean.startsWith('#') || clean.startsWith('!')) continue
    const index = clean.indexOf('=')
    if (index <= 0) continue
    map.set(clean.slice(0, index).trim(), clean.slice(index + 1).trim())
  }
  return map
}

function setProperty(text: string, key: string, value: string): string {
  const pattern = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=.*$`, 'm')
  if (pattern.test(text)) return text.replace(pattern, `${key}=${value}`)
  return `${text.replace(/\s*$/, '')}\n${key}=${value}\n`
}

async function pickJava(instance: InstanceSummary): Promise<{
  java: JavaInfo | null
  reason: string | null
}> {
  try {
    const settings = getSettings()
    const base = instance.external?.baseDir ?? instance.baseDir ?? settings.gameDir
    const javas = await detectJava(base, settings.javaPath, false)
    let java: JavaInfo | null = null
    if (instance.javaMajor) {
      try {
        java = chooseJava(javas, instance.javaMajor, null)
      } catch {
        java = null
      }
    } else {
      java =
        javas
          .filter((entry) => entry.major >= 8)
          .sort((a, b) => b.major - a.major || a.path.localeCompare(b.path))[0] ?? null
    }
    if (java) return { java, reason: null }
    return {
      java: null,
      reason: instance.javaMajor
        ? `本机没有找到可运行这个服务端的 Java ${instance.javaMajor}（或更高版本）`
        : '本机没有找到可用的 Java 运行时'
    }
  } catch (error) {
    return { java: null, reason: `无法检测本机 Java：${cleanError(error)}` }
  }
}

function buildInspectReport(context: InspectContext): ServerPackInspectReport {
  const blocking = context.checks.find((check) => check.tone === 'fail')
  const supported = RUNTIME_LOADERS.has(context.instance.loader)
  let runBlockReason: string | null = null
  if (!supported) {
    runBlockReason =
      context.instance.loader === 'quilt'
        ? 'Quilt 服务端需要手动准备启动器，暂不支持自动启动测试'
        : '这个加载器没有可用的服务端启动器，暂不支持自动启动测试'
  } else if (blocking) {
    runBlockReason = `静态检查未通过：${blocking.title}`
  } else if (!context.java) {
    runBlockReason = context.javaReason ?? '没有可用的 Java 运行时'
  }
  const ok = !blocking
  return {
    path: context.path,
    fileName: basename(context.path),
    bytes: context.bytes,
    fileCount: context.fileCount,
    loader: context.instance.loader,
    loaderVersion: context.instance.loaderVersion,
    gameVersion: context.instance.gameVersion,
    javaMajor: context.instance.javaMajor,
    java: context.java
      ? {
          path: context.java.path,
          version: context.java.version,
          major: context.java.major
        }
      : null,
    canRun: ok && supported && Boolean(context.java) && !runBlockReason,
    runBlockReason,
    checks: context.checks,
    ok
  }
}

function failedInspection(
  instance: InstanceSummary,
  path: string,
  reason: string,
  java: JavaInfo | null,
  javaReason: string | null
): ServerPackInspectReport {
  return buildInspectReport({
    instance,
    path,
    bytes: 0,
    fileCount: 0,
    checks: [item('zip', '读取 ZIP', 'fail', reason)],
    java,
    javaReason
  })
}

/**
 * 静态检查不启动服务器：只读取 ZIP 目录、启动脚本、属性和小型 jar 的清单。
 * 目标是快速发现“把 HTML 错误页当成 jar”“漏掉启动器”“脚本指向不存在的文件”等问题。
 */
export async function inspectServerPack(
  instanceId: string,
  path: string
): Promise<ServerPackInspectReport> {
  const instance = await getInstance(instanceId)
  const { java, reason: javaReason } = await pickJava(instance)
  let stat
  try {
    stat = await fs.stat(path)
    if (!stat.isFile()) throw new Error('不是文件')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return failedInspection(
      instance,
      path,
      code === 'ENOENT'
        ? '这个路径还没有服务端包，请先生成 ZIP 或选择已有的包。'
        : `无法读取服务端包：${cleanError(error)}`,
      java,
      javaReason
    )
  }
  let zip: AdmZip
  try {
    zip = new AdmZip(path)
  } catch (error) {
    return failedInspection(
      instance,
      path,
      `ZIP 无法打开：${cleanError(error)}`,
      java,
      javaReason
    )
  }

  const checks: ServerPackCheckItem[] = []
  const allEntries = zip.getEntries()
  const entries = allEntries.filter((entry) => !entry.isDirectory)
  const byName = new Map<string, AdmZip.IZipEntry>()
  for (const entry of entries) {
    const key = entryKey(entry.entryName)
    if (key && !byName.has(key)) byName.set(key, entry)
  }
  const fileCount = entries.length
  const find = (name: string): AdmZip.IZipEntry | null => byName.get(entryKey(name)) ?? null
  const text = (name: string, limit = 1_000_000): string => {
    const entry = find(name)
    return entry ? readSmallEntry(entry, limit) : ''
  }

  const unsafe = allEntries.find((entry) => {
    const name = entry.entryName.replace(/\\/g, '/')
    return (
      name.startsWith('/') ||
      /^[A-Za-z]:/.test(name) ||
      name.split('/').includes('..') ||
      name.includes('\0')
    )
  })
  if (unsafe) {
    checks.push(
      item(
        'zip-safety',
        'ZIP 路径安全',
        'fail',
        `包内含有不安全的路径：${unsafe.entryName}。不会解压这个包。`
      )
    )
  } else {
    checks.push(
      item(
        'zip',
        'ZIP 结构',
        'pass',
        `${fileCount} 个文件，压缩包 ${sizeLabel(stat.size)}`
      )
    )
  }

  const modEntries = entries.filter((entry) => /^mods\/[^/]+\.jar$/i.test(entryKey(entry.entryName)))
  const modBytes = modEntries.reduce((sum, entry) => sum + entry.header.size, 0)
  const emptyMods = modEntries.filter((entry) => entry.header.size === 0)
  if (modEntries.length === 0) {
    checks.push(item('mods', '模组目录', 'warn', '包内没有 mods/*.jar，启动后会是只带配置的服务端。'))
  } else {
    checks.push(
      item(
        'mods',
        '模组目录',
        emptyMods.length > 0 ? 'fail' : 'pass',
        emptyMods.length > 0
          ? `${modEntries.length} 个模组中有 ${emptyMods.length} 个空文件：${emptyMods
              .slice(0, 3)
              .map((entry) => basename(entry.entryName))
              .join('、')}`
          : `${modEntries.length} 个模组，解压后约 ${sizeLabel(modBytes)}`
      )
    )
    const clientOnly = modEntries.filter((entry) => looksClientOnlyMod(entry.entryName))
    if (clientOnly.length > 0) {
      checks.push(
        item(
          'client-mods',
          '客户端模组',
          'warn',
          `按文件名发现 ${clientOnly.length} 个常见客户端模组：${clientOnly
            .slice(0, 5)
            .map((entry) => basename(entry.entryName))
            .join('、')}${clientOnly.length > 5 ? ' 等' : ''}。它们可能让服务端启动失败。`
        )
      )
    }
  }

  const propertiesText = text('server.properties')
  if (!propertiesText) {
    checks.push(item('properties', 'server.properties', 'fail', '缺少 server.properties。'))
  } else {
    const props = parseProperties(propertiesText)
    const port = Number(props.get('server-port') ?? '')
    const problems: string[] = []
    if (!Number.isInteger(port) || port < 1 || port > 65535) problems.push('server-port 无效')
    if (!props.has('motd')) problems.push('没有 MOTD')
    checks.push(
      item(
        'properties',
        'server.properties',
        problems.length > 0 ? 'fail' : 'pass',
        problems.length > 0
          ? problems.join('；')
          : `端口 ${port} · 最大玩家 ${props.get('max-players') ?? '默认'} · 正版验证 ${
              props.get('online-mode') === 'false' ? '关闭' : '开启'
            }`
      )
    )
  }

  const eula = text('eula.txt', 100_000)
  if (!eula) {
    checks.push(item('eula', 'EULA', 'warn', '缺少 eula.txt；首次启动需要接受 Minecraft EULA。'))
  } else if (/^eula\s*=\s*true/im.test(eula)) {
    checks.push(item('eula', 'EULA', 'warn', '包内已经写成 eula=true，请确认你确实同意 EULA。'))
  } else {
    checks.push(item('eula', 'EULA', 'pass', 'eula=false，首次启动前需要手动改为 true。'))
  }

  const bat = text('start-server.bat', 200_000)
  const sh = text('start-server.sh', 200_000)
  const script = `${bat}\n${sh}`
  if (!bat && !sh) {
    checks.push(item('scripts', '启动脚本', 'fail', '缺少 start-server.bat / start-server.sh。'))
  } else if (!bat || !sh) {
    checks.push(
      item(
        'scripts',
        '启动脚本',
        'warn',
        `只找到 ${bat ? 'start-server.bat' : 'start-server.sh'}，另一个系统的脚本缺失。`
      )
    )
  } else {
    checks.push(
      item(
        'scripts',
        '启动脚本',
        'pass',
        `${bat.split(/\r?\n/).length} 行 .bat · ${sh.split(/\n/).length} 行 .sh`
      )
    )
  }

  const referenced = new Set<string>()
  for (const match of script.matchAll(/java\s+-jar\s+"?([^"\s&|)]+\.jar)"?/gi)) {
    referenced.add(entryKey(match[1]))
  }
  const requiredJars: string[] = []
  const launchJars: string[] = []
  const dropRequired = (name: string): void => {
    const index = requiredJars.indexOf(name)
    if (index >= 0) requiredJars.splice(index, 1)
  }
  for (const name of referenced) {
    if (name.includes('installer')) {
      requiredJars.push(name)
    } else if (name === 'server.jar' || name === 'fabric-server-launch.jar') {
      launchJars.push(name)
    }
  }

  const collectJarNames = (): string[] =>
    entries
      .map((entry) => entryKey(entry.entryName))
      .filter((key) => /^[^/]+\.jar$/.test(key))
  const rootJars = collectJarNames()
  const hasRootJar = (name: string): boolean => rootJars.includes(name)
  const loader = instance.loader
  let bootstrapState: 'ok' | 'missing' | 'manual' = 'manual'
  if (loader === 'vanilla') {
    if (hasRootJar('server.jar')) {
      bootstrapState = 'ok'
      requiredJars.push('server.jar')
    } else {
      bootstrapState = 'missing'
      checks.push(item('bootstrap', '服务端启动器', 'fail', '原版服务端包缺少 server.jar。'))
    }
  } else if (loader === 'fabric') {
    if (hasRootJar('fabric-server-launch.jar')) {
      bootstrapState = 'ok'
      launchJars.push('fabric-server-launch.jar')
      // 已有启动 jar 时脚本会跳过安装器；安装器缺失不算缺文件。
      dropRequired('fabric-installer.jar')
    } else if (hasRootJar('fabric-installer.jar')) {
      bootstrapState = 'ok'
      requiredJars.push('fabric-installer.jar')
    } else if (/fabric-installer\.jar|fabric-server-launch\.jar/i.test(script)) {
      bootstrapState = 'missing'
      checks.push(
        item('bootstrap', 'Fabric 启动器', 'fail', '脚本会使用 Fabric 启动器，但 ZIP 里没有安装器或启动 jar。')
      )
    } else {
      checks.push(
        item('bootstrap', 'Fabric 启动器', 'warn', '没有包含 Fabric 启动器，需要自行准备 fabric-server-launch.jar。')
      )
    }
  } else if (loader === 'forge' || loader === 'neoforge') {
    const label = loader === 'forge' ? 'Forge' : 'NeoForge'
    const installer = hasRootJar(loader === 'forge' ? 'forge-installer.jar' : 'neoforge-installer.jar')
    const runScript = Boolean(text('run.bat', 20_000) || text('run.sh', 20_000))
    const loose = rootJars.find(
      (name) =>
        name.startsWith(`${loader}-`) &&
        name.endsWith('.jar') &&
        !name.includes('installer') &&
        !name.includes('sources')
    )
    if (installer) {
      bootstrapState = 'ok'
      requiredJars.push(loader === 'forge' ? 'forge-installer.jar' : 'neoforge-installer.jar')
    } else if (runScript || loose) {
      bootstrapState = 'ok'
      if (loose) launchJars.push(loose)
      // 已经安装好的 Forge/NeoForge 包不需要再携带安装器。
      dropRequired(loader === 'forge' ? 'forge-installer.jar' : 'neoforge-installer.jar')
      checks.push(
        item(
          'bootstrap',
          `${label} 启动器`,
          'pass',
          runScript ? '已经包含安装后的 run 脚本。' : `已经包含 ${loose}。`
        )
      )
    } else if (/installer|run\.bat|run\.sh/i.test(script)) {
      bootstrapState = 'missing'
      checks.push(
        item('bootstrap', `${label} 启动器`, 'fail', `缺少 ${label} 安装器或安装后的 run 脚本。`)
      )
    } else {
      checks.push(
        item('bootstrap', `${label} 启动器`, 'warn', `没有包含 ${label} 启动器，需要自行安装。`)
      )
    }
  } else {
    checks.push(
      item(
        'bootstrap',
        '加载器启动器',
        'warn',
        loader === 'quilt'
          ? 'Quilt 服务端需要手动准备启动器。'
          : 'OptiFine 没有服务端启动器，只包含模组和配置。'
      )
    )
  }
  if (bootstrapState === 'ok' && !checks.some((check) => check.id === 'bootstrap')) {
    const bootstrapNames = [...new Set([...requiredJars, ...launchJars])]
    checks.push(
      item(
        'bootstrap',
        '服务端启动器',
        'pass',
        bootstrapNames.length > 0
          ? `已包含 ${bootstrapNames.map((name) => basename(name)).join('、')}`
          : '已包含安装后的服务端文件。'
      )
    )
  }

  const missingRefs = requiredJars.filter((name) => !hasRootJar(name))
  if (missingRefs.length > 0) {
    checks.push(
      item('missing-jars', '脚本引用', 'fail', `启动脚本引用了不存在的文件：${missingRefs.join('、')}`)
    )
  }

  for (const name of [...new Set([...requiredJars, ...launchJars])]) {
    const entry = find(name)
    if (!entry) continue
    if (entry.header.size === 0) {
      checks.push(item(`jar-${name}`, basename(name), 'fail', '这是一个空文件，不是可执行的 jar。'))
      continue
    }
    if (entry.header.size > 64 * 1024 * 1024) {
      checks.push(
        item(
          `jar-${name}`,
          basename(name),
          'info',
          `${sizeLabel(entry.header.size)}，体积较大，将由启动测试进一步验证。`
        )
      )
      continue
    }
    try {
      const nested = new AdmZip(entry.getData())
      const nestedNames = new Set(
        nested.getEntries().map((zipEntry) => entryKey(zipEntry.entryName))
      )
      const manifestEntry = nested.getEntry('META-INF/MANIFEST.MF')
      const main = manifestEntry ? mainClassOf(manifestEntry.getData().toString('utf8')) : null
      const serverMain = nestedNames.has('net/minecraft/server/main.class')
      const hasInstallProfile =
        nestedNames.has('install_profile.json') || nestedNames.has('version.json')
      const valid = Boolean(main) || serverMain || (name.includes('installer') && hasInstallProfile)
      checks.push(
        item(
          `jar-${name}`,
          basename(name),
          valid ? 'pass' : 'fail',
          valid
            ? `${main ? `Main-Class ${main}` : serverMain ? '包含 net.minecraft.server.Main' : '包含安装器描述'}`
            : '不是有效的可执行 jar（可能下载到了错误页面）。'
        )
      )
    } catch {
      checks.push(
        item(`jar-${name}`, basename(name), 'fail', '无法作为 ZIP/jar 读取，文件可能损坏。')
      )
    }
  }

  const versionMatch = script.match(/-mcversion\s+([^\s"&)]+)/i)
  if (versionMatch && versionMatch[1] !== instance.gameVersion) {
    checks.push(
      item(
        'script-version',
        '脚本版本',
        'warn',
        `脚本使用 Minecraft ${versionMatch[1]}，实例是 ${instance.gameVersion}。`
      )
    )
  }
  if (loader === 'fabric') {
    const loaderMatch = script.match(/-loader\s+([^\s"&)]+)/i)
    if (
      loaderMatch &&
      instance.loaderVersion &&
      loaderMatch[1] !== instance.loaderVersion
    ) {
      checks.push(
        item(
          'script-loader',
          'Fabric 版本',
          'warn',
          `脚本使用 loader ${loaderMatch[1]}，实例是 ${instance.loaderVersion}。`
        )
      )
    }
  }

  const configNames = ['config', 'defaultconfigs', 'serverconfig', 'scripts', 'kubejs']
  const configCounts = configNames
    .map((name) => {
      const count = entries.filter((entry) => entryKey(entry.entryName).startsWith(`${name}/`)).length
      return count > 0 ? `${name} ${count}` : null
    })
    .filter(Boolean)
  checks.push(
    item(
      'config',
      '配置目录',
      configCounts.length > 0 ? 'pass' : 'info',
      configCounts.length > 0
        ? configCounts.map((name) => `${name} 个文件`).join(' · ')
        : '没有配置目录，服务端会使用模组默认配置。'
    )
  )

  const readme = text('README-服务端.txt', 100_000)
  checks.push(
    item(
      'readme',
      '使用说明',
      readme ? 'pass' : 'warn',
      readme ? '已包含 README-服务端.txt。' : '缺少 README-服务端.txt。'
    )
  )

  const iconEntry = find('server-icon.png')
  if (iconEntry) {
    if (iconEntry.header.size > 2 * 1024 * 1024) {
      checks.push(item('icon', '服务器图标', 'warn', 'server-icon.png 超过 2 MB，已跳过格式检查。'))
    } else {
      let png = true
      try {
        const header = iconEntry.getData().subarray(0, 8)
        png = header.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      } catch {
        png = false
      }
      checks.push(
        item(
          'icon',
          '服务器图标',
          png ? 'pass' : 'warn',
          png ? 'server-icon.png 格式正常。' : 'server-icon.png 不是有效的 PNG。'
        )
      )
    }
  }

  if (java) {
    checks.push(
      item(
        'java',
        'Java 运行环境',
        'pass',
        `Java ${java.version} · ${java.path}（启动测试会使用这个 Java）`
      )
    )
  } else {
    checks.push(
      item(
        'java',
        'Java 运行环境',
        'warn',
        `${javaReason ?? '没有找到 Java'}；包本身仍可在装有 Java 的服务器上使用。`
      )
    )
  }

  return buildInspectReport({
    instance,
    path,
    bytes: stat.size,
    fileCount,
    checks,
    java,
    javaReason
  })
}

function windowsRoot(): string {
  return process.env.SystemRoot || process.env.windir || 'C:\\Windows'
}

/** 不依赖 PATH 查找 cmd.exe：从资源管理器/快捷方式启动时 PATH 可能不完整。 */
function windowsCmd(): string {
  return join(windowsRoot(), 'System32', 'cmd.exe')
}

function javaEnv(javaPath: string): NodeJS.ProcessEnv {
  const bin = dirname(javaPath)
  const home = dirname(bin)
  const current = process.env.PATH ?? process.env.Path ?? ''
  const root = windowsRoot()
  const fullPath = [
    bin,
    join(root, 'System32'),
    join(root, 'System32', 'Wbem'),
    root,
    current
  ]
    .filter(Boolean)
    .join(delimiter)
  return {
    ...process.env,
    JAVA_HOME: home,
    // Java 在中文 Windows 上默认按 GBK 输出；测试日志统一按 UTF-8 接收。
    JAVA_TOOL_OPTIONS: [
      process.env.JAVA_TOOL_OPTIONS,
      '-Dstdout.encoding=UTF-8',
      '-Dstderr.encoding=UTF-8',
      '-Dsun.stdout.encoding=UTF-8',
      '-Dsun.stderr.encoding=UTF-8'
    ]
      .filter(Boolean)
      .join(' '),
    // 同时写 PATH/Path，避免 Windows 环境块里两个大小写键一个为空导致 cmd/java 找不到。
    PATH: fullPath,
    Path: fullPath,
    ComSpec: windowsCmd()
  }
}

function killTree(child: ChildProcess): void {
  const pid = child.pid
  if (!pid) return
  if (process.platform === 'win32') {
    const killer = spawn(join(windowsRoot(), 'System32', 'taskkill.exe'), [
      '/pid',
      String(pid),
      '/T',
      '/F'
    ], {
      windowsHide: true,
      stdio: 'ignore'
    })
    killer.on('error', () => undefined)
    return
  }
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    try {
      child.kill('SIGKILL')
    } catch {
      /* already gone */
    }
  }
}

function runProcess(options: {
  file: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  timeoutMs: number
  signal: AbortSignal
  onLine?: (line: string) => void
}): Promise<ProcessOutcome> {
  return new Promise((resolve) => {
    let child: ChildProcess
    try {
      child = spawn(options.file, options.args, {
        cwd: options.cwd,
        env: options.env,
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch {
      resolve({ code: null, timedOut: false, aborted: false })
      return
    }
    let timedOut = false
    let aborted = false
    let settled = false
    let forceTimer: NodeJS.Timeout | null = null
    const finish = (code: number | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (forceTimer) clearTimeout(forceTimer)
      options.signal.removeEventListener('abort', abort)
      resolve({ code, timedOut, aborted })
    }
    const killAndFallback = (): void => {
      killTree(child)
      if (!forceTimer) forceTimer = setTimeout(() => finish(null), 5000)
    }
    const timer = setTimeout(() => {
      timedOut = true
      options.onLine?.(`等待超过 ${Math.round(options.timeoutMs / 60_000)} 分钟，已结束进程。`)
      killAndFallback()
    }, options.timeoutMs)
    const abort = (): void => {
      aborted = true
      killAndFallback()
    }
    if (options.signal.aborted) {
      abort()
    } else {
      options.signal.addEventListener('abort', abort, { once: true })
    }
    const attach = (stream: NodeJS.ReadableStream | null): void => {
      if (!stream) return
      const reader = createInterface({ input: stream })
      reader.on('line', (line) => {
        const clean = cleanLine(line)
        if (clean) options.onLine?.(clean)
      })
    }
    attach(child.stdout)
    attach(child.stderr)
    child.on('error', (error) => {
      options.onLine?.(`无法启动进程：${error.message}`)
      finish(null)
    })
    child.on('close', (code) => finish(code))
  })
}

interface ServerRunOutcome extends ProcessOutcome {
  started: boolean
  stopSent: boolean
  stopTimedOut: boolean
  doneLine: string | null
}

function runTestServer(options: {
  file: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  signal: AbortSignal
  onLine?: (line: string) => void
  onStarted?: (line: string) => void
}): Promise<ServerRunOutcome> {
  return new Promise((resolve) => {
    let child: ChildProcess
    try {
      child = spawn(options.file, options.args, {
        cwd: options.cwd,
        env: options.env,
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe']
      })
    } catch {
      resolve({
        code: null,
        timedOut: false,
        aborted: false,
        started: false,
        stopSent: false,
        stopTimedOut: false,
        doneLine: null
      })
      return
    }
    let started = false
    let stopSent = false
    let stopTimedOut = false
    let bootTimedOut = false
    let aborted = false
    let settled = false
    let doneLine: string | null = null
    let lastOutputAt = Date.now()
    let bootTimer: NodeJS.Timeout | null = null
    let stopTimer: NodeJS.Timeout | null = null
    let watchdog: NodeJS.Timeout | null = null
    let forceTimer: NodeJS.Timeout | null = null
    const finish = (code: number | null): void => {
      if (settled) return
      settled = true
      if (bootTimer) clearTimeout(bootTimer)
      if (stopTimer) clearTimeout(stopTimer)
      if (watchdog) clearInterval(watchdog)
      if (forceTimer) clearTimeout(forceTimer)
      options.signal.removeEventListener('abort', abort)
      resolve({
        code,
        timedOut: bootTimedOut,
        aborted,
        started,
        stopSent,
        stopTimedOut,
        doneLine
      })
    }
    const killAndFallback = (): void => {
      killTree(child)
      if (!forceTimer) forceTimer = setTimeout(() => finish(null), 5000)
    }
    // 不在正常运行时向服务器灌空行（会刷 Unknown command）；只在长时间静默时
    // 认为可能停在批处理 pause，补一个回车。停止后 8 秒、启动期 30 秒。
    watchdog = setInterval(() => {
      if (settled) return
      const limit = stopSent ? 8000 : 30000
      if (Date.now() - lastOutputAt < limit) return
      lastOutputAt = Date.now()
      try {
        child.stdin?.write('\n')
      } catch {
        /* already closed */
      }
    }, 4000)
    const stop = (): void => {
      if (settled || stopSent) return
      stopSent = true
      try {
        child.stdin?.write('stop\n')
      } catch {
        /* already closed */
      }
      stopTimer = setTimeout(() => {
        stopTimedOut = true
        options.onLine?.('服务器没有在 45 秒内响应 stop，已强制结束测试进程。')
        killAndFallback()
      }, STOP_TIMEOUT_MS)
    }
    bootTimer = setTimeout(() => {
      if (started) return
      bootTimedOut = true
      options.onLine?.(
        `等待服务器输出 Done 超过 ${Math.round(BOOT_TIMEOUT_MS / 60_000)} 分钟，已结束进程。`
      )
      killAndFallback()
    }, BOOT_TIMEOUT_MS)
    const abort = (): void => {
      aborted = true
      if (bootTimer) clearTimeout(bootTimer)
      if (stopTimer) clearTimeout(stopTimer)
      killAndFallback()
    }
    if (options.signal.aborted) {
      abort()
    } else {
      options.signal.addEventListener('abort', abort, { once: true })
    }
    const handle = (stream: NodeJS.ReadableStream | null): void => {
      if (!stream) return
      const reader = createInterface({ input: stream })
      reader.on('line', (line) => {
        const clean = cleanLine(line)
        if (!clean) return
        lastOutputAt = Date.now()
        options.onLine?.(clean)
        if (!started && DONE.test(clean)) {
          started = true
          doneLine = clean
          if (bootTimer) clearTimeout(bootTimer)
          options.onStarted?.(clean)
          setTimeout(stop, 1500)
        }
      })
    }
    handle(child.stdout)
    handle(child.stderr)
    child.stdin?.on('error', () => undefined)
    child.on('error', (error) => {
      options.onLine?.(`无法启动服务器：${error.message}`)
      finish(null)
    })
    child.on('close', (code) => finish(code))
  })
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 25565
      server.close(() => resolve(port))
    })
  })
}

async function findLooseForgeJar(dir: string, loader: string): Promise<string | null> {
  let names: string[]
  try {
    names = await fs.readdir(dir)
  } catch {
    return null
  }
  const candidates = names
    .filter((name) => {
      const lower = name.toLowerCase()
      return (
        lower.endsWith('.jar') &&
        lower.startsWith(`${loader}-`) &&
        !lower.includes('installer') &&
        !lower.includes('sources') &&
        !lower.includes('javadoc')
      )
    })
    .sort((a, b) => b.length - a.length)
  return candidates[0] ?? null
}

async function writeVerificationLog(
  path: string,
  instance: InstanceSummary,
  javaPath: string,
  lines: string[]
): Promise<string | null> {
  if (lines.length === 0) return null
  try {
    const dir = join(getLogDir(), 'serverpack-check')
    await fs.mkdir(dir, { recursive: true })
    const now = new Date()
    const pad = (value: number): string => String(value).padStart(2, '0')
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(
      now.getHours()
    )}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
    const target = join(
      dir,
      `${basename(path).replace(/\.zip$/i, '')}-${stamp}.log`
    )
    const header = [
      `风信启动器 · 服务端包启动测试`,
      `时间：${new Date().toLocaleString()}`,
      `实例：${instance.name}（${instance.loader}${instance.loaderVersion ? ` ${instance.loaderVersion}` : ''} · Minecraft ${instance.gameVersion}）`,
      `服务端包：${path}`,
      `Java：${javaPath}`,
      '',
      ''
    ].join('\n')
    await fs.writeFile(target, header + lines.join('\n'), 'utf8')
    return target
  } catch {
    return null
  }
}

export async function verifyServerPack(
  instanceId: string,
  path: string,
  onProgress: (progress: ServerPackVerifyProgress) => void,
  signal: AbortSignal
): Promise<ServerPackVerifyReport> {
  const startedAt = Date.now()
  const instance = await getInstance(instanceId)
  const checks: ServerPackCheckItem[] = []
  const log: string[] = []
  let logChars = 0
  let temp = ''
  let javaPath = ''
  const reportHolder: { current: ServerPackVerifyReport | null } = { current: null }

  const progress = (stage: string, percent: number, line: string | null = null): void => {
    try {
      onProgress({ path, stage, percent, line })
    } catch {
      /* renderer may have closed */
    }
  }
  const addLog = (line: string): void => {
    if (!line) return
    log.push(line)
    logChars += line.length + 1
    while (log.length > 5000 || logChars > MAX_LOG_CHARS) {
      const removed = log.shift()
      if (!removed) break
      logChars -= removed.length + 1
    }
  }
  const pushCheck = (
    id: string,
    title: string,
    tone: ServerPackCheckItem['tone'],
    detail: string
  ): void => {
    checks.push(item(id, title, tone, detail))
  }
  const finish = (
    ok: boolean,
    cancelled: boolean,
    summary: string
  ): ServerPackVerifyReport => {
    const report: ServerPackVerifyReport = {
      ok,
      cancelled,
      summary,
      durationMs: Math.max(0, Date.now() - startedAt),
      checks,
      logPath: null,
      logTail: tail(log, 100)
    }
    reportHolder.current = report
    return report
  }

  try {
    progress('读取服务端包', 2)
    const inspect = await inspectServerPack(instanceId, path)
    if (!inspect.ok) {
      pushCheck(
        'static',
        '静态检查',
        'fail',
        inspect.checks.find((check) => check.tone === 'fail')?.detail ?? '静态检查未通过'
      )
      progress('静态检查未通过', 100)
      return finish(false, false, '静态检查未通过，先修复包内问题再启动测试。')
    }
    if (!inspect.canRun || !inspect.java) {
      pushCheck(
        'runtime',
        '启动测试环境',
        'warn',
        inspect.runBlockReason ?? '当前环境无法进行启动测试'
      )
      progress('无法启动测试', 100)
      return finish(false, false, inspect.runBlockReason ?? '当前环境无法进行启动测试')
    }
    javaPath = inspect.java.path
    const javaMajor = inspect.java.major
    if (inspect.javaMajor && javaMajor < inspect.javaMajor) {
      pushCheck(
        'java',
        'Java 版本',
        'fail',
        `需要 Java ${inspect.javaMajor}，找到的是 Java ${javaMajor}。`
      )
      return finish(false, false, 'Java 版本不匹配。')
    }
    pushCheck('java', 'Java 运行时', 'pass', `Java ${inspect.java.version} · ${javaPath}`)

    if (signal.aborted) throw new CancellationError()
    temp = join(getCacheDir(), `serverpack-check-${randomUUID()}`)
    await fs.mkdir(temp, { recursive: true })
    progress('解压到临时目录', 8)
    const zip = new AdmZip(path)
    await new Promise<void>((resolve, reject) => {
      zip.extractAllToAsync(temp, true, false, (error) => {
        if (error) reject(error)
        else resolve()
      })
    })
    if (signal.aborted) throw new CancellationError()
    pushCheck('extract', '解压测试副本', 'pass', '已解压到临时目录，不会改动 ZIP 和原实例。')

    const port = await freePort()
    const propsPath = join(temp, 'server.properties')
    let props = await fs.readFile(propsPath, 'utf8').catch(() => '')
    props = setProperty(props, 'server-port', String(port))
    await fs.writeFile(propsPath, props)
    await fs.writeFile(join(temp, 'eula.txt'), 'eula=true\n')
    addLog(`测试端口：${port}；测试副本已写入 eula=true、server-port=${port}`)
    progress('准备测试服务器', 12, `端口 ${port}`)

    let installNote = ''
    let lastInstallAt = 0
    const installLine = (stage: string) => (line: string): void => {
      addLog(line)
      const now = Date.now()
      if (now - lastInstallAt > 250 || /error|exception|failed/i.test(line)) {
        lastInstallAt = now
        progress(stage, 18, line)
      }
    }
    if (instance.loader === 'fabric') {
      const launchJar = join(temp, 'fabric-server-launch.jar')
      if (!(await pathExists(launchJar))) {
        const installer = join(temp, 'fabric-installer.jar')
        if (!(await pathExists(installer))) {
          throw new Error('缺少 fabric-installer.jar，无法安装 Fabric 服务端')
        }
        progress('运行 Fabric 安装器', 18)
        const outcome = await runProcess({
          file: javaPath,
          args: [
            '-Djava.awt.headless=true',
            '-jar',
            'fabric-installer.jar',
            'server',
            '-mcversion',
            instance.gameVersion,
            '-loader',
            instance.loaderVersion ?? '',
            '-downloadMinecraft'
          ],
          cwd: temp,
          env: javaEnv(javaPath),
          timeoutMs: INSTALL_TIMEOUT_MS,
          signal,
          onLine: installLine('运行 Fabric 安装器')
        })
        if (outcome.aborted || signal.aborted) throw new CancellationError()
        if (outcome.timedOut) throw new Error('Fabric 安装器运行超时')
        if (outcome.code !== 0) {
          throw new Error(`Fabric 安装器失败，退出码 ${outcome.code ?? '未知'}`)
        }
        if (!(await pathExists(launchJar))) {
          throw new Error('Fabric 安装器运行完成，但没有生成 fabric-server-launch.jar')
        }
        pushCheck('install', 'Fabric 安装器', 'pass', '已生成 fabric-server-launch.jar。')
        installNote = 'Fabric 安装器已运行'
      } else {
        pushCheck('install', 'Fabric 启动器', 'pass', '包内已有 fabric-server-launch.jar。')
        installNote = '使用包内已有启动 jar'
      }
    } else if (instance.loader === 'forge' || instance.loader === 'neoforge') {
      const label = instance.loader === 'forge' ? 'Forge' : 'NeoForge'
      const runFile = await pathExists(join(temp, 'run.bat'))
        ? 'run.bat'
        : (await pathExists(join(temp, 'run.sh')))
          ? 'run.sh'
          : null
      if (!runFile) {
        const installerName =
          instance.loader === 'forge' ? 'forge-installer.jar' : 'neoforge-installer.jar'
        if (!(await pathExists(join(temp, installerName)))) {
          const loose = await findLooseForgeJar(temp, instance.loader)
          if (!loose) {
            throw new Error(`缺少 ${label} 安装器，也没有找到已安装的服务端 jar`)
          }
          pushCheck('install', `${label} 服务端`, 'pass', `使用已安装的 ${loose}。`)
          installNote = `使用已有 ${loose}`
        } else {
          progress(`运行 ${label} 安装器`, 18)
          const outcome = await runProcess({
            file: javaPath,
            args: ['-Djava.awt.headless=true', '-jar', installerName, '--installServer'],
            cwd: temp,
            env: javaEnv(javaPath),
            timeoutMs: INSTALL_TIMEOUT_MS,
            signal,
            onLine: installLine(`运行 ${label} 安装器`)
          })
          if (outcome.aborted || signal.aborted) throw new CancellationError()
          if (outcome.timedOut) throw new Error(`${label} 安装器运行超时`)
          if (outcome.code !== 0) {
            throw new Error(`${label} 安装器失败，退出码 ${outcome.code ?? '未知'}`)
          }
          const installed =
            (await pathExists(join(temp, 'run.bat'))) ||
            (await pathExists(join(temp, 'run.sh'))) ||
            Boolean(await findLooseForgeJar(temp, instance.loader))
          if (!installed) {
            throw new Error(`${label} 安装器没有生成 run 脚本或服务端 jar`)
          }
          pushCheck('install', `${label} 安装器`, 'pass', `已生成 ${label} 服务端运行文件。`)
          installNote = `${label} 安装器已运行`
        }
      } else {
        pushCheck('install', `${label} 服务端`, 'pass', `包内已有 ${runFile}。`)
        installNote = '使用包内已有运行脚本'
      }
      const jvmArgs = join(temp, 'user_jvm_args.txt')
      if (!(await pathExists(jvmArgs))) {
        const memory = Math.min(
          Math.max(instance.memoryMb ?? getSettings().maxMemoryMb, 1024),
          8192
        )
        await fs.writeFile(jvmArgs, `-Xms512M\n-Xmx${memory}M\n`, 'utf8')
      }
    } else if (instance.loader === 'vanilla') {
      if (!(await pathExists(join(temp, 'server.jar')))) {
        throw new Error('缺少 server.jar，无法启动原版服务端')
      }
      pushCheck('install', '原版服务端', 'pass', '使用包内 server.jar。')
    } else {
      throw new Error('这个加载器暂不支持自动启动测试')
    }

    const memory = Math.min(
      Math.max(instance.memoryMb ?? getSettings().maxMemoryMb, 1024),
      8192
    )
    const launch = await (async (): Promise<{ file: string; args: string[] }> => {
      if (instance.loader === 'vanilla') {
        return {
          file: javaPath,
          args: [`-Xms512M`, `-Xmx${memory}M`, '-jar', 'server.jar', 'nogui']
        }
      }
      if (instance.loader === 'fabric') {
        return {
          file: javaPath,
          args: [`-Xms512M`, `-Xmx${memory}M`, '-jar', 'fabric-server-launch.jar', 'nogui']
        }
      }
      const runBat = await pathExists(join(temp, 'run.bat'))
      const runSh = await pathExists(join(temp, 'run.sh'))
      if (process.platform === 'win32' && runBat) {
        return {
          file: windowsCmd(),
          args: ['/d', '/s', '/c', 'chcp 65001>nul & run.bat nogui']
        }
      }
      if (runSh) {
        return { file: '/bin/sh', args: ['run.sh', 'nogui'] }
      }
      const loose = await findLooseForgeJar(temp, instance.loader)
      if (!loose) throw new Error('没有找到可执行的服务端 jar')
      return {
        file: javaPath,
        args: [`-Xms512M`, `-Xmx${memory}M`, '-jar', loose, 'nogui']
      }
    })()

    if (signal.aborted) throw new CancellationError()
    progress(
      `启动服务器 · 等待 Done（Java ${javaMajor}${installNote ? ` · ${installNote}` : ''}）`,
      35,
      `使用端口 ${port}，最大内存 ${memory} MB`
    )
    let lastBootAt = 0
    const run = await runTestServer({
      file: launch.file,
      args: launch.args,
      cwd: temp,
      env: javaEnv(javaPath),
      signal,
      onLine: (line) => {
        addLog(line)
        const now = Date.now()
        if (
          now - lastBootAt > 150 ||
          /error|exception|failed|preparing|starting|stopping|done/i.test(line)
        ) {
          lastBootAt = now
          progress('服务器启动中', 70, line)
        }
      },
      onStarted: (line) => {
        addLog(`检测到启动完成：${line}`)
        progress('已检测到 Done，正在发送 stop', 95, line)
      }
    })
    if (run.aborted || signal.aborted) {
      progress('已取消启动测试', 100)
      return finish(false, true, '已取消启动测试。')
    }
    if (!run.started) {
      const duration = Math.round((Date.now() - startedAt) / 1000)
      const recent = tail(log, 80)
      const hint = /UnsupportedClassVersionError|class file version/i.test(recent)
        ? 'Java 版本不匹配'
        : /OutOfMemoryError/i.test(recent)
          ? '测试内存不足'
          : /LoadingFailedException|Incompatible mod|Missing or unsupported mandatory dependencies|Mod resolution failed|requires .* or above/i.test(recent)
            ? '模组加载失败（依赖或双端不兼容）'
            : /Address already in use|Failed to bind to port/i.test(recent)
              ? '端口被占用'
              : run.timedOut
                ? '等待 Done 超时'
                : '服务器在输出 Done 之前退出'
      pushCheck(
        'boot',
        '服务器启动',
        'fail',
        `${hint}。退出码 ${run.code ?? '未知'}，耗时 ${duration} 秒。`
      )
      progress('启动测试失败', 100)
      return finish(false, false, `${hint}，详情见下方日志。`)
    }
    pushCheck(
      'boot',
      '服务器启动',
      'pass',
      `${run.doneLine ?? '已输出 Done'}（${Math.round((Date.now() - startedAt) / 1000)} 秒）`
    )
    if (run.stopTimedOut) {
      pushCheck('stop', '停止服务器', 'warn', '启动成功，但 stop 超时，测试进程已强制结束。')
    } else if (!run.stopSent) {
      pushCheck(
        'stop',
        '停止服务器',
        'warn',
        `服务器在发送 stop 前自行退出，退出码 ${run.code ?? '未知'}；建议查看日志确认是否在启动后崩溃。`
      )
    } else {
      pushCheck('stop', '停止服务器', 'pass', `已发送 stop，退出码 ${run.code ?? '未知'}。`)
    }

    // 第二段：直接运行导出包里的启动脚本，验证接收者双击/执行时真的能起服。
    const scriptName = process.platform === 'win32' ? 'start-server.bat' : 'start-server.sh'
    let scriptTested = false
    if (await pathExists(join(temp, scriptName))) {
      scriptTested = true
      const scriptPort = await freePort()
      let scriptProps = await fs.readFile(propsPath, 'utf8').catch(() => '')
      scriptProps = setProperty(scriptProps, 'server-port', String(scriptPort))
      await fs.writeFile(propsPath, scriptProps)
      addLog(`--- 直接运行导出的启动脚本 ${scriptName}，端口 ${scriptPort} ---`)
      progress(`运行导出的启动脚本 ${scriptName}`, 96, `端口 ${scriptPort}`)
      const scriptRun = await runTestServer({
        file: process.platform === 'win32' ? windowsCmd() : '/bin/sh',
        args:
          process.platform === 'win32'
            ? ['/d', '/s', '/c', `chcp 65001>nul & ${scriptName}`]
            : [scriptName],
        cwd: temp,
        env: javaEnv(javaPath),
        signal,
        onLine: (line) => {
          addLog(line)
          const now = Date.now()
          if (now - lastBootAt > 150 || /error|exception|failed|done/i.test(line)) {
            lastBootAt = now
            progress('运行导出的启动脚本', 96, line)
          }
        },
        onStarted: (line) => {
          addLog(`导出的启动脚本输出 Done：${line}`)
          progress('导出的启动脚本已启动，正在发送 stop', 98, line)
        }
      })
      if (scriptRun.aborted || signal.aborted) {
        progress('已取消启动测试', 100)
        return finish(false, true, '已取消启动测试。')
      }
      if (!scriptRun.started) {
        pushCheck(
          'script',
          '导出的启动脚本',
          'fail',
          `直接运行 ${scriptName} 未输出 Done（退出码 ${scriptRun.code ?? '未知'}）。`
        )
        progress('导出的启动脚本测试失败', 100)
        return finish(false, false, `服务器本体可启动，但直接运行 ${scriptName} 失败，详情见日志。`)
      }
      pushCheck(
        'script',
        '导出的启动脚本',
        scriptRun.stopTimedOut ? 'warn' : 'pass',
        scriptRun.stopTimedOut
          ? `已直接运行 ${scriptName} 并输出 Done，但 stop 后等待脚本收尾超时。`
          : `已直接运行 ${scriptName}，输出 Done 并完成 stop。`
      )
    } else {
      pushCheck(
        'script',
        '导出的启动脚本',
        'warn',
        `没有找到 ${scriptName}，未直接执行导出的启动脚本。`
      )
    }

    progress('启动测试通过', 100)
    return finish(
      true,
      false,
      scriptTested
        ? `服务端和导出的启动脚本都已实际启动并输出 Done，随后已 stop；测试副本已清理。`
        : `服务端已实际启动并输出 Done，随后已 stop；没有找到 ${scriptName}，脚本未执行。`
    )
  } catch (error) {
    if (error instanceof CancellationError || signal.aborted) {
      progress('已取消启动测试', 100)
      return finish(false, true, '已取消启动测试。')
    }
    const message = cleanError(error)
    addLog(`验证失败：${message}`)
    pushCheck('error', '启动测试', 'fail', message)
    progress('启动测试失败', 100)
    return finish(false, false, message)
  } finally {
    const finalReport: ServerPackVerifyReport | null = reportHolder.current
    if (finalReport && log.length > 0) {
      finalReport.logPath = await writeVerificationLog(path, instance, javaPath, log)
      finalReport.logTail = tail(log, 100)
    }
    if (temp) {
      await fs.rm(temp, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}
