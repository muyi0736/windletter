import { promises as fs } from 'node:fs'
import { basename } from 'node:path'
import type { DownloadActiveFile, DownloadDetail } from '../../shared/types'
import { hashFile } from './contentCache'
import { CancellationError, downloadFile, type DownloadTraceEvent } from './net'
import type { DownloadLogSession } from './downloadLog'
import { hostOfDownloadUrl } from './downloadLogFormat'

export interface DownloadJob {
  urls: string[]
  destination: string
  sha1?: string | null
  size?: number | null
  label?: string
  /** 升级/修复时不能只按大小判断，必须核对已有文件的 SHA1。 */
  verifySha1?: boolean
  /** 大文件允许同任务的多个候选 URL 同时测速/分片。 */
  multiSource?: boolean
}

interface DownloadPoolResult {
  detail: DownloadDetail
}

function emptyDetail(totalFiles: number): DownloadDetail {
  return { current: 0, total: totalFiles, bytesDone: 0, bytesTotal: 0, speed: 0 }
}

export async function runDownloadPool(
  jobs: DownloadJob[],
  options: {
    concurrency: number
    signal: AbortSignal
    onProgress?: (detail: DownloadDetail) => void
    /** 批量内容下载可提高单主机并发；默认沿用 net.ts 的 16。 */
    hostConcurrency?: number
    /** 可选下载诊断会话；写日志失败不能影响下载。 */
    log?: DownloadLogSession | null
  }
): Promise<DownloadPoolResult> {
  const unique = new Map<string, DownloadJob>()
  for (const job of jobs) {
    const existing = unique.get(job.destination)
    if (!existing || (!existing.sha1 && job.sha1)) unique.set(job.destination, job)
  }
  const list = [...unique.values()]
  const detail = emptyDetail(list.length)
  const active = new Map<string, DownloadActiveFile>()
  const pending: DownloadJob[] = []

  for (const job of list) {
    let existingSize: number | null = null
    try {
      const stat = await fs.stat(job.destination)
      existingSize = stat.size
    } catch {
      existingSize = null
    }
    let valid =
      existingSize !== null &&
      (job.size == null ? existingSize > 0 : existingSize === job.size)
    if (valid && job.verifySha1 && job.sha1) {
      const info = await hashFile(job.destination, options.signal)
      valid =
        Boolean(info) &&
        info!.sha1.toLowerCase() === job.sha1.toLowerCase() &&
        (job.size == null || info!.size === job.size)
    }
    if (valid) {
      const knownSize = job.size ?? existingSize ?? 0
      detail.current++
      detail.bytesTotal += knownSize
      detail.bytesDone += knownSize
    } else {
      pending.push(job)
      detail.bytesTotal += job.size ?? 0
    }
  }

  const emit = () => {
    options.onProgress?.({
      ...detail,
      activeFiles: [...active.values()].map((file) => ({ ...file }))
    })
    options.log?.speed(detail.speed, detail.current, detail.total, detail.bytesDone, detail.bytesTotal)
  }
  emit()
  if (options.log) {
    const hosts = new Set<string>()
    for (const job of pending) {
      for (const url of job.urls) hosts.add(hostOfDownloadUrl(url))
    }
    options.log.event(
      'batch',
      pending.length > 0
        ? `待下载 ${pending.length} 个文件 · 已存在 ${detail.current} 个 · 总大小 ${detail.bytesTotal} B · 候选线路 ${[...hosts].slice(0, 8).join(', ')}`
        : `没有需要下载的文件 · 已存在 ${detail.current} 个文件`
    )
  }

  let cursor = 0
  let firstError: unknown = null
  let bytesSinceEmit = 0
  let lastEmit = Date.now()
  let speedWindowStart = Date.now()
  let lastTransfer = 0

  const onBytes = (bytes: number) => {
    detail.bytesDone += bytes
    lastTransfer += bytes
    bytesSinceEmit += bytes
    const now = Date.now()
    if (now - speedWindowStart >= 1000) {
      detail.speed = lastTransfer / ((now - speedWindowStart) / 1000)
      speedWindowStart = now
      lastTransfer = 0
    }
    if (now - lastEmit >= 350) {
      detail.speed = Math.max(detail.speed, bytesSinceEmit / ((now - lastEmit) / 1000))
      lastEmit = now
      bytesSinceEmit = 0
      emit()
    }
  }

  const workerCount = Math.max(1, Math.min(options.concurrency, pending.length || 1))
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      if (firstError || options.signal.aborted) return
      const index = cursor++
      if (index >= pending.length) return
      const job = pending[index]
      const entry: DownloadActiveFile = {
        label: job.label ?? basename(job.destination),
        bytes: 0,
        size: job.size ?? 0
      }
      active.set(job.destination, entry)
      let received = 0
      let source = ''
      let attempts = 1
      const startedAt = Date.now()
      const trace = (event: DownloadTraceEvent): void => {
        if (event.type === 'retry' || event.type === 'stall' || event.type === 'slow-switch') {
          attempts += 1
        }
        options.log?.event('trace', `${event.type} · ${event.message}`)
      }
      try {
        await downloadFile(job.urls, job.destination, {
          sha1: job.sha1,
          size: job.size,
          signal: options.signal,
          hostConcurrency: options.hostConcurrency,
          multiSource: job.multiSource,
          onSource: (value) => {
            source = value
          },
          trace,
          onBytes: (bytes) => {
            received += bytes
            entry.bytes += bytes
            onBytes(bytes)
          }
        })
        let downloadedSize = job.size
        if (downloadedSize == null) {
          try {
            downloadedSize = (await fs.stat(job.destination)).size
          } catch {
            downloadedSize = 0
          }
        }
        active.delete(job.destination)
        detail.bytesDone = Math.max(0, detail.bytesDone + downloadedSize - received)
        detail.current++
        detail.bytesTotal = Math.max(detail.bytesTotal, detail.bytesDone)
        const host =
          source === 'cache'
            ? '本地缓存'
            : source === 'resume'
              ? '断点续传'
              : source === 'multi'
                ? '多线路'
                : source
                  ? hostOfDownloadUrl(source)
                  : hostOfDownloadUrl(job.urls[0] ?? '')
        options.log?.recordFile({
          label: entry.label,
          host,
          bytes: downloadedSize ?? 0,
          ms: Date.now() - startedAt,
          attempts
        })
        emit()
      } catch (err) {
        active.delete(job.destination)
        detail.bytesDone = Math.max(0, detail.bytesDone - received)
        if (options.signal.aborted) return
        const host = source ? hostOfDownloadUrl(source) : hostOfDownloadUrl(job.urls[0] ?? '')
        options.log?.recordFailure(entry.label, host, err instanceof Error ? err.message : String(err))
        firstError = err
        return
      }
    }
  })

  await Promise.all(workers)
  if (options.signal.aborted) throw new CancellationError()

  active.clear()
  detail.speed = 0
  detail.current = detail.total
  if (detail.bytesTotal > 0) detail.bytesDone = detail.bytesTotal
  emit()
  if (firstError) throw firstError
  return { detail }
}
