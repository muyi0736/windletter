import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type {
  KubeJsLogEntry,
  KubeJsLogFileInfo,
  KubeJsLogFrame,
  KubeJsLogReport,
  KubeJsLogSource
} from '../../shared/types'
import { getInstanceGameDir } from './instances'
import { listKubeJsFiles } from './packWorkshop'

const MAX_TAIL_BYTES = 2 * 1024 * 1024
const MAX_ENTRIES = 200
const MAX_DETAIL_LINES = 18
const MAX_FRAMES = 8
const LOG_EXTENSIONS = /\.(?:txt|log)$/i
const MAX_LOG_FILES = 10

const MC_HEADER =
  /^\[(?:[^\]]*\s)?(\d{2}:\d{2}:\d{2})(?:[.:]\d+)?\]\s*\[([^\]]*?)\/(ERROR|WARN|WARNING|FATAL|INFO|DEBUG)\]\s*(?:\[([^\]]+)\]\s*)?(.*)$/
const KJS_HEADER =
  /^\[(\d{2}:\d{2}:\d{2})(?:[.:]\d+)?\]\s*(?:\[(ERROR|WARN|WARNING|FATAL|INFO|DEBUG|TRACE)\]\s*)?(.*)$/
const SCRIPT_PATTERN =
  /((?:server_scripts|client_scripts|startup_scripts)[/\\].+?\.js)(?:#|:)(\d+)(?::(\d+))?/i
const SCRIPT_REFERENCE = /(?:server_scripts|client_scripts|startup_scripts)[/\\].+?\.js/i
const FRAME_SCRIPT =
  /((?:server_scripts|client_scripts|startup_scripts)[/\\].+?\.js):(\d+)/i

interface ParsedHeader {
  time: string | null
  level: 'info' | 'error' | 'warning'
  message: string
}

interface EntryBuilder {
  time: string | null
  level: 'error' | 'warning'
  message: string
  details: string[]
  source: KubeJsLogSource
  rawPath: string | null
  line: number | null
  column: number | null
  index: number
}

function cleanLine(value: string): string {
  return value
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .trimEnd()
}

function parseHeader(line: string, source: KubeJsLogSource): ParsedHeader | null {
  if (source === 'latest') {
    const match = MC_HEADER.exec(line)
    if (!match) return null
    const level = match[3].toUpperCase()
    return {
      time: match[1],
      level:
        level === 'ERROR' || level === 'FATAL'
          ? 'error'
          : level === 'WARN' || level === 'WARNING'
            ? 'warning'
            : 'info',
      message: match[5].trim().replace(/^[:\-\s]+/, '')
    }
  }
  const match = KJS_HEADER.exec(line)
  if (!match) return null
  const level = (match[2] ?? '').toUpperCase()
  return {
    time: match[1],
    level:
      level === 'ERROR' || level === 'FATAL'
        ? 'error'
        : level === 'WARN' || level === 'WARNING'
          ? 'warning'
          : 'info',
    message: match[3].trim()
  }
}

function extractScript(text: string): { rawPath: string; line: number; column: number | null } | null {
  const match = SCRIPT_PATTERN.exec(text)
  if (!match) return null
  return {
    rawPath: match[1].replace(/\\/g, '/'),
    line: Number.parseInt(match[2], 10),
    column: match[3] ? Number.parseInt(match[3], 10) : null
  }
}

function extractFrames(lines: string[]): KubeJsLogFrame[] {
  const frames: KubeJsLogFrame[] = []
  for (const line of lines) {
    const trimmed = cleanLine(line).trim()
    if (!trimmed) continue
    if (!/^\s*at\s+/.test(line)) continue
    const match = FRAME_SCRIPT.exec(trimmed)
    if (!match) continue
    frames.push({
      file: match[1].replace(/\\/g, '/'),
      line: Number.parseInt(match[2], 10),
      text: trimmed.slice(0, 320)
    })
    if (frames.length >= MAX_FRAMES) break
  }
  return frames
}

async function readTail(
  file: string,
  maxBytes: number
): Promise<{ text: string; size: number; modified: number; truncated: boolean } | null> {
  try {
    const stat = await fs.stat(file)
    if (!stat.isFile()) return null
    const start = Math.max(0, stat.size - maxBytes)
    const length = stat.size - start
    const buffer = Buffer.alloc(length)
    const handle = await fs.open(file, 'r')
    try {
      await handle.read(buffer, 0, length, start)
    } finally {
      await handle.close()
    }
    let text = buffer.toString('utf8')
    if (start > 0) {
      const newline = text.indexOf('\n')
      text = newline >= 0 ? text.slice(newline + 1) : ''
    }
    return { text, size: stat.size, modified: stat.mtimeMs, truncated: start > 0 }
  } catch {
    return null
  }
}

function sourceFromName(name: string): KubeJsLogSource | null {
  const lower = name.toLowerCase()
  if (lower.includes('server')) return 'server'
  if (lower.includes('client')) return 'client'
  if (lower.includes('startup')) return 'startup'
  return null
}

function flushEntry(
  builder: EntryBuilder | null,
  entries: EntryBuilder[],
  fileIndex: number
): void {
  if (!builder) return
  if (!builder.message.trim()) return
  if (
    builder.source === 'latest' &&
    !/kubejs/i.test(builder.message) &&
    !SCRIPT_REFERENCE.test(builder.message)
  ) {
    const hasStack = builder.details.some((line) => SCRIPT_REFERENCE.test(line))
    if (!hasStack) return
  }
  entries.push({ ...builder, index: fileIndex })
}

function parseLogText(
  text: string,
  source: KubeJsLogSource,
  fileIndex: number,
  entries: EntryBuilder[]
): void {
  let current: EntryBuilder | null = null
  let blankLines = 0
  const lines = text.split(/\r?\n/)
  for (const rawLine of lines) {
    const line = cleanLine(rawLine)
    if (!line.trim()) {
      if (current) {
        blankLines += 1
        if (blankLines >= 2) {
          flushEntry(current, entries, fileIndex)
          current = null
          blankLines = 0
        }
      }
      continue
    }
    blankLines = 0
    const header = parseHeader(line, source)
    if (header) {
      flushEntry(current, entries, fileIndex)
      current = null
      if (header.level === 'info') continue
      const script = extractScript(header.message)
      current = {
        time: header.time,
        level: header.level,
        message: header.message,
        details: [],
        source,
        rawPath: script?.rawPath ?? null,
        line: script?.line ?? null,
        column: script?.column ?? null,
        index: fileIndex
      }
      continue
    }
    if (current) {
      if (current.details.length < MAX_DETAIL_LINES) current.details.push(line)
      if (!current.rawPath) {
        const script = extractScript(line)
        if (script) {
          current.rawPath = script.rawPath
          current.line = script.line
          current.column = script.column
        }
      }
      continue
    }
    if (SCRIPT_REFERENCE.test(line) && /\b(?:error|exception|failed|cannot|unable)\b/i.test(line)) {
      const script = extractScript(line)
      current = {
        time: null,
        level: 'error',
        message: line.trim(),
        details: [],
        source,
        rawPath: script?.rawPath ?? null,
        line: script?.line ?? null,
        column: script?.column ?? null,
        index: fileIndex
      }
    }
  }
  flushEntry(current, entries, fileIndex)
}

function resolveScriptPath(
  rawPath: string,
  known: Map<string, string>
): string | null {
  const normalized = rawPath.replace(/\\/g, '/').toLowerCase()
  const direct = known.get(normalized)
  if (direct) return direct
  const basenameOnly = normalized.split('/').pop() ?? ''
  const matches: string[] = []
  for (const [key, original] of known) {
    if (key.split('/').pop() === basenameOnly) matches.push(original)
  }
  return matches.length === 1 ? matches[0] : null
}

function toEntry(
  builder: EntryBuilder,
  known: Map<string, string>
): KubeJsLogEntry {
  const resolved = builder.rawPath ? resolveScriptPath(builder.rawPath, known) : null
  const frames = extractFrames(builder.details)
    .map((frame) => ({
      ...frame,
      file: resolveScriptPath(frame.file as string, known)
    }))
    .filter((frame) => frame.file !== null)
    .slice(0, MAX_FRAMES)
  return {
    id: `${builder.source}-${builder.index}-${builder.time ?? 'x'}-${builder.rawPath ?? ''}-${builder.line ?? 0}-${builder.message.slice(0, 40)}`,
    time: builder.time,
    level: builder.level,
    message: builder.message.slice(0, 600),
    scriptPath: resolved,
    rawPath: builder.rawPath,
    line: builder.line,
    column: builder.column,
    source: builder.source,
    details: builder.details.slice(0, MAX_DETAIL_LINES),
    frames
  }
}

export async function readKubeJsLogs(instanceId: string): Promise<KubeJsLogReport> {
  const gameDir = await getInstanceGameDir(instanceId)
  const known = new Map<string, string>()
  try {
    const listing = await listKubeJsFiles(instanceId)
    for (const file of listing.files) {
      if (file.path.toLowerCase().endsWith('.js')) {
        known.set(file.path.replace(/\\/g, '/').toLowerCase(), file.path)
      }
    }
  } catch {
    /* 文件列表失败时仍然返回原始日志 */
  }

  const candidates: { source: KubeJsLogSource; file: string; name: string }[] = []
  const kubejsLogDir = join(gameDir, 'logs', 'kubejs')
  try {
    const names = (await fs.readdir(kubejsLogDir))
      .filter((name) => LOG_EXTENSIONS.test(name))
      .sort()
      .slice(0, MAX_LOG_FILES)
    for (const name of names) {
      const source = sourceFromName(name)
      if (!source) continue
      candidates.push({
        source,
        file: join(kubejsLogDir, name),
        name: `logs/kubejs/${name}`
      })
    }
  } catch {
    /* 没有 kubejs 日志目录 */
  }
  candidates.push({
    source: 'latest',
    file: join(gameDir, 'logs', 'latest.log'),
    name: 'logs/latest.log'
  })

  const builders: EntryBuilder[] = []
  const files: KubeJsLogFileInfo[] = []
  let truncated = false
  let index = 0
  for (const candidate of candidates) {
    const tail = await readTail(candidate.file, MAX_TAIL_BYTES)
    if (!tail) continue
    const before = builders.length
    parseLogText(tail.text, candidate.source, index, builders)
    const count = builders.length - before
    files.push({
      name: candidate.name,
      source: candidate.source,
      size: tail.size,
      modified: tail.modified,
      entries: count
    })
    truncated = truncated || tail.truncated
    index += 1
  }

  const seen = new Set<string>()
  const deduped: EntryBuilder[] = []
  for (const builder of builders) {
    const key = `${builder.rawPath ?? ''}|${builder.line ?? 0}|${builder.message.slice(0, 160)}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(builder)
  }
  const selected = deduped.slice(-MAX_ENTRIES)
  truncated = truncated || selected.length < deduped.length

  const entries = selected
    .map((builder) => toEntry(builder, known))
    .sort((a, b) => (b.time ?? '').localeCompare(a.time ?? ''))

  return {
    instanceId,
    entries,
    files,
    truncated,
    scannedAt: Date.now(),
    error: null
  }
}
