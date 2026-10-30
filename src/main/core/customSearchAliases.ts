import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type {
  CustomSearchAlias,
  CustomSearchAliasImportResult,
  CustomSearchAliasPayload
} from '../../shared/types'
import { getConfigDir } from './config'
import { fetchMcmodAlias } from './mcmodAlias'
import {
  registerCustomSearchAliases,
  type AliasSeed
} from './searchAliases'

interface CustomAliasFile {
  version: 1
  items: CustomSearchAlias[]
}

const FILE_NAME = 'search-aliases.json'
const BULK_FILE_NAME = 'mod-aliases.json'
const MAX_ALIASES = 200
const MAX_BULK_ALIASES = 30000

let items: CustomSearchAlias[] | null = null
let bulkItems: CustomSearchAlias[] | null = null
let loadTask: Promise<CustomSearchAlias[]> | null = null
let saveQueue: Promise<void> = Promise.resolve()

function aliasPath(): string {
  return join(getConfigDir(), FILE_NAME)
}

function bulkAliasPath(): string {
  return join(getConfigDir(), BULK_FILE_NAME)
}

function safeSlug(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z0-9._-]{1,120}$/.test(value.trim())
    ? value.trim()
    : null
}

function normalizeAlias(raw: unknown): CustomSearchAlias | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  if (typeof value.id !== 'string' || !/^[A-Za-z0-9._-]{1,80}$/.test(value.id)) return null
  const chinese = typeof value.chinese === 'string' ? value.chinese.trim().slice(0, 160) : ''
  const query = typeof value.query === 'string' ? value.query.trim().slice(0, 160) : ''
  if (!chinese || !query) return null
  const aliases = Array.isArray(value.aliases)
    ? [
        ...new Set(
          value.aliases
            .filter((item): item is string => typeof item === 'string')
            .map((item) => item.trim().slice(0, 120))
            .filter(Boolean)
        )
      ].slice(0, 20)
    : []
  const curseforgeSlugs = Array.isArray(value.curseforgeSlugs)
    ? [
        ...new Set(
          value.curseforgeSlugs
            .map(safeSlug)
            .filter((item): item is string => Boolean(item))
        )
      ].slice(0, 8)
    : []
  const modrinthSlugs = Array.isArray(value.modrinthSlugs)
    ? [
        ...new Set(
          value.modrinthSlugs
            .map(safeSlug)
            .filter((item): item is string => Boolean(item))
        )
      ].slice(0, 8)
    : []
  if (curseforgeSlugs.length === 0 && modrinthSlugs.length === 0) return null
  return {
    id: value.id,
    chinese,
    query,
    aliases,
    curseforgeSlugs,
    modrinthSlugs,
    sourceUrl:
      typeof value.sourceUrl === 'string' && value.sourceUrl.startsWith('https://')
        ? value.sourceUrl.slice(0, 500)
        : null,
    addedAt:
      typeof value.addedAt === 'number' && Number.isFinite(value.addedAt)
        ? Math.max(0, Math.trunc(value.addedAt))
        : Date.now()
  }
}

function toSeed(item: CustomSearchAlias, priority: number): AliasSeed {
  return {
    kind: 'mod',
    slug: item.modrinthSlugs[0] ?? item.curseforgeSlugs[0] ?? `custom-${item.id}`,
    query: item.query,
    chinese: item.chinese,
    aliases: item.aliases,
    curseforgeSlugs: item.curseforgeSlugs,
    modrinthSlugs: item.modrinthSlugs,
    custom: priority >= 2,
    priority
  }
}

function register(): void {
  registerCustomSearchAliases([
    ...(items ?? []).map((item) => toSeed(item, 2)),
    ...(bulkItems ?? []).map((item) => toSeed(item, 1))
  ])
}

async function readAliasFile(
  path: string,
  max: number
): Promise<CustomSearchAlias[]> {
  const loaded: CustomSearchAlias[] = []
  const seen = new Set<string>()
  try {
    const raw = await fs.readFile(path, 'utf8')
    const parsed = JSON.parse(raw) as Partial<CustomAliasFile>
    for (const entry of Array.isArray(parsed.items) ? parsed.items : []) {
      const normalized = normalizeAlias(entry)
      if (!normalized) continue
      const key = normalized.id.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      loaded.push(normalized)
      if (loaded.length >= max) break
    }
  } catch {
    /* 首次使用、文件不存在或损坏时从空列表开始 */
  }
  return loaded
}

export async function loadCustomSearchAliases(): Promise<void> {
  if (items) {
    register()
    return
  }
  if (loadTask) {
    await loadTask
    return
  }
  loadTask = (async () => {
    const [user, bulk] = await Promise.all([
      readAliasFile(aliasPath(), MAX_ALIASES),
      readAliasFile(bulkAliasPath(), MAX_BULK_ALIASES)
    ])
    items = user
    bulkItems = bulk
    register()
    return user
  })().finally(() => {
    loadTask = null
  })
  await loadTask
}

async function save(): Promise<void> {
  const data: CustomAliasFile = {
    version: 1,
    items: (items ?? []).slice(0, MAX_ALIASES)
  }
  const content = JSON.stringify(data, null, 2)
  saveQueue = saveQueue.catch(() => undefined).then(async () => {
    await fs.mkdir(getConfigDir(), { recursive: true })
    const tmp = `${aliasPath()}.tmp`
    await fs.writeFile(tmp, content, 'utf8')
    await fs.rename(tmp, aliasPath())
  })
  await saveQueue
}

export async function listCustomSearchAliases(): Promise<CustomSearchAliasPayload> {
  await loadCustomSearchAliases()
  return { items: [...(items ?? [])] }
}

export async function importCustomSearchAlias(
  rawUrl: unknown
): Promise<CustomSearchAliasImportResult> {
  const imported = await fetchMcmodAlias(rawUrl)
  await loadCustomSearchAliases()
  const current = items ?? []
  const index = current.findIndex((item) => item.id === imported.id)
  if (index >= 0) current[index] = imported
  else current.push(imported)
  items = current.slice(-MAX_ALIASES)
  register()
  await save()
  return { item: imported, items: [...items] }
}

export async function removeCustomSearchAlias(
  rawId: unknown
): Promise<CustomSearchAliasPayload> {
  if (typeof rawId !== 'string' || !/^[A-Za-z0-9._-]{1,80}$/.test(rawId)) {
    throw new Error('无效的搜索别名标识')
  }
  await loadCustomSearchAliases()
  items = (items ?? []).filter((item) => item.id !== rawId)
  register()
  await save()
  return { items: [...items] }
}
