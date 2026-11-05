import type { DownloadLogStatus, DownloadLogSummary } from '../../shared/types'

export const DOWNLOAD_LOG_MAX_COUNT = 30
export const DOWNLOAD_LOG_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
export const DOWNLOAD_LOG_MAX_BYTES = 4 * 1024 * 1024

export interface DownloadLogListItem {
  name: string
  startedAt: number
  status: DownloadLogStatus
}

/** 只保留协议、主机和路径，去掉查询参数、片段与账号信息。 */
export function redactDownloadUrl(raw: string): string {
  try {
    const url = new URL(raw.trim())
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '[invalid-url]'
    const path = url.pathname.length > 220 ? `${url.pathname.slice(0, 220)}…` : url.pathname
    return `${url.protocol}//${url.hostname.toLowerCase()}${path}`
  } catch {
    return '[invalid-url]'
  }
}

export function hostOfDownloadUrl(raw: string): string {
  try {
    return new URL(raw).hostname.toLowerCase()
  } catch {
    return '未知线路'
  }
}

export function formatLogBytes(bytes: number): string {
  const value = Math.max(0, Number.isFinite(bytes) ? bytes : 0)
  if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(2)} MB`
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${Math.round(value)} B`
}

export function formatLogSpeed(bytesPerSecond: number): string {
  const value = Math.max(0, Number.isFinite(bytesPerSecond) ? bytesPerSecond : 0)
  return `${formatLogBytes(value)}/s`
}

function parseNumber(value: string | undefined): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

function parseStatus(value: string | undefined): DownloadLogStatus {
  return value === 'success' || value === 'failed' ? value : 'running'
}

/**
 * 日志头部和结尾都是 `key: value`，事件行以 `[` 开头。
 * 同名键以最后一次出现为准，因此结尾的 status/bytes 会覆盖头部默认值。
 */
export function parseDownloadLogSummary(
  name: string,
  text: string,
  fallbackStartedAt: number,
  logBytes: number
): DownloadLogSummary {
  const values = new Map<string, string>()
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('[') || line.startsWith('#')) continue
    const separator = line.indexOf(':')
    if (separator <= 0) continue
    const key = line.slice(0, separator).trim().toLowerCase()
    if (!/^[a-z][a-z0-9_-]{0,30}$/.test(key)) continue
    values.set(key, line.slice(separator + 1).trim())
  }
  const started = Date.parse(values.get('started') ?? '')
  const finishedRaw = values.get('finished')
  const finished = finishedRaw ? Date.parse(finishedRaw) : NaN
  const status = parseStatus(values.get('status'))
  return {
    name,
    task: (values.get('task') ?? '下载任务').slice(0, 80),
    pack: (values.get('pack') ?? '').slice(0, 120),
    startedAt: Number.isFinite(started) ? started : fallbackStartedAt,
    finishedAt: Number.isFinite(finished) ? finished : null,
    status,
    bytes: parseNumber(values.get('bytes')),
    size: parseNumber(values.get('size')),
    avgBps: parseNumber(values.get('avgbps')),
    logBytes
  }
}

function normalizeListStatus(status: string): DownloadLogStatus {
  return status === 'success' || status === 'failed' ? status : 'running'
}

/**
 * 失败日志优先保留；成功日志超过 30 天先清理，再按最旧优先把总数压到 30 条。
 * 返回需要删除的文件名。
 */
export function selectDownloadLogsForDeletion(
  entries: DownloadLogListItem[],
  now = Date.now(),
  maxCount = DOWNLOAD_LOG_MAX_COUNT,
  maxAgeMs = DOWNLOAD_LOG_MAX_AGE_MS
): string[] {
  const sorted = [...entries].sort((left, right) => left.startedAt - right.startedAt)
  const doomed = new Set<string>()
  for (const entry of sorted) {
    if (normalizeListStatus(entry.status) === 'failed') continue
    if (now - entry.startedAt > maxAgeMs) doomed.add(entry.name)
  }
  const remaining = sorted.filter((entry) => !doomed.has(entry.name))
  let excess = remaining.length - Math.max(1, maxCount)
  if (excess <= 0) return [...doomed]
  for (const entry of remaining) {
    if (excess <= 0) break
    if (normalizeListStatus(entry.status) === 'failed') continue
    doomed.add(entry.name)
    excess -= 1
  }
  for (const entry of remaining) {
    if (excess <= 0) break
    if (doomed.has(entry.name)) continue
    doomed.add(entry.name)
    excess -= 1
  }
  return [...doomed]
}
