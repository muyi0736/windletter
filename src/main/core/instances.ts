import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type {
  InstanceLoader,
  InstanceMetaPatch,
  InstanceSettingsPatch,
  InstanceSource,
  InstanceSummary
} from '../../shared/types'
import { getConfigDir } from './config'
import { pathExists, safeJoin, writeFileAtomic } from './version'

const INSTANCE_ID = /^[a-z0-9][a-z0-9-]{1,63}$/
const SAFE_VERSION = /^[A-Za-z0-9._+\-]{1,128}$/
const LOADERS: InstanceLoader[] = ['fabric', 'quilt', 'forge', 'neoforge', 'optifine', 'vanilla']
const SOURCES: InstanceSource[] = ['local', 'modrinth', 'curseforge', 'external']

interface StoredInstance extends InstanceSummary {
  schemaVersion: 1
}

function cleanText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function safeIconUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

function normalizeExternal(value: unknown): InstanceSummary['external'] {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (
    typeof raw.baseDir !== 'string' ||
    typeof raw.gameDir !== 'string' ||
    !raw.baseDir.trim() ||
    !raw.gameDir.trim() ||
    raw.baseDir.length > 1024 ||
    raw.gameDir.length > 1024 ||
    !isAbsolute(raw.baseDir) ||
    !isAbsolute(raw.gameDir)
  ) {
    return null
  }
  return {
    baseDir: resolve(raw.baseDir),
    gameDir: resolve(raw.gameDir)
  }
}

export function requireInstanceId(value: unknown): string {
  if (typeof value !== 'string' || !INSTANCE_ID.test(value)) throw new Error('无效的实例标识')
  return value
}

export function getInstancesRoot(): string {
  return join(getConfigDir(), 'instances')
}

export function getInstanceDir(id: string): string {
  return safeJoin(getInstancesRoot(), requireInstanceId(id))
}

export function getInstanceMinecraftDir(id: string): string {
  return join(getInstanceDir(id), 'minecraft')
}

export async function bindMissingInstanceBaseDirs(baseDir: string): Promise<void> {
  let entries
  try {
    entries = await fs.readdir(getInstancesRoot(), { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !INSTANCE_ID.test(entry.name)) continue
    const instance = await readInstanceFolder(entry.name)
    if (!instance || instance.external || instance.baseDir) continue
    await writeInstance({ ...instance, baseDir: resolve(baseDir) })
  }
}

export async function getInstanceGameDir(id: string): Promise<string> {
  const instance = await getInstance(id)
  return instance.external?.gameDir ?? getInstanceMinecraftDir(id)
}

function normalize(raw: unknown, folderId: string): StoredInstance | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Partial<StoredInstance>
  const id = typeof value.id === 'string' ? value.id : folderId
  if (!INSTANCE_ID.test(id)) return null
  const gameVersion = typeof value.gameVersion === 'string' ? value.gameVersion : ''
  const versionId = typeof value.versionId === 'string' ? value.versionId : ''
  const external = normalizeExternal(value.external)
  const baseDir =
    !external &&
    typeof value.baseDir === 'string' &&
    value.baseDir.trim() &&
    value.baseDir.length <= 1024 &&
    isAbsolute(value.baseDir)
      ? resolve(value.baseDir)
      : null
  const versionIdValid = external
    ? versionId.length > 0 &&
      versionId.length <= 128 &&
      !/[\\/]/.test(versionId) &&
      !versionId.includes('..')
    : SAFE_VERSION.test(versionId)
  if (!SAFE_VERSION.test(gameVersion) || !versionIdValid) return null
  const loader = LOADERS.includes(value.loader as InstanceLoader)
    ? (value.loader as InstanceLoader)
    : 'vanilla'
  const loaderVersion =
    typeof value.loaderVersion === 'string' && SAFE_VERSION.test(value.loaderVersion)
      ? value.loaderVersion
      : null
  const source = SOURCES.includes(value.source as InstanceSource)
    ? (value.source as InstanceSource)
    : 'local'
  const javaMajor =
    typeof value.javaMajor === 'number' && Number.isFinite(value.javaMajor)
      ? Math.round(value.javaMajor)
      : null
  return {
    schemaVersion: 1,
    id,
    name: cleanText(value.name, 120) || `整合包 ${id}`,
    summary: cleanText(value.summary, 600),
    iconUrl: safeIconUrl(value.iconUrl),
    gameVersion,
    loader,
    loaderVersion,
    versionId,
    baseDir,
    javaMajor,
    modCount:
      typeof value.modCount === 'number' && Number.isFinite(value.modCount)
        ? Math.max(0, Math.round(value.modCount))
        : 0,
    source,
    projectId:
      typeof value.projectId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value.projectId)
        ? value.projectId
        : null,
    lastPlayed:
      typeof value.lastPlayed === 'number' && Number.isFinite(value.lastPlayed)
        ? value.lastPlayed
        : null,
    installedAt:
      typeof value.installedAt === 'number' && Number.isFinite(value.installedAt)
        ? value.installedAt
        : Date.now(),
    memoryMb:
      typeof value.memoryMb === 'number' && Number.isFinite(value.memoryMb)
        ? Math.max(512, Math.min(32768, Math.round(value.memoryMb)))
        : null,
    extraJvmArgs:
      typeof value.extraJvmArgs === 'string' ? value.extraJvmArgs.slice(0, 4000) : '',
    javaPath:
      typeof value.javaPath === 'string' && value.javaPath.trim()
        ? value.javaPath.trim()
        : null,
    category: cleanText(value.category, 20),
    favorite: Boolean(value.favorite),
    external
  }
}

async function readInstanceFolder(id: string): Promise<StoredInstance | null> {
  try {
    const text = await fs.readFile(join(getInstanceDir(id), 'instance.json'), 'utf8')
    const normalized = normalize(JSON.parse(text), id)
    if (!normalized) return null
    return { ...normalized, id }
  } catch {
    return null
  }
}

export async function listInstances(): Promise<InstanceSummary[]> {
  let entries
  try {
    entries = await fs.readdir(getInstancesRoot(), { withFileTypes: true })
  } catch {
    return []
  }
  const result: InstanceSummary[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !INSTANCE_ID.test(entry.name)) continue
    const instance = await readInstanceFolder(entry.name)
    if (instance) {
      const { schemaVersion: _schemaVersion, ...view } = instance
      result.push(view)
    }
  }
  result.sort((a, b) => {
    if (Boolean(a.favorite) !== Boolean(b.favorite)) return a.favorite ? -1 : 1
    const timeA = a.lastPlayed ?? a.installedAt
    const timeB = b.lastPlayed ?? b.installedAt
    return timeB - timeA
  })
  return result
}

export async function getInstance(id: string): Promise<InstanceSummary> {
  const instance = await readInstanceFolder(requireInstanceId(id))
  if (!instance) throw new Error('实例不存在或已损坏')
  const { schemaVersion: _schemaVersion, ...view } = instance
  return view
}

export async function writeInstance(record: InstanceSummary): Promise<void> {
  const stored: StoredInstance = { schemaVersion: 1, ...record }
  await fs.mkdir(getInstanceDir(record.id), { recursive: true })
  await writeFileAtomic(
    join(getInstanceDir(record.id), 'instance.json'),
    JSON.stringify(stored, null, 2)
  )
}

export async function updateInstanceMeta(
  id: string,
  patch: InstanceMetaPatch
): Promise<InstanceSummary> {
  const instance = await getInstance(id)
  const next: InstanceSummary = { ...instance }
  if (patch.name !== undefined) {
    const name = patch.name.trim().slice(0, 120)
    if (!name) throw new Error('实例名称不能为空')
    next.name = name
  }
  if (patch.summary !== undefined) next.summary = patch.summary.trim().slice(0, 600)
  if (patch.category !== undefined) next.category = patch.category.trim().slice(0, 20)
  if (patch.favorite !== undefined) next.favorite = Boolean(patch.favorite)
  if (patch.iconUrl !== undefined) {
    if (patch.iconUrl === null) {
      next.iconUrl = null
    } else if (
      typeof patch.iconUrl === 'string' &&
      /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]{100,600000}$/.test(patch.iconUrl)
    ) {
      next.iconUrl = patch.iconUrl
    } else {
      throw new Error('无效的实例图标')
    }
  }
  await writeInstance(next)
  return next
}

async function externalDeleteTarget(instance: InstanceSummary): Promise<string | null> {
  const external = instance.external
  if (!external) return null
  const base = resolve(external.baseDir)
  const versions = join(base, 'versions')
  const game = resolve(external.gameDir)
  const rel = relative(versions, game)
  if (
    !rel ||
    rel.startsWith('..') ||
    isAbsolute(rel) ||
    rel.includes(sep) ||
    basename(game).toLowerCase() !== instance.versionId.toLowerCase()
  ) {
    throw new Error('外部整合包目录不在 .minecraft\\versions 下，已拒绝删除以保护其他版本')
  }
  let realVersions: string
  let realGame: string
  try {
    realVersions = await fs.realpath(versions)
    realGame = await fs.realpath(game)
  } catch {
    throw new Error('外部整合包目录不存在或不可访问')
  }
  const realRel = relative(realVersions, realGame)
  if (
    !realRel ||
    realRel.startsWith('..') ||
    isAbsolute(realRel) ||
    realRel.includes(sep) ||
    basename(realGame).toLowerCase() !== instance.versionId.toLowerCase()
  ) {
    throw new Error('外部整合包目录指向了 versions 之外，已拒绝删除')
  }
  const configDir = resolve(getConfigDir()).toLowerCase()
  if (realGame.toLowerCase() === configDir || realGame.toLowerCase().startsWith(`${configDir}${sep}`)) {
    throw new Error('外部整合包目录位于风信数据目录内，已拒绝删除')
  }
  return realGame
}

export async function deleteInstance(
  id: string,
  options: { deleteExternalFiles?: boolean } = {}
): Promise<void> {
  const instance = await getInstance(id)
  const dir = getInstanceDir(id)
  if (!(await pathExists(dir))) throw new Error('实例不存在')
  if (instance.external && options.deleteExternalFiles) {
    const target = await externalDeleteTarget(instance)
    if (!target) throw new Error('外部整合包目录无效')
    await fs.rm(target, { recursive: true, force: true })
  }
  await fs.rm(dir, { recursive: true, force: true })
}

export async function updateInstanceLoader(
  id: string,
  patch: { versionId: string; loaderVersion: string }
): Promise<InstanceSummary> {
  const instance = await getInstance(id)
  if (instance.loader === 'vanilla') throw new Error('原版实例没有加载器')
  if (!SAFE_VERSION.test(patch.versionId)) throw new Error('无效的加载器档案')
  if (!SAFE_VERSION.test(patch.loaderVersion)) throw new Error('无效的加载器版本')
  const next: InstanceSummary = {
    ...instance,
    versionId: patch.versionId,
    loaderVersion: patch.loaderVersion
  }
  await writeInstance(next)
  return next
}

export async function markInstancePlayed(id: string): Promise<void> {
  try {
    const instance = await getInstance(id)
    await writeInstance({ ...instance, lastPlayed: Date.now() })
  } catch {
    /* 实例记录不可写时不阻塞启动 */
  }
}

export async function updateInstanceSettings(
  id: string,
  patch: InstanceSettingsPatch
): Promise<InstanceSummary> {
  const instance = await getInstance(id)
  const next: InstanceSummary = {
    ...instance,
    memoryMb:
      patch.memoryMb === undefined
        ? instance.memoryMb ?? null
        : patch.memoryMb === null
          ? null
          : Math.max(512, Math.min(32768, Math.round(patch.memoryMb))),
    extraJvmArgs:
      patch.extraJvmArgs === undefined
        ? instance.extraJvmArgs ?? ''
        : patch.extraJvmArgs.slice(0, 4000),
    javaPath:
      patch.javaPath === undefined
        ? instance.javaPath ?? null
        : typeof patch.javaPath === 'string' && patch.javaPath.trim()
          ? patch.javaPath.trim()
          : null
  }
  await writeInstance(next)
  return next
}

export function makeInstanceId(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 36)
  const prefix = base || 'modpack'
  return `${prefix}-${randomBytes(3).toString('hex')}`
}

export async function countMods(minecraftDir: string): Promise<number> {
  try {
    const entries = await fs.readdir(join(minecraftDir, 'mods'))
    return entries.filter((entry) => entry.toLowerCase().endsWith('.jar')).length
  } catch {
    return 0
  }
}
