import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { getInstance, getInstanceDir, getInstanceGameDir } from './instances'
import { pathExists, writeFileAtomic } from './version'

export interface ResourcePackEntry {
  name: string
  kind: 'zip' | 'dir'
  enabled: boolean
  order: number
}

export interface ResourcePackList {
  packs: ResourcePackEntry[]
  hasOptions: boolean
}

function parseResourcePacksLine(line: string): string[] {
  try {
    const parsed = JSON.parse(line.slice('resourcePacks:'.length).trim()) as unknown
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

async function readEnabledOrder(gameDir: string): Promise<{ order: string[]; hasOptions: boolean }> {
  const optionsPath = join(gameDir, 'options.txt')
  try {
    const text = await fs.readFile(optionsPath, 'utf8')
    const line = text.split(/\r?\n/).find((item) => item.startsWith('resourcePacks:'))
    return { order: line ? parseResourcePacksLine(line) : [], hasOptions: true }
  } catch {
    return { order: [], hasOptions: false }
  }
}

async function readPackNames(gameDir: string): Promise<{ name: string; kind: 'zip' | 'dir' }[]> {
  const rpDir = join(gameDir, 'resourcepacks')
  const out: { name: string; kind: 'zip' | 'dir' }[] = []
  try {
    const entries = await fs.readdir(rpDir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) out.push({ name: entry.name, kind: 'dir' })
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.zip'))
        out.push({ name: entry.name, kind: 'zip' })
    }
  } catch {
    /* 目录不存在 */
  }
  return out
}

export async function listResourcePacks(instanceId: string): Promise<ResourcePackList> {
  await getInstance(instanceId)
  const gameDir = await getInstanceGameDir(instanceId)
  const [names, { order, hasOptions }] = await Promise.all([
    readPackNames(gameDir),
    readEnabledOrder(gameDir)
  ])
  const fileEntries = order.filter((e) => e.startsWith('file/')).map((e) => e.slice(5))
  const packs = names.map((n) => {
    const idx = fileEntries.indexOf(n.name)
    return { ...n, enabled: idx >= 0, order: idx >= 0 ? idx : Number.MAX_SAFE_INTEGER }
  })
  packs.sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1
    if (a.enabled) return a.order - b.order
    return a.name.localeCompare(b.name, 'zh-CN')
  })
  return { packs, hasOptions }
}

export async function applyResourcePacks(
  instanceId: string,
  enabledNames: string[]
): Promise<ResourcePackList> {
  await getInstance(instanceId)
  const gameDir = await getInstanceGameDir(instanceId)
  const names = await readPackNames(gameDir)
  const existing = new Set(names.map((n) => n.name))
  for (const name of enabledNames) {
    if (!existing.has(name)) throw new Error(`资源包不存在：${name}`)
  }
  const optionsPath = join(gameDir, 'options.txt')
  if (!(await pathExists(optionsPath))) {
    throw new Error('还没有 options.txt；请先启动一次游戏，再回来调整资源包')
  }
  const text = await fs.readFile(optionsPath, 'utf8')
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  let found = false
  const next = lines.map((line) => {
    if (!line.startsWith('resourcePacks:')) return line
    found = true
    const current = parseResourcePacksLine(line)
    const nonFile = current.filter((e) => !e.startsWith('file/'))
    const merged = [...nonFile, ...enabledNames.map((n) => `file/${n}`)]
    return `resourcePacks:${JSON.stringify(merged)}`
  })
  if (!found) {
    next.push(`resourcePacks:${JSON.stringify(['vanilla', ...enabledNames.map((n) => `file/${n}`)])}`)
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupDir = join(getInstanceDir(instanceId), 'backups', 'resourcepacks', stamp)
  await fs.mkdir(backupDir, { recursive: true })
  await fs.copyFile(optionsPath, join(backupDir, 'options.txt'))
  await writeFileAtomic(optionsPath, next.join(eol))
  return listResourcePacks(instanceId)
}
