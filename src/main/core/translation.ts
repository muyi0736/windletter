import AdmZip from 'adm-zip'
import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import type {
  InstanceSummary,
  TranslationApplyFile,
  TranslationApplyRequest,
  TranslationApplyResult,
  TranslationBatchRequest,
  TranslationBatchResult,
  TranslationEnablePackResult,
  TranslationFileAction,
  TranslationFileKind,
  TranslationFileView,
  TranslationPreview,
  TranslationPreviewRequest,
  TranslationScanResult,
  TranslationScanScope,
  TranslationSegmentKind,
  TranslationSegmentView
} from '../../shared/types'
import { getAiConfigView } from './ai'
import { getInstance, getInstanceDir, getInstanceGameDir } from './instances'
import { getLaunchState } from './launcher'
import { getCommunityGlossaryCount, getTranslationGlossary } from './translationGlossary'
import {
  escapeSnbt,
  lineNumberAt,
  looksTranslatable,
  sameProtectedTokens
} from './translationText'
import { translateBatch } from './translationAi'
import { writeFileAtomic } from './version'

const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_FILES = 3000
const MAX_SEGMENTS = 80_000
const MAX_CHARS = 2_500_000
const MAX_MOD_JARS = 800
const MAX_SHADER_PACKS = 400
const MAX_SHADER_ZIP_BYTES = 256 * 1024 * 1024
const MAX_BACKUPS = 20
const PACK_PREFIX = '月月月汉化-'
const FTB_LANG_ROOT = 'config/ftbquests/quests/lang'
const FTB_CHAPTER_ROOT = 'config/ftbquests/quests/chapters'
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'backups',
  'logs',
  'saves',
  'screenshots',
  'mods',
  'libraries',
  'versions',
  'crash-reports',
  'downloads'
])

type Eol = 'lf' | 'crlf'

interface DecodedText {
  text: string
  bom: boolean
  eol: Eol
}

interface LangPart {
  source: string
  lead: string
  trail: string
  start: number
  end: number
  raw: string
}

interface LangEntry {
  key: string
  array: boolean
  parts: LangPart[]
}

interface InternalSegment {
  id: string
  source: string
  line: number
  field: string
  kind: TranslationSegmentKind
  start: number
  end: number
  key?: string
  lead?: string
  trail?: string
}

interface ScannedFile {
  id: string
  rel: string
  sourceLabel?: string | null
  abs: string
  kind: TranslationFileKind
  action: TranslationFileAction
  targetRel: string | null
  targetAbs: string | null
  source: DecodedText
  target: DecodedText | null
  targetExists: boolean
  segments: InternalSegment[]
  warnings: string[]
  skipped: number
  entries?: LangEntry[]
  targetEntries?: LangEntry[]
  jsonSource?: Record<string, unknown>
  jsonTarget?: Record<string, unknown>
  shaderPack?: {
    type: 'zip' | 'folder'
    packAbs: string
    packRel: string
    sourceEntry: string
    targetEntry: string
  }
}

interface BuiltFile {
  before: string
  after: string
  changed: number
  warnings: string[]
}

interface ScanCache {
  instanceId: string
  at: number
  files: ScannedFile[]
}

let scanCache: ScanCache | null = null

function decodeText(buffer: Buffer): DecodedText {
  const bom =
    buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf
  const raw = buffer.toString('utf8', bom ? 3 : 0)
  return {
    text: raw.replace(/\r\n/g, '\n'),
    bom,
    eol: raw.includes('\r\n') ? 'crlf' : 'lf'
  }
}

function encodeText(value: string, bom: boolean, eol: Eol): string {
  const normalized = value.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  const text = eol === 'crlf' ? normalized.replace(/\n/g, '\r\n') : normalized
  return `${bom ? '\uFEFF' : ''}${text}`
}

function normalizeRel(value: string): string {
  const path = value.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!path || path.length > 500 || path.split('/').includes('..') || /^[A-Za-z]:/.test(path)) {
    throw new Error('无效的汉化文件路径')
  }
  return path
}

function safeJoin(root: string, rel: string): string {
  const base = resolve(root)
  const target = resolve(base, rel)
  if (target !== base && !target.startsWith(base + sep)) {
    throw new Error('汉化文件路径越界')
  }
  return target
}

async function readDecoded(abs: string): Promise<DecodedText> {
  const stat = await fs.stat(abs)
  if (!stat.isFile()) throw new Error('不是文件')
  if (stat.size > MAX_FILE_BYTES) throw new Error('文件超过 2 MB，暂不处理')
  return decodeText(await fs.readFile(abs))
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.stat(path)
    return true
  } catch {
    return false
  }
}

function packFolderName(instance: InstanceSummary): string {
  return `${PACK_PREFIX}${instance.id}`
}

function packRelative(instance: InstanceSummary): string {
  return `resourcepacks/${packFolderName(instance)}`
}

function packFormatFor(gameVersion: string): number {
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(gameVersion)
  const major = Number(match?.[1] ?? 1)
  const minor = Number(match?.[2] ?? 20)
  const patch = Number(match?.[3] ?? 0)
  if (major >= 26) return 64
  if (major > 1) return 64
  if (minor >= 21) {
    if (patch >= 6) return 63
    if (patch >= 5) return 55
    if (patch >= 4) return 46
    if (patch >= 2) return 42
    return 34
  }
  if (minor >= 20) {
    if (patch >= 5) return 32
    if (patch >= 3) return 22
    if (patch === 2) return 18
    return 15
  }
  if (minor === 19) return patch >= 4 ? 13 : patch >= 3 ? 12 : 9
  if (minor === 18) return 8
  if (minor === 17) return 7
  if (minor === 16) return 6
  if (minor === 15) return 5
  if (minor === 14 || minor === 13) return 4
  if (minor === 12 || minor === 11) return 3
  if (minor >= 9) return 2
  return 1
}

async function resourcePackInfo(
  gameDir: string,
  instance: InstanceSummary
): Promise<TranslationScanResult['resourcePack']> {
  const folder = packRelative(instance)
  const packAbs = safeJoin(gameDir, folder)
  const exists = await pathExists(packAbs)
  let enabled = false
  try {
    const options = await fs.readFile(join(gameDir, 'options.txt'), 'utf8')
    const line = options.split(/\r?\n/).find((item) => item.startsWith('resourcePacks:'))
    if (line) {
      const raw = line.slice('resourcePacks:'.length).trim()
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) {
        enabled = parsed.some((item) => item === `file/${packFolderName(instance)}`)
      }
    }
  } catch {
    /* options.txt 不存在或格式未知 */
  }
  return { folder, path: packAbs, exists, enabled }
}

async function ensurePackMeta(
  gameDir: string,
  instance: InstanceSummary
): Promise<void> {
  const folder = packRelative(instance)
  const metaPath = safeJoin(gameDir, `${folder}/pack.mcmeta`)
  if (await pathExists(metaPath)) return
  const packFormat = packFormatFor(instance.gameVersion)
  const meta = {
    pack: {
      pack_format: packFormat,
      supported_formats: [Math.min(packFormat, 15), Math.max(packFormat, 64)],
      description: `月月月汉化 · ${instance.name}`
    }
  }
  await fs.mkdir(dirname(metaPath), { recursive: true })
  await writeFileAtomic(metaPath, `${JSON.stringify(meta, null, 2)}\n`)
}

export async function enableTranslationPack(
  instanceId: string
): Promise<TranslationEnablePackResult> {
  const instance = await getInstance(instanceId)
  ensureNotRunning(instance.id)
  const gameDir = await getInstanceGameDir(instance.id)
  const packRel = packRelative(instance)
  if (!(await pathExists(safeJoin(gameDir, packRel)))) {
    throw new Error('还没有生成汉化资源包，请先应用模组/手册翻译')
  }
  const optionsPath = join(gameDir, 'options.txt')
  if (!(await pathExists(optionsPath))) {
    throw new Error('还没有 options.txt；请先启动一次游戏，再回来启用资源包')
  }
  const options = await fs.readFile(optionsPath, 'utf8')
  const eol = options.includes('\r\n') ? '\r\n' : '\n'
  const lines = options.split(/\r?\n/)
  const packEntry = `file/${packFolderName(instance)}`
  let found = false
  const next = lines.map((line) => {
    if (!line.startsWith('resourcePacks:')) return line
    found = true
    let packs: unknown[] = []
    try {
      const parsed = JSON.parse(line.slice('resourcePacks:'.length).trim())
      if (Array.isArray(parsed)) packs = parsed
    } catch {
      packs = []
    }
    if (!packs.includes(packEntry)) packs.push(packEntry)
    return `resourcePacks:${JSON.stringify(packs)}`
  })
  if (!found) next.push(`resourcePacks:${JSON.stringify(['vanilla', packEntry])}`)
  const stamp = backupStamp()
  const backupRoot = join(getInstanceDir(instance.id), 'backups', 'translation', stamp)
  await fs.mkdir(backupRoot, { recursive: true })
  await fs.copyFile(optionsPath, join(backupRoot, 'options.txt'))
  await writeFileAtomic(optionsPath, next.join(eol))
  return {
    enabled: true,
    path: safeJoin(gameDir, packRel),
    message: '已加入资源包列表；进游戏后在「选项 → 资源包」确认顺序'
  }
}

async function walkFiles(
  root: string,
  accept: (rel: string) => boolean,
  limit = MAX_FILES * 4
): Promise<string[]> {
  const out: string[] = []
  const walk = async (dir: string): Promise<void> => {
    if (out.length >= limit) return
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (out.length >= limit) return
      if (entry.isSymbolicLink()) continue
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name.toLowerCase())) continue
        await walk(abs)
        continue
      }
      if (!entry.isFile()) continue
      const rel = relative(root, abs).replace(/\\/g, '/')
      if (accept(rel)) out.push(rel)
    }
  }
  await walk(root)
  return out
}

function lowerPath(rel: string): string {
  return rel.toLowerCase()
}

function isFtbLangSource(rel: string): boolean {
  const lower = lowerPath(rel)
  return (
    lower.startsWith(`${FTB_LANG_ROOT.toLowerCase()}/`) &&
    /(^|\/)en_us(\/|\.)/.test(lower) &&
    /\.(?:snbt|json5?|json)$/.test(lower)
  )
}

function ftbTargetPath(rel: string): string {
  return rel.replace(/(^|\/)en_us(?=\/|\.)/i, (_match, prefix: string) => `${prefix}zh_cn`)
}

function isFtbChapter(rel: string): boolean {
  const lower = lowerPath(rel)
  return (
    lower.startsWith(`${FTB_CHAPTER_ROOT.toLowerCase()}/`) &&
    /\.(?:snbt|json5?)$/.test(lower)
  )
}

function isGenericLangSource(rel: string): boolean {
  const lower = lowerPath(rel)
  if (lower.startsWith(`${FTB_LANG_ROOT.toLowerCase()}/`)) return false
  if (!/(^|\/)en_us\.(json|lang)$/.test(lower)) return false
  return (
    lower.startsWith('kubejs/assets/') ||
    lower.startsWith('resourcepacks/') ||
    (lower.startsWith('config/') && lower.includes('/lang/'))
  )
}

function genericTargetPath(rel: string): string {
  if (/\.json$/i.test(rel)) {
    return rel.replace(/(^|\/)en_us\.json$/i, (_match, prefix: string) => `${prefix}zh_cn.json`)
  }
  return rel.replace(/(^|\/)en_us\.lang$/i, (_match, prefix: string) => {
    const upper = /en_us\.lang$/i.test(rel) && rel.includes('en_US')
    return `${prefix}${upper ? 'zh_CN' : 'zh_cn'}.lang`
  })
}

function isConfigSource(rel: string): boolean {
  const lower = lowerPath(rel)
  if (!lower.startsWith('config/')) return false
  if (lower.startsWith(`${FTB_LANG_ROOT.toLowerCase()}/`)) return false
  if (lower.startsWith(`${FTB_CHAPTER_ROOT.toLowerCase()}/`)) return false
  return /\.(?:toml|cfg|properties)$/.test(lower)
}

function skipWsComments(text: string, index: number): number {
  let i = index
  const length = text.length
  while (i < length) {
    const ch = text[i]
    if (/\s/.test(ch)) {
      i += 1
      continue
    }
    if (ch === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i + 2)
      i = end < 0 ? length : end + 1
      continue
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end < 0 ? length : end + 2
      continue
    }
    break
  }
  return i
}

function readQuoted(
  text: string,
  index: number
): { value: string; start: number; end: number; next: number } {
  const quote = text[index]
  if (quote !== '"' && quote !== "'") throw new Error('不是字符串')
  let i = index + 1
  let value = ''
  while (i < text.length) {
    const ch = text[i]
    if (ch === '\\') {
      const next = text[i + 1]
      if (next === undefined) break
      if (next === 'n') value += '\n'
      else if (next === 'r') value += '\r'
      else if (next === 't') value += '\t'
      else if (next === 'b') value += '\b'
      else if (next === 'f') value += '\f'
      else if (next === 'u') {
        const hex = text.slice(i + 2, i + 6)
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          value += String.fromCharCode(Number.parseInt(hex, 16))
          i += 6
          continue
        }
        value += 'u'
        i += 2
        continue
      } else if (next === '\n') {
        i += 2
        continue
      } else if (next === '\r') {
        i += text[i + 2] === '\n' ? 3 : 2
        continue
      } else value += next
      i += 2
      continue
    }
    if (ch === quote) {
      return { value, start: index + 1, end: i, next: i + 1 }
    }
    value += ch
    i += 1
  }
  throw new Error('字符串没有闭合')
}

function skipComposite(text: string, index: number): number {
  const open = text[index]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let i = index
  while (i < text.length) {
    const ch = text[i]
    if (ch === '"' || ch === "'") {
      i = readQuoted(text, i).next
      continue
    }
    if (ch === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i + 2)
      i = end < 0 ? text.length : end + 1
      continue
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end < 0 ? text.length : end + 2
      continue
    }
    if (ch === open) depth += 1
    else if (ch === close) {
      depth -= 1
      if (depth === 0) return i + 1
    }
    i += 1
  }
  return i
}

function skipJsonValue(text: string, index: number): number {
  const ch = text[index]
  if (ch === '"' || ch === "'") return readQuoted(text, index).next
  if (ch === '{' || ch === '[') return skipComposite(text, index)
  let i = index
  while (i < text.length) {
    const current = text[i]
    if (current === ',' || current === '}' || current === ']') break
    i += 1
  }
  return i
}

function isRichText(value: string): boolean {
  const trimmed = value.trim()
  return (
    trimmed.startsWith('{') ||
    trimmed.startsWith('[') ||
    /"(?:text|translate)"\s*:/.test(trimmed)
  )
}

function partFromString(
  value: string,
  start: number,
  end: number
): LangPart | null {
  const lead = (value.match(/^\s*/) ?? [''])[0]
  const trail = (value.match(/\s*$/) ?? [''])[0]
  const source = value.slice(lead.length, value.length - trail.length)
  if (!source.trim()) return null
  return {
    source,
    lead,
    trail,
    start: start + lead.length,
    end: end - trail.length,
    raw: value
  }
}

function extractStringParts(text: string, start: number, end: number): LangPart[] {
  const parts: LangPart[] = []
  let i = start
  while (i < end) {
    i = skipWsComments(text, i)
    if (i >= end) break
    const ch = text[i]
    if (ch === '{') {
      i = skipComposite(text, i)
      continue
    }
    if (ch === '[') {
      i = skipComposite(text, i)
      continue
    }
    if (ch === '"' || ch === "'") {
      const value = readQuoted(text, i)
      if (!isRichText(value.value)) {
        const part = partFromString(value.value, value.start, value.end)
        if (part) parts.push(part)
      }
      i = value.next
      continue
    }
    i += 1
  }
  return parts
}

function parseJsonLikeEntries(text: string): LangEntry[] {
  const entries: LangEntry[] = []
  let i = skipWsComments(text, 0)
  if (text[i] !== '{') throw new Error('不是 JSON 对象')
  i += 1
  while (i < text.length) {
    i = skipWsComments(text, i)
    if (i >= text.length || text[i] === '}') break
    if (text[i] === ',') {
      i += 1
      continue
    }
    let key = ''
    if (text[i] === '"' || text[i] === "'") {
      const value = readQuoted(text, i)
      key = value.value
      i = value.next
    } else {
      const match = /^[A-Za-z0-9_.-]+/.exec(text.slice(i))
      if (!match) break
      key = match[0]
      i += key.length
    }
    i = skipWsComments(text, i)
    if (text[i] !== ':') break
    i += 1
    i = skipWsComments(text, i)
    const valueStart = i
    const valueEnd = skipJsonValue(text, i)
    const first = text[valueStart]
    let array = false
    let parts: LangPart[] = []
    if (first === '"' || first === "'") {
      const value = readQuoted(text, valueStart)
      const part = partFromString(value.value, value.start, value.end)
      if (part) parts = [part]
    } else if (first === '[') {
      array = true
      parts = extractStringParts(text, valueStart + 1, valueEnd - 1)
    }
    entries.push({ key, array, parts })
    i = valueEnd
  }
  return entries
}

function findArrayEnd(text: string, index: number): number {
  let depth = 0
  let i = index
  while (i < text.length) {
    const ch = text[i]
    if (ch === '"' || ch === "'") {
      i = readQuoted(text, i).next
      continue
    }
    if (ch === '[') depth += 1
    else if (ch === ']') {
      depth -= 1
      if (depth === 0) return i + 1
    }
    i += 1
  }
  return i
}

function parseSnbtEntries(text: string): LangEntry[] {
  const entries: LangEntry[] = []
  let offset = 0
  while (offset < text.length) {
    const lineEnd = text.indexOf('\n', offset)
    const end = lineEnd < 0 ? text.length : lineEnd
    const line = text.slice(offset, end)
    const match = /^(\s*)([A-Za-z0-9_.:-]+)\s*:\s*(.*)$/.exec(line)
    if (match) {
      const key = match[2]
      const colon = line.indexOf(':', match[1].length + key.length)
      const afterColon = line.slice(colon + 1)
      const spaces = (afterColon.match(/^\s*/) ?? [''])[0].length
      const valueStart = offset + colon + 1 + spaces
      const valueRaw = text.slice(valueStart, end)
      if (valueRaw.startsWith('"') || valueRaw.startsWith("'")) {
        const value = readQuoted(text, valueStart)
        const part = partFromString(value.value, value.start, value.end)
        entries.push({ key, array: false, parts: part ? [part] : [] })
      } else if (valueRaw.startsWith('[')) {
        const arrayEnd = findArrayEnd(text, valueStart)
        const parts = extractStringParts(text, valueStart + 1, arrayEnd - 1)
        entries.push({ key, array: true, parts })
        offset = arrayEnd
        continue
      }
    }
    offset = lineEnd < 0 ? text.length : lineEnd + 1
  }
  return entries
}

function parseEntries(text: string, ext: string): LangEntry[] {
  return ext === 'snbt' ? parseSnbtEntries(text) : parseJsonLikeEntries(text)
}

function addEntrySegments(
  file: ScannedFile,
  entries: LangEntry[],
  ext: string
): void {
  const targetContent = new Set((file.targetEntries ?? []).map((entry) => entry.key))
  for (const entry of entries) {
    if (targetContent.has(entry.key)) {
      file.skipped += 1
      continue
    }
    let added = 0
    entry.parts.forEach((part, index) => {
      if (!looksTranslatable(part.source, ext === 'snbt' ? 'snbt' : 'json5')) {
        return
      }
      file.segments.push({
        id: `${file.id}::${entry.key}::${index}`,
        source: part.source.trim(),
        line: lineNumberAt(file.source.text, part.start),
        field: entry.key,
        kind: ext === 'snbt' ? 'snbt' : ext === 'json' ? 'json' : 'json5',
        start: part.start,
        end: part.end,
        key: entry.key,
        lead: part.lead,
        trail: part.trail
      })
      added += 1
    })
    if (added === 0) file.skipped += 1
  }
}

async function scanFtbLang(
  gameDir: string,
  rel: string
): Promise<ScannedFile | null> {
  const abs = safeJoin(gameDir, rel)
  const source = await readDecoded(abs)
  const ext = rel.split('.').pop()?.toLowerCase() ?? 'snbt'
  const targetRel = ftbTargetPath(rel)
  const targetAbs = safeJoin(gameDir, targetRel)
  const targetExists = await pathExists(targetAbs)
  let target: DecodedText | null = null
  let targetEntries: LangEntry[] = []
  const warnings: string[] = []
  if (targetExists) {
    try {
      target = await readDecoded(targetAbs)
      targetEntries = parseEntries(target.text, ext)
    } catch (error) {
      warnings.push(
        `目标文件无法解析，已跳过：${targetRel}（${error instanceof Error ? error.message : '未知错误'}）`
      )
      targetEntries = []
    }
  }
  let entries: LangEntry[] = []
  try {
    entries = parseEntries(source.text, ext)
  } catch (error) {
    warnings.push(
      `源文件无法解析，已跳过：${rel}（${error instanceof Error ? error.message : '未知错误'}）`
    )
  }
  const file: ScannedFile = {
    id: rel,
    rel,
    abs,
    kind: 'ftb-lang',
    action: targetExists ? 'merge' : 'create',
    targetRel,
    targetAbs,
    source,
    target,
    targetExists,
    segments: [],
    warnings,
    skipped: 0,
    entries,
    targetEntries
  }
  if (warnings.length === 0) addEntrySegments(file, entries, ext)
  return file
}

function parseGenericJson(text: string): Record<string, unknown> {
  const parsed = JSON.parse(text) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('不是 JSON 对象')
  }
  return parsed as Record<string, unknown>
}

function scanGenericLang(
  gameDir: string,
  rel: string
): Promise<ScannedFile | null> {
  return (async () => {
    const abs = safeJoin(gameDir, rel)
    const source = await readDecoded(abs)
    const targetRel = genericTargetPath(rel)
    const targetAbs = safeJoin(gameDir, targetRel)
    const targetExists = await pathExists(targetAbs)
    let target: DecodedText | null = null
    const warnings: string[] = []
    const isJson = /\.json$/i.test(rel)
    let jsonSource: Record<string, unknown> | undefined
    let jsonTarget: Record<string, unknown> | undefined
    if (isJson) {
      try {
        jsonSource = parseGenericJson(source.text)
      } catch (error) {
        warnings.push(
          `lang 文件无法解析：${rel}（${error instanceof Error ? error.message : '未知错误'}）`
        )
      }
      if (targetExists) {
        try {
          target = await readDecoded(targetAbs)
          jsonTarget = parseGenericJson(target.text)
        } catch (error) {
          warnings.push(
            `目标 lang 无法解析，已跳过：${targetRel}（${error instanceof Error ? error.message : '未知错误'}）`
          )
        }
      }
    } else {
      if (targetExists) target = await readDecoded(targetAbs)
    }
    const file: ScannedFile = {
      id: rel,
      rel,
      abs,
      kind: 'lang',
      action: targetExists ? 'merge' : 'create',
      targetRel,
      targetAbs,
      source,
      target,
      targetExists,
      segments: [],
      warnings,
      skipped: 0,
      jsonSource,
      jsonTarget
    }
    if (warnings.length > 0) return file
    if (isJson && jsonSource) {
      for (const [key, value] of Object.entries(jsonSource)) {
        if (typeof value !== 'string') continue
        const existing = jsonTarget?.[key]
        if (typeof existing === 'string' && existing.trim()) {
          file.skipped += 1
          continue
        }
        if (!looksTranslatable(value, 'json')) {
          file.skipped += 1
          continue
        }
        const lead = (value.match(/^\s*/) ?? [''])[0]
        const trail = (value.match(/\s*$/) ?? [''])[0]
        const keyAt = source.text.indexOf(JSON.stringify(key))
        file.segments.push({
          id: `${file.id}::${key}`,
          source: value.slice(lead.length, value.length - trail.length).trim(),
          line: keyAt >= 0 ? lineNumberAt(source.text, keyAt) : 1,
          field: key,
          kind: 'json',
          start: 0,
          end: 0,
          key,
          lead,
          trail
        })
      }
      return file
    }

    const targetKeys = new Set<string>()
    if (target) {
      for (const line of target.text.split('\n')) {
        const match = /^\s*([^#!\s][^=]*?)\s*=/.exec(line)
        if (match) targetKeys.add(match[1].trim())
      }
    }
    let offset = 0
    for (const line of source.text.split('\n')) {
      const match = /^(\s*)([^#!\s][^=]*?)\s*=\s*(.*)$/.exec(line)
      if (match) {
        const key = match[2].trim()
        const valueStart = offset + line.indexOf(match[3], match[1].length + match[2].length)
        const value = match[3]
        if (targetKeys.has(key)) {
          file.skipped += 1
        } else if (looksTranslatable(value, 'lang')) {
          const lead = (value.match(/^\s*/) ?? [''])[0]
          const trail = (value.match(/\s*$/) ?? [''])[0]
          const sourceText = value.slice(lead.length, value.length - trail.length).trim()
          if (sourceText) {
            file.segments.push({
              id: `${file.id}::${key}`,
              source: sourceText,
              line: lineNumberAt(source.text, valueStart),
              field: key,
              kind: 'lang',
              start: valueStart + lead.length,
              end: valueStart + value.length - trail.length,
              key,
              lead,
              trail
            })
          }
        } else {
          file.skipped += 1
        }
      }
      offset += line.length + 1
    }
    return file
  })()
}

function scanChapter(gameDir: string, rel: string): Promise<ScannedFile | null> {
  return (async () => {
    const abs = safeJoin(gameDir, rel)
    const source = await readDecoded(abs)
    const file: ScannedFile = {
      id: rel,
      rel,
      abs,
      kind: 'ftb-chapter',
      action: 'in-place',
      targetRel: null,
      targetAbs: null,
      source,
      target: null,
      targetExists: false,
      segments: [],
      warnings: [],
      skipped: 0
    }
    let offset = 0
    let counter = 0
    while (offset < source.text.length) {
      const lineEnd = source.text.indexOf('\n', offset)
      const end = lineEnd < 0 ? source.text.length : lineEnd
      const line = source.text.slice(offset, end)
      const match = /^\s*"?(title|subtitle|description)"?\s*:\s*(.*)$/.exec(line)
      if (match) {
        const key = match[1]
        const keyIndex = line.indexOf(key)
        const colon = line.indexOf(':', keyIndex + key.length)
        const after = line.slice(colon + 1)
        const spaces = (after.match(/^\s*/) ?? [''])[0].length
        const valueStart = offset + colon + 1 + spaces
        const valueRaw = source.text.slice(valueStart, end)
        if (valueRaw.startsWith('"') || valueRaw.startsWith("'")) {
          const value = readQuoted(source.text, valueStart)
          if (!isRichText(value.value) && looksTranslatable(value.value, 'snbt')) {
            const part = partFromString(value.value, value.start, value.end)
            if (part) {
              counter += 1
              file.segments.push({
                id: `${rel}::${counter}`,
                source: part.source.trim(),
                line: lineNumberAt(source.text, value.start),
                field: key,
                kind: 'snbt',
                start: part.start,
                end: part.end
              })
            }
          } else file.skipped += 1
        } else if (valueRaw.startsWith('[')) {
          const arrayEnd = findArrayEnd(source.text, valueStart)
          const parts = extractStringParts(source.text, valueStart + 1, arrayEnd - 1)
          for (const part of parts) {
            if (!looksTranslatable(part.source, 'snbt')) continue
            counter += 1
            file.segments.push({
              id: `${rel}::${counter}`,
              source: part.source.trim(),
              line: lineNumberAt(source.text, part.start),
              field: key,
              kind: 'snbt',
              start: part.start,
              end: part.end
            })
          }
          offset = arrayEnd
          continue
        }
      }
      offset = lineEnd < 0 ? source.text.length : lineEnd + 1
    }
    return file
  })()
}

function scanConfig(gameDir: string, rel: string): Promise<ScannedFile | null> {
  return (async () => {
    const abs = safeJoin(gameDir, rel)
    const source = await readDecoded(abs)
    const file: ScannedFile = {
      id: rel,
      rel,
      abs,
      kind: 'config',
      action: 'in-place',
      targetRel: null,
      targetAbs: null,
      source,
      target: null,
      targetExists: false,
      segments: [],
      warnings: [],
      skipped: 0
    }
    let offset = 0
    let counter = 0
    let triple: '"""' | "'''" | null = null
    for (const line of source.text.split('\n')) {
      if (triple) {
        if (line.includes(triple)) triple = null
        offset += line.length + 1
        continue
      }
      const tripleMarker = /"""|'''/.exec(line)
      if (tripleMarker) {
        const marker = tripleMarker[0] as '"""' | "'''"
        const occurrences = line.split(marker).length - 1
        if (occurrences % 2 === 1) {
          triple = marker
          offset += line.length + 1
          continue
        }
      }
      let quote: string | null = null
      let comment = -1
      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i]
        if (quote) {
          if (ch === '\\') i += 1
          else if (ch === quote) quote = null
          continue
        }
        if (ch === '"' || ch === "'") {
          quote = ch
          continue
        }
        if (ch === '#') {
          comment = i
          break
        }
      }
      if (comment >= 0) {
        const after = line.slice(comment + 1)
        const spaces = (after.match(/^\s*/) ?? [''])[0].length
        const sourceStart = offset + comment + 1 + spaces
        const trimmedEnd = offset + line.length - (line.match(/\s*$/)?.[0].length ?? 0)
        const value = source.text.slice(sourceStart, trimmedEnd)
        if (value && looksTranslatable(value, 'comment')) {
          counter += 1
          file.segments.push({
            id: `${rel}::${counter}`,
            source: value.trim(),
            line: lineNumberAt(source.text, sourceStart),
            field: 'comment',
            kind: 'comment',
            start: sourceStart,
            end: trimmedEnd
          })
        } else if (value.trim()) file.skipped += 1
      }
      offset += line.length + 1
    }
    return file
  })()
}

const PATCHOULI_TEXT_KEYS = new Set([
  'name',
  'text',
  'title',
  'description',
  'landing_text',
  'subtitle',
  'header',
  'caption',
  'label',
  'tooltip',
  'author',
  'intro',
  'use_text',
  'book_text'
])

function sanitizePackSegment(value: string): string {
  return value
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/')
}

async function walkJarPaths(root: string, limit = MAX_MOD_JARS): Promise<string[]> {
  const out: string[] = []
  const walk = async (dir: string): Promise<void> => {
    if (out.length >= limit) return
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (out.length >= limit) return
      if (entry.isSymbolicLink()) continue
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(abs)
        continue
      }
      if (!entry.isFile() || !/\.jar$/i.test(entry.name)) continue
      out.push(`mods/${relative(root, abs).replace(/\\/g, '/')}`)
    }
  }
  await walk(root)
  return out
}

function parseLangLines(text: string): { key: string; value: string; start: number; end: number }[] {
  const out: { key: string; value: string; start: number; end: number }[] = []
  let offset = 0
  for (const line of text.split('\n')) {
    const match = /^(\s*)([^#!\s][^=]*?)\s*=\s*(.*)$/.exec(line)
    if (match) {
      const key = match[2].trim()
      const valueStart = offset + line.indexOf(match[3], match[1].length + match[2].length)
      const value = match[3]
      out.push({ key, value, start: valueStart, end: valueStart + value.length })
    }
    offset += line.length + 1
  }
  return out
}

function langValues(text: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const item of parseLangLines(text)) {
    if (item.value.trim()) map.set(item.key, item.value.trim())
  }
  return map
}

function collectJsonLeaves(
  value: unknown,
  path: string[],
  keyHint: string | null,
  out: { path: string[]; value: string }[],
  onlyTranslatable = true
): void {
  if (typeof value === 'string') {
    if (
      keyHint &&
      PATCHOULI_TEXT_KEYS.has(keyHint) &&
      (!onlyTranslatable || looksTranslatable(value, 'json'))
    ) {
      out.push({ path, value })
    }
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectJsonLeaves(item, [...path, String(index)], keyHint, out, onlyTranslatable)
    )
    return
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      collectJsonLeaves(child, [...path, key], key.toLowerCase(), out, onlyTranslatable)
    }
  }
}

function getAtPath(root: unknown, path: string[]): unknown {
  let current: unknown = root
  for (const part of path) {
    if (Array.isArray(current)) current = current[Number(part)]
    else if (current && typeof current === 'object') {
      current = (current as Record<string, unknown>)[part]
    } else return undefined
  }
  return current
}

function setAtPath(root: unknown, path: string[], value: string): void {
  let current: any = root
  for (let index = 0; index < path.length - 1; index += 1) {
    const part = path[index]
    if (current == null) return
    current = Array.isArray(current) ? current[Number(part)] : current[part]
  }
  if (current == null) return
  const last = path[path.length - 1]
  if (Array.isArray(current)) current[Number(last)] = value
  else current[last] = value
}

function mergeJson(source: unknown, target: unknown): unknown {
  if (Array.isArray(source)) {
    if (!Array.isArray(target)) return source
    return source.map((item, index) => mergeJson(item, target[index]))
  }
  if (source && typeof source === 'object') {
    if (!target || typeof target !== 'object' || Array.isArray(target)) return source
    const next: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
      next[key] = mergeJson(value, (target as Record<string, unknown>)[key])
    }
    return next
  }
  return target === undefined ? source : target
}

function countHardcodedDisplayField(value: unknown): number {
  if (typeof value === 'string') return looksTranslatable(value, 'json') ? 1 : 0
  if (Array.isArray(value)) {
    return value.reduce<number>((sum, item) => sum + countHardcodedDisplayField(item), 0)
  }
  if (!value || typeof value !== 'object') return 0
  const component = value as Record<string, unknown>
  if (typeof component.text === 'string' && looksTranslatable(component.text, 'json')) {
    return 1
  }
  return 0
}

function countHardcodedAdvancementTexts(entries: AdmZip.IZipEntry[]): number {
  let count = 0
  for (const entry of entries) {
    if (!/^data\/[^/]+\/advancements?\/.+\.json$/i.test(entry.entryName)) continue
    let buffer: Buffer
    try {
      buffer = entry.getData()
    } catch {
      continue
    }
    if (buffer.length > MAX_FILE_BYTES || !buffer.includes('"text"')) continue
    let json: unknown
    try {
      json = JSON.parse(buffer.toString('utf8'))
    } catch {
      continue
    }
    if (!json || typeof json !== 'object') continue
    const display = (json as Record<string, unknown>).display
    if (!display || typeof display !== 'object') continue
    const view = display as Record<string, unknown>
    count += countHardcodedDisplayField(view.title)
    count += countHardcodedDisplayField(view.description)
  }
  return count
}

async function scanJarMods(
  instance: InstanceSummary,
  gameDir: string
): Promise<{ files: ScannedFile[]; warnings: string[] }> {
  const files: ScannedFile[] = []
  const warnings: string[] = []
  let hardcodedAdvancementTexts = 0
  const modsRoot = safeJoin(gameDir, 'mods')
  if (!(await pathExists(modsRoot))) return { files, warnings }
  const jars = await walkJarPaths(modsRoot)
  const packRel = packRelative(instance)
  for (const jarRel of jars) {
    const jarAbs = safeJoin(gameDir, jarRel)
    if (jarAbs.includes(`${sep}mods${sep}`) && /\.disabled$/i.test(jarRel)) continue
    let zip: AdmZip
    try {
      zip = new AdmZip(jarAbs)
    } catch {
      warnings.push(`${jarRel}：无法读取 jar`)
      continue
    }
    let entries: AdmZip.IZipEntry[]
    try {
      entries = zip.getEntries().filter((entry) => !entry.isDirectory)
    } catch (error) {
      warnings.push(
        `${jarRel}：jar 条目读取失败（${error instanceof Error ? error.message : '未知错误'}）`
      )
      continue
    }
    const entryMap = new Map(entries.map((entry) => [entry.entryName, entry]))
    hardcodedAdvancementTexts += countHardcodedAdvancementTexts(entries)
    const byNamespace = new Map<string, { source: AdmZip.IZipEntry; zh?: AdmZip.IZipEntry; ext: string }>()
    for (const entry of entries) {
      const match = /^assets\/([^/]+)\/lang\/en_us\.(json|lang)$/i.exec(entry.entryName)
      if (!match) continue
      const namespace = match[1]
      const ext = match[2].toLowerCase()
      const zh =
        entryMap.get(`assets/${namespace}/lang/zh_cn.${ext}`) ??
        entryMap.get(`assets/${namespace}/lang/zh_CN.${ext}`)
      byNamespace.set(namespace, { source: entry, zh, ext })
    }

    for (const [namespace, group] of byNamespace) {
      let sourceBuffer: Buffer
      let zhText = ''
      try {
        sourceBuffer = group.source.getData()
        if (sourceBuffer.length > MAX_FILE_BYTES) {
          warnings.push(`${jarRel}!/${group.source.entryName}：文件超过 2 MB，已跳过`)
          continue
        }
        zhText = group.zh ? group.zh.getData().toString('utf8') : ''
      } catch {
        warnings.push(`${jarRel}：语言文件读取失败`)
        continue
      }
      const source = decodeText(sourceBuffer)
      const ext = group.ext
      const targetLang =
        ext === 'lang' && /en_US\.lang$/i.test(group.source.entryName) && group.source.entryName.includes('en_US')
          ? 'zh_CN.lang'
          : `zh_cn.${ext}`
      const targetRel = sanitizePackSegment(
        `${packRel}/assets/${namespace}/lang/${targetLang}`
      )
      const targetAbs = safeJoin(gameDir, targetRel)
      const targetExists = await pathExists(targetAbs)
      let target: DecodedText | null = null
      let targetJson: Record<string, unknown> | undefined
      try {
        if (targetExists) {
          target = await readDecoded(targetAbs)
          if (ext === 'json') targetJson = parseGenericJson(target.text)
        }
      } catch {
        warnings.push(`${targetRel}：现有资源包语言无法解析，已跳过`)
        continue
      }
      const file: ScannedFile = {
        id: `${jarRel}!/${group.source.entryName}`,
        rel: group.source.entryName,
        sourceLabel: `${jarRel}!/${group.source.entryName}`,
        abs: jarAbs,
        kind: 'mod-lang',
        action: targetExists ? 'merge' : 'create',
        targetRel,
        targetAbs,
        source,
        target,
        targetExists,
        segments: [],
        warnings: [],
        skipped: 0
      }
      if (ext === 'json') {
        let sourceJson: Record<string, unknown>
        try {
          sourceJson = parseGenericJson(source.text)
        } catch {
          warnings.push(`${jarRel}!/${group.source.entryName}：JSON 无法解析`)
          continue
        }
        let zhJson: Record<string, unknown> = {}
        try {
          if (zhText.trim()) zhJson = parseGenericJson(zhText)
        } catch {
          zhJson = {}
        }
        const existing = new Map<string, string>()
        for (const [key, value] of Object.entries(zhJson)) {
          if (typeof value === 'string' && value.trim()) existing.set(key, value)
        }
        if (targetJson) {
          for (const [key, value] of Object.entries(targetJson)) {
            if (typeof value === 'string' && value.trim()) existing.set(key, value)
          }
        }
        file.jsonSource = sourceJson
        file.jsonTarget = targetJson
        for (const [key, value] of Object.entries(sourceJson)) {
          if (typeof value !== 'string') continue
          if (existing.has(key)) {
            file.skipped += 1
            continue
          }
          if (!looksTranslatable(value, 'json')) {
            file.skipped += 1
            continue
          }
          const lead = (value.match(/^\s*/) ?? [''])[0]
          const trail = (value.match(/\s*$/) ?? [''])[0]
          file.segments.push({
            id: `${file.id}::${key}`,
            source: value.slice(lead.length, value.length - trail.length).trim(),
            line: 1,
            field: `${namespace}:${key}`,
            kind: 'json',
            start: 0,
            end: 0,
            key,
            lead,
            trail
          })
        }
      } else {
        const sourceMap = langValues(source.text)
        const existing = new Map<string, string>()
        for (const [key, value] of langValues(zhText)) existing.set(key, value)
        if (target) {
          for (const [key, value] of langValues(target.text)) existing.set(key, value)
        }
        let offset = 0
        for (const line of source.text.split('\n')) {
          const match = /^(\s*)([^#!\s][^=]*?)\s*=\s*(.*)$/.exec(line)
          if (match) {
            const key = match[2].trim()
            const value = match[3]
            if (existing.has(key)) {
              file.skipped += 1
            } else if (looksTranslatable(value, 'lang')) {
              const lead = (value.match(/^\s*/) ?? [''])[0]
              const trail = (value.match(/\s*$/) ?? [''])[0]
              const sourceText = value.slice(lead.length, value.length - trail.length).trim()
              if (sourceText) {
                const valueStart = offset + line.indexOf(match[3], match[1].length + match[2].length)
                file.segments.push({
                  id: `${file.id}::${key}`,
                  source: sourceText,
                  line: lineNumberAt(source.text, valueStart),
                  field: `${namespace}:${key}`,
                  kind: 'lang',
                  start: valueStart + lead.length,
                  end: valueStart + value.length - trail.length,
                  key,
                  lead,
                  trail
                })
              }
            } else {
              file.skipped += 1
            }
          }
          offset += line.length + 1
        }
      }
      if (file.segments.length > 0) files.push(file)
    }

    for (const entry of entries) {
      const match = /^assets\/([^/]+)\/patchouli_books\/([^/]+)\/en_us\/(.+)\.json$/i.exec(
        entry.entryName
      )
      if (!match) continue
      const namespace = match[1]
      const book = match[2]
      const rest = sanitizePackSegment(match[3])
      if (!rest) continue
      let sourceBuffer: Buffer
      try {
        sourceBuffer = entry.getData()
      } catch {
        continue
      }
      if (sourceBuffer.length > MAX_FILE_BYTES) {
        warnings.push(`${jarRel}!/${entry.entryName}：手册文件超过 2 MB，已跳过`)
        continue
      }
      const source = decodeText(sourceBuffer)
      let sourceJson: Record<string, unknown>
      try {
        sourceJson = parseGenericJson(source.text)
      } catch {
        continue
      }
      const targetRel = sanitizePackSegment(
        `${packRel}/assets/${namespace}/patchouli_books/${book}/zh_cn/${rest}.json`
      )
      const targetAbs = safeJoin(gameDir, targetRel)
      const targetExists = await pathExists(targetAbs)
      let target: DecodedText | null = null
      let targetJson: Record<string, unknown> | undefined
      try {
        if (targetExists) {
          target = await readDecoded(targetAbs)
          targetJson = parseGenericJson(target.text)
        }
      } catch {
        warnings.push(`${targetRel}：现有手册语言无法解析，已跳过`)
        continue
      }
      const leaves: { path: string[]; value: string }[] = []
      collectJsonLeaves(sourceJson, [], null, leaves)
      const existing = new Set<string>()
      if (targetJson) {
        const targetLeaves: { path: string[]; value: string }[] = []
        collectJsonLeaves(targetJson, [], null, targetLeaves, false)
        for (const leaf of targetLeaves) {
          if (leaf.value.trim()) existing.add(leaf.path.join('.'))
        }
      }
      const file: ScannedFile = {
        id: `${jarRel}!/${entry.entryName}`,
        rel: entry.entryName,
        sourceLabel: `${jarRel}!/${entry.entryName}`,
        abs: jarAbs,
        kind: 'patchouli',
        action: targetExists ? 'merge' : 'create',
        targetRel,
        targetAbs,
        source,
        target,
        targetExists,
        segments: [],
        warnings: [],
        skipped: 0,
        jsonSource: sourceJson,
        jsonTarget: targetJson
      }
      for (const leaf of leaves) {
        const key = leaf.path.join('.')
        if (existing.has(key)) {
          file.skipped += 1
          continue
        }
        file.segments.push({
          id: `${file.id}::${key}`,
          source: leaf.value.trim(),
          line: 1,
          field: `${namespace}:${book}:${key}`,
          kind: 'json',
          start: 0,
          end: 0,
          key
        })
      }
      if (file.segments.length > 0) files.push(file)
    }
  }
  if (hardcodedAdvancementTexts > 0) {
    warnings.push(
      `发现 ${hardcodedAdvancementTexts} 条硬编码进度文本（display.title/description 的 text 字段），数据包只能按存档启用，本版暂不处理。`
    )
  }
  return { files, warnings }
}

function looksTranslatableShader(raw: string): boolean {
  const text = raw.replace(/§./g, '').trim()
  if (!text || text.length > 4000) return false
  if (/[\u3400-\u9fff]/.test(text)) return false
  if (!/[A-Za-z]/.test(text)) return false
  if (/^https?:\/\//i.test(text)) return false
  if (/^[A-Za-z0-9_.:/+-]+$/.test(text) && !text.includes(' ')) {
    // Shader lang values are labels; allow short words like Low/High/ON,
    // but still skip identifiers with dots or path separators.
    if (/[./:_-]/.test(text) || text.length > 24) return false
  }
  return true
}

function fillShaderLangSegments(file: ScannedFile, existing: Map<string, string>): void {
  let offset = 0
  const packName = file.shaderPack?.packRel.split('/').pop() ?? file.rel
  for (const line of file.source.text.split('\n')) {
    const match = /^(\s*)([^#!\s][^=]*?)\s*=\s*(.*)$/.exec(line)
    if (!match) {
      offset += line.length + 1
      continue
    }
    const key = match[2].trim()
    const value = match[3]
    if (existing.has(key)) {
      file.skipped += 1
    } else if (looksTranslatableShader(value)) {
      const lead = (value.match(/^\s*/) ?? [''])[0]
      const trail = (value.match(/\s*$/) ?? [''])[0]
      const sourceText = value.slice(lead.length, value.length - trail.length).trim()
      if (sourceText) {
        const valueStart = offset + line.indexOf(match[3], match[1].length + match[2].length)
        file.segments.push({
          id: `${file.id}::${key}`,
          source: sourceText,
          line: lineNumberAt(file.source.text, valueStart),
          field: `${packName}:${key}`,
          kind: 'lang',
          start: valueStart + lead.length,
          end: valueStart + value.length - trail.length,
          key,
          lead,
          trail
        })
      }
    } else {
      file.skipped += 1
    }
    offset += line.length + 1
  }
}

async function scanShaderPacks(
  instance: InstanceSummary,
  gameDir: string
): Promise<{ files: ScannedFile[]; warnings: string[] }> {
  const files: ScannedFile[] = []
  const warnings: string[] = []
  const root = safeJoin(gameDir, 'shaderpacks')
  if (!(await pathExists(root))) return { files, warnings }
  let entries
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    warnings.push('shaderpacks 目录读取失败')
    return { files, warnings }
  }

  let packCount = 0
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue
    if (packCount >= MAX_SHADER_PACKS) {
      warnings.push(`光影包超过 ${MAX_SHADER_PACKS} 个，已截断；可分批处理。`)
      break
    }
    const packRel = `shaderpacks/${entry.name}`
    if (entry.isDirectory()) {
      if (/\.disabled$/i.test(entry.name)) continue
      const packAbs = safeJoin(gameDir, packRel)
      const langFiles = await walkFiles(
        packAbs,
        (rel) => /^shaders\/lang\/en_us\.lang$/i.test(rel),
        20
      )
      if (langFiles.length === 0) continue
      packCount += 1
      if (langFiles.length > 1) {
        warnings.push(`${packRel}：存在多个 en_us.lang，只处理第一个`)
      }
      const sourceEntry = langFiles[0]
      const sourceAbs = safeJoin(packAbs, sourceEntry)
      let sourceBuffer: Buffer
      try {
        const stat = await fs.stat(sourceAbs)
        if (!stat.isFile() || stat.size > MAX_FILE_BYTES) {
          warnings.push(`${packRel}!/${sourceEntry}：语言文件超过 2 MB，已跳过`)
          continue
        }
        sourceBuffer = await fs.readFile(sourceAbs)
      } catch {
        warnings.push(`${packRel}!/${sourceEntry}：语言文件读取失败`)
        continue
      }
      const langDirAbs = dirname(sourceAbs)
      let targetAbs = join(langDirAbs, 'zh_cn.lang')
      let targetEntry = relative(packAbs, targetAbs).replace(/\\/g, '/')
      try {
        const langEntries = await fs.readdir(langDirAbs, { withFileTypes: true })
        const found = langEntries.filter(
          (item) => item.isFile() && /^zh_cn\.lang$/i.test(item.name)
        )
        if (found.length > 0) {
          targetAbs = join(langDirAbs, found[0].name)
          targetEntry = relative(packAbs, targetAbs).replace(/\\/g, '/')
        }
      } catch {
        /* ignore */
      }
      const targetExists = await pathExists(targetAbs)
      let target: DecodedText | null = null
      try {
        if (targetExists) target = await readDecoded(targetAbs)
      } catch {
        warnings.push(`${packRel}!/${targetEntry}：现有中文语言无法解析，已跳过`)
        continue
      }
      const file: ScannedFile = {
        id: `${packRel}!/${sourceEntry}`,
        rel: sourceEntry,
        sourceLabel: `${packRel}!/${sourceEntry}`,
        abs: sourceAbs,
        kind: 'shader-lang',
        action: targetExists ? 'merge' : 'create',
        targetRel: `${packRel}!/${targetEntry}`,
        targetAbs,
        source: decodeText(sourceBuffer),
        target,
        targetExists,
        segments: [],
        warnings: [],
        skipped: 0,
        shaderPack: { type: 'folder', packAbs, packRel, sourceEntry, targetEntry }
      }
      fillShaderLangSegments(file, target ? langValues(target.text) : new Map())
      if (file.segments.length > 0) files.push(file)
      continue
    }
    if (!entry.isFile() || !/\.zip$/i.test(entry.name)) continue
    if (/\.disabled$/i.test(entry.name)) continue
    const packAbs = safeJoin(gameDir, packRel)
    let zipSize = 0
    try {
      zipSize = (await fs.stat(packAbs)).size
    } catch {
      continue
    }
    if (zipSize > MAX_SHADER_ZIP_BYTES) {
      warnings.push(`${packRel}：超过 256 MB，已跳过`)
      continue
    }
    let zip: AdmZip
    try {
      zip = new AdmZip(packAbs)
    } catch {
      warnings.push(`${packRel}：无法读取 zip`)
      continue
    }
    let zipEntries: AdmZip.IZipEntry[]
    try {
      zipEntries = zip.getEntries().filter((item) => !item.isDirectory)
    } catch (error) {
      warnings.push(
        `${packRel}：zip 条目读取失败（${error instanceof Error ? error.message : '未知错误'}）`
      )
      continue
    }
    const sourceEntries = zipEntries.filter((item) =>
      /^shaders\/lang\/en_us\.lang$/i.test(item.entryName)
    )
    if (sourceEntries.length === 0) continue
    packCount += 1
    if (sourceEntries.length > 1) {
      warnings.push(`${packRel}：存在多个 en_us.lang，只处理第一个`)
    }
    const sourceEntry = sourceEntries[0]
    const targetEntries = zipEntries.filter((item) =>
      /^shaders\/lang\/zh_cn\.lang$/i.test(item.entryName)
    )
    if (targetEntries.length > 1) {
      warnings.push(`${packRel}：存在多个 zh_cn.lang，只处理第一个`)
    }
    const targetEntryName =
      targetEntries[0]?.entryName ??
      sourceEntry.entryName.replace(/en_us\.lang$/i, 'zh_cn.lang')
    let sourceBuffer: Buffer
    let targetBuffer: Buffer | null = null
    try {
      sourceBuffer = sourceEntry.getData()
      if (sourceBuffer.length > MAX_FILE_BYTES) {
        warnings.push(`${packRel}!/${sourceEntry.entryName}：语言文件超过 2 MB，已跳过`)
        continue
      }
      if (targetEntries[0]) {
        targetBuffer = targetEntries[0].getData()
        if (targetBuffer.length > MAX_FILE_BYTES) {
          warnings.push(`${packRel}!/${targetEntryName}：中文语言超过 2 MB，已跳过`)
          continue
        }
      }
    } catch {
      warnings.push(`${packRel}：语言文件读取失败`)
      continue
    }
    const targetExists = Boolean(targetEntries[0])
    const target = targetBuffer ? decodeText(targetBuffer) : null
    const file: ScannedFile = {
      id: `${packRel}!/${sourceEntry.entryName}`,
      rel: sourceEntry.entryName,
      sourceLabel: `${packRel}!/${sourceEntry.entryName}`,
      abs: packAbs,
      kind: 'shader-lang',
      action: targetExists ? 'merge' : 'create',
      targetRel: `${packRel}!/${targetEntryName}`,
      targetAbs: packAbs,
      source: decodeText(sourceBuffer),
      target,
      targetExists,
      segments: [],
      warnings: [],
      skipped: 0,
      shaderPack: {
        type: 'zip',
        packAbs,
        packRel,
        sourceEntry: sourceEntry.entryName,
        targetEntry: targetEntryName
      }
    }
    fillShaderLangSegments(file, target ? langValues(target.text) : new Map())
    if (file.segments.length > 0) files.push(file)
  }
  return { files, warnings }
}

async function scanOne(
  gameDir: string,
  rel: string,
  scanChapters: boolean
): Promise<ScannedFile | null> {
  if (isFtbLangSource(rel)) return scanFtbLang(gameDir, rel)
  if (isGenericLangSource(rel)) return scanGenericLang(gameDir, rel)
  if (scanChapters && isFtbChapter(rel)) return scanChapter(gameDir, rel)
  if (isConfigSource(rel)) return scanConfig(gameDir, rel)
  return null
}

async function hasChineseFtbLang(gameDir: string): Promise<boolean> {
  const root = safeJoin(gameDir, FTB_LANG_ROOT)
  if (!(await pathExists(root))) return false
  const dir = join(root, 'zh_cn')
  if (await pathExists(dir)) {
    const files = await walkFiles(dir, () => true, 1)
    if (files.length > 0) return true
  }
  const files = await walkFiles(root, (rel) => /(^|\/)zh_cn[^/]*\.(?:snbt|json5?|json)$/i.test(rel), 2000)
  for (const rel of files) {
    try {
      if ((await fs.stat(safeJoin(root, rel))).size > 8) return true
    } catch {
      /* ignore */
    }
  }
  return false
}

function normalizeScope(raw: unknown): TranslationScanScope {
  return raw === 'text' || raw === 'config' || raw === 'mods' || raw === 'shader'
    ? raw
    : 'all'
}

async function collectFiles(
  instance: InstanceSummary,
  scope: TranslationScanScope
): Promise<{
  gameDir: string
  files: ScannedFile[]
  warnings: string[]
}> {
  const gameDir = await getInstanceGameDir(instance.id)
  const warnings: string[] = []
  const ftbQueue: string[] = []
  const langQueue: string[] = []
  const chapterQueue: string[] = []
  const configQueue: string[] = []
  const langRoot = safeJoin(gameDir, FTB_LANG_ROOT)
  const chapterRoot = safeJoin(gameDir, FTB_CHAPTER_ROOT)

  for (const rel of await walkFiles(
    langRoot,
    (item) => isFtbLangSource(`${FTB_LANG_ROOT}/${item}`),
    1200
  )) {
    ftbQueue.push(`${FTB_LANG_ROOT}/${rel}`)
  }
  for (const root of ['kubejs/assets', 'resourcepacks', 'config']) {
    const abs = safeJoin(gameDir, root)
    if (!(await pathExists(abs))) continue
    for (const rel of await walkFiles(
      abs,
      (item) => isGenericLangSource(`${root}/${item}`),
      1600
    )) {
      langQueue.push(`${root}/${rel}`)
    }
  }
  const hasZhCn = await hasChineseFtbLang(gameDir)
  if (!hasZhCn) {
    for (const rel of await walkFiles(
      chapterRoot,
      (item) => /\.(?:snbt|json5?)$/i.test(item),
      1200
    )) {
      chapterQueue.push(`${FTB_CHAPTER_ROOT}/${rel}`)
    }
  }
  const configRoot = safeJoin(gameDir, 'config')
  if (await pathExists(configRoot)) {
    for (const rel of await walkFiles(
      configRoot,
      (item) => isConfigSource(`config/${item}`),
      4000
    )) {
      configQueue.push(`config/${rel}`)
    }
  }

  const textQueue =
    scope === 'config' || scope === 'mods' || scope === 'shader'
      ? []
      : [...ftbQueue, ...langQueue, ...chapterQueue]
  const configScopeQueue =
    scope === 'text' || scope === 'mods' || scope === 'shader' ? [] : configQueue
  let modFiles: ScannedFile[] = []
  if (scope === 'all' || scope === 'mods') {
    const modScan = await scanJarMods(instance, gameDir)
    modFiles = modScan.files
    warnings.push(...modScan.warnings)
  }
  let shaderFiles: ScannedFile[] = []
  if (scope === 'all' || scope === 'shader') {
    const shaderScan = await scanShaderPacks(instance, gameDir)
    shaderFiles = shaderScan.files
    warnings.push(...shaderScan.warnings)
  }

  const files: ScannedFile[] = []
  let segments = 0
  let chars = 0
  const seen = new Set<string>()
  const items: { rel?: string; file?: ScannedFile }[] = []
  for (const rel of [...textQueue, ...configScopeQueue]) {
    const key = rel.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    items.push({ rel })
  }
  if (modFiles.length > 0) {
    const insertAt = Math.min(items.length, textQueue.length)
    items.splice(insertAt, 0, ...modFiles.map((file) => ({ file })))
  }
  if (shaderFiles.length > 0) {
    items.push(...shaderFiles.map((file) => ({ file })))
  }
  for (const item of items) {
    if (files.length >= MAX_FILES) {
      warnings.push(`文件超过 ${MAX_FILES} 个，已截断；可以缩小整合包或分批处理。`)
      break
    }
    if (segments >= MAX_SEGMENTS) {
      warnings.push(
        `待翻译条目超过 ${MAX_SEGMENTS} 条，已截断；可切换扫描范围分批处理。`
      )
      break
    }
    try {
      const file = item.file ?? (item.rel ? await scanOne(gameDir, item.rel, !hasZhCn) : null)
      if (!file) continue
      if (file.segments.length === 0 && file.warnings.length === 0) continue
      segments += file.segments.length
      chars += file.segments.reduce((sum, current) => sum + current.source.length, 0)
      if (chars > MAX_CHARS) {
        warnings.push(
          `待翻译文本超过 ${Math.round(MAX_CHARS / 1000)}k 字符，已截断；可切换扫描范围分批处理。`
        )
        break
      }
      files.push(file)
    } catch (error) {
      warnings.push(
        `${item.rel ?? item.file?.id ?? '文件'}：${error instanceof Error ? error.message : '读取失败'}`
      )
    }
  }
  files.sort((left, right) => {
    const order: Record<TranslationFileKind, number> = {
      'ftb-lang': 0,
      'ftb-chapter': 1,
      lang: 2,
      'mod-lang': 3,
      patchouli: 4,
      'shader-lang': 5,
      config: 6
    }
    return order[left.kind] - order[right.kind] || left.rel.localeCompare(right.rel)
  })
  return { gameDir, files, warnings }
}

function publicSegments(file: ScannedFile): TranslationSegmentView[] {
  return file.segments.map((segment) => ({
    id: segment.id,
    fileId: file.id,
    source: segment.source,
    line: segment.line,
    field: segment.field,
    kind: segment.kind
  }))
}

export async function scanTranslation(
  instanceId: string,
  rawScope?: unknown
): Promise<TranslationScanResult> {
  const instance = await getInstance(instanceId)
  const scope = normalizeScope(rawScope)
  const { gameDir, files, warnings } = await collectFiles(instance, scope)
  scanCache = { instanceId: instance.id, at: Date.now(), files }
  const glossary = await getTranslationGlossary()
  const communityGlossaryCount = await getCommunityGlossaryCount()
  const ai = await getAiConfigView()
  const views: TranslationFileView[] = await Promise.all(
    files.map(async (file) => ({
      id: file.id,
      path: file.rel,
      sourceLabel: file.sourceLabel ?? null,
      targetPath: file.targetRel,
      kind: file.kind,
      action: file.action,
      size: Buffer.byteLength(file.source.text, 'utf8'),
      modified: (await fs.stat(file.abs)).mtimeMs,
      targetModified: file.targetExists
        ? await fs.stat(file.targetAbs as string).then((stat) => stat.mtimeMs).catch(() => null)
        : null,
      segments: publicSegments(file),
      warnings: file.warnings
    }))
  )
  const totals = views.reduce(
    (sum, file) => {
      sum.files += 1
      sum.segments += file.segments.length
      sum.characters += file.segments.reduce((value, segment) => value + segment.source.length, 0)
      return sum
    },
    { files: 0, segments: 0, characters: 0, skipped: files.reduce((sum, file) => sum + file.skipped, 0) }
  )
  return {
    instanceId: instance.id,
    instanceName: instance.name,
    gameVersion: instance.gameVersion,
    loader: instance.loader,
    scope,
    files: views,
    totals,
    glossary,
    communityGlossaryCount,
    aiEnabled: ai.enabled,
    aiModel: ai.enabled ? ai.model : null,
    resourcePack: await resourcePackInfo(gameDir, instance),
    warnings
  }
}

function detectIndent(text: string, fallback = '  '): string {
  for (const line of text.split('\n')) {
    const match = /^([ \t]+)\S/.exec(line)
    if (match) {
      if (match[1].includes('\t')) return '\t'
      return ' '.repeat(Math.min(8, match[1].length))
    }
  }
  return fallback
}

function appendEntries(
  base: string,
  entries: string[],
  style: 'json5' | 'snbt'
): string {
  if (entries.length === 0) return base
  let text = base.trim()
  if (!text || text === '{}') text = style === 'snbt' ? '{\n}' : '{\n}'
  const close = text.lastIndexOf('}')
  if (close < 0) throw new Error('目标语言文件缺少结束括号')
  const prefix = text.slice(0, close)
  const suffix = text.slice(close)
  const hasContent = prefix.slice(prefix.indexOf('{') + 1).trim().length > 0
  const indent = detectIndent(text, style === 'snbt' ? '\t' : '  ')
  const block = entries
    .map((entry) => `${indent}${entry}`)
    .join(style === 'json5' ? ',\n' : '\n')
  if (!hasContent) {
    const lead = prefix.endsWith('\n') ? '' : '\n'
    return `${prefix}${lead}${block}\n${suffix}`
  }
  const trailing = prefix.match(/\s*$/)?.[0] ?? ''
  const body = prefix.slice(0, prefix.length - trailing.length)
  const needsComma =
    style === 'json5' && body.length > 0 && !body.endsWith(',')
  return `${body}${needsComma ? ',' : ''}\n${block}\n${suffix}`
}

function escapeInner(value: string): string {
  return JSON.stringify(value).slice(1, -1)
}

function bilingualValue(translated: string, source: string, bilingual: boolean): string {
  return bilingual ? `${translated}\n\n${source}` : translated
}

function buildFtbLang(
  file: ScannedFile,
  translations: Record<string, string>,
  warnings: string[],
  bilingual: boolean
): BuiltFile {
  const ext = file.rel.split('.').pop()?.toLowerCase() ?? 'snbt'
  const style = ext === 'snbt' ? 'snbt' : 'json5'
  const lines: string[] = []
  let changed = 0
  for (const entry of file.entries ?? []) {
    const parts = entry.parts.map((part, index) => {
      const id = `${file.id}::${entry.key}::${index}`
      const translated = translations[id]
      if (!translated) return part.source
      if (!sameProtectedTokens(part.source, translated)) {
        warnings.push(`${entry.key}：占位符或 ID 不一致，已保留原文`)
        return part.source
      }
      changed += 1
      return bilingualValue(translated, part.source, bilingual)
    })
    if (parts.every((part, index) => part === entry.parts[index]?.source)) continue
    const key = style === 'json5' ? JSON.stringify(entry.key) : entry.key
    const value = entry.array
      ? `[${parts.map((part) => JSON.stringify(part)).join(style === 'json5' ? ', ' : ' ')}]`
      : JSON.stringify(parts[0] ?? '')
    lines.push(`${key}: ${value}`)
  }
  const before = file.target?.text ?? ''
  const after = appendEntries(before, lines, style)
  return { before, after, changed, warnings }
}

function buildGenericJson(
  file: ScannedFile,
  translations: Record<string, string>,
  warnings: string[]
): BuiltFile {
  const source = file.jsonSource ?? {}
  const target: Record<string, unknown> = { ...(file.jsonTarget ?? {}) }
  let changed = 0
  for (const [key, value] of Object.entries(source)) {
    if (typeof value !== 'string') continue
    const id = `${file.id}::${key}`
    const translated = translations[id]
    if (!translated) continue
    if (!sameProtectedTokens(value, translated)) {
      warnings.push(`${key}：占位符或 ID 不一致，已保留原文`)
      continue
    }
    target[key] = translated
    changed += 1
  }
  const indent = detectIndent(file.source.text)
  const before = file.target?.text ?? ''
  if (changed === 0) return { before, after: before, changed: 0, warnings }
  const after = `${JSON.stringify(target, null, indent)}${file.source.text.endsWith('\n') ? '\n' : ''}`
  return { before, after, changed, warnings }
}

function buildGenericLang(
  file: ScannedFile,
  translations: Record<string, string>,
  warnings: string[]
): BuiltFile {
  const base = file.target?.text ?? file.source.text
  const lines = base.split('\n')
  let changed = 0
  for (const segment of file.segments) {
    const translated = translations[segment.id]
    if (!translated) continue
    if (!sameProtectedTokens(segment.source, translated)) {
      warnings.push(`${segment.field}：占位符或 ID 不一致，已保留原文`)
      continue
    }
    const key = segment.key ?? segment.field
    const index = lines.findIndex((line) => {
      const match = /^\s*([^#!\s][^=]*?)\s*=/.exec(line)
      return match?.[1]?.trim() === key
    })
    const value = `${segment.lead ?? ''}${translated}${segment.trail ?? ''}`
    if (index >= 0) {
      const line = lines[index]
      const match = /^(\s*[^#!\s][^=]*?\s*=\s*)(.*)$/.exec(line)
      if (match) {
        lines[index] = `${match[1]}${value}`
        changed += 1
      }
    } else {
      lines.push(`${key}=${value}`)
      changed += 1
    }
  }
  return {
    before: base,
    after: lines.join('\n'),
    changed,
    warnings
  }
}

function buildInPlace(
  file: ScannedFile,
  translations: Record<string, string>,
  mode: 'snbt' | 'plain',
  warnings: string[],
  bilingual = false
): BuiltFile {
  const edits: { start: number; end: number; value: string }[] = []
  for (const segment of file.segments) {
    const translated = translations[segment.id]
    if (!translated) continue
    if (!sameProtectedTokens(segment.source, translated)) {
      warnings.push(`${segment.field}：占位符或 ID 不一致，已保留原文`)
      continue
    }
    const value =
      mode === 'snbt'
        ? escapeInner(bilingualValue(translated, segment.source, bilingual))
        : translated.replace(/\r?\n/g, ' ')
    edits.push({ start: segment.start, end: segment.end, value })
  }
  let after = file.source.text
  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    after = `${after.slice(0, edit.start)}${edit.value}${after.slice(edit.end)}`
  }
  return {
    before: file.source.text,
    after,
    changed: edits.length,
    warnings
  }
}

function cleanTranslations(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, string> = {}
  let count = 0
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== 'string' || !value || key.length > 300 || value.length > 8000) {
      continue
    }
    out[key] = value
    count += 1
    if (count >= 5000) break
  }
  return out
}

function buildPatchouli(
  file: ScannedFile,
  translations: Record<string, string>,
  warnings: string[]
): BuiltFile {
  const base = mergeJson(file.jsonSource ?? {}, file.jsonTarget ?? {})
  let changed = 0
  for (const segment of file.segments) {
    const translated = translations[segment.id]
    if (!translated) continue
    if (!sameProtectedTokens(segment.source, translated)) {
      warnings.push(`${segment.field}：占位符或 ID 不一致，已保留原文`)
      continue
    }
    setAtPath(base, segment.key?.split('.') ?? [], translated)
    changed += 1
  }
  const indent = detectIndent(file.source.text)
  const before = file.target?.text ?? ''
  if (changed === 0) return { before, after: before, changed, warnings }
  const after = `${JSON.stringify(base, null, indent)}${
    file.source.text.endsWith('\n') ? '\n' : ''
  }`
  return { before, after, changed, warnings }
}

function buildShaderLang(
  file: ScannedFile,
  translations: Record<string, string>,
  warnings: string[]
): BuiltFile {
  const targetValues = file.target ? langValues(file.target.text) : new Map<string, string>()
  const segmentByKey = new Map(file.segments.map((segment) => [segment.key ?? segment.field, segment]))
  const sourceLines = file.source.text.split('\n')
  const seen = new Set<string>()
  let changed = 0
  const lines = sourceLines.map((line) => {
    const match = /^(\s*)([^#!\s][^=]*?)(\s*=\s*)(.*)$/.exec(line)
    if (!match) return line
    const key = match[2].trim()
    seen.add(key)
    if (targetValues.has(key)) {
      return `${match[1]}${match[2]}${match[3]}${targetValues.get(key)}`
    }
    const segment = segmentByKey.get(key)
    const translated = segment ? translations[segment.id] : undefined
    if (!segment || !translated) {
      return `${match[1]}${match[2]}${match[3]}${match[4]}`
    }
    if (!sameProtectedTokens(segment.source, translated)) {
      warnings.push(`${segment.field}：占位符或 ID 不一致，已保留原文`)
      return `${match[1]}${match[2]}${match[3]}${match[4]}`
    }
    changed += 1
    const value = `${segment.lead ?? ''}${translated}${segment.trail ?? ''}`
    return `${match[1]}${match[2]}${match[3]}${value}`
  })
  for (const [key, value] of targetValues) {
    if (seen.has(key)) continue
    lines.push(`${key}=${value}`)
  }
  for (const segment of file.segments) {
    const translated = translations[segment.id]
    if (!translated) continue
    const key = segment.key ?? segment.field
    if (seen.has(key)) continue
    if (!sameProtectedTokens(segment.source, translated)) {
      warnings.push(`${segment.field}：占位符或 ID 不一致，已保留原文`)
      continue
    }
    lines.push(`${key}=${translated}`)
    seen.add(key)
    changed += 1
  }
  return {
    before: file.target?.text ?? '',
    after: lines.join('\n'),
    changed,
    warnings
  }
}

function buildFile(
  file: ScannedFile,
  rawTranslations: Record<string, string>,
  options: { bilingual?: boolean } = {}
): BuiltFile {
  const translations = cleanTranslations(rawTranslations)
  const warnings = [...file.warnings]
  const bilingual = options.bilingual === true
  if (file.kind === 'ftb-lang') {
    return buildFtbLang(file, translations, warnings, bilingual)
  }
  if (file.kind === 'ftb-chapter') {
    return buildInPlace(file, translations, 'snbt', warnings, bilingual)
  }
  if (file.kind === 'config') {
    return buildInPlace(file, translations, 'plain', warnings)
  }
  if (file.kind === 'patchouli') {
    return buildPatchouli(file, translations, warnings)
  }
  if (file.kind === 'shader-lang') {
    return buildShaderLang(file, translations, warnings)
  }
  if (file.kind === 'lang' || file.kind === 'mod-lang') {
    return /\.json$/i.test(file.rel)
      ? buildGenericJson(file, translations, warnings)
      : buildGenericLang(file, translations, warnings)
  }
  return { before: '', after: '', changed: 0, warnings }
}

async function reloadFiles(instanceId: string): Promise<Map<string, ScannedFile>> {
  if (
    scanCache &&
    scanCache.instanceId === instanceId &&
    Date.now() - scanCache.at < 5 * 60_000
  ) {
    return new Map(scanCache.files.map((file) => [file.id, file]))
  }
  const instance = await getInstance(instanceId)
  const { files } = await collectFiles(instance, 'all')
  scanCache = { instanceId: instance.id, at: Date.now(), files }
  return new Map(files.map((file) => [file.id, file]))
}

export async function previewTranslation(
  request: TranslationPreviewRequest
): Promise<TranslationPreview> {
  const files = await reloadFiles(request.instanceId)
  const file = files.get(request.fileId)
  if (!file) throw new Error('找不到要预览的文件，可能已被移动或删除')
  const built = buildFile(file, request.translations ?? {}, {
    bilingual: request.bilingual === true
  })
  return {
    fileId: file.id,
    path: file.rel,
    targetPath: file.targetRel,
    action: file.action,
    before: built.before,
    after: built.after,
    changed: built.changed,
    warnings: built.warnings.slice(0, 20)
  }
}

function ensureNotRunning(instanceId: string): void {
  const state = getLaunchState()
  if (
    state.status === 'preparing' ||
    state.status === 'starting' ||
    state.status === 'running'
  ) {
    if (!state.instanceId || state.instanceId === instanceId) {
      throw new Error('游戏正在运行，先退出游戏再应用汉化')
    }
  }
}

function backupStamp(): string {
  const iso = new Date().toISOString()
  return `${iso.slice(0, 10)}_${iso.slice(11, 23).replace(/[:.]/g, '-')}-${randomBytes(3).toString('hex')}`
}

async function backupFile(
  instanceId: string,
  stamp: string,
  rel: string,
  source: string
): Promise<string> {
  const backupRoot = join(getInstanceDir(instanceId), 'backups', 'translation', stamp)
  const target = safeJoin(backupRoot, rel)
  await fs.mkdir(dirname(target), { recursive: true })
  await fs.copyFile(source, target)
  return `backups/translation/${stamp}/${rel}`
}

async function pruneBackups(instanceId: string): Promise<void> {
  const root = join(getInstanceDir(instanceId), 'backups', 'translation')
  let entries
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return
  }
  const dirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse()
  for (const name of dirs.slice(MAX_BACKUPS)) {
    await fs.rm(join(root, name), { recursive: true, force: true }).catch(() => undefined)
  }
}

async function applyShaderLang(
  instance: InstanceSummary,
  file: ScannedFile,
  content: string,
  stamp: string
): Promise<string | null> {
  const meta = file.shaderPack
  if (!meta) throw new Error('光影包信息缺失，请重新扫描')
  const encoded = encodeText(
    content,
    file.target?.bom ?? file.source.bom,
    file.target?.eol ?? file.source.eol
  )
  if (meta.type === 'folder') {
    let backup: string | null = null
    if (file.targetExists) {
      backup = await backupFile(
        instance.id,
        stamp,
        `shaderpacks/${meta.packRel.split('/').pop()}/${normalizeRel(meta.targetEntry)}`,
        file.targetAbs as string
      )
    }
    await writeFileAtomic(file.targetAbs as string, encoded)
    return backup
  }

  const zipName = meta.packRel.split('/').pop() ?? 'shaderpack.zip'
  let backup: string | null = null
  const backupRoot = join(getInstanceDir(instance.id), 'backups', 'translation', stamp)
  const backupRel = `backups/translation/${stamp}/shaderpacks/${zipName}/${normalizeRel(meta.targetEntry)}`
  const zip = new AdmZip(meta.packAbs)
  const targetEntry = zip.getEntry(meta.targetEntry)
  if (targetEntry) {
    const backupAbs = safeJoin(backupRoot, `shaderpacks/${zipName}/${normalizeRel(meta.targetEntry)}`)
    await fs.mkdir(dirname(backupAbs), { recursive: true })
    await fs.writeFile(backupAbs, targetEntry.getData())
    backup = backupRel
  }
  if (targetEntry) {
    zip.updateFile(meta.targetEntry, Buffer.from(encoded, 'utf8'))
  } else {
    zip.addFile(meta.targetEntry, Buffer.from(encoded, 'utf8'))
  }
  const tmp = `${meta.packAbs}.tmp-${stamp}`
  try {
    zip.writeZip(tmp)
    const verify = new AdmZip(tmp)
    const written = verify.getEntry(meta.targetEntry)
    if (!written || !written.getData().equals(Buffer.from(encoded, 'utf8'))) {
      throw new Error('写入校验失败')
    }
    try {
      await fs.rename(tmp, meta.packAbs)
    } catch {
      const old = `${meta.packAbs}.old-${stamp}`
      await fs.rename(meta.packAbs, old)
      try {
        await fs.rename(tmp, meta.packAbs)
      } catch (error) {
        await fs.rename(old, meta.packAbs).catch(() => undefined)
        throw error
      }
      await fs.rm(old, { force: true })
    }
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => undefined)
    throw error
  }
  return backup
}

function mtimeMatches(actual: number, expected: number): boolean {
  return Number.isFinite(actual) && Math.abs(actual - expected) <= 5
}

export async function applyTranslation(
  request: TranslationApplyRequest
): Promise<TranslationApplyResult> {
  const instance = await getInstance(request.instanceId)
  ensureNotRunning(instance.id)
  if (!Array.isArray(request.files) || request.files.length === 0) {
    throw new Error('没有选择要应用的文件')
  }
  if (request.files.length > MAX_FILES) throw new Error('一次应用的文件过多')
  const gameDir = await getInstanceGameDir(instance.id)
  const files = await reloadFiles(instance.id)
  const packRel = packRelative(instance)
  const stamp = backupStamp()
  const written: TranslationApplyResult['written'] = []
  const skipped: TranslationApplyResult['skipped'] = []
  const warnings: string[] = []
  const targetSeen = new Set<string>()

  for (const item of request.files as TranslationApplyFile[]) {
    const file = files.get(item.fileId)
    if (!file) {
      skipped.push({ path: item.fileId, reason: '文件已被移动或删除' })
      continue
    }
    let stat
    try {
      stat = await fs.stat(file.abs)
    } catch {
      skipped.push({ path: file.rel, reason: '文件已不存在' })
      continue
    }
    if (!mtimeMatches(stat.mtimeMs, item.expectedModified)) {
      skipped.push({ path: file.rel, reason: '源文件已被修改，请重新扫描' })
      continue
    }
    let targetStat: Awaited<ReturnType<typeof fs.stat>> | null = null
    if (file.targetExists) {
      try {
        targetStat = await fs.stat(file.targetAbs as string)
      } catch {
        targetStat = null
      }
    }
    if (file.targetExists) {
      if (!targetStat || item.expectedTargetModified === null || !mtimeMatches(targetStat.mtimeMs, item.expectedTargetModified)) {
        skipped.push({ path: file.targetRel ?? file.rel, reason: '目标文件已被修改，请重新扫描' })
        continue
      }
    } else if (item.expectedTargetModified !== null) {
      skipped.push({ path: file.targetRel ?? file.rel, reason: '目标文件状态已变化，请重新扫描' })
      continue
    }
    if (file.targetRel) {
      const lower = file.targetRel.toLowerCase()
      if (targetSeen.has(lower)) {
        skipped.push({ path: file.targetRel, reason: '多个源文件指向同一目标，已跳过重复项' })
        continue
      }
      targetSeen.add(lower)
    }
    const built = buildFile(file, item.translations ?? {}, {
      bilingual: request.bilingual === true
    })
    warnings.push(...built.warnings)
    if (built.changed === 0 || built.after === built.before) {
      skipped.push({ path: file.targetRel ?? file.rel, reason: '没有可应用的改动' })
      continue
    }
    if (file.kind === 'shader-lang') {
      try {
        const backup = await applyShaderLang(instance, file, built.after, stamp)
        written.push({
          path: file.targetRel ?? file.rel,
          backup,
          segments: built.changed
        })
      } catch (error) {
        skipped.push({
          path: file.targetRel ?? file.rel,
          reason: error instanceof Error ? error.message : '光影语言写入失败'
        })
      }
      continue
    }
    let backup: string | null = null
    try {
      if (file.targetRel) {
        if (file.targetRel.startsWith(`${packRel}/`)) {
          await ensurePackMeta(gameDir, instance)
        }
        if (file.targetExists) {
          backup = await backupFile(instance.id, stamp, file.targetRel, file.targetAbs as string)
        }
        await writeFileAtomic(
          file.targetAbs as string,
          encodeText(
            built.after,
            file.target?.bom ?? file.source.bom,
            file.target?.eol ?? file.source.eol
          )
        )
      } else {
        backup = await backupFile(instance.id, stamp, file.rel, file.abs)
        await writeFileAtomic(
          file.abs,
          encodeText(built.after, file.source.bom, file.source.eol)
        )
      }
      written.push({
        path: file.targetRel ?? file.rel,
        backup,
        segments: built.changed
      })
    } catch (error) {
      skipped.push({
        path: file.targetRel ?? file.rel,
        reason: error instanceof Error ? error.message : '写入失败'
      })
    }
  }
  scanCache = null
  await pruneBackups(instance.id)
  return { written, skipped, warnings: warnings.slice(0, 30) }
}

export { translateBatch }
