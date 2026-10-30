import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type {
  ModpackVersionView,
  ModrinthProjectView,
  ModrinthSearchView
} from '../../shared/types'
import { downloadFile, fetchJson } from './net'
import {
  expandSearchQuery,
  localizedNameFor,
  prioritizeSearchHits
} from './searchAliases'
import { modrinthFileCandidates } from './source'

const API_BASE = 'https://api.modrinth.com/v2'
const SEARCH_LIMIT = 20

interface RawHit {
  project_id?: string
  project_type?: string
  slug?: string
  title?: string
  description?: string
  author?: string
  icon_url?: string | null
  downloads?: number
  categories?: string[]
  versions?: string[]
  latest_version?: string
}

interface RawSearchResponse {
  hits?: RawHit[]
  total_hits?: number
  offset?: number
}

interface RawProjectDetail {
  id?: string
  project_type?: string
  slug?: string
  title?: string
  description?: string
  icon_url?: string | null
  downloads?: number
  categories?: string[]
  game_versions?: string[]
}

export interface RawVersionFile {
  url?: string
  filename?: string
  primary?: boolean
  size?: number
  hashes?: { sha1?: string; sha512?: string }
}

export interface RawVersion {
  id?: string
  name?: string
  version_number?: string
  version_type?: string
  status?: string
  date_published?: string
  game_versions?: string[]
  loaders?: string[]
  files?: RawVersionFile[]
}

export interface ModpackVersionSelection {
  versionId: string
  versionNumber: string
  name: string
  versionType: string
  datePublished: string | null
  gameVersion: string
  loader: 'fabric' | 'quilt' | 'forge' | 'neoforge'
  file: {
    url: string
    filename: string
    sha1: string | null
    size: number | null
  }
}

function pickIcon(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

function strings(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((value): value is string => typeof value === 'string') : []
}

async function modrinthProjectBySlug(
  slug: string,
  signal?: AbortSignal
): Promise<ModrinthProjectView | null> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(slug)) return null
  try {
    const project = await fetchJson<RawProjectDetail>(
      [`${API_BASE}/project/${encodeURIComponent(slug)}`],
      { signal }
    )
    if (!project.id || !project.slug || !project.title) return null
    if (project.project_type && project.project_type !== 'modpack') return null
    return {
      provider: 'modrinth',
      projectId: String(project.id),
      slug: project.slug,
      title: project.title.slice(0, 160),
      localizedName: localizedNameFor(project.slug, project.title, 'modpack'),
      description: (project.description ?? '').slice(0, 600),
      author: 'Modrinth',
      iconUrl: pickIcon(project.icon_url),
      downloads: typeof project.downloads === 'number' ? project.downloads : 0,
      categories: strings(project.categories).slice(0, 8),
      gameVersions: strings(project.game_versions),
      latestVersion: null
    }
  } catch {
    return null
  }
}

export async function searchModpacks(
  query: string,
  offset = 0,
  signal?: AbortSignal
): Promise<ModrinthSearchView> {
  const safeOffset = Number.isFinite(offset) ? Math.max(0, Math.min(5000, Math.round(offset))) : 0
  const expansion = expandSearchQuery(query, 'modpack')
  const fetchPage = async (searchText: string): Promise<RawSearchResponse> => {
    const safeQuery = searchText.trim().slice(0, 100)
    const params = new URLSearchParams({
      query: safeQuery,
      limit: String(SEARCH_LIMIT),
      offset: String(safeOffset),
      index: safeQuery ? 'relevance' : 'downloads',
      facets: JSON.stringify([['project_type:modpack']])
    })
    return fetchJson<RawSearchResponse>([`${API_BASE}/search?${params.toString()}`], { signal })
  }
  let raw = await fetchPage(expansion.query)
  if (
    safeOffset === 0 &&
    expansion.translated &&
    (raw.hits ?? []).length === 0
  ) {
    raw = await fetchPage(expansion.original)
  }
  const hits: ModrinthProjectView[] = []
  for (const hit of raw.hits ?? []) {
    if (hit.project_type !== 'modpack') continue
    if (!hit.project_id || !/^[A-Za-z0-9_-]{1,64}$/.test(hit.project_id)) continue
    if (!hit.slug || !hit.title) continue
    hits.push({
      provider: 'modrinth',
      projectId: hit.project_id,
      slug: hit.slug,
      title: hit.title.slice(0, 160),
      localizedName: localizedNameFor(hit.slug, hit.title, 'modpack'),
      description: (hit.description ?? '').slice(0, 600),
      author: (hit.author ?? 'Modrinth').slice(0, 80),
      iconUrl: pickIcon(hit.icon_url),
      downloads: typeof hit.downloads === 'number' ? hit.downloads : 0,
      categories: strings(hit.categories).slice(0, 8),
      gameVersions: strings(hit.versions),
      latestVersion: typeof hit.latest_version === 'string' ? hit.latest_version : null
    })
  }
  let finalHits = hits
  let totalHits = typeof raw.total_hits === 'number' ? raw.total_hits : hits.length
  if (
    safeOffset === 0 &&
    expansion.preferredSlugs.length > 0 &&
    !hits.some((hit) => hit.slug.toLowerCase() === expansion.preferredSlugs[0].toLowerCase())
  ) {
    const pinned = await modrinthProjectBySlug(expansion.preferredSlugs[0], signal)
    if (pinned) {
      finalHits = [pinned, ...hits]
      totalHits = Math.max(totalHits, finalHits.length)
    }
  }
  return {
    hits: prioritizeSearchHits(finalHits, expansion, safeOffset),
    totalHits: Math.max(totalHits, finalHits.length),
    offset: typeof raw.offset === 'number' ? raw.offset : safeOffset,
    nextOffset: safeOffset + 20
  }
}

function modrinthFileUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return null
    const host = url.hostname.toLowerCase()
    return host === 'modrinth.com' || host.endsWith('.modrinth.com') ? url.toString() : null
  } catch {
    return null
  }
}

function mrpackFile(version: RawVersion): RawVersionFile | null {
  const files = (version.files ?? []).filter((file) => {
    const name = file.filename ?? ''
    return name.toLowerCase().endsWith('.mrpack') && modrinthFileUrl(file.url)
  })
  if (!files.length) return null
  return files.find((file) => file.primary) ?? files[0]
}

function supportedVersion(version: RawVersion): boolean {
  const loaders = strings(version.loaders).map((loader) => loader.toLowerCase())
  const hasGameVersion = strings(version.game_versions).length > 0
  return (
    hasGameVersion &&
    (loaders.includes('fabric') ||
      loaders.includes('quilt') ||
      loaders.includes('forge') ||
      loaders.includes('neoforge'))
  )
}

export async function listModpackVersions(
  projectId: string,
  signal?: AbortSignal
): Promise<ModpackVersionView[]> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(projectId)) throw new Error('无效的整合包标识')
  const versions = await fetchJson<RawVersion[]>([`${API_BASE}/project/${projectId}/version`], {
    signal
  })
  if (!Array.isArray(versions)) return []
  return versions
    .filter((version) => {
      const status = version.status ?? 'listed'
      return (
        (status === 'listed' || status === 'approved') &&
        Boolean(version.id) &&
        Boolean(mrpackFile(version)) &&
        supportedVersion(version)
      )
    })
    .map((version) => {
      const file = mrpackFile(version)
      return {
        id: version.id as string,
        name: (version.name ?? version.version_number ?? version.id ?? '').slice(0, 160),
        versionNumber: (version.version_number ?? version.name ?? version.id ?? '').slice(0, 120),
        versionType: version.version_type ?? 'release',
        gameVersion: strings(version.game_versions)[0] ?? '',
        loaders: strings(version.loaders).map((loader) => loader.toLowerCase()),
        datePublished: version.date_published ?? '',
        fileSize: typeof file?.size === 'number' ? file.size : null
      }
    })
    .sort((a, b) => Date.parse(b.datePublished) - Date.parse(a.datePublished))
}

export async function pickModpackVersion(
  projectId: string,
  signal?: AbortSignal,
  requestedVersionId?: string
): Promise<ModpackVersionSelection> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(projectId)) throw new Error('无效的整合包标识')
  if (requestedVersionId && !/^[A-Za-z0-9_-]{1,64}$/.test(requestedVersionId)) {
    throw new Error('无效的整合包版本标识')
  }
  const versions = await fetchJson<RawVersion[]>([`${API_BASE}/project/${projectId}/version`], {
    signal
  })
  if (!Array.isArray(versions) || versions.length === 0) {
    throw new Error('这个项目还没有可安装的版本')
  }
  const installable = versions.filter((version) => {
    const status = version.status ?? 'listed'
    return (status === 'listed' || status === 'approved') && mrpackFile(version)
  })
  if (!installable.length) throw new Error('这个项目没有提供 .mrpack 整合包文件')

  const supported = installable.filter(supportedVersion)
  if (!supported.length) {
    throw new Error('这个项目的现有版本没有可识别的加载器')
  }

  const releases = supported.filter((version) => version.version_type === 'release')
  const pool = releases.length ? releases : supported
  pool.sort((a, b) => Date.parse(b.date_published ?? '') - Date.parse(a.date_published ?? ''))
  const version = requestedVersionId
    ? supported.find((entry) => entry.id === requestedVersionId)
    : pool[0]
  if (!version) throw new Error('找不到指定的整合包版本')
  const file = mrpackFile(version)
  if (!version.id || !file?.url) throw new Error('整合包版本信息不完整')

  if (!/^[A-Za-z0-9_-]{1,64}$/.test(version.id)) throw new Error('整合包版本标识异常')

  const gameVersion = strings(version.game_versions)[0]
  const loaders = strings(version.loaders).map((loader) => loader.toLowerCase())
  const loader = loaders.includes('fabric')
    ? 'fabric'
    : loaders.includes('quilt')
      ? 'quilt'
      : loaders.includes('forge')
        ? 'forge'
        : loaders.includes('neoforge')
          ? 'neoforge'
          : null
  if (!gameVersion || !loader) {
    throw new Error('这个整合包暂不支持（需要 Fabric、Quilt、Forge 或 NeoForge 加载器）')
  }

  return {
    versionId: version.id,
    versionNumber: (version.version_number ?? version.name ?? version.id).slice(0, 120),
    name: (version.name ?? version.version_number ?? '').slice(0, 160),
    versionType: version.version_type ?? 'release',
    datePublished: typeof version.date_published === 'string' ? version.date_published : null,
    gameVersion,
    loader,
    file: {
      url: modrinthFileUrl(file.url) as string,
      filename: (file.filename ?? 'modpack.mrpack').replace(/[^\w.\-+]/g, '_').slice(0, 160),
      sha1: typeof file.hashes?.sha1 === 'string' ? file.hashes.sha1 : null,
      size: typeof file.size === 'number' ? file.size : null
    }
  }
}

export async function downloadModpackArchive(
  selection: ModpackVersionSelection,
  tempDir: string,
  signal: AbortSignal,
  onBytes?: (bytes: number) => void,
  mirror = false
): Promise<string> {
  const destination = join(tempDir, `${selection.versionId}.mrpack`)
  await fs.mkdir(tempDir, { recursive: true })
  await downloadFile(
    modrinthFileCandidates(selection.file.url, mirror),
    destination,
    {
      sha1: selection.file.sha1,
      size: selection.file.size,
      signal,
      onBytes
    }
  )
  return destination
}
