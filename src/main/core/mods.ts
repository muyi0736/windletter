import { promises as fs } from 'node:fs'
import type { Dirent } from 'node:fs'
import { basename, join } from 'node:path'
import type {
  ContentKind,
  ContentProvider,
  InstalledModView,
  LauncherSettings,
  ManualModDownload,
  ModDependencyView,
  ModDownloadRequest,
  ModDownloadResult,
  ModInstallRequest,
  ModInstallResult,
  ModProjectView,
  ModSearchView,
  ModVersionView
} from '../../shared/types'
import { getConfigDir } from './config'
import { getInstance, getInstanceGameDir } from './instances'
import { readJarModIdentity } from './modIdentity'
import {
  getCurseForgeProjectLink,
  pickCurseForgeModFile,
  listCurseForgeModVersions,
  type CurseForgeSelection
} from './curseforge'
import { downloadFile, fetchJson } from './net'
import {
  expandSearchQuery,
  findLocalAliasMatches,
  findPinyinAliasMatches,
  localizedNameFor,
  localizedNameFromExpansion,
  normalizeSearchText,
  preferredSlugsFor,
  prioritizeSearchHits,
  type SearchQueryExpansion
} from './searchAliases'
import { modrinthFileCandidates } from './source'
import { safeJoin } from './version'

const API_BASE = 'https://api.modrinth.com/v2'
const PAGE_SIZE = 20
const MAX_DEPENDENCIES = 20
const CONTENT_SEGMENT_MIN_BYTES = 1 * 1024 * 1024
const CONTENT_DOWNLOAD_CONCURRENCY = 3

export interface InstallProgressHooks {
  onPlan?: (info: { files: number; bytesTotal: number }) => void
  onFile?: (info: { file: string; index: number; total: number }) => void
  onBytes?: (delta: number) => void
  signal?: AbortSignal
}

const KIND_EXTENSION: Record<ContentKind, string> = {
  mod: '.jar',
  datapack: '.zip',
  resourcepack: '.zip',
  shader: '.zip'
}
const KIND_FOLDER: Record<ContentKind, string> = {
  mod: 'mods',
  datapack: 'datapacks',
  resourcepack: 'resourcepacks',
  shader: 'shaderpacks'
}
const KIND_PROJECT_TYPE: Record<ContentKind, string> = {
  mod: 'mod',
  datapack: 'datapack',
  resourcepack: 'resourcepack',
  shader: 'shader'
}

interface RawHit {
  project_id?: string
  slug?: string
  title?: string
  description?: string
  author?: string
  icon_url?: string | null
  downloads?: number
  categories?: string[]
  versions?: string[]
}

interface RawVersionFile {
  url?: string
  filename?: string
  primary?: boolean
  size?: number
  hashes?: { sha1?: string }
}

interface RawDependency {
  project_id?: string | null
  version_id?: string | null
  dependency_type?: string
}

interface RawVersion {
  id?: string
  project_id?: string
  name?: string
  version_number?: string
  version_type?: string
  status?: string
  date_published?: string
  downloads?: number
  game_versions?: string[]
  loaders?: string[]
  files?: RawVersionFile[]
  dependencies?: RawDependency[]
}

interface RawProject {
  id?: string
  project_type?: string
  slug?: string
  title?: string
  description?: string
  icon_url?: string | null
  downloads?: number
  categories?: string[]
  game_versions?: string[]
  loaders?: string[]
}

interface ModFile {
  title: string
  filename: string
  url: string | null
  manualUrl: string
  sha1: string | null
  size: number | null
  /** 自动解析出的前置；安装前如果同 ID 模组已存在，不再写入重复 jar。 */
  dependency?: boolean
}

function httpsUrl(raw: unknown): string | null {
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
  gameVersion: string,
  loader: string
): Promise<ModProjectView | null> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(slug)) return null
  try {
    const project = await fetchJson<RawProject>([
      `${API_BASE}/project/${encodeURIComponent(slug)}`
    ])
    if (!project.id || !project.slug || !project.title) return null
    if (project.project_type && project.project_type !== 'mod') return null
    if (
      gameVersion &&
      Array.isArray(project.game_versions) &&
      project.game_versions.length > 0 &&
      !project.game_versions.includes(gameVersion)
    ) {
      return null
    }
    if (
      loader &&
      Array.isArray(project.loaders) &&
      project.loaders.length > 0 &&
      !project.loaders.some((value) => value.toLowerCase() === loader.toLowerCase())
    ) {
      return null
    }
    return {
      provider: 'modrinth',
      projectId: String(project.id),
      slug: project.slug,
      title: project.title.slice(0, 160),
      localizedName: localizedNameFor(project.slug, project.title, 'mod'),
      description: (project.description ?? '').slice(0, 600),
      author: 'Modrinth',
      iconUrl: httpsUrl(project.icon_url),
      downloads: typeof project.downloads === 'number' ? project.downloads : 0,
      categories: strings(project.categories).slice(0, 8),
      gameVersions: strings(project.game_versions)
    }
  } catch {
    return null
  }
}

function safeFilename(raw: string | undefined, fallback: string): string {
  const name = basename(raw ?? '').replace(/[^\w.\-+ ]/g, '_').trim()
  if (!name || name === '.' || name === '..') return fallback
  return name.toLowerCase().endsWith('.jar') ? name : `${name}.jar`
}

function safeContentFilename(
  raw: string | undefined,
  fallback: string,
  kind: ContentKind
): string {
  const extension = KIND_EXTENSION[kind]
  let name = basename(raw ?? '').replace(/[^\w.\-+ ]/g, '_').trim()
  if (!name || name === '.' || name === '..') name = fallback
  if (!name.toLowerCase().endsWith(extension)) {
    name = `${name.replace(/\.(jar|zip)$/i, '')}${extension}`
  }
  return name
}

async function modsDir(instanceId: string): Promise<string> {
  return join(await getInstanceGameDir(instanceId), 'mods')
}

async function contentDir(instanceId: string, kind: ContentKind): Promise<string> {
  if (kind === 'mod') return modsDir(instanceId)
  return join(await getInstanceGameDir(instanceId), KIND_FOLDER[kind])
}

async function applyModrinthPins(
  hits: ModProjectView[],
  expansion: SearchQueryExpansion,
  gameVersion: string,
  loader: string
): Promise<ModProjectView[]> {
  const slugs = preferredSlugsFor(expansion, 'modrinth').slice(0, 20)
  if (slugs.length === 0) return hits
  const existingBySlug = new Map(
    hits.map((hit) => [hit.slug.toLowerCase(), hit] as const)
  )
  const resolved = await mapWithConcurrency(
    slugs,
    4,
    async (slug) => {
      const existing = existingBySlug.get(slug.toLowerCase())
      if (existing) return existing
      return modrinthProjectBySlug(slug, gameVersion, loader)
    }
  )
  const ordered: ModProjectView[] = []
  const usedSlugs = new Set<string>()
  const usedIds = new Set<string>()
  for (const project of resolved) {
    if (!project) continue
    const slug = project.slug.toLowerCase()
    if (usedSlugs.has(slug) || usedIds.has(project.projectId)) continue
    usedSlugs.add(slug)
    usedIds.add(project.projectId)
    const localized = localizedNameFromExpansion(expansion, project.slug)
    ordered.push(localized ? { ...project, localizedName: localized } : project)
  }
  const rest = hits.filter(
    (hit) =>
      !usedSlugs.has(hit.slug.toLowerCase()) && !usedIds.has(hit.projectId)
  )
  return [...ordered, ...rest]
}

export async function searchModrinthMods(
  query: string,
  gameVersion: string,
  loader: string,
  offset: number,
  kind: ContentKind = 'mod'
): Promise<ModSearchView> {
  const safeOffset = Number.isFinite(offset) ? Math.max(0, Math.round(offset)) : 0
  if (kind === 'mod') {
    let local = findLocalAliasMatches(
      query,
      'modrinth',
      safeOffset,
      20,
      loader,
      'mod'
    )
    if (local.total === 0) {
      local = findPinyinAliasMatches(query, 'modrinth', safeOffset, 20, loader, 'mod')
    }
    if (local.total > 0) {
      const projects = await mapWithConcurrency(
        local.slugs,
        4,
        async (slug) => modrinthProjectBySlug(slug, gameVersion, loader)
      )
      const hits: ModProjectView[] = []
      const seen = new Set<string>()
      for (const project of projects) {
        if (!project) continue
        if (seen.has(project.projectId)) continue
        seen.add(project.projectId)
        const localized =
          local.localizedNames[normalizeSearchText(project.slug)] ??
          localizedNameFor(project.slug, project.title, 'mod')
        hits.push(localized ? { ...project, localizedName: localized } : project)
      }
      return {
        hits,
        totalHits: local.total,
        offset: safeOffset,
        nextOffset: safeOffset + 20
      }
    }
  }
  const expansion = expandSearchQuery(query, kind, kind === 'mod' ? loader : '')
  const facets: string[][] = [[`project_type:${KIND_PROJECT_TYPE[kind]}`]]
  if (gameVersion) facets.push([`versions:${gameVersion}`])
  if (kind === 'mod' && loader) facets.push([`categories:${loader}`])
  const fetchPage = async (
    searchText: string
  ): Promise<{ hits?: RawHit[]; total_hits?: number; offset?: number }> => {
    const safeQuery = searchText.trim().slice(0, 100)
    const params = new URLSearchParams({
      query: safeQuery,
      limit: String(PAGE_SIZE),
      offset: String(safeOffset),
      index: safeQuery ? 'relevance' : 'downloads',
      facets: JSON.stringify(facets)
    })
    return fetchJson<{ hits?: RawHit[]; total_hits?: number; offset?: number }>([
      `${API_BASE}/search?${params.toString()}`
    ])
  }
  let raw = await fetchPage(expansion.query)
  if (
    safeOffset === 0 &&
    expansion.translated &&
    (raw.hits ?? []).length === 0
  ) {
    raw = await fetchPage(expansion.original)
  }
  const hits: ModProjectView[] = []
  for (const hit of raw.hits ?? []) {
    if (!hit.project_id || !hit.slug || !hit.title) continue
    hits.push({
      provider: 'modrinth',
      projectId: hit.project_id,
      slug: hit.slug,
      title: hit.title.slice(0, 160),
      localizedName:
        kind === 'mod'
          ? localizedNameFromExpansion(expansion, hit.slug) ??
            localizedNameFor(hit.slug, hit.title, 'mod')
          : null,
      description: (hit.description ?? '').slice(0, 600),
      author: (hit.author ?? 'Modrinth').slice(0, 80),
      iconUrl: httpsUrl(hit.icon_url),
      downloads: typeof hit.downloads === 'number' ? hit.downloads : 0,
      categories: strings(hit.categories).slice(0, 8),
      gameVersions: strings(hit.versions)
    })
  }
  let finalHits = hits
  if (safeOffset === 0 && kind === 'mod') {
    finalHits = await applyModrinthPins(
      hits,
      expansion,
      gameVersion,
      loader
    )
  }
  return {
    hits: prioritizeSearchHits(finalHits, expansion, safeOffset, 'modrinth'),
    totalHits: Math.max(
      typeof raw.total_hits === 'number' ? raw.total_hits : finalHits.length,
      finalHits.length
    ),
    offset: typeof raw.offset === 'number' ? raw.offset : safeOffset,
    nextOffset: safeOffset + 20
  }
}

function dependencyType(raw: string | undefined): ModDependencyView['type'] {
  if (raw === 'required' || raw === 'optional' || raw === 'incompatible' || raw === 'embedded') {
    return raw
  }
  return 'optional'
}

async function modrinthProjectMeta(ids: string[]): Promise<Map<string, RawProject>> {
  const unique = [...new Set(ids.filter(Boolean))].slice(0, 50)
  if (unique.length === 0) return new Map()
  try {
    const raw = await fetchJson<RawProject[]>([
      `${API_BASE}/projects?ids=${encodeURIComponent(JSON.stringify(unique))}`
    ])
    const map = new Map<string, RawProject>()
    for (const project of Array.isArray(raw) ? raw : []) {
      if (project.id) map.set(project.id, project)
    }
    return map
  } catch {
    return new Map()
  }
}

export async function listModrinthVersions(
  projectId: string,
  kind: ContentKind = 'mod'
): Promise<ModVersionView[]> {
  const raw = await fetchJson<RawVersion[]>([
    `${API_BASE}/project/${encodeURIComponent(projectId)}/version`
  ])
  if (!Array.isArray(raw)) throw new Error('Modrinth 返回了无法解析的版本列表')
  const listed = raw.filter((version) => {
    const status = version.status ?? 'listed'
    return Boolean(version.id) && (status === 'listed' || status === 'approved') && Boolean(contentFile(version, kind))
  })
  const dependencyIds =
    kind === 'mod'
      ? listed.flatMap((version) =>
          (version.dependencies ?? [])
            .filter((dep) => dep.dependency_type === 'required' && dep.project_id)
            .map((dep) => dep.project_id as string)
        )
      : []
  const meta = await modrinthProjectMeta(dependencyIds)
  const versions = listed.map((version) => {
    const file = contentFile(version, kind) as ModFile
    const dependencies: ModDependencyView[] = []
    const seen = new Set<string>()
    for (const dep of kind === 'mod' ? version.dependencies ?? [] : []) {
      const title = dep.project_id ? meta.get(dep.project_id) : null
      const key = `${dep.project_id ?? ''}:${dep.version_id ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      if (!dep.project_id && !dep.version_id) continue
      dependencies.push({
        provider: 'modrinth',
        projectId: dep.project_id ?? '',
        title: title?.title?.slice(0, 80) ?? (dep.project_id ? `Modrinth 模组 ${dep.project_id}` : '指定版本前置'),
        iconUrl: httpsUrl(title?.icon_url),
        type: dependencyType(dep.dependency_type)
      })
    }
    return {
      id: version.id as string,
      name: (version.name ?? version.version_number ?? file.filename).slice(0, 160),
      versionNumber: (version.version_number ?? version.name ?? file.filename).slice(0, 120),
      versionType: version.version_type ?? 'release',
      gameVersions: strings(version.game_versions),
      loaders: strings(version.loaders).map((loader) => loader.toLowerCase()),
      filename: file.filename,
      fileSize: file.size,
      downloads: typeof version.downloads === 'number' ? version.downloads : 0,
      datePublished: version.date_published ?? '',
      dependencies
    }
  })
  versions.sort((a, b) => Date.parse(b.datePublished) - Date.parse(a.datePublished))
  return versions
}

export async function listModVersions(
  provider: ContentProvider,
  projectId: string,
  settings: LauncherSettings,
  kind: ContentKind = 'mod'
): Promise<ModVersionView[]> {
  if (provider === 'curseforge') {
    return listCurseForgeModVersions(projectId, settings)
  }
  return listModrinthVersions(projectId, kind)
}

function contentFile(version: RawVersion, kind: ContentKind = 'mod'): ModFile | null {
  const extension = KIND_EXTENSION[kind]
  const files = (version.files ?? []).filter((file) => {
    const name = file.filename ?? ''
    return name.toLowerCase().endsWith(extension) && httpsUrl(file.url)
  })
  if (files.length === 0) return null
  const file = files.find((entry) => entry.primary) ?? files[0]
  const url = httpsUrl(file.url)
  if (!url) return null
  return {
    title: (version.name ?? version.version_number ?? `Modrinth ${kind}`).slice(0, 160),
    filename: safeContentFilename(
      file.filename,
      `modrinth-${version.id ?? kind}${extension}`,
      kind
    ),
    url,
    manualUrl: `https://modrinth.com/${KIND_PROJECT_TYPE[kind]}/${version.project_id ?? ''}/version/${version.id ?? ''}`,
    sha1:
      typeof file.hashes?.sha1 === 'string' && /^[0-9a-f]{40}$/i.test(file.hashes.sha1)
        ? file.hashes.sha1.toLowerCase()
        : null,
    size: typeof file.size === 'number' ? file.size : null
  }
}

async function modrinthVersion(versionId: string): Promise<RawVersion | null> {
  try {
    return await fetchJson<RawVersion>([`${API_BASE}/version/${encodeURIComponent(versionId)}`])
  } catch {
    return null
  }
}

async function pickModrinthVersion(
  projectId: string,
  gameVersion: string,
  loader: string,
  kind: ContentKind = 'mod'
): Promise<RawVersion | null> {
  const versions = await fetchJson<RawVersion[]>([
    `${API_BASE}/project/${encodeURIComponent(projectId)}/version`
  ])
  if (!Array.isArray(versions)) return null
  const compatible = versions.filter((version) => {
    const status = version.status ?? 'listed'
    if (status !== 'listed' && status !== 'approved') return false
    if (!gameVersion || !strings(version.game_versions).includes(gameVersion)) return false
    if (kind === 'mod' && loader && !strings(version.loaders).some((value) => value.toLowerCase() === loader.toLowerCase())) {
      return false
    }
    return Boolean(contentFile(version, kind))
  })
  if (compatible.length === 0) return null
  compatible.sort((a, b) => {
    const releaseA = a.version_type === 'release' ? 1 : 0
    const releaseB = b.version_type === 'release' ? 1 : 0
    if (releaseA !== releaseB) return releaseB - releaseA
    return Date.parse(b.date_published ?? '') - Date.parse(a.date_published ?? '')
  })
  return compatible[0]
}

async function collectModrinthVersionFiles(
  version: RawVersion,
  gameVersion: string,
  loader: string,
  seen: Set<string>,
  depth: number,
  kind: ContentKind = 'mod',
  includeDependencies = true
): Promise<{ files: ModFile[]; manual: ManualModDownload[] }> {
  const key = version.project_id ?? version.id ?? ''
  if (!key || seen.has(key) || seen.size >= MAX_DEPENDENCIES) return { files: [], manual: [] }
  seen.add(key)
  const file = contentFile(version, kind)
  if (!file) return { files: [], manual: [] }
  if (depth > 0) file.dependency = true
  const files = [file]
  const manual: ManualModDownload[] = []
  if (kind === 'mod' && includeDependencies && depth < 4) {
    for (const dependency of version.dependencies ?? []) {
      if (dependency.dependency_type !== 'required') continue
      if (dependency.project_id) {
        const child = await resolveModrinthFiles(
          dependency.project_id,
          gameVersion,
          loader,
          seen,
          depth + 1,
          kind,
          includeDependencies
        )
        files.push(...child.files)
        manual.push(...child.manual)
      } else if (dependency.version_id) {
        const depVersion = await modrinthVersion(dependency.version_id)
        if (depVersion) {
          const child = await collectModrinthVersionFiles(
            depVersion,
            gameVersion,
            loader,
            seen,
            depth + 1,
            kind,
            includeDependencies
          )
          files.push(...child.files)
          manual.push(...child.manual)
        }
      }
    }
  }
  return { files, manual }
}

async function resolveModrinthFiles(
  projectId: string,
  gameVersion: string,
  loader: string,
  seen: Set<string>,
  depth: number,
  kind: ContentKind = 'mod',
  includeDependencies = true
): Promise<{ files: ModFile[]; manual: ManualModDownload[] }> {
  if (seen.has(projectId) || seen.size >= MAX_DEPENDENCIES) return { files: [], manual: [] }
  const version = await pickModrinthVersion(projectId, gameVersion, loader, kind)
  if (!version) {
    return {
      files: [],
      manual: [
        {
          title: '未能自动匹配模组版本',
          url: `https://modrinth.com/mod/${encodeURIComponent(projectId)}`
        }
      ]
    }
  }
  return collectModrinthVersionFiles(
    version,
    gameVersion,
    loader,
    seen,
    depth,
    kind,
    includeDependencies
  )
}

export interface LatestContentVersion {
  versionId: string
  versionNumber: string
  fileName: string | null
  fileSize: number | null
}

export async function latestModrinthVersionInfo(
  projectId: string,
  gameVersion: string,
  loader: string,
  kind: ContentKind = 'mod'
): Promise<LatestContentVersion | null> {
  const version = await pickModrinthVersion(projectId, gameVersion, loader, kind)
  if (!version) return null
  const file = contentFile(version, kind)
  return {
    versionId: String(version.id ?? ''),
    versionNumber: (version.version_number ?? version.name ?? file?.filename ?? '').slice(0, 160),
    fileName: file?.filename ?? null,
    fileSize: file?.size ?? null
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const runners = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (true) {
        const index = cursor
        cursor += 1
        if (index >= items.length) return
        results[index] = await worker(items[index], index)
      }
    }
  )
  // 等到所有并发任务都结束后再抛错，避免失败回滚时仍有下载在写入目录。
  const settled = await Promise.allSettled(runners)
  const failed = settled.find(
    (item): item is PromiseRejectedResult => item.status === 'rejected'
  )
  if (failed) throw failed.reason
  return results
}

type FileOutcome =
  | { kind: 'installed'; title: string; file: string }
  | { kind: 'skipped'; file: string }
  | { kind: 'manual'; item: ManualModDownload }

function uniqueFiles(files: ModFile[]): ModFile[] {
  const seen = new Set<string>()
  const result: ModFile[] = []
  for (const file of files) {
    if (seen.has(file.filename)) continue
    seen.add(file.filename)
    result.push(file)
  }
  return result
}

async function installFiles(
  instanceId: string,
  files: ModFile[],
  settings: LauncherSettings,
  kind: ContentKind = 'mod',
  hooks?: InstallProgressHooks
): Promise<{ installed: { title: string; file: string }[]; skipped: string[]; manual: ManualModDownload[] }> {
  const targetDir = await contentDir(instanceId, kind)
  await fs.mkdir(targetDir, { recursive: true })
  const unique = uniqueFiles(files)
  const byFilename = new Map(unique.map((file) => [file.filename, file]))
  const needsDependencyCheck =
    kind === 'mod' && unique.some((file) => file.dependency === true)
  // 自动前置经常包含 Fabric API / Kotlin 这类整合包已经带了的库。
  // 只看文件名会再装一份不同版本，Fabric 随后会报 duplicate mod id。
  const installedModIds = new Set<string>()
  if (needsDependencyCheck) {
    let entries: Dirent[] = []
    try {
      entries = await fs.readdir(targetDir, { withFileTypes: true })
    } catch {
      entries = []
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.jar')) continue
      const identity = await readJarModIdentity(safeJoin(targetDir, entry.name))
      for (const id of identity?.ids ?? []) installedModIds.add(id)
    }
  }
  let planned = unique
  if (hooks?.onPlan || hooks?.onFile) {
    const missing: ModFile[] = []
    for (const file of unique) {
      if (!file.url) continue
      try {
        const stat = await fs.stat(safeJoin(targetDir, file.filename))
        if (stat.isFile() && stat.size > 0) continue
      } catch {
        /* missing */
      }
      missing.push(file)
    }
    planned = missing
    hooks.onPlan?.({
      files: planned.length,
      bytesTotal: planned.reduce((sum, file) => sum + (file.size ?? 0), 0)
    })
  }
  const plannedIndex = new Map(planned.map((file, index) => [file.filename, index]))
  const outcomes = await mapWithConcurrency(
    unique,
    CONTENT_DOWNLOAD_CONCURRENCY,
    async (file): Promise<FileOutcome> => {
      const destination = safeJoin(targetDir, file.filename)
      try {
        const stat = await fs.stat(destination)
        if (stat.isFile() && stat.size > 0) {
          return { kind: 'skipped', file: file.filename }
        }
      } catch {
        /* missing */
      }
      if (!file.url) {
        return {
          kind: 'manual',
          item: { title: file.title, url: file.manualUrl, filename: file.filename }
        }
      }
      const planIndex = plannedIndex.get(file.filename)
      if (planIndex != null) {
        hooks?.onFile?.({
          file: file.filename,
          index: planIndex + 1,
          total: planned.length
        })
      }
      await downloadFile(
        modrinthFileCandidates(file.url, settings.modrinthMirror),
        destination,
        {
          sha1: file.sha1,
          size: file.size,
          segmentMinBytes: CONTENT_SEGMENT_MIN_BYTES,
          probeSources: true,
          signal: hooks?.signal,
          onBytes: hooks?.onBytes
        }
      )
      return { kind: 'installed', title: file.title, file: file.filename }
    }
  )
  const installed: { title: string; file: string }[] = []
  const skipped: string[] = []
  const manual: ManualModDownload[] = []
  for (const outcome of outcomes) {
    if (outcome.kind === 'installed') {
      if (needsDependencyCheck) {
        const destination = safeJoin(targetDir, outcome.file)
        const identity = await readJarModIdentity(destination)
        const file = byFilename.get(outcome.file)
        if (
          file?.dependency &&
          identity &&
          identity.ids.some((id) => installedModIds.has(id))
        ) {
          // 前置已由整合包或已有模组提供；删掉刚下载的重复 jar，保留原文件。
          await fs.rm(destination, { force: true })
          skipped.push(outcome.file)
          continue
        }
        for (const id of identity?.ids ?? []) installedModIds.add(id)
      }
      installed.push({ title: outcome.title, file: outcome.file })
    } else if (outcome.kind === 'skipped') {
      skipped.push(outcome.file)
    } else {
      manual.push(outcome.item)
    }
  }
  return { installed, skipped, manual }
}

function curseForgeFile(
  selection: CurseForgeSelection,
  projectId: string,
  kind: ContentKind
): ModFile {
  return {
    title: selection.title,
    filename: safeContentFilename(
      selection.filename,
      `curseforge-${projectId}${KIND_EXTENSION[kind]}`,
      kind
    ),
    url: selection.url,
    manualUrl: selection.manualUrl,
    sha1: selection.sha1,
    size: selection.size
  }
}

async function curseForgeManualFallback(
  projectId: string,
  settings: LauncherSettings
): Promise<ManualModDownload> {
  try {
    const link = await getCurseForgeProjectLink(projectId, settings)
    return { title: `${link.title}（前置未自动匹配）`, url: link.url }
  } catch {
    return {
      title: `CurseForge 模组 ${projectId}（前置未自动匹配）`,
      url: `https://www.curseforge.com/minecraft/mc-mods/${encodeURIComponent(projectId)}/files`
    }
  }
}

async function collectCurseForgeFiles(
  projectId: string,
  gameVersion: string,
  loader: string,
  settings: LauncherSettings,
  seen: Set<string>,
  depth: number,
  includeDependencies: boolean,
  kind: ContentKind,
  fileId?: string | null
): Promise<{ files: ModFile[]; manual: ManualModDownload[] }> {
  if (seen.has(projectId) || seen.size >= MAX_DEPENDENCIES) {
    return { files: [], manual: [] }
  }
  seen.add(projectId)
  let selection: CurseForgeSelection
  try {
    selection = await pickCurseForgeModFile(
      projectId,
      gameVersion,
      loader,
      settings,
      fileId ?? null,
      kind
    )
  } catch (error) {
    if (depth === 0) throw error
    return { files: [], manual: [await curseForgeManualFallback(projectId, settings)] }
  }
  const files = [curseForgeFile(selection, projectId, kind)]
  if (depth > 0) files[0].dependency = true
  const manual: ManualModDownload[] = []
  if (kind === 'mod' && includeDependencies && depth < 4) {
    for (const dependencyId of selection.dependencies) {
      const key = String(dependencyId)
      if (seen.has(key) || seen.size >= MAX_DEPENDENCIES) continue
      const child = await collectCurseForgeFiles(
        key,
        gameVersion,
        loader,
        settings,
        seen,
        depth + 1,
        includeDependencies,
        kind
      )
      files.push(...child.files)
      manual.push(...child.manual)
    }
  }
  return { files, manual }
}

export async function installMod(
  request: ModInstallRequest,
  settings: LauncherSettings,
  hooks?: InstallProgressHooks
): Promise<ModInstallResult> {
  const kind = request.kind ?? 'mod'
  const includeDependencies = request.includeDependencies !== false
  const instance = await getInstance(request.instanceId)
  if (request.provider === 'curseforge') {
    const resolved = await collectCurseForgeFiles(
      request.projectId,
      instance.gameVersion,
      instance.loader,
      settings,
      new Set(),
      0,
      includeDependencies,
      kind,
      request.versionId ?? null
    )
    if (request.title?.trim() && resolved.files[0]) {
      resolved.files[0] = { ...resolved.files[0], title: request.title.trim() }
    }
    const result = await installFiles(instance.id, resolved.files, settings, kind, hooks)
    result.manual.push(...resolved.manual)
    return result
  }

  let resolved: { files: ModFile[]; manual: ManualModDownload[] }
  if (request.versionId) {
    const version = await modrinthVersion(request.versionId)
    if (!version) throw new Error('模组版本不存在或已下架')
    if (version.project_id && version.project_id !== request.projectId) {
      throw new Error('模组版本与项目不匹配')
    }
    resolved = await collectModrinthVersionFiles(
      version,
      instance.gameVersion,
      instance.loader,
      new Set(),
      0,
      kind,
      includeDependencies
    )
  } else {
    resolved = await resolveModrinthFiles(
      request.projectId,
      instance.gameVersion,
      instance.loader,
      new Set(),
      0,
      kind,
      includeDependencies
    )
  }
  const result = await installFiles(instance.id, resolved.files, settings, kind, hooks)
  result.manual.push(...resolved.manual)
  return result
}

async function downloadModFiles(
  targetDir: string,
  files: ModFile[],
  settings: LauncherSettings
): Promise<{ files: string[]; manual: ManualModDownload[] }> {
  const unique = uniqueFiles(files.slice(0, MAX_DEPENDENCIES))
  const outcomes = await mapWithConcurrency(
    unique,
    CONTENT_DOWNLOAD_CONCURRENCY,
    async (file): Promise<{ file: string | null; manual: ManualModDownload | null }> => {
      if (!file.url) {
        return {
          file: null,
          manual: { title: file.title, url: file.manualUrl, filename: file.filename }
        }
      }
      const destination = safeJoin(targetDir, file.filename)
      await downloadFile(
        modrinthFileCandidates(file.url, settings.modrinthMirror),
        destination,
        {
          sha1: file.sha1,
          size: file.size,
          segmentMinBytes: CONTENT_SEGMENT_MIN_BYTES,
          probeSources: true
        }
      )
      return { file: destination, manual: null }
    }
  )
  return {
    files: outcomes
      .map((outcome) => outcome.file)
      .filter((value): value is string => Boolean(value)),
    manual: outcomes
      .map((outcome) => outcome.manual)
      .filter((value): value is ManualModDownload => Boolean(value))
  }
}

export async function downloadModPackage(
  request: ModDownloadRequest,
  settings: LauncherSettings
): Promise<ModDownloadResult> {
  if (!/^[A-Za-z0-9._+\-]{1,64}$/.test(request.gameVersion)) {
    throw new Error('无效的 Minecraft 版本')
  }
  const kind = request.kind ?? 'mod'
  const includeDependencies = request.includeDependencies !== false
  const targetDir = join(getConfigDir(), 'downloads', KIND_FOLDER[kind])
  await fs.mkdir(targetDir, { recursive: true })

  if (request.provider === 'curseforge') {
    const resolved = await collectCurseForgeFiles(
      request.projectId,
      request.gameVersion,
      request.loader,
      settings,
      new Set(),
      0,
      includeDependencies,
      kind,
      request.versionId ?? null
    )
    const result = await downloadModFiles(targetDir, resolved.files, settings)
    return {
      file: result.files[0] ?? null,
      files: result.files,
      manual: [...resolved.manual, ...result.manual]
    }
  }

  let resolved: { files: ModFile[]; manual: ManualModDownload[] }
  if (request.versionId) {
    const version = await modrinthVersion(request.versionId)
    if (!version) throw new Error('模组版本不存在或已下架')
    if (version.project_id && version.project_id !== request.projectId) {
      throw new Error('模组版本与项目不匹配')
    }
    resolved = await collectModrinthVersionFiles(
      version,
      request.gameVersion,
      request.loader,
      new Set(),
      0,
      kind,
      includeDependencies
    )
  } else {
    resolved = await resolveModrinthFiles(
      request.projectId,
      request.gameVersion,
      request.loader,
      new Set(),
      0,
      kind,
      includeDependencies
    )
  }
  if (resolved.files.length === 0) {
    return {
      file: null,
      files: [],
      manual: [
        {
          title: '未能自动匹配内容版本',
          url: `https://modrinth.com/${KIND_PROJECT_TYPE[kind]}/${encodeURIComponent(request.projectId)}`
        },
        ...resolved.manual
      ]
    }
  }
  const result = await downloadModFiles(targetDir, resolved.files, settings)
  return {
    file: result.files[0] ?? null,
    files: result.files,
    manual: [...resolved.manual, ...result.manual]
  }
}

export async function listInstalledMods(instanceId: string): Promise<InstalledModView[]> {
  const dir = await modsDir(instanceId)
  let entries: string[] = []
  try {
    entries = await fs.readdir(dir)
  } catch {
    return []
  }
  const result: InstalledModView[] = []
  for (const entry of entries) {
    const enabled = entry.toLowerCase().endsWith('.jar')
    const disabled = entry.toLowerCase().endsWith('.jar.disabled')
    if (!enabled && !disabled) continue
    try {
      const stat = await fs.stat(join(dir, entry))
      if (!stat.isFile()) continue
      result.push({ file: entry, size: stat.size, enabled })
    } catch {
      /* ignore */
    }
  }
  result.sort((a, b) => a.file.localeCompare(b.file))
  return result
}

export async function removeMod(instanceId: string, file: string): Promise<InstalledModView[]> {
  const target = safeJoin(await modsDir(instanceId), basename(file))
  await fs.rm(target, { force: true })
  return listInstalledMods(instanceId)
}

export async function toggleMod(
  instanceId: string,
  file: string,
  enabled: boolean
): Promise<InstalledModView[]> {
  const dir = await modsDir(instanceId)
  const name = basename(file)
  const current = safeJoin(dir, name)
  if (enabled && name.toLowerCase().endsWith('.jar.disabled')) {
    const next = safeJoin(dir, name.slice(0, -'.disabled'.length))
    await fs.rename(current, next).catch(() => undefined)
  } else if (!enabled && name.toLowerCase().endsWith('.jar')) {
    const next = safeJoin(dir, `${name}.disabled`)
    await fs.rename(current, next).catch(() => undefined)
  }
  return listInstalledMods(instanceId)
}

export async function importModFiles(
  instanceId: string,
  files: string[]
): Promise<InstalledModView[]> {
  const dir = await modsDir(instanceId)
  await fs.mkdir(dir, { recursive: true })
  for (const file of files) {
    if (!file.toLowerCase().endsWith('.jar')) continue
    const name = safeFilename(basename(file), 'imported-mod.jar')
    await fs.copyFile(file, safeJoin(dir, name))
  }
  return listInstalledMods(instanceId)
}
