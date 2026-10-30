import type {
  ContentKind,
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

export async function listCurseForgeModpackVersions(
  projectId: string,
  settings: LauncherSettings
): Promise<ModpackVersionView[]> {
  const raw = await cfFetch<CfFilesResponse>(
    `${apiBase(settings)}/v1/mods/${encodeURIComponent(projectId)}/files?pageSize=50`,
    settings
  )
  const versions = (raw.data ?? [])
    .filter(
      (file): file is CfFile & { id: number; fileName: string } =>
        Boolean(file.id && file.fileName)
    )
    .map((file) => {
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
        name: (file.displayName ?? file.fileName).slice(0, 160),
        versionNumber: (file.displayName ?? file.fileName).slice(0, 120),
        versionType,
        gameVersion: gameVersions[gameVersions.length - 1] ?? '',
        loaders,
        datePublished: file.fileDate ?? '',
        fileSize: typeof file.fileLength === 'number' ? file.fileLength : null
      }
    })
  versions.sort((a, b) => Date.parse(b.datePublished) - Date.parse(a.datePublished))
  return versions
}

export async function getCurseForgeFileInfo(
  projectId: string,
  fileId: string,
  settings: LauncherSettings
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
  return {
    ...buildSelection(project, file, settings.curseForgeCompatDownloads),
    fileId: String(file.id),
    projectId,
    gameVersions: file.gameVersions ?? [],
    releaseType: typeof file.releaseType === 'number' ? file.releaseType : 1,
    fileDate: typeof file.fileDate === 'string' ? file.fileDate : null
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

function curseForgeCdnUrl(fileId: string, filename: string): string | null {
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
  return {
    title: (project.name ?? file.displayName ?? file.fileName ?? 'CurseForge 模组').slice(0, 160),
    filename,
    url:
      httpUrl(file.downloadUrl) ??
      (compatDownloads ? curseForgeCdnUrl(String(file.id ?? ''), filename) : null),
    manualUrl: `https://www.curseforge.com/minecraft/mc-mods/${slug}/files/${file.id}`,
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
