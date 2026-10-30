import { createHash } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'

const SHA1 = /^[0-9a-f]{40}$/i

let cacheRoot: string | null = null
let cacheLimitBytes: number | null = null
let lastPruneAt = 0
let pruning: Promise<void> | null = null
const pendingStores = new Map<string, Promise<void>>()

export function setContentCacheDir(dir: string | null): void {
  cacheRoot = dir
  if (dir) void fs.mkdir(dir, { recursive: true }).catch(() => undefined)
}

export function getContentCacheDir(): string | null {
  return cacheRoot
}

export function setContentCacheLimit(limitMb: number): void {
  cacheLimitBytes = limitMb > 0 ? limitMb * 1024 * 1024 : null
  lastPruneAt = 0
  if (cacheLimitBytes) void pruneCacheIfNeeded(true)
}

export async function cacheStats(): Promise<{ bytes: number; count: number }> {
  if (!cacheRoot) return { bytes: 0, count: 0 }
  let bytes = 0
  let count = 0
  let buckets
  try {
    buckets = await fs.readdir(cacheRoot, { withFileTypes: true })
  } catch {
    return { bytes: 0, count: 0 }
  }
  for (const bucket of buckets) {
    if (!bucket.isDirectory()) continue
    let entries
    try {
      entries = await fs.readdir(join(cacheRoot, bucket.name), { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue
      try {
        const stat = await fs.stat(join(cacheRoot, bucket.name, entry.name))
        bytes += stat.size
        count += 1
      } catch {
        /* ignore */
      }
    }
  }
  return { bytes, count }
}

export async function clearContentCache(): Promise<{ bytes: number; count: number }> {
  if (!cacheRoot) return { bytes: 0, count: 0 }
  const before = await cacheStats()
  try {
    const buckets = await fs.readdir(cacheRoot, { withFileTypes: true })
    for (const bucket of buckets) {
      if (bucket.isDirectory()) {
        await fs.rm(join(cacheRoot, bucket.name), { recursive: true, force: true })
      }
    }
  } catch {
    /* clear best-effort */
  }
  return before
}

async function pruneCache(limitBytes: number): Promise<void> {
  if (!cacheRoot) return
  const objects: { path: string; size: number; mtime: number; key: string }[] = []
  let buckets
  try {
    buckets = await fs.readdir(cacheRoot, { withFileTypes: true })
  } catch {
    return
  }
  for (const bucket of buckets) {
    if (!bucket.isDirectory()) continue
    let entries
    try {
      entries = await fs.readdir(join(cacheRoot, bucket.name), { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isFile() || !SHA1.test(entry.name)) continue
      try {
        const path = join(cacheRoot, bucket.name, entry.name)
        const stat = await fs.stat(path)
        objects.push({
          path,
          size: stat.size,
          mtime: stat.mtimeMs,
          key: entry.name.toLowerCase()
        })
      } catch {
        /* ignore */
      }
    }
  }
  let total = objects.reduce((sum, item) => sum + item.size, 0)
  if (total <= limitBytes) return
  objects.sort((a, b) => a.mtime - b.mtime)
  for (const item of objects) {
    if (total <= limitBytes) break
    if (pendingStores.has(item.key)) continue
    try {
      await fs.rm(item.path, { force: true })
      total -= item.size
    } catch {
      /* ignore */
    }
  }
}

function pruneCacheIfNeeded(force = false): Promise<void> {
  if (!cacheLimitBytes) return Promise.resolve()
  if (!force && Date.now() - lastPruneAt < 5 * 60_000) return Promise.resolve()
  if (pruning) return pruning
  lastPruneAt = Date.now()
  pruning = pruneCache(cacheLimitBytes)
    .catch(() => undefined)
    .finally(() => {
      pruning = null
    })
  return pruning
}

function objectPath(sha1: string): string | null {
  if (!cacheRoot || !SHA1.test(sha1)) return null
  const hash = sha1.toLowerCase()
  return join(cacheRoot, hash.slice(0, 2), hash)
}

export async function hashFile(
  path: string,
  signal?: AbortSignal
): Promise<{ sha1: string; size: number } | null> {
  try {
    const hash = createHash('sha1')
    let size = 0
    for await (const chunk of createReadStream(path)) {
      if (signal?.aborted) return null
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      hash.update(buffer)
      size += buffer.length
    }
    return { sha1: hash.digest('hex'), size }
  } catch {
    return null
  }
}

/**
 * 尝试从全局 SHA1 缓存把文件链接到目标位置。
 * 同卷优先硬链接，不额外占空间；跨卷退化为复制。
 */
export async function linkFromCache(
  sha1: string,
  destination: string,
  expectedSize?: number | null
): Promise<boolean> {
  const object = objectPath(sha1)
  if (!object) return false
  try {
    const stat = await fs.stat(object)
    if (stat.size <= 0) return false
    if (expectedSize != null && stat.size !== expectedSize) {
      await fs.rm(object, { force: true }).catch(() => undefined)
      return false
    }
    await fs.utimes(object, new Date(), new Date()).catch(() => undefined)
    await fs.mkdir(dirname(destination), { recursive: true })
    await fs.rm(destination, { force: true }).catch(() => undefined)
    try {
      await fs.link(object, destination)
      return true
    } catch {
      try {
        await fs.copyFile(object, destination)
        return true
      } catch {
        return false
      }
    }
  } catch {
    return false
  }
}

/**
 * 下载并校验完成后写入全局缓存。相同 SHA1 的并发写入会被合并。
 */
export async function storeInCache(
  sha1: string,
  source: string,
  expectedSize?: number | null
): Promise<void> {
  const object = objectPath(sha1)
  if (!object) return
  const key = sha1.toLowerCase()
  const pending = pendingStores.get(key)
  if (pending) {
    await pending
    return
  }

  const task = (async () => {
    try {
      const existing = await fs.stat(object)
      if (existing.size > 0 && (expectedSize == null || existing.size === expectedSize)) return
      await fs.rm(object, { force: true }).catch(() => undefined)
    } catch {
      /* cache miss */
    }

    try {
      const sourceStat = await fs.stat(source)
      if (sourceStat.size <= 0) return
      if (expectedSize != null && sourceStat.size !== expectedSize) return
      await fs.mkdir(dirname(object), { recursive: true })
      try {
        await fs.link(source, object)
        void pruneCacheIfNeeded()
        return
      } catch {
        /* 跨卷或文件系统不支持硬链接，退化为复制 */
      }
      const temp = `${object}.${process.pid}.${Date.now()}.tmp`
      try {
        await fs.copyFile(source, temp)
        await fs.rename(temp, object)
        void pruneCacheIfNeeded()
      } catch {
        await fs.rm(temp, { force: true }).catch(() => undefined)
      }
    } catch {
      /* 缓存失败不影响下载结果 */
    }
  })()

  pendingStores.set(key, task)
  try {
    await task
  } finally {
    pendingStores.delete(key)
  }
}
