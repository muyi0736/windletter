import { parse } from '@babel/parser'
import type {
  InstanceSummary,
  KubeJsIssue,
  KubeJsIssueFix,
  KubeJsIssueSeverity,
  KubeJsIssueSource,
  KubeJsLintRequest,
  KubeJsLintResult,
  KubeJsProjectLintFile,
  KubeJsProjectLintRequest,
  KubeJsProjectLintResult
} from '../../shared/types'
import {
  GENERIC_OBJECT_METHODS,
  KUBEJS_EVENT_GROUP_NAMES,
  closestName,
  eventMethodsFor,
  findEventGroup
} from '../../shared/kubejsKnowledge'
import { getInstance } from './instances'
import {
  getKubeJsIndexLookup,
  getKubeJsIndexStatus,
  type KubeJsIndexLookup
} from './kubeJsIndex'
import { listKubeJsFiles, readKubeJsFile } from './packWorkshop'

type Ast = any

const MAX_ISSUES = 100
const MAX_PROJECT_FILES = 400
const MAX_PROJECT_FILE_BYTES = 2 * 1024 * 1024
const IGNORED_ITEM_IDS = new Set(['minecraft:air', 'minecraft:empty'])

const instanceCache = new Map<string, InstanceSummary>()
const indexProbes = new Map<string, Promise<void>>()

function scriptSide(path: string): 'server' | 'client' | 'startup' | null {
  const normalized = path.replace(/\\/g, '/').toLowerCase()
  if (normalized.startsWith('server_scripts/')) return 'server'
  if (normalized.startsWith('client_scripts/')) return 'client'
  if (normalized.startsWith('startup_scripts/')) return 'startup'
  return null
}

function isFunction(node: Ast): boolean {
  return (
    node?.type === 'FunctionDeclaration' ||
    node?.type === 'FunctionExpression' ||
    node?.type === 'ArrowFunctionExpression' ||
    node?.type === 'ObjectMethod' ||
    node?.type === 'ClassMethod' ||
    node?.type === 'ClassPrivateMethod'
  )
}

function patternNames(node: Ast, out: Set<string>): void {
  if (!node || typeof node !== 'object') return
  switch (node.type) {
    case 'Identifier':
      out.add(node.name)
      break
    case 'AssignmentPattern':
      patternNames(node.left, out)
      break
    case 'RestElement':
      patternNames(node.argument, out)
      break
    case 'ArrayPattern':
      for (const item of node.elements ?? []) patternNames(item, out)
      break
    case 'ObjectPattern':
      for (const property of node.properties ?? []) {
        if (property.type === 'RestElement') patternNames(property.argument, out)
        else patternNames(property.value, out)
      }
      break
    default:
      break
  }
}

function memberInfo(
  node: Ast
): { object: Ast; property: string | null; propertyNode: Ast | null } | null {
  if (!node) return null
  if (node.type !== 'MemberExpression' && node.type !== 'OptionalMemberExpression') return null
  const object = node.object
  const propertyNode = node.property
  let property: string | null = null
  if (!node.computed && propertyNode?.type === 'Identifier') property = propertyNode.name
  else if (propertyNode?.type === 'StringLiteral') property = propertyNode.value
  return { object, property, propertyNode }
}

function versionAtLeast(gameVersion: string, target: string): boolean {
  const parseVersion = (value: string): number[] =>
    value
      .split(/[.+-]/)
      .slice(0, 3)
      .map((part) => Number.parseInt(part, 10))
      .map((part) => (Number.isFinite(part) ? part : 0))
  const left = parseVersion(gameVersion)
  const right = parseVersion(target)
  for (let index = 0; index < 3; index += 1) {
    const a = left[index] ?? 0
    const b = right[index] ?? 0
    if (a !== b) return a > b
  }
  return true
}

function callInfo(node: Ast): { callee: Ast; args: Ast[] } | null {
  if (!node) return null
  if (node.type !== 'CallExpression' && node.type !== 'OptionalCallExpression') return null
  return { callee: node.callee, args: Array.isArray(node.arguments) ? node.arguments : [] }
}

function locOf(node: Ast): { line: number; column: number; endLine?: number; endColumn?: number } {
  const start = node?.loc?.start ?? { line: 1, column: 0 }
  const end = node?.loc?.end
  return {
    line: Math.max(1, start.line ?? 1),
    column: Math.max(1, (start.column ?? 0) + 1),
    endLine: end?.line,
    endColumn: typeof end?.column === 'number' ? end.column + 1 : undefined
  }
}

function stripBabelLocation(message: string): string {
  return message.replace(/\s*\(\d+:\d+\)\s*$/, '').trim()
}

class JsonFailure extends Error {
  index: number
  constructor(index: number, message: string) {
    super(message)
    this.index = index
  }
}

function scanJson(text: string): JsonFailure | null {
  const length = text.length
  let index = 0
  const fail = (message: string, at = index): never => {
    throw new JsonFailure(at, message)
  }
  const skipSpace = () => {
    while (index < length && /[ \t\n\r]/.test(text[index])) index += 1
  }
  const parseString = (): void => {
    if (text[index] !== '"') fail('字符串必须使用双引号')
    index += 1
    while (index < length) {
      const char = text[index]
      if (char === '"') {
        index += 1
        return
      }
      if (char === '\\') {
        index += 1
        const escape = text[index]
        if (escape === 'u') {
          index += 1
          for (let count = 0; count < 4; count += 1) {
            if (!/[0-9a-fA-F]/.test(text[index] ?? '')) fail('\\u 转义需要 4 位十六进制')
            index += 1
          }
        } else if ('"\\/bfnrt'.includes(escape ?? '')) {
          index += 1
        } else {
          fail('无效的字符串转义')
        }
        continue
      }
      if (char.charCodeAt(0) < 0x20) fail('字符串中包含未转义的控制字符')
      index += 1
    }
    fail('字符串缺少结束引号', length)
  }
  const parseNumber = (): void => {
    const start = index
    if (text[index] === '-') index += 1
    if (text[index] === '0') {
      index += 1
    } else if (/[1-9]/.test(text[index] ?? '')) {
      index += 1
      while (/[0-9]/.test(text[index] ?? '')) index += 1
    } else {
      fail('数字格式不正确', start)
    }
    if (text[index] === '.') {
      index += 1
      if (!/[0-9]/.test(text[index] ?? '')) fail('小数点后缺少数字')
      while (/[0-9]/.test(text[index] ?? '')) index += 1
    }
    if (/[eE]/.test(text[index] ?? '')) {
      index += 1
      if (/[+-]/.test(text[index] ?? '')) index += 1
      if (!/[0-9]/.test(text[index] ?? '')) fail('指数部分缺少数字')
      while (/[0-9]/.test(text[index] ?? '')) index += 1
    }
  }
  const parseLiteral = (word: string): void => {
    if (text.slice(index, index + word.length) !== word) {
      fail(`意外的字符「${text[index] ?? '文件结尾'}」`)
    }
    index += word.length
  }
  const parseValue = (): void => {
    skipSpace()
    if (index >= length) fail('文件过早结束', length)
    const char = text[index]
    if (char === '"') return parseString()
    if (char === '{') return parseObject()
    if (char === '[') return parseArray()
    if (char === '-' || /[0-9]/.test(char)) return parseNumber()
    if (char === 't') return parseLiteral('true')
    if (char === 'f') return parseLiteral('false')
    if (char === 'n') return parseLiteral('null')
    fail(`意外的字符「${char}」`)
  }
  const parseArray = (): void => {
    index += 1
    skipSpace()
    if (text[index] === ']') {
      index += 1
      return
    }
    while (true) {
      parseValue()
      skipSpace()
      if (text[index] === ']') {
        index += 1
        return
      }
      if (text[index] !== ',') fail(`数组元素之间需要逗号，或缺少 ']'`)
      index += 1
      skipSpace()
      if (text[index] === ']') fail('数组末尾不能有逗号')
    }
  }
  const parseObject = (): void => {
    index += 1
    skipSpace()
    if (text[index] === '}') {
      index += 1
      return
    }
    while (true) {
      if (text[index] !== '"') fail('对象的键必须使用双引号')
      parseString()
      skipSpace()
      if (text[index] !== ':') fail(`键后面需要 ':'`)
      index += 1
      parseValue()
      skipSpace()
      if (text[index] === '}') {
        index += 1
        return
      }
      if (text[index] !== ',') fail(`对象属性之间需要逗号，或缺少 '}'`)
      index += 1
      skipSpace()
      if (text[index] === '}') fail('对象末尾不能有逗号')
    }
  }
  try {
    parseValue()
    skipSpace()
    if (index < length) fail(`JSON 结束后还有多余内容「${text[index]}」`)
    return null
  } catch (error) {
    if (error instanceof JsonFailure) return error
    throw error
  }
}

function lintJson(content: string): KubeJsIssue[] {
  const failure = scanJson(content)
  if (!failure) return []
  const index = Math.max(0, Math.min(content.length, failure.index))
  const before = content.slice(0, index)
  const line = before.split('\n').length
  const lastBreak = before.lastIndexOf('\n')
  const column = index - lastBreak
  return [
    {
      severity: 'error',
      source: 'syntax',
      code: 'json',
      message: `JSON 格式错误：${failure.message}`,
      line,
      column: Math.max(1, column)
    }
  ]
}

class IssueCollector {
  private issues: KubeJsIssue[] = []
  private seen = new Set<string>()

  add(
    severity: KubeJsIssueSeverity,
    source: KubeJsIssueSource,
    code: string,
    message: string,
    node: Ast,
    fix?: KubeJsIssueFix
  ): void {
    if (this.issues.length >= MAX_ISSUES) return
    const loc = locOf(node)
    const key = `${severity}|${code}|${loc.line}|${loc.column}|${message}`
    if (this.seen.has(key)) return
    this.seen.add(key)
    this.issues.push({ severity, source, code, message, ...loc, ...(fix ? { fix } : {}) })
  }

  result(): KubeJsIssue[] {
    return this.issues.sort(
      (a, b) => a.line - b.line || a.column - b.column || a.severity.localeCompare(b.severity)
    )
  }
}

function parseScript(content: string): { ast: Ast | null; errors: KubeJsIssue[] } {
  const errors: KubeJsIssue[] = []
  try {
    const ast = parse(content, {
      sourceType: 'script',
      errorRecovery: true,
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: false,
      attachComment: false
    })
    for (const error of (ast.errors ?? []).slice(0, 10)) {
      const loc = error.loc ?? { line: 1, column: 0 }
      errors.push({
        severity: 'error',
        source: 'syntax',
        code: 'syntax',
        message: `语法错误：${stripBabelLocation(error.message)}`,
        line: Math.max(1, loc.line ?? 1),
        column: Math.max(1, (loc.column ?? 0) + 1)
      })
    }
    return { ast, errors }
  } catch (error) {
    const failure = error as Error & { loc?: { line?: number; column?: number } }
    errors.push({
      severity: 'error',
      source: 'syntax',
      code: 'syntax',
      message: `语法错误：${stripBabelLocation(failure.message || '无法解析脚本')}`,
      line: Math.max(1, failure.loc?.line ?? 1),
      column: Math.max(1, (failure.loc?.column ?? 0) + 1)
    })
    return { ast: null, errors }
  }
}

interface TreeIndex {
  parent: WeakMap<object, Ast>
  nodes: Ast[]
}

function indexTree(root: Ast): TreeIndex {
  const parent = new WeakMap<object, Ast>()
  const nodes: Ast[] = []
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
        key === 'leadingComments' ||
        key === 'trailingComments' ||
        key === 'innerComments'
      ) {
        continue
      }
      walk(node[key], node)
    }
  }
  walk(root, null)
  return { parent, nodes }
}

function nearestFunction(node: Ast, parent: WeakMap<object, Ast>): Ast | null {
  let current = parent.get(node)
  while (current) {
    if (isFunction(current)) return current
    current = parent.get(current)
  }
  return null
}

const scopeDeclCache = new WeakMap<object, Set<string>>()

/** 收集一个函数或整个脚本里（不含嵌套函数）的名字声明。 */
function scopeDeclarations(scope: Ast): Set<string> {
  const cached = scopeDeclCache.get(scope)
  if (cached) return cached
  const names = new Set<string>()
  if (isFunction(scope)) {
    for (const param of scope.params ?? []) patternNames(param, names)
  }
  const visit = (node: Ast): void => {
    if (!node) return
    if (Array.isArray(node)) {
      for (const child of node) visit(child)
      return
    }
    if (typeof node !== 'object' || typeof node.type !== 'string') return
    if (node !== scope && isFunction(node)) {
      if (node.type === 'FunctionDeclaration' && node.id?.name) names.add(node.id.name)
      return
    }
    if (node.type === 'VariableDeclarator') patternNames(node.id, names)
    else if (node.type === 'CatchClause' && node.param) patternNames(node.param, names)
    else if (node.type === 'ClassDeclaration' && node.id?.name) names.add(node.id.name)
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
      visit(node[key])
    }
  }
  if (isFunction(scope)) visit(scope.body)
  else visit(scope.body ?? scope.program?.body ?? [])
  scopeDeclCache.set(scope, names)
  return names
}

function isNameDefinedHere(
  node: Ast,
  name: string,
  parent: WeakMap<object, Ast>
): boolean {
  let current = parent.get(node)
  while (current) {
    if (current.type === 'Program' || isFunction(current)) {
      if (scopeDeclarations(current).has(name)) return true
    }
    current = parent.get(current)
  }
  return false
}

function identifierName(node: Ast): string | null {
  if (node?.type === 'Identifier') return node.name
  if (node?.type === 'StringLiteral') return node.value
  return null
}

function sideScriptPath(
  path: string,
  target: 'server' | 'client' | 'startup'
): string | null {
  const normalized = path.replace(/\\/g, '/')
  const match = normalized.match(/^(?:server|client|startup)_scripts\//i)
  if (!match) return null
  return `${target}_scripts/${normalized.slice(match[0].length)}`
}

function firstParamName(fn: Ast): string | null {
  const first = fn?.params?.[0]
  return first?.type === 'Identifier' ? first.name : null
}

function isLiteral(node: Ast): boolean {
  return node?.type === 'StringLiteral' || node?.type === 'TemplateLiteral' || node?.type === 'NumericLiteral'
}

function stringValue(node: Ast): string | null {
  if (node?.type === 'StringLiteral') return node.value
  if (node?.type === 'TemplateLiteral' && node.expressions?.length === 0) {
    return node.quasis?.[0]?.value?.cooked ?? null
  }
  return null
}

function normalizeItemId(raw: string): { id: string; tag: boolean } | null {
  let text = raw.trim()
  const countPrefix = /^\d+x\s+(.+)$/i.exec(text)
  if (countPrefix) text = countPrefix[1].trim()
  if (!text || text.length > 220 || /\s/.test(text) || /\$\{/.test(text)) return null
  const tag = text.startsWith('#')
  if (tag) text = text.slice(1)
  if (!/^[a-z0-9_.-]+:[a-z0-9_./-]+$/i.test(text)) return null
  return { id: text.toLowerCase(), tag }
}

function normalizeRecipeId(raw: string): string | null {
  const text = raw.trim()
  if (!text || text.length > 220 || /\s/.test(text) || /\$\{/.test(text)) return null
  if (!/^[a-z0-9_.-]+:[a-z0-9_./-]+$/i.test(text)) return null
  return text.toLowerCase()
}

function normalizeTagId(raw: string): string | null {
  let text = raw.trim()
  if (text.startsWith('#')) text = text.slice(1)
  if (!text || text.length > 220 || /\s/.test(text) || /\$\{/.test(text)) return null
  if (!/^[a-z0-9_.-]+:[a-z0-9_./-]+$/i.test(text)) return null
  return text.toLowerCase()
}

function normalizeNamespace(raw: string): string | null {
  const text = raw.trim().toLowerCase()
  if (!/^[a-z0-9_.-]+$/.test(text)) return null
  return text
}

interface ValidateContext {
  issues: IssueCollector
  lookup: KubeJsIndexLookup
  checkedItems: Set<string>
  checkedRecipes: Set<string>
  checkedTags: Set<string>
  checkedNamespaces: Set<string>
}

function validateItemNode(node: Ast, context: ValidateContext): void {
  const raw = stringValue(node)
  if (!raw) return
  const parsed = normalizeItemId(raw)
  if (!parsed) return
  if (parsed.tag) {
    validateTagId(parsed.id, node, context, raw)
    return
  }
  if (IGNORED_ITEM_IDS.has(parsed.id)) return
  const key = parsed.id
  if (context.checkedItems.has(key)) return
  context.checkedItems.add(key)
  if (context.lookup.items.has(parsed.id)) return
  const namespace = parsed.id.split(':')[0]
  const namespaceHint =
    parsed.id.startsWith('kubejs:')
      ? '；如果是启动脚本里新注册的物品，重建索引后再检查'
      : context.lookup.namespaces.has(namespace)
        ? ''
        : `（命名空间 ${namespace} 不在当前索引中）`
  context.issues.add(
    'warning',
    'item',
    'missing-item',
    `索引中未找到物品 ${parsed.id}${namespaceHint}`,
    node
  )
}

function validateRecipeId(raw: string, node: Ast, context: ValidateContext): void {
  const id = normalizeRecipeId(raw)
  if (!id) return
  const key = id
  if (context.checkedRecipes.has(key)) return
  context.checkedRecipes.add(key)
  if (context.lookup.recipes.has(id)) return
  context.issues.add(
    'warning',
    'recipe',
    'missing-recipe',
    `索引中未找到配方 ${id}；若由运行时脚本生成，可以忽略`,
    node
  )
}

function validateTagId(raw: string, node: Ast, context: ValidateContext, shown: string): void {
  const id = normalizeTagId(raw)
  if (!id) return
  const key = id
  if (context.checkedTags.has(key)) return
  context.checkedTags.add(key)
  if (context.lookup.tags.has(id)) return
  context.issues.add(
    'warning',
    'tag',
    'missing-tag',
    `索引中未找到标签 ${shown}；若由运行时脚本生成，可以忽略`,
    node
  )
}

function validateNamespace(raw: string, node: Ast, context: ValidateContext): void {
  const namespace = normalizeNamespace(raw)
  if (!namespace) return
  if (context.lookup.namespaces.has(namespace)) return
  if (context.checkedNamespaces.has(namespace)) return
  context.checkedNamespaces.add(namespace)
  context.issues.add(
    'warning',
    'item',
    'unknown-namespace',
    `未在实例索引中找到命名空间 ${namespace}`,
    node
  )
}

/** 只收集配方参数里的字符串/数组，不进入嵌套调用，避免和 Item.of 重复报错。 */
function validateStringsDeep(
  node: Ast,
  context: ValidateContext,
  options: { skipPattern?: boolean } = {}
): void {
  if (!node) return
  const raw = stringValue(node)
  if (raw !== null) {
    if (options.skipPattern && /^[A-Za-z ]+$/.test(raw.trim())) return
    validateItemNode(node, context)
    return
  }
  if (node.type === 'ArrayExpression') {
    for (const element of node.elements ?? []) {
      validateStringsDeep(element, context, options)
    }
    return
  }
  if (node.type === 'ObjectExpression') {
    for (const property of node.properties ?? []) {
      if (property.type !== 'ObjectProperty') continue
      validateStringsDeep(property.value, context, options)
    }
  }
}

function validateLooseValue(node: Ast, context: ValidateContext): void {
  if (!node) return
  if (node.type === 'ArrayExpression') {
    for (const element of node.elements ?? []) validateLooseValue(element, context)
    return
  }
  if (isLiteral(node)) validateItemNode(node, context)
}

interface CallbackSpec {
  group: string
  event: string
  methods: string[] | null
  param: string
  tagType: string | null
}

function eventCallSpecs(
  nodes: Ast[],
  parent: WeakMap<object, Ast>,
  path: string,
  gameVersion: string,
  issues: IssueCollector
): Map<Ast, CallbackSpec> {
  const specs = new Map<Ast, CallbackSpec>()
  const declared = new Set<string>()
  const unknownGroups = new Set<string>()
  for (const node of nodes) {
    if (node.type === 'VariableDeclarator') patternNames(node.id, declared)
    else if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
      for (const param of node.params ?? []) patternNames(param, declared)
      if (node.id?.name) declared.add(node.id.name)
    } else if (node.type === 'ClassDeclaration' && node.id?.name) {
      declared.add(node.id.name)
    } else if (node.type === 'CatchClause' && node.param) {
      patternNames(node.param, declared)
    }
  }
  const side = scriptSide(path)
  for (const node of nodes) {
    const call = callInfo(node)
    if (!call) {
      if (node.type === 'Identifier' && node.name === 'onEvent' && versionAtLeast(gameVersion, '1.19')) {
        issues.add(
          'warning',
          'api',
          'legacy-onevent',
          '这是 KubeJS 5 的 onEvent 写法；当前游戏版本请改用 ServerEvents / ClientEvents / StartupEvents',
          node
        )
      }
      continue
    }
    const callee = memberInfo(call.callee)
    if (!callee) continue
    const groupName = identifierName(callee.object)
    if (!groupName) continue
    const group = findEventGroup(groupName)
    if (!group) {
      if (
        /Events?$/.test(groupName) &&
        !declared.has(groupName) &&
        !unknownGroups.has(groupName) &&
        !KUBEJS_EVENT_GROUP_NAMES.includes(groupName)
      ) {
        unknownGroups.add(groupName)
        const suggestion = closestName(groupName, KUBEJS_EVENT_GROUP_NAMES, 1)
        const fix =
          suggestion && callee.object?.type === 'Identifier'
            ? {
                kind: 'replace' as const,
                title: `改为 ${suggestion}`,
                original: groupName,
                replacement: suggestion
              }
            : undefined
        issues.add(
          'warning',
          'event',
          'unknown-event-group',
          `未识别的事件组 ${groupName}${suggestion ? `，是否想写 ${suggestion}？` : ''}`,
          callee.object,
          fix
        )
      }
      continue
    }
    if (!callee.property) continue
    const eventName = callee.property
    const eventDef = group.events.find((entry) => entry.name === eventName)
    if (!eventDef) {
      const suggestion = closestName(eventName, group.events.map((entry) => entry.name))
      const fix =
        suggestion &&
        callee.propertyNode?.type === 'Identifier' &&
        callee.propertyNode.name === eventName
          ? {
              kind: 'replace' as const,
              title: `改为 ${suggestion}`,
              original: eventName,
              replacement: suggestion
            }
          : undefined
      issues.add(
        'warning',
        'event',
        'unknown-event',
        `${groupName} 没有常见事件 ${eventName}${suggestion ? `，是否想写 ${suggestion}？` : ''}`,
        callee.propertyNode ?? call.callee,
        fix
      )
      continue
    }
    if (side) {
      const targetSide: 'server' | 'client' | 'startup' =
        group.name === 'ServerEvents'
          ? 'server'
          : group.name === 'ClientEvents'
            ? 'client'
            : 'startup'
      const targetPath = sideScriptPath(path, targetSide)
      const sideFix =
        targetPath && targetSide !== side
          ? {
              kind: 'move-file' as const,
              title: `移动到 ${targetSide}_scripts`,
              targetPath
            }
          : undefined
      if (group.name === 'ServerEvents' && side !== 'server') {
        issues.add(
          'error',
          'side',
          'wrong-side',
          `ServerEvents 只能写在 server_scripts 中（当前在 ${side}_scripts）`,
          callee.object,
          sideFix
        )
      } else if (group.name === 'ClientEvents' && side !== 'client') {
        issues.add(
          'error',
          'side',
          'wrong-side',
          `ClientEvents 只能写在 client_scripts 中（当前在 ${side}_scripts）`,
          callee.object,
          sideFix
        )
      } else if (group.name === 'StartupEvents' && side !== 'startup') {
        issues.add(
          'error',
          'side',
          'wrong-side',
          `StartupEvents 只能写在 startup_scripts 中（当前在 ${side}_scripts）`,
          callee.object,
          sideFix
        )
      }
    }
    const callback = call.args.find((arg) => isFunction(arg))
    if (!callback) continue
    const param = firstParamName(callback)
    if (!param) continue
    specs.set(callback, {
      group: group.name,
      event: eventName,
      methods: eventMethodsFor(group.name, eventName),
      param,
      tagType:
        groupName === 'ServerEvents' && eventName === 'tags'
          ? (stringValue(call.args[0]) ?? '').trim().toLowerCase() || null
          : null
    })
  }
  return specs
}

function lintAst(
  ast: Ast,
  path: string,
  gameVersion: string,
  lookup: KubeJsIndexLookup | null,
  issues: IssueCollector
): void {
  const { parent, nodes } = indexTree(ast)
  const specs = eventCallSpecs(nodes, parent, path, gameVersion, issues)

  const declared = new Set<string>()
  for (const node of nodes) {
    if (node.type === 'VariableDeclarator') patternNames(node.id, declared)
    else if (isFunction(node)) {
      for (const param of node.params ?? []) patternNames(param, declared)
      if (node.id?.name) declared.add(node.id.name)
    } else if (node.type === 'ClassDeclaration' && node.id?.name) declared.add(node.id.name)
    else if (node.type === 'CatchClause' && node.param) patternNames(node.param, declared)
  }

  const validateContext: ValidateContext | null = lookup
    ? {
        issues,
        lookup,
        checkedItems: new Set(),
        checkedRecipes: new Set(),
        checkedTags: new Set(),
        checkedNamespaces: new Set()
      }
    : null

  for (const node of nodes) {
    if (
      node.type === 'Identifier' &&
      node.name === 'event' &&
      !isNameDefinedHere(node, 'event', parent)
    ) {
      const owner = parent.get(node)
      const member = owner && memberInfo(owner)
      if (member && member.object === node) {
        const fn = nearestFunction(node, parent)
        const param = fn ? firstParamName(fn) : null
        issues.add(
          'error',
          'event',
          'undefined-event',
          param
            ? `未定义的 event；这个回调的参数名是 ${param}，请统一命名`
            : '未定义的 event；请检查回调参数是否命名为 event',
          node,
          param
            ? {
                kind: 'replace',
                title: `改为 ${param}`,
                original: 'event',
                replacement: param
              }
            : undefined
        )
      }
    }

    const member = memberInfo(node)
    if (!member || !member.property) continue
    const objectName = identifierName(member.object)
    if (!objectName) continue
    let fn = nearestFunction(node, parent)
    let spec: CallbackSpec | null = null
    while (fn) {
      const found = specs.get(fn)
      if (found) {
        spec = found
        break
      }
      fn = nearestFunction(fn, parent)
    }
    if (!spec || objectName !== spec.param || !spec.methods) continue
    if (spec.methods.includes(member.property) || GENERIC_OBJECT_METHODS.has(member.property)) {
      continue
    }
    const suggestion = closestName(member.property, spec.methods)
    const fix =
      suggestion && member.propertyNode?.type === 'Identifier'
        ? {
            kind: 'replace' as const,
            title: `改为 ${suggestion}`,
            original: member.property,
            replacement: suggestion
          }
        : undefined
    issues.add(
      'warning',
      'event',
      'unknown-method',
      `${spec.group}.${spec.event} 的 event 没有方法 ${member.property}${suggestion ? `，是否想写 ${suggestion}？` : ''}`,
      node.property,
      fix
    )
  }

  if (!validateContext) return

  for (const node of nodes) {
    const call = callInfo(node)
    if (!call) continue
    const callee = memberInfo(call.callee)
    if (!callee || !callee.property) continue

    const objectName = identifierName(callee.object)
    if (objectName === 'Item' || objectName === 'Ingredient') {
      const method = callee.property
      if (method === 'of' || method === 'getItem') {
        validateLooseValue(call.args[0], validateContext)
      }
      continue
    }

    const specOwner = (() => {
      let fn = nearestFunction(node, parent)
      while (fn) {
        const found = specs.get(fn)
        if (found) return found
        fn = nearestFunction(fn, parent)
      }
      return null
    })()
    if (!specOwner) continue

    const method = callee.property
    if (specOwner.event === 'tags' && (method === 'add' || method === 'remove')) {
      const tagNode = call.args[0]
      const rawTag = stringValue(tagNode)
      const itemTag =
        !specOwner.tagType ||
        specOwner.tagType === 'item' ||
        specOwner.tagType === 'block'
      if (rawTag && itemTag) validateTagId(rawTag, tagNode, validateContext, rawTag)
      for (const arg of call.args.slice(1)) {
        validateLooseValue(arg, validateContext)
      }
      continue
    }
    if (specOwner.event !== 'recipes') continue

    if (method === 'remove') {
      const filter = call.args[0]
      if (!filter || filter.type !== 'ObjectExpression') continue
      for (const property of filter.properties ?? []) {
        if (property.type !== 'ObjectProperty' || property.computed) continue
        const key = identifierName(property.key)
        if (!key) continue
        if (key === 'id') {
          const values = property.value?.type === 'ArrayExpression' ? property.value.elements : [property.value]
          for (const value of values ?? []) {
            const raw = stringValue(value)
            if (raw) validateRecipeId(raw, value, validateContext)
          }
        } else if (key === 'output') {
          validateLooseValue(property.value, validateContext)
        } else if (key === 'mod') {
          const raw = stringValue(property.value)
          if (raw) validateNamespace(raw, property.value, validateContext)
        }
      }
      continue
    }

    if (method === 'custom') {
      const recipe = call.args[0]
      if (!recipe || recipe.type !== 'ObjectExpression') continue
      for (const property of recipe.properties ?? []) {
        if (property.type !== 'ObjectProperty' || property.computed) continue
        const key = identifierName(property.key)
        if (!key) continue
        if (
          key === 'result' ||
          key === 'output' ||
          key === 'ingredients' ||
          key === 'input' ||
          key === 'template' ||
          key === 'base' ||
          key === 'addition'
        ) {
          validateStringsDeep(property.value, validateContext)
        }
      }
      continue
    }

    if (
      method === 'shaped' ||
      method === 'shapeless' ||
      method === 'smelting' ||
      method === 'blasting' ||
      method === 'smoking' ||
      method === 'campfireCooking' ||
      method === 'stonecutting' ||
      method === 'smithing' ||
      method === 'damageItem'
    ) {
      validateLooseValue(call.args[0], validateContext)
      if (method === 'shaped') {
        const keys = call.args[2]
        if (keys?.type === 'ObjectExpression') {
          for (const property of keys.properties ?? []) {
            if (property.type !== 'ObjectProperty') continue
            validateStringsDeep(property.value, validateContext)
          }
        }
      } else {
        for (const arg of call.args.slice(1)) {
          validateStringsDeep(arg, validateContext)
        }
      }
    }
  }
}

function lintContent(
  path: string,
  content: string,
  gameVersion: string,
  lookup: KubeJsIndexLookup | null
): KubeJsIssue[] {
  const lower = path.toLowerCase()
  if (lower.endsWith('.json')) return lintJson(content)
  if (!lower.endsWith('.js')) return []
  const parsed = parseScript(content)
  const issues = new IssueCollector()
  for (const error of parsed.errors) {
    issues.add(error.severity, error.source, error.code, error.message, {
      loc: {
        start: { line: error.line, column: (error.column ?? 1) - 1 },
        end: {
          line: error.endLine ?? error.line,
          column: (error.endColumn ?? error.column ?? 1) - 1
        }
      }
    })
  }
  if (parsed.ast) {
    lintAst(parsed.ast, path, gameVersion, lookup, issues)
  }
  return issues.result()
}

async function loadInstance(instanceId: string): Promise<InstanceSummary> {
  const cached = instanceCache.get(instanceId)
  if (cached) return cached
  const instance = await getInstance(instanceId)
  instanceCache.set(instanceId, instance)
  return instance
}

function warmIndex(instanceId: string): Promise<void> {
  let probe = indexProbes.get(instanceId)
  if (!probe) {
    probe = getKubeJsIndexStatus(instanceId)
      .then(() => undefined)
      .catch(() => undefined)
    indexProbes.set(instanceId, probe)
  }
  return probe
}

function requireInstanceId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('实例 ID 无效')
  return value.trim()
}

export async function lintKubeJsFile(raw: unknown): Promise<KubeJsLintResult> {
  const request = (raw ?? {}) as Partial<KubeJsLintRequest>
  const instanceId = requireInstanceId(request.instanceId)
  if (typeof request.path !== 'string' || !request.path.trim()) throw new Error('脚本路径无效')
  if (typeof request.content !== 'string') throw new Error('脚本内容无效')
  if (request.content.length > MAX_PROJECT_FILE_BYTES) {
    return {
      path: request.path,
      issues: [
        {
          severity: 'warning',
          source: 'api',
          code: 'too-large',
          message: '文件超过 2 MB，已跳过静态预检',
          line: 1,
          column: 1
        }
      ],
      indexReady: Boolean(getKubeJsIndexLookup(instanceId)),
      durationMs: 0,
      checkedAt: Date.now()
    }
  }
  const started = Date.now()
  const instance = await loadInstance(instanceId)
  const lookup = getKubeJsIndexLookup(instanceId)
  if (!lookup) void warmIndex(instanceId)
  const issues = lintContent(
    request.path,
    request.content,
    instance.gameVersion,
    lookup
  )
  return {
    path: request.path,
    issues,
    indexReady: Boolean(lookup),
    durationMs: Date.now() - started,
    checkedAt: Date.now()
  }
}

export async function lintKubeJsProject(raw: unknown): Promise<KubeJsProjectLintResult> {
  const request = (raw ?? {}) as Partial<KubeJsProjectLintRequest>
  const instanceId = requireInstanceId(request.instanceId)
  const started = Date.now()
  const instance = await loadInstance(instanceId)
  await warmIndex(instanceId)
  const lookup = getKubeJsIndexLookup(instanceId)
  const listing = await listKubeJsFiles(instanceId)
  const overrides = new Map<string, string>()
  for (const entry of request.overrides ?? []) {
    if (typeof entry?.path !== 'string' || typeof entry.content !== 'string') continue
    if (!/\.(?:js|json)$/i.test(entry.path)) continue
    if (entry.content.length > MAX_PROJECT_FILE_BYTES) continue
    overrides.set(entry.path.replace(/\\/g, '/'), entry.content)
  }
  const targets = new Set<string>()
  let skippedFiles = 0
  for (const file of listing.files) {
    if (!/\.(?:js|json)$/i.test(file.path)) continue
    if (file.size <= MAX_PROJECT_FILE_BYTES) targets.add(file.path)
    else skippedFiles += 1
  }
  for (const path of overrides.keys()) targets.add(path)

  const files: KubeJsProjectLintFile[] = []
  let scannedFiles = 0
  let errorCount = 0
  let warningCount = 0

  for (const path of [...targets].sort((a, b) => a.localeCompare(b, 'zh-CN'))) {
    if (scannedFiles >= MAX_PROJECT_FILES) {
      skippedFiles += 1
      continue
    }
    let content = overrides.get(path)
    if (content === undefined) {
      try {
        content = (await readKubeJsFile(instanceId, path)).content
      } catch {
        skippedFiles += 1
        continue
      }
    }
    scannedFiles += 1
    const issues = lintContent(path, content, instance.gameVersion, lookup)
    if (issues.length === 0) continue
    const errors = issues.filter((issue) => issue.severity === 'error').length
    const warnings = issues.filter((issue) => issue.severity === 'warning').length
    errorCount += errors
    warningCount += warnings
    files.push({ path, issues, errorCount: errors, warningCount: warnings })
  }

  return {
    instanceId,
    files,
    scannedFiles,
    cleanFiles: Math.max(0, scannedFiles - files.length),
    skippedFiles,
    errorCount,
    warningCount,
    indexReady: Boolean(lookup),
    durationMs: Date.now() - started,
    generatedAt: Date.now()
  }
}
