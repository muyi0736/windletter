import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join, normalize } from 'node:path'
import type { DownloadSource, JavaInfo, LauncherSettings } from '../../shared/types'
import { getRuntimeDir } from './config'
import { runDownloadPool, type DownloadJob } from './downloadPool'
import { getJavaRuntimeFiles, selectJavaRuntime, type SelectedRuntime } from './mojang'
import { CancellationError } from './net'
import type { TaskProgress } from './progress'
import { ratioPercent } from './progress'
import { orderedUrls, runtimeFileCandidates } from './source'
import { safeJoin } from './version'

interface ProbeResult {
  version: string
  major: number
  arch: string
  vendor: string
}

const exeName = process.platform === 'win32' ? 'java.exe' : 'java'

let javaCache: { key: string; at: number; list: JavaInfo[] } | null = null

export function clearJavaCache(): void {
  javaCache = null
}

function execCapture(file: string, args: string[], timeout = 7000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout, windowsHide: true, maxBuffer: 1024 * 1024, encoding: 'utf8' },
      (error, stdout, stderr) => {
        const output = `${stdout ?? ''}\n${stderr ?? ''}`.trim()
        if (output) resolve(output)
        else if (error) reject(error)
        else resolve('')
      }
    )
  })
}

function parseProbe(output: string): ProbeResult | null {
  const versionMatch =
    output.match(/version\s+"([^"]+)"/i) ?? output.match(/openjdk\s+([\w.\-+]+)/i) ?? output.match(/(\d+\.\d+[\w.\-+]*)/)
  if (!versionMatch) return null
  const version = versionMatch[1]
  const parts = version.split(/[.\-_+]/)
  let major = Number(parts[0])
  if (major === 1 && parts[1]) major = Number(parts[1])
  if (!Number.isFinite(major)) return null

  let vendor = 'Java'
  if (/Eclipse Adoptium|Temurin/i.test(output)) vendor = 'Adoptium'
  else if (/Microsoft/i.test(output)) vendor = 'Microsoft'
  else if (/Oracle/i.test(output)) vendor = 'Oracle'
  else if (/Azul|Zulu/i.test(output)) vendor = 'Azul'
  else if (/BellSoft|Liberica/i.test(output)) vendor = 'BellSoft'
  else if (/Amazon|Corretto/i.test(output)) vendor = 'Corretto'
  else if (/OpenJDK/i.test(output)) vendor = 'OpenJDK'

  return {
    version,
    major,
    arch: /64-Bit|Server VM/i.test(output) ? 'x64' : 'x86',
    vendor
  }
}

async function probeJava(path: string): Promise<ProbeResult | null> {
  let executable = path
  if (/javaw\.exe$/i.test(path)) {
    const sibling = path.replace(/javaw\.exe$/i, 'java.exe')
    try {
      await fs.access(sibling)
      executable = sibling
    } catch {
      /* keep javaw */
    }
  }
  try {
    const output = await execCapture(executable, ['-version'])
    return parseProbe(output)
  } catch (err) {
    const message = (err as { stdout?: string; stderr?: string }).stderr ?? ''
    return parseProbe(message)
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await fs.stat(path)).isFile()
  } catch {
    return false
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await fs.stat(path)).isDirectory()
  } catch {
    return false
  }
}

async function addCandidate(
  map: Map<string, JavaInfo['source']>,
  path: string,
  source: JavaInfo['source']
): Promise<void> {
  const normalized = normalize(path)
  const key = normalized.toLowerCase()
  if (!map.has(key) && (await isFile(normalized))) map.set(key, source)
}

async function addFromBinDir(
  map: Map<string, JavaInfo['source']>,
  dir: string | undefined,
  source: JavaInfo['source']
): Promise<void> {
  if (!dir) return
  await addCandidate(map, join(dir, exeName), source)
}

async function scanVendorRoot(
  map: Map<string, JavaInfo['source']>,
  root: string | undefined,
  source: JavaInfo['source'],
  depth = 2
): Promise<void> {
  if (!root || !(await isDirectory(root))) return
  const bin = join(root, 'bin', exeName)
  await addCandidate(map, bin, source)
  if (depth <= 0) return
  let entries
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    await scanVendorRoot(map, join(root, entry.name), source, depth - 1)
  }
}

async function scanRuntimeRoot(map: Map<string, JavaInfo['source']>, root: string): Promise<void> {
  if (!(await isDirectory(root))) return
  let components
  try {
    components = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const component of components) {
    if (!component.isDirectory()) continue
    const componentDir = join(root, component.name)
    await addFromBinDir(map, componentDir, 'runtime')
    let platforms
    try {
      platforms = await fs.readdir(componentDir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const platform of platforms) {
      if (!platform.isDirectory()) continue
      await addFromBinDir(map, join(componentDir, platform.name), 'runtime')
    }
  }
}

async function whereJava(map: Map<string, JavaInfo['source']>): Promise<void> {
  if (process.platform !== 'win32') return
  try {
    const output = await execCapture('where', ['java'], 5000)
    for (const line of output.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (trimmed) await addCandidate(map, trimmed, 'path')
    }
  } catch {
    /* java not on PATH */
  }
}

async function collectCandidates(
  gameDir: string,
  preferredPath: string | null
): Promise<Map<string, JavaInfo['source']>> {
  const map = new Map<string, JavaInfo['source']>()
  if (preferredPath) await addCandidate(map, preferredPath, 'custom')

  const env = process.env
  const programFiles = [env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramW6432].filter(
    (value): value is string => Boolean(value)
  )
  for (const base of programFiles) {
    await scanVendorRoot(map, join(base, 'Java'), 'scan')
    await scanVendorRoot(map, join(base, 'Eclipse Adoptium'), 'scan')
    await scanVendorRoot(map, join(base, 'Microsoft'), 'scan')
    await scanVendorRoot(map, join(base, 'Zulu'), 'scan')
    await scanVendorRoot(map, join(base, 'Amazon Corretto'), 'scan')
    await scanVendorRoot(map, join(base, 'BellSoft'), 'scan')
    await scanVendorRoot(map, join(base, 'GraalVM'), 'scan')
  }
  if (env.LOCALAPPDATA) {
    await scanVendorRoot(map, join(env.LOCALAPPDATA, 'Programs', 'Eclipse Adoptium'), 'scan')
    await scanVendorRoot(map, join(env.LOCALAPPDATA, 'Programs', 'Microsoft'), 'scan')
    await scanVendorRoot(
      map,
      join(env.LOCALAPPDATA, 'Packages', 'Microsoft.4297127D64EC6_8wekyb3d8bbwe', 'LocalCache', 'Local', 'runtime'),
      'runtime'
    )
  }
  if (env.JAVA_HOME) await addFromBinDir(map, join(env.JAVA_HOME, 'bin'), 'path')

  await scanRuntimeRoot(map, getRuntimeDir())
  await scanRuntimeRoot(map, join(gameDir, 'runtime'))
  if (env.APPDATA) {
    await scanRuntimeRoot(map, join(env.APPDATA, '.minecraft', 'runtime'))
  }
  await whereJava(map)

  if (env.PATH) {
    for (const entry of env.PATH.split(';')) {
      if (entry.trim()) await addCandidate(map, join(entry.trim(), exeName), 'path')
    }
  }
  return map
}

export async function detectJava(
  gameDir: string,
  preferredPath: string | null,
  refresh = false
): Promise<JavaInfo[]> {
  const key = `${gameDir}::${preferredPath ?? ''}`
  if (!refresh && javaCache && javaCache.key === key && Date.now() - javaCache.at < 60_000) {
    return javaCache.list
  }

  const candidates = await collectCandidates(gameDir, preferredPath)
  const entries = [...candidates.entries()]
  const probed: JavaInfo[] = []
  const queue = [...entries]
  let cursor = 0
  const workers = Array.from({ length: Math.min(6, queue.length || 1) }, async () => {
    while (true) {
      const index = cursor++
      if (index >= queue.length) return
      const [path, source] = queue[index]
      const result = await probeJava(path)
      if (!result) continue
      probed.push({
        path,
        version: result.version,
        major: result.major,
        vendor: result.vendor,
        arch: result.arch,
        source
      })
    }
  })
  await Promise.all(workers)

  const seen = new Set<string>()
  const list: JavaInfo[] = []
  for (const java of probed) {
    const key = java.path.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    list.push(java)
  }
  list.sort((a, b) => b.major - a.major || a.path.localeCompare(b.path))
  javaCache = { key, at: Date.now(), list }
  return list
}

export function isJavaCompatible(major: number, requiredMajor: number | null): boolean {
  if (!requiredMajor) return major >= 8
  if (requiredMajor <= 8) return major === 8
  return major >= requiredMajor
}

export function chooseJava(
  javas: JavaInfo[],
  requiredMajor: number | null,
  preferredPath: string | null,
  exact = false
): JavaInfo | null {
  if (preferredPath) {
    const found = javas.find((java) => java.path.toLowerCase() === preferredPath.toLowerCase())
    if (!found) throw new Error('设置中指定的 Java 不存在或无法运行，请在设置中重新选择')
    if (
      !(exact && requiredMajor ? found.major === requiredMajor : isJavaCompatible(found.major, requiredMajor))
    ) {
      throw new Error(
        `所选 Java ${found.major} 与游戏要求的 Java ${requiredMajor} 不兼容，请在设置中更换 Java`
      )
    }
    return found
  }

  const compatible = javas.filter((java) =>
    exact && requiredMajor
      ? java.major === requiredMajor
      : isJavaCompatible(java.major, requiredMajor)
  )
  if (!compatible.length) return null
  const target = requiredMajor ?? 8
  return compatible.sort((a, b) => {
    const aExact = a.major === target ? 0 : 1
    const bExact = b.major === target ? 0 : 1
    if (aExact !== bExact) return aExact - bExact
    if (a.major !== b.major) return a.major - b.major
    return a.path.localeCompare(b.path)
  })[0]
}

export function javaRuntimePath(component: string, platform: string): string {
  return join(getRuntimeDir(), component, platform)
}

export async function installJavaRuntime(
  runtime: SelectedRuntime,
  source: DownloadSource,
  settings: LauncherSettings,
  options: {
    signal: AbortSignal
    onProgress?: TaskProgress
  }
): Promise<JavaInfo> {
  const target = javaRuntimePath(runtime.component, runtime.platform)
  const existing = join(target, 'bin', exeName)
  if (await isFile(existing)) {
    const probe = await probeJava(existing)
    if (probe) {
      options.onProgress?.({
        stage: 'Java 已就绪',
        percent: 100,
        detail: { current: 1, total: 1, bytesDone: 0, bytesTotal: 0, speed: 0 }
      })
      return {
        path: existing,
        version: probe.version,
        major: probe.major,
        vendor: probe.vendor,
        arch: probe.arch,
        source: 'runtime'
      }
    }
  }

  options.onProgress?.({
    stage: '获取 Java 运行时信息',
    percent: 2,
    detail: { current: 0, total: 0, bytesDone: 0, bytesTotal: 0, speed: 0 }
  })
  const files = await getJavaRuntimeFiles(runtime.entry, source, options.signal)
  const jobs: DownloadJob[] = []
  const dirs: string[] = []

  for (const [relative, file] of Object.entries(files.files)) {
    const destination = safeJoin(target, relative)
    if (file.type === 'directory') {
      dirs.push(destination)
      continue
    }
    if (file.type === 'link') continue
    const raw = file.downloads?.raw
    if (!raw) continue
    jobs.push({
      urls: runtimeFileCandidates(raw.url),
      destination,
      sha1: raw.sha1,
      size: raw.size,
      label: relative
    })
  }

  await Promise.all(dirs.map((dir) => fs.mkdir(dir, { recursive: true })))

  await runDownloadPool(jobs, {
    concurrency: Math.min(32, settings.downloadConcurrency),
    signal: options.signal,
    onProgress: (detail) => {
      options.onProgress?.({
        stage: '下载 Java 运行时',
        percent: 4 + ratioPercent(detail) * 92,
        detail
      })
    }
  })

  if (options.signal.aborted) throw new CancellationError()
  const probe = await probeJava(existing)
  if (!probe) throw new Error('Java 运行时安装完成，但无法启动 java.exe，请尝试重新安装')
  javaCache = null
  options.onProgress?.({
    stage: 'Java 运行时安装完成',
    percent: 100,
    detail: { current: jobs.length, total: jobs.length, bytesDone: 0, bytesTotal: 0, speed: 0 }
  })
  return {
    path: existing,
    version: probe.version,
    major: probe.major,
    vendor: probe.vendor,
    arch: probe.arch,
    source: 'runtime'
  }
}

export async function ensureJavaForVersion(options: {
  gameDir: string
  settings: LauncherSettings
  requiredMajor: number | null
  preferredComponent?: string
  exact?: boolean
  source: DownloadSource
  signal: AbortSignal
  onProgress?: TaskProgress
}): Promise<JavaInfo> {
  const javas = await detectJava(options.gameDir, options.settings.javaPath)
  let preferredIssue: Error | null = null
  let selected: JavaInfo | null = null
  try {
    selected = chooseJava(
      javas,
      options.requiredMajor,
      options.settings.javaPath,
      options.exact
    )
  } catch (error) {
    // 设置里手动指定的 Java 只适用于它能胜任的版本；开启自动获取时，
    // 不应让一把过旧的全局 Java 拦住新版本安装或启动。
    if (!options.settings.autoJava) throw error
    preferredIssue = error instanceof Error ? error : new Error(String(error))
    selected = chooseJava(javas, options.requiredMajor, null, options.exact)
  }
  if (selected) return selected

  if (!options.settings.autoJava) {
    throw new Error(
      `未找到可用的 Java ${options.requiredMajor ?? 8}，请在设置中指定 Java，或开启自动获取 Java`
    )
  }

  if (!options.requiredMajor) throw new Error('无法确定该版本所需的 Java 版本')

  options.onProgress?.({
    stage: preferredIssue ? `自动准备 Java ${options.requiredMajor}` : '查找 Java 运行时',
    percent: 0,
    detail: { current: 0, total: 0, bytesDone: 0, bytesTotal: 0, speed: 0 }
  })
  const runtime = await selectJavaRuntime(
    options.requiredMajor,
    options.preferredComponent,
    options.source
  )
  if (!runtime) {
    throw new Error(`官方未提供适用于 Java ${options.requiredMajor} 的运行时，请手动安装 Java`)
  }

  const installed = await installJavaRuntime(runtime, options.source, options.settings, {
    signal: options.signal,
    onProgress: options.onProgress
  })
  const refreshed = await detectJava(options.gameDir, options.settings.javaPath, true)
  const final = chooseJava(
    refreshed,
    options.requiredMajor,
    options.settings.javaPath,
    options.exact
  )
  if (final) return final
  if (
    options.exact && options.requiredMajor
      ? installed.major === options.requiredMajor
      : isJavaCompatible(installed.major, options.requiredMajor)
  ) {
    return installed
  }
  throw new Error(`下载的 Java ${installed.major} 与游戏要求的 Java ${options.requiredMajor} 不兼容`)
}
