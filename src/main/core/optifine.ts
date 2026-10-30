import AdmZip from 'adm-zip'
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import type { LoaderVersionView } from '../../shared/types'
import type { LoaderInstallOptions, LoaderInstallResult } from './loaders'
import { CancellationError, downloadFile, fetchJson } from './net'
import { emptyDetail, type TaskProgress } from './progress'
import { pathExists, writeFileAtomic } from './version'

const OPTIFINE_MIRROR = 'https://bmclapi2.bangbang93.com/optifine'
const SAFE_GAME_VERSION = /^[A-Za-z0-9._+\-]{1,64}$/
const SAFE_EDITION = /^[A-Za-z0-9._]{1,64}$/
const TEMP_PREFIX = '.windletter-optifine-'

interface OptiFineBuild {
  _id?: string
  type?: string
  patch?: string
  filename?: string
  mcversion?: string
  forge?: string
}

interface OptiFineBuildInfo {
  edition: string
  type: string
  patch: string
  filename: string
  preview: boolean
  releasedAt?: string
  forgeCompatible: boolean
}

function dateFromObjectId(id: string | undefined): string | undefined {
  if (!id || !/^[0-9a-f]{24}$/i.test(id)) return undefined
  const seconds = Number.parseInt(id.slice(0, 8), 16)
  if (!Number.isFinite(seconds)) return undefined
  const date = new Date(seconds * 1000)
  if (Number.isNaN(date.getTime())) return undefined
  return date.toISOString().slice(0, 10)
}

/** 同时接受正式版（HD_U_J9）与测试版（HD_U_K2_pre5）的版式编号。 */
function buildInfoOf(build: OptiFineBuild): OptiFineBuildInfo | null {
  const type = (build.type ?? '').trim()
  const patch = (build.patch ?? '').trim()
  const filename = (build.filename ?? '').trim()
  if (!type || !patch || !filename.toLowerCase().endsWith('.jar')) return null
  if (!/^[A-Za-z0-9._\-]+$/.test(type) || !/^[A-Za-z0-9._\-]+$/.test(patch)) return null
  const edition = `${type}_${patch}`
  if (!SAFE_EDITION.test(edition)) return null
  const preview = filename.toLowerCase().startsWith('preview_') || /^pre/i.test(patch)
  return {
    edition,
    type,
    patch,
    filename,
    preview,
    releasedAt: preview ? dateFromObjectId(build._id) : undefined,
    forgeCompatible: !/n\/a/i.test(build.forge ?? '')
  }
}

function compareEditions(a: string, b: string): number {
  const left = a.split('_')
  const right = b.split('_')
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const partA = left[index] ?? ''
    const partB = right[index] ?? ''
    if (partA === partB) continue
    const delta = partA.localeCompare(partB, 'en', { numeric: true, sensitivity: 'base' })
    if (delta !== 0) return delta
  }
  return 0
}

async function readBuilds(
  gameVersion: string,
  signal?: AbortSignal
): Promise<OptiFineBuildInfo[]> {
  if (!SAFE_GAME_VERSION.test(gameVersion)) throw new Error('无效的 Minecraft 版本')
  const list = await fetchJson<OptiFineBuild[]>(
    [`${OPTIFINE_MIRROR}/${encodeURIComponent(gameVersion)}`],
    { signal, timeoutMs: 20_000 }
  )
  if (!Array.isArray(list)) return []
  const seen = new Set<string>()
  const builds: OptiFineBuildInfo[] = []
  for (const raw of list) {
    const build = buildInfoOf(raw)
    if (!build || seen.has(build.edition)) continue
    seen.add(build.edition)
    builds.push(build)
  }
  builds.sort((a, b) => compareEditions(a.edition, b.edition))
  return builds
}

export async function listOptiFineVersions(
  gameVersion: string,
  signal?: AbortSignal
): Promise<LoaderVersionView[]> {
  const builds = await readBuilds(gameVersion, signal)
  const stable = builds.filter((build) => !build.preview).reverse()
  if (stable.length > 0) {
    // 有正式版时只列正式版，避免把测试版混进常规安装目标。
    return stable.map((build, index) => ({
      version: build.edition,
      latest: index === 0,
      channel: 'stable'
    }))
  }
  // 只有测试版的版本（如 26.2）沿用 OptiFine 官网当前展示的最新三个预览构建。
  const preview = builds.filter((build) => build.preview).reverse().slice(0, 3)
  return preview.map((build) => ({
    version: build.edition,
    latest: false,
    channel: 'preview',
    releasedAt: build.releasedAt,
    note: build.forgeCompatible ? undefined : '不兼容 Forge'
  }))
}

async function removeJunction(linkPath: string): Promise<boolean> {
  try {
    const stat = await fs.lstat(linkPath)
    if (!stat.isSymbolicLink() && !stat.isDirectory()) return true
    if (stat.isSymbolicLink()) {
      await fs.unlink(linkPath)
      return true
    }
    // Windows junction 在某些 Node 版本下被识别为目录，rmdir 只会移除链接本身。
    await fs.rmdir(linkPath)
    return true
  } catch {
    return !(await pathExists(linkPath))
  }
}

async function cleanStaleDirs(gameDir: string): Promise<void> {
  let entries
  try {
    entries = await fs.readdir(gameDir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(TEMP_PREFIX)) continue
    const stale = join(gameDir, entry.name)
    await removeJunction(join(stale, 'appdata', '.minecraft'))
    await removeJunction(join(stale, 'appdata', 'Library', 'Application Support', 'minecraft'))
    if (await pathExists(join(stale, 'appdata', '.minecraft'))) continue
    await fs.rm(stale, { recursive: true, force: true }).catch(() => undefined)
  }
}

function runInstaller(
  javaPath: string,
  jarPath: string,
  appData: string,
  cwd: string,
  signal: AbortSignal,
  onLine: (line: string, count: number) => void
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new CancellationError())
      return
    }
    const child = spawn(
      javaPath,
      [
        '-Djava.awt.headless=true',
        `-Duser.home=${appData}`,
        '-cp',
        jarPath,
        'optifine.Installer'
      ],
      {
        cwd,
        windowsHide: true,
        env: {
          ...process.env,
          APPDATA: appData,
          HOME: appData,
          USERPROFILE: appData
        },
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )
    let output = ''
    let count = 0
    let lastEmit = 0
    const handle = (chunk: Buffer) => {
      output = `${output}${chunk.toString('utf8')}`.slice(-24_000)
      count += 1
      const now = Date.now()
      if (now - lastEmit < 350) return
      lastEmit = now
      onLine('应用 OptiFine 补丁', count)
    }
    child.stdout?.on('data', handle)
    child.stderr?.on('data', handle)
    const abort = () => child.kill()
    signal.addEventListener('abort', abort, { once: true })
    child.on('error', (error) => {
      signal.removeEventListener('abort', abort)
      reject(new Error(`无法启动 OptiFine 安装器：${error.message}`))
    })
    child.on('close', (code) => {
      signal.removeEventListener('abort', abort)
      if (signal.aborted) {
        reject(new CancellationError())
        return
      }
      if (code === 0) {
        resolve()
        return
      }
      const tail = output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(-10)
        .join('\n')
      reject(
        new Error(
          `OptiFine 安装器失败（退出码 ${code ?? '未知'}）${tail ? `：\n${tail}` : ''}`
        )
      )
    })
  })
}

async function findInstalledVersion(
  gameDir: string,
  gameVersion: string,
  edition: string
): Promise<string | null> {
  const expected = `${gameVersion}-OptiFine_${edition}`
  if (await pathExists(join(gameDir, 'versions', expected, `${expected}.json`))) return expected
  let entries: string[] = []
  try {
    entries = (await fs.readdir(join(gameDir, 'versions'), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return null
  }
  const prefix = `${gameVersion}-OptiFine_`
  const candidates = entries
    .filter((id) => id.startsWith(prefix))
    .sort((a, b) => compareEditions(a.slice(prefix.length), b.slice(prefix.length)))
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const id = candidates[index]
    const jsonPath = join(gameDir, 'versions', id, `${id}.json`)
    try {
      const json = JSON.parse(await fs.readFile(jsonPath, 'utf8')) as {
        id?: string
        libraries?: Array<{ name?: string }>
      }
      if (
        json.id === id &&
        Array.isArray(json.libraries) &&
        json.libraries.some((library) => (library.name ?? '').includes(`optifine:OptiFine:`))
      ) {
        return id
      }
    } catch {
      /* keep looking */
    }
  }
  return null
}

export async function installOptiFineProfile(
  options: LoaderInstallOptions
): Promise<LoaderInstallResult> {
  const { gameDir, gameVersion, signal, onProgress, javaPath } = options
  let edition = (options.loaderVersion ?? '').trim()
  if (!SAFE_GAME_VERSION.test(gameVersion)) throw new Error('无效的 Minecraft 版本')
  if (edition && !SAFE_EDITION.test(edition)) throw new Error('无效的 OptiFine 版本')
  if (!javaPath) {
    throw new Error('安装 OptiFine 需要可用的 Java 运行环境')
  }
  const report = (stage: string, percent: number, detail = emptyDetail()) => {
    onProgress({ stage, percent: Math.max(0, Math.min(100, percent)), detail })
  }

  report('检查 OptiFine 版本', 3)
  const builds = await readBuilds(gameVersion, signal)
  if (!edition) {
    const stableBuilds = builds.filter((entry) => !entry.preview)
    edition = (stableBuilds.length > 0 ? stableBuilds : builds).at(-1)?.edition ?? ''
  }
  const build = builds.find((entry) => entry.edition === edition)
  if (!build) {
    throw new Error(
      builds.length === 0
        ? `OptiFine 尚未发布适用于 Minecraft ${gameVersion} 的版本`
        : `OptiFine 没有适用于 Minecraft ${gameVersion} 的 ${edition || '指定'} 构建`
    )
  }
  const vanillaJson = join(gameDir, 'versions', gameVersion, `${gameVersion}.json`)
  const vanillaJar = join(gameDir, 'versions', gameVersion, `${gameVersion}.jar`)
  if (!(await pathExists(vanillaJson)) || !(await pathExists(vanillaJar))) {
    throw new Error('原版游戏文件不完整，请先安装该 Minecraft 版本')
  }
  if (signal.aborted) throw new CancellationError()

  await cleanStaleDirs(gameDir)
  const tempDir = join(
    gameDir,
    `${TEMP_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  )
  const appData = join(tempDir, 'appdata')
  const linkPath =
    process.platform === 'darwin'
      ? join(appData, 'Library', 'Application Support', 'minecraft')
      : join(appData, '.minecraft')
  const jarPath = join(tempDir, 'OptiFine-installer.jar')
  let linked = false

  try {
    await fs.mkdir(appData, { recursive: true })
    try {
      await fs.symlink(resolve(gameDir), linkPath, process.platform === 'win32' ? 'junction' : 'dir')
    } catch (error) {
      throw new Error(
        `无法创建 OptiFine 安装目录：${error instanceof Error ? error.message : '未知错误'}`
      )
    }
    linked = true

    report('下载 OptiFine 安装器', 6)
    const url = `${OPTIFINE_MIRROR}/${encodeURIComponent(gameVersion)}/${encodeURIComponent(
      build.type
    )}/${encodeURIComponent(build.patch)}`
    await downloadFile([url], jarPath, {
      signal,
      onBytes: (current) => {
        report('下载 OptiFine 安装器', 8, {
          current,
          total: 0,
          bytesDone: current,
          bytesTotal: 0,
          speed: 0
        })
      }
    })
    if (signal.aborted) throw new CancellationError()

    report('校验 OptiFine 安装器', 18)
    try {
      const zip = new AdmZip(jarPath)
      const names = new Set(zip.getEntries().map((entry) => entry.entryName))
      if (!names.has('optifine/Installer.class') || !names.has('META-INF/MANIFEST.MF')) {
        throw new Error('文件内容不是 OptiFine 安装器')
      }
    } catch (error) {
      throw new Error(
        `OptiFine 安装器下载不完整${error instanceof Error ? `：${error.message}` : ''}`
      )
    }

    // OptiFine 安装器会尝试写入启动器档案；没有档案时会弹窗报错并退出。
    const profilesPath = join(gameDir, 'launcher_profiles.json')
    const storeProfilesPath = join(gameDir, 'launcher_profiles_microsoft_store.json')
    if (!(await pathExists(profilesPath)) && !(await pathExists(storeProfilesPath))) {
      await writeFileAtomic(
        profilesPath,
        JSON.stringify({ profiles: {}, settings: {}, version: 3 }, null, 2)
      )
    }

    report('应用 OptiFine 补丁', 22)
    await runInstaller(javaPath, jarPath, appData, tempDir, signal, (stage, count) => {
      report(stage, Math.min(92, 22 + count * 0.6))
    })
    if (signal.aborted) throw new CancellationError()

    report('核对 OptiFine 版本', 96)
    const versionId = await findInstalledVersion(gameDir, gameVersion, edition)
    if (!versionId) {
      throw new Error('OptiFine 安装器没有生成版本配置，请重试或更换 Java')
    }
    const patchedJar = join(
      gameDir,
      'libraries',
      'optifine',
      'OptiFine',
      `${gameVersion}_${edition}`,
      `OptiFine-${gameVersion}_${edition}.jar`
    )
    if (!(await pathExists(patchedJar))) {
      throw new Error('OptiFine 补丁文件缺失，请重试')
    }

    report('OptiFine 安装完成', 100)
    return { versionId, loader: 'optifine', loaderVersion: edition }
  } finally {
    if (linked) {
      const removed = await removeJunction(linkPath)
      if (!removed) {
        // 宁可不清理，也不能跟随 junction 删除游戏目录。
        await fs.rm(jarPath, { force: true }).catch(() => undefined)
      } else {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
      }
    } else {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}
