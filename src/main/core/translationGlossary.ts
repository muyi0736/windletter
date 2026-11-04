import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import type { TranslationGlossaryEntry } from '../../shared/types'
import { getConfigDir } from './config'

const MAX_ENTRIES = 300_000
const MAX_TERM = 160

export const DEFAULT_GLOSSARY: TranslationGlossaryEntry[] = [
  { source: 'Minecraft', target: '我的世界' },
  { source: 'Overworld', target: '主世界' },
  { source: 'Nether', target: '下界' },
  { source: 'The End', target: '末地' },
  { source: 'Ender', target: '末影' },
  { source: 'Redstone', target: '红石' },
  { source: 'Crafting', target: '合成' },
  { source: 'Smelting', target: '熔炼' },
  { source: 'Furnace', target: '熔炉' },
  { source: 'Chest', target: '箱子' },
  { source: 'Inventory', target: '物品栏' },
  { source: 'Quest', target: '任务' },
  { source: 'Chapter', target: '章节' },
  { source: 'Reward', target: '奖励' },
  { source: 'Task', target: '任务' },
  { source: 'Item', target: '物品' },
  { source: 'Block', target: '方块' },
  { source: 'Fluid', target: '流体' },
  { source: 'Energy', target: '能量' },
  { source: 'Machine', target: '机器' },
  { source: 'Multiblock', target: '多方块' },
  { source: 'Upgrade', target: '升级' },
  { source: 'Tier', target: '等级' },
  { source: 'Biome', target: '生物群系' },
  { source: 'Dimension', target: '维度' },
  { source: 'Village', target: '村庄' },
  { source: 'Raid', target: '袭击' },
  { source: 'Boss', target: '首领' },
  { source: 'Spawner', target: '刷怪笼' },
  { source: 'Enchantment', target: '附魔' },
  { source: 'Potion', target: '药水' },
  { source: 'Ore', target: '矿石' },
  { source: 'Ingot', target: '锭' },
  { source: 'Nugget', target: '粒' },
  { source: 'Dust', target: '粉' },
  { source: 'Gear', target: '齿轮' },
  { source: 'Storage', target: '存储' },
  { source: 'Pipe', target: '管道' },
  { source: 'Cable', target: '线缆' },
  { source: 'Tank', target: '储罐' },
  { source: 'Generator', target: '发电机' },
  { source: 'Reactor', target: '反应堆' }
]

let cache: TranslationGlossaryEntry[] | null = null

function glossaryPath(): string {
  return join(getConfigDir(), 'translation-glossary.json')
}

function cleanTerm(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_TERM)
    : ''
}

export function normalizeGlossary(
  raw: unknown,
  max = MAX_ENTRIES
): TranslationGlossaryEntry[] {
  if (!Array.isArray(raw)) throw new Error('术语表格式无效')
  const seen = new Set<string>()
  const entries: TranslationGlossaryEntry[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const value = item as Record<string, unknown>
    const source = cleanTerm(value.source)
    const target = cleanTerm(value.target)
    if (!source || !target) continue
    const key = source.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    entries.push({ source, target })
    if (entries.length >= max) break
  }
  return entries
}

export async function getTranslationGlossary(): Promise<TranslationGlossaryEntry[]> {
  if (cache) return cache.map((entry) => ({ ...entry }))
  try {
    const parsed = JSON.parse(await fs.readFile(glossaryPath(), 'utf8')) as {
      entries?: unknown
    }
    cache = normalizeGlossary(parsed.entries ?? [])
  } catch {
    cache = DEFAULT_GLOSSARY.map((entry) => ({ ...entry }))
  }
  return cache.map((entry) => ({ ...entry }))
}

export async function saveTranslationGlossary(
  raw: unknown
): Promise<TranslationGlossaryEntry[]> {
  const entries = normalizeGlossary(raw)
  if (entries.length === 0) throw new Error('术语表至少保留一条术语')
  cache = entries
  const path = glossaryPath()
  await fs.mkdir(getConfigDir(), { recursive: true })
  const tmp = `${path}.tmp`
  await fs.writeFile(tmp, JSON.stringify({ version: 1, entries }), 'utf8')
  await fs.rename(tmp, path)
  return entries.map((entry) => ({ ...entry }))
}

let communityCache: Map<string, string> | null | undefined
let communityCount: number | undefined

function communityGlossaryPath(): string {
  const override = process.env.WINDLETTER_COMMUNITY_GLOSSARY
  if (override) return override
  return app.isPackaged
    ? join(process.resourcesPath, 'glossary', 'community-glossary.tsv.gz')
    : join(app.getAppPath(), 'resources', 'glossary', 'community-glossary.tsv.gz')
}

function communityMetaPath(): string {
  return communityGlossaryPath().replace(/\.tsv\.gz$/i, '.meta.json')
}

async function loadCommunityGlossary(): Promise<Map<string, string> | null> {
  if (communityCache !== undefined) return communityCache
  try {
    const raw = gunzipSync(await fs.readFile(communityGlossaryPath())).toString('utf8')
    const map = new Map<string, string>()
    let start = 0
    while (start < raw.length) {
      let end = raw.indexOf('\n', start)
      if (end < 0) end = raw.length
      const line = raw.slice(start, end)
      const tab = line.indexOf('\t')
      if (tab > 0) {
        const source = normalizePhrase(line.slice(0, tab))
        const target = line.slice(tab + 1).trim()
        if (source && target && !map.has(source)) map.set(source, target)
      }
      start = end + 1
    }
    communityCache = map
  } catch {
    communityCache = null
  }
  return communityCache
}

export async function getCommunityGlossaryCount(): Promise<number> {
  if (communityCount !== undefined) return communityCount
  try {
    const meta = JSON.parse(await fs.readFile(communityMetaPath(), 'utf8')) as { count?: unknown }
    if (typeof meta.count === 'number' && Number.isFinite(meta.count)) {
      communityCount = Math.max(0, Math.round(meta.count))
      return communityCount
    }
  } catch {
    /* fall back to the full glossary */
  }
  communityCount = (await loadCommunityGlossary())?.size ?? 0
  return communityCount
}

function normalizePhrase(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

const COMMUNITY_STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'to',
  'of',
  'and',
  'or',
  'for',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'in',
  'on',
  'at',
  'by',
  'with',
  'from',
  'as',
  'it',
  'this',
  'that',
  'these',
  'those',
  'you',
  'your',
  'can',
  'will',
  'not',
  'no',
  'has',
  'have',
  'do',
  'does',
  'use',
  'using',
  'when',
  'then',
  'if',
  'else',
  'all',
  'any',
  'each',
  'more',
  'most',
  'other',
  'into',
  'out',
  'up',
  'down',
  'over',
  'under',
  'again',
  'once',
  'here',
  'there',
  'why',
  'how',
  'what',
  'which',
  'who',
  'whom',
  'whose'
])

/**
 * Add only matching community terms that the user glossary does not already
 * define. The user glossary always wins.
 */
export async function mergeCommunityGlossary(
  userEntries: TranslationGlossaryEntry[],
  texts: string[],
  max = 40
): Promise<TranslationGlossaryEntry[]> {
  const community = await loadCommunityGlossary()
  if (!community || community.size === 0) return userEntries
  const selected = new Map<string, TranslationGlossaryEntry>()
  for (const entry of userEntries) {
    selected.set(entry.source.toLowerCase(), entry)
    if (selected.size >= max) return [...selected.values()]
  }

  const candidates = new Map<string, { source: string; target: string; score: number }>()
  const consider = (source: string, target: string | undefined, score: number) => {
    if (!target || selected.has(source)) return
    const current = candidates.get(source)
    if (!current || score > current.score) candidates.set(source, { source, target, score })
  }
  for (const text of texts) {
    const normalized = normalizePhrase(text)
    consider(normalized, community.get(normalized), 100)
    const tokens = (normalized.match(/[a-z0-9][a-z0-9_.'-]*/g) ?? []).map((token) =>
      token.replace(/[.'-]+$/, '')
    )
    for (let size = 4; size >= 1; size -= 1) {
      for (let start = 0; start + size <= tokens.length; start += 1) {
        if (size === 1) {
          const token = tokens[start]
          if (token.length < 4 || COMMUNITY_STOPWORDS.has(token)) continue
        }
        const phrase = tokens.slice(start, start + size).join(' ')
        consider(phrase, community.get(phrase), size * 20 + Math.min(20, phrase.length))
      }
    }
  }
  const ranked = [...candidates.values()].sort(
    (a, b) => b.score - a.score || b.source.length - a.source.length
  )
  for (const entry of ranked) {
    selected.set(entry.source, { source: entry.source, target: entry.target })
    if (selected.size >= max) break
  }
  return [...selected.values()].slice(0, max)
}
