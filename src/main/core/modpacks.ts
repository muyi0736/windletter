import AdmZip from 'adm-zip'
import { promises as fs } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type {
  DownloadSource,
  InstanceLoader,
  InstanceSummary,
  LauncherSettings
} from '../../shared/types'
import { runDownloadPool, type DownloadJob } from './downloadPool'
import {
  countMods,
  getInstanceDir,
  getInstanceMinecraftDir,
  listInstances,
  makeInstanceId,
  writeInstance
} from './instances'
import { installLoaderProfile } from './loaders'
import { installVanillaVersion } from './installer'
import { ensureJavaForVersion } from './java'
import { getVersionEntry, getVersionJson } from './mojang'
import { CancellationError } from './net'
import { collectPackReuseRoots, reuseLocalPackFiles } from './packReuse'
import { emptyDetail, type TaskProgress } from './progress'
import { modrinthFileCandidates } from './source'
import { pathExists, safeJoin } from './version'

const SAFE_VERSION = /^[A-Za-z0-9._+\-]{1,64}$/
const SHA1 = /^[0-9a-f]{40}$/i
const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024
const MAX_INDEX_BYTES = 8 * 1024 * 1024
const MAX_ENTRY_BYTES = 512 * 1024 * 1024
const MAX_OVERRIDE_BYTES = 2 * 1024 * 1024 * 1024

interface MrpackFile {
  path?: string
  hashes?: { sha1?: string; sha512?: string }
  env?: { client?: string; server?: string }
  downloads?: string[]
  fileSize?: number
}

export interface ParsedPackFile {
  path: string
  urls: string[]
  sha1: string | null
  size: number | null
}

export interface ParsedPackArchive {
  zip: AdmZip
  archivePath: string
  name: string
  summary: string
  versionId: string | null
  gameVersion: string
  loader: InstanceLoader
  loaderVersion: string | null
  files: ParsedPackFile[]
}

interface MrpackIndex {
  formatVersion?: number
  game?: string
  name?: string
  summary?: string
  versionId?: string
  dependencies?: Record<string, string>
  files?: MrpackFile[]
}

export interface ImportModpackOptions {
  archivePath: string
  displayName?: string
  summary?: string
  iconUrl?: string | null
  source: 'local' | 'modrinth' | 'curseforge'
  projectId?: string | null
  gameDir: string
  settings: LauncherSettings
  downloadSource: DownloadSource
  concurrency: number
  signal: AbortSignal
  onProgress: TaskProgress
}

export interface ImportModpackResult {
  instance: InstanceSummary
}

function httpsUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:') return null
    const host = url.hostname.toLowerCase()
    if (
      host === 'localhost' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host.startsWith('127.') ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    ) {
      return null
    }
    return url.toString()
  } catch {
    return null
  }
}

function cleanRelative(input: unknown, label: string): string {
  if (typeof input !== 'string') throw new Error(`${label} 路径无效`)
  const normalized = input.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/^\/+/, '')
  if (!normalized || normalized.length > 512 || normalized.includes('\0') || normalized.includes(':')) {
    throw new Error(`${label} 路径无效：${input}`)
  }
  const parts = normalized.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`${label} 路径越界：${input}`)
  }
  return parts.join('/')
}

function safeIcon(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

function chooseLoader(dependencies: Record<string, string>): {
  loader: InstanceLoader
  loaderVersion: string | null
} {
  const fabric = dependencies['fabric-loader']
  const quilt = dependencies['quilt-loader']
  const forge = dependencies.forge
  const neoforge = dependencies.neoforge
  const declared = [fabric, quilt, forge, neoforge].filter(Boolean).length
  if (declared > 1) throw new Error('整合包同时声明了多个加载器，无法确定使用哪一个')
  if (neoforge) {
    if (!SAFE_VERSION.test(neoforge)) throw new Error('NeoForge 加载器版本无效')
    return { loader: 'neoforge', loaderVersion: neoforge }
  }
  if (fabric) {
    if (!SAFE_VERSION.test(fabric)) throw new Error('Fabric 加载器版本无效')
    return { loader: 'fabric', loaderVersion: fabric }
  }
  if (quilt) {
    if (!SAFE_VERSION.test(quilt)) throw new Error('Quilt 加载器版本无效')
    return { loader: 'quilt', loaderVersion: quilt }
  }
  if (forge) {
    if (!SAFE_VERSION.test(forge)) throw new Error('Forge 加载器版本无效')
    return { loader: 'forge', loaderVersion: forge }
  }
  return { loader: 'vanilla', loaderVersion: null }
}

async function readJavaMajor(gameDir: string, versionId: string): Promise<number | null> {
  try {
    const raw = await fs.readFile(join(gameDir, 'versions', versionId, `${versionId}.json`), 'utf8')
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

export async function parsePackArchive(options: {
  archivePath: string
  settings: LauncherSettings
  downloadSource: DownloadSource
  signal?: AbortSignal
}): Promise<ParsedPackArchive> {
  const { signal } = options
  let stat
  try {
    stat = await fs.stat(options.archivePath)
  } catch {
    throw new Error('找不到整合包文件')
  }
  if (!stat.isFile() || stat.size <= 0) throw new Error('整合包文件无效')
  if (stat.size > MAX_ARCHIVE_BYTES) throw new Error('整合包文件过大')

  let zip: AdmZip
  try {
    zip = new AdmZip(options.archivePath)
  } catch {
    throw new Error('无法解压整合包，请确认它是有效的 .mrpack 或整合包 .zip 文件')
  }

  const indexEntry = zip.getEntry('modrinth.index.json')
  if (!indexEntry || indexEntry.header.size > MAX_INDEX_BYTES) {
    throw new Error('整合包缺少 modrinth.index.json；当前支持 .mrpack 和包含该索引的 .zip')
  }
  let index: MrpackIndex
  try {
    index = JSON.parse(indexEntry.getData().toString('utf8')) as MrpackIndex
  } catch {
    throw new Error('整合包索引已损坏')
  }
  if (index.formatVersion !== 1 || index.game !== 'minecraft') {
    throw new Error('仅支持 formatVersion 1 的 Minecraft .mrpack / .zip 整合包')
  }
  const gameVersion = index.dependencies?.minecraft
  if (!gameVersion || !SAFE_VERSION.test(gameVersion)) {
    throw new Error('整合包没有声明有效的 Minecraft 版本')
  }
  const { loader, loaderVersion } = chooseLoader(index.dependencies ?? {})
  if (loader === 'quilt') {
    // Quilt Loader 0.20.0-beta.9 仍使用 ASM 9.5，最高只支持 Java 21 的 class 文件。
    const entry = await getVersionEntry(gameVersion, options.downloadSource)
    const { json } = await getVersionJson(entry, options.downloadSource, signal)
    const requiredJava = json.javaVersion?.majorVersion ?? null
    if (requiredJava && requiredJava > 21) {
      throw new Error(
        `当前 Quilt 加载器尚未支持 Java ${requiredJava}（Minecraft ${gameVersion}）。请选择 1.21.x 或更早的 Quilt 整合包。`
      )
    }
  }

  if (Array.isArray(index.files) && index.files.length > 20_000) {
    throw new Error('整合包文件数量过多，已停止安装')
  }
  const files: ParsedPackFile[] = []
  const seenPaths = new Set<string>()
  for (const file of index.files ?? []) {
    if (!file || file.env?.client === 'unsupported') continue
    const relative = cleanRelative(file.path, '模组文件')
    const urls = [
      ...new Set(
        (file.downloads ?? [])
          .map(httpsUrl)
          .filter((url): url is string => Boolean(url))
          .flatMap((url) => modrinthFileCandidates(url, options.settings.modrinthMirror))
      )
    ].slice(0, 4)
    if (!urls.length) continue
    if (seenPaths.has(relative)) {
      throw new Error(`整合包索引包含重复文件：${relative}`)
    }
    seenPaths.add(relative)
    const sha1 =
      typeof file.hashes?.sha1 === 'string' && SHA1.test(file.hashes.sha1)
        ? file.hashes.sha1.toLowerCase()
        : null
    const size =
      typeof file.fileSize === 'number' && Number.isFinite(file.fileSize) && file.fileSize >= 0
        ? Math.round(file.fileSize)
        : null
    files.push({ path: relative, urls, sha1, size })
  }

  return {
    zip,
    archivePath: options.archivePath,
    name: typeof index.name === 'string' ? index.name.trim().slice(0, 120) : '',
    summary: typeof index.summary === 'string' ? index.summary.trim().slice(0, 600) : '',
    versionId:
      typeof index.versionId === 'string' && index.versionId.trim()
        ? index.versionId.trim().slice(0, 120)
        : null,
    gameVersion,
    loader,
    loaderVersion,
    files
  }
}

async function extractOverrides(
  zip: AdmZip,
  minecraftDir: string,
  signal: AbortSignal,
  onStage: () => void
): Promise<void> {
  let total = 0
  for (const prefix of ['overrides/', 'client-overrides/']) {
    for (const entry of zip.getEntries()) {
      if (signal.aborted) throw new CancellationError()
      if (entry.isDirectory) continue
      const entryName = entry.entryName.replace(/\\/g, '/')
      if (!entryName.startsWith(prefix)) continue
      const relative = cleanRelative(entryName.slice(prefix.length), '覆盖文件')
      if (!relative) continue
      if (entry.header.size > MAX_ENTRY_BYTES) throw new Error(`覆盖文件过大：${relative}`)
      const data = entry.getData()
      if (data.length > MAX_ENTRY_BYTES) throw new Error(`覆盖文件过大：${relative}`)
      total += data.length
      if (total > MAX_OVERRIDE_BYTES) throw new Error('覆盖文件总大小超出限制')
      const target = safeJoin(minecraftDir, relative)
      await fs.mkdir(dirname(target), { recursive: true })
      await fs.writeFile(target, data)
      onStage()
    }
  }
}

export async function importModpack(options: ImportModpackOptions): Promise<ImportModpackResult> {
  const { signal, onProgress } = options
  const report = (stage: string, percent: number, detail = emptyDetail()) => {
    onProgress({ stage, percent: Math.max(0, Math.min(100, percent)), detail })
  }

  report('读取整合包', 1)
  if (signal.aborted) throw new CancellationError()

  const parsed = await parsePackArchive({
    archivePath: options.archivePath,
    settings: options.settings,
    downloadSource: options.downloadSource,
    signal
  })
  const { zip, gameVersion, loader, loaderVersion, files } = parsed

  const name =
    (parsed.name || options.displayName || '').trim().slice(0, 120) ||
    basename(options.archivePath).replace(/\.(?:mrpack|zip)$/i, '').slice(0, 120) ||
    '导入的整合包'
  const summary = (options.summary ?? parsed.summary ?? '').trim().slice(0, 600)
  const iconUrl = safeIcon(options.iconUrl)
  const projectId =
    typeof options.projectId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(options.projectId)
      ? options.projectId
      : null

  const id = await nextInstanceId(name)
  const instanceDir = getInstanceDir(id)
  const minecraftDir = getInstanceMinecraftDir(id)
  await fs.mkdir(minecraftDir, { recursive: true })

  try {
    if (signal.aborted) throw new CancellationError()
    await installVanillaVersion({
      gameDir: options.gameDir,
      versionId: gameVersion,
      source: options.downloadSource,
      concurrency: options.concurrency,
      signal,
      onProgress: (info) => {
        report(`安装原版 · ${info.stage}`, 3 + info.percent * 0.47, info.detail)
      }
    })

    const javaMajor = await readJavaMajor(options.gameDir, gameVersion)
    let versionId = gameVersion
    if (loader !== 'vanilla') {
      if (signal.aborted) throw new CancellationError()
      let javaPath: string | undefined
      if (loader === 'forge' || loader === 'neoforge') {
        report(`准备 ${loader === 'neoforge' ? 'NeoForge' : 'Forge'} Java`, 51)
        try {
          const java = await ensureJavaForVersion({
            gameDir: options.gameDir,
            settings: options.settings,
            requiredMajor: javaMajor,
            exact: true,
            source: options.downloadSource,
            signal,
            onProgress: (info) => {
              report(`准备 Java · ${info.stage}`, 51 + info.percent * 0.04, info.detail)
            }
          })
          javaPath = java.path
        } catch (error) {
          if (javaMajor !== null && javaMajor <= 8) {
            throw new Error(
              `这个加载器需要 Java ${javaMajor}，但本机没有可用的 Java ${javaMajor}，官方也不再提供自动下载。请先安装 Java ${javaMajor}，在设置中指定后重试。`
            )
          }
          throw error
        }
      }
      const loaderName =
        loader === 'fabric'
          ? 'Fabric'
          : loader === 'quilt'
            ? 'Quilt'
            : loader === 'neoforge'
              ? 'NeoForge'
              : 'Forge'
      const loaderResult = await installLoaderProfile({
        gameDir: options.gameDir,
        gameVersion,
        loader,
        loaderVersion,
        javaPath,
        concurrency: options.concurrency,
        signal,
        onProgress: (info) => {
          const installerLoader = loader === 'forge' || loader === 'neoforge'
          const base = installerLoader ? 55 : 51
          const span = installerLoader ? 7 : 12
          report(`安装 ${loaderName} · ${info.stage}`, base + info.percent * (span / 100), info.detail)
        }
      })
      versionId = loaderResult.versionId
    }

    if (signal.aborted) throw new CancellationError()
    report('下载整合包文件', 64)
    const jobs: DownloadJob[] = files.map((file) => ({
      urls: file.urls,
      destination: safeJoin(minecraftDir, file.path),
      sha1: file.sha1,
      size: file.size,
      label: basename(file.path)
    }))
    let reusedFiles = 0
    const reuseJobs = jobs.flatMap((job) =>
      job.sha1 && job.size != null
        ? [{ destination: job.destination, sha1: job.sha1, size: job.size }]
        : []
    )
    if (reuseJobs.length) {
      report('查找本地模组', 64)
      try {
        let instances: InstanceSummary[] = []
        try {
          instances = await listInstances()
        } catch {
          instances = []
        }
        const roots = await collectPackReuseRoots({
          target: minecraftDir,
          baseGameDir: options.gameDir,
          sources: instances.map((instance) => ({
            gameDir: instance.external?.gameDir ?? getInstanceMinecraftDir(instance.id),
            baseDir: instance.external?.baseDir ?? null
          }))
        })
        if (roots.length) {
          const reuse = await reuseLocalPackFiles({
            jobs: reuseJobs,
            roots,
            signal,
            onProgress: (info) => {
              if (!info.checked && !info.reused && !info.label) return
              report(
                info.reused > 0 ? `本地复用 · ${info.reused}/${info.total}` : '查找本地模组',
                64,
                {
                  current: info.checked,
                  total: info.total,
                  bytesDone: info.bytes,
                  bytesTotal: info.bytesTotal,
                  speed: 0
                }
              )
            }
          })
          reusedFiles = reuse.reused
        }
      } catch (error) {
        if (signal.aborted || error instanceof CancellationError) {
          throw new CancellationError()
        }
        // 本地扫描失败不影响正常下载。
      }
    }
    if (signal.aborted) throw new CancellationError()
    const downloadStage =
      reusedFiles > 0 ? `下载整合包文件 · 本地复用 ${reusedFiles}` : '下载整合包文件'
    await runDownloadPool(jobs, {
      concurrency: options.concurrency,
      hostConcurrency: Math.min(64, Math.max(32, options.concurrency)),
      signal,
      onProgress: (detail) => {
        const ratio = detail.total ? detail.current / detail.total : 1
        report(downloadStage, 64 + ratio * 26, detail)
      }
    })

    if (signal.aborted) throw new CancellationError()
    report('解压覆盖文件', 92)
    let extracted = 0
    await extractOverrides(zip, minecraftDir, signal, () => {
      extracted += 1
      if (extracted % 25 === 0) report('解压覆盖文件', 92)
    })

    if (signal.aborted) throw new CancellationError()
    report('写入实例信息', 97)
    const modCount = await countMods(minecraftDir)
    const installedAt = Date.now()
    const instance: InstanceSummary = {
      id,
      name,
      summary,
      iconUrl,
      gameVersion,
      loader,
      loaderVersion,
      versionId,
      baseDir: options.gameDir,
      javaMajor,
      modCount,
      source: options.source,
      projectId,
      lastPlayed: null,
      installedAt
    }
    await writeInstance(instance)
    report('整合包安装完成', 100)
    return { instance }
  } catch (err) {
    await fs.rm(instanceDir, { recursive: true, force: true }).catch(() => undefined)
    throw err
  }
}
