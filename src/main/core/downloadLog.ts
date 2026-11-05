import { app } from 'electron'
import { createWriteStream, promises as fs, type WriteStream } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { lookup } from 'node:dns/promises'
import type { DownloadLogStatus, DownloadLogSummary } from '../../shared/types'
import { getLogDir } from './config'
import {
  DOWNLOAD_LOG_MAX_BYTES,
  formatLogBytes,
  formatLogSpeed,
  hostOfDownloadUrl,
  parseDownloadLogSummary,
  redactDownloadUrl,
  selectDownloadLogsForDeletion
} from './downloadLogFormat'
import { probeSourceSpeed } from './net'

export interface DownloadLogContext {
  task: string
  pack?: string
  source?: string
  mirror?: boolean
  proxy?: boolean
  concurrency?: number
  files?: number
  size?: number
}

interface HostStat {
  files: number
  bytes: number
  ms: number
  failures: number
}

const SPEED_SAMPLE_MS = 2_000
const SLOW_FILE_BPS = 300 * 1024
const MAX_FILE_LINES = 200

function stampForName(date = new Date()): string {
  const pad = (value: number, length = 2) => String(value).padStart(length, '0')
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
    '-',
    pad(date.getMilliseconds(), 3)
  ].join('')
}

function clockOf(date = new Date()): string {
  return date.toISOString().slice(11, 23)
}

function slug(value: string): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36)
  return cleaned || 'download'
}

function oneLine(value: string, limit = 500): string {
  return value.replace(/[\r\n]+/g, ' ').slice(0, limit)
}

let cleanupQueue: Promise<void> = Promise.resolve()

export async function downloadLogDir(): Promise<string> {
  return join(getLogDir(), 'download')
}

export class DownloadLogSession {
  readonly name: string
  readonly path: string
  readonly context: DownloadLogContext
  private stream: WriteStream | null = null
  private startedAt = Date.now()
  private finished = false
  private bytes = 0
  private writtenBytes = 0
  private hostStats = new Map<string, HostStat>()
  private fileLines = 0
  private lastSpeedAt = 0
  private truncated = false

  private constructor(name: string, path: string, context: DownloadLogContext) {
    this.name = name
    this.path = path
    this.context = context
  }

  static async start(context: DownloadLogContext): Promise<DownloadLogSession | null> {
    try {
      const dir = await downloadLogDir()
      await fs.mkdir(dir, { recursive: true })
      await pruneDownloadLogs()
      const name = `download-${stampForName()}-${slug(context.task)}.log`
      const path = join(dir, name)
      const session = new DownloadLogSession(name, path, context)
      session.stream = createWriteStream(path, { flags: 'a' })
      session.stream.on('error', () => {
        session.stream = null
      })
      session.write('# 月月月启动器下载诊断')
      session.write(`task: ${oneLine(context.task, 80)}`)
      if (context.pack) session.write(`pack: ${oneLine(context.pack, 120)}`)
      if (context.source) session.write(`source: ${oneLine(context.source, 40)}`)
      session.write(`version: ${app.getVersion()}`)
      session.write(`started: ${new Date(session.startedAt).toISOString()}`)
      session.write(`mirror: ${context.mirror === false ? 'off' : 'on'}`)
      session.write(`proxy: ${context.proxy ? 'on' : 'off'}`)
      if (context.concurrency) session.write(`concurrency: ${context.concurrency}`)
      if (context.files != null && context.files > 0) session.write(`files: ${context.files}`)
      if (context.size != null && context.size > 0) session.write(`size: ${context.size}`)
      session.write('')
      return session
    } catch {
      return null
    }
  }

  private write(line: string): void {
    const stream = this.stream
    if (!stream || this.truncated) return
    const bytes = Buffer.byteLength(line, 'utf8') + 1
    if (this.writtenBytes + bytes > DOWNLOAD_LOG_MAX_BYTES - 2048) {
      this.truncated = true
      try {
        stream.write(`${this.line('log', '日志达到 4 MB 上限，后续明细已停止记录')}\n`)
      } catch {
        /* ignore */
      }
      return
    }
    this.writtenBytes += bytes
    try {
      stream.write(`${line}\n`)
    } catch {
      this.stream = null
    }
  }

  private writeTrailer(line: string): void {
    try {
      this.stream?.write(`${line}\n`)
    } catch {
      /* ignore */
    }
  }

  private line(tag: string, message: string): string {
    return `[${clockOf()}] [${tag}] ${oneLine(message)}`
  }

  event(tag: string, message: string): void {
    this.write(this.line(tag, message))
  }

  stage(name: string, durationMs: number, detail = ''): void {
    const suffix = detail ? ` · ${detail}` : ''
    this.write(this.line('stage', `${oneLine(name, 80)} ${Math.max(0, Math.round(durationMs))} ms${suffix}`))
  }

  probe(host: string, status: string, bps: number | null): void {
    const speed = bps == null ? '失败' : formatLogSpeed(bps)
    this.write(this.line('probe', `${host} ${status} ${speed}`))
  }

  dns(host: string, addresses: string[], error?: string): void {
    this.write(
      this.line(
        'dns',
        error
          ? `${host} 解析失败：${oneLine(error, 120)}`
          : `${host} → ${addresses.slice(0, 8).join(', ') || '无 IPv4/IPv6 地址'}`
      )
    )
  }

  url(raw: string): void {
    this.write(this.line('url', redactDownloadUrl(raw)))
  }

  recordFile(input: {
    label: string
    host: string
    bytes: number
    ms: number
    attempts?: number
  }): void {
    const bytes = Math.max(0, input.bytes)
    const ms = Math.max(0, input.ms)
    this.bytes += bytes
    const stats = this.hostStats.get(input.host) ?? { files: 0, bytes: 0, ms: 0, failures: 0 }
    stats.files += 1
    stats.bytes += bytes
    stats.ms += ms
    this.hostStats.set(input.host, stats)
    const bps = ms > 0 ? (bytes * 1000) / ms : 0
    const slow = bps > 0 && bps < SLOW_FILE_BPS
    const retried = (input.attempts ?? 0) > 1
    if (this.fileLines < MAX_FILE_LINES) {
      this.fileLines += 1
      this.write(
        this.line(
          slow ? 'file-slow' : 'file',
          `${input.label} host=${input.host} size=${formatLogBytes(bytes)} time=${Math.round(ms)}ms speed=${formatLogSpeed(bps)}${retried ? ` attempts=${input.attempts}` : ''}`
        )
      )
    }
  }

  recordFailure(label: string, host: string, error: string): void {
    const stats = this.hostStats.get(host) ?? { files: 0, bytes: 0, ms: 0, failures: 0 }
    stats.failures += 1
    this.hostStats.set(host, stats)
    this.write(this.line('file-fail', `${label} host=${host} ${oneLine(error, 240)}`))
  }

  speed(bps: number, done: number, total: number, bytesDone: number, bytesTotal: number): void {
    const now = Date.now()
    if (now - this.lastSpeedAt < SPEED_SAMPLE_MS) return
    this.lastSpeedAt = now
    this.write(
      this.line(
        'speed',
        `${formatLogSpeed(bps)} · ${done}/${total} 个文件 · ${formatLogBytes(bytesDone)}/${formatLogBytes(bytesTotal)}`
      )
    )
  }

  async finish(status: DownloadLogStatus, error?: string): Promise<void> {
    if (this.finished) return
    this.finished = true
    for (const [host, stats] of this.hostStats) {
      const bps = stats.ms > 0 ? (stats.bytes * 1000) / stats.ms : 0
      this.write(
        this.line(
          'host',
          `${host} files=${stats.files} bytes=${formatLogBytes(stats.bytes)} avg=${formatLogSpeed(bps)} failures=${stats.failures}`
        )
      )
    }
    const elapsed = Math.max(1, Date.now() - this.startedAt)
    const avg = (this.bytes * 1000) / elapsed
    if (error) this.write(this.line('error', oneLine(error, 300)))
    this.write(
      this.line(
        'summary',
        `耗时 ${(elapsed / 1000).toFixed(1)}s · 平均 ${formatLogSpeed(avg)} · 共 ${formatLogBytes(this.bytes)}`
      )
    )
    this.write('')
    this.writeTrailer(`finished: ${new Date().toISOString()}`)
    this.writeTrailer(`status: ${status}`)
    this.writeTrailer(`elapsedms: ${Math.round(elapsed)}`)
    this.writeTrailer(`bytes: ${this.bytes}`)
    this.writeTrailer(`avgbps: ${Math.round(avg)}`)
    const stream = this.stream
    this.stream = null
    if (stream) {
      await new Promise<void>((resolve) => stream.end(resolve))
    }
    cleanupQueue = cleanupQueue.then(() => pruneDownloadLogs()).catch(() => undefined)
  }
}

async function readEdges(path: string, size: number): Promise<string> {
  const handle = await fs.open(path, 'r')
  try {
    const length = Math.min(size, 32 * 1024)
    const head = Buffer.alloc(length)
    await handle.read(head, 0, length, 0)
    if (size <= length) return head.toString('utf8')
    const tail = Buffer.alloc(length)
    await handle.read(tail, 0, length, Math.max(0, size - length))
    return `${head.toString('utf8')}\n${tail.toString('utf8')}`
  } finally {
    await handle.close()
  }
}

function safeName(name: string): string | null {
  if (!name || name !== basename(name) || !name.endsWith('.log') || name.length > 160) {
    return null
  }
  if (/[<>:"/\\|?*\u0000-\u001f]/.test(name) || name.includes('..')) return null
  return name
}

export async function listDownloadLogs(): Promise<DownloadLogSummary[]> {
  const dir = await downloadLogDir()
  const names = await fs.readdir(dir).catch(() => [] as string[])
  const entries: DownloadLogSummary[] = []
  for (const name of names) {
    if (!name.endsWith('.log')) continue
    const path = join(dir, name)
    try {
      const info = await fs.stat(path)
      if (!info.isFile() || info.size > DOWNLOAD_LOG_MAX_BYTES) continue
      const text = await readEdges(path, info.size)
      entries.push(parseDownloadLogSummary(name, text, info.mtimeMs, info.size))
    } catch {
      /* ignore unreadable logs */
    }
  }
  return entries.sort((left, right) => right.startedAt - left.startedAt)
}

export async function readDownloadLog(name: string): Promise<string> {
  const safe = safeName(name)
  if (!safe) throw new Error('下载日志文件名无效')
  const dir = resolve(await downloadLogDir())
  const path = resolve(dir, safe)
  if (!path.startsWith(`${dir}\\`) && !path.startsWith(`${dir}/`)) {
    throw new Error('下载日志路径无效')
  }
  const text = await fs.readFile(path, 'utf8')
  return text.length > 1_000_000 ? text.slice(-1_000_000) : text
}

export async function pruneDownloadLogs(): Promise<void> {
  const dir = await downloadLogDir()
  const entries = await listDownloadLogs()
  const deletions = selectDownloadLogsForDeletion(
    entries.map((entry) => ({
      name: entry.name,
      startedAt: entry.startedAt,
      status: entry.status
    }))
  )
  for (const name of deletions) {
    await fs.rm(join(dir, name), { force: true }).catch(() => undefined)
  }
}

const NETWORK_CHECK_URLS = [
  {
    host: 'mod.mcimirror.top',
    url: 'https://mod.mcimirror.top/files/7963/363/create-1.21.1-6.0.10.jar'
  },
  {
    host: 'mediafilez.forgecdn.net',
    url: 'https://mediafilez.forgecdn.net/files/7963/363/create-1.21.1-6.0.10.jar'
  },
  {
    host: 'edge.forgecdn.net',
    url: 'https://edge.forgecdn.net/files/7963/363/create-1.21.1-6.0.10.jar'
  }
]

export async function runDownloadNetworkCheck(): Promise<DownloadLogSummary> {
  const session = await DownloadLogSession.start({
    task: '下载线路体检',
    pack: 'MCI / mediafilez / edge',
    source: 'network-check',
    files: 0,
    size: 0
  })
  if (!session) throw new Error('无法创建下载日志')
  try {
    const dnsTasks = NETWORK_CHECK_URLS.map(async (entry) => {
      try {
        const all = await lookup(entry.host, { all: true })
        session.dns(
          entry.host,
          all.map((item) => `${item.address}/${item.family === 6 ? 'v6' : 'v4'}`)
        )
      } catch (error) {
        session.dns(entry.host, [], error instanceof Error ? error.message : String(error))
      }
    })
    const probeTasks = NETWORK_CHECK_URLS.map(async (entry) => {
      const started = Date.now()
      try {
        const bps = await probeSourceSpeed(entry.url, 512 * 1024)
        if (bps != null && bps > 0) {
          session.probe(entry.host, '206', bps * 1000)
          session.recordFile({
            label: '线路体检样本',
            host: entry.host,
            bytes: 512 * 1024,
            ms: Math.max(1, Date.now() - started),
            attempts: 1
          })
          return { host: entry.host, bps }
        }
        session.probe(entry.host, '无响应', null)
        session.recordFailure('线路体检样本', entry.host, '测速未返回有效数据')
        return { host: entry.host, bps: 0 }
      } catch (error) {
        session.probe(entry.host, error instanceof Error ? error.message : '失败', null)
        session.recordFailure('线路体检样本', entry.host, String(error))
        return { host: entry.host, bps: 0 }
      }
    })
    await Promise.all(dnsTasks)
    const results = await Promise.all(probeTasks)
    const mci = results.find((item) => item.host === 'mod.mcimirror.top')?.bps ?? 0
    const official = results.find((item) => item.host === 'mediafilez.forgecdn.net')?.bps ?? 0
    const verdict =
      mci <= 0 && official <= 0
        ? '两条 CurseForge 线路均不可用，请检查网络或代理'
        : mci >= official * 1.5
          ? 'MCI 镜像明显快于官方 CDN'
          : official >= mci * 1.5
            ? '官方 CDN 明显快于 MCI，可尝试关闭文件镜像加速'
            : '两条线路速度接近，瓶颈更可能在本地出口或 DNS'
    session.event('verdict', verdict)
    await session.finish('success')
  } catch (error) {
    await session.finish('failed', error instanceof Error ? error.message : String(error))
    throw error
  }
  const list = await listDownloadLogs()
  const summary = list.find((entry) => entry.name === session.name)
  if (!summary) throw new Error('下载日志写入失败')
  return summary
}
