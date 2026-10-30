/**
 * KubeJS 事件与 API 的基础知识表。
 * 编辑器补全和静态预检共用，避免两边说法不一致。
 * 这里只收录跨版本长期存在的事件；版本差异较大的 API 不做硬性报错。
 */

export type KubeJsScriptSide = 'server' | 'client' | 'startup' | 'both'

export interface KubeJsEventDef {
  name: string
  methods?: string[]
  detail?: string
}

export interface KubeJsEventGroupDef {
  name: string
  side: KubeJsScriptSide
  events: KubeJsEventDef[]
}

export const RECIPE_EVENT_METHODS = [
  'remove',
  'replaceInput',
  'replaceOutput',
  'shaped',
  'shapeless',
  'smelting',
  'blasting',
  'smoking',
  'campfireCooking',
  'stonecutting',
  'smithing',
  'custom',
  'damageItem',
  'recipes'
]

export const TAG_EVENT_METHODS = ['add', 'remove', 'removeAll', 'get']

export const KUBEJS_EVENT_GROUPS: KubeJsEventGroupDef[] = [
  {
    name: 'ServerEvents',
    side: 'server',
    events: [
      { name: 'recipes', methods: RECIPE_EVENT_METHODS, detail: '服务端配方事件' },
      { name: 'tags', methods: TAG_EVENT_METHODS, detail: '服务端标签事件' },
      { name: 'loaded', detail: '服务器加载完成' },
      { name: 'unloaded', detail: '服务器卸载' },
      { name: 'command', detail: '注册命令' },
      { name: 'commandRegistry', detail: '命令注册表' },
      { name: 'afterRecipes', detail: '配方加载之后' }
    ]
  },
  {
    name: 'ClientEvents',
    side: 'client',
    events: [
      { name: 'init', detail: '客户端初始化' },
      { name: 'left', detail: '左键点击' },
      { name: 'right', detail: '右键点击' },
      { name: 'middle', detail: '中键点击' },
      { name: 'loggedIn', detail: '进入世界' },
      { name: 'loggedOut', detail: '退出世界' },
      { name: 'tick', detail: '客户端 tick' },
      { name: 'paintScreen', detail: '绘制屏幕' },
      { name: 'paintBackground', detail: '绘制背景' },
      { name: 'lang', detail: '语言文件' },
      { name: 'highPriorityAssets', detail: '高优先级资源' },
      { name: 'generateAssets', detail: '生成资源' },
      { name: 'itemTooltip', detail: '物品提示' },
      { name: 'entityTooltip', detail: '实体提示' },
      { name: 'debugInfo', detail: '调试信息' }
    ]
  },
  {
    name: 'StartupEvents',
    side: 'startup',
    events: [
      { name: 'init', detail: '启动初始化' },
      { name: 'registry', detail: '注册表事件' },
      { name: 'postInit', detail: '启动后初始化' },
      { name: 'modifyCreativeTab', detail: '修改创造模式标签页' },
      { name: 'modifyCreativeTabs', detail: '修改创造模式标签页' }
    ]
  },
  {
    name: 'PlayerEvents',
    side: 'server',
    events: [
      { name: 'loggedIn', detail: '玩家进入' },
      { name: 'loggedOut', detail: '玩家离开' },
      { name: 'tick', detail: '玩家 tick' },
      { name: 'chat', detail: '玩家聊天' },
      { name: 'death', detail: '玩家死亡' },
      { name: 'respawn', detail: '玩家重生' },
      { name: 'inventoryChanged', detail: '玩家背包变化' },
      { name: 'advanceAdvancement', detail: '玩家进度' },
      { name: 'copy', detail: '玩家数据复制' },
      { name: 'changeDimension', detail: '玩家切换维度' }
    ]
  },
  {
    name: 'BlockEvents',
    side: 'server',
    events: [
      { name: 'placed', detail: '方块放置' },
      { name: 'broken', detail: '方块破坏' },
      { name: 'leftClicked', detail: '左键点击方块' },
      { name: 'rightClicked', detail: '右键点击方块' },
      { name: 'startBreak', detail: '开始破坏方块' },
      { name: 'stopBreak', detail: '停止破坏方块' },
      { name: 'farmlandTrampled', detail: '耕地被踩踏' }
    ]
  },
  {
    name: 'ItemEvents',
    side: 'both',
    events: [
      { name: 'rightClicked', detail: '右键物品' },
      { name: 'firstRightClicked', detail: '首次右键物品' },
      { name: 'leftClicked', detail: '左键物品' },
      { name: 'entityInteracted', detail: '物品与实体交互' },
      { name: 'tooltip', detail: '物品提示' },
      { name: 'foodEaten', detail: '食物被食用' },
      { name: 'crafted', detail: '物品合成' },
      { name: 'smelted', detail: '物品熔炼' },
      { name: 'pickedUp', detail: '物品拾取' },
      { name: 'destroyed', detail: '物品销毁' },
      { name: 'modelProperties', detail: '物品模型属性' },
      { name: 'canPickUp', detail: '能否拾取物品' },
      { name: 'armorTicked', detail: '盔甲 tick' }
    ]
  },
  {
    name: 'EntityEvents',
    side: 'server',
    events: [
      { name: 'death', detail: '实体死亡' },
      { name: 'hurt', detail: '实体受伤' },
      { name: 'beforeHurt', detail: '实体受伤前' },
      { name: 'afterHurt', detail: '实体受伤后' },
      { name: 'spawn', detail: '实体生成' },
      { name: 'spawned', detail: '实体生成后' },
      { name: 'checkSpawn', detail: '检查实体生成' },
      { name: 'drops', detail: '实体掉落物' }
    ]
  },
  {
    name: 'JEIEvents',
    side: 'client',
    events: [
      { name: 'addItems', detail: '向 JEI 添加物品' },
      { name: 'removeItems', detail: '从 JEI 移除物品' },
      { name: 'hideItems', detail: '隐藏 JEI 物品' },
      { name: 'addRecipes', detail: '向 JEI 添加配方' },
      { name: 'removeRecipes', detail: '从 JEI 移除配方' },
      { name: 'hideRecipes', detail: '隐藏 JEI 配方' },
      { name: 'addCategories', detail: '添加 JEI 分类' },
      { name: 'removeCategories', detail: '移除 JEI 分类' },
      { name: 'hideCategories', detail: '隐藏 JEI 分类' },
      { name: 'information', detail: 'JEI 信息页' },
      { name: 'subtypes', detail: 'JEI 子类型' }
    ]
  },
  {
    name: 'REIEvents',
    side: 'client',
    events: [
      { name: 'addItems', detail: '向 REI 添加物品' },
      { name: 'removeItems', detail: '从 REI 移除物品' },
      { name: 'hideItems', detail: '隐藏 REI 物品' },
      { name: 'addRecipes', detail: '向 REI 添加配方' },
      { name: 'removeRecipes', detail: '从 REI 移除配方' },
      { name: 'hideRecipes', detail: '隐藏 REI 配方' },
      { name: 'removeCategories', detail: '移除 REI 分类' },
      { name: 'hideCategories', detail: '隐藏 REI 分类' },
      { name: 'information', detail: 'REI 信息页' }
    ]
  },
  {
    name: 'LevelEvents',
    side: 'server',
    events: [
      { name: 'loaded', detail: '维度加载' },
      { name: 'unloaded', detail: '维度卸载' },
      { name: 'tick', detail: '维度 tick' },
      { name: 'beforeExplosion', detail: '爆炸前' },
      { name: 'afterExplosion', detail: '爆炸后' }
    ]
  },
  {
    name: 'NetworkEvents',
    side: 'both',
    events: [{ name: 'dataReceived', detail: '收到网络数据' }]
  }
]

export const KUBEJS_EVENT_GROUP_NAMES = KUBEJS_EVENT_GROUPS.map((group) => group.name)

export function findEventGroup(name: string): KubeJsEventGroupDef | null {
  return KUBEJS_EVENT_GROUPS.find((group) => group.name === name) ?? null
}

export function findEventDef(group: string, event: string): KubeJsEventDef | null {
  return findEventGroup(group)?.events.find((entry) => entry.name === event) ?? null
}

export function eventMethodsFor(group: string, event: string): string[] | null {
  return findEventDef(group, event)?.methods ?? null
}

/** 事件回调里可能出现的通用对象方法，不能当成 KubeJS 拼写错误。 */
export const GENERIC_OBJECT_METHODS = new Set([
  'toString',
  'valueOf',
  'hasOwnProperty',
  'constructor',
  'then',
  'catch',
  'finally',
  'bind',
  'call',
  'apply'
])

export const KUBEJS_GLOBAL_OBJECTS: { name: string; detail: string }[] = [
  { name: 'ServerEvents', detail: '服务端事件' },
  { name: 'ClientEvents', detail: '客户端事件' },
  { name: 'StartupEvents', detail: '启动事件' },
  { name: 'PlayerEvents', detail: '玩家事件' },
  { name: 'BlockEvents', detail: '方块事件' },
  { name: 'ItemEvents', detail: '物品事件' },
  { name: 'EntityEvents', detail: '实体事件' },
  { name: 'LevelEvents', detail: '维度事件' },
  { name: 'NetworkEvents', detail: '网络事件' },
  { name: 'JEIEvents', detail: 'JEI 集成' },
  { name: 'REIEvents', detail: 'REI 集成' },
  { name: 'Item', detail: '物品工具' },
  { name: 'Ingredient', detail: '配方原料' },
  { name: 'Fluid', detail: '流体工具' },
  { name: 'Utils', detail: '通用工具' },
  { name: 'Java', detail: 'Java 互操作' },
  { name: 'console', detail: '控制台' }
]

export function closestName(
  input: string,
  candidates: readonly string[],
  maxDistance?: number
): string | null {
  let best: string | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  const lower = input.toLowerCase()
  for (const candidate of candidates) {
    const distance = editDistance(lower, candidate.toLowerCase())
    if (distance < bestDistance) {
      bestDistance = distance
      best = candidate
    }
  }
  if (!best) return null
  const limit = maxDistance ?? Math.max(2, Math.floor(input.length / 3))
  return bestDistance <= limit ? best : null
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0
  const rows = a.length + 1
  const cols = b.length + 1
  let previous = new Array<number>(cols)
  let current = new Array<number>(cols)
  for (let col = 0; col < cols; col += 1) previous[col] = col
  for (let row = 1; row < rows; row += 1) {
    current[0] = row
    for (let col = 1; col < cols; col += 1) {
      const cost = a[row - 1] === b[col - 1] ? 0 : 1
      current[col] = Math.min(
        previous[col] + 1,
        current[col - 1] + 1,
        previous[col - 1] + cost
      )
    }
    const swap = previous
    previous = current
    current = swap
  }
  return previous[cols - 1]
}
