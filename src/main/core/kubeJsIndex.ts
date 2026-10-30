import { createHash } from 'node:crypto'
import { promises as fs, type Dirent } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative } from 'node:path'
import { gunzip, gzip } from 'node:zlib'
import { promisify } from 'node:util'
import AdmZip from 'adm-zip'
import type {
  KubeJsIndexCounts,
  KubeJsIndexItem,
  KubeJsIndexMod,
  KubeJsIndexProgress,
  KubeJsIndexRecipe,
  KubeJsIndexSearchRequest,
  KubeJsIndexSearchResult,
  KubeJsIndexStatus,
  KubeJsIndexTag,
  KubeJsRecipeDetail
} from '../../shared/types'
import { getSettings } from './config'
import { getConfigDir } from './config'
import { getInstance, getInstanceGameDir } from './instances'

const INDEX_VERSION = 10
const MAX_ITEMS = 150_000
const MAX_RECIPES = 150_000
const MAX_TAGS = 60_000
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_RECIPE_DETAIL_BYTES = 512 * 1024
const DEFAULT_PAGE_SIZE = 30
const gzipAsync = promisify(gzip)
const gunzipAsync = promisify(gunzip)

interface IndexItem {
  id: string
  modId: string
  name: string
  nameZh: string | null
  nameEn: string | null
  block: boolean
  source: string
  iconJar?: number | null
  iconTexture?: string | null
}

interface IndexRecipe {
  id: string
  type: string
  modId: string
  output: { id: string; count: number } | null
  inputs: { kind: 'item' | 'tag'; id: string }[]
  source: string
  jar: number | null
  entry: string | null
}

interface IndexTag {
  id: string
  type: string
  modId: string
  members: string[]
  source: string
}

interface IndexData {
  version: number
  instanceId: string
  gameVersion: string
  loader: string
  fingerprint: string
  builtAt: number
  elapsedMs: number
  counts: KubeJsIndexCounts
  mods: KubeJsIndexMod[]
  jarPaths: string[]
  looseAssetsRoot: string | null
  items: IndexItem[]
  recipes: IndexRecipe[]
  tags: IndexTag[]
}

interface BuildJob {
  instanceId: string
  cancelled: boolean
  startedAt: number
  done: number
  total: number
  bytes: number
  items: number
  recipes: number
  tags: number
}

interface ModelInfo {
  parent: string | null
  textures: Record<string, string>
  namespace: string
  jar: number
}

interface TextureRef {
  jar: number
  entry: string
}

interface ScanContext {
  items: Map<string, IndexItem>
  recipes: Map<string, IndexRecipe>
  tags: Map<string, IndexTag>
  langZh: Map<string, string>
  langEn: Map<string, string>
  mods: Map<string, KubeJsIndexMod>
  namespaces: Set<string>
  failedJars: string[]
  jarPaths: string[]
  models: Map<string, ModelInfo>
  textures: Map<string, TextureRef>
  itemModels: Map<string, string>
}

export interface KubeJsIndexLookup {
  items: Set<string>
  recipes: Set<string>
  tags: Set<string>
  namespaces: Set<string>
}

export interface KubeJsQaItemContext {
  id: string
  name: string
  nameZh: string | null
  nameEn: string | null
  modId: string
}

export interface KubeJsQaRecipeContext {
  id: string
  type: string
  modId: string
  output: { id: string; name: string; count: number } | null
  inputs: { kind: 'item' | 'tag'; id: string; name: string }[]
}

export interface KubeJsQaTagContext {
  id: string
  type: string
  memberCount: number
  members: { id: string; name: string }[]
}

export interface KubeJsQaContext {
  question: string
  items: KubeJsQaItemContext[]
  recipes: KubeJsQaRecipeContext[]
  tags: KubeJsQaTagContext[]
  itemCount: number
  recipeCount: number
  tagCount: number
}

let activeJob: BuildJob | null = null
let currentIndex: IndexData | null = null
let lookupCache: { index: IndexData; lookup: KubeJsIndexLookup } | null = null
let vanillaZhCache: { key: string; map: Map<string, string> | null } | null = null

function cleanName(value: string): string {
  return value
    .replace(/[§&][0-9a-fk-or]/gi, '')
    .replace(/%\d+\$[sd]/g, '')
    .replace(/%[sd]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeId(value: string): string | null {
  let id = value.trim().replace(/^#/, '').toLowerCase()
  if (!id || id.length > 240 || /[\s?#]/.test(id)) return null
  if (!id.includes(':')) id = `minecraft:${id}`
  const [namespace, path] = id.split(':', 2)
  if (!namespace || !path || namespace.length > 80 || path.length > 160) return null
  if (!/^[a-z0-9_.-]+$/.test(namespace) || !/^[a-z0-9_./-]+$/.test(path)) return null
  if (/^\d+$/.test(path)) return null
  return `${namespace}:${path}`
}

function addItem(
  context: ScanContext,
  rawId: string,
  source: string,
  block = false
): string | null {
  const id = normalizeId(rawId)
  if (!id) return null
  if (context.items.size >= MAX_ITEMS && !context.items.has(id)) return null
  const existing = context.items.get(id)
  if (existing) {
    if (block) existing.block = true
    return id
  }
  const namespace = id.split(':')[0]
  context.namespaces.add(namespace)
  context.items.set(id, {
    id,
    modId: namespace,
    name: id.slice(id.indexOf(':') + 1),
    nameZh: null,
    nameEn: null,
    block,
    source
  })
  return id
}

function addTag(
  context: ScanContext,
  rawId: string,
  type: string,
  members: string[],
  source: string
): void {
  const id = normalizeId(rawId)
  if (!id) return
  if (context.tags.size >= MAX_TAGS && !context.tags.has(id)) return
  const namespace = id.split(':')[0]
  context.namespaces.add(namespace)
  const normalizedMembers = [...new Set(members.map((member) => member.trim()).filter(Boolean))]
  const existing = context.tags.get(id)
  if (existing) {
    for (const member of normalizedMembers) {
      if (!existing.members.includes(member)) existing.members.push(member)
    }
    return
  }
  context.tags.set(id, {
    id,
    type,
    modId: namespace,
    members: normalizedMembers.slice(0, 500),
    source
  })
}

function extractItemRef(value: unknown): { id: string; count: number } | null {
  if (typeof value === 'string') {
    const id = normalizeId(value)
    return id ? { id, count: 1 } : null
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const object = value as Record<string, unknown>
  const rawId =
    typeof object.item === 'string'
      ? object.item
      : typeof object.id === 'string'
        ? object.id
        : null
  if (!rawId) return null
  const id = normalizeId(rawId)
  if (!id) return null
  const count =
    typeof object.count === 'number' && Number.isFinite(object.count)
      ? Math.max(1, Math.min(999, Math.round(object.count)))
      : 1
  return { id, count }
}

function collectIngredients(
  value: unknown,
  context: ScanContext,
  output: { kind: 'item' | 'tag'; id: string }[],
  source: string
): void {
  if (output.length >= 12) return
  if (typeof value === 'string') {
    const raw = value.trim()
    if (raw.startsWith('#')) {
      const tag = normalizeId(raw)
      if (tag && !output.some((entry) => entry.kind === 'tag' && entry.id === tag)) {
        output.push({ kind: 'tag', id: tag })
      }
      return
    }
    const item = addItem(context, raw, source)
    if (item && !output.some((entry) => entry.kind === 'item' && entry.id === item)) {
      output.push({ kind: 'item', id: item })
    }
    return
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (output.length >= 12) return
      collectIngredients(entry, context, output, source)
    }
    return
  }
  if (!value || typeof value !== 'object') return
  const object = value as Record<string, unknown>
  if (typeof object.tag === 'string') {
    const tag = normalizeId(object.tag)
    if (tag && !output.some((entry) => entry.kind === 'tag' && entry.id === tag)) {
      output.push({ kind: 'tag', id: tag })
    }
    return
  }
  if (typeof object.item === 'string') {
    const item = addItem(context, object.item, source)
    if (item && !output.some((entry) => entry.kind === 'item' && entry.id === item)) {
      output.push({ kind: 'item', id: item })
    }
    return
  }
  for (const nested of Object.values(object)) {
    if (output.length >= 12) return
    collectIngredients(nested, context, output, source)
  }
}

function parseRecipeJson(
  context: ScanContext,
  rawJson: string,
  recipeId: string,
  source: string,
  fallbackNamespace: string,
  jar: number | null = null,
  entry: string | null = null
): void {
  if (context.recipes.size >= MAX_RECIPES) return
  let data: Record<string, unknown>
  try {
    const parsed = JSON.parse(rawJson)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
    data = parsed as Record<string, unknown>
  } catch {
    return
  }
  const namespace = recipeId.split(':')[0] || fallbackNamespace
  const type =
    typeof data.type === 'string' && data.type.trim() ? data.type.trim().slice(0, 180) : 'unknown'
  const output =
    extractItemRef(data.result) ??
    extractItemRef(data.output) ??
    (Array.isArray(data.results) ? extractItemRef(data.results[0]) : null)
  const inputs: { kind: 'item' | 'tag'; id: string }[] = []
  for (const [key, value] of Object.entries(data)) {
    if (
      key === 'result' ||
      key === 'output' ||
      key === 'results' ||
      key === 'pattern' ||
      key === 'type' ||
      key === 'category' ||
      key === 'group' ||
      key === 'show_notification' ||
      key === 'conditions'
    ) {
      continue
    }
    collectIngredients(value, context, inputs, source)
  }
  if (output) addItem(context, output.id, source)
  context.namespaces.add(namespace)
  context.recipes.set(recipeId, {
    id: recipeId,
    type,
    modId: namespace,
    output,
    inputs,
    source,
    jar,
    entry
  })
}

function parseTagJson(
  context: ScanContext,
  rawJson: string,
  tagId: string,
  type: string,
  source: string
): void {
  let data: Record<string, unknown>
  try {
    const parsed = JSON.parse(rawJson)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
    data = parsed as Record<string, unknown>
  } catch {
    return
  }
  const values = Array.isArray(data.values)
    ? data.values
        .map((value) =>
          typeof value === 'string'
            ? value
            : value && typeof value === 'object' && typeof (value as Record<string, unknown>).id === 'string'
              ? String((value as Record<string, unknown>).id)
              : null
        )
        .filter((value): value is string => Boolean(value))
    : []
  // 标签成员往往包含没有静态模型、由运行时生成的物品（例如 Mystical Agriculture 的种子）。
  // 把它们也纳入物品集合，避免静态预检把合法 ID 误报为不存在。
  if (type === 'item') {
    for (const value of values) {
      if (!value.startsWith('#') && value.length <= 220) {
        addItem(context, value, source)
      }
    }
  }
  addTag(context, tagId, type, values, source)
}

function entryText(entry: AdmZip.IZipEntry): string | null {
  try {
    if (entry.header.size > MAX_FILE_BYTES) return null
    return entry.getData().toString('utf8')
  } catch {
    return null
  }
}

function parseLang(context: ScanContext, text: string, language: 'zh' | 'en'): void {
  let data: Record<string, unknown>
  try {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
    data = parsed as Record<string, unknown>
  } catch {
    return
  }
  const target = language === 'zh' ? context.langZh : context.langEn
  for (const [key, value] of Object.entries(data)) {
    if (typeof value !== 'string') continue
    if (!key.startsWith('item.') && !key.startsWith('block.')) continue
    target.set(key, cleanName(value).slice(0, 240))
  }
}

function parseModDescriptor(zip: AdmZip): { id: string; name: string; version: string | null } | null {
  try {
    const fabric = zip.getEntry('fabric.mod.json')
    if (fabric) {
      const data = JSON.parse(fabric.getData().toString('utf8')) as Record<string, unknown>
      if (typeof data.id === 'string' && data.id.trim()) {
        return {
          id: data.id.trim().toLowerCase(),
          name: cleanName(typeof data.name === 'string' && data.name.trim() ? data.name : data.id),
          version: typeof data.version === 'string' ? data.version : null
        }
      }
    }
  } catch {
    /* try next descriptor */
  }
  try {
    const quilt = zip.getEntry('quilt.mod.json')
    if (quilt) {
      const data = JSON.parse(quilt.getData().toString('utf8')) as {
        quilt_loader?: { id?: string; version?: string; metadata?: { name?: string } }
      }
      const loader = data.quilt_loader
      if (loader?.id) {
        return {
          id: loader.id.toLowerCase(),
          name: cleanName(loader.metadata?.name || loader.id),
          version: loader.version ?? null
        }
      }
    }
  } catch {
    /* try next descriptor */
  }
  for (const entryName of ['META-INF/neoforge.mods.toml', 'META-INF/mods.toml']) {
    try {
      const entry = zip.getEntry(entryName)
      if (!entry || entry.header.size > 1_000_000) continue
      const text = entry.getData().toString('utf8')
      const section = text.match(/\[\[mods\]\]([\s\S]*?)(?=\n\s*\[\[|$)/i)?.[1] ?? ''
      const id = section.match(/^\s*modId\s*=\s*["']([^"']+)["']/im)?.[1]
      if (id) {
        return {
          id: id.toLowerCase(),
          name: section.match(/^\s*displayName\s*=\s*["']([^"']+)["']/im)?.[1] || id,
          version: section.match(/^\s*version\s*=\s*["']([^"']+)["']/im)?.[1] ?? null
        }
      }
    } catch {
      /* try next descriptor */
    }
  }
  return null
}

function normalizeTextureKey(value: string, namespace: string): string | null {
  let key = value.trim()
  if (!key || key.startsWith('#')) return null
  if (!key.includes(':')) key = `${namespace}:${key}`
  return key.toLowerCase()
}

function normalizeParentKey(value: string, namespace: string): string | null {
  const parent = value.trim()
  if (!parent || parent.startsWith('builtin/')) return null
  if (parent.includes(':')) return parent.toLowerCase()
  const base =
    parent.startsWith('item/') || parent.startsWith('builtin/') ? 'minecraft' : namespace
  return `${base}:${parent}`.toLowerCase()
}

function recordAsset(
  context: ScanContext,
  entryName: string,
  entry: AdmZip.IZipEntry,
  jarIndex: number
): void {
  if (/^assets\/[^/]+\/textures\/.+\.png$/i.test(entryName)) {
    const match = entryName.match(/^assets\/([^/]+)\/textures\/(.+)\.png$/i)
    if (!match) return
    context.textures.set(`${match[1]}:${match[2]}`.toLowerCase(), {
      jar: jarIndex,
      entry: entryName
    })
    return
  }
  const model = entryName.match(/^assets\/([^/]+)\/models\/(item|block)\/(.+)\.json$/i)
  if (model) {
    const namespace = model[1]
    const type = model[2].toLowerCase()
    const path = model[3]
    const key = `${namespace}:${type}/${path}`.toLowerCase()
    const text = entryText(entry)
    if (!text) return
    let parent: string | null = null
    const textures: Record<string, string> = {}
    try {
      const data = JSON.parse(text) as Record<string, unknown>
      if (typeof data.parent === 'string') parent = normalizeParentKey(data.parent, namespace)
      if (data.textures && typeof data.textures === 'object' && !Array.isArray(data.textures)) {
        for (const [name, value] of Object.entries(data.textures as Record<string, unknown>)) {
          if (typeof value === 'string') textures[name] = value
        }
      }
    } catch {
      /* skip malformed model */
    }
    context.models.set(key, { parent, textures, namespace, jar: jarIndex })
    if (type === 'item') {
      const id = addItem(context, `${namespace}:${path}`, 'mod')
      if (id) context.itemModels.set(id, key)
    }
    return
  }
  const blockstate = entryName.match(/^assets\/([^/]+)\/blockstates\/(.+)\.json$/i)
  if (blockstate) {
    addItem(context, `${blockstate[1]}:${blockstate[2]}`, 'mod', true)
  }
}

function addVanillaOrModJar(
  zip: AdmZip,
  source: 'mod' | 'vanilla',
  context: ScanContext,
  jarIndex: number
): void {
  let entries: AdmZip.IZipEntry[]
  try {
    entries = zip.getEntries()
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.isDirectory) continue
    const name = entry.entryName
    if (context.items.size >= MAX_ITEMS && context.recipes.size >= MAX_RECIPES) break
    if (name.startsWith('assets/')) {
      if (name.endsWith('.json')) {
        if (name.includes('/lang/zh_cn.json')) {
          const text = entryText(entry)
          if (text) parseLang(context, text, 'zh')
        } else if (name.includes('/lang/en_us.json')) {
          const text = entryText(entry)
          if (text) parseLang(context, text, 'en')
        } else {
          recordAsset(context, name, entry, jarIndex)
        }
      } else if (name.endsWith('.png')) {
        recordAsset(context, name, entry, jarIndex)
      }
      continue
    }
    if (!name.startsWith('data/') || !name.endsWith('.json')) continue
    const recipeMatch = name.match(/^data\/([^/]+)\/recipes?\/(.+)\.json$/i)
    if (recipeMatch) {
      const text = entryText(entry)
      if (!text) continue
      try {
        parseRecipeJson(
          context,
          text,
          `${recipeMatch[1]}:${recipeMatch[2]}`,
          source,
          recipeMatch[1],
          jarIndex,
          name
        )
      } catch {
        /* skip malformed recipe */
      }
      continue
    }
    const tagMatch = name.match(/^data\/([^/]+)\/tags\/(items?|blocks?|fluids?)\/(.+)\.json$/i)
    if (tagMatch) {
      const text = entryText(entry)
      if (!text) continue
      const type = tagMatch[2].toLowerCase().startsWith('block')
        ? 'block'
        : tagMatch[2].toLowerCase().startsWith('fluid')
          ? 'fluid'
          : 'item'
      try {
        parseTagJson(context, text, `${tagMatch[1]}:${tagMatch[3]}`, type, source)
      } catch {
        /* skip malformed tag */
      }
    }
  }
}

async function fileStatFingerprint(path: string, hash: ReturnType<typeof createHash>): Promise<void> {
  try {
    const stat = await fs.stat(path)
    // 使用绝对路径，避免开发版/安装版或不同工作目录算出不同指纹。
    hash.update(`${path.replace(/\\/g, '/').toLowerCase()}|${stat.size}|${stat.mtimeMs};`)
  } catch {
    hash.update(`${path.replace(/\\/g, '/').toLowerCase()}|missing;`)
  }
}

async function walkFingerprint(
  root: string,
  hash: ReturnType<typeof createHash>
): Promise<void> {
  const walk = async (dir: string): Promise<void> => {
    let entries: Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name === '.DS_Store' || entry.name === 'desktop.ini') continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (entry.isFile()) {
        await fileStatFingerprint(full, hash)
      }
    }
  }
  await walk(root)
}

async function findClientJar(instanceId: string): Promise<string | null> {
  const instance = await getInstance(instanceId)
  const gameDir = await getInstanceGameDir(instanceId)
  const candidates = [
    join(gameDir, `${instance.versionId}.jar`),
    join(gameDir, `${basename(gameDir)}.jar`)
  ]
  const tryJar = async (path: string): Promise<boolean> => {
    try {
      const stat = await fs.stat(path)
      return stat.isFile() && stat.size > 1_000_000
    } catch {
      return false
    }
  }
  for (const candidate of candidates) {
    if (await tryJar(candidate)) return candidate
  }
  const base =
    instance.external?.baseDir ?? instance.baseDir ?? getSettings().gameDir ?? null
  if (!base) return null
  const tryVersion = async (versionId: string): Promise<string | null> => {
    let current = versionId
    const seen = new Set<string>()
    for (let depth = 0; depth < 5; depth += 1) {
      if (!current || seen.has(current)) return null
      seen.add(current)
      const path = join(base, 'versions', current, `${current}.jar`)
      if (await tryJar(path)) return path
      try {
        const json = JSON.parse(
          await fs.readFile(join(base, 'versions', current, `${current}.json`), 'utf8')
        ) as { inheritsFrom?: string }
        current = typeof json.inheritsFrom === 'string' ? json.inheritsFrom : ''
      } catch {
        return null
      }
    }
    return null
  }
  return (await tryVersion(instance.versionId)) ?? (await tryVersion(instance.gameVersion))
}

/**
 * 原版中文名不在客户端 jar 里，而在 assets 对象的 minecraft/lang/zh_cn.json。
 * 问答检索时按需读取并缓存，用于补齐 minecraft:* 物品的中文名。
 */
async function getVanillaZhNames(instanceId: string): Promise<Map<string, string> | null> {
  const instance = await getInstance(instanceId)
  const gameDir = await getInstanceGameDir(instanceId)
  const base =
    instance.external?.baseDir ?? instance.baseDir ?? getSettings().gameDir ?? null
  if (!base) return null
  const indexesDir = join(base, 'assets', 'indexes')
  let indexId: string | null = null
  try {
    const version = JSON.parse(
      await fs.readFile(join(gameDir, `${instance.versionId}.json`), 'utf8')
    ) as { assetIndex?: { id?: string } }
    if (version.assetIndex?.id) indexId = String(version.assetIndex.id)
  } catch {
    /* fall back to gameVersion or the indexes folder */
  }
  let indexNames: string[] = []
  try {
    indexNames = (await fs.readdir(indexesDir))
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.replace(/\.json$/i, ''))
  } catch {
    return null
  }
  const candidates = [
    indexId,
    instance.gameVersion,
    instance.gameVersion.split('.').slice(0, 2).join('.'),
    ...indexNames
  ].filter((value): value is string => Boolean(value))
  let hash: string | null = null
  for (const candidate of [...new Set(candidates)].slice(0, 30)) {
    try {
      const index = JSON.parse(
        await fs.readFile(join(indexesDir, `${candidate}.json`), 'utf8')
      ) as { objects?: Record<string, { hash?: string }> }
      const object = index.objects?.['minecraft/lang/zh_cn.json']
      if (object?.hash) {
        hash = object.hash
        break
      }
    } catch {
      /* try the next index */
    }
  }
  if (!hash) {
    vanillaZhCache = { key: base, map: null }
    return null
  }
  const cacheKey = `${base}|${hash}`
  if (vanillaZhCache?.key === cacheKey) return vanillaZhCache.map
  try {
    const objectPath = join(base, 'assets', 'objects', hash.slice(0, 2), hash)
    const stat = await fs.stat(objectPath)
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024) return null
    const parsed = JSON.parse(await fs.readFile(objectPath, 'utf8')) as Record<string, unknown>
    const map = new Map<string, string>()
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== 'string') continue
      const match = /^(?:item|block)\.([a-z0-9_]+)\.(.+)$/i.exec(key)
      if (!match) continue
      const id = `${match[1]}:${match[2]}`.toLowerCase()
      if (!map.has(id)) map.set(id, value)
    }
    vanillaZhCache = { key: cacheKey, map }
    return map
  } catch {
    vanillaZhCache = { key: cacheKey, map: null }
    return null
  }
}

async function fingerprintFor(
  instanceId: string,
  gameDir: string,
  clientJar: string | null
): Promise<string> {
  const instance = await getInstance(instanceId)
  const hash = createHash('sha1')
  hash.update(
    `kubejs-index-${INDEX_VERSION}|${instance.gameVersion}|${instance.loader}|${instance.versionId}|`
  )
  const modsDir = join(gameDir, 'mods')
  let jars: string[] = []
  try {
    jars = (await fs.readdir(modsDir))
      .filter((name) => name.toLowerCase().endsWith('.jar'))
      .map((name) => join(modsDir, name))
      .sort()
  } catch {
    jars = []
  }
  for (const jar of jars) await fileStatFingerprint(jar, hash)
  if (clientJar) await fileStatFingerprint(clientJar, hash)
  await walkFingerprint(join(gameDir, 'kubejs', 'data'), hash)
  await walkFingerprint(join(gameDir, 'kubejs', 'startup_scripts'), hash)
  await walkFingerprint(join(gameDir, 'kubejs', 'assets'), hash)
  return hash.digest('hex')
}

function indexCacheDir(instanceId: string): string {
  return join(getConfigDir(), 'cache', 'kubejs', instanceId)
}

async function cacheFile(instanceId: string, fingerprint: string): Promise<string> {
  return join(indexCacheDir(instanceId), `${fingerprint}.json.gz`)
}

async function loadCache(instanceId: string, fingerprint: string): Promise<IndexData | null> {
  const path = await cacheFile(instanceId, fingerprint)
  try {
    const compressed = await fs.readFile(path)
    const data = JSON.parse((await gunzipAsync(compressed)).toString('utf8')) as IndexData
    if (
      data.version !== INDEX_VERSION ||
      data.instanceId !== instanceId ||
      data.fingerprint !== fingerprint ||
      !Array.isArray(data.items) ||
      !Array.isArray(data.recipes) ||
      !Array.isArray(data.tags)
    ) {
      await fs.rm(path, { force: true })
      return null
    }
    return data
  } catch {
    await fs.rm(path, { force: true }).catch(() => undefined)
    return null
  }
}

async function saveCache(data: IndexData): Promise<void> {
  const dir = indexCacheDir(data.instanceId)
  await fs.mkdir(dir, { recursive: true })
  const target = await cacheFile(data.instanceId, data.fingerprint)
  const temp = `${target}.tmp`
  const compressed = await gzipAsync(Buffer.from(JSON.stringify(data), 'utf8'))
  await fs.writeFile(temp, compressed)
  await fs.rename(temp, target)
  const entries = await fs.readdir(dir).catch(() => [])
  await Promise.all(
    entries
      .filter((name) => name.endsWith('.json.gz') && name !== basename(target))
      .map((name) => fs.rm(join(dir, name), { force: true }).catch(() => undefined))
  )
}

function resolveModelTexture(
  context: ScanContext,
  key: string,
  depth: number,
  seen: Set<string>
): string | null {
  if (depth > 8 || seen.has(key)) return null
  seen.add(key)
  const model = context.models.get(key)
  if (!model) return null
  const preferred = ['layer0', 'particle', 'all', 'texture', 'layer1']
  for (const name of preferred) {
    const value = model.textures[name]
    if (!value) continue
    const texture = normalizeTextureKey(value, model.namespace)
    if (texture && context.textures.has(texture)) return texture
  }
  for (const value of Object.values(model.textures)) {
    const texture = normalizeTextureKey(value, model.namespace)
    if (texture && context.textures.has(texture)) return texture
  }
  if (model.parent) {
    const nested = resolveModelTexture(context, model.parent, depth + 1, seen)
    if (nested) return nested
  }
  return null
}

function resolveItemIcon(
  context: ScanContext,
  item: IndexItem
): { jar: number; entry: string } | null {
  const [namespace, path] = item.id.split(':', 2)
  const candidates: string[] = []
  const model = context.itemModels.get(item.id)
  if (model) candidates.push(model)
  if (item.block) candidates.push(`${namespace}:block/${path}`.toLowerCase())
  candidates.push(`${namespace}:item/${path}`.toLowerCase())
  for (const candidate of candidates) {
    const texture = resolveModelTexture(context, candidate, 0, new Set())
    if (texture) {
      const ref = context.textures.get(texture)
      if (ref) return ref
    }
  }
  for (const direct of [
    `${namespace}:item/${path}`,
    `${namespace}:block/${path}`
  ]) {
    const ref = context.textures.get(direct.toLowerCase())
    if (ref) return ref
  }
  return null
}

function finalizeItems(context: ScanContext): void {
  for (const item of context.items.values()) {
    const [namespace, path] = item.id.split(':', 2)
    const zh =
      context.langZh.get(`item.${namespace}.${path}`) ??
      context.langZh.get(`block.${namespace}.${path}`) ??
      null
    const en =
      context.langEn.get(`item.${namespace}.${path}`) ??
      context.langEn.get(`block.${namespace}.${path}`) ??
      null
    item.nameZh = zh ? cleanName(zh) : null
    item.nameEn = en ? cleanName(en) : null
    item.name =
      item.nameZh ||
      item.nameEn ||
      (path.split('/').pop() ?? path).replace(/[_-]+/g, ' ')
    const icon = resolveItemIcon(context, item)
    if (icon) {
      item.iconJar = icon.jar
      item.iconTexture = icon.entry
    }
  }
  context.models.clear()
  context.textures.clear()
  context.itemModels.clear()
}

function statusFromIndex(index: IndexData, cached: boolean): KubeJsIndexStatus {
  return {
    state: 'ready',
    instanceId: index.instanceId,
    fingerprint: index.fingerprint,
    counts: index.counts,
    mods: index.mods,
    builtAt: index.builtAt,
    elapsedMs: index.elapsedMs,
    cached,
    error: null
  }
}

function emptyStatus(instanceId: string, error: string | null = null): KubeJsIndexStatus {
  return {
    state: error ? 'error' : 'idle',
    instanceId,
    fingerprint: null,
    counts: { items: 0, recipes: 0, tags: 0, mods: 0, jars: 0 },
    mods: [],
    builtAt: null,
    elapsedMs: null,
    cached: false,
    error
  }
}

function jobStatus(job: BuildJob): KubeJsIndexStatus {
  return {
    state: 'building',
    instanceId: job.instanceId,
    fingerprint: null,
    counts: {
      items: job.items,
      recipes: job.recipes,
      tags: job.tags,
      mods: 0,
      jars: job.total
    },
    mods: [],
    builtAt: null,
    elapsedMs: Date.now() - job.startedAt,
    cached: false,
    error: null
  }
}

function checkCancelled(job: BuildJob): void {
  if (job.cancelled) {
    const error = new Error('索引已取消')
    ;(error as Error & { cancelled?: boolean }).cancelled = true
    throw error
  }
}

async function scanLooseAssets(
  gameDir: string,
  context: ScanContext,
  job: BuildJob,
  onProgress: (progress: KubeJsIndexProgress) => void
): Promise<void> {
  const root = join(gameDir, 'kubejs')
  const assets = join(root, 'assets')
  const walk = async (dir: string): Promise<void> => {
    checkCancelled(job)
    let entries: Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name === '.DS_Store' || entry.name === 'desktop.ini') continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      if (!entry.isFile()) continue
      const rel = relative(root, full).replace(/\\/g, '/')
      if (!rel.startsWith('assets/')) continue
      if (entry.name.endsWith('.png')) {
        const match = rel.match(/^assets\/([^/]+)\/textures\/(.+)\.png$/i)
        if (match) {
          context.textures.set(`${match[1]}:${match[2]}`.toLowerCase(), {
            jar: -1,
            entry: rel
          })
        }
        continue
      }
      if (!entry.name.endsWith('.json')) continue
      if (rel.includes('/lang/zh_cn.json')) {
        try {
          const stat = await fs.stat(full)
          if (stat.size <= MAX_FILE_BYTES) parseLang(context, await fs.readFile(full, 'utf8'), 'zh')
        } catch {
          /* skip */
        }
        continue
      }
      if (rel.includes('/lang/en_us.json')) {
        try {
          const stat = await fs.stat(full)
          if (stat.size <= MAX_FILE_BYTES) parseLang(context, await fs.readFile(full, 'utf8'), 'en')
        } catch {
          /* skip */
        }
        continue
      }
      const model = rel.match(/^assets\/([^/]+)\/models\/(item|block)\/(.+)\.json$/i)
      if (model) {
        try {
          const stat = await fs.stat(full)
          if (stat.size > MAX_FILE_BYTES) continue
          const data = JSON.parse(await fs.readFile(full, 'utf8')) as Record<string, unknown>
          const namespace = model[1]
          const type = model[2].toLowerCase()
          const path = model[3]
          const key = `${namespace}:${type}/${path}`.toLowerCase()
          const textures: Record<string, string> = {}
          let parent: string | null = null
          if (typeof data.parent === 'string') parent = normalizeParentKey(data.parent, namespace)
          if (data.textures && typeof data.textures === 'object' && !Array.isArray(data.textures)) {
            for (const [name, value] of Object.entries(data.textures as Record<string, unknown>)) {
              if (typeof value === 'string') textures[name] = value
            }
          }
          context.models.set(key, { parent, textures, namespace, jar: -1 })
          if (type === 'item') {
            const id = addItem(context, `${namespace}:${path}`, 'script')
            if (id) context.itemModels.set(id, key)
          }
        } catch {
          /* skip malformed model */
        }
        continue
      }
      const blockstate = rel.match(/^assets\/([^/]+)\/blockstates\/(.+)\.json$/i)
      if (blockstate) {
        addItem(context, `${blockstate[1]}:${blockstate[2]}`, 'script', true)
      }
    }
  }
  await walk(assets)
  job.done += 1
  onProgress({
    state: 'building',
    instanceId: job.instanceId,
    done: job.done,
    total: job.total,
    bytes: job.bytes,
    items: context.items.size,
    recipes: context.recipes.size,
    tags: context.tags.size,
    elapsedMs: Date.now() - job.startedAt,
    current: 'kubejs/assets'
  })
}

async function scanKubeJsData(
  gameDir: string,
  context: ScanContext,
  job: BuildJob,
  onProgress: (progress: KubeJsIndexProgress) => void
): Promise<void> {
  const kubeRoot = join(gameDir, 'kubejs')
  const root = join(kubeRoot, 'data')
  const walk = async (dir: string): Promise<void> => {
    checkCancelled(job)
    let entries: Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name === '.DS_Store' || entry.name === 'desktop.ini') continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      const rel = relative(kubeRoot, full).replace(/\\/g, '/')
      if (!rel.startsWith('data/')) continue
      const recipeMatch = rel.match(/^data\/([^/]+)\/recipes?\/(.+)\.json$/i)
      const tagMatch = rel.match(/^data\/([^/]+)\/tags\/(items?|blocks?|fluids?)\/(.+)\.json$/i)
      if (!recipeMatch && !tagMatch) continue
      let text: string
      try {
        const stat = await fs.stat(full)
        if (stat.size > MAX_FILE_BYTES) continue
        text = await fs.readFile(full, 'utf8')
      } catch {
        continue
      }
      if (recipeMatch) {
        parseRecipeJson(
          context,
          text,
          `${recipeMatch[1]}:${recipeMatch[2]}`,
          'data',
          recipeMatch[1],
          null,
          rel
        )
      } else if (tagMatch) {
        const type = tagMatch[2].toLowerCase().startsWith('block')
          ? 'block'
          : tagMatch[2].toLowerCase().startsWith('fluid')
            ? 'fluid'
            : 'item'
        parseTagJson(context, text, `${tagMatch[1]}:${tagMatch[3]}`, type, 'data')
      }
    }
  }
  await walk(root)
  job.done += 1
  onProgress({
    state: 'building',
    instanceId: job.instanceId,
    done: job.done,
    total: job.total,
    bytes: job.bytes,
    items: context.items.size,
    recipes: context.recipes.size,
    tags: context.tags.size,
    elapsedMs: Date.now() - job.startedAt,
    current: 'kubejs/data'
  })
}

async function scanStartupScripts(
  gameDir: string,
  context: ScanContext,
  job: BuildJob,
  onProgress: (progress: KubeJsIndexProgress) => void
): Promise<void> {
  const root = join(gameDir, 'kubejs', 'startup_scripts')
  const walk = async (dir: string): Promise<void> => {
    checkCancelled(job)
    let entries: Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      if (!entry.isFile() || !entry.name.endsWith('.js')) continue
      try {
        const stat = await fs.stat(full)
        if (stat.size > MAX_FILE_BYTES) continue
        const text = await fs.readFile(full, 'utf8')
        const regex = /\.create\s*\(\s*['"]([^'"]+)['"]/g
        let match: RegExpExecArray | null
        while ((match = regex.exec(text))) {
          const rawId = match[1].trim()
          addItem(context, rawId.includes(':') ? rawId : `kubejs:${rawId}`, 'script')
        }
      } catch {
        /* skip unreadable script */
      }
    }
  }
  await walk(root)
  job.done += 1
  onProgress({
    state: 'building',
    instanceId: job.instanceId,
    done: job.done,
    total: job.total,
    bytes: job.bytes,
    items: context.items.size,
    recipes: context.recipes.size,
    tags: context.tags.size,
    elapsedMs: Date.now() - job.startedAt,
    current: 'startup_scripts'
  })
}

export async function getKubeJsIndexStatus(instanceId: string): Promise<KubeJsIndexStatus> {
  if (activeJob?.instanceId === instanceId) return jobStatus(activeJob)
  const instance = await getInstance(instanceId)
  const gameDir = await getInstanceGameDir(instanceId)
  const clientJar = await findClientJar(instanceId)
  const fingerprint = await fingerprintFor(instanceId, gameDir, clientJar)
  if (currentIndex?.instanceId === instanceId && currentIndex.fingerprint === fingerprint) {
    return statusFromIndex(currentIndex, false)
  }
  const cached = await loadCache(instanceId, fingerprint)
  if (cached) {
    currentIndex = cached
    return statusFromIndex(cached, true)
  }
  return {
    ...emptyStatus(instanceId),
    fingerprint
  }
}

export async function buildKubeJsIndex(
  instanceId: string,
  onProgress: (progress: KubeJsIndexProgress) => void
): Promise<KubeJsIndexStatus> {
  if (activeJob) throw new Error('已有索引任务正在进行')
  const instance = await getInstance(instanceId)
  const gameDir = await getInstanceGameDir(instanceId)
  const clientJar = await findClientJar(instanceId)
  const fingerprint = await fingerprintFor(instanceId, gameDir, clientJar)
  const modsDir = join(gameDir, 'mods')
  let modJars: string[] = []
  try {
    modJars = (await fs.readdir(modsDir))
      .filter((name) => name.toLowerCase().endsWith('.jar'))
      .map((name) => join(modsDir, name))
      .sort()
  } catch {
    modJars = []
  }
  const job: BuildJob = {
    instanceId,
    cancelled: false,
    startedAt: Date.now(),
    done: 0,
    total: modJars.length + (clientJar ? 1 : 0) + 3,
    bytes: 0,
    items: 0,
    recipes: 0,
    tags: 0
  }
  activeJob = job
  const context: ScanContext = {
    items: new Map(),
    recipes: new Map(),
    tags: new Map(),
    langZh: new Map(),
    langEn: new Map(),
    mods: new Map(),
    namespaces: new Set(),
    failedJars: [],
    jarPaths: [],
    models: new Map(),
    textures: new Map(),
    itemModels: new Map()
  }
  const report = (current: string) => {
    onProgress({
      state: 'building',
      instanceId: job.instanceId,
      done: job.done,
      total: job.total,
      bytes: job.bytes,
      items: context.items.size,
      recipes: context.recipes.size,
      tags: context.tags.size,
      elapsedMs: Date.now() - job.startedAt,
      current
    })
  }

  try {
    if (clientJar) {
      try {
        const stat = await fs.stat(clientJar)
        job.bytes += stat.size
        const zip = new AdmZip(await fs.readFile(clientJar))
        const jarIndex = context.jarPaths.push(clientJar) - 1
        addVanillaOrModJar(zip, 'vanilla', context, jarIndex)
      } catch {
        context.failedJars.push(basename(clientJar))
      }
      job.done += 1
      report('Minecraft 原版')
    }

    for (const jar of modJars) {
      checkCancelled(job)
      try {
        const stat = await fs.stat(jar)
        job.bytes += stat.size
        const zip = new AdmZip(await fs.readFile(jar))
        const jarIndex = context.jarPaths.push(jar) - 1
        addVanillaOrModJar(zip, 'mod', context, jarIndex)
        const descriptor = parseModDescriptor(zip)
        if (descriptor) {
          context.mods.set(descriptor.id, {
            id: descriptor.id,
            name: descriptor.name,
            version: descriptor.version,
            file: basename(jar)
          })
        }
      } catch {
        context.failedJars.push(basename(jar))
      }
      job.done += 1
      job.items = context.items.size
      job.recipes = context.recipes.size
      job.tags = context.tags.size
      report(basename(jar))
    }

    checkCancelled(job)
    await scanLooseAssets(gameDir, context, job, onProgress)
    await scanKubeJsData(gameDir, context, job, onProgress)
    await scanStartupScripts(gameDir, context, job, onProgress)
    finalizeItems(context)

    for (const namespace of context.namespaces) {
      if (!context.mods.has(namespace)) {
        context.mods.set(namespace, {
          id: namespace,
          name:
            namespace === 'minecraft'
              ? 'Minecraft'
              : namespace === 'kubejs'
                ? 'KubeJS 自定义'
                : namespace,
          version: null,
          file: ''
        })
      }
    }
    const mods = [...context.mods.values()].sort((a, b) =>
      a.name.localeCompare(b.name, 'zh-CN')
    )
    const data: IndexData = {
      version: INDEX_VERSION,
      instanceId,
      gameVersion: instance.gameVersion,
      loader: instance.loader,
      fingerprint,
      builtAt: Date.now(),
      elapsedMs: Date.now() - job.startedAt,
      counts: {
        items: context.items.size,
        recipes: context.recipes.size,
        tags: context.tags.size,
        mods: mods.length,
        jars: modJars.length + (clientJar ? 1 : 0)
      },
      mods,
      jarPaths: context.jarPaths,
      looseAssetsRoot: join(gameDir, 'kubejs'),
      items: [...context.items.values()],
      recipes: [...context.recipes.values()],
      tags: [...context.tags.values()]
    }
    await saveCache(data)
    currentIndex = data
    iconZipCache.clear()
    iconDataCache.clear()
    return statusFromIndex(data, false)
  } catch (error) {
    if ((error as Error & { cancelled?: boolean }).cancelled) {
      if (currentIndex?.instanceId === instanceId) {
        return statusFromIndex(currentIndex, true)
      }
      return {
        ...emptyStatus(instanceId),
        fingerprint,
        error: '索引已取消'
      }
    }
    return {
      ...emptyStatus(instanceId, error instanceof Error ? error.message : '索引失败'),
      fingerprint
    }
  } finally {
    activeJob = null
  }
}

export function cancelKubeJsIndexBuild(): boolean {
  if (!activeJob) return false
  activeJob.cancelled = true
  return true
}

/**
 * 给静态预检用的只读 ID 集合。仅在当前实例索引已加载时可用，
 * 不会为了检查脚本而触发 10 秒级的重建。
 */
export function getKubeJsIndexLookup(instanceId: string): KubeJsIndexLookup | null {
  if (!currentIndex || currentIndex.instanceId !== instanceId) return null
  if (lookupCache?.index === currentIndex) return lookupCache.lookup
  const namespaces = new Set<string>(['minecraft', 'kubejs', 'forge', 'neoforge', 'c'])
  const items = new Set<string>()
  const recipes = new Set<string>()
  const tags = new Set<string>()
  for (const item of currentIndex.items) {
    items.add(item.id)
    namespaces.add(item.modId)
  }
  for (const recipe of currentIndex.recipes) {
    recipes.add(recipe.id)
    namespaces.add(recipe.modId)
  }
  for (const tag of currentIndex.tags) {
    tags.add(tag.id)
    namespaces.add(tag.modId)
  }
  for (const mod of currentIndex.mods) namespaces.add(mod.id)
  const lookup = { items, recipes, tags, namespaces }
  lookupCache = { index: currentIndex, lookup }
  return lookup
}

function scoreText(text: string, query: string, exact: number, prefix: number, includes: number): number {
  if (!query) return 0
  if (text === query) return exact
  if (text.startsWith(query)) return prefix
  if (text.includes(query)) return includes
  return 0
}

function itemScore(item: IndexItem, query: string): number {
  if (!query) return 0
  return Math.max(
    scoreText(item.id.toLowerCase(), query, 1000, 820, 620),
    scoreText((item.nameZh ?? '').toLowerCase(), query, 960, 860, 700),
    scoreText((item.nameEn ?? '').toLowerCase(), query, 900, 800, 650),
    scoreText(item.name.toLowerCase(), query, 880, 780, 640)
  )
}

function recipeScore(recipe: IndexRecipe, query: string, itemMap: Map<string, IndexItem>): number {
  if (!query) return 0
  const output = recipe.output
    ? itemMap.get(recipe.output.id)
    : null
  let score = Math.max(
    scoreText(recipe.id.toLowerCase(), query, 1000, 820, 620),
    scoreText(recipe.type.toLowerCase(), query, 700, 600, 450)
  )
  if (output) {
    score = Math.max(
      score,
      scoreText(output.id.toLowerCase(), query, 900, 760, 600),
      scoreText(output.name.toLowerCase(), query, 860, 740, 590),
      scoreText((output.nameZh ?? '').toLowerCase(), query, 880, 760, 610)
    )
  }
  for (const input of recipe.inputs) {
    score = Math.max(score, scoreText(input.id.toLowerCase(), query, 720, 620, 470))
  }
  return score
}

function tagScore(tag: IndexTag, query: string): number {
  if (!query) return 0
  return Math.max(
    scoreText(tag.id.toLowerCase(), query, 1000, 820, 620),
    scoreText(tag.type.toLowerCase(), query, 700, 620, 480)
  )
}

const QA_STOPWORDS = [
  '怎么获得',
  '怎么得到',
  '怎么获取',
  '怎么制作',
  '怎么做',
  '怎么合成',
  '如何获得',
  '如何制作',
  '如何合成',
  '有什么用',
  '能做什么',
  '可以做什么',
  '干什么',
  '用于',
  '用途',
  '来源',
  '获取',
  '获得',
  '得到',
  '制作',
  '合成',
  '配方',
  '物品',
  '这个',
  '那个',
  '哪个',
  '什么',
  '哪里',
  '怎么',
  '如何',
  '需要',
  '可以',
  '能否',
  '能不能',
  '告诉',
  '一下',
  '介绍',
  '说明',
  '看看',
  '推荐',
  '路线',
  '标签',
  '东西',
  '哪些',
  '属于',
  '一个',
  '帮我',
  '我想',
  '知道',
  '请',
  '我',
  '想',
  '查',
  '找',
  '从',
  '到',
  '的',
  '了',
  '吗',
  '呢',
  '是',
  '和',
  '与',
  '或',
  '及',
  '在',
  '里',
  '中',
  '上',
  '下',
  '把',
  '被',
  '给',
  '要',
  '用',
  '能',
  '做',
  '有',
  'how',
  'to',
  'make',
  'get',
  'obtain',
  'recipe',
  'item',
  'what',
  'is',
  'the',
  'for',
  'can',
  'do',
  'with',
  'from',
  'where',
  'does',
  'use',
  'used',
  'craft',
  'crafting',
  'a',
  'an',
  'of',
  'and',
  'or',
  'in',
  'on',
  'my',
  'me',
  'i'
].sort((a, b) => b.length - a.length)

function containsId(text: string, id: string): boolean {
  const lower = text.toLowerCase()
  const needle = id.toLowerCase()
  const isBoundary = (value: string): boolean =>
    value === '' || !/[a-z0-9_./:-]/.test(value)
  let index = lower.indexOf(needle)
  while (index >= 0) {
    const before = index === 0 ? '' : lower[index - 1]
    const after = lower[index + needle.length] ?? ''
    if (isBoundary(before) && isBoundary(after)) return true
    index = lower.indexOf(needle, index + 1)
  }
  return false
}

function qaTokens(question: string): string[] {
  const chunks = question
    .toLowerCase()
    .split(/[\s,，。！？?;；、()（）\[\]【】"'“”‘’]+/)
    .filter(Boolean)
  const chineseStopwords = QA_STOPWORDS.filter(
    (word) => /[\u3400-\u9fff]/.test(word) && word.length >= 2
  )
  const asciiStopwords = new Set(
    QA_STOPWORDS.filter((word) => /^[a-z]+$/.test(word))
  )
  const tokens = new Set<string>()
  for (const chunk of chunks) {
    if (chunk.includes(':')) {
      if (chunk.length >= 3) tokens.add(chunk)
      continue
    }
    if (/[\u3400-\u9fff]/.test(chunk)) {
      let text = chunk
      for (const word of chineseStopwords) {
        if (text.includes(word)) text = text.split(word).join(' ')
      }
      for (const part of text.split(/\s+/)) {
        const clean = part.replace(/[的了呢吗]$/, '')
        if (clean.length >= 2) tokens.add(clean)
      }
      continue
    }
    if (asciiStopwords.has(chunk)) continue
    if (chunk.length >= 2) tokens.add(chunk)
  }
  return [...tokens].slice(0, 12)
}

function qaTagHints(itemId: string): string[] {
  const path = (itemId.split(':')[1] ?? '').toLowerCase()
  const hints = new Set<string>()
  if (path.length >= 3) hints.add(path)
  const match = /^(.*)_(ingot|nugget|ore|dust|gear|plate|rod|wire|block)$/.exec(path)
  if (!match) return [...hints]
  const base = match[1]
  const suffix = match[2]
  const plural =
    suffix === 'ingot'
      ? 'ingots'
      : suffix === 'nugget'
        ? 'nuggets'
        : suffix === 'ore'
          ? 'ores'
          : suffix === 'dust'
            ? 'dusts'
            : suffix === 'gear'
              ? 'gears'
              : suffix === 'plate'
                ? 'plates'
                : suffix === 'rod'
                  ? 'rods'
                  : suffix === 'wire'
                    ? 'wires'
                    : 'storage_blocks'
  hints.add(plural)
  hints.add(`${plural}/${base}`)
  if (base.length >= 3) hints.add(base)
  return [...hints].filter((hint) => hint.length >= 3)
}

/**
 * 从当前静态索引里找出与自然语言问题最相关的物品、配方和标签。
 * 这里只做本地检索；AI 调用在 kubeJsQa.ts 中，只发送这里筛出的片段。
 */
export async function getKubeJsQaContext(
  instanceId: string,
  rawQuestion: string
): Promise<KubeJsQaContext> {
  const instance = await getInstance(instanceId)
  const status = await getKubeJsIndexStatus(instance.id)
  if (status.state !== 'ready' || !currentIndex) {
    throw new Error('索引尚未建立，请先在知识页建立实例索引')
  }
  const index = currentIndex
  const question = rawQuestion.trim().slice(0, 500)
  if (!question) throw new Error('请输入要问的物品或配方问题')
  const lower = question.toLowerCase()
  const nameSearchText = lower.replace(/[a-z0-9_.-]+:[a-z0-9_./:-]+/g, ' ')
  const itemMap = new Map(index.items.map((item) => [item.id, item]))
  const vanillaZh = await getVanillaZhNames(instance.id).catch(() => null)
  const zhOf = (item: IndexItem | undefined): string | null =>
    item?.nameZh ?? (item ? vanillaZh?.get(item.id) ?? null : null)
  const nameOf = (id: string): string => {
    const item = itemMap.get(id)
    return zhOf(item) || item?.nameEn || item?.name || id
  }
  const itemScores = new Map<string, number>()
  const addItem = (id: string, score: number) => {
    if (!itemMap.has(id)) return
    itemScores.set(id, Math.max(itemScores.get(id) ?? 0, score))
  }
  for (const item of index.items) {
    let score = 0
    if (containsId(lower, item.id)) score = 1000
    for (const name of [zhOf(item), item.nameEn, item.name]) {
      const normalized = (name ?? '').trim().toLowerCase()
      if (normalized.length >= 2 && nameSearchText.includes(normalized)) {
        score = Math.max(score, 720 + Math.min(120, normalized.length * 6))
      }
    }
    if (score > 0) addItem(item.id, score)
  }
  const tokens = qaTokens(question)
  if (itemScores.size < 3 && tokens.length > 0) {
    for (const item of index.items) {
      if (itemScores.size >= 24) break
      let score = 0
      const id = item.id.toLowerCase()
      const zh = (zhOf(item) ?? '').toLowerCase()
      const en = (item.nameEn ?? '').toLowerCase()
      const name = item.name.toLowerCase()
      for (const token of tokens) {
        if (id.includes(token)) score = Math.max(score, 500)
        else if (zh.includes(token)) score = Math.max(score, 440)
        else if (en.includes(token) && nameSearchText.includes(token)) score = Math.max(score, 420)
        else if (name.includes(token) && nameSearchText.includes(token)) score = Math.max(score, 400)
      }
      if (score > 0) addItem(item.id, score)
    }
  }
  const itemRanked = [...itemScores.entries()].sort(
    (a, b) =>
      b[1] - a[1] ||
      nameOf(a[0]).localeCompare(nameOf(b[0]), 'zh-CN')
  )
  const candidateIds = new Set(itemRanked.slice(0, 16).map(([id]) => id))
  const rankById = new Map(
    itemRanked.slice(0, 16).map(([id], index) => [id, index] as const)
  )
  const asksOutput =
    /怎么(获得|得到|获取|做|制作|合成)|如何(获得|制作|合成|做)|获得|获取|来源|哪里|在哪|合成|制作|配方|怎么做/.test(
      question
    )
  const asksUsage = /用途|有什么用|能做什么|可以做什么|干什么|用于|消耗|做什么/.test(question)
  const recipeScores = new Map<string, number>()
  const recipeById = new Map(index.recipes.map((recipe) => [recipe.id, recipe]))
  for (const recipe of index.recipes) {
    let score = 0
    if (containsId(lower, recipe.id)) score += 950
    const outputRank = recipe.output ? rankById.get(recipe.output.id) : undefined
    if (outputRank !== undefined) {
      if (asksUsage) score += outputRank === 0 ? 40 : 0
      else if (asksOutput) score += outputRank === 0 ? 640 : outputRank < 4 ? 300 : 120
      else score += outputRank === 0 ? 380 : outputRank < 4 ? 220 : 80
    }
    let inputScore = 0
    for (const input of recipe.inputs) {
      const rank = rankById.get(input.id)
      if (rank !== undefined) {
        const weight = asksUsage
          ? rank === 0
            ? 260
            : rank < 4
              ? 70
              : 18
          : rank === 0
            ? 120
            : rank < 4
              ? 40
              : 8
        inputScore = Math.max(inputScore, weight)
      }
      if (input.id && containsId(lower, input.id)) score += 30
    }
    score += inputScore
    if (score === 0 && tokens.length > 0) {
      const recipeId = recipe.id.toLowerCase()
      const type = recipe.type.toLowerCase()
      let textScore = 0
      for (const token of tokens) {
        if (recipeId.includes(token)) textScore = Math.max(textScore, 200)
        else if (type.includes(token)) textScore = Math.max(textScore, 80)
        if (recipe.output && nameOf(recipe.output.id).toLowerCase().includes(token)) {
          textScore = Math.max(textScore, 120)
        }
      }
      score += textScore
    }
    if (score > 0) {
      if (recipe.modId === 'minecraft' || recipe.id.startsWith('minecraft:')) score += 40
      recipeScores.set(recipe.id, score)
    }
  }
  const recipeRanked = [...recipeScores.entries()].sort((a, b) => {
    const recipeA = recipeById.get(a[0])
    const recipeB = recipeById.get(b[0])
    const vanillaA = recipeA?.modId === 'minecraft' ? 0 : 1
    const vanillaB = recipeB?.modId === 'minecraft' ? 0 : 1
    return b[1] - a[1] || vanillaA - vanillaB || a[0].localeCompare(b[0], 'zh-CN')
  })
  const tagScores = new Map<string, number>()
  const tagHints = itemRanked
    .slice(0, 4)
    .map(([id], rank) => ({ hints: qaTagHints(id), rank }))
  const topItemId = itemRanked[0]?.[0] ?? null
  const topItemHints = topItemId ? qaTagHints(topItemId) : []
  const topItemPath = (topItemId?.split(':')[1] ?? '').toLowerCase()
  const topRefHints = topItemHints.filter(
    (hint) => hint === topItemPath || hint.includes('/')
  )
  const asksTags = /标签|属于|哪些/.test(question)
  for (const tag of index.tags) {
    const tagId = tag.id.toLowerCase()
    let score = 0
    if (lower.includes(tagId)) score += 900
    if (tokens.length > 0) {
      if (tokens.some((token) => tagId.includes(token))) score += 180
    }
    let hintScore = 0
    for (const entry of tagHints) {
      for (const hint of entry.hints) {
        if (!tagId.includes(hint)) continue
        hintScore = Math.max(
          hintScore,
          (entry.rank === 0 ? 190 : 70) + Math.min(90, hint.length * 6)
        )
      }
    }
    score += hintScore
    let memberHits = 0
    let directTop = false
    let refTop = false
    let refHint = 0
    for (const member of tag.members) {
      if (candidateIds.has(member)) memberHits += 1
      if (topItemId && member === topItemId) directTop = true
      if (member.startsWith('#') && topRefHints.length > 0) {
        const ref = member.slice(1).toLowerCase()
        for (const hint of topRefHints) {
          if (!ref.includes(hint)) continue
          refTop = true
          refHint = Math.max(refHint, 190 + Math.min(90, hint.length * 6))
        }
      }
    }
    if (asksTags && topItemId && !directTop && !refTop) continue
    if (!asksTags && topItemId && !directTop && !refTop) continue
    if (memberHits > 0) score += memberHits * 40
    if (directTop) score += 240
    score += refHint
    if (score > 0) {
      if (tag.id.startsWith('forge:') || tag.id.startsWith('c:')) score += 12
      tagScores.set(tag.id, score)
    }
  }
  const tagRanked = [...tagScores.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN')
  )

  const items: KubeJsQaItemContext[] = itemRanked.slice(0, 8).map(([id]) => {
    const item = itemMap.get(id)!
    return {
      id: item.id,
      name: item.name,
      nameZh: zhOf(item),
      nameEn: item.nameEn,
      modId: item.modId
    }
  })
  const recipes: KubeJsQaRecipeContext[] = []
  for (const [id] of recipeRanked.slice(0, 10)) {
    const recipe = recipeById.get(id)
    if (!recipe) continue
    recipes.push({
      id: recipe.id,
      type: recipe.type,
      modId: recipe.modId,
      output: recipe.output
        ? {
            id: recipe.output.id,
            name: nameOf(recipe.output.id),
            count: recipe.output.count
          }
        : null,
      inputs: recipe.inputs.slice(0, 12).map((input) => ({
        kind: input.kind,
        id: input.id,
        name: input.kind === 'item' ? nameOf(input.id) : input.id
      }))
    })
  }
  const tags: KubeJsQaTagContext[] = []
  const tagMap = new Map(index.tags.map((tag) => [tag.id, tag]))
  for (const [id] of tagRanked.slice(0, 6)) {
    const tag = tagMap.get(id)
    if (!tag) continue
    tags.push({
      id: tag.id,
      type: tag.type,
      memberCount: tag.members.length,
      members: tag.members.slice(0, 12).map((member) => ({
        id: member,
        name: member.startsWith('#') ? member : nameOf(member)
      }))
    })
  }
  return {
    question,
    items,
    recipes,
    tags,
    itemCount: itemRanked.length,
    recipeCount: recipeRanked.length,
    tagCount: tagRanked.length
  }
}

export async function searchKubeJsIndex(
  request: KubeJsIndexSearchRequest
): Promise<KubeJsIndexSearchResult> {
  const instance = await getInstance(request.instanceId)
  const status = await getKubeJsIndexStatus(instance.id)
  if (status.state !== 'ready' || !currentIndex) {
    throw new Error('索引尚未建立，请先建立实例索引')
  }
  const index = currentIndex
  const pageSize = Math.max(10, Math.min(80, Math.round(request.pageSize || DEFAULT_PAGE_SIZE)))
  const page = Math.max(1, Math.round(request.page || 1))
  const query = request.query.trim().toLowerCase().slice(0, 80)
  const modId = request.modId?.trim().toLowerCase() || ''
  const kind = request.kind
  if (!query) {
    return { kind, items: [], total: 0, page, pageSize }
  }
  const itemMap = new Map(index.items.map((item) => [item.id, item]))

  if (kind === 'item') {
    const matches = index.items
      .filter((item) => !modId || item.modId === modId)
      .map((item) => ({ item, score: itemScore(item, query) }))
      .filter((entry) => !query || entry.score > 0)
      .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name, 'zh-CN'))
    const total = matches.length
    const items = matches
      .slice((page - 1) * pageSize, page * pageSize)
      .map(({ item }) => ({
        id: item.id,
        modId: item.modId,
        name: item.name,
        nameZh: item.nameZh,
        nameEn: item.nameEn,
        block: item.block,
        source: item.source
      }))
    return { kind: 'item', items, total, page, pageSize }
  }

  if (kind === 'recipe') {
    const matches = index.recipes
      .filter((recipe) => !modId || recipe.modId === modId)
      .map((recipe) => ({ recipe, score: recipeScore(recipe, query, itemMap) }))
      .filter((entry) => !query || entry.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          (a.recipe.output?.id ?? a.recipe.id).localeCompare(
            b.recipe.output?.id ?? b.recipe.id,
            'zh-CN'
          )
      )
    const total = matches.length
    const items = matches.slice((page - 1) * pageSize, page * pageSize).map(({ recipe }) => {
      const output = recipe.output
      const outputItem = output ? itemMap.get(output.id) : null
      return {
        id: recipe.id,
        type: recipe.type,
        modId: recipe.modId,
        output: output
          ? {
              id: output.id,
              count: output.count,
              name: outputItem?.name ?? output.id
            }
          : null,
        inputs: recipe.inputs.map((input) => ({
          kind: input.kind,
          id: input.id,
          name:
            input.kind === 'item'
              ? itemMap.get(input.id)?.name ?? input.id
              : input.id
        })),
        source: recipe.source
      }
    })
    return { kind: 'recipe', items, total, page, pageSize }
  }

  const matches = index.tags
    .filter((tag) => !modId || tag.modId === modId)
    .map((tag) => ({ tag, score: tagScore(tag, query) }))
    .filter((entry) => !query || entry.score > 0)
    .sort((a, b) => b.score - a.score || a.tag.id.localeCompare(b.tag.id, 'zh-CN'))
  const total = matches.length
  const items = matches.slice((page - 1) * pageSize, page * pageSize).map(({ tag }) => ({
    id: tag.id,
    type: tag.type,
    modId: tag.modId,
    count: tag.members.length,
    members: tag.members.slice(0, 40),
    source: tag.source
  }))
  return { kind: 'tag', items, total, page, pageSize }
}

async function readRecipeJsonText(text: string): Promise<Record<string, unknown>> {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('配方 JSON 已损坏，无法解析')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('配方 JSON 不是对象')
  }
  return parsed as Record<string, unknown>
}

/**
 * 只读取当前索引里登记过的配方源文件，不接受渲染进程传入任意路径。
 * jar 配方按索引里的 jar 序号和 zip entry 定位；kubejs/data 配方只允许在 kubejs 根目录内。
 */
export async function getKubeJsRecipeDetail(
  instanceId: string,
  recipeId: string
): Promise<KubeJsRecipeDetail> {
  const instance = await getInstance(instanceId)
  const status = await getKubeJsIndexStatus(instance.id)
  if (status.state !== 'ready' || !currentIndex) {
    throw new Error('索引尚未建立，请先建立实例索引')
  }
  const index = currentIndex
  const recipe = index.recipes.find((entry) => entry.id === recipeId)
  if (!recipe) throw new Error('索引中没有这个配方，请重建索引后再试')

  let text: string
  let jarFile: string | null = null
  if (recipe.jar !== null) {
    const jarPath = index.jarPaths[recipe.jar]
    if (!jarPath || !recipe.entry) {
      throw new Error('配方的来源 jar 已不在索引中，请重建索引')
    }
    try {
      const data = await fs.readFile(jarPath)
      const zip = new AdmZip(data)
      const entry = zip.getEntry(recipe.entry)
      if (!entry) throw new Error('配方条目已不在 jar 中，请重建索引')
      if (entry.header.size > MAX_RECIPE_DETAIL_BYTES) {
        throw new Error('配方 JSON 超过 512 KB，不在可视化导入范围内')
      }
      text = entry.getData().toString('utf8')
      jarFile = basename(jarPath)
    } catch (cause) {
      if (cause instanceof Error && cause.message.startsWith('配方')) throw cause
      throw new Error(`读取配方的模组 jar 失败：${basename(jarPath)}`)
    }
  } else if (recipe.source === 'data' && recipe.entry) {
    const gameDir = await getInstanceGameDir(instance.id)
    const root = join(gameDir, 'kubejs')
    const full = join(root, recipe.entry)
    const rel = relative(root, full)
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error('配方的 KubeJS 路径不合法')
    }
    const stat = await fs.stat(full).catch(() => null)
    if (!stat || !stat.isFile()) throw new Error('配方的 KubeJS 文件已不存在，请重建索引')
    if (stat.size > MAX_RECIPE_DETAIL_BYTES) {
      throw new Error('配方 JSON 超过 512 KB，不在可视化导入范围内')
    }
    text = await fs.readFile(full, 'utf8')
  } else {
    throw new Error('这个配方没有可读取的源文件，请重建索引')
  }

  const raw = await readRecipeJsonText(text)
  return {
    id: recipe.id,
    type: recipe.type,
    modId: recipe.modId,
    source: recipe.source,
    jarFile,
    raw
  }
}

const iconZipCache = new Map<string, { zip: AdmZip; tick: number }>()
const iconDataCache = new Map<string, string | null>()
let iconTick = 0

export async function getKubeJsItemIcons(
  instanceId: string,
  rawIds: string[]
): Promise<Record<string, string | null>> {
  const instance = await getInstance(instanceId)
  const status = await getKubeJsIndexStatus(instance.id)
  const result: Record<string, string | null> = {}
  for (const id of rawIds.slice(0, 80)) result[id] = null
  if (status.state !== 'ready' || !currentIndex) return result

  const ids = rawIds.slice(0, 80)
  const itemMap = new Map(currentIndex.items.map((item) => [item.id, item]))
  const needed = new Map<number, Set<string>>()
  for (const id of ids) {
    const item = itemMap.get(id)
    if (!item || item.iconJar === undefined || item.iconJar === null || !item.iconTexture) continue
    const set = needed.get(item.iconJar) ?? new Set<string>()
    set.add(item.iconTexture)
    needed.set(item.iconJar, set)
  }

  iconTick += 1
  for (const [jarIndex, textures] of needed) {
    if (jarIndex < 0) {
      const root = currentIndex.looseAssetsRoot
      if (!root) continue
      for (const texture of textures) {
        const cacheKey = `${instanceId}|-1|${texture}`
        if (iconDataCache.has(cacheKey)) continue
        try {
          const data = await fs.readFile(join(root, texture))
          iconDataCache.set(
            cacheKey,
            data.length <= 2 * 1024 * 1024
              ? `data:image/png;base64,${data.toString('base64')}`
              : null
          )
        } catch {
          iconDataCache.set(cacheKey, null)
        }
      }
      continue
    }
    let cached = iconZipCache.get(`${instanceId}|${jarIndex}`)
    if (!cached) {
      const jarPath = currentIndex.jarPaths[jarIndex]
      if (!jarPath) continue
      try {
        cached = { zip: new AdmZip(await fs.readFile(jarPath)), tick: iconTick }
        iconZipCache.set(`${instanceId}|${jarIndex}`, cached)
      } catch {
        continue
      }
    } else {
      cached.tick = iconTick
    }
    for (const texture of textures) {
      const cacheKey = `${instanceId}|${jarIndex}|${texture}`
      if (iconDataCache.has(cacheKey)) continue
      try {
        const entry = cached.zip.getEntry(texture)
        if (!entry || entry.header.size > 2 * 1024 * 1024) {
          iconDataCache.set(cacheKey, null)
          continue
        }
        const data = entry.getData()
        iconDataCache.set(cacheKey, `data:image/png;base64,${data.toString('base64')}`)
      } catch {
        iconDataCache.set(cacheKey, null)
      }
    }
  }

  for (const id of ids) {
    const item = itemMap.get(id)
    if (!item || item.iconJar === undefined || item.iconJar === null || !item.iconTexture) continue
    result[id] = iconDataCache.get(`${instanceId}|${item.iconJar}|${item.iconTexture}`) ?? null
  }

  if (iconZipCache.size > 6) {
    const oldest = [...iconZipCache.entries()]
      .sort((a, b) => a[1].tick - b[1].tick)
      .slice(0, iconZipCache.size - 6)
    for (const [key] of oldest) iconZipCache.delete(key)
  }
  if (iconDataCache.size > 512) {
    const keys = [...iconDataCache.keys()].slice(0, iconDataCache.size - 512)
    for (const key of keys) iconDataCache.delete(key)
  }
  return result
}
