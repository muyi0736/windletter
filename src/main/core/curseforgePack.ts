import AdmZip from 'adm-zip'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import type { LauncherSettings, ManualPackFile } from '../../shared/types'
import { getConfigDir } from './config'
import { getCurseForgeFileInfo, resolveCurseForgeManifestFile } from './curseforge'
import { CancellationError, downloadFile } from './net'
import { modrinthFileCandidates } from './source'
import { importModpack, type ImportModpackResult } from './modpacks'
import { emptyDetail, type TaskProgress } from './progress'

const MAX_ENTRY_BYTES = 512 * 1024 * 1024
const MAX_OVERRIDE_BYTES = 2 * 1024 * 1024 * 1024

interface CfManifestFile {
  projectID?: number
  fileID?: number
  required?: boolean
}

export interface CfManifest {
  minecraft?: {
    version?: string
    modLoaders?: { id?: string; primary?: boolean }[]
  }
  name?: string
  version?: string
  author?: string
  overrides?: string
  files?: CfManifestFile[]
}

export interface InstallCurseForgeOptions {
  projectId: string
  fileId: string
  title: string
  summary: string
  iconUrl: string | null
  manualFiles?: string[]
  settings: LauncherSettings
  signal: AbortSignal
  onProgress: TaskProgress
}

export interface PrepareCurseForgeOptions {
  projectId: string
  fileId: string
  title: string
  summary: string
  manualFiles?: string[]
  /** sha1 → 本地已有文件，用于复用旧版本里同哈希的不可分发模组。 */
  manualLookup?: Map<string, string>
  settings: LauncherSettings
  signal: AbortSignal
  onProgress: TaskProgress
}

export interface PreparedCurseForgePack {
  convertedPath: string
  manifest: CfManifest
  gameVersion: string
  loader: 'fabric' | 'quilt' | 'forge' | 'neoforge' | 'vanilla'
  loaderVersion: string | null
  versionNumber: string
  versionName: string
  fileDate: string | null
  cleanup: () => Promise<void>
}

function safeFilename(raw: string): string {
  const name = basename(raw).replace(/[^\w.\-+ ]/g, '_').trim()
  return name || `curseforge-${Date.now()}.jar`
}

function loaderFromManifest(raw: string): {
  loader: 'fabric' | 'quilt' | 'forge' | 'neoforge' | 'vanilla'
  loaderVersion: string | null
} {
  const value = raw.toLowerCase()
  const entries: [string, 'fabric' | 'quilt' | 'forge' | 'neoforge'][] = [
    ['neoforge-', 'neoforge'],
    ['forge-', 'forge'],
    ['fabric-', 'fabric'],
    ['quilt-', 'quilt']
  ]
  for (const [prefix, loader] of entries) {
    if (value.startsWith(prefix)) {
      return {
        loader,
        loaderVersion: raw.slice(prefix.length) || null
      }
    }
  }
  return { loader: 'vanilla', loaderVersion: null }
}

/**
 * 下载 CurseForge 整合包并转换成 mrpack。
 * 安装和整包升级共用这一份逻辑，保证两边的文件清单、手动文件与校验规则一致。
 */
export async function prepareCurseForgePackArchive(
  options: PrepareCurseForgeOptions
): Promise<PreparedCurseForgePack> {
  const { signal, onProgress, settings } = options
  const report = (stage: string, percent: number, detail = emptyDetail()) =>
    onProgress({ stage, percent: Math.max(0, Math.min(100, percent)), detail })

  const tempDir = join(getConfigDir(), 'cache', 'curseforge-packs')
  await fs.mkdir(tempDir, { recursive: true })
  const archivePath = join(tempDir, `${options.projectId}-${options.fileId}.zip`)
  const convertedPath = join(
    tempDir,
    `${options.projectId}-${options.fileId}-${Date.now()}.mrpack`
  )
  const cleanup = async (): Promise<void> => {
    await fs.rm(archivePath, { force: true }).catch(() => undefined)
    await fs.rm(convertedPath, { force: true }).catch(() => undefined)
  }

  try {
    report('读取 CurseForge 文件信息', 1)
    const archive = await getCurseForgeFileInfo(options.projectId, options.fileId, settings)
    if (!archive.url) {
      throw new Error(
        `CurseForge 未提供自动下载地址（作者限制了第三方分发）。请打开 ${archive.manualUrl} 手动下载后导入，风信不会绕过下载限制。`
      )
    }
    report(`下载整合包 ${archive.filename}`, 3)
    await downloadFile(
      modrinthFileCandidates(archive.url, settings.modrinthMirror),
      archivePath,
      {
        sha1: archive.sha1,
        size: archive.size,
        signal,
        onBytes: (() => {
          let done = 0
          let speed = 0
          let lastTick = Date.now()
          let lastDone = 0
          let lastReport = 0
          return (bytes: number) => {
            done += bytes
            const now = Date.now()
            if (now - lastTick >= 500) {
              speed = (done - lastDone) / ((now - lastTick) / 1000)
              lastTick = now
              lastDone = done
            }
            if (now - lastReport < 300) return
            lastReport = now
            report('下载整合包文件', 3 + (done / Math.max(1, archive.size ?? 1)) * 37, {
              current: 0,
              total: 1,
              bytesDone: done,
              bytesTotal: archive.size ?? 0,
              speed,
              activeFiles: [
                {
                  label: archive.filename,
                  bytes: done,
                  size: archive.size ?? 0
                }
              ]
            })
          }
        })()
      }
    )

    if (signal.aborted) throw new CancellationError()
    report('解析 CurseForge 清单', 42)
    const zip = new AdmZip(archivePath)
    const manifestEntry = zip.getEntry('manifest.json')
    if (!manifestEntry) throw new Error('CurseForge 整合包缺少 manifest.json')
    let manifest: CfManifest
    try {
      manifest = JSON.parse(manifestEntry.getData().toString('utf8')) as CfManifest
    } catch {
      throw new Error('CurseForge 整合包清单已损坏')
    }
    const gameVersion = manifest.minecraft?.version ?? ''
    if (!/^[A-Za-z0-9._+\-]{1,64}$/.test(gameVersion)) {
      throw new Error('CurseForge 清单没有声明有效的 Minecraft 版本')
    }
    const rawLoaders = manifest.minecraft?.modLoaders ?? []
    const primaryLoader = rawLoaders.find((entry) => entry.primary) ?? rawLoaders[0]
    const loaderInfo = loaderFromManifest(primaryLoader?.id ?? '')
    if (loaderInfo.loader === 'vanilla' && primaryLoader?.id) {
      throw new Error(`暂不支持 CurseForge 加载器：${primaryLoader.id}`)
    }

    const manifestFiles = manifest.files ?? []
    if (manifestFiles.length > 5000) throw new Error('CurseForge 清单文件数量过多')
    report(`解析 CurseForge 文件（${manifestFiles.length} 个）`, 45)
    const manualBySha1 = new Map<string, Buffer>()
    for (const path of (options.manualFiles ?? []).slice(0, 200)) {
      try {
        const stat = await fs.stat(path)
        if (!stat.isFile() || stat.size <= 0 || stat.size > 256 * 1024 * 1024) continue
        const buffer = await fs.readFile(path)
        manualBySha1.set(createHash('sha1').update(buffer).digest('hex'), buffer)
      } catch {
        /* ignore unreadable user files */
      }
    }
    const manualJars: { filename: string; buffer: Buffer }[] = []
    const missing: ManualPackFile[] = []
    const resolved: ({
      filename: string
      sha1?: string
      url: string
      size?: number
      fileId: string
      projectId: string
    } | null)[] = new Array(manifestFiles.length).fill(null)
    let cursor = 0
    let finished = 0
    const reportResolved = () => {
      finished += 1
      if (finished % 10 === 0 || finished === manifestFiles.length) {
        report(
          `解析 CurseForge 文件 ${finished}/${manifestFiles.length}`,
          45 + (finished / Math.max(1, manifestFiles.length)) * 50
        )
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(4, manifestFiles.length) }, async () => {
        while (true) {
          const index = cursor
          cursor += 1
          if (index >= manifestFiles.length) return
          if (signal.aborted) throw new CancellationError()
          const entry = manifestFiles[index]
          if (!entry.projectID || !entry.fileID) {
            reportResolved()
            continue
          }
          let info
          try {
            info = await resolveCurseForgeManifestFile(
              String(entry.projectID),
              String(entry.fileID),
              settings
            )
          } catch (error) {
            if (entry.required === false) {
              reportResolved()
              continue
            }
            throw new Error(
              `无法读取 CurseForge 文件 ${entry.projectID}/${entry.fileID}：${
                error instanceof Error ? error.message : '未知错误'
              }`
            )
          }
          if (!info.url) {
            const sha1 = info.sha1?.toLowerCase() ?? null
            const manual = sha1 ? manualBySha1.get(sha1) : undefined
            if (manual) {
              manualJars.push({ filename: safeFilename(info.filename), buffer: manual })
              reportResolved()
              continue
            }
            const localPath = sha1 ? options.manualLookup?.get(sha1) : undefined
            if (localPath) {
              try {
                const buffer = await fs.readFile(localPath)
                if (createHash('sha1').update(buffer).digest('hex') === sha1) {
                  manualJars.push({ filename: safeFilename(info.filename), buffer })
                  reportResolved()
                  continue
                }
              } catch {
                /* fall through to manual download */
              }
            }
            if (entry.required === false) {
              reportResolved()
              continue
            }
            missing.push({
              projectId: String(entry.projectID),
              fileId: String(entry.fileID),
              fileName: info.filename,
              size: info.size ?? null,
              sha1: info.sha1 ?? null,
              pageUrl: info.manualUrl
            })
            reportResolved()
            continue
          }
          resolved[index] = {
            filename: info.filename,
            sha1: info.sha1 ?? undefined,
            url: info.url,
            size: info.size ?? undefined,
            fileId: String(entry.fileID),
            projectId: String(entry.projectID)
          }
          reportResolved()
        }
      })
    )
    if (missing.length > 0) {
      const names = missing
        .slice(0, 3)
        .map((item) => item.fileName)
        .join('、')
      const error = new Error(
        `有 ${missing.length} 个模组需要手动下载${names ? `：${names}${missing.length > 3 ? ' 等' : ''}` : ''}。请到 CurseForge 下载对应文件后重试`
      ) as Error & { manualFiles?: ManualPackFile[] }
      error.manualFiles = missing
      throw error
    }
    const files: {
      path: string
      hashes: { sha1?: string }
      downloads: string[]
      fileSize?: number
      projectId?: string
      fileId?: string
    }[] = []
    const seenNames = new Set<string>()
    for (const item of resolved) {
      if (!item) continue
      let filename = safeFilename(item.filename)
      if (seenNames.has(filename)) {
        filename = `${filename.replace(/\.jar$/i, '')}-${item.fileId}.jar`
      }
      seenNames.add(filename)
      files.push({
        path: `mods/${filename}`,
        hashes: item.sha1 ? { sha1: item.sha1 } : {},
        downloads: [item.url],
        ...(item.size ? { fileSize: item.size } : {}),
        projectId: item.projectId,
        fileId: item.fileId
      })
    }
    if (files.length === 0 && manualJars.length === 0) {
      throw new Error('CurseForge 清单没有可下载的模组文件')
    }

    const dependencies: Record<string, string> = { minecraft: gameVersion }
    if (loaderInfo.loader === 'vanilla') {
      // no loader dependency
    } else if (loaderInfo.loader === 'fabric' || loaderInfo.loader === 'quilt') {
      if (loaderInfo.loaderVersion) {
        dependencies[loaderInfo.loader === 'fabric' ? 'fabric-loader' : 'quilt-loader'] =
          loaderInfo.loaderVersion
      }
    } else if (loaderInfo.loaderVersion) {
      dependencies[loaderInfo.loader] = loaderInfo.loaderVersion
    }

    const converted = new AdmZip()
    for (const jar of manualJars) {
      converted.addFile(`overrides/mods/${jar.filename}`, jar.buffer)
    }
    converted.addFile(
      'modrinth.index.json',
      Buffer.from(
        JSON.stringify({
          formatVersion: 1,
          game: 'minecraft',
          name: (options.title || manifest.name || 'CurseForge 整合包').slice(0, 120),
          summary: options.summary.slice(0, 600),
          versionId: manifest.version ?? '',
          dependencies,
          files
        }),
        'utf8'
      )
    )
    const overridesPrefix = (manifest.overrides ?? 'overrides').replace(/\\/g, '/')
    if (overridesPrefix && overridesPrefix !== '.' && !overridesPrefix.includes('..')) {
      const prefix = `${overridesPrefix.replace(/\/+$/, '')}/`
      let overrideBytes = 0
      for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue
        const name = entry.entryName.replace(/\\/g, '/')
        if (!name.startsWith(prefix)) continue
        const relative = name.slice(prefix.length)
        if (!relative || relative.includes('..') || relative.includes(':')) continue
        if (entry.header.size > MAX_ENTRY_BYTES) {
          throw new Error(`覆盖文件过大：${relative}`)
        }
        overrideBytes += entry.header.size
        if (overrideBytes > MAX_OVERRIDE_BYTES) {
          throw new Error('覆盖文件总大小超出限制')
        }
        converted.addFile(`overrides/${relative}`, entry.getData())
      }
    }
    converted.writeZip(convertedPath)

    if (signal.aborted) throw new CancellationError()
    report('准备整合包文件', 100)
    return {
      convertedPath,
      manifest,
      gameVersion,
      loader: loaderInfo.loader,
      loaderVersion: loaderInfo.loaderVersion,
      versionNumber: (manifest.version ?? archive.versionNumber ?? '').slice(0, 120),
      versionName: (manifest.name ?? options.title).slice(0, 160),
      fileDate: archive.fileDate,
      cleanup
    }
  } catch (error) {
    await cleanup()
    throw error
  }
}

export async function installCurseForgeModpack(
  options: InstallCurseForgeOptions
): Promise<ImportModpackResult> {
  const { signal, onProgress, settings } = options
  const prepared = await prepareCurseForgePackArchive({
    projectId: options.projectId,
    fileId: options.fileId,
    title: options.title,
    summary: options.summary,
    manualFiles: options.manualFiles,
    settings,
    signal,
    onProgress: (info) =>
      onProgress({
        ...info,
        percent: info.percent * 0.18
      })
  })

  try {
    if (signal.aborted) throw new CancellationError()
    onProgress({
      stage: '开始安装 CurseForge 整合包',
      percent: 18,
      detail: emptyDetail()
    })
    return await importModpack({
      archivePath: prepared.convertedPath,
      displayName: options.title,
      summary: options.summary,
      iconUrl: options.iconUrl,
      source: 'curseforge',
      projectId: options.projectId,
      gameDir: settings.gameDir,
      settings,
      downloadSource: settings.source,
      concurrency: settings.downloadConcurrency,
      signal,
      onProgress: (info) =>
        onProgress({
          stage: `安装 · ${info.stage}`,
          percent: 18 + info.percent * 0.82,
          detail: info.detail
        })
    })
  } finally {
    await prepared.cleanup()
  }
}
