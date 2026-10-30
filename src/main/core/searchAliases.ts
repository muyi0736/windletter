import type { ContentKind, ContentProvider } from '../../shared/types'
import { pinyin } from 'pinyin-pro'

type AliasKind = 'mod' | 'modpack'
type SearchKind = ContentKind | AliasKind

interface AliasVariant {
  loaders: string[]
  slug: string
  query: string
  chinese?: string
  curseforgeSlugs?: string[]
  modrinthSlugs?: string[]
}

export interface AliasSeed {
  kind?: AliasKind
  slug: string
  query: string
  chinese: string
  aliases?: string[]
  curseforgeSlugs?: string[]
  modrinthSlugs?: string[]
  variants?: AliasVariant[]
  custom?: boolean
  priority?: number
}

interface PreparedAlias extends Required<Pick<AliasSeed, 'slug' | 'query' | 'chinese'>> {
  kind: AliasKind
  aliases: string[]
  normalizedAliases: string[]
  normalizedSlug: string
  normalizedTitle: string
  initials: string
  curseforgeSlugs: string[]
  modrinthSlugs: string[]
  variants: AliasVariant[]
  custom: boolean
  priority: number
}

interface PinyinForm {
  full: string
  initials: string
  // full 中每个音节开始的位置，用于匹配“词中间”的拼音
  boundaries: number[]
}

interface PinyinIndexEntry {
  entry: PreparedAlias
  forms: PinyinForm[]
}

export interface SearchQueryExpansion {
  original: string
  query: string
  translated: boolean
  preferredSlugs: string[]
  preferredSlugsByProvider?: Partial<Record<ContentProvider, string[]>>
  localizedNames?: Record<string, string>
  chineseName: string | null
}

interface GenericQuery {
  aliases: string[]
  query: string
}

/**
 * 内置常用模组的中文名、英文缩写与常用别名。
 * 只保存项目标识和查询词，不锁定版本；完全离线，不依赖第三方数据库。
 */
const ALIAS_SEEDS: AliasSeed[] = [
  // 性能与客户端
  { slug: 'sodium', query: 'sodium', chinese: '钠', aliases: ['钠优化', 'sodium'] },
  { slug: 'sodium-extra', query: 'sodium extra', chinese: '钠扩展', aliases: ['sodiumextra'] },
  { slug: 'lithium', query: 'lithium', chinese: '锂', aliases: ['锂优化'] },
  { slug: 'krypton', query: 'krypton', chinese: '氪' },
  { slug: 'starlight', query: 'starlight', chinese: '星光' },
  { slug: 'phosphor', query: 'phosphor', chinese: '磷光' },
  { slug: 'iris', query: 'iris shaders', chinese: 'Iris 光影', aliases: ['iris', 'iris光影'] },
  { slug: 'oculus', query: 'oculus', chinese: 'Oculus 光影', aliases: ['oculus光影'] },
  { slug: 'embeddium', query: 'embeddium', chinese: 'Embeddium', aliases: ['内嵌'] },
  { slug: 'rubidium', query: 'rubidium', chinese: '铷' },
  { slug: 'optifine', query: 'optifine', chinese: '高清修复', aliases: ['of'] },
  { slug: 'entityculling', query: 'entity culling', chinese: '实体剔除' },
  { slug: 'modernfix', query: 'modernfix', chinese: '现代修复' },
  { slug: 'ferritecore', query: 'ferritecore', chinese: '铁氧体' },
  { slug: 'memoryleakfix', query: 'memory leak fix', chinese: '内存泄漏修复' },
  { slug: 'lazydfu', query: 'lazy dfu', chinese: '懒加载 DFU' },
  { slug: 'indium', query: 'indium', chinese: '铟' },
  { slug: 'continuity', query: 'continuity', chinese: '连续' },
  { slug: 'lambdynamiclights', query: 'lambdynamiclights', chinese: '动态光源' },
  { slug: 'fallingleaves', query: 'falling leaves', chinese: '落叶' },
  { slug: 'effective', query: 'effective', chinese: '效果' },
  { slug: 'notenoughanimations', query: 'not enough animations', chinese: '更多动画' },
  { slug: 'firstpersonmodel', query: 'first person model', chinese: '第一人称模型' },
  { slug: '3dskinlayers', query: '3d skin layers', chinese: '3D 皮肤' },
  { slug: 'eating-animation', query: 'eating animation', chinese: '进食动画' },
  { slug: 'appleskin', query: 'appleskin', chinese: '苹果皮' },
  { slug: 'mousetweaks', query: 'mouse tweaks', chinese: '鼠标手势' },
  { slug: 'controlling', query: 'controlling', chinese: '控制搜索' },
  { slug: 'catalogue', query: 'catalogue', chinese: '模组目录' },
  { slug: 'configured', query: 'configured', chinese: '模组配置' },
  { slug: 'inventory-sorter', query: 'inventory sorter', chinese: '物品整理' },
  { slug: 'inventory-profiles-next', query: 'inventory profiles next', chinese: '物品栏配置', aliases: ['ipn'] },
  { slug: 'jade', query: 'jade', chinese: '玉' },
  { slug: 'wthit', query: 'wthit', chinese: '方块信息' },
  { slug: 'the-one-probe', query: 'the one probe', chinese: '探测', aliases: ['top'] },
  { slug: 'journeymap', query: 'journeymap', chinese: '旅行地图' },
  { slug: 'xaeros-minimap', query: 'xaeros minimap', chinese: 'Xaero 小地图', aliases: ['xaero小地图'] },
  { slug: 'xaeros-world-map', query: 'xaeros world map', chinese: 'Xaero 世界地图', aliases: ['xaero世界地图'] },
  { slug: 'waystones', query: 'waystones', chinese: '传送石碑', aliases: ['传送石'] },
  { slug: 'sophisticated-backpacks', query: 'sophisticated backpacks', chinese: '精致背包' },
  { slug: 'curios', query: 'curios api', chinese: '饰品栏', aliases: ['curios'] },
  { slug: 'trinkets', query: 'trinkets', chinese: '饰品' },

  // 内容与前置
  { slug: 'jei', query: 'just enough items', chinese: '物品管理器', aliases: ['jei'] },
  { slug: 'rei', query: 'roughly enough items', chinese: '粗略物品管理器', aliases: ['rei'] },
  { slug: 'emi', query: 'emi', chinese: 'EMI 物品管理器', aliases: ['emi'] },
  { slug: 'fabric-api', query: 'fabric api', chinese: 'Fabric API', aliases: ['fapi'] },
  { slug: 'architectury-api', query: 'architectury api', chinese: '建筑工艺 API' },
  { slug: 'cloth-config', query: 'cloth config api', chinese: '布料配置', aliases: ['clothconfig'] },
  { slug: 'kotlin-for-forge', query: 'kotlin for forge', chinese: 'Kotlin for Forge', aliases: ['kff'] },
  { slug: 'geckolib', query: 'geckolib', chinese: 'GeckoLib' },
  { slug: 'patchouli', query: 'patchouli', chinese: '帕秋莉手册', aliases: ['帕秋莉'] },
  { slug: 'ponder', query: 'ponder', chinese: '思索' },
  { slug: 'flywheel', query: 'flywheel', chinese: '飞轮' },
  { slug: 'serene-seasons', query: 'serene seasons', chinese: '静谧四季' },
  { slug: 'comforts', query: 'comforts', chinese: '舒适' },
  { slug: 'imblocker-original', query: 'IMBlocker', chinese: '输入法冲突修复' },
  { slug: 'imblocker', query: 'IMBlockerFabric', chinese: '输入法冲突修复（Fabric）' },
  { slug: 'inputmethodblocker', query: 'InputMethodBlocker', chinese: '输入法冲突修复' },
  { slug: 'ingameime', query: 'IngameIME', chinese: '游戏内输入法' },
  { slug: 'contingameime', query: 'ContingameIME', chinese: '游戏内输入法' },
  { slug: 'roughly-enough-input-methods', query: 'Roughly Enough Input Methods', chinese: 'REI 输入法搜索' },
  {
    slug: 'justenoughcharacters',
    query: 'Just Enough Characters',
    chinese: '通用拼音搜索',
    aliases: ['拼音', '拼音搜索', '拼音输入', 'jech', 'jechars'],
    curseforgeSlugs: ['just-enough-characters'],
    modrinthSlugs: ['justenoughcharacters']
  },

  // 科技与魔法
  {
    slug: 'create',
    query: 'create',
    chinese: '机械动力',
    aliases: ['机械', 'jxdl'],
    variants: [
      {
        loaders: ['fabric', 'quilt'],
        slug: 'create-fabric',
        query: 'create fabric',
        chinese: '机械动力（Fabric）'
      }
    ]
  },
  { slug: 'create-steam-n-rails', query: 'create steam n rails', chinese: '蒸汽铁路', aliases: ['create蒸汽铁路'] },
  { slug: 'mekanism', query: 'mekanism', chinese: '通用机械', aliases: ['mek', 'tyjx'] },
  { slug: 'ae2', query: 'applied energistics 2', chinese: '应用能源2', aliases: ['应用能源'] },
  { slug: 'refined-storage', query: 'refined storage', chinese: '精致存储', aliases: ['rs'] },
  { slug: 'industrial-craft', query: 'industrial craft 2', chinese: '工业时代2', aliases: ['ic2', '工业时代'] },
  { slug: 'immersive-engineering', query: 'immersive engineering', chinese: '沉浸工程', aliases: ['ie'] },
  { slug: 'thermal-expansion', query: 'thermal expansion', chinese: '热力膨胀', aliases: ['te'] },
  { slug: 'thermal-foundation', query: 'thermal foundation', chinese: '热力基础' },
  { slug: 'ender-io', query: 'ender io', chinese: '末影接口' },
  { slug: 'draconic-evolution', query: 'draconic evolution', chinese: '龙之研究' },
  { slug: 'avaritia', query: 'avaritia', chinese: '无尽贪婪' },
  { slug: 'mystical-agriculture', query: 'mystical agriculture', chinese: '神秘农业' },
  { slug: 'botania', query: 'botania', chinese: '植物魔法', aliases: ['zwmf'] },
  { slug: 'ars-nouveau', query: 'ars nouveau', chinese: '新生魔艺' },
  { slug: 'blood-magic', query: 'blood magic', chinese: '血魔法' },
  { slug: 'thaumcraft', query: 'thaumcraft', chinese: '神秘时代' },
  { slug: 'tinkers-construct', query: 'tinkers construct', chinese: '匠魂', aliases: ['tic', 'tcon', 'jh'] },
  { slug: 'gregtech', query: 'gregtech', chinese: '格雷科技' },

  // 冒险与世界
  {
    slug: 'the-twilight-forest',
    query: 'twilight forest',
    chinese: '暮色森林',
    aliases: ['mss', '暮色'],
    variants: [
      {
        loaders: ['fabric', 'quilt'],
        slug: 'the-twilight-forest-unofficial',
        query: 'twilight forest',
        chinese: '暮色森林（非官方）'
      }
    ]
  },
  { slug: 'aether', query: 'aether', chinese: '天境' },
  { slug: 'blue-skies', query: 'blue skies', chinese: '蓝天' },
  { slug: 'ad-astra', query: 'ad astra', chinese: '星际' },
  { slug: 'galacticraft', query: 'galacticraft', chinese: '星系' },
  { slug: 'ice-and-fire', query: 'ice and fire', chinese: '冰与火之歌', aliases: ['冰与火'] },
  { slug: 'alexs-mobs', query: 'alexs mobs', chinese: '阿莱克斯的生物', aliases: ['阿莱克斯'] },
  { slug: 'epic-fight', query: 'epic fight', chinese: '史诗战斗' },
  { slug: 'better-combat', query: 'better combat', chinese: '更好战斗' },
  { slug: 'simply-swords', query: 'simply swords', chinese: '简单剑' },
  { slug: 'apotheosis', query: 'apotheosis', chinese: '神化' },
  { slug: 'when-dungeons-arise', query: 'when dungeons arise', chinese: '地牢浮现之时', aliases: ['地牢浮现'] },
  { slug: 'yungs-better-dungeons', query: 'yungs better dungeons', chinese: 'YUNG 更好地牢' },
  { slug: 'terralith', query: 'terralith', chinese: 'Terralith 地形' },
  { slug: 'tectonic', query: 'tectonic', chinese: 'Tectonic 地形' },
  { slug: 'biomes-o-plenty', query: 'biomes o plenty', chinese: '超多生物群系', aliases: ['bop'] },
  { slug: 'oh-the-biomes-youll-go', query: 'oh the biomes youll go', chinese: '你将去的生物群系', aliases: ['byg'] },
  { slug: 'distant-horizons', query: 'distant horizons', chinese: '遥远地平线' },
  { slug: 'farmers-delight', query: 'farmers delight', chinese: '农夫乐事' },
  { slug: 'pams-harvestcraft', query: 'pams harvestcraft', chinese: '潘马斯农场', aliases: ['潘马斯'] },
  { slug: 'cooking-for-blockheads', query: 'cooking for blockheads', chinese: '方块厨房' },
  { slug: 'quark', query: 'quark', chinese: '奇思妙想' },
  { slug: 'supplementaries', query: 'supplementaries', chinese: '补充' },
  { slug: 'origins', query: 'origins', chinese: '起源' },
  { slug: 'pehkui', query: 'pehkui', chinese: '缩放' },
  { slug: 'replaymod', query: 'replaymod', chinese: '回放' },
  { slug: 'freecam', query: 'freecam', chinese: '自由视角' },
  { slug: 'shoulder-surfing-reloaded', query: 'shoulder surfing', chinese: '越肩视角' },

  // 整合包
  { kind: 'modpack', slug: 'fabulously-optimized', query: 'fabulously optimized', chinese: '优化整合包', aliases: ['fo', 'fab优化'] },
  { kind: 'modpack', slug: 'all-the-mods-10', query: 'all the mods 10', chinese: 'ATM10 整合包', aliases: ['atm10'] },
  { kind: 'modpack', slug: 'rlcraft', query: 'rlcraft', chinese: 'RLCraft 硬核生存' },
  { kind: 'modpack', slug: 'better-mc', query: 'better mc', chinese: '更好的 MC', aliases: ['bmc', 'bettermc'] },
  { kind: 'modpack', slug: 'gt-new-horizons', query: 'gregtech new horizons', chinese: '格雷科技：新视野', aliases: ['gtnh'] },
  { kind: 'modpack', slug: 'vault-hunters', query: 'vault hunters', chinese: '宝库猎人', aliases: ['vh'] },
  { kind: 'modpack', slug: 'create-astral', query: 'create astral', chinese: '机械动力：星界' }
]

const GENERIC_QUERIES: GenericQuery[] = [
  { aliases: ['优化', '性能', '帧数', 'fps'], query: 'optimization' },
  { aliases: ['小地图'], query: 'minimap' },
  { aliases: ['物品管理器', '物品管理', '配方查看', '配方查看器'], query: 'recipe viewer' },
  { aliases: ['输入法', '输入法冲突', '输入法修复', '输入法冲突修复'], query: 'IMBlocker' },
  { aliases: ['光影', '着色器'], query: 'shaders' },
  { aliases: ['科技', '工业'], query: 'technology' },
  { aliases: ['魔法'], query: 'magic' },
  { aliases: ['冒险'], query: 'adventure' },
  { aliases: ['农业', '农耕'], query: 'farming' },
  { aliases: ['建筑'], query: 'building' },
  { aliases: ['存储', '仓储'], query: 'storage' },
  { aliases: ['自动化'], query: 'automation' },
  { aliases: ['家具'], query: 'furniture' },
  { aliases: ['武器'], query: 'weapons' },
  { aliases: ['工具'], query: 'tools' },
  { aliases: ['生物', '怪物'], query: 'mobs' },
  { aliases: ['地牢'], query: 'dungeon' },
  { aliases: ['维度'], query: 'dimension' },
  { aliases: ['附魔'], query: 'enchanting' },
  { aliases: ['食物', '烹饪'], query: 'food' },
  { aliases: ['配置'], query: 'config' },
  { aliases: ['前置', '库'], query: 'library' },
  { aliases: ['汉化', '中文'], query: 'translation' },
  { aliases: ['任务'], query: 'questing' },
  { aliases: ['经济'], query: 'economy' },
  { aliases: ['多人', '服务器'], query: 'multiplayer' },
  { aliases: ['界面', 'ui'], query: 'ui' }
]

export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

function cleanQuery(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw.trim().slice(0, 100)
}

function stripKindSuffix(value: string, kind: SearchKind): string {
  if (kind !== 'mod') return value
  const stripped = value.replace(/[\s\-_·]*(?:模组|mod|模组名)$/iu, '').trim()
  return stripped || value
}

function queryInitials(value: string): string {
  const words = value
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
  if (words.length < 2) return ''
  return words.map((word) => word[0] ?? '').join('')
}

function prepareAliases(seeds: AliasSeed[]): PreparedAlias[] {
  return seeds.map((seed) => {
    const kind = seed.kind ?? 'mod'
    const aliases = [
      seed.chinese,
      seed.query,
      seed.slug,
      ...(seed.aliases ?? [])
    ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    return {
      kind,
      slug: seed.slug,
      query: seed.query,
      chinese: seed.chinese,
      aliases,
      normalizedAliases: [...new Set(aliases.map(normalizeSearchText).filter(Boolean))],
      normalizedSlug: normalizeSearchText(seed.slug),
      normalizedTitle: normalizeSearchText(seed.query),
      initials: queryInitials(seed.query),
      curseforgeSlugs: seed.curseforgeSlugs ?? [],
      modrinthSlugs: seed.modrinthSlugs ?? [],
      variants: seed.variants ?? [],
      custom: seed.custom === true,
      priority:
        typeof seed.priority === 'number' && Number.isFinite(seed.priority)
          ? Math.max(0, Math.trunc(seed.priority))
          : 0
    }
  })
}

function buildAliasIndex(entries: PreparedAlias[]): Map<string, PreparedAlias[]> {
  const index = new Map<string, PreparedAlias[]>()
  for (const entry of entries) {
    for (const alias of entry.normalizedAliases) {
      const list = index.get(alias) ?? []
      list.push(entry)
      index.set(alias, list)
    }
  }
  return index
}

let CUSTOM_ALIAS_SEEDS: AliasSeed[] = []
let PREPARED_ALIASES = prepareAliases(ALIAS_SEEDS)
let ALIAS_INDEX = buildAliasIndex(PREPARED_ALIASES)
let PINYIN_INDEX: PinyinIndexEntry[] | null = null

/** 由自定义中文别名/ MC百科导入的链接更新搜索索引。 */
export function registerCustomSearchAliases(seeds: AliasSeed[]): void {
  CUSTOM_ALIAS_SEEDS = seeds.slice(0, 31000)
  PREPARED_ALIASES = prepareAliases([...CUSTOM_ALIAS_SEEDS, ...ALIAS_SEEDS])
  ALIAS_INDEX = buildAliasIndex(PREPARED_ALIASES)
  PINYIN_INDEX = null
}

const GENERIC_INDEX = new Map<string, string>()
for (const generic of GENERIC_QUERIES) {
  for (const alias of generic.aliases) {
    const key = normalizeSearchText(alias)
    if (key) GENERIC_INDEX.set(key, generic.query)
  }
}

function exactAliasEntry(normalized: string, kind: AliasKind): PreparedAlias | null {
  const matches = ALIAS_INDEX.get(normalized)
  if (!matches) return null
  const kindMatches = matches.filter((entry) => entry.kind === kind)
  if (kindMatches.length === 0) return null
  if (kindMatches.length === 1) return kindMatches[0]
  // 用户别名 > 脚本生成的批量别名 > 内置词表。
  const maxPriority = Math.max(...kindMatches.map((entry) => entry.priority))
  const top = kindMatches.filter((entry) => entry.priority === maxPriority)
  if (top.length === 1) return top[0]
  // 同一层级里优先取 slug 完全一致的那个，再优先用户导入的别名，
  // 否则视为歧义。
  const slugMatch = top.find((entry) => entry.normalizedSlug === normalized)
  if (slugMatch) return slugMatch
  const customMatches = top.filter((entry) => entry.custom)
  return customMatches.length === 1 ? customMatches[0] : null
}

function fuzzyAliasEntries(
  raw: string,
  normalized: string,
  kind: AliasKind
): PreparedAlias[] {
  const hasChinese = /[\u3400-\u9fff]/u.test(raw)
  const scored: { entry: PreparedAlias; score: number }[] = []
  for (const entry of PREPARED_ALIASES) {
    if (entry.kind !== kind) continue
    let best = 0
    for (const alias of entry.normalizedAliases) {
      if (!alias || alias === normalized) continue
      let score = 0
      if (hasChinese) {
        if (alias.startsWith(normalized)) {
          score = 720 + Math.min(120, Math.round((normalized.length / alias.length) * 120))
        } else if (normalized.startsWith(alias) && alias.length >= 2) {
          score = 650
        } else if (alias.includes(normalized) && normalized.length >= 2) {
          score = 520 + Math.min(80, normalized.length * 8)
        } else if (normalized.includes(alias) && alias.length >= 2) {
          score = 470 + Math.min(80, alias.length * 8)
        }
      } else {
        const ratio = normalized.length / Math.max(1, alias.length)
        if (alias.startsWith(normalized) && normalized.length >= 3 && ratio >= 0.5) {
          score = 560 + Math.round(ratio * 80)
        }
      }
      if (score > best) best = score
    }
    if (best > 0) scored.push({ entry, score: best })
  }
  if (scored.length === 0) return []
  scored.sort((left, right) => right.score - left.score)
  const top = scored[0]
  if (top.score < 640) return []
  // 中文短词往往同时是多个模组名称的前缀（如「通用」同时对应
  // 通用机械、通用拼音搜索等）。保留所有接近最高分的候选，
  // 交给搜索层逐个置顶，而不是武断只选一个。
  return scored
    .filter((item) => top.score - item.score < 60)
    .slice(0, 6)
    .map((item) => item.entry)
}

function substringAliasEntries(
  normalized: string,
  kind: AliasKind,
  limit = 20
): PreparedAlias[] {
  if (!/[\u3400-\u9fff]/u.test(normalized) || normalized.length < 2) return []
  const matches: {
    entry: PreparedAlias
    score: number
    length: number
  }[] = []
  for (const entry of PREPARED_ALIASES) {
    if (entry.kind !== kind) continue
    if (!entry.normalizedAliases.some((alias) => alias.includes(normalized))) continue
    const chinese = normalizeSearchText(entry.chinese)
    let score = 450
    if (chinese === normalized) {
      score = 1000
    } else if (chinese.startsWith(normalized)) {
      score =
        800 +
        Math.min(80, Math.round((normalized.length / Math.max(1, chinese.length)) * 80))
    } else if (chinese.includes(normalized)) {
      const position = chinese.indexOf(normalized)
      score =
        620 +
        Math.min(80, Math.round((normalized.length / Math.max(1, chinese.length)) * 80)) +
        Math.max(0, 40 - position * 4)
    }
    // 短名称略加权，和 PCL 的“源长度影响”方向一致。
    score += Math.max(0, 20 - Math.min(20, chinese.length))
    score += Math.min(20, entry.priority * 5)
    matches.push({ entry, score, length: entry.chinese.length })
  }
  return matches
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score
      if (left.entry.priority !== right.entry.priority) {
        return right.entry.priority - left.entry.priority
      }
      return left.length - right.length
    })
    .slice(0, Math.max(1, limit))
    .map((item) => item.entry)
}

export interface LocalAliasMatchPage {
  total: number
  slugs: string[]
  localizedNames: Record<string, string>
}

function localAliasPage(
  entries: PreparedAlias[],
  provider: ContentProvider,
  offset: number,
  limit: number,
  loader: string
): LocalAliasMatchPage {
  const allSlugs: string[] = []
  const localizedNames: Record<string, string> = {}
  for (const entry of entries) {
    const resolved = resolveAlias(entry, loader)
    const providerSlugs =
      provider === 'modrinth'
        ? resolved.modrinthSlugs.length > 0
          ? resolved.modrinthSlugs
          : [resolved.slug]
        : resolved.curseforgeSlugs.length > 0
          ? resolved.curseforgeSlugs
          : [resolved.slug]
    for (const slug of providerSlugs) {
      const key = normalizeSearchText(slug)
      if (!key) continue
      if (!allSlugs.includes(slug)) allSlugs.push(slug)
      localizedNames[key] = resolved.chinese
    }
  }
  return {
    total: allSlugs.length,
    slugs: allSlugs.slice(offset, offset + limit),
    localizedNames
  }
}

/**
 * 中文名称包含搜索，按 PCL 风格加权排序后分页。
 * 只用于 mod；返回的 slug 已按 provider 拆好，调用方直接查项目详情。
 */
export function findLocalAliasMatches(
  rawQuery: string,
  provider: ContentProvider,
  offset: number,
  limit: number,
  loader = '',
  kind: AliasKind = 'mod'
): LocalAliasMatchPage {
  const safeOffset = Number.isFinite(offset) ? Math.max(0, Math.round(offset)) : 0
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(50, Math.round(limit))) : 20
  const stripped = stripKindSuffix(String(rawQuery ?? ''), kind)
  const normalized = normalizeSearchText(stripped)
  if (!normalized || !/[\u3400-\u9fff]/u.test(normalized)) {
    return { total: 0, slugs: [], localizedNames: {} }
  }
  const entries = substringAliasEntries(normalized, kind, 200)
  return localAliasPage(entries, provider, safeOffset, safeLimit, loader)
}

function normalizePinyinQuery(value: string): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[üǖǘǚǜ]/gu, 'v')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/u:/gu, 'v')
    .replace(/[^a-z]/gu, '')
}

function pinyinFormsFor(text: string): PinyinForm[] {
  const cjk = (text.match(/[\u3400-\u9fff]+/gu) ?? []).join('')
  if (!cjk) return []
  const syllables = pinyin(cjk, { toneType: 'none', type: 'array' })
    .map(normalizePinyinQuery)
    .filter((syllable) => syllable.length > 0)
  if (syllables.length === 0) return []
  const boundaries: number[] = []
  let full = ''
  for (const syllable of syllables) {
    boundaries.push(full.length)
    full += syllable
  }
  return [
    {
      full,
      initials: syllables.map((syllable) => syllable[0]).join(''),
      boundaries
    }
  ]
}

function pinyinAliasIndex(): PinyinIndexEntry[] {
  if (PINYIN_INDEX) return PINYIN_INDEX
  const index: PinyinIndexEntry[] = []
  for (const entry of PREPARED_ALIASES) {
    const forms: PinyinForm[] = []
    const seen = new Set<string>()
    for (const field of entry.aliases) {
      if (!/[\u3400-\u9fff]/u.test(field)) continue
      for (const form of pinyinFormsFor(field)) {
        const key = `${form.full}|${form.initials}`
        if (seen.has(key)) continue
        seen.add(key)
        forms.push(form)
      }
    }
    if (forms.length > 0) index.push({ entry, forms })
  }
  PINYIN_INDEX = index
  return index
}

function pinyinEntryScore(entry: PreparedAlias, form: PinyinForm, query: string): number {
  let score = 0
  const exactFull = form.full === query
  const exactInitials = form.initials === query
  // 2–3 个字母的英文词太容易和拼音前缀/词中音节撞车（map、mod、lib…）。
  // 短查询只接受完整拼音或完整首字母，其余交给正常英文搜索。
  if (query.length <= 3 && !exactFull && !exactInitials) return 0
  if (exactFull) {
    score = 1000
  } else if (form.full.startsWith(query)) {
    score =
      880 +
      Math.min(60, Math.round((query.length / Math.max(1, form.full.length)) * 60))
  } else if (query.length >= 3) {
    // 允许从某个音节边界开始匹配，例如 dongli → 机械动力。
    const boundary = form.boundaries.find(
      (position) => position > 0 && form.full.startsWith(query, position)
    )
    if (boundary !== undefined) {
      score = 700 + Math.max(0, 30 - boundary * 2)
    }
  }
  if (exactInitials) {
    score = Math.max(score, 840)
  } else if (query.length >= 2 && form.initials.startsWith(query)) {
    score = Math.max(
      score,
      760 +
        Math.min(
          40,
          Math.round((query.length / Math.max(1, form.initials.length)) * 40)
        )
    )
  }
  if (score === 0) return 0
  const chinese = normalizeSearchText(entry.chinese)
  score += Math.max(0, 20 - Math.min(20, chinese.length))
  score += Math.min(20, entry.priority * 5)
  return score
}

/**
 * 拼音搜索：支持全拼、全拼前缀、音节中间匹配和首字母。
 * 只在没有命中已知英文别名/通用词时启用，避免把 JEI、fps 等当成拼音。
 */
export function findPinyinAliasMatches(
  rawQuery: string,
  provider: ContentProvider,
  offset: number,
  limit: number,
  loader = '',
  kind: AliasKind = 'mod'
): LocalAliasMatchPage {
  const safeOffset = Number.isFinite(offset) ? Math.max(0, Math.round(offset)) : 0
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(50, Math.round(limit))) : 20
  const stripped = stripKindSuffix(String(rawQuery ?? ''), kind)
  if (!stripped || /[\u3400-\u9fff]/u.test(stripped) || /[0-9]/u.test(stripped)) {
    return { total: 0, slugs: [], localizedNames: {} }
  }
  const query = normalizePinyinQuery(stripped)
  if (query.length < 2 || query.length > 40) {
    return { total: 0, slugs: [], localizedNames: {} }
  }
  const normalized = normalizeSearchText(stripped)
  if (exactAliasEntry(normalized, kind)) {
    return { total: 0, slugs: [], localizedNames: {} }
  }
  if (kind === 'mod' && GENERIC_INDEX.has(normalized)) {
    return { total: 0, slugs: [], localizedNames: {} }
  }
  const scored: { entry: PreparedAlias; score: number }[] = []
  for (const { entry, forms } of pinyinAliasIndex()) {
    if (entry.kind !== kind) continue
    let best = 0
    for (const form of forms) {
      const score = pinyinEntryScore(entry, form, query)
      if (score > best) best = score
    }
    if (best > 0) scored.push({ entry, score: best })
  }
  if (scored.length === 0) {
    return { total: 0, slugs: [], localizedNames: {} }
  }
  scored.sort(
    (left, right) =>
      right.score - left.score ||
      right.entry.priority - left.entry.priority ||
      left.entry.chinese.length - right.entry.chinese.length
  )
  const entries = scored.slice(0, 200).map((item) => item.entry)
  return localAliasPage(entries, provider, safeOffset, safeLimit, loader)
}

function initialsEntry(normalized: string, kind: AliasKind): PreparedAlias | null {
  if (!/^[a-z0-9]{3,12}$/u.test(normalized)) return null
  const matches = PREPARED_ALIASES.filter(
    (entry) => entry.kind === kind && entry.initials === normalized
  )
  return matches.length === 1 ? matches[0] : null
}

interface ResolvedAlias {
  query: string
  slug: string
  chinese: string
  curseforgeSlugs: string[]
  modrinthSlugs: string[]
}

function resolveAlias(entry: PreparedAlias, loader: string): ResolvedAlias {
  const normalizedLoader = loader.trim().toLowerCase()
  if (normalizedLoader) {
    const variant = entry.variants.find((item) =>
      item.loaders.some((value) => value.toLowerCase() === normalizedLoader)
    )
    if (variant) {
      return {
        query: variant.query,
        slug: variant.slug,
        chinese: variant.chinese ?? entry.chinese,
        curseforgeSlugs: variant.curseforgeSlugs ?? entry.curseforgeSlugs,
        modrinthSlugs: variant.modrinthSlugs ?? entry.modrinthSlugs
      }
    }
  }
  return {
    query: entry.query,
    slug: entry.slug,
    chinese: entry.chinese,
    curseforgeSlugs: entry.curseforgeSlugs,
    modrinthSlugs: entry.modrinthSlugs
  }
}

function translatedResult(
  original: string,
  entry: PreparedAlias,
  loader: string
): SearchQueryExpansion {
  const resolved = resolveAlias(entry, loader)
  const translated = normalizeSearchText(resolved.query) !== normalizeSearchText(original)
  const preferredSlugs = [
    ...new Set([
      resolved.slug,
      ...resolved.curseforgeSlugs,
      ...resolved.modrinthSlugs
    ].filter(Boolean))
  ]
  const localizedNames: Record<string, string> = {}
  for (const slug of preferredSlugs) {
    localizedNames[normalizeSearchText(slug)] = resolved.chinese
  }
  const hasProviderSlugs =
    resolved.curseforgeSlugs.length > 0 || resolved.modrinthSlugs.length > 0
  return {
    original,
    query: resolved.query,
    translated,
    preferredSlugs,
    ...(hasProviderSlugs
      ? {
          preferredSlugsByProvider: {
            ...(resolved.curseforgeSlugs.length > 0
              ? { curseforge: resolved.curseforgeSlugs }
              : {}),
            ...(resolved.modrinthSlugs.length > 0
              ? { modrinth: resolved.modrinthSlugs }
              : {})
          }
        }
      : {}),
    localizedNames,
    chineseName: resolved.chinese
  }
}

function multiAliasResult(
  original: string,
  entries: PreparedAlias[],
  loader: string
): SearchQueryExpansion {
  const preferredSlugs: string[] = []
  const curseforgeSlugs: string[] = []
  const modrinthSlugs: string[] = []
  const localizedNames: Record<string, string> = {}
  for (const entry of entries) {
    const resolved = resolveAlias(entry, loader)
    const slugs = [
      resolved.slug,
      ...resolved.curseforgeSlugs,
      ...resolved.modrinthSlugs
    ].filter(Boolean)
    for (const slug of slugs) {
      if (!preferredSlugs.includes(slug)) preferredSlugs.push(slug)
      localizedNames[normalizeSearchText(slug)] = resolved.chinese
    }
    const curseforgeForEntry =
      resolved.curseforgeSlugs.length > 0
        ? resolved.curseforgeSlugs
        : [resolved.slug]
    const modrinthForEntry =
      resolved.modrinthSlugs.length > 0
        ? resolved.modrinthSlugs
        : [resolved.slug]
    for (const slug of curseforgeForEntry) {
      if (!curseforgeSlugs.includes(slug)) curseforgeSlugs.push(slug)
    }
    for (const slug of modrinthForEntry) {
      if (!modrinthSlugs.includes(slug)) modrinthSlugs.push(slug)
    }
  }
  return {
    original,
    // 保留原文，让 API 继续返回标题/简介里真正含这个词的中文项目；
    // 同时把本地命中的多个已知项目逐个置顶。
    query: original,
    translated: false,
    preferredSlugs,
    preferredSlugsByProvider: {
      curseforge: curseforgeSlugs,
      modrinth: modrinthSlugs
    },
    localizedNames,
    chineseName: null
  }
}

function genericResult(original: string, query: string): SearchQueryExpansion {
  return {
    original,
    query,
    translated: normalizeSearchText(query) !== normalizeSearchText(original),
    preferredSlugs: [],
    chineseName: null
  }
}

/**
 * 把中文名、常见简称和英文缩写转换为搜索 API 能理解的查询词。
 * 非模组/整合包搜索保持原文，避免资源包、光影包被错误改写。
 */
export function expandSearchQuery(
  rawQuery: string,
  kind: SearchKind = 'mod',
  loader = ''
): SearchQueryExpansion {
  const original = cleanQuery(rawQuery)
  if (!original) {
    return { original, query: original, translated: false, preferredSlugs: [], chineseName: null }
  }
  if (kind !== 'mod' && kind !== 'modpack') {
    return { original, query: original, translated: false, preferredSlugs: [], chineseName: null }
  }
  const stripped = stripKindSuffix(original, kind)
  const normalized = normalizeSearchText(stripped)
  if (!normalized) {
    return { original, query: original, translated: false, preferredSlugs: [], chineseName: null }
  }

  const exact = exactAliasEntry(normalized, kind)
  if (exact) return translatedResult(original, exact, loader)
  // 中文搜索优先走本地名称包含匹配：PCL 式结果会列出所有中文名包含
  // 查询词的已知项目（如「通用」→ 通用机械、通用拼音搜索、通用骨粉…）。
  if (/[\u3400-\u9fff]/u.test(stripped)) {
    const substring = substringAliasEntries(normalized, kind)
    if (substring.length > 0) return multiAliasResult(original, substring, loader)
  }
  const fuzzy = fuzzyAliasEntries(stripped, normalized, kind)
  if (fuzzy.length === 1) return translatedResult(original, fuzzy[0], loader)
  if (fuzzy.length > 1) return multiAliasResult(original, fuzzy, loader)
  const initials = initialsEntry(normalized, kind)
  if (initials) return translatedResult(original, initials, loader)

  if (kind === 'mod') {
    const generic = GENERIC_INDEX.get(normalized)
    if (generic) return genericResult(original, generic)
  }
  return { original, query: original, translated: false, preferredSlugs: [], chineseName: null }
}

export function localizedNameFor(
  slug: string,
  title: string,
  kind: AliasKind = 'mod'
): string | null {
  const normalizedSlug = normalizeSearchText(slug)
  const normalizedTitle = normalizeSearchText(title)
  const entry = PREPARED_ALIASES.find((item) => {
    if (item.kind !== kind) return false
    if (
      normalizedSlug &&
      (item.normalizedSlug === normalizedSlug ||
        item.curseforgeSlugs.some(
          (candidate) => normalizeSearchText(candidate) === normalizedSlug
        ) ||
        item.modrinthSlugs.some(
          (candidate) => normalizeSearchText(candidate) === normalizedSlug
        ))
    ) {
      return true
    }
    return Boolean(normalizedTitle && item.normalizedTitle === normalizedTitle)
  })
  if (entry) {
    const display = entry.chinese.trim()
    if (!display) return null
    if (normalizeSearchText(display) === normalizeSearchText(title)) return null
    return display
  }
  for (const item of PREPARED_ALIASES) {
    if (item.kind !== kind) continue
    const variant = item.variants.find(
      (candidate) =>
        (normalizedSlug && normalizeSearchText(candidate.slug) === normalizedSlug) ||
        (normalizedTitle && normalizeSearchText(candidate.query) === normalizedTitle)
    )
    if (!variant) continue
    const display = (variant.chinese ?? item.chinese).trim()
    if (!display || normalizeSearchText(display) === normalizeSearchText(title)) return null
    return display
  }
  return null
}

export function preferredSlugsFor(
  expansion: SearchQueryExpansion,
  provider: ContentProvider
): string[] {
  const specific = expansion.preferredSlugsByProvider?.[provider]
  if (specific && specific.length > 0) return specific
  return expansion.preferredSlugs
}

export function localizedNameFromExpansion(
  expansion: SearchQueryExpansion,
  slug: string
): string | null {
  return expansion.localizedNames?.[normalizeSearchText(slug)] ?? null
}

export function prioritizeSearchHits<T extends { slug: string }>(
  hits: T[],
  expansion: SearchQueryExpansion,
  offset: number,
  provider?: ContentProvider
): T[] {
  if (offset !== 0) return hits
  const slugs = provider ? preferredSlugsFor(expansion, provider) : expansion.preferredSlugs
  if (slugs.length === 0) return hits
  const preferred = new Set(slugs.map(normalizeSearchText).filter(Boolean))
  if (preferred.size === 0) return hits
  return [...hits].sort((left, right) => {
    const leftPreferred = preferred.has(normalizeSearchText(left.slug)) ? 1 : 0
    const rightPreferred = preferred.has(normalizeSearchText(right.slug)) ? 1 : 0
    return rightPreferred - leftPreferred
  })
}
