import type { TranslationSegmentKind } from '../../shared/types'

const CJK = /[\u3400-\u9fff]/
const LETTERS = /[A-Za-z]{2,}/
const METADATA_COMMENT =
  /^(?:default|range|allowed values?|min(?:imum)?|max(?:imum)?|example|type|values?|note)\s*:/i
const TECH_ONLY =
  /^(?:https?:\/\/|www\.|[A-Za-z]:\\|\/|\.{0,2}\/|[A-Za-z0-9_.-]+:[A-Za-z0-9_./-]+$|\d+(?:\.\d+)*$|[%${}()[\]:;,.+\-*/\\|&§#\s\d]+$)/i
const PROTECTED_RE =
  /https?:\/\/[^\s"'<>]+|%(\d+\$)?[-+0-9.]*[sdf]|\$\{[^}]+\}|\{[0-9A-Za-z_.-]+\}|[§&][0-9a-fk-or]|\\[nrt]|\\u[0-9a-fA-F]{4}|\b[a-z0-9_.-]+:[a-z0-9_./-]+\b/gi

export function looksTranslatable(
  raw: string,
  kind: TranslationSegmentKind = 'json'
): boolean {
  const text = raw.trim()
  if (!text || text.length > 4000) return false
  if (CJK.test(text)) return false
  if (!LETTERS.test(text)) return false
  if (TECH_ONLY.test(text)) return false
  if (kind === 'comment' && METADATA_COMMENT.test(text)) return false
  if (/^[-=*_~\s]{3,}$/.test(text)) return false
  if (!text.includes(' ') && text.length <= 3) return false
  if (!text.includes(' ') && /^[A-Z0-9_]+$/.test(text)) return false
  return true
}

export function protectedTokenCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const match of text.matchAll(PROTECTED_RE)) {
    const token = match[0]
    counts.set(token, (counts.get(token) ?? 0) + 1)
  }
  return counts
}

export function sameProtectedTokens(source: string, translated: string): boolean {
  if ((source.match(/\n/g) ?? []).length !== (translated.match(/\n/g) ?? []).length) {
    return false
  }
  const left = protectedTokenCounts(source)
  const right = protectedTokenCounts(translated)
  if (left.size !== right.size) return false
  for (const [token, count] of left) {
    if (right.get(token) !== count) return false
  }
  return true
}

export function lineNumberAt(text: string, offset: number): number {
  let line = 1
  const end = Math.max(0, Math.min(offset, text.length))
  for (let index = 0; index < end; index += 1) {
    if (text.charCodeAt(index) === 10) line += 1
  }
  return line
}

export function escapeSnbt(value: string): string {
  return JSON.stringify(value)
}
