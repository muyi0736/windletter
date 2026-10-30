import { parse } from '@babel/parser'
import type { KubeJsExplainPoint, KubeJsExplainResult } from '../../shared/types'
import {
  findEventDef,
  findEventGroup,
  type KubeJsEventGroupDef
} from '../../shared/kubejsKnowledge'

type Ast = any

interface ExplainContext {
  points: KubeJsExplainPoint[]
  actions: Set<string>
  events: Set<string>
  warnings: Set<string>
}

interface EventSpec {
  group: string
  event: string
  param: string | null
  registryType: string | null
}

interface TreeIndex {
  nodes: Ast[]
  parent: WeakMap<object, Ast>
}

const MAX_POINTS = 30
const MAX_DETAIL = 500

const GROUP_LABELS: Record<string, string> = {
  ServerEvents: '服务端事件',
  ClientEvents: '客户端事件',
  StartupEvents: '启动事件',
  PlayerEvents: '玩家事件',
  BlockEvents: '方块事件',
  ItemEvents: '物品事件',
  EntityEvents: '实体事件',
  LevelEvents: '维度事件',
  NetworkEvents: '网络事件',
  JEIEvents: 'JEI 事件',
  REIEvents: 'REI 事件'
}

const RECIPE_LABELS: Record<string, string> = {
  shaped: '添加有序配方',
  shapeless: '添加无序配方',
  smelting: '添加熔炼配方',
  blasting: '添加高炉配方',
  smoking: '添加烟熏配方',
  campfireCooking: '添加营火配方',
  stonecutting: '添加切石配方',
  smithing: '添加锻造配方',
  damageItem: '设置物品耐久消耗'
}

const LOOT_METHODS = new Set([
  'modifiers',
  'addLootTableModifier',
  'addEntityModifier',
  'addBlockModifier',
  'removeLoot',
  'modifyLootTable',
  'createLootTable'
])

function isFunction(node: Ast): boolean {
  return (
    node?.type === 'FunctionDeclaration' ||
    node?.type === 'FunctionExpression' ||
    node?.type === 'ArrowFunctionExpression'
  )
}

function lineOf(node: Ast): number | null {
  const line = node?.loc?.start?.line
  return typeof line === 'number' ? line : null
}

function stringValue(node: Ast): string | null {
  if (node?.type === 'StringLiteral') return node.value
  if (node?.type === 'TemplateLiteral' && node.expressions?.length === 0) {
    return node.quasis?.[0]?.value?.cooked ?? null
  }
  return null
}

function identifierName(node: Ast): string | null {
  if (node?.type === 'Identifier') return node.name
  if (node?.type === 'StringLiteral') return node.value
  return null
}

function memberInfo(
  node: Ast
): { object: Ast; property: string | null; propertyNode: Ast | null } | null {
  if (!node) return null
  if (node.type !== 'MemberExpression' && node.type !== 'OptionalMemberExpression') return null
  const propertyNode = node.property
  let property: string | null = null
  if (!node.computed && propertyNode?.type === 'Identifier') property = propertyNode.name
  else if (propertyNode?.type === 'StringLiteral') property = propertyNode.value
  return { object: node.object, property, propertyNode }
}

function callInfo(node: Ast): { callee: Ast; args: Ast[] } | null {
  if (node?.type !== 'CallExpression' && node?.type !== 'OptionalCallExpression') return null
  return { callee: node.callee, args: Array.isArray(node.arguments) ? node.arguments : [] }
}

function memberChain(node: Ast): string[] | null {
  const parts: string[] = []
  let current = node
  while (true) {
    const info = memberInfo(current)
    if (!info) break
    if (!info.property) return null
    parts.unshift(info.property)
    current = info.object
  }
  const root = identifierName(current)
  if (!root) return null
  parts.unshift(root)
  return parts
}

function firstParamName(fn: Ast): string | null {
  const first = fn?.params?.[0]
  return first?.type === 'Identifier' ? first.name : null
}

function propertyKey(node: Ast): string | null {
  if (!node || node.type !== 'ObjectProperty') return null
  return identifierName(node.key)
}

function objectProperties(node: Ast): Map<string, Ast> {
  const result = new Map<string, Ast>()
  if (node?.type !== 'ObjectExpression') return result
  for (const property of node.properties ?? []) {
    if (property.type !== 'ObjectProperty' || property.computed) continue
    const key = identifierName(property.key)
    if (key) result.set(key, property.value)
  }
  return result
}

function trimText(value: string, max = 80): string {
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function describeValue(node: Ast, depth = 0): string {
  if (!node || depth > 3) return '表达式'
  const raw = stringValue(node)
  if (raw !== null) return trimText(raw, 120) || '空字符串'
  if (node.type === 'NumericLiteral' || node.type === 'BooleanLiteral') {
    return String(node.value)
  }
  if (node.type === 'NullLiteral') return 'null'
  if (node.type === 'ArrayExpression') {
    const values = (node.elements ?? [])
      .slice(0, 4)
      .map((element: Ast) => describeValue(element, depth + 1))
      .filter(Boolean)
    const more = (node.elements?.length ?? 0) > 4 ? ' 等' : ''
    return values.length > 0 ? `${values.join('、')}${more}` : '空数组'
  }
  if (node.type === 'ObjectExpression') {
    const properties = objectProperties(node)
    for (const key of ['item', 'id', 'tag', 'output', 'result']) {
      const value = properties.get(key)
      if (value) return describeValue(value, depth + 1)
    }
    return `{ ${[...properties.keys()].slice(0, 4).join(', ')} }`
  }
  if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') {
    const chain = memberChain(node.callee)
    if (chain && chain[0] === 'Item' && chain[1] === 'of') {
      const base = describeValue(node.arguments?.[0], depth + 1)
      const count = node.arguments?.[1]
      if (count?.type === 'NumericLiteral') return `${base} ×${count.value}`
      return base
    }
    if (chain && chain[0] === 'Ingredient' && chain[1] === 'of') {
      return describeValue(node.arguments?.[0], depth + 1)
    }
    return chain ? `${chain.join('.')}(…)` : '函数调用'
  }
  return '表达式'
}

function addPoint(
  context: ExplainContext,
  line: number | null,
  title: string,
  detail: string
): void {
  if (context.points.length >= 80) return
  const cleanTitle = trimText(title, 80)
  const cleanDetail = trimText(detail, MAX_DETAIL)
  if (!cleanTitle || !cleanDetail) return
  if (
    context.points.some(
      (point) => point.line === line && point.title === cleanTitle
    )
  ) {
    return
  }
  context.points.push({ line, title: cleanTitle, detail: cleanDetail })
}

function addWarning(context: ExplainContext, message: string): void {
  const clean = message.replace(/\s+/g, ' ').trim()
  if (clean) context.warnings.add(clean.slice(0, 300))
}

function indexTree(root: Ast): TreeIndex {
  const nodes: Ast[] = []
  const parent = new WeakMap<object, Ast>()
  const walk = (node: Ast, parentNode: Ast | null): void => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const child of node) walk(child, parentNode)
      return
    }
    if (typeof node.type !== 'string') return
    nodes.push(node)
    if (parentNode) parent.set(node, parentNode)
    for (const key of Object.keys(node)) {
      if (
        key === 'loc' ||
        key === 'start' ||
        key === 'end' ||
        key === 'extra' ||
        key.includes('Comments')
      ) {
        continue
      }
      walk(node[key], node)
    }
  }
  walk(root, null)
  return { nodes, parent }
}

function nearestFunction(node: Ast, parent: WeakMap<object, Ast>): Ast | null {
  let current = parent.get(node)
  while (current) {
    if (isFunction(current)) return current
    current = parent.get(current)
  }
  return null
}

function findSpec(
  node: Ast,
  parent: WeakMap<object, Ast>,
  specs: Map<Ast, EventSpec>
): EventSpec | null {
  let current = parent.get(node)
  while (current) {
    if (isFunction(current)) {
      const spec = specs.get(current)
      if (spec) return spec
    }
    current = parent.get(current)
  }
  return null
}

function groupLabel(groupName: string): string {
  return GROUP_LABELS[groupName] ?? groupName
}

function scriptSide(path: string): 'server' | 'client' | 'startup' | null {
  const normalized = path.replace(/\\/g, '/').toLowerCase()
  if (normalized.startsWith('server_scripts/')) return 'server'
  if (normalized.startsWith('client_scripts/')) return 'client'
  if (normalized.startsWith('startup_scripts/')) return 'startup'
  return null
}

function sideLabel(side: string): string {
  return side === 'server' ? '服务端' : side === 'client' ? '客户端' : '启动'
}

function registryLabel(type: string | null): string {
  switch (type) {
    case 'item':
      return '物品'
    case 'block':
      return '方块'
    case 'fluid':
      return '流体'
    case 'entity':
      return '实体'
    default:
      return '内容'
  }
}

function tagText(value: string): string {
  const text = value.trim()
  return text.startsWith('#') ? text : `#${text}`
}

function collectEventSpecs(
  nodes: Ast[],
  context: ExplainContext,
  path: string
): Map<Ast, EventSpec> {
  const specs = new Map<Ast, EventSpec>()
  const side = scriptSide(path)
  for (const node of nodes) {
    const call = callInfo(node)
    if (!call) continue
    const callee = memberInfo(call.callee)
    if (!callee) continue
    const groupName = identifierName(callee.object)
    if (!groupName) continue
    const group = findEventGroup(groupName)
    if (!group) continue
    const eventName = callee.property
    if (!eventName) continue
    const eventDef = group.events.find((event) => event.name === eventName)
    const callback = call.args.find((arg) => isFunction(arg)) ?? null
    const param = callback ? firstParamName(callback) : null
    const registryType =
      groupName === 'StartupEvents' && eventName === 'registry'
        ? stringValue(call.args[0])
        : null
    const tagType =
      groupName === 'ServerEvents' && eventName === 'tags'
        ? stringValue(call.args[0])
        : null
    if (callback) {
      specs.set(callback, { group: groupName, event: eventName, param, registryType })
    }
    const line = lineOf(node)
    const detailParts = [
      eventDef?.detail ?? `${groupLabel(groupName)} 中的 ${eventName} 事件`,
      registryType ? `注册表类型为 ${registryType}` : '',
      tagType ? `标签类型为 ${tagType}` : '',
      param ? `回调参数为 ${param}` : '没有可用的回调参数'
    ].filter(Boolean)
    addPoint(
      context,
      line,
      `${groupLabel(groupName)} · ${eventName}`,
      detailParts.join('；') + '。'
    )
    context.events.add(`${groupLabel(groupName)}.${eventName}`)
    if (!callback) {
      addWarning(context, `第 ${line ?? '?'} 行 ${groupName}.${eventName} 没有回调函数。`)
    } else if (!param) {
      addWarning(
        context,
        `第 ${line ?? '?'} 行 ${groupName}.${eventName} 回调没有命名的 event 参数，内部不容易引用事件对象。`
      )
    }
    if (side && group.side !== 'both' && group.side !== side) {
      addWarning(
        context,
        `第 ${line ?? '?'} 行 ${groupName} 属于${sideLabel(group.side)}脚本，但当前文件在 ${side}_scripts。`
      )
    }
  }
  return specs
}

function explainRemove(call: { callee: Ast; args: Ast[] }, context: ExplainContext): void {
  const line = lineOf(call.callee)
  const filter = call.args[0]
  if (!filter) {
    addWarning(context, `第 ${line ?? '?'} 行 event.remove() 没有筛选条件。`)
    return
  }
  const properties = objectProperties(filter)
  if (properties.size === 0) {
    const raw = describeValue(filter)
    addPoint(context, line, '删除配方', `按 ${raw} 删除配方。`)
    context.actions.add('删除配方')
    return
  }
  let added = false
  const ids = properties.get('id')
  if (ids) {
    addPoint(context, line, '删除指定配方', `删除配方 ID：${describeValue(ids)}。`)
    context.actions.add('删除指定配方')
    added = true
  }
  const output = properties.get('output')
  if (output) {
    addPoint(context, line, '删除产出配方', `删除所有产出 ${describeValue(output)} 的配方。`)
    context.actions.add('删除物品产出配方')
    added = true
  }
  const mod = properties.get('mod')
  if (mod) {
    const namespace = describeValue(mod)
    addPoint(context, line, '删除整个模组配方', `删除命名空间 ${namespace} 下的全部配方。`)
    context.actions.add('删除整个模组配方')
    addWarning(
      context,
      `第 ${line ?? '?'} 行按模组删除配方，范围较大，请确认 ${namespace} 的所有配方都不需要。`
    )
    added = true
  }
  const type = properties.get('type')
  if (type) {
    addPoint(context, line, '按类型删除配方', `删除类型为 ${describeValue(type)} 的配方。`)
    context.actions.add('按类型删除配方')
    added = true
  }
  const input = properties.get('input')
  if (input) {
    addPoint(context, line, '按输入删除配方', `删除使用 ${describeValue(input)} 作为输入的配方。`)
    context.actions.add('按输入删除配方')
    added = true
  }
  if (!added) {
    addPoint(
      context,
      line,
      '删除配方',
      `按筛选字段 ${[...properties.keys()].join('、')} 删除配方。`
    )
    context.actions.add('删除配方')
  }
}

function explainRecipe(
  method: string,
  call: { callee: Ast; args: Ast[] },
  context: ExplainContext
): void {
  const line = lineOf(call.callee)
  const title = RECIPE_LABELS[method] ?? '添加配方'
  if (method === 'damageItem') {
    addPoint(
      context,
      line,
      title,
      `为 ${describeValue(call.args[0])} 设置耐久消耗 ${describeValue(call.args[1])}。`
    )
    return
  }
  const output = describeValue(call.args[0])
  let detail = ''
  if (method === 'shaped') {
    const pattern = call.args[1]
    const rows = pattern?.type === 'ArrayExpression' ? pattern.elements.length : 0
    const keys = objectProperties(call.args[2]).size
    detail = `产出 ${output}；图案 ${rows || '未知'} 行、${keys || '未知'} 种材料。`
  } else if (method === 'shapeless') {
    const inputs = call.args[1]
    const count = inputs?.type === 'ArrayExpression' ? inputs.elements.length : 0
    detail = `产出 ${output}；需要 ${count || '未知'} 个输入。`
  } else if (method === 'smithing') {
    detail = `产出 ${output}；模板 ${describeValue(call.args[1])}，底材 ${describeValue(
      call.args[2]
    )}，附加材料 ${describeValue(call.args[3])}。`
  } else {
    detail = `产出 ${output}；输入 ${describeValue(call.args[1])}。`
  }
  addPoint(context, line, title, detail)
  context.actions.add(title)
  if (!call.args[0]) {
    addWarning(context, `第 ${line ?? '?'} 行 ${method} 没有输出参数。`)
  }
}

function explainCustom(call: { callee: Ast; args: Ast[] }, context: ExplainContext): void {
  const line = lineOf(call.callee)
  const properties = objectProperties(call.args[0])
  const type = properties.get('type')
  const output = properties.get('result') ?? properties.get('output')
  const inputs = properties.get('ingredients') ?? properties.get('input')
  const parts = [
    type ? `类型 ${describeValue(type)}` : '没有显式 type',
    output ? `产出 ${describeValue(output)}` : '',
    inputs ? `输入 ${describeValue(inputs)}` : ''
  ].filter(Boolean)
  addPoint(context, line, '添加自定义配方', parts.join('；') + '。')
  context.actions.add('添加自定义配方')
  if (!type) {
    addWarning(context, `第 ${line ?? '?'} 行 event.custom() 没有 type，可能无法被 KubeJS 识别。`)
  }
}

function explainTagCall(
  method: string,
  call: { callee: Ast; args: Ast[] },
  context: ExplainContext
): void {
  const line = lineOf(call.callee)
  const tagRaw = stringValue(call.args[0])
  const tag = tagRaw ? tagText(tagRaw) : '标签'
  if (method === 'add') {
    addPoint(context, line, '添加标签成员', `把 ${describeValue(call.args[1])} 加入 ${tag}。`)
    context.actions.add('修改物品标签')
  } else if (method === 'remove') {
    addPoint(context, line, '移除标签成员', `从 ${tag} 移除 ${describeValue(call.args[1])}。`)
    context.actions.add('修改物品标签')
  } else if (method === 'removeAll') {
    addPoint(context, line, '清空标签', `清空 ${tag} 的全部成员。`)
    context.actions.add('清空标签')
  } else if (method === 'get') {
    addPoint(context, line, '读取标签', `读取 ${tag} 的标签集合。`)
  }
}

function explainRegistryCreate(
  call: { callee: Ast; args: Ast[] },
  spec: EventSpec,
  context: ExplainContext
): void {
  const line = lineOf(call.callee)
  const id = stringValue(call.args[0]) ?? describeValue(call.args[0])
  const label = registryLabel(spec.registryType)
  addPoint(
    context,
    line,
    `注册${label} ${id}`,
    `在 StartupEvents.registry('${spec.registryType ?? '未知'}') 中声明 ${id}；可继续用 displayName/tag 等构建器补充属性。`
  )
  context.actions.add(`注册${label}`)
}

function explainPlayerChain(
  chain: string[],
  call: { callee: Ast; args: Ast[] },
  context: ExplainContext
): void {
  const line = lineOf(call.callee)
  if (chain[1] === 'player') {
    if (chain[2] === 'give') {
      addPoint(
        context,
        line,
        '给予玩家物品',
        `给 event.player 发放 ${describeValue(call.args[0])}${call.args[1] ? `，数量 ${describeValue(call.args[1])}` : ''}。`
      )
      context.actions.add('给予玩家物品')
    } else if (chain[2] === 'tell' || chain[2] === 'sendMessage') {
      addPoint(context, line, '向玩家发送消息', `向 event.player 发送 ${describeValue(call.args[0])}。`)
    } else if (chain[2] === 'stages') {
      addPoint(context, line, '修改玩家阶段', `操作 event.player 的玩家阶段：${chain.join('.')}。`)
      context.actions.add('修改玩家阶段')
    } else if (chain[2] === 'runCommand' || chain[2] === 'runCommandSilent') {
      addPoint(context, line, '让玩家执行命令', `执行命令 ${describeValue(call.args[0])}。`)
    }
    return
  }
  if (chain[1] === 'server' && (chain[2] === 'runCommandSilent' || chain[2] === 'runCommand')) {
    addPoint(context, line, '执行服务端命令', `执行命令 ${describeValue(call.args[0])}。`)
    context.actions.add('执行服务端命令')
    return
  }
  if (chain[1] === 'cancel') {
    addPoint(context, line, '取消事件', '调用 event.cancel() 阻止这次事件的默认结果。')
    context.actions.add('取消事件')
  }
}

function explainModRecipe(
  chain: string[],
  call: { callee: Ast; args: Ast[] },
  context: ExplainContext
): void {
  const line = lineOf(call.callee)
  const path = `event.recipes.${chain.slice(2).join('.')}`
  addPoint(
    context,
    line,
    '添加模组配方',
    `${path}：产出 ${describeValue(call.args[0])}；输入 ${describeValue(call.args[1])}。`
  )
  context.actions.add('添加模组配方')
}

function explainEventCall(
  call: { callee: Ast; args: Ast[] },
  spec: EventSpec,
  context: ExplainContext
): void {
  if (spec.group === 'ServerEvents' && spec.event === 'tags') {
    const direct = memberInfo(call.callee)
    const inner = direct ? callInfo(direct.object) : null
    const innerCallee = inner ? memberInfo(inner.callee) : null
    if (
      direct?.property &&
      ['add', 'remove', 'removeAll'].includes(direct.property) &&
      inner &&
      innerCallee &&
      identifierName(innerCallee.object) === spec.param &&
      innerCallee.property === 'get'
    ) {
      explainTagCall(
        direct.property,
        { callee: call.callee, args: [inner.args[0], ...call.args] },
        context
      )
      return
    }
  }
  const chain = memberChain(call.callee)
  if (!chain || !spec.param || chain[0] !== spec.param) return
  const method = chain[1]
  if (!method) return

  if (spec.group === 'StartupEvents' && spec.event === 'registry') {
    if (method === 'create') explainRegistryCreate(call, spec, context)
    return
  }
  if (spec.group === 'ServerEvents' && spec.event === 'recipes') {
    if (method === 'remove') return explainRemove(call, context)
    if (RECIPE_LABELS[method]) return explainRecipe(method, call, context)
    if (method === 'custom') return explainCustom(call, context)
    if (method === 'recipes' && chain.length >= 3) {
      return explainModRecipe(chain, call, context)
    }
    if (method === 'replaceInput' || method === 'replaceOutput') {
      addPoint(
        context,
        lineOf(call.callee),
        method === 'replaceInput' ? '替换配方输入' : '替换配方输出',
        `${describeValue(call.args[0])} → ${describeValue(call.args[1])}。`
      )
      context.actions.add('替换配方原料')
    }
    return
  }
  if (spec.group === 'ServerEvents' && spec.event === 'tags') {
    if (method === 'get' && chain.length > 2) {
      const inner = callInfo(memberInfo(call.callee)?.object)
      const tag = inner ? stringValue(inner.args[0]) : null
      const action = chain[2]
      if (tag && (action === 'add' || action === 'remove' || action === 'removeAll')) {
        explainTagCall(action, { callee: call.callee, args: [inner?.args[0], ...call.args] }, context)
      }
      return
    }
    return explainTagCall(method, call, context)
  }
  if (spec.group === 'JEIEvents' || spec.group === 'REIEvents') {
    addPoint(
      context,
      lineOf(call.callee),
      '修改 JEI/REI 展示',
      `${chain.join('.')}：${describeValue(call.args[0])}。`
    )
    context.actions.add('修改 JEI/REI 展示')
    return
  }
  if (spec.event === 'tooltip' && method === 'add') {
    addPoint(
      context,
      lineOf(call.callee),
      '添加物品提示',
      `为 ${describeValue(call.args[0])} 添加提示 ${describeValue(call.args.slice(1))}。`
    )
    context.actions.add('添加物品提示')
    return
  }
  explainPlayerChain(chain, call, context)
}

function explainSpecialCalls(call: { callee: Ast; args: Ast[] }, context: ExplainContext): void {
  const chain = memberChain(call.callee)
  if (!chain) return
  const method = chain[chain.length - 1]
  const line = lineOf(call.callee)
  if (chain[0] === 'LootJS' || LOOT_METHODS.has(method)) {
    addPoint(
      context,
      line,
      method === 'modifiers' ? '配置战利品修改器' : '修改战利品表',
      method === 'modifiers'
        ? '注册 LootJS 战利品修改回调，具体战利品表在回调内修改。'
        : `${chain.join('.')}：${describeValue(call.args[0])}。`
    )
    context.actions.add('修改战利品表')
    return
  }
  if (chain[0] === 'console' && ['log', 'info', 'warn', 'error', 'debug'].includes(method)) {
    addPoint(context, line, '输出日志', `向日志输出 ${describeValue(call.args[0])}。`)
    return
  }
  if (chain[0] === 'Java' && method === 'loadClass') {
    addPoint(context, line, '加载 Java 类', `加载 ${describeValue(call.args[0])}，供脚本调用 Java API。`)
    context.actions.add('调用 Java 类')
  }
}

export function explainKubeJsAst(path: string, content: string): KubeJsExplainResult | null {
  let ast: Ast
  try {
    ast = parse(content, {
      sourceType: 'script',
      errorRecovery: true,
      allowAwaitOutsideFunction: true,
      attachComment: false
    })
  } catch {
    return null
  }
  if ((ast.errors?.length ?? 0) > 0) return null
  const index = indexTree(ast)
  const context: ExplainContext = {
    points: [],
    actions: new Set(),
    events: new Set(),
    warnings: new Set()
  }
  const specs = collectEventSpecs(index.nodes, context, path)
  for (const node of index.nodes) {
    const call = callInfo(node)
    if (!call) continue
    const spec = findSpec(node, index.parent, specs)
    if (spec) explainEventCall(call, spec, context)
    explainSpecialCalls(call, context)
  }
  if (/modid|recipe_id|example/i.test(content)) {
    addWarning(context, '脚本里还有 modid / recipe_id / example 之类的占位符，实际生效前需要替换。')
  }
  if (context.points.length > MAX_POINTS) {
    addWarning(context, `脚本片段较多，这里只展示前 ${MAX_POINTS} 条释意要点。`)
  }
  const points = context.points
    .sort((a, b) => (a.line ?? Number.MAX_SAFE_INTEGER) - (b.line ?? Number.MAX_SAFE_INTEGER))
    .slice(0, MAX_POINTS)
  const actions = [...context.actions].slice(0, 8)
  const events = [...context.events].slice(0, 6)
  const summary =
    actions.length > 0
      ? `这段脚本主要做：${actions.join('、')}${events.length > 0 ? `；涉及 ${events.join('、')}` : ''}。`
      : events.length > 0
        ? `这段脚本注册了 ${events.join('、')}，但没有识别到常见配方/标签操作。`
        : points.length > 0
          ? `这段脚本包含 ${points.length} 个可解释片段，但没有识别到常见配方/标签操作。`
          : '没有识别到常见 KubeJS 事件；可以检查它是否是辅助函数、配置或未完成的脚本。'
  return {
    summary,
    points,
    notes: [...context.warnings].join('\n'),
    model: null,
    source: 'local'
  }
}
