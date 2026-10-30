import { promises as fs } from 'node:fs'
import { basename, isAbsolute, join, relative } from 'node:path'
import { nativeImage } from 'electron'
import AdmZip from 'adm-zip'
import type {
  ContentPreviewDirResult,
  ContentPreviewEntry,
  ContentPreviewFile,
  ContentPreviewFileKind,
  ContentPreviewSearchResult,
  ContentPackPreview,
  PreviewableContentKind
} from '../../shared/types'
import { getInstance, getInstanceGameDir } from './instances'

const DIRS: Record<PreviewableContentKind, string> = {
  datapack: 'datapacks',
  resourcepack: 'resourcepacks',
  shader: 'shaderpacks'
}

const MAX_ZIP_BYTES = 256 * 1024 * 1024
const MAX_ICON_BYTES = 2 * 1024 * 1024
const MAX_TEXT_READ = 2 * 1024 * 1024
const TEXT_PREVIEW_BYTES = 256 * 1024
const MAX_MEDIA_BYTES = 8 * 1024 * 1024
const MAX_DIR_ENTRIES = 1000
const MAX_SEARCH_RESULTS = 100
const NOISE = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini'])
const NOISE_DIR = '__MACOSX'

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif'])
const AUDIO_EXT = new Set(['ogg', 'wav', 'mp3'])
const TEXT_EXT = new Set([
  'json',
  'json5',
  'mcmeta',
  'mcfunction',
  'snbt',
  'txt',
  'md',
  'markdown',
  'lang',
  'properties',
  'cfg',
  'conf',
  'toml',
  'yaml',
  'yml',
  'csv',
  'log',
  'xml',
  'html',
  'css',
  'glsl',
  'vsh',
  'fsh',
  'gsh',
  'csh',
  'tesc',
  'tese',
  'geom',
  'comp',
  'vert',
  'frag',
  'rsh',
  'inc',
  'h',
  'hh',
  'js',
  'ts'
])
const TEXT_NAMES = new Set(['readme', 'license', 'licence', 'changelog', 'copying', 'notice'])
const MIME_IMAGE: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif'
}
const MIME_AUDIO: Record<string, string> = {
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  mp3: 'audio/mpeg'
}

interface CachedEntry {
  path: string
  name: string
  size: number
  entry: AdmZip.IZipEntry
}

interface PackCache {
  key: string
  name: string
  size: number
  zip: AdmZip
  files: Map<string, CachedEntry>
  children: Map<string, Map<string, 'file' | 'dir'>>
  fileCount: number
  totalBytes: number
}

let packCache: PackCache | null = null

function isPreviewableKind(value: unknown): value is PreviewableContentKind {
  return value === 'datapack' || value === 'resourcepack' || value === 'shader'
}

function cleanEntryPath(value: string): string | null {
  const clean = value
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
  if (!clean || clean.length > 500) return null
  const parts = clean.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..')) return null
  if (parts[0] === NOISE_DIR) return null
  return parts.join('/')
}

function entryName(path: string): string {
  const index = path.lastIndexOf('/')
  return index < 0 ? path : path.slice(index + 1)
}

function extensionOf(path: string): string {
  const name = entryName(path).toLowerCase()
  if (!name.includes('.')) return ''
  return name.slice(name.lastIndexOf('.') + 1)
}

function displayLength(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

function flattenComponent(value: unknown, depth = 0): string {
  if (depth > 8 || value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    return value.map((item) => flattenComponent(item, depth + 1)).join('')
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    let text = ''
    if (typeof record.text === 'string') text += record.text
    else if (typeof record.translate === 'string') {
      text += record.translate
      if (Array.isArray(record.with)) {
        text += ` [${record.with.map((item) => flattenComponent(item, depth + 1)).join(', ')}]`
      }
    } else if (typeof record.fallback === 'string') {
      text += record.fallback
    }
    if (Array.isArray(record.extra)) {
      text += record.extra.map((item) => flattenComponent(item, depth + 1)).join('')
    }
    return text
  }
  return ''
}

function cleanDescription(value: string): string | null {
  const clean = value
    .replace(/[§&][0-9a-fk-or]/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!clean) return null
  return clean.length > 400 ? `${clean.slice(0, 400)}…` : clean
}

function formatValue(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (Array.isArray(value) && value.length > 0) {
    return value.map((item) => formatValue(item) ?? '').filter(Boolean).join('.')
  }
  return null
}

function packFormatOf(meta: Record<string, unknown>): string | null {
  const pack = meta.pack
  if (!pack || typeof pack !== 'object' || Array.isArray(pack)) return null
  const record = pack as Record<string, unknown>
  const min = formatValue(record.min_format ?? record.pack_format)
  const max = formatValue(record.max_format)
  if (min && max && min !== max) return `${min}–${max}`
  if (min) return min
  return max
}

function applyEntry(children: Map<string, Map<string, 'file' | 'dir'>>, path: string): void {
  const parts = path.split('/')
  let parent = ''
  for (let index = 0; index < parts.length; index += 1) {
    const name = parts[index]
    const isFile = index === parts.length - 1
    const list = children.get(parent) ?? new Map<string, 'file' | 'dir'>()
    if (isFile) {
      list.set(name, 'file')
    } else if (!list.has(name)) {
      list.set(name, 'dir')
    }
    children.set(parent, list)
    parent = parent ? `${parent}/${name}` : name
  }
}

async function openPack(
  kind: PreviewableContentKind,
  instanceId: string,
  rawFile: string
): Promise<PackCache> {
  if (!isPreviewableKind(kind)) throw new Error('不支持预览这个内容类型')
  const instance = await getInstance(instanceId)
  const gameDir = await getInstanceGameDir(instance.id)
  const dirName = DIRS[kind]
  const raw = rawFile.trim().replace(/\\/g, '/')
  const prefix = `${dirName}/`
  const file = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw
  if (
    !file ||
    file.length > 240 ||
    file.includes('/') ||
    file !== basename(file) ||
    !/\.zip$/i.test(file) ||
    file === '.' ||
    file === '..'
  ) {
    throw new Error('资源文件名不合法')
  }
  const root = join(gameDir, dirName)
  const target = join(root, file)
  const rel = relative(root, target)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('资源文件路径不合法')
  }
  const stat = await fs.stat(target).catch(() => null)
  if (!stat || !stat.isFile()) {
    throw new Error('资源文件已不存在，刷新内容列表后再试')
  }
  if (stat.size > MAX_ZIP_BYTES) {
    throw new Error(`资源包超过 ${displayLength(MAX_ZIP_BYTES)}，暂不预览`)
  }
  const key = `${target}|${stat.mtimeMs}|${stat.size}`
  if (packCache?.key === key) return packCache

  const data = await fs.readFile(target)
  let zip: AdmZip
  try {
    zip = new AdmZip(data)
  } catch {
    throw new Error('无法读取 ZIP，文件可能损坏或不是标准 ZIP')
  }
  const files = new Map<string, CachedEntry>()
  const children = new Map<string, Map<string, 'file' | 'dir'>>()
  const explicitDirs = new Set<string>()
  for (const entry of zip.getEntries()) {
    const path = cleanEntryPath(entry.entryName)
    if (!path) continue
    if (entry.isDirectory) {
      explicitDirs.add(path)
      continue
    }
    if (NOISE.has(entryName(path))) continue
    files.set(path, {
      path,
      name: entryName(path),
      size: entry.header.size,
      entry
    })
    applyEntry(children, path)
  }
  for (const dir of explicitDirs) {
    applyEntry(children, `${dir}/.keep`)
    const list = children.get(dir)
    if (list) list.delete('.keep')
    else children.set(dir, new Map())
  }
  let totalBytes = 0
  for (const fileEntry of files.values()) totalBytes += fileEntry.size
  const cache: PackCache = {
    key,
    name: file.replace(/\.zip$/i, ''),
    size: stat.size,
    zip,
    files,
    children,
    fileCount: files.size,
    totalBytes
  }
  packCache = cache
  return cache
}

function findFile(pack: PackCache, target: string): CachedEntry | null {
  const exact = pack.files.get(target)
  if (exact) return exact
  const lower = target.toLowerCase()
  for (const entry of pack.files.values()) {
    if (entry.path.toLowerCase() === lower) return entry
  }
  return null
}

function listDir(pack: PackCache, rawPath: string): ContentPreviewDirResult {
  const path = rawPath.trim()
  if (path && (path.startsWith('/') || path.includes('\\') || path.split('/').includes('..'))) {
    throw new Error('目录路径不合法')
  }
  if (path && !pack.children.has(path)) throw new Error('目录不存在')
  const list = pack.children.get(path) ?? new Map()
  const entries: ContentPreviewEntry[] = []
  for (const [name, type] of list) {
    const childPath = path ? `${path}/${name}` : name
    if (type === 'dir') {
      entries.push({
        path: childPath,
        name,
        type: 'dir',
        size: 0,
        childCount: pack.children.get(childPath)?.size ?? 0
      })
    } else {
      const file = pack.files.get(childPath)
      if (!file) continue
      entries.push({
        path: childPath,
        name,
        type: 'file',
        size: file.size,
        childCount: null
      })
    }
  }
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name, 'zh-CN')
  })
  return {
    path,
    entries: entries.slice(0, MAX_DIR_ENTRIES),
    total: entries.length,
    truncated: entries.length > MAX_DIR_ENTRIES
  }
}

function suggestPath(pack: PackCache): string | null {
  const preferred = ['pack.mcmeta', 'shaders/shaders.properties', 'shaders/shader.properties']
  for (const candidate of preferred) {
    const found = findFile(pack, candidate)
    if (found) return found.path
  }
  const textFiles = [...pack.files.values()]
    .filter((entry) => TEXT_EXT.has(extensionOf(entry.path)))
    .sort((a, b) => a.path.localeCompare(b.path, 'zh-CN'))
  const rootText = textFiles.find((entry) => !entry.path.includes('/'))
  if (rootText) return rootText.path
  if (textFiles[0]) return textFiles[0].path
  const firstFile = [...pack.files.values()].sort((a, b) =>
    a.path.localeCompare(b.path, 'zh-CN')
  )[0]
  return firstFile?.path ?? null
}

function readPackMeta(pack: PackCache): { format: string | null; description: string | null } {
  const metaEntry = findFile(pack, 'pack.mcmeta')
  if (!metaEntry || metaEntry.size > MAX_ICON_BYTES) return { format: null, description: null }
  try {
    const parsed = JSON.parse(metaEntry.entry.getData().toString('utf8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { format: null, description: null }
    }
    const record = parsed as Record<string, unknown>
    const format = packFormatOf(record)
    const pack = record.pack
    const descriptionValue =
      pack && typeof pack === 'object' && !Array.isArray(pack)
        ? (pack as Record<string, unknown>).description
        : null
    return {
      format,
      description: cleanDescription(flattenComponent(descriptionValue))
    }
  } catch {
    return { format: null, description: null }
  }
}

function readIcon(pack: PackCache): string | null {
  for (const candidate of ['pack.png', 'pack.jpg', 'pack.jpeg']) {
    const entry = findFile(pack, candidate)
    if (!entry || entry.size > MAX_ICON_BYTES) continue
    try {
      const ext = extensionOf(entry.path)
      return `data:${MIME_IMAGE[ext] ?? 'image/png'};base64,${entry.entry.getData().toString('base64')}`
    } catch {
      continue
    }
  }
  return null
}

function classifyFile(path: string): ContentPreviewFileKind {
  const ext = extensionOf(path)
  if (IMAGE_EXT.has(ext)) return 'image'
  if (AUDIO_EXT.has(ext)) return 'audio'
  if (TEXT_EXT.has(ext)) return 'text'
  const name = entryName(path).toLowerCase()
  if (!name.includes('.') && TEXT_NAMES.has(name)) return 'text'
  return 'binary'
}

export async function previewContentPack(
  instanceId: string,
  kind: PreviewableContentKind,
  file: string
): Promise<ContentPackPreview> {
  const pack = await openPack(kind, instanceId, file)
  const meta = readPackMeta(pack)
  const root = listDir(pack, '')
  return {
    kind,
    file: basename(file),
    name: pack.name,
    size: pack.size,
    fileCount: pack.fileCount,
    totalBytes: pack.totalBytes,
    packFormat: meta.format,
    description: meta.description,
    icon: readIcon(pack),
    suggestedPath: suggestPath(pack),
    entries: root.entries,
    rootTotal: root.total
  }
}

export async function previewContentDir(
  instanceId: string,
  kind: PreviewableContentKind,
  file: string,
  path: string
): Promise<ContentPreviewDirResult> {
  const pack = await openPack(kind, instanceId, file)
  return listDir(pack, path)
}

export async function previewContentFile(
  instanceId: string,
  kind: PreviewableContentKind,
  file: string,
  path: string
): Promise<ContentPreviewFile> {
  const pack = await openPack(kind, instanceId, file)
  const clean = cleanEntryPath(path)
  if (!clean) throw new Error('文件路径不合法')
  const entry = pack.files.get(clean)
  if (!entry) throw new Error('文件不存在，或这是一个文件夹')
  const fileKind = classifyFile(clean)
  const ext = extensionOf(clean)
  const base = {
    path: clean,
    name: entry.name,
    size: entry.size,
    kind: fileKind,
    text: null as string | null,
    dataUrl: null as string | null,
    mime: null as string | null,
    truncated: false,
    lineCount: null as number | null,
    width: null as number | null,
    height: null as number | null,
    note: null as string | null
  }

  if (fileKind === 'text') {
    if (entry.size > MAX_TEXT_READ) {
      return {
        ...base,
        kind: 'binary',
        note: `文本文件 ${displayLength(entry.size)}，超过 ${displayLength(MAX_TEXT_READ)} 的预览上限`
      }
    }
    let data: Buffer
    try {
      data = entry.entry.getData()
    } catch {
      throw new Error('无法读取这个文件，ZIP 可能已损坏')
    }
    let text = data.toString('utf8')
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
    const truncated = text.length > TEXT_PREVIEW_BYTES
    if (truncated) text = text.slice(0, TEXT_PREVIEW_BYTES)
    return {
      ...base,
      kind: 'text',
      text,
      mime: 'text/plain; charset=utf-8',
      truncated,
      lineCount: text.split('\n').length
    }
  }

  if (fileKind === 'image' || fileKind === 'audio') {
    const mime =
      fileKind === 'image' ? MIME_IMAGE[ext] ?? 'application/octet-stream' : MIME_AUDIO[ext] ?? 'application/octet-stream'
    if (entry.size > MAX_MEDIA_BYTES) {
      return {
        ...base,
        kind: 'binary',
        mime: null,
        note: `${fileKind === 'image' ? '图片' : '音频'} ${displayLength(entry.size)}，超过 ${displayLength(MAX_MEDIA_BYTES)} 的预览上限`
      }
    }
    let data: Buffer
    try {
      data = entry.entry.getData()
    } catch {
      throw new Error('无法读取这个文件，ZIP 可能已损坏')
    }
    if (fileKind === 'image') {
      let width: number | null = null
      let height: number | null = null
      try {
        const image = nativeImage.createFromBuffer(data)
        if (!image.isEmpty()) {
          const size = image.getSize()
          width = size.width
          height = size.height
        }
      } catch {
        /* dimensions are optional */
      }
      return {
        ...base,
        kind: 'image',
        dataUrl: `data:${mime};base64,${data.toString('base64')}`,
        mime,
        width,
        height
      }
    }
    return {
      ...base,
      kind: 'audio',
      dataUrl: `data:${mime};base64,${data.toString('base64')}`,
      mime
    }
  }

  return { ...base, note: '二进制文件，暂不预览' }
}

export async function searchContentPack(
  instanceId: string,
  kind: PreviewableContentKind,
  file: string,
  rawQuery: string
): Promise<ContentPreviewSearchResult> {
  const query = rawQuery.trim().toLowerCase().slice(0, 120)
  if (!query) return { items: [], total: 0 }
  const pack = await openPack(kind, instanceId, file)
  const matches: { entry: CachedEntry; score: number }[] = []
  for (const entry of pack.files.values()) {
    const lower = entry.path.toLowerCase()
    const index = lower.indexOf(query)
    if (index < 0) continue
    const nameIndex = entry.name.toLowerCase().indexOf(query)
    const score =
      (lower.startsWith(query) ? 300 : 0) +
      (nameIndex === 0 ? 220 : nameIndex > 0 ? 120 : 0) +
      (index === 0 ? 80 : 0) -
      Math.min(60, entry.path.length / 8)
    matches.push({ entry, score })
  }
  matches.sort(
    (a, b) => b.score - a.score || a.entry.path.localeCompare(b.entry.path, 'zh-CN')
  )
  return {
    items: matches.slice(0, MAX_SEARCH_RESULTS).map(({ entry }) => ({
      path: entry.path,
      name: entry.name,
      type: 'file' as const,
      size: entry.size,
      childCount: null
    })),
    total: matches.length
  }
}
