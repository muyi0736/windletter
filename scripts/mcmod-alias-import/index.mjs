#!/usr/bin/env node
/**
 * 把 MC百科（mcmod.cn）的 class 模组页转换成风信可加载的本地别名表。
 *
 * 只读取 class 页面，不请求 MC百科搜索页，也不做站内遍历。
 * 每抓取一个页面之间默认等待 700ms；建议只转换自己需要的页面。
 */
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'

const USER_AGENT =
  'WindletterAliasTool/1.0 (manual mcmod class-page import; one page per request)'
const CLASS_BASE = 'https://www.mcmod.cn/class'
const DEFAULT_OUTPUT = 'mod-aliases.json'
const MAX_BULK_ALIASES = 30000

function usage() {
  console.log(`把 MC百科 class 页面转换为风信本地别名表

用法：
  node scripts/mcmod-alias-import/index.mjs [选项] [class 链接或数字 ID...]

示例：
  node scripts/mcmod-alias-import/index.mjs 840 3358
  node scripts/mcmod-alias-import/index.mjs https://www.mcmod.cn/class/840.html
  node scripts/mcmod-alias-import/index.mjs --input classes.txt --data-dir "D:\\启动器测试\\WindletterData"
  node scripts/mcmod-alias-import/index.mjs --html-dir .\\saved-mcmod-pages --output mod-aliases.json
  node scripts/mcmod-alias-import/index.mjs --pcl-buf "C:\\PCL\\mcmod.buf" --data-dir "D:\\启动器测试\\WindletterData"

选项：
  --input <文件>     文本文件，每行一个 class 链接或数字 ID（# 开头为注释）
  --html-dir <目录>  读取本地保存的 .html 文件，不联网
  --pcl-buf <文件>   读取你自己 PCL 资源里的 mcmod.buf，离线转换成批量表；
                     这是 PCL/MC百科的数据，只在本地使用，不要随安装包分发
  --output <文件>    输出文件，默认 ./mod-aliases.json
  --data-dir <目录>  写入 <目录>/mod-aliases.json（可直接使用风信数据目录）
  --delay <毫秒>     两次联网请求之间的等待，默认 700
  --timeout <毫秒>   单页超时，默认 8000
  --no-merge         不合并输出文件里已有的别名，直接覆盖
  --help             显示本说明

输出格式与风信 search-aliases.json 相同：
  { "version": 1, "items": [{ id, chinese, query, aliases,
    curseforgeSlugs, modrinthSlugs, sourceUrl, addedAt }] }

风信启动时会自动读取数据目录下的 mod-aliases.json，
和界面里导入的 search-aliases.json 一起合并进搜索索引。
`)
}

function parseArgs(argv) {
  const options = {
    output: null,
    dataDir: null,
    input: null,
    htmlDir: null,
    pclBuf: null,
    delay: 700,
    timeout: 8000,
    merge: true,
    targets: []
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = () => {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) throw new Error(`${arg} 缺少参数`)
      index += 1
      return value
    }
    if (arg === '--help' || arg === '-h') {
      options.help = true
    } else if (arg === '--input' || arg === '-i') {
      options.input = next()
    } else if (arg === '--html-dir') {
      options.htmlDir = next()
    } else if (arg === '--pcl-buf') {
      options.pclBuf = next()
    } else if (arg === '--output' || arg === '-o') {
      options.output = next()
    } else if (arg === '--data-dir') {
      options.dataDir = next()
    } else if (arg === '--delay') {
      const value = Number(next())
      if (!Number.isFinite(value) || value < 0) throw new Error('--delay 必须是正数')
      options.delay = Math.max(0, Math.round(value))
    } else if (arg === '--timeout') {
      const value = Number(next())
      if (!Number.isFinite(value) || value < 1000) throw new Error('--timeout 至少 1000')
      options.timeout = Math.round(value)
    } else if (arg === '--no-merge') {
      options.merge = false
    } else if (arg.startsWith('-')) {
      throw new Error(`未知参数：${arg}`)
    } else {
      options.targets.push(arg)
    }
  }
  return options
}

function decodeEntities(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/&([a-zA-Z]+);/g, (full, name) => named[name.toLowerCase()] ?? full)
    .replace(/&#(\d+);/g, (_full, code) => {
      const number = Number(code)
      return Number.isFinite(number) && number > 0 && number < 0x110000
        ? String.fromCodePoint(number)
        : ''
    })
    .replace(/&#x([0-9a-f]+);/gi, (_full, code) => {
      const number = Number.parseInt(code, 16)
      return Number.isFinite(number) && number > 0 && number < 0x110000
        ? String.fromCodePoint(number)
        : ''
    })
    .replace(/\s+/g, ' ')
    .trim()
}

function decodeRedirect(raw) {
  const marker = 'link.mcmod.cn/target/'
  const index = raw.indexOf(marker)
  if (index < 0) return null
  let payload = raw.slice(index + marker.length).replace(/[?#].*$/, '')
  payload = payload.replace(/-/g, '+').replace(/_/g, '/')
  payload += '='.repeat((4 - (payload.length % 4)) % 4)
  try {
    const decoded = Buffer.from(payload, 'base64').toString('utf8')
    return decoded.startsWith('http://') || decoded.startsWith('https://') ? decoded : null
  } catch {
    return null
  }
}

function providerSlugsFromUrl(raw) {
  const decoded = decodeRedirect(raw) ?? raw
  try {
    const url = new URL(decoded)
    const host = url.hostname.toLowerCase()
    if (host === 'curseforge.com' || host.endsWith('.curseforge.com')) {
      const match = /^\/minecraft\/mc-mods\/([^/?#]+)/i.exec(url.pathname)
      const slug = match?.[1] ? decodeURIComponent(match[1]) : ''
      return {
        curseforge: /^[A-Za-z0-9._-]{1,120}$/.test(slug) ? slug : null,
        modrinth: null
      }
    }
    if (host === 'modrinth.com' || host.endsWith('.modrinth.com')) {
      const match = /^\/mod\/([^/?#]+)/i.exec(url.pathname)
      const slug = match?.[1] ? decodeURIComponent(match[1]) : ''
      return {
        curseforge: null,
        modrinth: /^[A-Za-z0-9._-]{1,120}$/.test(slug) ? slug : null
      }
    }
  } catch {
    /* ignore */
  }
  return { curseforge: null, modrinth: null }
}

function parseClassId(raw) {
  const value = String(raw ?? '').trim()
  if (!value) return null
  if (/^\d{1,10}$/.test(value)) return value
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    if (host !== 'mcmod.cn' && !host.endsWith('.mcmod.cn')) return null
    return /^\/class\/(\d{1,10})\.html$/i.exec(url.pathname)?.[1] ?? null
  } catch {
    return null
  }
}

function extractEnglishTitle(title) {
  const groups = [...title.matchAll(/\(([^()]{2,120})\)/g)]
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const value = groups[index][1]?.trim() ?? ''
    if (!value || !/[A-Za-z]/.test(value)) continue
    if (/MC百科|百科|百科搜索/i.test(value)) continue
    if (/^(?:forge|fabric|quilt|neoforge|fabric\/forge)$/i.test(value)) continue
    if (/^[≥＞<>]?\s*\d/.test(value)) continue
    return value
  }
  return ''
}

function cleanChineseTitle(title) {
  let value = title.replace(/\s*-\s*MC百科.*$/i, '').trim()
  value = value.replace(/\s*\([^()]*[A-Za-z][^()]*\)\s*$/u, '').trim()
  value = value.replace(/^\s*[[【][^\]】]+[\]】]\s*/u, '').trim()
  return value || title
}

function extractAliases(title) {
  const aliases = []
  for (const match of title.matchAll(/[[【]([^\]】]{1,24})[\]】]/gu)) {
    const value = match[1]?.trim()
    if (!value) continue
    if (/^(?:MC百科|我的世界|Minecraft|模组|MOD|百科)$/i.test(value)) continue
    aliases.push(value)
  }
  return [...new Set(aliases)].slice(0, 8)
}

function slugWords(slug) {
  return slug.replace(/[-_]+/g, ' ').trim()
}

function parseClassHtml(classId, html, sourceUrl) {
  const rawTitle = decodeEntities(
    /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.replace(/\s*-\s*MC百科.*$/i, '') ?? ''
  )
  if (!rawTitle) throw new Error('页面没有标题')
  const curseforgeSlugs = []
  const modrinthSlugs = []
  for (const anchor of html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)) {
    const block = anchor[0] ?? ''
    if (
      !/common-linkicon-(?:curseforge|modrinth)/i.test(block) &&
      !/data-original-title="(?:CurseForge|Modrinth)/i.test(block)
    ) {
      continue
    }
    const href = /href="([^"]+)"/i.exec(block)?.[1] ?? ''
    if (!href) continue
    const slugs = providerSlugsFromUrl(href)
    if (slugs.curseforge && !curseforgeSlugs.includes(slugs.curseforge)) {
      curseforgeSlugs.push(slugs.curseforge)
    }
    if (slugs.modrinth && !modrinthSlugs.includes(slugs.modrinth)) {
      modrinthSlugs.push(slugs.modrinth)
    }
  }
  if (curseforgeSlugs.length === 0 && modrinthSlugs.length === 0) {
    throw new Error('页面没有 CurseForge / Modrinth 链接')
  }
  const chinese = cleanChineseTitle(rawTitle)
  const query =
    extractEnglishTitle(rawTitle) ||
    slugWords(modrinthSlugs[0] ?? curseforgeSlugs[0] ?? '') ||
    chinese
  const hash = createHash('sha1').update(`${chinese}|${query}`).digest('hex').slice(0, 12)
  return {
    id: classId ? `mcmod-${classId}` : `mcmod-${hash}`,
    chinese: chinese.slice(0, 160),
    query: query.slice(0, 160),
    aliases: extractAliases(rawTitle).slice(0, 8),
    curseforgeSlugs,
    modrinthSlugs,
    sourceUrl: sourceUrl ?? null,
    addedAt: Date.now()
  }
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

async function fetchClassPage(classId, options) {
  const sourceUrl = `${CLASS_BASE}/${classId}.html`
  let lastError = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(sourceUrl, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.5'
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(options.timeout)
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return {
        html: await response.text(),
        sourceUrl
      }
    } catch (error) {
      lastError = error
      if (attempt === 0) await sleep(1200)
    }
  }
  throw lastError ?? new Error('请求失败')
}

function readVarint(buffer, start) {
  let value = 0n
  let shift = 0n
  let position = start
  while (position < buffer.length) {
    const byte = buffer[position]
    position += 1
    value |= BigInt(byte & 0x7f) << shift
    if ((byte & 0x80) === 0) return { value, position }
    shift += 7n
  }
  throw new Error('protobuf 数据不完整')
}

function protobufMessages(buffer) {
  const messages = []
  let position = 0
  while (position < buffer.length) {
    const tag = readVarint(buffer, position)
    position = tag.position
    const field = Number(tag.value >> 3n)
    const wire = Number(tag.value & 7n)
    if (wire === 2) {
      const length = readVarint(buffer, position)
      position = length.position
      const end = position + Number(length.value)
      if (end > buffer.length) throw new Error('protobuf 长度越界')
      if (field === 1) messages.push(buffer.subarray(position, end))
      position = end
    } else if (wire === 0) {
      position = readVarint(buffer, position).position
    } else if (wire === 5) {
      position += 4
    } else if (wire === 1) {
      position += 8
    } else {
      throw new Error(`不支持的 protobuf wire 类型 ${wire}`)
    }
  }
  return messages
}

function readProtobufEntry(message) {
  const output = { wikiId: 0, chineseName: '', curseforgeSlug: '', modrinthSlug: '' }
  let position = 0
  while (position < message.length) {
    const tag = readVarint(message, position)
    position = tag.position
    const field = Number(tag.value >> 3n)
    const wire = Number(tag.value & 7n)
    if (wire === 0) {
      const value = readVarint(message, position)
      position = value.position
      if (field === 1) output.wikiId = Number(value.value)
    } else if (wire === 2) {
      const length = readVarint(message, position)
      position = length.position
      const end = position + Number(length.value)
      const text = message.subarray(position, end).toString('utf8')
      position = end
      if (field === 2) output.chineseName = text
      else if (field === 3) output.curseforgeSlug = text
      else if (field === 4) output.modrinthSlug = text
    } else if (wire === 5) {
      position += 4
    } else if (wire === 1) {
      position += 8
    } else {
      throw new Error(`不支持的 protobuf wire 类型 ${wire}`)
    }
  }
  return output
}

function parsePclBuf(buffer) {
  const raw = buffer[0] === 0x1f && buffer[1] === 0x8b ? gunzipSync(buffer) : buffer
  const items = []
  const seen = new Set()
  for (const message of protobufMessages(raw)) {
    let entry
    try {
      entry = readProtobufEntry(message)
    } catch {
      continue
    }
    const fullChinese = entry.chineseName.trim()
    if (!fullChinese || !/[\u3400-\u9fff]/u.test(fullChinese)) continue
    const chinese =
      fullChinese.replace(/\s*\([^()]*[A-Za-z][^()]*\)\s*$/u, '').trim() || fullChinese
    const curseforgeSlugs = /^[A-Za-z0-9._-]{1,120}$/.test(entry.curseforgeSlug)
      ? [entry.curseforgeSlug]
      : []
    const modrinthSlugs = /^[A-Za-z0-9._-]{1,120}$/.test(entry.modrinthSlug)
      ? [entry.modrinthSlug]
      : []
    if (curseforgeSlugs.length === 0 && modrinthSlugs.length === 0) continue
    const id =
      entry.wikiId > 0
        ? `mcmod-${entry.wikiId}`
        : `mcmod-${createHash('sha1').update(fullChinese).digest('hex').slice(0, 12)}`
    if (seen.has(id)) continue
    seen.add(id)
    const query =
      extractEnglishTitle(fullChinese) ||
      slugWords(modrinthSlugs[0] ?? curseforgeSlugs[0] ?? '') ||
      chinese
    const aliases = [chinese]
    if (fullChinese !== chinese) aliases.push(fullChinese)
    aliases.push(...extractAliases(fullChinese))
    items.push({
      id,
      chinese: chinese.slice(0, 160),
      query: query.slice(0, 160),
      aliases: [...new Set(aliases)].slice(0, 8),
      curseforgeSlugs,
      modrinthSlugs,
      sourceUrl:
        entry.wikiId > 0 ? `${CLASS_BASE}/${entry.wikiId}.html` : null,
      addedAt: Date.now()
    })
  }
  return items
}

async function readPclBuf(path) {
  const buffer = await fs.readFile(path)
  const items = parsePclBuf(buffer)
  console.log(`[PCL] 读取 ${path}，提取 ${items.length} 条中文别名`)
  return items
}

async function readLines(path) {
  const text = await fs.readFile(path, 'utf8')
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
}

async function parseHtmlDirectory(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files = entries
    .filter((entry) => entry.isFile() && /\.html?$/i.test(entry.name))
    .map((entry) => join(dir, entry.name))
    .sort()
  const items = []
  for (const file of files) {
    const html = await fs.readFile(file, 'utf8')
    const fromName = /(\d{1,10})/u.exec(basename(file, extname(file)))?.[1] ?? null
    const fromHtml = /mcmod\.cn\/class\/(\d{1,10})\.html/i.exec(html)?.[1] ?? null
    const classId = fromName ?? fromHtml
    try {
      items.push(parseClassHtml(classId, html, classId ? `${CLASS_BASE}/${classId}.html` : null))
      console.log(`[HTML] ${basename(file)} → ${items[items.length - 1].chinese}`)
    } catch (error) {
      console.warn(`[HTML] 跳过 ${basename(file)}：${error.message}`)
    }
  }
  return items
}

async function loadExisting(output, merge) {
  if (!merge) return new Map()
  try {
    const raw = await fs.readFile(output, 'utf8')
    const parsed = JSON.parse(raw)
    const map = new Map()
    for (const item of Array.isArray(parsed.items) ? parsed.items : []) {
      if (item && typeof item.id === 'string') map.set(item.id, item)
    }
    return map
  } catch {
    return new Map()
  }
}

async function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(`参数错误：${error.message}`)
    usage()
    process.exitCode = 1
    return
  }
  if (options.help) {
    usage()
    return
  }

  const output = resolve(
    options.output ??
      (options.dataDir
        ? join(options.dataDir, DEFAULT_OUTPUT)
        : DEFAULT_OUTPUT)
  )
  const targets = [...options.targets]
  if (options.input) {
    try {
      targets.push(...(await readLines(resolve(options.input))))
    } catch (error) {
      console.error(`无法读取 --input：${error.message}`)
      process.exitCode = 1
      return
    }
  }
  const uniqueTargets = [...new Set(targets.map((value) => value.trim()).filter(Boolean))]
  if (uniqueTargets.length === 0 && !options.htmlDir && !options.pclBuf) {
    console.error('没有输入 class 链接/ID、--html-dir 或 --pcl-buf')
    usage()
    process.exitCode = 1
    return
  }

  const existing = await loadExisting(output, options.merge)
  const additions = []
  let failed = 0

  if (options.htmlDir) {
    try {
      additions.push(...(await parseHtmlDirectory(resolve(options.htmlDir))))
    } catch (error) {
      console.error(`无法读取 --html-dir：${error.message}`)
      failed += 1
    }
  }

  if (options.pclBuf) {
    try {
      additions.push(...(await readPclBuf(resolve(options.pclBuf))))
    } catch (error) {
      console.error(`无法读取 --pcl-buf：${error.message}`)
      failed += 1
    }
  }

  for (let index = 0; index < uniqueTargets.length; index += 1) {
    const target = uniqueTargets[index]
    const classId = parseClassId(target)
    if (!classId) {
      console.warn(`[${index + 1}/${uniqueTargets.length}] 跳过无效链接：${target}`)
      failed += 1
      continue
    }
    try {
      if (index > 0 && options.delay > 0) await sleep(options.delay)
      const { html, sourceUrl } = await fetchClassPage(classId, options)
      const item = parseClassHtml(classId, html, sourceUrl)
      additions.push(item)
      console.log(
        `[${index + 1}/${uniqueTargets.length}] ${item.chinese} → ${item.query}` +
          ` (CF ${item.curseforgeSlugs.length} / MR ${item.modrinthSlugs.length})`
      )
    } catch (error) {
      failed += 1
      console.warn(`[${index + 1}/${uniqueTargets.length}] 失败 ${target}：${error.message}`)
    }
  }

  for (const item of additions) existing.set(item.id, item)
  const all = [...existing.values()]
    .filter((item) => item && typeof item.id === 'string')
    .slice(0, MAX_BULK_ALIASES)
  if (all.length === 0) {
    console.error('没有生成任何别名，未写入文件。')
    process.exitCode = 1
    return
  }
  await fs.mkdir(dirname(output), { recursive: true })
  await fs.writeFile(
    output,
    JSON.stringify({ version: 1, items: all }, null, 2),
    'utf8'
  )
  console.log('')
  console.log(`写入：${output}`)
  console.log(`新增/更新：${additions.length} 条，总计：${all.length} 条，失败：${failed} 条`)
  if (all.length >= MAX_BULK_ALIASES) {
    console.warn(`已达到 ${MAX_BULK_ALIASES} 条上限，剩余条目未写入。`)
  }
  if (failed > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
