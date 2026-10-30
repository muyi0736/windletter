import AdmZip from 'adm-zip'
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { InstanceLoader, LoaderVersionView } from '../../shared/types'
import type { Library, VersionJson } from './mojangTypes'
import { runDownloadPool, type DownloadJob } from './downloadPool'
import { CancellationError, downloadFile, fetchJson, fetchText } from './net'
import { installOptiFineProfile, listOptiFineVersions } from './optifine'
import { emptyDetail, type TaskProgress } from './progress'
import { mainArtifact, pathExists, safeJoin, writeFileAtomic } from './version'

const FABRIC_META = 'https://meta.fabricmc.net/v2'
const QUILT_META = 'https://meta.quiltmc.org/v3'
const FORGE_MAVEN = 'https://maven.minecraftforge.net/net/minecraftforge/forge'
const FORGE_PROMOS =
  'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json'
const NEOFORGE_CDN = 'https://neoforged.forgecdn.net'
const NEOFORGE_MAVEN = `${NEOFORGE_CDN}/releases`
const NEOFORGE_OFFICIAL = 'https://maven.neoforged.net/releases'
const SAFE_VERSION = /^[A-Za-z0-9._+\-]{1,128}$/
const SAFE_ID = /^[A-Za-z0-9._\-+]{1,100}$/

type NetworkLoader = 'fabric' | 'quilt'
type SupportedLoader = Exclude<InstanceLoader, 'vanilla'>

let forgeQueue: Promise<unknown> = Promise.resolve()

function withForgeLock<T>(task: () => Promise<T>): Promise<T> {
  const run = forgeQueue.then(task, task)
  forgeQueue = run.catch(() => undefined)
  return run
}

interface LoaderListEntry {
  loader?: {
    version?: string
    stable?: boolean
  }
}

export interface LoaderInstallOptions {
  gameDir: string
  gameVersion: string
  loader: SupportedLoader
  loaderVersion?: string | null
  /** Forge's installer is a Java program; Fabric/Quilt do not use it. */
  javaPath?: string
  concurrency: number
  signal: AbortSignal
  onProgress: TaskProgress
}

export interface LoaderInstallResult {
  versionId: string
  loader: SupportedLoader
  loaderVersion: string
}

function metaBase(loader: NetworkLoader): string {
  return loader === 'fabric' ? FABRIC_META : QUILT_META
}

function expectedProfileId(
  loader: NetworkLoader,
  loaderVersion: string,
  gameVersion: string
): string {
  return `${loader}-loader-${loaderVersion}-${gameVersion}`
}

async function resolveLoaderVersion(
  loader: NetworkLoader,
  gameVersion: string,
  requested: string | null | undefined,
  signal: AbortSignal
): Promise<string> {
  if (requested && SAFE_VERSION.test(requested)) return requested
  const url = `${metaBase(loader)}/versions/loader/${encodeURIComponent(gameVersion)}`
  const list = await fetchJson<LoaderListEntry[]>([url], { signal })
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(`${loader === 'fabric' ? 'Fabric' : 'Quilt'} 没有适用于 ${gameVersion} 的加载器`)
  }
  const stable = list.find((entry) => entry.loader?.stable && entry.loader.version)
  const chosen = stable ?? list.find((entry) => entry.loader?.version)
  const version = chosen?.loader?.version
  if (!version || !SAFE_VERSION.test(version)) {
    throw new Error('无法确定加载器版本，请稍后重试')
  }
  return version
}

async function readExistingProfile(
  gameDir: string,
  versionId: string
): Promise<VersionJson | null> {
  try {
    const text = await fs.readFile(join(gameDir, 'versions', versionId, `${versionId}.json`), 'utf8')
    const json = JSON.parse(text) as VersionJson
    return json?.id === versionId && Array.isArray(json.libraries) ? json : null
  } catch {
    return null
  }
}

function compareNumericVersions(a: string, b: string): number {
  const left = a.split(/[._+\-]/).map((part) => Number(part) || 0)
  const right = b.split(/[._+\-]/).map((part) => Number(part) || 0)
  const length = Math.max(left.length, right.length)
  for (let i = 0; i < length; i += 1) {
    const delta = (left[i] ?? 0) - (right[i] ?? 0)
    if (delta !== 0) return delta
  }
  return 0
}

async function resolveForgeVersion(
  gameVersion: string,
  requested: string | null | undefined,
  signal: AbortSignal
): Promise<string> {
  if (requested && SAFE_VERSION.test(requested)) return requested

  let promos: { promos?: Record<string, string> } | null = null
  try {
    promos = await fetchJson<{ promos?: Record<string, string> }>([FORGE_PROMOS], {
      signal,
      timeoutMs: 15_000
    })
  } catch {
    promos = null
  }
  const promoted =
    promos?.promos?.[`${gameVersion}-recommended`] ?? promos?.promos?.[`${gameVersion}-latest`]
  if (promoted && SAFE_VERSION.test(promoted)) return promoted

  const xml = await fetchText([`${FORGE_MAVEN}/maven-metadata.xml`], {
    signal,
    timeoutMs: 20_000
  })
  const prefix = `${gameVersion}-`
  const versions: string[] = []
  for (const match of xml.matchAll(/<version>([^<]+)<\/version>/g)) {
    const full = (match[1] ?? '').trim()
    if (!full.startsWith(prefix)) continue
    const version = full.slice(prefix.length)
    if (SAFE_VERSION.test(version)) versions.push(version)
  }
  if (versions.length === 0) {
    throw new Error(`Forge 没有适用于 Minecraft ${gameVersion} 的版本`)
  }
  versions.sort(compareNumericVersions)
  return versions[versions.length - 1]
}

async function readVersionProfile(
  gameDir: string,
  versionId: string
): Promise<VersionJson | null> {
  try {
    const text = await fs.readFile(
      join(gameDir, 'versions', versionId, `${versionId}.json`),
      'utf8'
    )
    const json = JSON.parse(text) as VersionJson
    return json?.id === versionId && Array.isArray(json.libraries) ? json : null
  } catch {
    return null
  }
}

function isLegacyNeoForge(gameVersion: string): boolean {
  return gameVersion === '1.20.1'
}

function neoForgePrefix(gameVersion: string): string {
  const parts = gameVersion.split('.')
  if (parts[0] === '1') return `${parts[1]}.${parts[2] ?? '0'}`
  return `${parts[0]}.${parts[1] ?? '0'}`
}

async function resolveNeoForgeVersion(
  gameVersion: string,
  requested: string | null | undefined,
  signal: AbortSignal
): Promise<string> {
  const legacy = isLegacyNeoForge(gameVersion)
  const prefix = legacy ? `${gameVersion}-` : `${neoForgePrefix(gameVersion)}.`
  // 下载页展示的是 NeoForge 版本后缀（例如 265），但现代 NeoForge
  // 的安装器和 profile 需要完整版本（21.1.265）；legacy 则相反，需要去掉
  // gameVersion 前缀。两种输入都统一在这里归一化。
  const normalize = (value: string): string => {
    if (legacy) return value.startsWith(prefix) ? value.slice(prefix.length) : value
    return value.startsWith(prefix) ? value : `${prefix}${value}`
  }
  if (requested && SAFE_VERSION.test(requested)) return normalize(requested)

  const metadataUrl = legacy
    ? `${NEOFORGE_MAVEN}/net/neoforged/forge/maven-metadata.xml`
    : `${NEOFORGE_MAVEN}/net/neoforged/neoforge/maven-metadata.xml`
  const xml = await fetchText([metadataUrl], { signal, timeoutMs: 25_000 })
  const versions: string[] = []
  for (const match of xml.matchAll(/<version>([^<]+)<\/version>/g)) {
    const full = (match[1] ?? '').trim()
    if (!full.startsWith(prefix)) continue
    const version = full.slice(prefix.length)
    if (!SAFE_VERSION.test(version) || /beta/i.test(version)) continue
    versions.push(version)
  }
  if (versions.length === 0) {
    throw new Error(`NeoForge 没有适用于 Minecraft ${gameVersion} 的版本`)
  }
  versions.sort(compareNumericVersions)
  const latest = versions[versions.length - 1]
  return legacy ? latest : `${prefix}${latest}`
}

function neoForgeInstallerUrl(gameVersion: string, version: string): string {
  if (isLegacyNeoForge(gameVersion)) {
    const full = `${gameVersion}-${version}`
    return `${NEOFORGE_MAVEN}/net/neoforged/forge/${full}/forge-${full}-installer.jar`
  }
  return `${NEOFORGE_MAVEN}/net/neoforged/neoforge/${version}/neoforge-${version}-installer.jar`
}

function patchNeoForgeInstaller(input: string, output: string): void {
  const zip = new AdmZip(input)
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue
    const data = entry.getData()
    if (!data.includes(Buffer.from('maven.neoforged.net'))) continue
    const text = data
      .toString('latin1')
      .split('https://maven.neoforged.net')
      .join(NEOFORGE_CDN)
      .split('http://maven.neoforged.net')
      .join(NEOFORGE_CDN)
    zip.updateFile(entry, Buffer.from(text, 'latin1'))
  }
  zip.writeZip(output)
}

async function findForgeProfile(
  gameDir: string,
  gameVersion: string,
  forgeVersion: string,
  expectedId: string
): Promise<{ versionId: string; json: VersionJson }> {
  const expected = await readVersionProfile(gameDir, expectedId)
  if (expected) return { versionId: expectedId, json: expected }

  const versionsDir = join(gameDir, 'versions')
  let entries: string[] = []
  try {
    entries = (await fs.readdir(versionsDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    entries = []
  }
  for (const id of entries) {
    if (!id.toLowerCase().includes('forge') || !id.includes(forgeVersion)) continue
    const json = await readVersionProfile(gameDir, id)
    if (json?.inheritsFrom === gameVersion) return { versionId: id, json }
  }
  throw new Error('Forge 安装器没有生成可用的版本配置')
}

function runForgeInstaller(
  javaPath: string,
  installerPath: string,
  gameDir: string,
  signal: AbortSignal,
  onLine: (line: string, lineCount: number) => void
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new CancellationError())
      return
    }
    const child = spawn(
      javaPath,
      ['-Djava.awt.headless=true', '-jar', installerPath, '--installClient', gameDir],
      { cwd: gameDir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
    )
    let output = ''
    let lineCount = 0
    let lastEmit = 0
    const handle = (chunk: Buffer) => {
      output = `${output}${chunk.toString('utf8')}`.slice(-16_000)
      lineCount += 1
      const now = Date.now()
      const lines = chunk
        .toString('utf8')
        .split(/\r?\n/)
        .map((line) => line.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
      const last = lines[lines.length - 1]
      if (!last) return
      const important = /successfully|error|failed|exception/i.test(last)
      if (!important && now - lastEmit < 500) return
      lastEmit = now
      onLine(last.slice(0, 100), lineCount)
    }
    child.stdout?.on('data', handle)
    child.stderr?.on('data', handle)
    const abort = () => {
      child.kill()
    }
    signal.addEventListener('abort', abort, { once: true })
    child.on('error', (error) => {
      signal.removeEventListener('abort', abort)
      reject(new Error(`无法启动加载器安装器：${error.message}`))
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
        .slice(-12)
        .join('\n')
      reject(
        new Error(
          `加载器安装器失败（退出码 ${code ?? '未知'}）${tail ? `：\n${tail}` : ''}`
        )
      )
    })
  })
}

async function installForgeProfile(
  options: LoaderInstallOptions,
  kind: 'forge' | 'neoforge' = 'forge'
): Promise<LoaderInstallResult> {
  const { gameDir, gameVersion, signal, onProgress, javaPath } = options
  if (!SAFE_VERSION.test(gameVersion)) throw new Error('无效的 Minecraft 版本')
  if (!javaPath) {
    throw new Error(`安装 ${kind === 'neoforge' ? 'NeoForge' : 'Forge'} 需要可用的 Java 运行环境`)
  }
  const label = kind === 'neoforge' ? 'NeoForge' : 'Forge'

  const report = (stage: string, percent: number, detail = emptyDetail()) => {
    onProgress({ stage, percent: Math.max(0, Math.min(100, percent)), detail })
  }

  report(`确定 ${label} 版本`, 3)
  const loaderVersion =
    kind === 'forge'
      ? await resolveForgeVersion(gameVersion, options.loaderVersion, signal)
      : await resolveNeoForgeVersion(gameVersion, options.loaderVersion, signal)
  if (signal.aborted) throw new CancellationError()

  try {
    const entries = await fs.readdir(gameDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith('.windletter-forge-')) continue
      const staleDir = join(gameDir, entry.name)
      try {
        const meta = JSON.parse(
          await fs.readFile(join(staleDir, 'meta.json'), 'utf8')
        ) as { gameVersion?: string }
        if (meta.gameVersion && SAFE_VERSION.test(meta.gameVersion)) {
          const jarBackup = join(staleDir, 'vanilla.jar.bak')
          const jsonBackup = join(staleDir, 'vanilla.json.bak')
          const versionDir = join(gameDir, 'versions', meta.gameVersion)
          if (await pathExists(jarBackup)) {
            await fs
              .copyFile(jarBackup, join(versionDir, `${meta.gameVersion}.jar`))
              .catch(() => undefined)
          }
          if (await pathExists(jsonBackup)) {
            await fs
              .copyFile(jsonBackup, join(versionDir, `${meta.gameVersion}.json`))
              .catch(() => undefined)
          }
        }
      } catch {
        /* stale dir without metadata */
      }
      await fs.rm(staleDir, { recursive: true, force: true }).catch(() => undefined)
    }
  } catch {
    /* game dir may not exist yet */
  }

  const legacyNeoForge = kind === 'neoforge' && isLegacyNeoForge(gameVersion)
  const fullVersion =
    kind === 'forge' || legacyNeoForge ? `${gameVersion}-${loaderVersion}` : loaderVersion
  const expectedId =
    kind === 'forge' || legacyNeoForge
      ? `${gameVersion}-forge-${loaderVersion}`
      : `neoforge-${loaderVersion}`
  const versionsDir = join(gameDir, 'versions')
  const vanillaJar = join(versionsDir, gameVersion, `${gameVersion}.jar`)
  const vanillaJson = join(versionsDir, gameVersion, `${gameVersion}.json`)
  const tempDir = join(
    gameDir,
    `.windletter-forge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  )
  const backupJar = join(tempDir, 'vanilla.jar.bak')
  const backupJson = join(tempDir, 'vanilla.json.bak')
  let backedUpJar = false
  let backedUpJson = false

  try {
    await fs.rm(tempDir, { recursive: true, force: true })
    await fs.mkdir(tempDir, { recursive: true })
    await writeFileAtomic(join(tempDir, 'meta.json'), JSON.stringify({ gameVersion }))

    const profilesPath = join(gameDir, 'launcher_profiles.json')
    if (!(await pathExists(profilesPath))) {
      await writeFileAtomic(
        profilesPath,
        JSON.stringify({ profiles: {}, settings: {}, version: 3 }, null, 2)
      )
    }

    if (await pathExists(vanillaJar)) {
      await fs.copyFile(vanillaJar, backupJar)
      backedUpJar = true
    }
    if (await pathExists(vanillaJson)) {
      await fs.copyFile(vanillaJson, backupJson)
      backedUpJson = true
    }

    report(`下载 ${label} 安装器`, 6)
    const installerPath = join(
      tempDir,
      kind === 'forge' ? 'forge-installer.jar' : 'neoforge-installer.jar'
    )
    const installerUrl =
      kind === 'forge'
        ? `${FORGE_MAVEN}/${fullVersion}/forge-${fullVersion}-installer.jar`
        : neoForgeInstallerUrl(gameVersion, loaderVersion)
    let installerSha1: string | null = null
    try {
      const raw = await fetchText([`${installerUrl}.sha1`], { signal, timeoutMs: 15_000 })
      const match = raw.match(/[0-9a-f]{40}/i)
      if (match) installerSha1 = match[0]
    } catch {
      installerSha1 = null
    }
    await downloadFile([installerUrl], installerPath, {
      sha1: installerSha1,
      signal,
      onBytes: (current) => {
        report(`下载 ${label} 安装器`, 8, {
          current,
          total: 0,
          bytesDone: current,
          bytesTotal: 0,
          speed: 0
        })
      }
    })

    if (signal.aborted) throw new CancellationError()
    let executableInstaller = installerPath
    if (kind === 'neoforge') {
      report('修补 NeoForge 安装器镜像', 13)
      const patched = join(tempDir, 'neoforge-installer-patched.jar')
      patchNeoForgeInstaller(installerPath, patched)
      executableInstaller = patched
    }
    report(`运行 ${label} 安装器`, 14)
    await runForgeInstaller(javaPath, executableInstaller, gameDir, signal, (line, count) => {
      report(`运行安装器 · ${line}`, 15 + Math.min(68, count * 0.35))
    })

    if (signal.aborted) throw new CancellationError()
    report(`整理 ${label} 配置`, 86)
    const found = await findForgeProfile(gameDir, gameVersion, loaderVersion, expectedId)
    let finalId = found.versionId

    if (legacyNeoForge) {
      finalId = `${gameVersion}-neoforge-${loaderVersion}`
      if (finalId !== found.versionId) {
        const targetDir = join(versionsDir, finalId)
        await fs.rm(targetDir, { recursive: true, force: true }).catch(() => undefined)
        await fs.rename(join(versionsDir, found.versionId), targetDir)
      }
      found.json.id = finalId
    }

    const loaderDir = join(versionsDir, finalId)
    await fs.mkdir(loaderDir, { recursive: true })

    if (kind === 'forge') {
      const existingJars = (await fs.readdir(loaderDir).catch(() => []))
        .filter((name) => name.toLowerCase().endsWith('.jar'))
      const installerJar = existingJars.find((name) => name !== `${finalId}.jar`)
      let jarId = finalId
      if (installerJar) {
        jarId = installerJar.replace(/\.jar$/i, '')
      } else {
        const forgeJar = join(loaderDir, `${finalId}.jar`)
        if (await pathExists(vanillaJar)) {
          await fs.copyFile(vanillaJar, forgeJar)
        } else if (backedUpJar) {
          await fs.copyFile(backupJar, forgeJar)
        } else {
          throw new Error('Forge 安装器没有生成客户端 jar')
        }
      }
      found.json.jar = jarId
    }

    if (backedUpJar) {
      await fs.copyFile(backupJar, vanillaJar)
    } else {
      await fs.rm(vanillaJar, { force: true }).catch(() => undefined)
    }
    if (backedUpJson) {
      await fs.copyFile(backupJson, vanillaJson)
    }

    await writeFileAtomic(
      join(loaderDir, `${finalId}.json`),
      JSON.stringify(found.json, null, 2)
    )

    const librariesDir = join(gameDir, 'libraries')
    const missing: DownloadJob[] = []
    for (const library of found.json.libraries ?? []) {
      const artifact = mainArtifact(library as Library)
      if (!artifact) continue
      if (await pathExists(safeJoin(librariesDir, artifact.path))) continue
      missing.push({
        urls: [artifact.url],
        destination: safeJoin(librariesDir, artifact.path),
        sha1: artifact.sha1,
        size: artifact.size,
        label: library.name
      })
    }
    if (missing.length > 0) {
      report('补全加载器运行库', 93)
      await runDownloadPool(missing, {
        concurrency: options.concurrency,
        signal,
        onProgress: (detail) => {
          report(
            '补全加载器运行库',
            93 + (detail.total ? (detail.current / detail.total) * 5 : 5),
            detail
          )
        }
      })
    }

    report(`${label} 安装完成`, 100)
    return { versionId: finalId, loader: kind, loaderVersion }
  } finally {
    if (backedUpJar) {
      await fs.copyFile(backupJar, vanillaJar).catch(() => undefined)
    }
    if (backedUpJson) {
      await fs.copyFile(backupJson, vanillaJson).catch(() => undefined)
    }
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function installLoaderProfile(options: LoaderInstallOptions): Promise<LoaderInstallResult> {
  if (options.loader === 'optifine') {
    return withForgeLock(() => installOptiFineProfile(options))
  }
  if (options.loader === 'forge' || options.loader === 'neoforge') {
    const kind = options.loader
    return withForgeLock(() => installForgeProfile(options, kind))
  }
  const { gameDir, gameVersion, signal, onProgress } = options
  const loader = options.loader as NetworkLoader
  if (!SAFE_VERSION.test(gameVersion)) throw new Error('无效的 Minecraft 版本')
  const report = (stage: string, percent: number, detail = emptyDetail()) => {
    onProgress({ stage, percent: Math.max(0, Math.min(100, percent)), detail })
  }

  report('确定加载器版本', 3)
  const loaderVersion = await resolveLoaderVersion(loader, gameVersion, options.loaderVersion, signal)
  if (signal.aborted) throw new CancellationError()

  const fallbackId = expectedProfileId(loader, loaderVersion, gameVersion)
  let profile = await readExistingProfile(gameDir, fallbackId)
  let versionId = fallbackId

  if (!profile) {
    report('获取加载器配置', 10)
    const url = `${metaBase(loader)}/versions/loader/${encodeURIComponent(gameVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`
    const fetched = await fetchJson<VersionJson>([url], { signal })
    if (!fetched || !fetched.id || !SAFE_ID.test(fetched.id)) {
      throw new Error('加载器配置异常，无法安装')
    }
    if (!Array.isArray(fetched.libraries)) {
      throw new Error('加载器配置缺少运行库列表')
    }
    versionId = fetched.id
    profile = fetched
  }

  if (profile.inheritsFrom && profile.inheritsFrom !== gameVersion) {
    throw new Error(`加载器配置与原版版本不匹配（${profile.inheritsFrom} ≠ ${gameVersion}）`)
  }

  const versionDir = safeJoin(join(gameDir, 'versions'), versionId)
  await fs.mkdir(versionDir, { recursive: true })
  if (!(await readExistingProfile(gameDir, versionId))) {
    await writeFileAtomic(join(versionDir, `${versionId}.json`), JSON.stringify(profile, null, 2))
  }

  if (signal.aborted) throw new CancellationError()
  report('准备加载器运行库', 18)
  const librariesDir = join(gameDir, 'libraries')
  const jobs: DownloadJob[] = []
  for (const library of profile.libraries ?? []) {
    const artifact = mainArtifact(library as Library)
    if (!artifact) continue
    jobs.push({
      urls: [artifact.url],
      destination: safeJoin(librariesDir, artifact.path),
      sha1: artifact.sha1,
      size: artifact.size,
      label: library.name
    })
  }

  await runDownloadPool(jobs, {
    concurrency: options.concurrency,
    signal,
    onProgress: (detail) => {
      report('下载加载器运行库', 20 + (detail.total ? (detail.current / detail.total) * 75 : 75), detail)
    }
  })

  if (signal.aborted) throw new CancellationError()
  report('加载器安装完成', 100)
  return { versionId, loader, loaderVersion }
}

export async function listLoaderVersions(
  gameVersion: string,
  loader: 'fabric' | 'quilt' | 'forge' | 'neoforge' | 'optifine',
  signal?: AbortSignal
): Promise<LoaderVersionView[]> {
  if (!SAFE_VERSION.test(gameVersion)) throw new Error('无效的 Minecraft 版本')

  if (loader === 'optifine') {
    return listOptiFineVersions(gameVersion, signal)
  }

  if (loader === 'fabric' || loader === 'quilt') {
    const list = await fetchJson<LoaderListEntry[]>(
      [`${metaBase(loader)}/versions/loader/${encodeURIComponent(gameVersion)}`],
      { signal, timeoutMs: 20_000 }
    )
    const entries = (Array.isArray(list) ? list : [])
      .map((entry) => ({
        version: entry.loader?.version ?? '',
        stable: Boolean(entry.loader?.stable)
      }))
      .filter((entry) => SAFE_VERSION.test(entry.version))
    entries.sort((a, b) => Number(b.stable) - Number(a.stable))
    return entries.map((entry, index) => ({ version: entry.version, latest: index === 0 }))
  }

  if (loader === 'forge') {
    const xml = await fetchText([`${FORGE_MAVEN}/maven-metadata.xml`], {
      signal,
      timeoutMs: 25_000
    })
    const prefix = `${gameVersion}-`
    const versions: string[] = []
    for (const match of xml.matchAll(/<version>([^<]+)<\/version>/g)) {
      const full = (match[1] ?? '').trim()
      if (!full.startsWith(prefix)) continue
      const version = full.slice(prefix.length)
      if (SAFE_VERSION.test(version) && !/beta/i.test(version)) versions.push(version)
    }
    versions.sort(compareNumericVersions)
    versions.reverse()
    return versions.map((version, index) => ({ version, latest: index === 0 }))
  }

  const legacy = isLegacyNeoForge(gameVersion)
  const metadataUrl = legacy
    ? `${NEOFORGE_MAVEN}/net/neoforged/forge/maven-metadata.xml`
    : `${NEOFORGE_MAVEN}/net/neoforged/neoforge/maven-metadata.xml`
  const xml = await fetchText([metadataUrl], { signal, timeoutMs: 25_000 })
  const prefix = legacy ? `${gameVersion}-` : `${neoForgePrefix(gameVersion)}.`
  const versions: string[] = []
  for (const match of xml.matchAll(/<version>([^<]+)<\/version>/g)) {
    const full = (match[1] ?? '').trim()
    if (!full.startsWith(prefix)) continue
    const version = full.slice(prefix.length)
    if (SAFE_VERSION.test(version) && !/beta/i.test(version)) versions.push(version)
  }
  versions.sort(compareNumericVersions)
  versions.reverse()
  return versions.map((version, index) => ({ version, latest: index === 0 }))
}
