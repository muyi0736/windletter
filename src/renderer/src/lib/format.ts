const VERSION_TYPE_LABELS: Record<string, string> = {
  release: '正式版',
  snapshot: '快照',
  old_beta: '远古 Beta',
  old_alpha: '远古 Alpha'
}

const LOADER_LABELS: Record<string, string> = {
  vanilla: '原版',
  fabric: 'Fabric',
  forge: 'Forge',
  neoforge: 'NeoForge',
  quilt: 'Quilt',
  optifine: 'OptiFine',
  liteloader: 'LiteLoader'
}

export function versionTypeLabel(type: string | null | undefined): string {
  if (!type) return '未知类型'
  return VERSION_TYPE_LABELS[type] ?? type
}

export function versionTypeKind(type: string | null | undefined): 'release' | 'snapshot' | 'old' {
  if (type === 'snapshot') return 'snapshot'
  if (type === 'old_beta' || type === 'old_alpha') return 'old'
  return 'release'
}

export function loaderLabel(loader: string | null | undefined): string | null {
  if (!loader) return null
  return LOADER_LABELS[loader.toLowerCase()] ?? loader
}

export function loaderKind(loader: string | null | undefined): string {
  return (loader ?? '').toLowerCase().replace(/\s+/g, '')
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value >= 100 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`
}

export function formatCount(value: number | null | undefined): string {
  if (!value || value <= 0) return '0'
  return new Intl.NumberFormat('zh-CN', {
    notation: 'compact',
    maximumFractionDigits: 1
  }).format(value)
}

export function formatSpeed(bytesPerSecond: number | null | undefined): string {
  if (!bytesPerSecond || bytesPerSecond <= 0) return '0 B/s'
  return `${formatBytes(bytesPerSecond)}/s`
}

export function formatMemory(mb: number): string {
  if (mb >= 1024) {
    const gb = mb / 1024
    return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`
  }
  return `${mb} MB`
}

export function formatDate(input: string | number | null | undefined): string {
  if (!input) return '未知'
  const date = new Date(input)
  if (Number.isNaN(date.getTime())) return '未知'
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function formatDateTime(input: number | null | undefined): string {
  if (!input) return '尚未记录'
  const date = new Date(input)
  if (Number.isNaN(date.getTime())) return '尚未记录'
  return `${formatDate(input)} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function relativeTime(input: number | null | undefined): string {
  if (!input) return '还没有启动过'
  const diff = Date.now() - input
  if (diff < 0) return '刚刚'
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  if (diff < day * 30) return `${Math.floor(diff / day)} 天前`
  return formatDate(input)
}

export function formatClock(time: number): string {
  const date = new Date(time)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function hashString(input: string): number {
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function javaRequirement(major: number | null | undefined): string {
  if (!major) return 'Java 自动检测'
  return `Java ${major}`
}

export function greeting(): string {
  const hour = new Date().getHours()
  if (hour < 5) return '夜深了'
  if (hour < 11) return '早上好'
  if (hour < 13) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

export function cleanError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()
}

export function formatPlaytimeSpan(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  if (total < 60) return `${total} 秒`
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  if (hours > 0) return minutes > 0 ? `${hours} 小时 ${minutes} 分` : `${hours} 小时`
  return `${minutes} 分钟`
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (value: number) => String(value).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`
}
