import { promises as fs } from 'node:fs'
import { basename } from 'node:path'
import type { DownloadActiveFile, DownloadDetail } from '../../shared/types'
import { hashFile } from './contentCache'
import { CancellationError, downloadFile } from './net'

export interface DownloadJob {
  urls: string[]
  destination: string
  sha1?: string | null
  size?: number | null
  label?: string
  /** 升级/修复时不能只按大小判断，必须核对已有文件的 SHA1。 */
  verifySha1?: boolean
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

  const emit = () =>
    options.onProgress?.({
      ...detail,
      activeFiles: [...active.values()].map((file) => ({ ...file }))
    })
  emit()

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
      try {
        await downloadFile(job.urls, job.destination, {
          sha1: job.sha1,
          size: job.size,
          signal: options.signal,
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
        emit()
      } catch (err) {
        active.delete(job.destination)
        detail.bytesDone = Math.max(0, detail.bytesDone - received)
        if (options.signal.aborted) return
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
