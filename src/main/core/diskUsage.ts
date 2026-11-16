import { promises as fs } from 'node:fs'
import { join, relative } from 'node:path'
import type { DiskOrphanEntry as OrphanEntry, DiskUsageReport } from '../../shared/types'
import { getSettings } from './config'
import { getInstancesRoot, listInstances } from './instances'

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await fs.stat(path)).isDirectory()
  } catch {
    return false
  }
}

/** 分批并发的递归文件大小统计，避免资产目录数万文件时阻塞主进程。 */
async function walkFiles(
  root: string,
  onFile: (path: string, size: number) => void
): Promise<number> {
  if (!(await isDirectory(root))) return 0
  let total = 0
  const stack: string[] = [root]
  while (stack.length > 0) {
    const batch = stack.splice(0, 64)
    const listings = await Promise.all(
      batch.map(async (dir) => {
        try {
          return await fs.readdir(dir, { withFileTypes: true })
        } catch {
          return []
        }
      })
    )
    const files: string[] = []
    for (let index = 0; index < batch.length; index += 1) {
      for (const entry of listings[index]) {
        const full = join(batch[index], entry.name)
        if (entry.isDirectory()) stack.push(full)
        else if (entry.isFile()) files.push(full)
      }
    }
    for (let index = 0; index < files.length; index += 128) {
      const chunk = files.slice(index, index + 128)
      const stats = await Promise.all(
        chunk.map(async (file) => {
          try {
            return (await fs.stat(file)).size
          } catch {
            return 0
          }
        })
      )
      for (let item = 0; item < chunk.length; item += 1) {
        total += stats[item]
        onFile(chunk[item], stats[item])
      }
    }
  }
  return total
}

interface VersionJsonLite {
  inheritsFrom?: string
  libraries?: {
    downloads?: {
      artifact?: { path?: string }
      classifiers?: Record<string, { path?: string }>
    }
  }[]
  javaVersion?: { component?: string; majorVersion?: number }
}

async function readVersionJson(file: string): Promise<VersionJsonLite | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as VersionJsonLite
  } catch {
    return null
  }
}

async function collectBaseDirs(): Promise<string[]> {
  const settings = getSettings()
  const dirs = new Set<string>([settings.gameDir, ...settings.versionFolders])
  try {
    for (const instance of await listInstances()) {
      const base = instance.external?.baseDir ?? instance.baseDir
      if (base) dirs.add(base)
    }
  } catch {
    /* ignore */
  }
  return [...dirs]
}

async function collectReferenced(baseDirs: string[]): Promise<{
  libraries: Set<string>
  assets: Set<string>
  versionsChecked: number
}> {
  const libraries = new Set<string>()
  const assets = new Set<string>()
  let versionsChecked = 0
  for (const base of baseDirs) {
    const versionsDir = join(base, 'versions')
    let entries: string[] = []
    try {
      entries = await fs.readdir(versionsDir)
    } catch {
      continue
    }
    for (const entry of entries) {
      const chain: string[] = [entry]
      const seen = new Set<string>()
      for (let depth = 0; depth < chain.length && depth < 8; depth += 1) {
        const id = chain[depth]
        if (seen.has(id)) continue
        seen.add(id)
        const json = await readVersionJson(join(versionsDir, id, `${id}.json`))
        if (!json) continue
        versionsChecked += 1
        if (json.inheritsFrom && !seen.has(json.inheritsFrom)) chain.push(json.inheritsFrom)
        for (const library of json.libraries ?? []) {
          const artifact = library.downloads?.artifact?.path
          if (artifact) libraries.add(artifact.replace(/\\/g, '/'))
          for (const classifier of Object.values(library.downloads?.classifiers ?? {})) {
            if (classifier?.path) libraries.add(classifier.path.replace(/\\/g, '/'))
          }
        }
      }
    }
    const indexesDir = join(base, 'assets', 'indexes')
    let indexes: string[] = []
    try {
      indexes = await fs.readdir(indexesDir)
    } catch {
      indexes = []
    }
    for (const index of indexes) {
      if (!index.endsWith('.json')) continue
      try {
        const parsed = JSON.parse(await fs.readFile(join(indexesDir, index), 'utf8')) as {
          objects?: Record<string, { hash?: string }>
        }
        for (const object of Object.values(parsed.objects ?? {})) {
          if (object?.hash) assets.add(`objects/${object.hash.slice(0, 2)}/${object.hash}`)
        }
      } catch {
        /* ignore bad index */
      }
    }
  }
  return { libraries, assets, versionsChecked }
}

export async function scanDiskUsage(): Promise<DiskUsageReport> {
  const settings = getSettings()
  const baseDirs = await collectBaseDirs()
  const referenced = await collectReferenced(baseDirs)
  const orphanLibraries: OrphanEntry[] = []
  const orphanAssets: OrphanEntry[] = []
  let versionsBytes = 0
  let librariesBytes = 0
  let assetsBytes = 0
  let runtimeBytes = 0
  for (const base of baseDirs) {
    versionsBytes += await walkFiles(join(base, 'versions'), () => undefined)
    librariesBytes += await walkFiles(join(base, 'libraries'), (path, size) => {
      const rel = relative(join(base, 'libraries'), path).replace(/\\/g, '/')
      if (!referenced.libraries.has(rel)) orphanLibraries.push({ path, size })
    })
    assetsBytes += await walkFiles(join(base, 'assets'), (path, size) => {
      const rel = relative(join(base, 'assets'), path).replace(/\\/g, '/')
      if (rel.startsWith('objects/') && !referenced.assets.has(rel)) {
        orphanAssets.push({ path, size })
      }
    })
    runtimeBytes += await walkFiles(join(base, 'runtime'), () => undefined)
  }
  const instancesBytes = await walkFiles(getInstancesRoot(), () => undefined)
  return {
    scannedAt: Date.now(),
    gameDir: settings.gameDir,
    bases: baseDirs,
    versionsChecked: referenced.versionsChecked,
    versionsBytes,
    librariesBytes,
    assetsBytes,
    runtimeBytes,
    instancesBytes,
    orphanLibraries,
    orphanAssets,
    orphanLibrariesBytes: orphanLibraries.reduce((sum, item) => sum + item.size, 0),
    orphanAssetsBytes: orphanAssets.reduce((sum, item) => sum + item.size, 0)
  }
}

export async function cleanOrphans(scope: 'libraries' | 'assets'): Promise<{
  removed: number
  freedBytes: number
}> {
  const report = await scanDiskUsage()
  const entries = scope === 'libraries' ? report.orphanLibraries : report.orphanAssets
  let removed = 0
  let freedBytes = 0
  for (const entry of entries) {
    try {
      await fs.rm(entry.path, { force: true })
      removed += 1
      freedBytes += entry.size
    } catch {
      /* file in use or gone */
    }
  }
  return { removed, freedBytes }
}