import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { hashFile, linkFromCache, storeInCache } from './contentCache'

export let USER_AGENT = 'WindletterLauncher/dev'

/** 启动时用真实产品版本覆盖，避免更新下载等请求仍显示旧的开发版本号。 */
export function setUserAgentVersion(version: string): void {
  const value = version.trim()
  if (value) USER_AGENT = `WindletterLauncher/${value}`
}
const JSON_TIMEOUT = 30_000
const FILE_TIMEOUT = 5 * 60_000
const STALL_TIMEOUT = 20_000
const HOST_CONCURRENCY = 16
const SEGMENT_MIN_BYTES = 4 * 1024 * 1024
const SEGMENT_MAX = 16
const SOURCE_PROBE_MIN_BYTES = 4 * 1024 * 1024
const SOURCE_PROBE_TIMEOUT = 2_000
const SOURCE_PROBE_TTL = 10 * 60_000
const SPEED_PROBE_TIMEOUT = 12_000

export class CancellationError extends Error {
  constructor(message = '操作已取消') {
    super(message)
    this.name = 'CancellationError'
  }
}

export class NetworkError extends Error {
  constructor(message: string, readonly url?: string) {
    super(message)
    this.name = 'NetworkError'
  }
}

function combinedSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

function friendlyError(err: unknown, url: string): Error {
  if (err instanceof CancellationError) return err
  if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
    return new NetworkError('网络请求超时，请检查网络状态后重试', url)
  }
  if (err instanceof NetworkError) return err
  const cause = (err as { cause?: { code?: string; message?: string } } | null)?.cause
  const code = cause?.code ?? ''
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return new NetworkError('无法连接到下载服务器，请检查网络或切换下载源', url)
  }
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET') {
    return new NetworkError('连接被服务器重置，请稍后重试或切换下载源', url)
  }
  return new NetworkError(`网络请求失败：${cause?.message ?? (err as Error)?.message ?? '未知错误'}`, url)
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * GitHub Release 资产 API 只有在 Accept: application/octet-stream 时才返回文件；
 * 普通地址继续使用通配 Accept。探测、分片和单连接下载都必须带同一个头。
 */
function downloadAccept(url: string): string {
  try {
    const parsed = new URL(url)
    if (
      parsed.hostname.toLowerCase() === 'api.github.com' &&
      /^\/repos\/[^/]+\/[^/]+\/releases\/assets\/\d+$/.test(parsed.pathname)
    ) {
      return 'application/octet-stream'
    }
  } catch {
    /* 非法地址交给下游报错 */
  }
  return '*/*'
}

/* ---------- 分主机并发 ---------- */
interface HostState {
  active: number
  waiters: Array<() => void>
}

const hostStates = new Map<string, HostState>()

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin.toLowerCase()
  } catch {
    return null
  }
}

async function acquireHost(host: string): Promise<() => void> {
  let state = hostStates.get(host)
  if (!state) {
    state = { active: 0, waiters: [] }
    hostStates.set(host, state)
  }
  const release = (): void => {
    const current = hostStates.get(host)
    if (!current) return
    current.active = Math.max(0, current.active - 1)
    const next = current.waiters.shift()
    if (next) next()
  }
  if (state.active < HOST_CONCURRENCY) {
    state.active += 1
    return release
  }
  await new Promise<void>((resolve) => state!.waiters.push(resolve))
  state.active += 1
  return release
}

/* ---------- 候选线路测速 ---------- */
const sourceProbeCache = new Map<string, { latency: number; at: number }>()

async function probeLatency(url: string, signal?: AbortSignal): Promise<number | null> {
  const started = Date.now()
  const signals: AbortSignal[] = [AbortSignal.timeout(SOURCE_PROBE_TIMEOUT)]
  if (signal) signals.push(signal)
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: downloadAccept(url),
        Range: 'bytes=0-0'
      },
      signal: AbortSignal.any(signals)
    })
    await response.body?.cancel().catch(() => undefined)
    if (!response.ok) return null
    return Date.now() - started
  } catch {
    return null
  }
}

async function probeThroughput(
  url: string,
  bytes: number,
  signal?: AbortSignal
): Promise<number | null> {
  const started = Date.now()
  const count = 4
  const chunk = Math.max(32 * 1024, Math.floor(bytes / count))
  const signals: AbortSignal[] = [AbortSignal.timeout(SPEED_PROBE_TIMEOUT)]
  if (signal) signals.push(signal)
  const timeout = AbortSignal.any(signals)
  try {
    let total = 0
    const parts = await Promise.all(
      Array.from({ length: count }, async (_value, index) => {
        const start = index * chunk
        const response = await fetch(url, {
          headers: {
            'User-Agent': USER_AGENT,
            Accept: downloadAccept(url),
            Range: `bytes=${start}-${start + chunk - 1}`
          },
          signal: timeout
        })
        if (response.status !== 206) {
          await response.body?.cancel().catch(() => undefined)
          return -1
        }
        const body = await response.arrayBuffer()
        return body.byteLength
      })
    )
    if (parts.some((value) => value < 0)) return null
    total = parts.reduce((sum, value) => sum + value, 0)
    const elapsed = Math.max(1, Date.now() - started)
    return total > 0 ? total / elapsed : null
  } catch {
    return null
  }
}

async function orderCandidatesByLatency(
  urls: string[],
  signal?: AbortSignal,
  probeBytes = 0
): Promise<string[]> {
  if (urls.length < 2) return urls
  if (probeBytes > 0) {
    const speeds = new Map<string, number>()
    await Promise.all(
      urls.map(async (url) => {
        const speed = await probeThroughput(url, probeBytes, signal)
        if (speed !== null) speeds.set(url, speed)
      })
    )
    if (speeds.size > 0) {
      return [...urls].sort(
        (left, right) =>
          (speeds.get(right) ?? Number.NEGATIVE_INFINITY) -
          (speeds.get(left) ?? Number.NEGATIVE_INFINITY)
      )
    }
    // 速度探测失败时退回延迟探测。
  }
  const latencies = new Map<string, number>()
  const now = Date.now()
  await Promise.all(
    urls.map(async (url) => {
      const origin = originOf(url)
      if (!origin) return
      const cached = sourceProbeCache.get(origin)
      if (cached && now - cached.at < SOURCE_PROBE_TTL) {
        latencies.set(origin, cached.latency)
        return
      }
      const latency = await probeLatency(url, signal)
      if (latency === null) return
      sourceProbeCache.set(origin, { latency, at: Date.now() })
      latencies.set(origin, latency)
    })
  )
  if (latencies.size === 0) return urls
  return [...urls].sort((left, right) => {
    const a = latencies.get(originOf(left) ?? '') ?? Number.POSITIVE_INFINITY
    const b = latencies.get(originOf(right) ?? '') ?? Number.POSITIVE_INFINITY
    return a - b
  })
}

/* ---------- 停滞超时 ---------- */
function createStallGuard(): {
  signal: AbortSignal
  touch: () => void
  clear: () => void
} {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | null = null
  const touch = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => controller.abort(), STALL_TIMEOUT)
  }
  touch()
  return {
    signal: controller.signal,
    touch,
    clear: () => {
      if (timer) clearTimeout(timer)
      timer = null
    }
  }
}

/* ---------- 断点元数据 ---------- */
interface PartMeta {
  etag?: string
  lastModified?: string
  url?: string
}

async function readMeta(path: string): Promise<PartMeta | null> {
  try {
    return JSON.parse(await fs.readFile(path, 'utf8')) as PartMeta
  } catch {
    return null
  }
}

async function writeMeta(path: string, meta: PartMeta): Promise<void> {
  try {
    await fs.writeFile(path, JSON.stringify(meta), 'utf8')
  } catch {
    /* 元数据失败不影响续传 */
  }
}

async function removePart(part: string, metaPath: string): Promise<void> {
  await fs.rm(part, { force: true }).catch(() => undefined)
  await fs.rm(metaPath, { force: true }).catch(() => undefined)
}

/* ---------- JSON ---------- */
export async function fetchText(
  urls: string[],
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<string> {
  let lastError: Error | null = null
  for (const url of urls) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (options.signal?.aborted) throw new CancellationError()
        const response = await fetch(url, {
          headers: { 'User-Agent': USER_AGENT, Accept: '*/*' },
          signal: combinedSignal(options.signal, options.timeoutMs ?? JSON_TIMEOUT)
        })
        if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`)
        return await response.text()
      } catch (err) {
        lastError = friendlyError(err, url)
        if (options.signal?.aborted) throw new CancellationError()
        if (attempt === 0) await sleep(400)
      }
    }
  }
  throw lastError ?? new NetworkError('网络请求失败')
}

export async function fetchJson<T>(
  urls: string[],
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<T> {
  const text = await fetchText(urls, options)
  try {
    return JSON.parse(text) as T
  } catch {
    throw new NetworkError('服务器返回了损坏的数据，请稍后重试')
  }
}

export function sha1OfText(text: string): string {
  return createHash('sha1').update(text, 'utf8').digest('hex')
}

/* ---------- 文件下载 ---------- */
export interface DownloadOptions {
  sha1?: string | null
  size?: number | null
  signal?: AbortSignal
  onBytes?: (bytes: number) => void
  /** 低于这个大小走单连接；模组等小文件可传 1 MB 以启用 4 路分片。 */
  segmentMinBytes?: number
  /** 有多个候选地址时，先测首个字节延迟再决定顺序。 */
  probeSources?: boolean
  /** 大于 0 时用一段 Range 实测吞吐量选线路；仅对大文件启用。 */
  probeBytes?: number
}

/* ---------- 多线程分片下载 ---------- */
class RangeUnsupportedError extends Error {
  constructor(message = '服务器不支持分段下载') {
    super(message)
    this.name = 'RangeUnsupportedError'
  }
}

interface SegmentMeta {
  url: string
  size: number
  count: number
  etag?: string
  lastModified?: string
}

function segmentCount(size: number): number {
  if (size >= 32 * 1024 * 1024) return SEGMENT_MAX
  if (size >= 8 * 1024 * 1024) return 12
  if (size >= 4 * 1024 * 1024) return 8
  return 4
}

async function readSegmentMeta(path: string): Promise<SegmentMeta | null> {
  try {
    const raw = JSON.parse(await fs.readFile(path, 'utf8')) as SegmentMeta
    if (
      typeof raw.url !== 'string' ||
      typeof raw.size !== 'number' ||
      typeof raw.count !== 'number'
    ) {
      return null
    }
    return raw
  } catch {
    return null
  }
}

async function removeSegments(
  part: string,
  metaPath: string,
  count: number
): Promise<void> {
  const total = Math.max(count, SEGMENT_MAX)
  for (let index = 0; index < total; index += 1) {
    await fs.rm(`${part}.seg${index}`, { force: true }).catch(() => undefined)
  }
  await fs.rm(`${part}.segments.json`, { force: true }).catch(() => undefined)
  await fs.rm(metaPath, { force: true }).catch(() => undefined)
}

async function probeRange(
  url: string,
  signal: AbortSignal | undefined
): Promise<{
  size: number
  etag?: string
  lastModified?: string
} | null> {
  const stall = createStallGuard()
  const signals: AbortSignal[] = [AbortSignal.timeout(30_000), stall.signal]
  if (signal) signals.push(signal)
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: downloadAccept(url),
        Range: 'bytes=0-0'
      },
      signal: AbortSignal.any(signals)
    })
    if (response.status !== 206) {
      await response.body?.cancel().catch(() => undefined)
      return null
    }
    const contentRange = response.headers.get('content-range')
    const match = contentRange ? /^bytes\s+0-0\/(\d+)$/i.exec(contentRange) : null
    const size = match ? Number(match[1]) : NaN
    await response.body?.cancel().catch(() => undefined)
    if (!Number.isFinite(size) || size <= 0) return null
    return {
      size,
      etag: response.headers.get('etag') ?? undefined,
      lastModified: response.headers.get('last-modified') ?? undefined
    }
  } catch {
    return null
  } finally {
    stall.clear()
  }
}

async function downloadFileSegmented(
  url: string,
  destination: string,
  options: DownloadOptions,
  expectedSha1: string | null
): Promise<boolean> {
  const minBytes = options.segmentMinBytes ?? SEGMENT_MIN_BYTES
  if (options.size == null || options.size < minBytes) return false
  const part = `${destination}.part`
  try {
    if ((await fs.stat(part)).size > 0) return false
  } catch {
    /* no single-connection part */
  }

  const probe = await probeRange(url, options.signal)
  if (!probe) return false
  if (probe.size !== options.size) return false

  const count = segmentCount(probe.size)
  const metaPath = `${part}.segments.json`
  let meta = await readSegmentMeta(metaPath)
  const compatible =
    meta &&
    meta.size === probe.size &&
    meta.count === count &&
    !(meta.etag && probe.etag && meta.etag !== probe.etag)
  if (!compatible) {
    await removeSegments(part, metaPath, count)
    meta = {
      url,
      size: probe.size,
      count,
      etag: probe.etag,
      lastModified: probe.lastModified
    }
    await fs.writeFile(metaPath, JSON.stringify(meta), 'utf8').catch(() => undefined)
  } else if (meta) {
    if (meta.url !== url || (!meta.etag && probe.etag)) {
      meta.url = url
      meta.etag = meta.etag ?? probe.etag
      meta.lastModified = meta.lastModified ?? probe.lastModified
      await fs.writeFile(metaPath, JSON.stringify(meta), 'utf8').catch(() => undefined)
    }
  }

  const base = Math.floor(probe.size / count)
  const lengths = Array.from({ length: count }, (_value, index) =>
    index === count - 1 ? probe.size - base * index : base
  )
  const starts = lengths.map((_length, index) => base * index)
  const segmentPath = (index: number): string => `${part}.seg${index}`

  const groupAbort = new AbortController()

  const work = async (index: number): Promise<void> => {
    const length = lengths[index]
    const start = starts[index]
    const end = start + length - 1
    let lastError: unknown = null
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (groupAbort.signal.aborted) throw new CancellationError()
      let current = 0
      try {
        current = (await fs.stat(segmentPath(index))).size
      } catch {
        current = 0
      }
      if (current > length) {
        await fs.rm(segmentPath(index), { force: true }).catch(() => undefined)
        current = 0
      }
      if (current >= length) return
      const from = start + current
      const releaseHost = await acquireHost(hostOf(url) ?? 'unknown')
      const stall = createStallGuard()
      const signals: AbortSignal[] = [
        AbortSignal.timeout(FILE_TIMEOUT),
        stall.signal,
        groupAbort.signal
      ]
      if (options.signal) signals.push(options.signal)
      try {
        const headers: Record<string, string> = {
          'User-Agent': USER_AGENT,
          Accept: downloadAccept(url),
          Range: `bytes=${from}-${end}`
        }
        if (meta?.etag) headers['If-Range'] = meta.etag
        else if (meta?.lastModified) headers['If-Range'] = meta.lastModified
        const response = await fetch(url, {
          headers,
          signal: AbortSignal.any(signals)
        })
        if (response.status === 200) {
          await response.body?.cancel().catch(() => undefined)
          throw new RangeUnsupportedError()
        }
        if (response.status === 416) {
          await response.body?.cancel().catch(() => undefined)
          await fs.rm(segmentPath(index), { force: true }).catch(() => undefined)
          throw new NetworkError('分段范围无效，正在重试', url)
        }
        if (response.status !== 206 || !response.body) {
          throw new NetworkError(`分段下载失败：HTTP ${response.status}`, url)
        }
        const contentRange = response.headers.get('content-range')
        const match = contentRange
          ? /^bytes\s+(\d+)-(\d+)\/(\d+)$/i.exec(contentRange)
          : null
        if (match && (Number(match[1]) !== from || Number(match[2]) !== end)) {
          throw new NetworkError('分段范围不匹配', url)
        }
        const meter = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            options.onBytes?.(chunk.length)
            stall.touch()
            callback(null, chunk)
          }
        })
        await pipeline(
          Readable.fromWeb(response.body as never),
          meter,
          createWriteStream(segmentPath(index), {
            flags: current > 0 ? 'a' : 'w'
          }),
          { signal: AbortSignal.any(signals) }
        )
        const actual = (await fs.stat(segmentPath(index))).size
        if (actual !== length) {
          throw new NetworkError(
            `分段大小校验失败（期望 ${length}，实际 ${actual}）`,
            url
          )
        }
        return
      } catch (error) {
        if (options.signal?.aborted) throw new CancellationError()
        if (error instanceof RangeUnsupportedError) throw error
        lastError = error
        if (groupAbort.signal.aborted) throw error
        if (attempt < 2) await sleep(500 * (attempt + 1))
      } finally {
        stall.clear()
        releaseHost()
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new NetworkError('分段下载重试失败', url)
  }

  try {
    const tasks = Array.from({ length: count }, (_value, index) =>
      work(index).catch((error) => {
        groupAbort.abort()
        throw error
      })
    )
    const results = await Promise.allSettled(tasks)
    const failed = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    )
    if (failed.length > 0) {
      if (options.signal?.aborted) throw new CancellationError()
      if (failed.some((result) => result.reason instanceof RangeUnsupportedError)) {
        await removeSegments(part, metaPath, count)
        return false
      }
      const reason = failed[0].reason
      throw reason instanceof Error
        ? reason
        : new NetworkError('分段下载失败', url)
    }
  } catch (error) {
    if (options.signal?.aborted) throw new CancellationError()
    await removeSegments(part, metaPath, count)
    return false
  }

  const mergePath = `${part}.merge`
  try {
    const parts = Array.from({ length: count }, (_value, index) =>
      createReadStream(segmentPath(index))
    )
    const merged = (async function* () {
      for (const stream of parts) {
        for await (const chunk of stream) yield chunk as Buffer
      }
    })()
    await pipeline(Readable.from(merged), createWriteStream(mergePath))
    const info = await hashFile(mergePath, options.signal)
    if (!info || info.size !== probe.size || (expectedSha1 && info.sha1 !== expectedSha1)) {
      await fs.rm(mergePath, { force: true }).catch(() => undefined)
      await removeSegments(part, metaPath, count)
      return false
    }
    await fs.rm(destination, { force: true }).catch(() => undefined)
    await fs.rename(mergePath, destination)
    await removeSegments(part, metaPath, count)
    await fs.rm(part, { force: true }).catch(() => undefined)
    if (expectedSha1) await storeInCache(expectedSha1, destination, probe.size)
    return true
  } catch {
    await fs.rm(mergePath, { force: true }).catch(() => undefined)
    if (options.signal?.aborted) throw new CancellationError()
    await removeSegments(part, metaPath, count)
    return false
  }
}

/**
 * 下载文件。具备：
 * - SHA1 缓存命中后直接硬链接，不发起网络请求；
 * - 4 MB 以上文件使用 4–8 路 Range 分片并发下载；
 * - `.part` 断点续传（Range + If-Range）；
 * - 20 秒无数据停滞时中断并切换候选线路；
 * - 按主机名限制并发。
 */
export async function downloadFile(
  urls: string[],
  destination: string,
  options: DownloadOptions = {}
): Promise<void> {
  const expectedSha1 = options.sha1?.toLowerCase() ?? null
  if (expectedSha1) {
    const hit = await linkFromCache(expectedSha1, destination, options.size ?? null)
    if (hit) return
  }

  await fs.mkdir(dirname(destination), { recursive: true })
  const part = `${destination}.part`
  const metaPath = `${part}.json`
  let lastError: Error | null = null
  const candidates =
    options.probeSources &&
    options.size != null &&
    options.size >= SOURCE_PROBE_MIN_BYTES &&
    urls.length > 1
      ? await orderCandidatesByLatency(
          urls,
          options.signal,
          options.probeBytes ?? 0
        )
      : urls

  for (const url of candidates) {
    let attempt = 0
    while (attempt < 2) {
      if (options.signal?.aborted) throw new CancellationError()
      let releaseHost: (() => void) | null = null
      let stall: ReturnType<typeof createStallGuard> | null = null

      try {
        let offset = 0
        try {
          offset = (await fs.stat(part)).size
        } catch {
          offset = 0
        }
        let meta = await readMeta(metaPath)

        if (options.size != null && offset > options.size) {
          await removePart(part, metaPath)
          offset = 0
          meta = null
        }

        if (offset > 0 && options.size != null && offset === options.size) {
          const info = await hashFile(part, options.signal)
          const matches = Boolean(info) && (!expectedSha1 || info!.sha1 === expectedSha1)
          if (matches) {
            await fs.rm(destination, { force: true }).catch(() => undefined)
            await fs.rename(part, destination)
            await fs.rm(metaPath, { force: true }).catch(() => undefined)
            if (expectedSha1) await storeInCache(expectedSha1, destination, options.size)
            return
          }
          await removePart(part, metaPath)
          offset = 0
          meta = null
        }

        if (
          offset === 0 &&
          options.size != null &&
          options.size >= (options.segmentMinBytes ?? SEGMENT_MIN_BYTES)
        ) {
          try {
            const completed = await downloadFileSegmented(
              url,
              destination,
              options,
              expectedSha1
            )
            if (completed) return
          } catch (error) {
            if (options.signal?.aborted) throw new CancellationError()
            lastError = friendlyError(error, url)
            break
          }
          if (options.signal?.aborted) throw new CancellationError()
        }

        const headers: Record<string, string> = {
          'User-Agent': USER_AGENT,
          Accept: downloadAccept(url)
        }
        if (offset > 0) {
          headers.Range = `bytes=${offset}-`
          if (meta?.etag) headers['If-Range'] = meta.etag
          else if (meta?.lastModified) headers['If-Range'] = meta.lastModified
        }

        const host = hostOf(url)
        if (host) releaseHost = await acquireHost(host)
        if (options.signal?.aborted) throw new CancellationError()
        stall = createStallGuard()

        const signals: AbortSignal[] = [AbortSignal.timeout(FILE_TIMEOUT), stall.signal]
        if (options.signal) signals.push(options.signal)
        const response = await fetch(url, { headers, signal: AbortSignal.any(signals) })
        if (options.signal?.aborted) throw new CancellationError()
        if (response.status === 416) {
          await removePart(part, metaPath)
          throw new NetworkError('断点范围无效，正在重新下载', url)
        }
        if (!response.ok || !response.body) {
          throw new NetworkError(`下载失败：HTTP ${response.status}`, url)
        }

        let append = offset > 0 && response.status === 206
        if (append) {
          const contentRange = response.headers.get('content-range')
          const match = contentRange ? /^bytes\s+(\d+)-/i.exec(contentRange) : null
          if (match && Number(match[1]) !== offset) append = false
        }
        if (offset > 0 && !append) {
          offset = 0
          meta = null
          await removePart(part, metaPath)
        }

        const etag = response.headers.get('etag') ?? undefined
        const lastModified = response.headers.get('last-modified') ?? undefined
        meta = {
          etag: etag ?? meta?.etag,
          lastModified: lastModified ?? meta?.lastModified,
          url
        }
        await writeMeta(metaPath, meta)

        const hash = createHash('sha1')
        let received = offset
        if (append) {
          for await (const chunk of createReadStream(part)) {
            if (options.signal?.aborted) throw new CancellationError()
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
            hash.update(buffer)
            stall.touch()
          }
        }

        const meter = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            received += chunk.length
            hash.update(chunk)
            options.onBytes?.(chunk.length)
            stall?.touch()
            callback(null, chunk)
          }
        })

        await pipeline(
          Readable.fromWeb(response.body as never),
          meter,
          createWriteStream(part, { flags: append ? 'a' : 'w' }),
          { signal: AbortSignal.any(signals) }
        )

        if (options.size != null && received !== options.size) {
          throw new NetworkError(`文件大小校验失败（期望 ${options.size}，实际 ${received}）`, url)
        }
        const actualSha1 = hash.digest('hex')
        if (expectedSha1 && actualSha1 !== expectedSha1) {
          await removePart(part, metaPath)
          throw new NetworkError('文件 SHA1 校验失败，文件可能已损坏', url)
        }

        await fs.rm(destination, { force: true }).catch(() => undefined)
        await fs.rename(part, destination)
        await fs.rm(metaPath, { force: true }).catch(() => undefined)
        if (expectedSha1) {
          await storeInCache(expectedSha1, destination, options.size ?? received)
        }
        return
      } catch (err) {
        if (options.signal?.aborted) throw new CancellationError()
        if (stall?.signal.aborted) {
          lastError = new NetworkError('下载停滞，正在切换线路', url)
          break
        }
        lastError = friendlyError(err, url)
        attempt += 1
        if (attempt < 2) await sleep(500)
      } finally {
        stall?.clear()
        releaseHost?.()
      }
    }
    if (options.signal?.aborted) throw new CancellationError()
  }

  throw lastError ?? new NetworkError('下载失败')
}
