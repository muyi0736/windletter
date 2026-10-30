import type { LaunchLogLevel } from '../../shared/types'

/**
 * Mojang 的 client-1.12.xml 把控制台 appender 配置成 LegacyXMLLayout，
 * 所以 1.12 之后游戏 stdout 输出的是多行 log4j XML 事件，而不是普通文本。
 * 这里把它们聚合成一条可读记录，并保留无法识别的原始输出。
 */
export interface GameLogEvent {
  time: number
  level: LaunchLogLevel
  logger: string
  thread: string
  message: string
  detail: string | null
}

export type GameLogFeed =
  | { type: 'event'; event: GameLogEvent }
  | { type: 'raw'; text: string }

// Mod List / classloader 这类事件本身就有上千行，不能按普通日志行数截断。
// 上限只用于兜底一个始终不闭合的畸形事件。
const MAX_EVENT_LINES = 20_000
const MAX_EVENT_CHARS = 8 * 1024 * 1024

const LEVELS: Record<string, LaunchLogLevel> = {
  TRACE: 'trace',
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  WARNING: 'warn',
  ERROR: 'error',
  FATAL: 'fatal'
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
      const code = Number.parseInt(hex, 16)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : _
    })
    .replace(/&#(\d+);/g, (_, dec: string) => {
      const code = Number.parseInt(dec, 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : _
    })
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function normalizeBlock(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(/\u0000/g, '').trim()
}

function readBlock(body: string, tag: string): string | null {
  const cdata = new RegExp(
    `<${tag}\\b[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/${tag}>`,
    'i'
  ).exec(body)
  if (cdata) return normalizeBlock(cdata[1])
  const plain = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(body)
  return plain ? normalizeBlock(decodeEntities(plain[1])) : null
}

function readAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const pattern = /([A-Za-z_:][\w:.-]*)\s*=\s*"([^"]*)"/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source))) {
    attrs[match[1]] = decodeEntities(match[2])
  }
  return attrs
}

export function parseGameLogEvent(text: string): GameLogEvent | null {
  const event = /<log4j:Event\b([^>]*)>([\s\S]*?)<\/log4j:Event>/i.exec(text)
  if (!event) return null
  const attrs = readAttributes(event[1])
  const message = readBlock(event[2], 'log4j:Message')
  if (message === null) return null
  const detail = readBlock(event[2], 'log4j:Throwable')
  const timestamp = Number(attrs.timestamp)
  const now = Date.now()
  const time =
    Number.isFinite(timestamp) && timestamp > 946684800000 && timestamp < 7258118400000
      ? timestamp
      : now
  return {
    // XML 里的 timestamp 是事件真实发生时间；缺失或异常时才退回接收时间。
    time,
    level: LEVELS[(attrs.level ?? '').toUpperCase()] ?? 'info',
    logger: attrs.logger ?? '',
    thread: attrs.thread ?? '',
    message,
    detail: detail && detail.length ? detail : null
  }
}

export class GameLogAssembler {
  private lines: string[] = []
  private chars = 0

  push(line: string): GameLogFeed[] {
    const trimmed = line.trimStart()
    if (!this.lines.length) {
      if (/^<\/?log4j:EventSet\b/i.test(trimmed)) return []
      if (!/^<log4j:Event\b/i.test(trimmed)) return [{ type: 'raw', text: line }]
      this.append(line)
      if (!trimmed.includes('</log4j:Event>')) return []
      return this.drain()
    }
    // 新事件在旧事件闭合前出现，说明上一条已经损坏，保留原文后重新开始。
    if (/^<log4j:Event\b/i.test(trimmed)) {
      return [...this.drainRaw(), ...this.push(line)]
    }
    this.append(line)
    if (line.includes('</log4j:Event>')) return this.drain()
    if (this.lines.length > MAX_EVENT_LINES || this.chars > MAX_EVENT_CHARS) {
      return this.drainRaw()
    }
    return []
  }

  flush(): GameLogFeed[] {
    return this.lines.length ? this.drainRaw() : []
  }

  private append(line: string): void {
    this.lines.push(line)
    this.chars += line.length + 1
  }

  private reset(): void {
    this.lines = []
    this.chars = 0
  }

  private drainRaw(): GameLogFeed[] {
    const text = this.lines.join('\n')
    this.reset()
    return [{ type: 'raw', text }]
  }

  private drain(): GameLogFeed[] {
    const text = this.lines.join('\n')
    this.reset()
    const event = parseGameLogEvent(text)
    return event ? [{ type: 'event', event }] : [{ type: 'raw', text }]
  }
}
