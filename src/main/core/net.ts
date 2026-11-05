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
const HOST_CONCURRENCY = 64
const SEGMENT_MIN_BYTES = 512 * 1024
const SEGMENT_MAX = 64
const SOURCE_PROBE_MIN_BYTES = 4 * 1024 * 1024
const SOURCE_PROBE_TIMEOUT = 2_000
const SOURCE_PROBE_TTL = 10 * 60_000
const SPEED_PROBE_TIMEOUT = 12_000
/** 多线路下载：分片持续低于该速度（bytes/s）时换到更快线路。 */
const MULTI_SLOW_BPS = 150 * 1024
/** 多线路下载：慢分片观察窗口，避免把启动慢误判成线路慢。 */
const MULTI_SLOW_WINDOW_MS = 7_000
const MULTI_SLOW_GRACE_MS = 2_500
/** 多线路按速度分配分片前的测速字节数。太大会拖慢开始，太小会被瞬间带宽误导。 */
const MULTI_SOURCE_PROBE_BYTES = 512 * 1024
const MULTI_SOURCE_PROBE_TIMEOUT_MS = 6_000
/** 文件末尾单独细分的区间上限/下限，以及尾段小分片大小。 */
const MULTI_TAIL_MAX_BYTES = 12 * 1024 * 1024
const MULTI_TAIL_MIN_BYTES = 4 * 1024 * 1024
const MULTI_TAIL_CHUNK_BYTES = 512 * 1024
const MULTI_TAIL_MIN_SIZE = 16 * 1024 * 1024
/** 32 MB 以上的大文件把头部切得更细，用更多连接跑满带宽（与 PCL 的动态分段接近）。 */
const MULTI_HEAD_LARGE_SIZE = 32 * 1024 * 1024
const MULTI_HEAD_TARGET_BYTES = 4 * 1024 * 1024
const MULTI_HEAD_TARGET_LARGE_BYTES = 1024 * 1024
const MULTI_HEAD_MAX = 24
const MULTI_HEAD_MAX_LARGE = 56
/** 单线路分段：分片持续低于该速度时主动断线重连，避免尾段被一条慢连接拖住。 */
const SINGLE_SLOW_BPS = 64 * 1024
const SINGLE_SLOW_WINDOW_MS = 5_000
const SINGLE_SLOW_GRACE_MS = 2_000
const SINGLE_SLOW_RETRIES = 2
const SINGLE_SLOW_MIN_REMAINING = 256 * 1024

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

async function acquireHost(host: string, limit = HOST_CONCURRENCY): Promise<() => void> {
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
  if (state.active < Math.max(1, limit)) {
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
    if (parts.some((value) => value < 0) && !parts.some((value) => value > 0)) return null
    // 单个 Range 探测失败（偶发重置/限流）不应把整条线路判死；
    // 只要还有成功取到数据的部分，就按实际字节估算吞吐量。
    total = parts.filter((value) => value > 0).reduce((sum, value) => sum + value, 0)
    const elapsed = Math.max(1, Date.now() - started)
    return total > 0 ? total / elapsed : null
  } catch {
    return null
  }
}

/** 供批量下载前做一次源站吞吐量探测；返回 bytes/ms。 */
export async function probeSourceSpeed(
  url: string,
  bytes = 256 * 1024,
  signal?: AbortSignal
): Promise<number | null> {
  return probeThroughput(url, bytes, signal)
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
function createStallGuard(timeoutMs = STALL_TIMEOUT): {
  signal: AbortSignal
  touch: () => void
  clear: () => void
} {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | null = null
  const touch = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => controller.abort(), timeoutMs)
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
export type DownloadTraceEvent = {
  type: 'retry' | 'slow-switch' | 'stall' | 'http-error' | 'fallback'
  host: string
  message: string
}

export interface DownloadOptions {
  sha1?: string | null
  size?: number | null
  signal?: AbortSignal
  onBytes?: (bytes: number) => void
  /** 成功时回报实际完成的来源；cache/resume/multi 表示未走完整网络或跨线路。 */
  onSource?: (source: 'cache' | 'resume' | 'multi' | string) => void
  /** 下载线路诊断事件，写日志失败不应影响下载。 */
  trace?: (event: DownloadTraceEvent) => void
  /** 低于这个大小走单连接；模组等小文件可传 1 MB 以启用 4 路分片。 */
  segmentMinBytes?: number
  /** 有多个候选地址时，先测首个字节延迟再决定顺序。 */
  probeSources?: boolean
  /** 大于 0 时用一段 Range 实测吞吐量选线路；仅对大文件启用。 */
  probeBytes?: number
  /** 多个候选线路同时参与分段下载；仅大文件且候选 >=2 时生效。 */
  multiSource?: boolean
  /** 同一主机的最大并发连接数；整合包批量下载可高于默认值。 */
  hostConcurrency?: number
  /** 多线路：分片持续低于该速度（bytes/s）时中止并换源；0 关闭。 */
  slowSegmentBps?: number
  /** 多线路：慢分片观察窗口（ms），默认 7000。 */
  slowSegmentWindowMs?: number
  /** 多线路：按实测速度分配分片前，每条线路的测速字节数；0 表示轮询分配。 */
  sourceProbeBytes?: number
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
  lengths?: number[]
  etag?: string
  lastModified?: string
}

interface MultiSegmentSource {
  url: string
  etag?: string
  lastModified?: string
}

interface MultiSegmentMeta {
  schema: 3
  size: number
  count: number
  /** 与分段文件一一对应的长度；尾段分片与头部不同，不能再按固定长度计算。 */
  lengths: number[]
  sources: MultiSegmentSource[]
  assignments: number[]
}

function segmentCount(size: number): number {
  if (size >= 32 * 1024 * 1024) return SEGMENT_MAX
  if (size >= 8 * 1024 * 1024) return 24
  if (size >= 2 * 1024 * 1024) return 8
  if (size >= 512 * 1024) return 4
  return 1
}

/**
 * 只有标准的强 ETag 才能用于 If-Range。
 * Azure Blob（piston-data）返回的是 0x... 形式的 ETag，服务端会忽略 If-Range
 * 并直接返回 200 整文件，导致分段下载误判为“源不支持 Range”，退回单连接。
 */
function ifRangeValue(etag?: string, lastModified?: string): string | undefined {
  if (etag && !etag.startsWith('W/') && /^"[^"]*"$/.test(etag)) return etag
  return lastModified
}

/**
 * 这些源要么不识 Range、要么会按 IP/连接限速甚至 403，强制多分片只会更慢。
 * 与 PCL 的做法一致：直连 GitHub/BMCLAPI/Modrinth/OptiFine 时保持保守，
 * MCIM、ForgeCDN 等镜像/CDN 才启用激进分片。
 */
function isSplitFriendly(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return !(
      host === 'github.com' ||
      host.endsWith('githubusercontent.com') ||
      host === 'bmclapi2.bangbang93.com' ||
      host === 'optifine.net'
    )
  } catch {
    return false
  }
}

function hostLimitFor(url: string, requested = HOST_CONCURRENCY): number {
  try {
    const host = new URL(url).hostname.toLowerCase()
    if (
      host === 'github.com' ||
      host.endsWith('githubusercontent.com') ||
      host === 'bmclapi2.bangbang93.com' ||
      host === 'modrinth.com' ||
      host.endsWith('.modrinth.com') ||
      host === 'optifine.net'
    ) {
      return Math.min(requested, 8)
    }
  } catch {
    /* ignore */
  }
  return requested
}

/**
 * 大文件把尾部约 4–12 MB 单独切成 1.5 MB 小分片，其余部分保持较大分片。
 * 合并时按顺序拼接，因此小分片只在尾部，不改变文件内容顺序。
 */
function multiSourceLayout(size: number): Array<{ start: number; length: number }> {
  if (size < MULTI_TAIL_MIN_SIZE) {
    const count = segmentCount(size)
    const base = Math.floor(size / count)
    return Array.from({ length: count }, (_value, index) => ({
      start: base * index,
      length: index === count - 1 ? size - base * index : base
    }))
  }
  const tailBytes = Math.min(
    MULTI_TAIL_MAX_BYTES,
    Math.max(MULTI_TAIL_MIN_BYTES, Math.floor(size * 0.1))
  )
  const headBytes = size - tailBytes
  const large = size >= MULTI_HEAD_LARGE_SIZE
  const headTarget = large ? MULTI_HEAD_TARGET_LARGE_BYTES : MULTI_HEAD_TARGET_BYTES
  const headMax = large ? MULTI_HEAD_MAX_LARGE : MULTI_HEAD_MAX
  const headCount = Math.min(
    headMax,
    Math.max(8, Math.ceil(headBytes / headTarget))
  )
  const base = Math.floor(headBytes / headCount)
  const ranges: Array<{ start: number; length: number }> = []
  for (let index = 0; index < headCount; index += 1) {
    ranges.push({
      start: base * index,
      length: index === headCount - 1 ? headBytes - base * index : base
    })
  }
  let offset = headBytes
  while (offset < size) {
    const length = Math.min(MULTI_TAIL_CHUNK_BYTES, size - offset)
    ranges.push({ start: offset, length })
    offset += length
  }
  return ranges
}

async function readSegmentMeta(path: string): Promise<SegmentMeta | null> {
  try {
    const raw = JSON.parse(await fs.readFile(path, 'utf8')) as SegmentMeta
    if (
      typeof raw.url !== 'string' ||
      typeof raw.size !== 'number' ||
      typeof raw.count !== 'number' ||
      !Array.isArray(raw.lengths) ||
      raw.lengths.length !== raw.count ||
      !raw.lengths.every(
        (length) => Number.isInteger(length) && Number(length) > 0
      ) ||
      raw.lengths.reduce((sum, length) => sum + Number(length), 0) !== raw.size
    ) {
      return null
    }
    return raw
  } catch {
    return null
  }
}

async function readMultiSegmentMeta(
  path: string
): Promise<MultiSegmentMeta | null> {
  try {
    const raw = JSON.parse(await fs.readFile(path, 'utf8')) as MultiSegmentMeta
    if (
      raw.schema !== 3 ||
      typeof raw.size !== 'number' ||
      typeof raw.count !== 'number' ||
      !Array.isArray(raw.lengths) ||
      raw.lengths.length !== raw.count ||
      !Array.isArray(raw.sources) ||
      !Array.isArray(raw.assignments)
    ) {
      return null
    }
    const lengths = raw.lengths.map((length) => Number(length))
    if (
      !lengths.every((length) => Number.isInteger(length) && length > 0) ||
      lengths.reduce((sum, length) => sum + length, 0) !== raw.size
    ) {
      return null
    }
    const sources = raw.sources.filter(
      (source): source is MultiSegmentSource =>
        Boolean(source) &&
        typeof source === 'object' &&
        typeof (source as MultiSegmentSource).url === 'string'
    )
    if (sources.length < 2 || raw.assignments.length !== raw.count) return null
    return { ...raw, lengths, sources }
  } catch {
    return null
  }
}

async function writeMultiSegmentMeta(
  path: string,
  meta: MultiSegmentMeta
): Promise<void> {
  try {
    await fs.writeFile(path, JSON.stringify(meta), 'utf8')
  } catch {
    /* 元数据失败不影响续传 */
  }
}

async function removeSegments(
  part: string,
  metaPath: string,
  count: number
): Promise<void> {
  const total = Math.max(count, 48)
  for (let index = 0; index < total; index += 1) {
    await fs.rm(`${part}.seg${index}`, { force: true }).catch(() => undefined)
  }
  await fs.rm(`${part}.segments.json`, { force: true }).catch(() => undefined)
  await fs.rm(metaPath, { force: true }).catch(() => undefined)
}

async function probeRange(
  url: string,
  signal: AbortSignal | undefined,
  timeoutMs = 30_000
): Promise<{
  size: number
  etag?: string
  lastModified?: string
} | null> {
  const stall = createStallGuard()
  const signals: AbortSignal[] = [AbortSignal.timeout(timeoutMs), stall.signal]
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
  const hostLimit = hostLimitFor(url, options.hostConcurrency ?? HOST_CONCURRENCY)
  if (options.size == null || options.size < minBytes || !isSplitFriendly(url)) return false
  const part = `${destination}.part`
  try {
    if ((await fs.stat(part)).size > 0) return false
  } catch {
    /* no single-connection part */
  }

  const probe = await probeRange(url, options.signal)
  if (!probe) return false
  if (probe.size !== options.size) return false

  const layout = multiSourceLayout(probe.size)
  const count = layout.length
  const lengths = layout.map((range) => range.length)
  const starts = layout.map((range) => range.start)
  const metaPath = `${part}.segments.json`
  let meta = await readSegmentMeta(metaPath)
  const compatible =
    meta &&
    meta.size === probe.size &&
    meta.count === count &&
    meta.lengths?.length === count &&
    meta.lengths.every((length, index) => length === lengths[index]) &&
    !(meta.etag && probe.etag && meta.etag !== probe.etag)
  if (!compatible) {
    await removeSegments(part, metaPath, count)
    meta = {
      url,
      size: probe.size,
      count,
      lengths,
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

  const segmentPath = (index: number): string => `${part}.seg${index}`

  const groupAbort = new AbortController()

  const work = async (index: number): Promise<void> => {
    const length = lengths[index]
    const start = starts[index]
    const end = start + length - 1
    let lastError: unknown = null
    let attempt = 0
    let slowRetries = 0
    let monitorSlow = true
    while (attempt < 3) {
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
      const releaseHost = await acquireHost(hostOf(url) ?? 'unknown', hostLimit)
      const stall = createStallGuard()
      const slowAbort = new AbortController()
      const signals: AbortSignal[] = [
        AbortSignal.timeout(FILE_TIMEOUT),
        stall.signal,
        slowAbort.signal,
        groupAbort.signal
      ]
      if (options.signal) signals.push(options.signal)
      const attemptStarted = Date.now()
      let attemptBytes = 0
      let windowStarted = attemptStarted
      let windowBytes = 0
      let slowAborted = false
      try {
        const headers: Record<string, string> = {
          'User-Agent': USER_AGENT,
          Accept: downloadAccept(url),
          Range: `bytes=${from}-${end}`
        }
        if (meta?.etag) {
          const ifRange = ifRangeValue(meta.etag, meta.lastModified)
          if (ifRange) headers['If-Range'] = ifRange
        }
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
            attemptBytes += chunk.length
            windowBytes += chunk.length
            const now = Date.now()
            const windowElapsed = now - windowStarted
            const remaining = length - current - attemptBytes
            if (
              monitorSlow &&
              windowElapsed >= SINGLE_SLOW_WINDOW_MS &&
              now - attemptStarted >= SINGLE_SLOW_GRACE_MS
            ) {
              const speed = (windowBytes * 1000) / windowElapsed
              if (speed < SINGLE_SLOW_BPS && remaining > SINGLE_SLOW_MIN_REMAINING) {
                slowRetries += 1
                slowAborted = true
                slowAbort.abort()
                callback(
                  new NetworkError(
                    `分段速度过慢（${Math.max(1, Math.round(speed / 1024))} KB/s），重连`,
                    url
                  )
                )
                return
              }
              windowStarted = now
              windowBytes = 0
            }
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
        if (slowAborted) {
          if (slowRetries >= SINGLE_SLOW_RETRIES) monitorSlow = false
          await sleep(120)
          continue
        }
        attempt += 1
        if (attempt < 3) await sleep(500 * attempt)
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
    // 尾段先启动，避免最后几 MB 排在前面的大分片后面等并发槽位。
    const taskOrder = Array.from({ length: count }, (_value, index) => index).sort(
      (left, right) => right - left
    )
    const tasks = taskOrder.map((index) =>
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
 * 按权重把 count 个分片轮流分配给各线路；权重来自实测吞吐量。
 * 使用“已分配数 / 权重”最小优先，避免慢线路占用过多分片。
 */
function weightedAssignments(count: number, weights: number[]): number[] {
  const assignments: number[] = []
  const served = weights.map(() => 0)
  const firstAlive = Math.max(0, weights.findIndex((weight) => weight > 0))
  for (let slot = 0; slot < count; slot += 1) {
    let best = firstAlive
    for (let index = 0; index < weights.length; index += 1) {
      if (weights[index] <= 0) continue
      const ratio = served[index] / Math.max(weights[index], 1e-6)
      const bestRatio = served[best] / Math.max(weights[best], 1e-6)
      if (
        weights[best] <= 0 ||
        ratio < bestRatio - 1e-9 ||
        (Math.abs(ratio - bestRatio) <= 1e-9 && weights[index] > weights[best])
      ) {
        best = index
      }
    }
    assignments.push(best)
    served[best] += 1
  }
  return assignments
}

/**
 * 多线路并行分片：头部按实测吞吐量加权分配较大分片，尾部约 4–12 MB
 * 单独切成 1.5 MB 小分片，避免最后几个大分片被慢线路拖住。
 * 慢于阈值或停滞的分片会从当前偏移换到最快存活线路续传；
 * 每条线路单独记录 ETag，失败/限额/不支持 Range 时自动换线。
 */
async function downloadFileMultiSource(
  urls: string[],
  destination: string,
  options: DownloadOptions,
  expectedSha1: string | null
): Promise<boolean> {
  const size = options.size
  const hostLimit = options.hostConcurrency ?? HOST_CONCURRENCY
  if (!size || urls.length < 2) return false
  const part = `${destination}.part`
  try {
    if ((await fs.stat(part)).size > 0) return false
  } catch {
    /* no single-connection part */
  }

  const probes = await Promise.all(
    urls.map(async (url) => ({
      url,
      probe: await probeRange(url, options.signal, 8_000)
    }))
  )
  if (options.signal?.aborted) throw new CancellationError()
  const sources: MultiSegmentSource[] = []
  for (const item of probes) {
    if (!item.probe || item.probe.size !== size) continue
    sources.push({
      url: item.url,
      etag: item.probe.etag,
      lastModified: item.probe.lastModified
    })
  }
  if (sources.length < 2) return false

  if (options.signal?.aborted) throw new CancellationError()
  // 大文件用 512 KB 取样；小文件按比例缩小，避免测速本身占了可观带宽。
  const probeBytes =
    options.sourceProbeBytes ??
    Math.min(
      MULTI_SOURCE_PROBE_BYTES,
      Math.max(128 * 1024, Math.floor(size / 64))
    )
  const probedSpeeds = await Promise.all(
    sources.map(async (source) => {
      if (probeBytes <= 0) return null
      const timeout = AbortSignal.timeout(MULTI_SOURCE_PROBE_TIMEOUT_MS)
      const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
      const speed = await probeThroughput(source.url, probeBytes, signal)
      return speed !== null && speed > 0 ? speed * 1000 : null
    })
  )
  if (options.signal?.aborted) throw new CancellationError()
  const knownSpeeds = probedSpeeds.filter(
    (speed): speed is number => typeof speed === 'number' && speed > 0
  )
  // 测速失败通常意味着线路很慢或超时；给一个低权重兜底，避免它分走大量分片。
  const unknownSpeed = knownSpeeds.length
    ? Math.min(64 * 1024, Math.min(...knownSpeeds) * 0.25)
    : 64 * 1024
  const sourceSpeeds = probedSpeeds.map((speed) =>
    typeof speed === 'number' && speed > 0 ? speed : unknownSpeed
  )
  // 支持高并发的线路才值得多分片；BMCLAPI 等直连源并发一高就 429，
  // 测速时看不出问题，真正开跑后半个文件的分片都会失败，最后 2 MB 反复重试。
  // 只要存在可分片线路且它没有明显更慢，就把直连源留作兜底，不参与分片分配。
  const splitFlags = sources.map((source) => isSplitFriendly(source.url))
  const knownSplitSpeeds = probedSpeeds
    .map((speed, index) => (splitFlags[index] && speed != null && speed > 0 ? speed : null))
    .filter((speed): speed is number => speed != null)
  // 可分片线路的测速全部失败时仍给它一个下限，避免把整包交给会 429 的直连源；
  // 如果确实测到了低速，则按实测值比较，不掩盖真正更快的直连源。
  const bestSplitSpeed = knownSplitSpeeds.length
    ? Math.max(...knownSplitSpeeds)
    : splitFlags.some(Boolean)
      ? 256 * 1024
      : 0
  const bestOtherSpeedValue = Math.max(
    0,
    ...sourceSpeeds.filter((_speed, index) => !splitFlags[index])
  )
  const preferSplitOnly =
    splitFlags.some(Boolean) &&
    bestSplitSpeed > 0 &&
    bestOtherSpeedValue <= bestSplitSpeed * 2
  const weights = sourceSpeeds.map((speed, index) => {
    if (!splitFlags[index] && hostOf(sources[index].url) === 'bmclapi2.bangbang93.com') {
      // BMCLAPI 在实际分段请求时容易 429，只保留为全部分片线路失效后的兜底。
      return 0
    }
    if (preferSplitOnly && !splitFlags[index]) {
      // Modrinth 官方/GitHub 等不分片源保留一小部分分片，作为真正的第二线路；
      // 它们不走高并发，慢分片会按阈值换回主线路。
      return Math.max(1, Math.round(speed * 0.1))
    }
    return Math.max(1, speed)
  })
  console.info(
    `[net] 多线路测速：${sources
      .map((source, index) => {
        const label =
          weights[index] <= 0
            ? '（仅兜底）'
            : preferSplitOnly && !splitFlags[index]
              ? '（少量兜底）'
              : ''
        return `${hostOf(source.url) ?? '未知'}=${Math.max(1, Math.round(sourceSpeeds[index] / 1024))}KB/s${label}`
      })
      .join('，')}`
  )

  const layout = multiSourceLayout(size)
  const count = layout.length
  const lengths = layout.map((range) => range.length)
  const starts = layout.map((range) => range.start)
  const metaPath = `${part}.segments.json`
  const existing = await readMultiSegmentMeta(metaPath)
  if (
    !existing ||
    existing.size !== size ||
    existing.count !== count ||
    existing.lengths.some((length, index) => length !== lengths[index])
  ) {
    await removeSegments(part, metaPath, count)
  }
  const assignments = weightedAssignments(count, weights)
  const meta: MultiSegmentMeta = {
    schema: 3,
    size,
    count,
    lengths,
    sources,
    assignments
  }
  await writeMultiSegmentMeta(metaPath, meta)

  const segmentPath = (index: number): string => `${part}.seg${index}`
  const dead = new Set<number>()
  const groupAbort = new AbortController()
  const slowBps = options.slowSegmentBps ?? MULTI_SLOW_BPS
  const slowWindowMs = Math.max(1_000, options.slowSegmentWindowMs ?? MULTI_SLOW_WINDOW_MS)

  const nextAlive = (preferred: number): number => {
    // 优先在同级分片线路里换；直连兜底源只有其余线路都不可用时才启用。
    for (let step = 1; step <= sources.length; step += 1) {
      const index = (preferred + step) % sources.length
      if (!dead.has(index) && weights[index] > 0) return index
    }
    for (let step = 1; step <= sources.length; step += 1) {
      const index = (preferred + step) % sources.length
      if (!dead.has(index)) return index
    }
    return -1
  }

  /** 当前速度估计最高的存活线路（可排除正在使用的线路）。 */
  const bestSource = (exclude = -1): number => {
    const splitAlive = sources.some(
      (source, index) => !dead.has(index) && index !== exclude && weights[index] > 0
    )
    let best = -1
    let bestSpeed = -1
    for (let index = 0; index < sources.length; index += 1) {
      if (index === exclude || dead.has(index)) continue
      if (splitAlive && weights[index] <= 0) continue
      const speed = sourceSpeeds[index] ?? 0
      if (speed > bestSpeed) {
        best = index
        bestSpeed = speed
      }
    }
    return best
  }

  const bestOtherSpeed = (exclude: number): number => {
    const splitAlive = sources.some(
      (source, index) => !dead.has(index) && index !== exclude && weights[index] > 0
    )
    let best = 0
    for (let index = 0; index < sources.length; index += 1) {
      if (index === exclude || dead.has(index)) continue
      if (splitAlive && weights[index] <= 0) continue
      best = Math.max(best, sourceSpeeds[index] ?? 0)
    }
    return best
  }

  const work = async (index: number): Promise<void> => {
    const length = lengths[index]
    const start = starts[index]
    const end = start + length - 1
    let lastError: unknown = null
    for (let attempt = 0; attempt < 5; attempt += 1) {
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
      if (dead.size >= sources.length) {
        throw new NetworkError('所有下载线路均不可用', urls[0])
      }
      let sourceIndex = assignments[index]
      if (dead.has(sourceIndex)) {
        const next = nextAlive(sourceIndex)
        if (next < 0) throw new NetworkError('所有下载线路均不可用', urls[0])
        sourceIndex = next
        assignments[index] = sourceIndex
      }
      const source = sources[sourceIndex]
      const from = start + current
      const releaseHost = await acquireHost(
        hostOf(source.url) ?? 'unknown',
        hostLimitFor(source.url, hostLimit)
      )
      // 多线路时分片无数据 8 秒就换线，比单线路的 20 秒更积极，避免卡死分片拖尾。
      const stall = createStallGuard(
        slowBps > 0 ? Math.max(2_500, slowWindowMs + 1_000) : STALL_TIMEOUT
      )
      const slowAbort = new AbortController()
      const signals: AbortSignal[] = [
        AbortSignal.timeout(FILE_TIMEOUT),
        stall.signal,
        slowAbort.signal,
        groupAbort.signal
      ]
      if (options.signal) signals.push(options.signal)
      const attemptStarted = Date.now()
      let attemptBytes = 0
      let windowStarted = attemptStarted
      let windowBytes = 0
      let slowAborted = false
      try {
        const headers: Record<string, string> = {
          'User-Agent': USER_AGENT,
          Accept: downloadAccept(source.url),
          Range: `bytes=${from}-${end}`
        }
        if (source.etag) {
          const ifRange = ifRangeValue(source.etag, source.lastModified)
          if (ifRange) headers['If-Range'] = ifRange
        }
        const response = await fetch(source.url, {
          headers,
          signal: AbortSignal.any(signals)
        })
        if (response.status === 200) {
          await response.body?.cancel().catch(() => undefined)
          dead.add(sourceIndex)
          throw new NetworkError('线路不支持分段', source.url)
        }
        if (
          response.status === 401 ||
          response.status === 403 ||
          response.status === 404 ||
          response.status === 429
        ) {
          await response.body?.cancel().catch(() => undefined)
          dead.add(sourceIndex)
          throw new NetworkError(`线路不可用：HTTP ${response.status}`, source.url)
        }
        if (response.status === 416) {
          await response.body?.cancel().catch(() => undefined)
          await fs.rm(segmentPath(index), { force: true }).catch(() => undefined)
          throw new NetworkError('分段范围无效，正在重试', source.url)
        }
        if (response.status !== 206 || !response.body) {
          throw new NetworkError(`分段下载失败：HTTP ${response.status}`, source.url)
        }
        const contentRange = response.headers.get('content-range')
        const match = contentRange
          ? /^bytes\s+(\d+)-(\d+)\/(\d+)$/i.exec(contentRange)
          : null
        if (match && (Number(match[1]) !== from || Number(match[2]) !== end)) {
          throw new NetworkError('分段范围不匹配', source.url)
        }
        const meter = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            options.onBytes?.(chunk.length)
            stall.touch()
            attemptBytes += chunk.length
            windowBytes += chunk.length
            const now = Date.now()
            const windowElapsed = now - windowStarted
            if (
              slowBps > 0 &&
              windowElapsed >= slowWindowMs &&
              now - attemptStarted >= MULTI_SLOW_GRACE_MS
            ) {
              const speed = (windowBytes * 1000) / windowElapsed
              const other = bestOtherSpeed(sourceIndex)
              // 绝对慢（几十 KB/s）或相对慢（不到最快线路的三成）都换源，
              // 但只有另一条线路至少快一倍且达到最低可用速度时才值得中断。
              const tooSlow = speed < slowBps || speed < other * 0.3
              if (tooSlow && other >= Math.max(200 * 1024, speed * 2)) {
                slowAborted = true
                slowAbort.abort()
                const message = `${hostOf(source.url) ?? '未知线路'} 分片仅 ${Math.max(1, Math.round(speed / 1024))}KB/s，切换到更快线路`
                console.warn(`[net] ${message}`)
                options.trace?.({
                  type: 'slow-switch',
                  host: hostOf(source.url) ?? '未知线路',
                  message
                })
                callback(
                  new NetworkError(
                    `分片速度过慢（${Math.max(1, Math.round(speed / 1024))} KB/s），切换线路`,
                    source.url
                  )
                )
                return
              }
              windowStarted = now
              windowBytes = 0
            }
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
            source.url
          )
        }
        const elapsed = Math.max(0.25, (Date.now() - attemptStarted) / 1000)
        const measured = attemptBytes / elapsed
        const previous = sourceSpeeds[sourceIndex] ?? measured
        sourceSpeeds[sourceIndex] =
          previous > 0 ? previous * 0.65 + measured * 0.35 : measured
        assignments[index] = sourceIndex
        return
      } catch (error) {
        if (options.signal?.aborted) throw new CancellationError()
        lastError = error
        const elapsed = Math.max(0.25, (Date.now() - attemptStarted) / 1000)
        const measured = attemptBytes / elapsed
        const stalled = stall.signal.aborted
        if (stalled) {
          const message = `${hostOf(source.url) ?? '未知线路'} 分片停滞超过 ${Math.round(
            (slowBps > 0 ? Math.max(2_500, slowWindowMs + 1_000) : STALL_TIMEOUT) / 1000
          )}s，切换线路`
          console.warn(`[net] ${message}`)
          options.trace?.({ type: 'stall', host: hostOf(source.url) ?? '未知线路', message })
        }
        if (slowAborted || stalled) {
          // 慢速/卡死线路降权，并把剩余区间交给当前更快的存活线路。
          const previous = sourceSpeeds[sourceIndex] ?? measured
          sourceSpeeds[sourceIndex] = stalled
            ? Math.max(1, Math.min(previous, 64 * 1024))
            : Math.max(1, Math.min(previous, measured))
          const next = bestSource(sourceIndex)
          if (next >= 0) assignments[index] = next
        } else {
          const next = nextAlive(sourceIndex)
          if (next >= 0) assignments[index] = next
        }
        if (groupAbort.signal.aborted) throw error
        if (attempt < 4) {
          await sleep(slowAborted || stalled ? 120 : 350 * (attempt + 1))
        }
      } finally {
        stall.clear()
        releaseHost()
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new NetworkError('多线路分段下载重试失败', urls[0])
  }

  try {
    // 尾段先启动：直连源有并发上限时，最后 1–2 MB 不会排在几十个大分片后面等槽位。
    const taskOrder = Array.from({ length: count }, (_value, index) => index).sort(
      (left, right) => right - left
    )
    const tasks = taskOrder.map((index) =>
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
      await removeSegments(part, metaPath, count)
      return false
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
    if (!info || info.size !== size || (expectedSha1 && info.sha1 !== expectedSha1)) {
      await fs.rm(mergePath, { force: true }).catch(() => undefined)
      await removeSegments(part, metaPath, count)
      return false
    }
    await fs.rm(destination, { force: true }).catch(() => undefined)
    await fs.rename(mergePath, destination)
    await removeSegments(part, metaPath, count)
    await fs.rm(part, { force: true }).catch(() => undefined)
    if (expectedSha1) await storeInCache(expectedSha1, destination, size)
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
    if (hit) {
      options.onSource?.('cache')
      return
    }
  }

  await fs.mkdir(dirname(destination), { recursive: true })
  const part = `${destination}.part`
  const metaPath = `${part}.json`
  let lastError: Error | null = null
  if (
    options.multiSource &&
    options.size != null &&
    options.size >= (options.segmentMinBytes ?? SEGMENT_MIN_BYTES) &&
    urls.length > 1 &&
    urls.some((url) => isSplitFriendly(url))
  ) {
    try {
      const completed = await downloadFileMultiSource(
        urls,
        destination,
        options,
        expectedSha1
      )
      if (completed) {
        options.onSource?.('multi')
        return
      }
      options.trace?.({
        type: 'fallback',
        host: hostOf(urls[0]) ?? '未知线路',
        message: '多线路分片未完成，改用单线路重试'
      })
    } catch (error) {
      if (options.signal?.aborted) throw new CancellationError()
      lastError = friendlyError(error, urls[0])
      options.trace?.({
        type: 'fallback',
        host: hostOf(urls[0]) ?? '未知线路',
        message: `多线路分片失败，改用单线路：${lastError}`
      })
    }
  }
  let candidates: string[]
  if (options.multiSource && urls.length > 1) {
    // 多线路失败后先重试可分片的官方线路；直接回退 BMCLAPI 单连接会把最后几十 MB 拖成几分钟。
    candidates = [...urls].sort(
      (left, right) => Number(isSplitFriendly(right)) - Number(isSplitFriendly(left))
    )
  } else if (
    options.probeSources &&
    options.size != null &&
    options.size >= SOURCE_PROBE_MIN_BYTES &&
    urls.length > 1
  ) {
    candidates = await orderCandidatesByLatency(
      urls,
      options.signal,
      options.probeBytes ?? 0
    )
  } else {
    candidates = urls
  }
  if (
    options.size != null &&
    options.size >= (options.segmentMinBytes ?? SEGMENT_MIN_BYTES) &&
    candidates.length > 1 &&
    hostOf(candidates[0]) !== 'bmclapi2.bangbang93.com'
  ) {
    // MCIM 镜像优先；其次才按普通源排序。避免源站 256 KB 测速把不分片/较慢的
    // Modrinth 官方排到前面，导致整个文件退回单连接或走慢速节点。
    const priorityOf = (url: string): number => {
      const host = hostOf(url)
      if (host === 'mod.mcimirror.top') return 0
      return isSplitFriendly(url) ? 1 : 2
    }
    candidates = [...candidates].sort(
      (left, right) => priorityOf(left) - priorityOf(right)
    )
  }

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
            options.onSource?.('resume')
            return
          }
          await removePart(part, metaPath)
          offset = 0
          meta = null
        }

        if (
          offset === 0 &&
          options.size != null &&
          options.size >= (options.segmentMinBytes ?? SEGMENT_MIN_BYTES) &&
          isSplitFriendly(url)
        ) {
          try {
            const completed = await downloadFileSegmented(
              url,
              destination,
              options,
              expectedSha1
            )
            if (completed) {
              options.onSource?.(url)
              return
            }
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
          const ifRange = ifRangeValue(meta?.etag, meta?.lastModified)
          if (ifRange) headers['If-Range'] = ifRange
        }

        const host = hostOf(url)
        if (host) releaseHost = await acquireHost(host, hostLimitFor(url, options.hostConcurrency ?? HOST_CONCURRENCY))
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
        options.onSource?.(url)
        return
      } catch (err) {
        if (options.signal?.aborted) throw new CancellationError()
        if (stall?.signal.aborted) {
          lastError = new NetworkError('下载停滞，正在切换线路', url)
          options.trace?.({
            type: 'stall',
            host: hostOf(url) ?? '未知线路',
            message: `下载停滞，切换线路：${url}`
          })
          break
        }
        lastError = friendlyError(err, url)
        options.trace?.({
          type: 'retry',
          host: hostOf(url) ?? '未知线路',
          message: lastError.message
        })
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
