import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { InstalledVersion } from '../../shared/types'
import { getVersionStats } from './config'
import type { VersionJson } from './mojangTypes'
import { pathExists, safeJoin } from './version'

const readCache = new Map<string, { at: number; list: InstalledVersion[] }>()

function detectLoader(id: string, json: VersionJson): string | null {
  const haystack = [
    id,
    json.mainClass ?? '',
    ...(json.libraries ?? []).map((library) => library.name)
  ]
    .join(' ')
    .toLowerCase()
  if (haystack.includes('neoforge')) return 'NeoForge'
  if (haystack.includes('net.minecraftforge') || haystack.includes('forge')) return 'Forge'
  if (haystack.includes('quilt-loader')) return 'Quilt'
  if (haystack.includes('fabric-loader') || haystack.includes('net.fabricmc')) return 'Fabric'
  if (haystack.includes('optifine')) return 'OptiFine'
  if (haystack.includes('liteloader')) return 'LiteLoader'
  return null
}

async function readJsonQuiet(path: string): Promise<VersionJson | null> {
  try {
    return JSON.parse(await fs.readFile(path, 'utf8')) as VersionJson
  } catch {
    return null
  }
}

async function parentJavaMajor(gameDir: string, json: VersionJson, depth = 0): Promise<number | null> {
  if (json.javaVersion?.majorVersion) return json.javaVersion.majorVersion
  if (!json.inheritsFrom || depth > 5) return null
  const parent = await readJsonQuiet(join(gameDir, 'versions', json.inheritsFrom, `${json.inheritsFrom}.json`))
  return parent ? parentJavaMajor(gameDir, parent, depth + 1) : null
}

async function hasLaunchJar(gameDir: string, id: string, json: VersionJson, depth = 0): Promise<boolean> {
  if (json.jar) return pathExists(join(gameDir, 'versions', json.jar, `${json.jar}.jar`))
  if (await pathExists(join(gameDir, 'versions', id, `${id}.jar`))) return true
  if (json.inheritsFrom && depth < 5) {
    const parent = await readJsonQuiet(
      join(gameDir, 'versions', json.inheritsFrom, `${json.inheritsFrom}.json`)
    )
    return parent ? hasLaunchJar(gameDir, json.inheritsFrom, parent, depth + 1) : false
  }
  return false
}

export async function listInstalledVersions(gameDir: string): Promise<InstalledVersion[]> {
  const versionsDir = join(gameDir, 'versions')
  const cached = readCache.get(versionsDir)
  if (cached && Date.now() - cached.at < 2500) return cached.list

  let entries
  try {
    entries = await fs.readdir(versionsDir, { withFileTypes: true })
  } catch {
    return []
  }
  const stats = getVersionStats()
  const result: InstalledVersion[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const id = entry.name
    const json = await readJsonQuiet(join(versionsDir, id, `${id}.json`))
    if (!json) continue
    result.push({
      id,
      type: json.type ?? 'release',
      releaseTime: json.releaseTime ?? json.time ?? null,
      lastPlayed: stats[id]?.lastPlayed ?? null,
      loader: detectLoader(id, json),
      hasJar: await hasLaunchJar(gameDir, id, json),
      javaMajor: await parentJavaMajor(gameDir, json),
      inheritsFrom: json.inheritsFrom ?? null
    })
  }

  result.sort((a, b) => {
    const timeA = a.lastPlayed ?? (a.releaseTime ? Date.parse(a.releaseTime) : 0)
    const timeB = b.lastPlayed ?? (b.releaseTime ? Date.parse(b.releaseTime) : 0)
    return timeB - timeA
  })
  readCache.set(versionsDir, { at: Date.now(), list: result })
  return result
}

export function invalidateVersionCache(gameDir?: string): void {
  if (gameDir) readCache.delete(join(gameDir, 'versions'))
  else readCache.clear()
}

/** 读取版本及其 inheritsFrom 链，用于删除实例时保护共享的基础版本。 */
export async function readVersionChain(gameDir: string, id: string): Promise<string[]> {
  const chain: string[] = []
  const visited = new Set<string>()
  let cursor: string | undefined = id
  while (cursor && !visited.has(cursor) && /^[A-Za-z0-9._+\-]{1,128}$/.test(cursor)) {
    visited.add(cursor)
    chain.push(cursor)
    const json = await readJsonQuiet(
      join(gameDir, 'versions', cursor, `${cursor}.json`)
    )
    cursor =
      json?.inheritsFrom && /^[A-Za-z0-9._+\-]{1,128}$/.test(json.inheritsFrom)
        ? json.inheritsFrom
        : undefined
  }
  return chain
}

export async function listVersionIds(gameDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(join(gameDir, 'versions'), { withFileTypes: true })
    const ids: string[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (await pathExists(join(gameDir, 'versions', entry.name, `${entry.name}.json`))) {
        ids.push(entry.name)
      }
    }
    return ids
  } catch {
    return []
  }
}

export async function versionFolderSize(gameDir: string, id: string): Promise<number> {
  async function walk(dir: string): Promise<number> {
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return 0
    }
    let total = 0
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        total += await walk(path)
      } else if (entry.isFile()) {
        try {
          total += Number((await fs.stat(path)).size)
        } catch {
          /* ignore disappearing file */
        }
      }
    }
    return total
  }
  return walk(join(gameDir, 'versions', id))
}

export async function removeVersionFolder(gameDir: string, id: string): Promise<void> {
  if (!id || id.includes('/') || id.includes('\\') || id.includes('..')) {
    throw new Error('无效的版本名称')
  }
  const versionsRoot = join(gameDir, 'versions')
  const folder = safeJoin(versionsRoot, id)
  if (!(await pathExists(folder))) throw new Error(`版本 ${id} 不存在`)
  await fs.rm(folder, { recursive: true, force: true })
  invalidateVersionCache(gameDir)
}
