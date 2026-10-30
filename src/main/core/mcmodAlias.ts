import type { CustomSearchAlias } from '../../shared/types'

const MCMOD_CLASS_BASE = 'https://www.mcmod.cn/class'
const REQUEST_TIMEOUT = 8000
const USER_AGENT = 'WindletterLauncher/0.30.5 (Minecraft launcher; user-initiated mcmod alias import)'

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' '
  }
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/&([a-zA-Z]+);/g, (full, name: string) => named[name.toLowerCase()] ?? full)
    .replace(/&#(\d+);/g, (_full, code: string) => {
      const value = Number(code)
      return Number.isFinite(value) && value > 0 && value < 0x110000
        ? String.fromCodePoint(value)
        : ''
    })
    .replace(/&#x([0-9a-f]+);/gi, (_full, code: string) => {
      const value = Number.parseInt(code, 16)
      return Number.isFinite(value) && value > 0 && value < 0x110000
        ? String.fromCodePoint(value)
        : ''
    })
    .replace(/\s+/g, ' ')
    .trim()
}

function decodeRedirect(raw: string): string | null {
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

function providerSlugsFromUrl(raw: string): {
  curseforge: string | null
  modrinth: string | null
} {
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

function extractEnglishTitle(title: string): string {
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

function cleanChineseTitle(title: string): string {
  let value = title.replace(/\s*-\s*MC百科.*$/i, '').trim()
  value = value.replace(/\s*\([^()]*[A-Za-z][^()]*\)\s*$/u, '').trim()
  value = value.replace(/^\s*[[【][^\]】]+[\]】]\s*/u, '').trim()
  return value || title
}

function slugWords(slug: string): string {
  return slug.replace(/[-_]+/g, ' ').trim()
}

export function parseMcmodClassId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  if (!value) return null
  if (/^\d{1,10}$/.test(value)) return value
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    if (host !== 'mcmod.cn' && !host.endsWith('.mcmod.cn')) return null
    const match = /^\/class\/(\d{1,10})\.html$/i.exec(url.pathname)
    return match?.[1] ?? null
  } catch {
    return null
  }
}

/**
 * 只读取用户主动粘贴的 MC百科模组页（class 页面），
 * 不抓取 MC百科搜索页，也不做批量扫描。
 */
export async function fetchMcmodAlias(raw: unknown): Promise<CustomSearchAlias> {
  const classId = parseMcmodClassId(raw)
  if (!classId) {
    throw new Error('请粘贴 MC百科模组页链接，例如 https://www.mcmod.cn/class/3358.html')
  }
  const sourceUrl = `${MCMOD_CLASS_BASE}/${classId}.html`
  const response = await fetch(sourceUrl, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.5'
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT)
  })
  if (!response.ok) throw new Error(`MC百科返回 HTTP ${response.status}`)
  const html = await response.text()
  const rawTitle = decodeEntities(
    /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.replace(/\s*-\s*MC百科.*$/i, '') ?? ''
  )
  if (!rawTitle) throw new Error('无法读取这个 MC百科页面的标题')

  const curseforgeSlugs: string[] = []
  const modrinthSlugs: string[] = []
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
    throw new Error('这个 MC百科页面没有 CurseForge / Modrinth 链接，暂时无法加入搜索索引')
  }

  const chinese = cleanChineseTitle(rawTitle)
  const query =
    extractEnglishTitle(rawTitle) ||
    slugWords(modrinthSlugs[0] ?? curseforgeSlugs[0] ?? '') ||
    chinese
  return {
    id: `mcmod-${classId}`,
    chinese,
    query,
    aliases: [chinese],
    curseforgeSlugs,
    modrinthSlugs,
    sourceUrl,
    addedAt: Date.now()
  }
}
