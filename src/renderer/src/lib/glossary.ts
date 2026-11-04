import type { TranslationGlossaryEntry } from '@shared/types'

function clean(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 160)
    : ''
}

function normalizeEntry(item: unknown): TranslationGlossaryEntry | null {
  if (!item || typeof item !== 'object') return null
  const value = item as Record<string, unknown>
  const source = clean(value.source ?? value.term ?? value.en)
  const target = clean(value.target ?? value.translation ?? value.zh)
  return source && target ? { source, target } : null
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = []
  let value = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"'
        index += 1
      } else {
        quoted = !quoted
      }
      continue
    }
    if (!quoted && char === delimiter) {
      cells.push(value)
      value = ''
      continue
    }
    value += char
  }
  cells.push(value)
  return cells
}

export function parseGlossaryText(
  text: string,
  filename = ''
): TranslationGlossaryEntry[] {
  const trimmed = text.replace(/^\uFEFF/, '').trim()
  if (!trimmed) return []
  const lower = filename.toLowerCase()
  if (lower.endsWith('.json') || trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown
      if (Array.isArray(parsed)) {
        return parsed.map(normalizeEntry).filter((entry): entry is TranslationGlossaryEntry => Boolean(entry))
      }
      if (parsed && typeof parsed === 'object') {
        return Object.entries(parsed as Record<string, unknown>)
          .map(([source, target]) => normalizeEntry({ source, target }))
          .filter((entry): entry is TranslationGlossaryEntry => Boolean(entry))
      }
    } catch {
      /* fall through to text */
    }
  }
  const lines = trimmed.split(/\r?\n/).filter((line) => line.trim())
  const delimiter = lines[0]?.includes('\t')
    ? '\t'
    : lines[0]?.includes(',')
      ? ','
      : lines[0]?.includes('=')
        ? '='
        : null
  const entries: TranslationGlossaryEntry[] = []
  for (const line of lines) {
    if (line.trim().startsWith('#')) continue
    const header = line.toLowerCase().replace(/\s+/g, '')
    if (header === 'source,target' || header === 'source\ttarget' || header === 'en,zh') {
      continue
    }
    let source = ''
    let target = ''
    if (delimiter === '=') {
      const index = line.indexOf('=')
      source = line.slice(0, index)
      target = line.slice(index + 1)
    } else if (delimiter) {
      const cells = parseCsvLine(line, delimiter)
      source = cells[0] ?? ''
      target = cells.slice(1).join(delimiter)
    } else {
      const cells = line.split(/\s+\|\s+|\s{2,}/)
      if (cells.length < 2) continue
      source = cells[0]
      target = cells.slice(1).join(' ')
    }
    const entry = normalizeEntry({ source, target })
    if (entry) entries.push(entry)
    if (entries.length >= 300_000) break
  }
  return entries
}

export function glossaryToCsv(entries: TranslationGlossaryEntry[]): string {
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`
  return `\uFEFFsource,target\n${entries
    .map((entry) => `${escape(entry.source)},${escape(entry.target)}`)
    .join('\n')}\n`
}

function normalizePhrase(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

export interface GlossaryIndex {
  entries: Map<string, TranslationGlossaryEntry>
}

export function buildGlossaryIndex(
  entries: TranslationGlossaryEntry[]
): GlossaryIndex {
  const map = new Map<string, TranslationGlossaryEntry>()
  for (const entry of entries) {
    const phrase = normalizePhrase(entry.source)
    if (phrase) map.set(phrase, entry)
  }
  return { entries: map }
}

export function selectRelevantGlossary(
  index: GlossaryIndex,
  texts: string[],
  max = 40
): TranslationGlossaryEntry[] {
  if (index.entries.size === 0) return []
  const selected = new Map<string, TranslationGlossaryEntry>()
  for (const text of texts) {
    const normalized = normalizePhrase(text)
    const exact = index.entries.get(normalized)
    if (exact) selected.set(exact.source.toLowerCase(), exact)
    const tokens = (normalized.match(/[a-z0-9][a-z0-9_.'-]*/g) ?? []).map((token) =>
      token.replace(/[.'-]+$/, '')
    )
    for (let size = 1; size <= 4; size += 1) {
      for (let start = 0; start + size <= tokens.length; start += 1) {
        const phrase = tokens.slice(start, start + size).join(' ')
        const entry = index.entries.get(phrase)
        if (entry) selected.set(entry.source.toLowerCase(), entry)
      }
    }
    if (selected.size >= max) break
  }
  return [...selected.values()].slice(0, max)
}
