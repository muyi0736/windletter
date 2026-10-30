import { promises as fs } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { hashFile } from './contentCache'
import { CancellationError } from './net'

/**
 * 整合包安装前复用本机其他实例里的同名文件。
 * 只接受 basename + size 完全一致、且 SHA1 校验通过的候选；命中后优先硬链接，
 * 跨卷或文件系统不支持时退回复制。任何复用失败都只是回到下载流程，不会让安装失败。
 */
export interface PackReuseJob {
  destination: string
  sha1: string
  size: number
}

export interface PackReuseProgress {
  checked: number
  total: number
  reused: number
  bytes: number
  bytesTotal: number
  label?: string
}

export interface PackReuseResult {
  reused: number
  reusedBytes: number
  scanned: number
  hashed: number
}

interface Candidate {
  path: string
  size: number
}

export interface PackReuseSource {
  gameDir: string
  baseDir?: string | null
}

const CONTENT_DIRS = ['mods', 'resourcepacks', 'shaderpacks', 'datapacks']
const MAX_SCAN_FILES = 60_000
const MAX_DEPTH = 2
const REUSE_ROOT_LIMIT = 240
const SHA1 = /^[0-9a-f]{40}$/i

function keyOf(name: string, size: number): string {
  return `${process.platform === 'win32' ? name.toLowerCase() : name}\0${size}`
}

function normalized(path: string): string {
  const absolute = resolve(path)
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute
}

async function addReuseRoot(
  roots: Map<string, string>,
  path: string | null | undefined,
  targetKey: string
): Promise<void> {
  if (!path || roots.size >= REUSE_ROOT_LIMIT) return
  const full = resolve(path)
  const key = normalized(full)
  if (key === targetKey || roots.has(key)) return
  try {
    if (!(await fs.stat(full)).isDirectory()) return
  } catch {
    return
  }
  roots.set(key, full)
}

async function addVersionReuseRoots(
  roots: Map<string, string>,
  base: string | null | undefined,
  targetKey: string
): Promise<void> {
  if (!base || roots.size >= REUSE_ROOT_LIMIT) return
  let entries
  try {
    entries = await fs.readdir(join(base, 'versions'), { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (roots.size >= REUSE_ROOT_LIMIT) return
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    await addReuseRoot(roots, join(base, 'versions', entry.name), targetKey)
  }
}

/**
 * 先收集所有可扫描的实例目录；外部实例会额外扫描它的同级 versions，
 * 这样 PCL2 / HMCL 的其他整合包目录也能被复用。
 */
export async function collectPackReuseRoots(options: {
  target: string
  baseGameDir: string
  sources: PackReuseSource[]
}): Promise<string[]> {
  const roots = new Map<string, string>()
  const targetKey = normalized(options.target)
  for (const source of options.sources) {
    await addReuseRoot(roots, source.gameDir, targetKey)
    if (source.baseDir) {
      await addReuseRoot(roots, source.baseDir, targetKey)
      await addVersionReuseRoots(roots, source.baseDir, targetKey)
    }
  }
  await addReuseRoot(roots, options.baseGameDir, targetKey)
  await addVersionReuseRoots(roots, options.baseGameDir, targetKey)
  return [...roots.values()]
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.stat(path)
    return true
  } catch {
    return false
  }
}

async function place(
  source: string,
  destination: string,
  sha1: string,
  signal: AbortSignal
): Promise<boolean> {
  try {
    await fs.mkdir(dirname(destination), { recursive: true })
    if (await exists(destination)) return false
  } catch {
    return false
  }

  try {
    await fs.link(source, destination)
    return true
  } catch {
    /* 跨卷、权限或文件系统不支持硬链接时退回复制 */
  }

  try {
    await fs.copyFile(source, destination)
    const copied = await hashFile(destination, signal)
    if (!copied || copied.sha1.toLowerCase() !== sha1.toLowerCase()) {
      await fs.rm(destination, { force: true }).catch(() => undefined)
      return false
    }
    return true
  } catch {
    await fs.rm(destination, { force: true }).catch(() => undefined)
    return false
  }
}

export async function reuseLocalPackFiles(options: {
  jobs: PackReuseJob[]
  roots: string[]
  signal: AbortSignal
  onProgress?: (progress: PackReuseProgress) => void
}): Promise<PackReuseResult> {
  const result: PackReuseResult = { reused: 0, reusedBytes: 0, scanned: 0, hashed: 0 }
  const pending: PackReuseJob[] = []
  for (const job of options.jobs) {
    if (!SHA1.test(job.sha1) || !Number.isFinite(job.size) || job.size <= 0) continue
    if (await exists(job.destination)) continue
    pending.push(job)
  }
  const total = pending.length
  const bytesTotal = pending.reduce((sum, job) => sum + job.size, 0)
  if (!total) return result

  const emit = (checked: number, label?: string): void => {
    options.onProgress?.({
      checked,
      total,
      reused: result.reused,
      bytes: result.reusedBytes,
      bytesTotal,
      label
    })
  }

  const needed = new Set(pending.map((job) => keyOf(basename(job.destination), job.size)))
  const candidates = new Map<string, Candidate[]>()
  const seenFiles = new Set<string>()
  let stopped = false

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (stopped) return
    if (options.signal.aborted) throw new CancellationError()
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (stopped) return
      if (options.signal.aborted) throw new CancellationError()
      if (result.scanned >= MAX_SCAN_FILES) {
        stopped = true
        return
      }
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (depth < MAX_DEPTH && !entry.name.startsWith('.')) await walk(full, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      if (entry.name.endsWith('.part') || entry.name.endsWith('.disabled')) continue
      const pathKey = normalized(full)
      if (seenFiles.has(pathKey)) continue
      seenFiles.add(pathKey)
      let stat
      try {
        stat = await fs.stat(full)
      } catch {
        continue
      }
      result.scanned += 1
      if (!stat.isFile() || stat.size <= 0) continue
      const key = keyOf(entry.name, stat.size)
      if (!needed.has(key)) continue
      const list = candidates.get(key) ?? []
      list.push({ path: full, size: stat.size })
      candidates.set(key, list)
    }
  }

  for (const root of options.roots) {
    if (stopped) break
    if (options.signal.aborted) throw new CancellationError()
    for (const contentDir of CONTENT_DIRS) {
      if (stopped) break
      await walk(join(root, contentDir), 0)
    }
  }

  emit(0)
  const hashCache = new Map<string, Promise<string | null>>()
  let checked = 0
  for (const job of pending) {
    if (options.signal.aborted) throw new CancellationError()
    const target = normalized(job.destination)
    const list = candidates.get(keyOf(basename(job.destination), job.size)) ?? []
    for (const candidate of list) {
      if (options.signal.aborted) throw new CancellationError()
      if (normalized(candidate.path) === target) continue
      let hashing = hashCache.get(candidate.path)
      if (!hashing) {
        result.hashed += 1
        hashing = hashFile(candidate.path, options.signal)
          .then((info) => info?.sha1 ?? null)
          .catch(() => null)
        hashCache.set(candidate.path, hashing)
      }
      const digest = await hashing
      if (options.signal.aborted) throw new CancellationError()
      if (!digest || digest.toLowerCase() !== job.sha1.toLowerCase()) continue
      if (await place(candidate.path, job.destination, job.sha1, options.signal)) {
        result.reused += 1
        result.reusedBytes += job.size
        break
      }
    }
    checked += 1
    if (checked % 4 === 0 || checked === total) emit(checked, basename(job.destination))
  }
  emit(total)
  return result
}
