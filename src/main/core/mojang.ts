import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { DownloadSource } from '../../shared/types'
import { getCacheDir } from './config'
import { fetchJson, fetchText, sha1OfText } from './net'
import {
  javaRuntimeManifestCandidates,
  manifestCandidates,
  orderedUrls,
  platformKey
} from './source'
import type {
  JavaRuntimeEntry,
  JavaRuntimeFilesRaw,
  JavaRuntimeManifestRaw,
  VersionEntry,
  VersionJson,
  VersionManifestRaw
} from './mojangTypes'

const MANIFEST_TTL = 5 * 60_000
const RUNTIME_TTL = 10 * 60_000

let manifestCache: { at: number; raw: VersionManifestRaw } | null = null
let runtimeCache: { at: number; raw: JavaRuntimeManifestRaw } | null = null

async function readCache<T>(name: string): Promise<T | null> {
  try {
    const text = await fs.readFile(join(getCacheDir(), name), 'utf8')
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

async function writeCache(name: string, data: unknown): Promise<void> {
  try {
    await fs.mkdir(getCacheDir(), { recursive: true })
    await fs.writeFile(join(getCacheDir(), name), JSON.stringify(data), 'utf8')
  } catch {
    /* cache failures are non-fatal */
  }
}

function isManifest(raw: unknown): raw is VersionManifestRaw {
  const value = raw as VersionManifestRaw
  return !!value && Array.isArray(value.versions) && !!value.latest
}

async function refreshManifest(source: DownloadSource): Promise<VersionManifestRaw> {
  try {
    const raw = await fetchJson<VersionManifestRaw>(manifestCandidates(source))
    if (!isManifest(raw)) throw new Error('版本清单格式异常')
    manifestCache = { at: Date.now(), raw }
    await writeCache('version_manifest.json', raw)
    return raw
  } catch (err) {
    const cached = await readCache<VersionManifestRaw>('version_manifest.json')
    if (isManifest(cached)) {
      manifestCache = { at: Date.now() - MANIFEST_TTL + 30_000, raw: cached }
      return cached
    }
    throw err
  }
}

export async function getVersionManifest(source: DownloadSource, force = false): Promise<VersionManifestRaw> {
  if (!force && manifestCache && Date.now() - manifestCache.at < MANIFEST_TTL) return manifestCache.raw
  if (!force) {
    const cached = await readCache<VersionManifestRaw>('version_manifest.json')
    if (isManifest(cached)) {
      manifestCache = { at: Date.now() - MANIFEST_TTL + 30_000, raw: cached }
      void refreshManifest(source).catch(() => undefined)
      return cached
    }
  }
  return refreshManifest(source)
}

export async function getVersionEntry(id: string, source: DownloadSource): Promise<VersionEntry> {
  const manifest = await getVersionManifest(source)
  const entry = manifest.versions.find((v) => v.id === id)
  if (!entry) throw new Error(`版本清单中不存在 ${id}`)
  return entry
}

export async function getVersionJson(
  entry: VersionEntry,
  source: DownloadSource,
  signal?: AbortSignal
): Promise<{ json: VersionJson; raw: string }> {
  const cacheFile = join(getCacheDir(), 'versions', `${entry.id}.json`)
  const urls = orderedUrls(entry.url, source)
  let lastError: unknown = null

  for (const url of urls) {
    try {
      const raw = await fetchText([url], { signal, timeoutMs: 40_000 })
      if (entry.sha1 && sha1OfText(raw).toLowerCase() !== entry.sha1.toLowerCase()) {
        throw new Error('版本 JSON 校验失败')
      }
      const json = JSON.parse(raw) as VersionJson
      if (!json || typeof json.id !== 'string') throw new Error('版本 JSON 格式异常')
      await fs.mkdir(join(getCacheDir(), 'versions'), { recursive: true }).catch(() => undefined)
      await fs.writeFile(cacheFile, raw, 'utf8').catch(() => undefined)
      return { json, raw }
    } catch (err) {
      lastError = err
    }
  }

  try {
    const raw = await fs.readFile(cacheFile, 'utf8')
    if (!entry.sha1 || sha1OfText(raw).toLowerCase() === entry.sha1.toLowerCase()) {
      return { json: JSON.parse(raw) as VersionJson, raw }
    }
  } catch {
    /* ignore */
  }
  throw lastError instanceof Error ? lastError : new Error('无法获取版本信息')
}

export async function getJavaRuntimeManifest(source: DownloadSource): Promise<JavaRuntimeManifestRaw> {
  if (runtimeCache && Date.now() - runtimeCache.at < RUNTIME_TTL) return runtimeCache.raw
  try {
    const raw = await fetchJson<JavaRuntimeManifestRaw>(javaRuntimeManifestCandidates(source))
    runtimeCache = { at: Date.now(), raw }
    await writeCache('java_runtime_manifest.json', raw)
    return raw
  } catch (err) {
    const cached = await readCache<JavaRuntimeManifestRaw>('java_runtime_manifest.json')
    if (cached) {
      runtimeCache = { at: Date.now() - RUNTIME_TTL + 30_000, raw: cached }
      return cached
    }
    throw err
  }
}

function majorFromVersionName(name: string): number {
  const match = name.match(/^(\d+)\.(\d+)/)
  if (!match) return 0
  const first = Number(match[1])
  return first === 1 ? Number(match[2]) : first
}

export interface SelectedRuntime {
  component: string
  entry: JavaRuntimeEntry
  platform: string
}

export async function selectJavaRuntime(
  requiredMajor: number,
  preferredComponent: string | undefined,
  source: DownloadSource
): Promise<SelectedRuntime | null> {
  const raw = await getJavaRuntimeManifest(source)
  const platform = platformKey()
  const components = raw[platform]
  if (!components) return null

  if (preferredComponent && components[preferredComponent]?.length) {
    return { component: preferredComponent, entry: components[preferredComponent][0], platform }
  }

  const candidates: SelectedRuntime[] = []
  for (const [component, entries] of Object.entries(components)) {
    if (!component.startsWith('java-runtime') && component !== 'jre-legacy') continue
    for (const entry of entries) {
      if (majorFromVersionName(entry.version.name) === requiredMajor) {
        candidates.push({ component, entry, platform })
      }
    }
  }
  if (!candidates.length) return null
  if (requiredMajor === 8) {
    return candidates.find((c) => c.component === 'jre-legacy') ?? candidates[0]
  }
  return candidates.sort((a, b) => b.entry.version.released.localeCompare(a.entry.version.released))[0]
}

export async function getJavaRuntimeFiles(
  entry: JavaRuntimeEntry,
  source: DownloadSource,
  signal?: AbortSignal
): Promise<JavaRuntimeFilesRaw> {
  const candidates = orderedUrls(entry.manifest.url, source)
  let lastError: unknown = null
  for (const url of candidates) {
    try {
      const raw = await fetchText([url], { signal, timeoutMs: 60_000 })
      if (sha1OfText(raw).toLowerCase() !== entry.manifest.sha1.toLowerCase()) {
        throw new Error('Java 运行时清单校验失败')
      }
      return JSON.parse(raw) as JavaRuntimeFilesRaw
    } catch (err) {
      lastError = err
    }
  }
  throw lastError instanceof Error ? lastError : new Error('无法获取 Java 运行时清单')
}

export function versionView(manifest: VersionManifestRaw, source: DownloadSource) {
  return {
    latest: manifest.latest,
    source,
    fetchedAt: Date.now(),
    versions: manifest.versions.map((v) => ({
      id: v.id,
      type: v.type,
      releaseTime: v.releaseTime
    }))
  }
}
