import { net } from 'electron'
import type {
  ContentKind,
  CurseForgeModpackFileScope,
  LauncherSettings,
  ModpackVersionView,
  ModDependencyView,
  ModProjectView,
  ModSearchView,
  ModVersionView,
  ModrinthProjectView,
  ModrinthSearchView
} from '../../shared/types'
import { USER_AGENT } from './net'
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

const GAME_ID = 432
const MOD_CLASS_ID = 6
const TEXTURE_PACK_CLASS_ID = 12
const SHADER_CLASS_ID = 6552
const DATA_PACK_CLASS_ID = 6945

function classIdOf(kind: ContentKind): number {
  if (kind === 'resourcepack') return TEXTURE_PACK_CLASS_ID
  if (kind === 'shader') return SHADER_CLASS_ID
  if (kind === 'datapack') return DATA_PACK_CLASS_ID
  return MOD_CLASS_ID
}
const MODPACK_CLASS_ID = 4471
const PAGE_SIZE = 20

function containsCjk(value: string): boolean {
  return /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/u.test(value)
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
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
        results[index] = await worker(items[index])
      }
    }
  )
  await Promise.all(runners)
  return results
}

interface CfMod {
  id?: number
  slug?: string
  name?: string
  classId?: number
  summary?: string
  downloadCount?: number
  logo?: { url?: string }
  authors?: { name?: string }[]
  categories?: { name?: string }[]
  links?: { websiteUrl?: string }
  latestFilesIndexes?: { gameVersion?: string; modLoader?: number }[]
}

interface CfFile {
  id?: number
  modId?: number
  displayName?: string
  fileName?: string
  releaseType?: number
  fileDate?: string
  fileLength?: number
  downloadCount?: number
  downloadUrl?: string | null
  gameVersions?: string[]
  fileFingerprint?: number
  changelog?: string | null
  hashes?: { value?: string; algo?: number }[]
  dependencies?: { modId?: number; relationType?: number }[]
  /** CurseForge 会在服务端包文件上标记 true；客户端整合包为 false。 */
  isServerPack?: boolean
  serverPackFileId?: number | null
  alternateFileId?: number | null
}

interface CfFingerprintMatch {
  id?: number
  file?: CfFile
  latestFiles?: CfFile[]
}

interface CfSearchResponse {
  data?: CfMod[]
  pagination?: { totalCount?: number; index?: number }
}

interface CfFilesResponse {
  data?: CfFile[]
  pagination?: { totalCount?: number; index?: number }
}

export interface CurseForgeSelection {
  title: string
  filename: string
  url: string | null
  manualUrl: string
  sha1: string | null
  size: number | null
  fileId: string
  versionNumber: string
  dependencies: number[]
}

export interface CurseForgeFileInfo extends CurseForgeSelection {
  fileId: string
  projectId: string
  gameVersions: string[]
  releaseType: number
  fileDate: string | null
  isServerPack: boolean
}

export interface CurseForgeManifestFile {
  filename: string
  url: string | null
  manualUrl: string
  sha1: string | null
  size: number | null
}

/**
 * 整合包清单解析用的轻量查询：正常文件只请求一次文件接口；
 * 只有作者关闭第三方下载时才补一次项目信息，用来拼出正确的网页地址。
 */
export async function resolveCurseForgeManifestFile(
  projectId: string,
  fileId: string,
  settings: LauncherSettings
): Promise<CurseForgeManifestFile> {
  const raw = await cfFetch<{ data?: CfFile }>(
    `${apiBase(settings)}/v1/mods/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}`,
    settings
  )
  const file = raw.data
  if (!file?.id || !file.fileName) {
    throw new Error(`CurseForge 没有找到文件 ${projectId}/${fileId}`)
  }
  const directUrl =
    httpUrl(file.downloadUrl) ??
    (settings.curseForgeCompatDownloads
      ? curseForgeCdnUrl(String(file.id), file.fileName)
      : null)
  let slug = projectId
  if (!directUrl) {
    try {
      const project = await cfProject(projectId, settings)
      slug = project.slug ?? projectId
    } catch {
      /* keep numeric id */
    }
  }
  return {
    filename: file.fileName,
    url: directUrl,
    manualUrl: `https://www.curseforge.com/minecraft/mc-mods/${slug}/files/${file.id}`,
    sha1: fileSha1(file),
    size: typeof file.fileLength === 'number' ? file.fileLength : null
  }
}

function loaderType(loader: string): number | null {
  const value = loader.toLowerCase()
  if (value === 'forge') return 1
  if (value === 'fabric') return 4
  if (value === 'quilt') return 5
  if (value === 'neoforge') return 6
  return null
}

function httpUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

const CURSEFORGE_MIRROR = 'https://mod.mcimirror.top/curseforge'

function apiBase(settings: LauncherSettings): string {
  if (settings.curseForgeUseMirror) return CURSEFORGE_MIRROR
  return (settings.curseForgeApiBase || 'https://api.curseforge.com').replace(/\/+$/, '')
}

async function cfRequest<T>(
  url: string,
  settings: LauncherSettings,
  init: RequestInit = {}
): Promise<T> {
  const key = settings.curseForgeApiKey.trim()
  const mirror = settings.curseForgeUseMirror || /mcimirror.top/i.test(url)
  if (!key && !mirror) {
    throw new Error('请先在设置中填写 CurseForge API key（console.curseforge.com 免费申请）')
  }
  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
        ...(init.headers ?? {}),
        ...(key && !mirror ? { 'x-api-key': key } : {})
      },
      signal: AbortSignal.timeout(20_000)
    })
  } catch {
    throw new Error('无法连接 CurseForge API，请检查网络或自定义 API 地址')
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error('CurseForge API key 无效或已被限流')
  }
  if (!response.ok) {
    let detail = ''
    try {
      detail = (await response.text()).slice(0, 300)
    } catch {
      /* ignore */
    }
    throw new Error(
      `CurseForge API 返回 HTTP ${response.status}${detail ? `：${detail}` : ''}`
    )
  }
  try {
    return (await response.json()) as T
  } catch {
    throw new Error('CurseForge 返回了无法解析的数据')
  }
}

async function cfFetch<T>(url: string, settings: LauncherSettings): Promise<T> {
  return cfRequest<T>(url, settings)
}

async function cfPost<T>(
  url: string,
  body: unknown,
  settings: LauncherSettings
): Promise<T> {
  return cfRequest<T>(url, settings, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
}

function mapMod(mod: CfMod): ModProjectView | null {
  if (!mod.id || !mod.slug || !mod.name) return null
  const gameVersions = [
    ...new Set(
      (mod.latestFilesIndexes ?? [])
        .map((entry) => entry.gameVersion)
        .filter((value): value is string => Boolean(value))
    )
  ]
  return {
    provider: 'curseforge',
    projectId: String(mod.id),
    slug: mod.slug,
    title: mod.name.slice(0, 160),
    description: (mod.summary ?? '').slice(0, 600),
    author: mod.authors?.[0]?.name ?? 'CurseForge',
    iconUrl: httpUrl(mod.logo?.url),
    downloads: typeof mod.downloadCount === 'number' ? mod.downloadCount : 0,
    categories: (mod.categories ?? []).map((entry) => entry.name ?? '').filter(Boolean).slice(0, 8),
    gameVersions
  }
}

async function curseForgeProjectBySlug(
  slug: string,
  classId: number,
  gameVersion: string,
  loader: string,
  settings: LauncherSettings
): Promise<CfMod | null> {
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(slug)) return null
  const params = new URLSearchParams({
    gameId: String(GAME_ID),
    classId: String(classId),
    index: '0',
    pageSize: '5',
    sortField: '2',
    sortOrder: 'desc',
    slug
  })
  try {
    const raw = await cfFetch<CfSearchResponse>(
      `${apiBase(settings)}/v1/mods/search?${params.toString()}`,
      settings
    )
    const project =
      (raw.data ?? []).find(
        (mod) => mod.slug?.toLowerCase() === slug.toLowerCase()
      ) ?? null
    if (!project) return null
    const indexes = project.latestFilesIndexes ?? []
    if (indexes.length > 0 && (gameVersion || loader)) {
      const type = loader ? loaderType(loader) : null
      const compatible = indexes.some(
        (entry) =>
          (!gameVersion || entry.gameVersion === gameVersion) &&
          (type === null || entry.modLoader === type)
      )
      if (!compatible) return null
    }
    return project
  } catch {
    return null
  }
}

async function applyCurseForgePins(
  hits: ModProjectView[],
  expansion: SearchQueryExpansion,
  gameVersion: string,
  loader: string,
  settings: LauncherSettings
): Promise<ModProjectView[]> {
  const slugs = preferredSlugsFor(expansion, 'curseforge').slice(0, 20)
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
      const project = await curseForgeProjectBySlug(
        slug,
        MOD_CLASS_ID,
        gameVersion,
        loader,
        settings
      )
      return project ? mapMod(project) : null
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
    ordered.push(
      localized
        ? { ...project, localizedName: localized }
        : {
            ...project,
            localizedName: localizedNameFor(project.slug, project.title, 'mod')
          }
    )
  }
  const rest = hits.filter(
    (hit) =>
      !usedSlugs.has(hit.slug.toLowerCase()) && !usedIds.has(hit.projectId)
  )
  return [...ordered, ...rest]
}

export async function searchCurseForgeMods(
  query: string,
  gameVersion: string,
  loader: string,
  offset: number,
  settings: LauncherSettings,
  kind: ContentKind = 'mod'
): Promise<ModSearchView> {
  const safeOffset = Number.isFinite(offset) ? Math.max(0, Math.round(offset)) : 0
  if (kind === 'mod') {
    let local = findLocalAliasMatches(
      query,
      'curseforge',
      safeOffset,
      20,
      loader,
      'mod'
    )
    if (local.total === 0) {
      local = findPinyinAliasMatches(query, 'curseforge', safeOffset, 20, loader, 'mod')
    }
    if (local.total > 0) {
      const projects = await mapWithConcurrency(
        local.slugs,
        4,
        async (slug) => {
          const project = await curseForgeProjectBySlug(
            slug,
            MOD_CLASS_ID,
            gameVersion,
            loader,
            settings
          )
          return project ? mapMod(project) : null
        }
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
  // CurseForge 对中日韩搜索词不会真正过滤，而是回退成热门列表（10000 条噪声）。
  // 没有解析出英文查询词时跳过 API 搜索；如果本地索引有多条候选，
  // 仍会把它们逐个置顶（如「通用」→ 通用机械 / 通用拼音搜索）。
  const skipApi = !expansion.translated && containsCjk(query)
  const fetchPage = async (searchText: string): Promise<CfSearchResponse> => {
    const params = new URLSearchParams({
      gameId: String(GAME_ID),
      classId: String(classIdOf(kind)),
      index: String(safeOffset),
      pageSize: String(PAGE_SIZE),
      sortField: '2',
      sortOrder: 'desc',
      searchFilter: searchText.trim().slice(0, 100)
    })
    if (gameVersion) params.set('gameVersion', gameVersion)
    const type = kind === 'mod' ? loaderType(loader) : null
    if (type !== null) params.set('modLoaderType', String(type))
    return cfFetch<CfSearchResponse>(
      `${apiBase(settings)}/v1/mods/search?${params.toString()}`,
      settings
    )
  }
  let raw: CfSearchResponse = skipApi
    ? { data: [], pagination: { totalCount: 0, index: safeOffset } }
    : await fetchPage(expansion.query)
  if (
    !skipApi &&
    safeOffset === 0 &&
    expansion.translated &&
    !containsCjk(expansion.original) &&
    (raw.data ?? []).length === 0
  ) {
    raw = await fetchPage(expansion.original)
  }
  let hits: ModProjectView[] = (raw.data ?? [])
    .map(mapMod)
    .filter((hit): hit is ModProjectView => Boolean(hit))
    .map((hit) => ({
      ...hit,
      localizedName:
        kind === 'mod'
          ? localizedNameFromExpansion(expansion, hit.slug) ??
            localizedNameFor(hit.slug, hit.title, 'mod')
          : null
    }))
  let totalHits = raw.pagination?.totalCount ?? hits.length
  if (safeOffset === 0 && kind === 'mod') {
    hits = await applyCurseForgePins(
      hits,
      expansion,
      gameVersion,
      loader,
      settings
    )
  }
  return {
    hits: prioritizeSearchHits(hits, expansion, safeOffset, 'curseforge'),
    totalHits: Math.max(totalHits, hits.length),
    offset: raw.pagination?.index ?? safeOffset,
    nextOffset: safeOffset + 20
  }
}

function mapCfPack(mod: CfMod): ModrinthProjectView | null {
  if (!mod.id || !mod.slug || !mod.name) return null
  return {
    provider: 'curseforge',
    projectId: String(mod.id),
    slug: mod.slug,
    title: mod.name.slice(0, 160),
    localizedName: localizedNameFor(mod.slug, mod.name, 'modpack'),
    description: (mod.summary ?? '').slice(0, 600),
    author: mod.authors?.[0]?.name ?? 'CurseForge',
    iconUrl: httpUrl(mod.logo?.url),
    downloads: typeof mod.downloadCount === 'number' ? mod.downloadCount : 0,
    categories: (mod.categories ?? [])
      .map((entry) => entry.name ?? '')
      .filter(Boolean)
      .slice(0, 8),
    gameVersions: [
      ...new Set(
        (mod.latestFilesIndexes ?? [])
          .map((entry) => entry.gameVersion)
          .filter((value): value is string => Boolean(value))
      )
    ],
    latestVersion: null
  }
}

export async function searchCurseForgeModpacks(
  query: string,
  gameVersion: string,
  loader: string,
  offset: number,
  settings: LauncherSettings
): Promise<ModrinthSearchView> {
  const safeOffset = Number.isFinite(offset) ? Math.max(0, Math.round(offset)) : 0
  const expansion = expandSearchQuery(query, 'modpack', loader)
  if (!expansion.translated && containsCjk(query)) {
    return { hits: [], totalHits: 0, offset: safeOffset }
  }
  const fetchPage = async (searchText: string): Promise<CfSearchResponse> => {
    const params = new URLSearchParams({
      gameId: String(GAME_ID),
      classId: String(MODPACK_CLASS_ID),
      index: String(safeOffset),
      pageSize: String(PAGE_SIZE),
      sortField: '2',
      sortOrder: 'desc',
      searchFilter: searchText.trim().slice(0, 100)
    })
    if (gameVersion) params.set('gameVersion', gameVersion)
    const type = loaderType(loader)
    if (type !== null) params.set('modLoaderType', String(type))
    return cfFetch<CfSearchResponse>(
      `${apiBase(settings)}/v1/mods/search?${params.toString()}`,
      settings
    )
  }
  let raw = await fetchPage(expansion.query)
  if (
    safeOffset === 0 &&
    expansion.translated &&
    !containsCjk(expansion.original) &&
    (raw.data ?? []).length === 0
  ) {
    raw = await fetchPage(expansion.original)
  }
  let hits = (raw.data ?? [])
    .map(mapCfPack)
    .filter((hit): hit is ModrinthProjectView => Boolean(hit))
  let totalHits = raw.pagination?.totalCount ?? hits.length
  if (
    safeOffset === 0 &&
    expansion.preferredSlugs.length > 0 &&
    !hits.some((hit) => hit.slug.toLowerCase() === expansion.preferredSlugs[0].toLowerCase())
  ) {
    const project = await curseForgeProjectBySlug(
      expansion.preferredSlugs[0],
      MODPACK_CLASS_ID,
      gameVersion,
      loader,
      settings
    )
    const pinned = project ? mapCfPack(project) : null
    if (pinned) {
      hits = [pinned, ...hits]
      totalHits = Math.max(totalHits, hits.length)
    }
  }
  return {
    hits: prioritizeSearchHits(hits, expansion, safeOffset),
    totalHits: Math.max(totalHits, hits.length),
    offset: raw.pagination?.index ?? safeOffset,
    nextOffset: safeOffset + 20
  }
}

function isServerPackFile(file: CfFile): boolean {
  if (typeof file.isServerPack === 'boolean') return file.isServerPack
  // 旧镜像可能没有 isServerPack 字段，再用文件名兜底；客户端包正常不会叫 ServerFiles/ServerPack。
  return /(?:^|[-_.\s])server(?:files?|pack)(?:$|[-_.\s])/i.test(
    `${file.fileName ?? ''} ${file.displayName ?? ''}`
  )
}

export interface CurseForgeWebFile {
  id: string
  fileName: string
  displayName: string
  size: number | null
  date: string | null
  releaseType: number
  isClientCompatible: boolean | null
  gameVersions: string[]
  loaders: string[]
}

interface WebFileCacheEntry {
  at: number
  value: CurseForgeWebFile | null
}

const webFileCache = new Map<string, WebFileCacheEntry>()
const WEB_FILE_TTL = 30 * 60_000
const WEB_FILE_FAIL_TTL = 2 * 60_000
const WEB_FILE_MAX_FETCH = 20

function parseCurseForgeFilePage(html: string, fileId: string): CurseForgeWebFile | null {
  const escapedMarker = `\\"file\\":{\\"id\\":${fileId},`
  const plainMarker = `"file":{"id":${fileId},`
  let start = html.indexOf(escapedMarker)
  let escaped = true
  if (start < 0) {
    start = html.indexOf(plainMarker)
    escaped = false
  }
  if (start < 0) return null
  const brace = html.indexOf('{', start)
  if (brace < 0) return null
  // 文件对象后面紧跟 "children"；从这里回退到最近的 }，比手写大括号扫描更稳。
  const childMarker = escaped ? '\\"children\\"' : '"children"'
  const childIndex = html.indexOf(childMarker, brace)
  if (childIndex < 0) return null
  const end = html.lastIndexOf('}', childIndex)
  if (end < brace) return null
  const raw = html.slice(brace, end + 1)
  let objectText = raw
  if (escaped) {
    try {
      objectText = JSON.parse(`"${raw}"`) as string
    } catch {
      return null
    }
  }
  let parsed: {
    id?: unknown
    fileName?: unknown
    displayName?: unknown
    fileLength?: unknown
    dateCreated?: unknown
    releaseType?: unknown
    isClientCompatible?: unknown
    gameVersions?: unknown
    flavor?: { name?: unknown } | null
    flavors?: { name?: unknown }[]
  }
  try {
    parsed = JSON.parse(objectText) as typeof parsed
  } catch {
    return null
  }
  if (String(parsed.id ?? '') !== String(fileId)) return null
  const fileName = typeof parsed.fileName === 'string' ? parsed.fileName.trim() : ''
  if (!fileName) return null
  const gameVersions = Array.isArray(parsed.gameVersions)
    ? parsed.gameVersions.filter(
        (value): value is string => typeof value === 'string' && /^\d+\.\d+(?:\.\d+)?$/.test(value)
      )
    : []
  const flavorNames = [
    ...(Array.isArray(parsed.flavors) ? parsed.flavors : []),
    ...(parsed.flavor ? [parsed.flavor] : [])
  ]
    .map((entry) => (typeof entry?.name === 'string' ? entry.name.toLowerCase() : ''))
    .filter((value) => ['forge', 'fabric', 'quilt', 'neoforge'].includes(value))
  return {
    id: String(parsed.id),
    fileName,
    displayName:
      typeof parsed.displayName === 'string' && parsed.displayName.trim()
        ? parsed.displayName.trim()
        : fileName,
    size:
      typeof parsed.fileLength === 'number' && Number.isFinite(parsed.fileLength)
        ? parsed.fileLength
        : null,
    date: typeof parsed.dateCreated === 'string' ? parsed.dateCreated : null,
    releaseType: typeof parsed.releaseType === 'number' ? parsed.releaseType : 1,
    isClientCompatible:
      typeof parsed.isClientCompatible === 'boolean' ? parsed.isClientCompatible : null,
    gameVersions,
    loaders: [...new Set(flavorNames)]
  }
}

function pruneWebFileCache(): void {
  if (webFileCache.size <= 120) return
  const entries = [...webFileCache.entries()].sort((a, b) => a[1].at - b[1].at)
  for (const [key] of entries.slice(0, webFileCache.size - 100)) webFileCache.delete(key)
}

async function fetchCurseForgeFilePage(
  slug: string,
  fileId: string
): Promise<CurseForgeWebFile | null> {
  const key = `${slug}:${fileId}`
  const cached = webFileCache.get(key)
  if (cached && Date.now() - cached.at < (cached.value ? WEB_FILE_TTL : WEB_FILE_FAIL_TTL)) {
    return cached.value
  }
  let value: CurseForgeWebFile | null = null
  try {
    const url = `https://www.curseforge.com/minecraft/modpacks/${encodeURIComponent(slug)}/files/${encodeURIComponent(fileId)}`
    const response = await net.fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
      },
      signal: AbortSignal.timeout(8_000)
    })
    if (response.ok) {
      const html = await response.text()
      if (html.length <= 2 * 1024 * 1024) value = parseCurseForgeFilePage(html, fileId)
    }
  } catch {
    value = null
  }
  webFileCache.set(key, { at: Date.now(), value })
  pruneWebFileCache()
  return value
}

/**
 * CurseForge 的 API 文件列表不包含 “Additional Files / Server Packs”。
 * 这些文件只通过客户端文件的 serverPackFileId/alternateFileId 关联，
 * 元数据需要从 CurseForge 的公开文件页读取；这里只在服务端包列表/下载时使用，
 * 有缓存和数量限制，避免频繁请求网页。
 */
export async function getCurseForgeServerPackWebFile(
  projectId: string,
  fileId: string,
  settings: LauncherSettings,
  slugOverride?: string | null
): Promise<CurseForgeWebFile | null> {
  let slug = slugOverride?.trim() || null
  if (!slug) {
    try {
      const project = await cfProject(projectId, settings)
      slug = project.slug ?? null
    } catch {
      return null
    }
  }
  if (!slug) return null
  return fetchCurseForgeFilePage(slug, fileId)
}


function mapCurseForgeModpackFile(file: CfFile): ModpackVersionView {
  const gameVersions = (file.gameVersions ?? []).filter((value) =>
    /^\d+\.\d+(?:\.\d+)?$/.test(value)
  )
  const loaders = [
    ...new Set(
      (file.gameVersions ?? [])
        .filter((value) =>
          ['forge', 'fabric', 'quilt', 'neoforge'].includes(value.toLowerCase())
        )
        .map((value) => value.toLowerCase())
    )
  ]
  const versionType =
    file.releaseType === 2 ? 'beta' : file.releaseType === 3 ? 'alpha' : 'release'
  return {
    id: String(file.id),
    name: (file.displayName ?? file.fileName ?? '').slice(0, 160),
    versionNumber: (file.displayName ?? file.fileName ?? '').slice(0, 120),
    versionType,
    gameVersion: gameVersions[gameVersions.length - 1] ?? '',
    loaders,
    datePublished: file.fileDate ?? '',
    fileSize: typeof file.fileLength === 'number' ? file.fileLength : null
  }
}

export async function listCurseForgeModpackVersions(
  projectId: string,
  settings: LauncherSettings,
  scope: CurseForgeModpackFileScope = 'client'
): Promise<ModpackVersionView[]> {
  const pageSize = 50
  const maxPages = scope === 'server' ? 8 : 1
  const files: CfFile[] = []
  for (let page = 0; page < maxPages; page += 1) {
    const raw = await cfFetch<CfFilesResponse>(
      `${apiBase(settings)}/v1/mods/${encodeURIComponent(projectId)}/files?pageSize=${pageSize}&index=${page * pageSize}`,
      settings
    )
    const data = raw.data ?? []
    files.push(...data)
    const total = raw.pagination?.totalCount
    if (
      data.length < pageSize ||
      (typeof total === 'number' && files.length >= total)
    ) {
      break
    }
  }
  const versions = files
    .filter(
      (file): file is CfFile & { id: number; fileName: string } =>
        Boolean(file.id && file.fileName && isServerPackFile(file) === (scope === 'server'))
    )
    .map(mapCurseForgeModpackFile)

  if (scope === 'server') {
    let slug: string | null = null
    try {
      slug = (await cfProject(projectId, settings)).slug ?? null
    } catch {
      slug = null
    }
    const listedIds = new Set(files.map((file) => String(file.id ?? '')))
    const candidates = new Map<string, { client: CfFile; fromServerId: boolean }>()
    for (const file of files) {
      if (!file.id || isServerPackFile(file)) continue
      for (const rawId of [file.serverPackFileId, file.alternateFileId]) {
        if (typeof rawId !== 'number' || !Number.isSafeInteger(rawId) || rawId <= 0) continue
        const id = String(rawId)
        if (id === String(file.id) || listedIds.has(id)) continue
        const existing = candidates.get(id)
        if (existing) {
          if (rawId === file.serverPackFileId) existing.fromServerId = true
          continue
        }
        candidates.set(id, { client: file, fromServerId: rawId === file.serverPackFileId })
      }
    }
    const ordered = [...candidates.entries()]
      .sort(
        (a, b) =>
          Date.parse(b[1].client.fileDate ?? '') - Date.parse(a[1].client.fileDate ?? '')
      )
      .slice(0, WEB_FILE_MAX_FETCH)
    if (slug && ordered.length > 0) {
      const webViews = await mapWithConcurrency(
        ordered,
        4,
        async ([fileId, { client, fromServerId }]) => {
          const web = await getCurseForgeServerPackWebFile(
            projectId,
            fileId,
            settings,
            slug
          )
          if (!web || web.isClientCompatible === true) return null
          const serverish =
            web.isClientCompatible === false ||
            /(?:^|[-_.\s])server(?:files?|pack)(?:$|[-_.\s])/i.test(
              `${web.fileName} ${web.displayName}`
            )
          if (!serverish && !fromServerId) return null
          const clientGameVersions = (client.gameVersions ?? []).filter((value) =>
            /^\d+\.\d+(?:\.\d+)?$/.test(value)
          )
          const clientLoaders = [
            ...new Set(
              (client.gameVersions ?? [])
                .filter((value) =>
                  ['forge', 'fabric', 'quilt', 'neoforge'].includes(value.toLowerCase())
                )
                .map((value) => value.toLowerCase())
            )
          ]
          const gameVersions = web.gameVersions.length
            ? web.gameVersions
            : clientGameVersions
          const loaders = web.loaders.length ? web.loaders : clientLoaders
          const versionType =
            web.releaseType === 2 ? 'beta' : web.releaseType === 3 ? 'alpha' : 'release'
          return {
            id: web.id,
            name: web.displayName.slice(0, 160),
            versionNumber: web.displayName.slice(0, 120),
            versionType,
            gameVersion: gameVersions[gameVersions.length - 1] ?? '',
            loaders,
            datePublished: web.date ?? client.fileDate ?? '',
            fileSize: web.size
          } satisfies ModpackVersionView
        }
      )
      for (const view of webViews) if (view) versions.push(view)
    }
  }

  const unique = new Map(versions.map((version) => [version.id, version]))
  return [...unique.values()].sort(
    (a, b) => Date.parse(b.datePublished) - Date.parse(a.datePublished)
  )
}

export async function getCurseForgeFileInfo(
  projectId: string,
  fileId: string,
  settings: LauncherSettings,
  options: { allowServerPack?: boolean } = {}
): Promise<CurseForgeFileInfo> {
  let file: CfFile | null = null
  try {
    const raw = await cfFetch<{ data?: CfFile }>(
      `${apiBase(settings)}/v1/mods/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}`,
      settings
    )
    file = raw.data ?? null
  } catch {
    file = null
  }
  const project = await cfProject(projectId, settings)
  if (!file) {
    const raw = await cfFetch<CfFilesResponse>(
      `${apiBase(settings)}/v1/mods/${encodeURIComponent(projectId)}/files?pageSize=50`,
      settings
    )
    file =
      (raw.data ?? []).find((entry) => String(entry.id) === String(fileId)) ?? null
  }
  if (!file?.id || !file.fileName) {
    throw new Error('CurseForge 没有找到所选整合包文件')
  }
  const isServerPack = isServerPackFile(file)
  if (isServerPack && !options.allowServerPack) {
    throw new Error(
      '这是 CurseForge 的服务端包（ServerFiles），不能作为客户端整合包安装。请返回版本列表，选择不带 ServerFiles 的客户端版本。'
    )
  }
  return {
    ...buildSelection(project, file, settings.curseForgeCompatDownloads),
    fileId: String(file.id),
    projectId,
    gameVersions: file.gameVersions ?? [],
    releaseType: typeof file.releaseType === 'number' ? file.releaseType : 1,
    fileDate: typeof file.fileDate === 'string' ? file.fileDate : null,
    isServerPack
  }
}

async function cfProject(projectId: string, settings: LauncherSettings): Promise<CfMod> {
  const raw = await cfFetch<{ data?: CfMod }>(
    `${apiBase(settings)}/v1/mods/${encodeURIComponent(projectId)}`,
    settings
  )
  if (!raw.data?.id) throw new Error('CurseForge 项目不存在')
  return raw.data
}

function fileSha1(file: CfFile): string | null {
  return (
    file.hashes
      ?.find((hash) => hash.algo === 1 && typeof hash.value === 'string')
      ?.value?.toLowerCase() ?? null
  )
}

export function curseForgeCdnUrl(fileId: string, filename: string): string | null {
  if (!/^\d{1,15}$/.test(fileId) || !filename) return null
  const id = Number(fileId)
  if (!Number.isSafeInteger(id) || id <= 0) return null
  return `https://mediafilez.forgecdn.net/files/${Math.floor(id / 1000)}/${id % 1000}/${encodeURIComponent(filename)}`
}

function buildSelection(
  project: CfMod,
  file: CfFile,
  compatDownloads = false
): CurseForgeSelection {
  const slug = project.slug ?? String(project.id)
  const filename = file.fileName ?? `curseforge-${file.id}.jar`
  const section = project.classId === MODPACK_CLASS_ID ? 'modpacks' : 'mc-mods'
  return {
    title: (project.name ?? file.displayName ?? file.fileName ?? 'CurseForge 模组').slice(0, 160),
    filename,
    url:
      httpUrl(file.downloadUrl) ??
      (compatDownloads ? curseForgeCdnUrl(String(file.id ?? ''), filename) : null),
    manualUrl: `https://www.curseforge.com/minecraft/${section}/${slug}/files/${file.id}`,
    sha1: fileSha1(file),
    size: typeof file.fileLength === 'number' ? file.fileLength : null,
    fileId: String(file.id ?? ''),
    versionNumber: (file.displayName ?? file.fileName ?? '').slice(0, 160),
    dependencies: (file.dependencies ?? [])
      .filter((dep) => dep.relationType === 3 && typeof dep.modId === 'number')
      .map((dep) => dep.modId as number)
  }
}

function dependType(relation: number | undefined): ModDependencyView['type'] {
  if (relation === 3) return 'required'
  if (relation === 5) return 'incompatible'
  if (relation === 1) return 'embedded'
  return 'optional'
}

function isGameVersion(value: string): boolean {
  return /^\d+\.\d+(?:\.\d+)?$/.test(value)
}

function isLoader(value: string): boolean {
  return ['forge', 'fabric', 'quilt', 'neoforge'].includes(value.toLowerCase())
}

export async function listCurseForgeModVersions(
  projectId: string,
  settings: LauncherSettings
): Promise<ModVersionView[]> {
  const project = await cfProject(projectId, settings)
  const raw = await cfFetch<CfFilesResponse>(
    `${apiBase(settings)}/v1/mods/${encodeURIComponent(projectId)}/files?pageSize=50`,
    settings
  )
  const files = (raw.data ?? []).filter(
    (file): file is CfFile & { id: number; fileName: string } => Boolean(file.id && file.fileName)
  )
  const dependencyIds = [
    ...new Set(
      files.flatMap((file) =>
        (file.dependencies ?? [])
          .filter((dep) => dep.relationType === 3 && typeof dep.modId === 'number')
          .map((dep) => dep.modId as number)
      )
    )
  ].slice(0, 12)
  const dependencyMeta = new Map<number, CfMod>()
  await Promise.all(
    dependencyIds.map(async (id) => {
      try {
        dependencyMeta.set(id, await cfProject(String(id), settings))
      } catch {
        /* 单个依赖元数据失败不影响版本列表 */
      }
    })
  )

  const versions = files.map((file) => {
    const gameVersions = [
      ...new Set((file.gameVersions ?? []).filter(isGameVersion))
    ]
    const loaders = [
      ...new Set(
        (file.gameVersions ?? [])
          .filter(isLoader)
          .map((value) => value.toLowerCase())
      )
    ]
    const dependencies: ModDependencyView[] = []
    const seen = new Set<number>()
    for (const dep of file.dependencies ?? []) {
      if (typeof dep.modId !== 'number' || seen.has(dep.modId)) continue
      seen.add(dep.modId)
      const meta = dependencyMeta.get(dep.modId)
      dependencies.push({
        provider: 'curseforge',
        projectId: String(dep.modId),
        title: meta?.name?.slice(0, 80) ?? `CurseForge 模组 ${dep.modId}`,
        iconUrl: httpUrl(meta?.logo?.url),
        type: dependType(dep.relationType)
      })
    }
    const releaseType =
      file.releaseType === 2 ? 'beta' : file.releaseType === 3 ? 'alpha' : 'release'
    return {
      id: String(file.id),
      name: (file.displayName ?? file.fileName).slice(0, 160),
      versionNumber: (file.displayName ?? file.fileName).slice(0, 120),
      versionType: releaseType,
      gameVersions,
      loaders,
      filename: file.fileName,
      fileSize: typeof file.fileLength === 'number' ? file.fileLength : null,
      downloads: typeof file.downloadCount === 'number' ? file.downloadCount : 0,
      datePublished: file.fileDate ?? '',
      dependencies
    }
  })
  versions.sort((a, b) => Date.parse(b.datePublished) - Date.parse(a.datePublished))
  return versions
}

export interface CurseForgeProjectLink {
  title: string
  url: string
}

export async function getCurseForgeProjectLink(
  projectId: string,
  settings: LauncherSettings
): Promise<CurseForgeProjectLink> {
  const project = await cfProject(projectId, settings)
  const slug = project.slug ?? project.id ?? projectId
  const base =
    httpUrl(project.links?.websiteUrl) ??
    `https://www.curseforge.com/minecraft/mc-mods/${encodeURIComponent(String(slug))}`
  return {
    title: (project.name ?? `CurseForge 模组 ${projectId}`).slice(0, 160),
    url: `${base.replace(/\/+$/, '')}/files`
  }
}

export interface CurseForgeFingerprintMatch {
  fingerprint: number
  projectId: string
  fileId: string
  fileName: string | null
  versionNumber: string | null
  gameVersions: string[]
}

const FINGERPRINT_BATCH = 100
const PROJECTS_BATCH = 50

export async function identifyCurseForgeFingerprints(
  fingerprints: number[],
  settings: LauncherSettings
): Promise<Map<number, CurseForgeFingerprintMatch>> {
  const unique = [...new Set(fingerprints)].filter((value) => Number.isFinite(value))
  const result = new Map<number, CurseForgeFingerprintMatch>()
  for (let index = 0; index < unique.length; index += FINGERPRINT_BATCH) {
    const batch = unique.slice(index, index + FINGERPRINT_BATCH)
    const raw = await cfPost<{ data?: { exactMatches?: CfFingerprintMatch[] } }>(
      `${apiBase(settings)}/v1/fingerprints/432`,
      {
        fingerprints: batch
      },
      settings
    )
    for (const match of raw.data?.exactMatches ?? []) {
      const file = match.file
      const fingerprint =
        typeof file?.fileFingerprint === 'number'
          ? file.fileFingerprint
          : typeof match.id === 'number'
            ? match.id
            : null
      if (fingerprint === null || typeof file?.modId !== 'number') continue
      result.set(fingerprint, {
        fingerprint,
        projectId: String(file.modId),
        fileId: String(file.id ?? ''),
        fileName: file.fileName ?? null,
        versionNumber: (file.displayName ?? file.fileName ?? '').slice(0, 160) || null,
        gameVersions: [...new Set((file.gameVersions ?? []).filter(isGameVersion))]
      })
    }
  }
  return result
}

export interface CurseForgeProjectInfo {
  id: string
  title: string
  slug: string
  url: string
}

export async function getCurseForgeProjectsInfo(
  projectIds: string[],
  settings: LauncherSettings
): Promise<Map<string, CurseForgeProjectInfo>> {
  const unique = [
    ...new Set(projectIds.filter((id) => /^\d{1,15}$/.test(id)))
  ]
  const result = new Map<string, CurseForgeProjectInfo>()
  for (let index = 0; index < unique.length; index += PROJECTS_BATCH) {
    const batch = unique.slice(index, index + PROJECTS_BATCH)
    const raw = await cfPost<{ data?: CfMod[] }>(
      `${apiBase(settings)}/v1/mods`,
      { modIds: batch.map(Number) },
      settings
    )
    for (const mod of raw.data ?? []) {
      if (!mod.id) continue
      const slug = mod.slug ?? String(mod.id)
      result.set(String(mod.id), {
        id: String(mod.id),
        title: (mod.name ?? `CurseForge 模组 ${mod.id}`).slice(0, 160),
        slug,
        url:
          httpUrl(mod.links?.websiteUrl) ??
          `https://www.curseforge.com/minecraft/mc-mods/${slug}`
      })
    }
  }
  return result
}

export interface CurseForgeChangelog {
  versionNumber: string
  changelog: string
  datePublished: string
  fileName: string | null
  fileSize: number | null
}

export async function getCurseForgeFileChangelog(
  projectId: string,
  fileId: string,
  settings: LauncherSettings
): Promise<CurseForgeChangelog> {
  const raw = await cfFetch<{ data?: CfFile }>(
    `${apiBase(settings)}/v1/mods/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}`,
    settings
  )
  const file = raw.data
  if (!file) throw new Error('CurseForge 没有找到该文件')
  return {
    versionNumber: (file.displayName ?? file.fileName ?? '').slice(0, 160),
    changelog: typeof file.changelog === 'string' ? file.changelog.slice(0, 20_000) : '',
    datePublished: file.fileDate ?? '',
    fileName: file.fileName ?? null,
    fileSize: typeof file.fileLength === 'number' ? file.fileLength : null
  }
}

export async function pickCurseForgeModFile(
  projectId: string,
  gameVersion: string,
  loader: string,
  settings: LauncherSettings,
  fileId?: string | null,
  kind: ContentKind = 'mod'
): Promise<CurseForgeSelection> {
  const project = await cfProject(projectId, settings)
  if (fileId) {
    // 直接按文件 ID 查询：旧文件不一定在最新 50 个文件里，按列表查找会误报“找不到所选文件”。
    const raw = await cfFetch<{ data?: CfFile }>(
      `${apiBase(settings)}/v1/mods/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}`,
      settings
    )
    const file = raw.data
    if (!file?.id || !file.fileName) throw new Error('CurseForge 没有找到所选文件')
    const versions = (file.gameVersions ?? []).map((value) => value.toLowerCase())
    if (gameVersion && !versions.includes(gameVersion.toLowerCase())) {
      throw new Error('所选文件不兼容该游戏版本')
    }
    if (kind === 'mod' && loader && !versions.includes(loader.toLowerCase())) {
      throw new Error('所选文件不兼容该加载器')
    }
    return buildSelection(project, file, settings.curseForgeCompatDownloads)
  }
  const params = new URLSearchParams({ pageSize: '50' })
  if (gameVersion) params.set('gameVersion', gameVersion)
  const type = kind === 'mod' ? loaderType(loader) : null
  if (type !== null) params.set('modLoaderType', String(type))
  const raw = await cfFetch<CfFilesResponse>(
    `${apiBase(settings)}/v1/mods/${encodeURIComponent(projectId)}/files?${params.toString()}`,
    settings
  )
  const files = (raw.data ?? []).filter((file) => {
    if (!file.id || !file.fileName) return false
    const versions = (file.gameVersions ?? []).map((value) => value.toLowerCase())
    if (gameVersion && !versions.includes(gameVersion.toLowerCase())) return false
    if (kind === 'mod' && loader && !versions.includes(loader.toLowerCase())) return false
    return true
  })
  if (files.length === 0) {
    throw new Error('CurseForge 没有找到兼容该游戏版本的文件')
  }
  files.sort((a, b) => {
    const releaseA = a.releaseType === 1 ? 1 : 0
    const releaseB = b.releaseType === 1 ? 1 : 0
    if (releaseA !== releaseB) return releaseB - releaseA
    return Date.parse(b.fileDate ?? '') - Date.parse(a.fileDate ?? '')
  })
  return buildSelection(project, files[0], settings.curseForgeCompatDownloads)
}
