import AdmZip from 'adm-zip'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import type { DownloadSource } from '../../shared/types'
import type { AssetIndexRaw, Library, VersionJson } from './mojangTypes'
import { getVersionEntry, getVersionJson } from './mojang'
import { runDownloadPool, type DownloadJob } from './downloadPool'
import { CancellationError, downloadFile } from './net'
import { emptyDetail, ratioPercent, type TaskProgress } from './progress'
import { isRuleAllowed } from './rules'
import { assetObjectUrl, orderedUrls } from './source'
import {
  mainArtifact,
  nativeArtifact,
  pathExists,
  safeJoin,
  writeFileAtomic
} from './version'

const ASSET_HASH = /^[0-9a-f]{40}$/i
const SAFE_NAME = /^[A-Za-z0-9._\-+]+$/

function isSafeName(name: string): boolean {
  return !!name && SAFE_NAME.test(name)
}

async function fileSha1(path: string): Promise<string | null> {
  try {
    const data = await fs.readFile(path)
    return createHash('sha1').update(data).digest('hex')
  } catch {
    return null
  }
}

export interface InstallOptions {
  gameDir: string
  versionId: string
  source: DownloadSource
  concurrency: number
  signal: AbortSignal
  onProgress: TaskProgress
}

export async function installVanillaVersion(options: InstallOptions): Promise<void> {
  const { gameDir, versionId, source, signal, onProgress } = options
  const report = (
    stage: string,
    percent: number,
    detail = emptyDetail(),
    message?: string
  ) => {
    onProgress({ stage, percent: Math.max(0, Math.min(100, percent)), detail, message })
  }

  report('获取版本信息', 1)
  if (signal.aborted) throw new CancellationError()

  const entry = await getVersionEntry(versionId, source)
  const { json, raw } = await getVersionJson(entry, source, signal)
  if (!json.downloads?.client) throw new Error(`${versionId} 不包含可安装的客户端文件`)

  const versionsRoot = join(gameDir, 'versions')
  const versionDir = safeJoin(versionsRoot, versionId)
  const librariesDir = join(gameDir, 'libraries')
  const assetsDir = join(gameDir, 'assets')
  const indexesDir = join(assetsDir, 'indexes')
  const objectsDir = join(assetsDir, 'objects')
  const logConfigDir = join(assetsDir, 'log_configs')
  await Promise.all([
    fs.mkdir(versionDir, { recursive: true }),
    fs.mkdir(librariesDir, { recursive: true }),
    fs.mkdir(indexesDir, { recursive: true }),
    fs.mkdir(objectsDir, { recursive: true }),
    fs.mkdir(logConfigDir, { recursive: true })
  ])

  if (signal.aborted) throw new CancellationError()
  report('获取资源索引', 2)
  let assetIndex: AssetIndexRaw | null = null
  let assetIndexId: string | null = null
  if (json.assetIndex) {
    if (!isSafeName(json.assetIndex.id)) throw new Error('资源索引名称异常')
    assetIndexId = json.assetIndex.id
    const indexPath = join(indexesDir, `${assetIndexId}.json`)
    let valid = false
    if (await pathExists(indexPath)) {
      try {
        const stat = await fs.stat(indexPath)
        valid = stat.size === json.assetIndex.size
      } catch {
        valid = false
      }
      if (valid) {
        const actual = await fileSha1(indexPath)
        valid = actual?.toLowerCase() === json.assetIndex.sha1.toLowerCase()
      }
    }
    if (!valid) {
      await downloadFile(orderedUrls(json.assetIndex.url, source), indexPath, {
        sha1: json.assetIndex.sha1,
        size: json.assetIndex.size,
        signal
      })
    }
    try {
      assetIndex = JSON.parse(await fs.readFile(indexPath, 'utf8')) as AssetIndexRaw
    } catch {
      throw new Error('资源索引文件损坏，请重试')
    }
  }

  if (signal.aborted) throw new CancellationError()
  report('准备下载列表', 4)

  const features = { is_demo_user: false, has_custom_resolution: false }
  const jobs: DownloadJob[] = []
  const nativeJars: { path: string; exclude: string[] }[] = []

  for (const library of json.libraries ?? []) {
    if (!isRuleAllowed(library.rules, features)) continue
    const artifact = mainArtifact(library)
    if (artifact) {
      jobs.push({
        urls: orderedUrls(artifact.url, source),
        destination: safeJoin(librariesDir, artifact.path),
        sha1: artifact.sha1,
        size: artifact.size,
        label: library.name
      })
    }
    const native = nativeArtifact(library)
    if (native) {
      const nativePath = safeJoin(librariesDir, native.path)
      jobs.push({
        urls: orderedUrls(native.url, source),
        destination: nativePath,
        sha1: native.sha1,
        size: native.size,
        label: `${library.name} (natives)`
      })
      nativeJars.push({ path: nativePath, exclude: library.extract?.exclude ?? ['META-INF/'] })
    }
  }

  const clientPath = join(versionDir, `${versionId}.jar`)
  jobs.push({
    urls: orderedUrls(json.downloads.client.url, source),
    destination: clientPath,
    sha1: json.downloads.client.sha1,
    size: json.downloads.client.size,
    label: '客户端主文件'
  })

  let loggingPath: string | null = null
  if (json.logging?.client?.file) {
    const logFile = json.logging.client.file
    if (isSafeName(logFile.id)) {
      loggingPath = join(logConfigDir, logFile.id)
      jobs.push({
        urls: orderedUrls(logFile.url, source),
        destination: loggingPath,
        sha1: logFile.sha1,
        size: logFile.size,
        label: '日志配置'
      })
    }
  }

  if (assetIndex?.objects) {
    for (const object of Object.values(assetIndex.objects)) {
      if (!ASSET_HASH.test(object.hash)) continue
      jobs.push({
        urls: assetObjectUrl(object.hash, source),
        destination: join(objectsDir, object.hash.slice(0, 2), object.hash),
        sha1: object.hash,
        size: object.size,
        label: '资源文件'
      })
    }
  }

  report('下载游戏文件', 5)
  await runDownloadPool(jobs, {
    concurrency: options.concurrency,
    signal,
    onProgress: (detail) => {
      report('下载游戏文件', 5 + ratioPercent(detail) * 87, detail)
    }
  })

  if (signal.aborted) throw new CancellationError()
  if (!(await pathExists(clientPath))) throw new Error('客户端主文件下载失败')

  report('解压运行库', 93)
  const nativesDir = join(versionDir, 'natives')
  await fs.rm(nativesDir, { recursive: true, force: true })
  await fs.mkdir(nativesDir, { recursive: true })
  for (const jar of nativeJars) {
    if (!(await pathExists(jar.path))) continue
    let zip: AdmZip
    try {
      zip = new AdmZip(jar.path)
    } catch {
      continue
    }
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue
      const entryName = entry.entryName.replace(/\\/g, '/')
      if (jar.exclude.some((prefix) => entryName.startsWith(prefix))) continue
      if (entryName.includes('..')) continue
      const target = safeJoin(nativesDir, entryName)
      await fs.mkdir(dirname(target), { recursive: true })
      await fs.writeFile(target, entry.getData())
    }
  }
  for (const sub of ['java', 'jna', 'lwjgl', 'netty']) {
    await fs.mkdir(join(nativesDir, sub), { recursive: true })
  }

  report('整理资源文件', 97)
  if (assetIndex && (assetIndex.virtual || assetIndex.map_to_resources)) {
    const virtualRoot = assetIndex.virtual && assetIndexId
      ? join(assetsDir, 'virtual', assetIndexId)
      : join(gameDir, 'resources')
    await fs.mkdir(virtualRoot, { recursive: true })
    let copied = 0
    for (const [relative, object] of Object.entries(assetIndex.objects ?? {})) {
      const sourcePath = join(objectsDir, object.hash.slice(0, 2), object.hash)
      if (!(await pathExists(sourcePath))) continue
      const target = safeJoin(virtualRoot, relative)
      await fs.mkdir(dirname(target), { recursive: true })
      if (!(await pathExists(target))) {
        await fs.copyFile(sourcePath, target)
      }
      copied++
      if (copied % 200 === 0) {
        report('整理旧版资源', 97)
      }
    }
  }

  await writeFileAtomic(join(versionDir, `${versionId}.json`), raw)
  if (loggingPath && !(await pathExists(loggingPath))) loggingPath = null
  report('安装完成', 100)
}
