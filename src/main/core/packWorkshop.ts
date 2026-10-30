import { randomBytes } from 'node:crypto'
import { promises as fs, type Dirent } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { Script } from 'node:vm'
import type {
  InstanceSummary,
  KubeJsAiRequest,
  KubeJsAiResult,
  KubeJsExplainPoint,
  KubeJsExplainRequest,
  KubeJsExplainResult,
  KubeJsFileContent,
  KubeJsFileView,
  KubeJsHistoryCleanupResult,
  KubeJsHistoryContent,
  KubeJsHistoryEntry,
  KubeJsHistoryRestoreRequest,
  KubeJsLineEnding,
  KubeJsRenameRequest,
  KubeJsSaveRequest,
  KubeJsSaveResult,
  KubeJsTemplateView,
  ServerPackModSide,
  WorkshopExportProgress,
  WorkshopExportRequest,
  WorkshopExportResult,
  WorkshopModView,
  WorkshopReport
} from '../../shared/types'
import { getAiRuntimeConfig } from './ai'
import { getSettings } from './config'
import { getInstance, getInstanceDir, getInstanceGameDir } from './instances'
import {
  classifyMod,
  looksClientOnlyMod,
  readModMeta,
  type ModMeta
} from './serverPack'
import { writeFileAtomic } from './version'
import { writeStoreZip, type StoreZipEntry } from './zipStore'

const MAX_KUBEJS_FILE = 2 * 1024 * 1024
const MAX_REPORT_FILES = 2000
const MAX_HISTORY_ENTRIES = 3000
const DEFAULT_HISTORY_KEEP = 50
const KUBEJS_EXTENSIONS = /\.(?:js|json|snbt|txt|properties|md|zs)$/i
const KUBEJS_HISTORY_STAMP = /^[0-9A-Za-z_-]{1,80}$/
const AI_TIMEOUT_MS = 65_000
const BUILTIN_IDS = new Set(['minecraft', 'forge', 'neoforge', 'java', 'fabricloader', 'quilt_loader'])

const KUBEJS_TEMPLATES: KubeJsTemplateView[] = [
  {
    id: 'remove_recipe',
    name: '删除指定配方',
    description: '按配方 ID 删除；把 modid:recipe_id 换成实际 ID。',
    category: '配方',
    code: `ServerEvents.recipes(event => {
  event.remove({ id: 'modid:recipe_id' })
})
`
  },
  {
    id: 'remove_output',
    name: '删除物品的全部配方',
    description: '删除所有产出指定物品的配方。',
    category: '配方',
    code: `ServerEvents.recipes(event => {
  event.remove({ output: 'modid:item' })
})
`
  },
  {
    id: 'remove_mod_recipes',
    name: '删除一个模组的配方',
    description: '删除命名空间为 modid 的所有配方。',
    category: '配方',
    code: `ServerEvents.recipes(event => {
  event.remove({ mod: 'modid' })
})
`
  },
  {
    id: 'shaped_recipe',
    name: '添加有序合成',
    description: '添加一个 2x2 的示例配方；按需替换输入和输出。',
    category: '配方',
    code: `ServerEvents.recipes(event => {
  event.shaped('2x minecraft:stick', [
    'A',
    'A'
  ], {
    A: 'minecraft:oak_planks'
  })
})
`
  },
  {
    id: 'shapeless_recipe',
    name: '添加无序合成',
    description: '添加一个无序合成示例。',
    category: '配方',
    code: `ServerEvents.recipes(event => {
  event.shapeless('4x minecraft:stick', [
    'minecraft:oak_planks',
    'minecraft:oak_planks'
  ])
})
`
  },
  {
    id: 'smelting_recipe',
    name: '添加熔炼配方',
    description: '添加一个熔炉配方；经验/时间参数可按版本调整。',
    category: '配方',
    code: `ServerEvents.recipes(event => {
  event.smelting('minecraft:iron_ingot', 'minecraft:iron_ore')
})
`
  },
  {
    id: 'blasting_recipe',
    name: '添加高炉配方',
    description: '添加一个高炉配方示例。',
    category: '配方',
    code: `ServerEvents.recipes(event => {
  event.blasting('minecraft:iron_ingot', 'minecraft:iron_ore')
})
`
  },
  {
    id: 'unify_tag',
    name: '统一物品标签（forge:）',
    description: '把一个物品加入 Forge 常见标签，供其他模组配方识别。',
    category: '标签',
    tagNamespace: 'forge',
    versionNote: '适用于 Forge 1.20.1 及以下',
    code: `ServerEvents.tags('item', event => {
  event.add('forge:ingots/iron', 'modid:iron_ingot')
})
`
  },
  {
    id: 'unify_tag_common',
    name: '统一物品标签（c: 通用）',
    description: '使用 NeoForge / Fabric 常见的 c: 通用标签。',
    category: '标签',
    tagNamespace: 'c',
    versionNote: '适用于 NeoForge / Fabric / 1.20.5+',
    code: `ServerEvents.tags('item', event => {
  event.add('c:ingots/iron', 'modid:iron_ingot')
})
`
  },
  {
    id: 'remove_tag',
    name: '移除物品标签（forge:）',
    description: '从 Forge 标签移除一个物品。',
    category: '标签',
    tagNamespace: 'forge',
    versionNote: '适用于 Forge 1.20.1 及以下',
    code: `ServerEvents.tags('item', event => {
  event.remove('forge:ores/iron', 'modid:iron_ore')
})
`
  },
  {
    id: 'remove_tag_common',
    name: '移除物品标签（c: 通用）',
    description: '从 c: 通用标签移除一个物品。',
    category: '标签',
    tagNamespace: 'c',
    versionNote: '适用于 NeoForge / Fabric / 1.20.5+',
    code: `ServerEvents.tags('item', event => {
  event.remove('c:ores/iron', 'modid:iron_ore')
})
`
  },
  {
    id: 'startup_item',
    name: '注册自定义物品',
    description: '在启动脚本注册一个物品；ID 和贴图需要在 kubejs 资源中准备。',
    category: '注册',
    code: `StartupEvents.registry('item', event => {
  event.create('modid:custom_item').displayName('自定义物品')
})
`
  },
  {
    id: 'startup_log',
    name: '启动日志',
    description: '在启动脚本里输出一条提示，便于确认脚本被加载。',
    category: '注册',
    code: `console.info('[整合包工坊] startup script loaded')
`
  },
  {
    id: 'client_tooltip',
    name: '物品提示文字',
    description: '给物品添加客户端 tooltip，适合写玩法说明。',
    category: '客户端',
    code: `ItemEvents.tooltip(event => {
  event.add('modid:item', '提示文字')
})
`
  },
  {
    id: 'lootjs',
    name: '修改战利品表',
    description: '从箱子战利品中移除物品；需要安装 LootJS。',
    category: '战利品',
    versionNote: '需要 LootJS',
    code: `LootJS.modifiers(event => {
  event.addLootTableModifier('minecraft:chests/simple_dungeon')
    .removeLoot('minecraft:diamond')
})
`
  }
]

interface ScannedMod {
  file: string
  size: number
  meta: ModMeta | null
  side: ServerPackModSide
  reason: string
}

async function scanMods(instance: InstanceSummary): Promise<ScannedMod[]> {
  const gameDir = await getInstanceGameDir(instance.id)
  const dir = join(gameDir, 'mods')
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const result: ScannedMod[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.jar')) continue
    const file = join(dir, entry.name)
    try {
      const stat = await fs.stat(file)
      const meta = readModMeta(file)
      const classification = classifyMod(entry.name, meta)
      result.push({
        file: entry.name,
        size: stat.size,
        meta,
        side: classification.side,
        reason: classification.reason
      })
    } catch {
      /* skip disappearing/broken jar */
    }
  }
  result.sort((a, b) => a.file.localeCompare(b.file, 'zh-CN'))
  return result
}

function kubejsRoot(gameDir: string): string {
  return join(gameDir, 'kubejs')
}

function validKubeJsPath(value: string): string {
  const path = value.replace(/\\/g, '/').replace(/^\/+/, '')
  if (
    !path ||
    path.length > 400 ||
    path.split('/').includes('..') ||
    /^[A-Za-z]:/.test(path) ||
    !KUBEJS_EXTENSIONS.test(path)
  ) {
    throw new Error('无效的 KubeJS 文件路径')
  }
  return path
}

function safeKubeJsPath(root: string, relativePath: string): string {
  const base = resolve(root)
  const target = resolve(base, relativePath)
  if (target !== base && !target.startsWith(base + sep)) {
    throw new Error('KubeJS 文件路径越界')
  }
  return target
}

function samePath(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

function isInside(root: string, target: string): boolean {
  return samePath(target, root) || target.startsWith(root + sep)
}

async function assertRealPathInside(root: string, target: string): Promise<void> {
  let realRoot: string
  try {
    realRoot = await fs.realpath(root)
  } catch {
    realRoot = resolve(root)
  }
  let probe = target
  let realProbe: string | null = null
  while (true) {
    try {
      realProbe = await fs.realpath(probe)
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const parent = dirname(probe)
      if (parent === probe) break
      probe = parent
    }
  }
  if (realProbe && !isInside(realRoot, realProbe)) {
    throw new Error('KubeJS 文件路径越界')
  }
}

interface DecodedText {
  content: string
  bom: boolean
  lineEnding: KubeJsLineEnding
}

function decodeKubeJsText(buffer: Buffer): DecodedText {
  const bom = buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf
  const text = buffer.toString('utf8', bom ? 3 : 0)
  return {
    content: text.replace(/\r\n/g, '\n'),
    bom,
    lineEnding: text.includes('\r\n') ? 'crlf' : 'lf'
  }
}

function encodeKubeJsText(
  content: string,
  bom: boolean,
  lineEnding: KubeJsLineEnding
): Buffer {
  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  const text = lineEnding === 'crlf' ? normalized.replace(/\n/g, '\r\n') : normalized
  return Buffer.from(`${bom ? '\uFEFF' : ''}${text}`, 'utf8')
}

function backupStamp(): string {
  const iso = new Date().toISOString()
  return `${iso.slice(0, 10)}_${iso.slice(11, 23).replace(/[:.]/g, '-')}-${randomBytes(3).toString('hex')}`
}

function validHistoryStamp(value: string): string {
  const stamp = value.trim()
  if (!KUBEJS_HISTORY_STAMP.test(stamp) || stamp === '.' || stamp === '..') {
    throw new Error('无效的 KubeJS 历史版本')
  }
  return stamp
}

function historyStampTime(stamp: string): number | null {
  const match = stamp.match(
    /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})-(\d{3})/
  )
  if (!match) return null
  const value = Date.parse(
    `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.${match[7]}Z`
  )
  return Number.isFinite(value) ? value : null
}

function historyRoot(instanceId: string): string {
  return join(getInstanceDir(instanceId), 'backups', 'kubejs')
}

export async function listKubeJsFiles(instanceId: string): Promise<{
  exists: boolean
  files: KubeJsFileView[]
}> {
  const instance = await getInstance(instanceId)
  const gameDir = await getInstanceGameDir(instance.id)
  const root = kubejsRoot(gameDir)
  try {
    const stat = await fs.stat(root)
    if (!stat.isDirectory()) return { exists: false, files: [] }
  } catch {
    return { exists: false, files: [] }
  }
  const files: KubeJsFileView[] = []
  const walk = async (dir: string): Promise<void> => {
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (files.length >= MAX_REPORT_FILES) return
      if (entry.name === '.DS_Store' || entry.name === 'desktop.ini') continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      if (!entry.isFile() || !KUBEJS_EXTENSIONS.test(entry.name)) continue
      try {
        const stat = await fs.stat(full)
        const rel = relative(root, full).replace(/\\/g, '/')
        files.push({
          path: rel,
          name: entry.name,
          category: rel.includes('/') ? rel.slice(0, rel.indexOf('/')) : 'root',
          size: stat.size,
          modified: stat.mtimeMs
        })
      } catch {
        /* ignore */
      }
    }
  }
  await walk(root)
  files.sort((a, b) => a.path.localeCompare(b.path, 'zh-CN'))
  return { exists: true, files }
}

export async function getWorkshopReport(instanceId: string): Promise<WorkshopReport> {
  const instance = await getInstance(instanceId)
  const scanned = await scanMods(instance)
  const byId = new Map<string, WorkshopModView[]>()
  const rows: WorkshopModView[] = scanned.map((mod) => {
    const id = mod.meta?.id ?? null
    const row: WorkshopModView = {
      file: mod.file,
      size: mod.size,
      id,
      name: mod.meta?.name ?? mod.file.replace(/\.jar$/i, ''),
      version: mod.meta?.version ?? null,
      side: mod.side,
      reason: mod.reason,
      requires: mod.meta?.requires ?? [],
      requiredBy: [],
      missing: [],
      clientDependency: null,
      duplicate: false,
      include: true
    }
    if (id) {
      const list = byId.get(id) ?? []
      list.push(row)
      byId.set(id, list)
    }
    return row
  })

  for (const row of rows) {
    for (const dependency of row.requires) {
      const depRows = byId.get(dependency)
      if (depRows && depRows.length > 0) {
        for (const dep of depRows) {
          if (!dep.requiredBy.includes(row.id ?? row.file)) {
            dep.requiredBy.push(row.id ?? row.file)
          }
        }
        const clientDep =
          depRows.find((dep) => dep.side === 'client') ??
          (depRows.every((dep) => dep.side === 'unknown') && looksClientOnlyMod(`${dependency}.jar`)
            ? depRows[0]
            : null)
        if (clientDep) row.clientDependency = clientDep.id ?? clientDep.file
      } else if (!BUILTIN_IDS.has(dependency)) {
        row.missing.push(dependency)
      }
    }
  }

  for (const [, group] of byId) {
    if (group.length > 1) {
      for (const row of group) row.duplicate = true
    }
  }
  rows.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  const kubejs = await listKubeJsFiles(instance.id)
  return {
    instanceId: instance.id,
    instanceName: instance.name,
    gameVersion: instance.gameVersion,
    loader: instance.loader,
    loaderVersion: instance.loaderVersion,
    mods: rows,
    kubejs,
    counts: {
      total: rows.length,
      client: rows.filter((row) => row.side === 'client').length,
      server: rows.filter((row) => row.side === 'server').length,
      both: rows.filter((row) => row.side === 'both').length,
      unknown: rows.filter((row) => row.side === 'unknown').length,
      missing: rows.filter((row) => row.missing.length > 0).length,
      duplicates: rows.filter((row) => row.duplicate).length,
      clientDependency: rows.filter((row) => row.clientDependency).length
    }
  }
}

export async function readKubeJsFile(
  instanceId: string,
  rawPath: string
): Promise<KubeJsFileContent> {
  const instance = await getInstance(instanceId)
  const gameDir = await getInstanceGameDir(instance.id)
  const rel = validKubeJsPath(rawPath)
  const file = safeKubeJsPath(kubejsRoot(gameDir), rel)
  let stat
  try {
    stat = await fs.stat(file)
  } catch {
    throw new Error('KubeJS 文件不存在')
  }
  if (!stat.isFile()) throw new Error('不是 KubeJS 文件')
  if (stat.size > MAX_KUBEJS_FILE) throw new Error('KubeJS 文件超过 2 MB，不能在启动器内编辑')
  await assertRealPathInside(kubejsRoot(gameDir), file)
  const decoded = decodeKubeJsText(await fs.readFile(file))
  return {
    path: rel,
    name: rel.split('/').pop() ?? rel,
    category: rel.includes('/') ? rel.slice(0, rel.indexOf('/')) : 'root',
    size: stat.size,
    modified: stat.mtimeMs,
    content: decoded.content,
    bom: decoded.bom,
    lineEnding: decoded.lineEnding
  }
}

function validateScript(rel: string, content: string): void {
  if (Buffer.byteLength(content, 'utf8') > MAX_KUBEJS_FILE) {
    throw new Error('KubeJS 脚本超过 2 MB')
  }
  if (rel.toLowerCase().endsWith('.js')) {
    try {
      // vm.Script 只做语法编译，不执行脚本。
      new Script(content, { filename: rel })
    } catch (error) {
      throw new Error(`JavaScript 语法错误：${error instanceof Error ? error.message : '未知错误'}`)
    }
  } else if (rel.toLowerCase().endsWith('.json')) {
    try {
      JSON.parse(content)
    } catch (error) {
      throw new Error(`JSON 格式错误：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }
}

async function backupKubeJsFile(
  instanceId: string,
  rel: string
): Promise<{ stamp: string; target: string } | null> {
  const source = safeKubeJsPath(
    kubejsRoot(await getInstanceGameDir(instanceId)),
    rel
  )
  let stat
  try {
    stat = await fs.stat(source)
  } catch {
    return null
  }
  if (!stat.isFile()) return null
  const stamp = backupStamp()
  const backupRoot = join(getInstanceDir(instanceId), 'backups', 'kubejs', stamp)
  const target = safeKubeJsPath(backupRoot, rel)
  await fs.mkdir(dirname(target), { recursive: true })
  await fs.copyFile(source, target)
  // 保留策略失败不能阻断脚本保存，历史面板和备份管理页仍可手动清理。
  try {
    const settings = getSettings()
    await pruneKubeJsHistory(
      instanceId,
      settings.kubeJsBackupLimit,
      settings.backupMaxAgeDays
    )
  } catch {
    /* ignore retention failure */
  }
  return { stamp, target }
}

export async function saveKubeJsFile(
  request: KubeJsSaveRequest
): Promise<KubeJsSaveResult> {
  const instance = await getInstance(request.instanceId)
  const rel = validKubeJsPath(request.path)
  const bom = request.bom === true
  const lineEnding: KubeJsLineEnding = request.lineEnding === 'crlf' ? 'crlf' : 'lf'
  const content = request.content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  const serialized = encodeKubeJsText(content, bom, lineEnding)
  if (serialized.length > MAX_KUBEJS_FILE) throw new Error('KubeJS 脚本超过 2 MB')

  const gameDir = await getInstanceGameDir(instance.id)
  const target = safeKubeJsPath(kubejsRoot(gameDir), rel)
  await assertRealPathInside(kubejsRoot(gameDir), target)

  let stat: Awaited<ReturnType<typeof fs.stat>> | null = null
  try {
    stat = await fs.stat(target)
  } catch {
    stat = null
  }
  const exists = Boolean(stat?.isFile())
  if (exists && stat && stat.size > MAX_KUBEJS_FILE) {
    throw new Error('KubeJS 文件超过 2 MB，不能在启动器内保存')
  }
  if (exists) {
    const current = await fs.readFile(target)
    if (current.equals(serialized)) {
      return { ok: true, file: await readKubeJsFile(instance.id, rel) }
    }
  }

  if (request.force !== true) {
    const expected =
      typeof request.expectedModified === 'number' ? request.expectedModified : null
    if (expected === null) {
      if (exists && stat) {
        return { ok: false, conflictModified: stat.mtimeMs, reason: 'exists' }
      }
    } else if (!exists || !stat) {
      return { ok: false, conflictModified: 0, reason: 'deleted' }
    } else if (Math.abs(stat.mtimeMs - expected) > 1) {
      return { ok: false, conflictModified: stat.mtimeMs, reason: 'changed' }
    }
  }

  validateScript(rel, content)
  await backupKubeJsFile(instance.id, rel)
  await fs.mkdir(dirname(target), { recursive: true })
  await writeFileAtomic(target, serialized.toString('utf8'))
  return { ok: true, file: await readKubeJsFile(instance.id, rel) }
}

export async function renameKubeJsFile(
  request: KubeJsRenameRequest
): Promise<KubeJsFileContent> {
  const instance = await getInstance(request.instanceId)
  const from = validKubeJsPath(request.from)
  const to = validKubeJsPath(request.to)
  if (from === to) return readKubeJsFile(instance.id, from)
  const gameDir = await getInstanceGameDir(instance.id)
  const root = kubejsRoot(gameDir)
  const source = safeKubeJsPath(root, from)
  const target = safeKubeJsPath(root, to)
  await assertRealPathInside(root, source)
  await assertRealPathInside(root, target)

  let sourceStat
  try {
    sourceStat = await fs.stat(source)
  } catch {
    throw new Error('KubeJS 文件不存在')
  }
  if (!sourceStat.isFile()) throw new Error('只能重命名 KubeJS 文件')
  let targetExists = false
  try {
    await fs.stat(target)
    targetExists = true
  } catch {
    targetExists = false
  }
  if (targetExists) throw new Error('目标路径已存在同名文件')

  const decoded = decodeKubeJsText(await fs.readFile(source))
  validateScript(to, decoded.content)
  await backupKubeJsFile(instance.id, from)
  await fs.mkdir(dirname(target), { recursive: true })
  await fs.rename(source, target)
  return readKubeJsFile(instance.id, to)
}

export async function removeKubeJsFile(instanceId: string, rawPath: string): Promise<void> {
  const instance = await getInstance(instanceId)
  const rel = validKubeJsPath(rawPath)
  const gameDir = await getInstanceGameDir(instance.id)
  const root = kubejsRoot(gameDir)
  const target = safeKubeJsPath(root, rel)
  await assertRealPathInside(root, target)
  let stat
  try {
    stat = await fs.stat(target)
  } catch {
    throw new Error('KubeJS 文件不存在')
  }
  if (!stat.isFile()) throw new Error('只能删除 KubeJS 文件')
  await backupKubeJsFile(instance.id, rel)
  await fs.rm(target, { force: true })
}

async function readKubeJsHistoryContent(
  instanceId: string,
  rawStamp: string,
  rawPath: string
): Promise<KubeJsHistoryContent> {
  const instance = await getInstance(instanceId)
  const stamp = validHistoryStamp(rawStamp)
  const rel = validKubeJsPath(rawPath)
  const root = historyRoot(instance.id)
  const file = safeKubeJsPath(join(root, stamp), rel)
  await assertRealPathInside(root, file)
  let stat
  try {
    stat = await fs.stat(file)
  } catch {
    throw new Error('KubeJS 历史快照不存在')
  }
  if (!stat.isFile()) throw new Error('不是 KubeJS 历史文件')
  if (stat.size > MAX_KUBEJS_FILE) throw new Error('KubeJS 历史文件超过 2 MB')
  const decoded = decodeKubeJsText(await fs.readFile(file))
  return {
    stamp,
    path: rel,
    name: rel.split('/').pop() ?? rel,
    category: rel.includes('/') ? rel.slice(0, rel.indexOf('/')) : 'root',
    size: stat.size,
    modified: stat.mtimeMs,
    content: decoded.content,
    bom: decoded.bom,
    lineEnding: decoded.lineEnding
  }
}

export async function listKubeJsHistory(
  instanceId: string,
  maxEntries = MAX_HISTORY_ENTRIES
): Promise<KubeJsHistoryEntry[]> {
  const cap = Math.max(1, Math.min(200_000, Math.floor(maxEntries) || MAX_HISTORY_ENTRIES))
  const instance = await getInstance(instanceId)
  const root = historyRoot(instance.id)
  let stampDirs
  try {
    stampDirs = (await fs.readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && KUBEJS_HISTORY_STAMP.test(entry.name))
      .sort((a, b) => b.name.localeCompare(a.name))
  } catch {
    return []
  }
  const entries: KubeJsHistoryEntry[] = []
  for (const stampDir of stampDirs) {
    const stamp = stampDir.name
    const base = join(root, stamp)
    const walk = async (dir: string): Promise<void> => {
      if (entries.length >= cap) return
      let items
      try {
        items = await fs.readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const item of items) {
        if (entries.length >= cap) return
        if (item.name === '.DS_Store' || item.name === 'desktop.ini') continue
        const full = join(dir, item.name)
        if (item.isDirectory()) {
          await walk(full)
          continue
        }
        if (!item.isFile() || !KUBEJS_EXTENSIONS.test(item.name)) continue
        try {
          const stat = await fs.stat(full)
          const rel = relative(base, full).replace(/\\/g, '/')
          entries.push({ stamp, path: rel, size: stat.size, modified: stat.mtimeMs })
        } catch {
          /* ignore disappearing files */
        }
      }
    }
    await walk(base)
    if (entries.length >= cap) break
  }
  entries.sort((a, b) => b.stamp.localeCompare(a.stamp) || a.path.localeCompare(b.path, 'zh-CN'))
  return entries
}

export async function readKubeJsHistory(
  instanceId: string,
  stamp: string,
  path: string
): Promise<KubeJsHistoryContent> {
  return readKubeJsHistoryContent(instanceId, stamp, path)
}

export async function restoreKubeJsHistory(
  request: KubeJsHistoryRestoreRequest
): Promise<KubeJsFileContent> {
  const snapshot = await readKubeJsHistoryContent(
    request.instanceId,
    request.stamp,
    request.path
  )
  const instance = await getInstance(request.instanceId)
  const rel = validKubeJsPath(request.path)
  validateScript(rel, snapshot.content)
  const gameDir = await getInstanceGameDir(instance.id)
  const target = safeKubeJsPath(kubejsRoot(gameDir), rel)
  await assertRealPathInside(kubejsRoot(gameDir), target)
  const serialized = encodeKubeJsText(snapshot.content, snapshot.bom, snapshot.lineEnding)

  let current: Buffer | null = null
  try {
    current = await fs.readFile(target)
  } catch {
    current = null
  }
  if (current && current.equals(serialized)) {
    return readKubeJsFile(instance.id, rel)
  }
  await backupKubeJsFile(instance.id, rel)
  await fs.mkdir(dirname(target), { recursive: true })
  await writeFileAtomic(target, serialized.toString('utf8'))
  return readKubeJsFile(instance.id, rel)
}

export async function pruneKubeJsHistory(
  instanceId: string,
  keep = DEFAULT_HISTORY_KEEP,
  maxAgeDays = 0
): Promise<KubeJsHistoryCleanupResult> {
  const limit = Math.min(500, Math.max(1, Math.floor(keep) || DEFAULT_HISTORY_KEEP))
  const cutoff =
    maxAgeDays > 0
      ? Date.now() - Math.min(3650, Math.round(maxAgeDays)) * 24 * 60 * 60 * 1000
      : null
  const entries = await listKubeJsHistory(instanceId, 200_000)
  const byPath = new Map<string, KubeJsHistoryEntry[]>()
  for (const entry of entries) {
    const group = byPath.get(entry.path) ?? []
    group.push(entry)
    byPath.set(entry.path, group)
  }
  const root = historyRoot((await getInstance(instanceId)).id)
  let removed = 0
  let bytes = 0
  const touchedStamps = new Set<string>()
  for (const group of byPath.values()) {
    group.sort((a, b) => b.stamp.localeCompare(a.stamp))
    for (const [index, entry] of group.entries()) {
      const at = historyStampTime(entry.stamp) ?? entry.modified
      const tooOld = cutoff !== null && at < cutoff
      if (index < limit && !tooOld) continue
      try {
        await fs.rm(safeKubeJsPath(join(root, entry.stamp), entry.path), { force: true })
        removed += 1
        bytes += entry.size
        touchedStamps.add(entry.stamp)
      } catch {
        /* keep going */
      }
    }
  }
  for (const stamp of touchedStamps) {
    await removeEmptyDirTree(join(root, stamp))
  }
  return { removed, kept: Math.max(0, entries.length - removed), bytes }
}

async function removeEmptyDirTree(dir: string): Promise<void> {
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.isDirectory()) await removeEmptyDirTree(join(dir, entry.name))
  }
  try {
    const remaining = await fs.readdir(dir)
    if (remaining.length === 0) await fs.rmdir(dir)
  } catch {
    /* ignore */
  }
}

export function kubeJsTemplates(): KubeJsTemplateView[] {
  return KUBEJS_TEMPLATES
}

function collectFolder(
  gameDir: string,
  folder: string,
  prefix: string,
  entries: StoreZipEntry[]
): Promise<void> {
  const root = join(gameDir, folder)
  return (async () => {
    let stat
    try {
      stat = await fs.stat(root)
    } catch {
      return
    }
    if (!stat.isDirectory()) return
    const walk = async (dir: string): Promise<void> => {
      const items = await fs.readdir(dir, { withFileTypes: true })
      for (const item of items) {
        if (item.name === '.DS_Store' || item.name === 'desktop.ini') continue
        const full = join(dir, item.name)
        if (item.isDirectory()) {
          await walk(full)
          continue
        }
        if (!item.isFile()) continue
        const rel = relative(root, full).replace(/\\/g, '/')
        if (!rel) continue
        entries.push({ name: `${prefix}/${folder}/${rel}`, source: full })
      }
    }
    await walk(root)
  })()
}

export async function exportWorkshopPack(
  request: WorkshopExportRequest,
  onProgress: (progress: WorkshopExportProgress) => void
): Promise<WorkshopExportResult> {
  const instance = await getInstance(request.instanceId)
  const gameDir = await getInstanceGameDir(instance.id)
  const modsDir = join(gameDir, 'mods')
  const selected = new Set(
    request.options.includeMods
      .filter((file) => typeof file === 'string' && file.toLowerCase().endsWith('.jar'))
      .filter((file) => !/[\\/]/.test(file) && !file.includes('..'))
  )
  const entries: StoreZipEntry[] = []
  const dependencies: Record<string, string> = { minecraft: instance.gameVersion }
  if (instance.loader !== 'vanilla' && instance.loaderVersion) {
    const key =
      instance.loader === 'fabric'
        ? 'fabric-loader'
        : instance.loader === 'quilt'
          ? 'quilt-loader'
          : instance.loader
    dependencies[key] = instance.loaderVersion
  }
  entries.push({
    name: 'modrinth.index.json',
    data: Buffer.from(
      JSON.stringify(
        {
          formatVersion: 1,
          game: 'minecraft',
          name: `${instance.name} 工坊导出`.slice(0, 120),
          summary: instance.summary.slice(0, 600),
          files: [],
          dependencies
        },
        null,
        2
      )
    )
  })

  let modEntries: Dirent[] = []
  try {
    modEntries = await fs.readdir(modsDir, { withFileTypes: true })
  } catch {
    modEntries = []
  }
  for (const entry of modEntries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.jar')) continue
    if (!selected.has(entry.name)) continue
    entries.push({ name: `overrides/mods/${entry.name}`, source: join(modsDir, entry.name) })
  }
  if (request.options.includeConfigs) {
    await collectFolder(gameDir, 'config', 'overrides', entries)
    await collectFolder(gameDir, 'defaultconfigs', 'overrides', entries)
  }
  if (request.options.includeKubejs) {
    await collectFolder(gameDir, 'kubejs', 'overrides', entries)
    await collectFolder(gameDir, 'scripts', 'overrides', entries)
  }
  if (request.options.includeResourcepacks) {
    await collectFolder(gameDir, 'resourcepacks', 'overrides', entries)
  }
  if (request.options.includeShaderpacks) {
    await collectFolder(gameDir, 'shaderpacks', 'overrides', entries)
  }
  if (request.options.includeDatapacks) {
    await collectFolder(gameDir, 'datapacks', 'overrides', entries)
  }
  if (entries.length <= 1) throw new Error('没有可导出的模组或目录')

  try {
    await fs.mkdir(dirname(request.outputPath), { recursive: true })
    const result = await writeStoreZip(request.outputPath, entries, {
      onProgress: (done, total, bytes) => onProgress({ done, total, bytes })
    })
    return {
      path: request.outputPath,
      done: result.files,
      total: entries.length,
      bytes: result.bytes
    }
  } catch (error) {
    await fs.rm(request.outputPath, { force: true }).catch(() => undefined)
    throw error
  }
}

function stripCodeFence(value: string): string {
  const text = value.trim()
  const fenced = text.match(/```(?:javascript|js)?\s*([\s\S]*?)```/i)
  if (fenced) return fenced[1].trim()
  return text
}

export async function generateKubeJsScript(
  request: KubeJsAiRequest
): Promise<KubeJsAiResult> {
  const config = await getAiRuntimeConfig()
  if (!config.enabled) throw new Error('AI 辅助还没有启用')
  if (!config.baseUrl || !config.model) throw new Error('请先填写 AI 服务地址和模型')
  const prompt = request.prompt.trim().slice(0, 4000)
  if (!prompt) throw new Error('请先描述你想要的 KubeJS 效果')
  const instance = await getInstance(request.instanceId)
  const scanned = await scanMods(instance)
  const mods = scanned.slice(0, 180).map((mod) => ({
    id: mod.meta?.id ?? null,
    name: mod.meta?.name ?? mod.file,
    side: mod.side
  }))
  const current = (request.currentContent ?? '').slice(0, 8000)
  const rawSelection = request.selection
  const selection =
    rawSelection &&
    typeof rawSelection.text === 'string' &&
    rawSelection.text.trim() &&
    rawSelection.text.length <= 12000
      ? {
          startLine: Math.max(1, Math.round(Number(rawSelection.startLine) || 1)),
          endLine: Math.max(
            1,
            Math.round(Number(rawSelection.endLine) || Number(rawSelection.startLine) || 1)
          ),
          text: rawSelection.text.slice(0, 12000)
        }
      : null
  const endpoint = /\/chat\/completions$/i.test(config.baseUrl)
    ? config.baseUrl
    : `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`
  const system = selection
    ? `你是 Minecraft KubeJS 脚本助手。当前实例是 Minecraft ${instance.gameVersion}，加载器 ${instance.loader}${instance.loaderVersion ? ` ${instance.loaderVersion}` : ''}。
用户选中了当前脚本的第 ${selection.startLine}-${selection.endLine} 行，要求只改写这段选区。只返回替换选区的代码，不要返回完整文件、选区外的内容或 Markdown 代码块；保持原有缩进风格，不要编造不存在的模组 ID。
只返回一个 JSON 对象：{"code":"替换选区的 KubeJS 代码","notes":"一句话说明和需要用户替换的占位符"}。`
    : `你是 Minecraft KubeJS 脚本助手。当前实例是 Minecraft ${instance.gameVersion}，加载器 ${instance.loader}${instance.loaderVersion ? ` ${instance.loaderVersion}` : ''}。
根据用户需求写一份可保存到 kubejs/server_scripts 或 kubejs/client_scripts 的完整脚本。只使用 KubeJS 的 ServerEvents/ClientEvents/StartupEvents 等 API；不要编造模组内容；不确定的配方 ID 用注释标出并说明。
只返回一个 JSON 对象，不要 Markdown 代码块：{"code":"完整脚本","notes":"一句话说明和需要用户替换的占位符"}。`
  const payload = JSON.stringify(
    {
      mods,
      currentPath: request.currentPath ?? null,
      currentContent: current || null,
      selection: selection
        ? {
            startLine: selection.startLine,
            endLine: selection.endLine,
            text: selection.text
          }
        : null,
      request: prompt
    },
    null,
    2
  )
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.key ? { Authorization: `Bearer ${config.key}` } : {})
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: payload }
        ],
        temperature: 0.2,
        max_tokens: selection ? 1800 : 2400,
        stream: false
      }),
      signal: controller.signal
    })
  } catch (error) {
    if (controller.signal.aborted) throw new Error('AI 生成超时，请检查网络或换一个模型')
    throw new Error(`无法连接 AI 服务：${error instanceof Error ? error.message : '网络错误'}`)
  } finally {
    clearTimeout(timer)
  }
  const raw = await response.text()
  if (!response.ok) throw new Error(`AI 服务返回 ${response.status}：${raw.slice(0, 240)}`)
  let content = ''
  try {
    const parsed = JSON.parse(raw) as {
      choices?: { message?: { content?: string } }[]
      model?: string
    }
    content = parsed.choices?.[0]?.message?.content ?? ''
    const cleaned = stripCodeFence(content)
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start >= 0 && end > start) {
      const data = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>
      if (typeof data.code === 'string' && data.code.trim()) {
        return {
          code: data.code.slice(0, MAX_KUBEJS_FILE),
          notes:
            typeof data.notes === 'string'
              ? data.notes.replace(/[\u0000-\u001f]/g, ' ').slice(0, 1000)
              : '请检查占位符后保存。',
          model: parsed.model ?? config.model
        }
      }
    }
    if (content.trim()) {
      return {
        code: stripCodeFence(content).slice(0, MAX_KUBEJS_FILE),
        notes: 'AI 返回了脚本，请检查后保存。',
        model: parsed.model ?? config.model
      }
    }
  } catch {
    /* fall through */
  }
  throw new Error('AI 没有返回可用的 KubeJS 脚本')
}
