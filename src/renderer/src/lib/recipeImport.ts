export type RecipeImportKind =
  | 'shaped'
  | 'shapeless'
  | 'smelting'
  | 'blasting'
  | 'smoking'
  | 'campfireCooking'
  | 'stonecutting'
  | 'smithing'
  | 'large_shaped'
  | 'custom_visual'
  | 'custom_json'

export interface RecipeDraft {
  kind: RecipeImportKind
  outputId: string
  outputCount: number
  cells: string[]
  inputs: string[]
  smithing: string[]
  largeSize: number
  largeType: string
  largeCells: string[]
  largeExtras: string
  visualType: string
  visualInputField: string
  visualInputArray: boolean
  visualInputs: { id: string; count: number }[]
  visualOutputField: string
  visualOutputArray: boolean
  visualOutputs: { id: string; count: number }[]
  visualExtras: string
  customJson: string
}

export interface RecipeImportPlan {
  draft: RecipeDraft
  modeLabel: string
  notes: string[]
  fallback: boolean
}

const ID_PATTERN = /^#?[a-z0-9_.-]+:[a-z0-9_./-]+$/i
const TYPE_PATTERN = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/i
const MAX_EXTRAS_CHARS = 20000

interface Stack {
  id: string
  count: number
  tag: boolean
  clean: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readCount(value: unknown): number | null {
  if (value === undefined) return 1
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 64) {
    return null
  }
  return value
}

interface StackOptions {
  allowTag: boolean
  allowIdKey: boolean
}

function readStack(value: unknown, options: StackOptions): Stack | null {
  if (typeof value === 'string') {
    const id = value.trim()
    if (!ID_PATTERN.test(id)) return null
    const tag = id.startsWith('#')
    if (tag && !options.allowTag) return null
    return { id, count: 1, tag, clean: true }
  }
  if (!isRecord(value)) return null
  const keys = Object.keys(value)
  if (keys.some((key) => !['item', 'id', 'tag', 'count'].includes(key))) return null
  if (typeof value.tag === 'string' && typeof value.item === 'string') return null
  if (typeof value.tag === 'string') {
    if (!options.allowTag) return null
    const tag = value.tag.trim().replace(/^#/, '')
    if (!ID_PATTERN.test(tag)) return null
    const count = readCount(value.count)
    if (count === null) return null
    return { id: `#${tag}`, count, tag: true, clean: true }
  }
  const rawId =
    typeof value.item === 'string'
      ? value.item
      : typeof value.id === 'string' && options.allowIdKey
        ? value.id
        : null
  if (!rawId) return null
  const id = rawId.trim()
  if (!ID_PATTERN.test(id) || id.startsWith('#')) return null
  const count = readCount(value.count)
  if (count === null) return null
  return { id, count, tag: false, clean: true }
}

function readSingle(value: unknown, options: StackOptions): Stack | null {
  if (Array.isArray(value)) {
    if (value.length !== 1) return null
    return readSingle(value[0], options)
  }
  return readStack(value, options)
}

function readList(
  value: unknown,
  options: StackOptions,
  max: number
): { stacks: Stack[]; array: boolean } | null {
  if (Array.isArray(value)) {
    if (value.length === 0 || value.length > max) return null
    const stacks: Stack[] = []
    for (const entry of value) {
      if (Array.isArray(entry)) return null
      const stack = readStack(entry, options)
      if (!stack) return null
      stacks.push(stack)
    }
    return { stacks, array: true }
  }
  const stack = readStack(value, options)
  return stack ? { stacks: [stack], array: false } : null
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function extrasFor(
  raw: Record<string, unknown>,
  exclude: Set<string>
): { text: string; keys: string[] } | null {
  const extras: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (exclude.has(key)) continue
    extras[key] = value
  }
  const keys = Object.keys(extras)
  if (keys.length === 0) return { text: '', keys }
  const text = pretty(extras)
  if (text.length > MAX_EXTRAS_CHARS) return null
  return { text, keys }
}

function emptyDraft(): RecipeDraft {
  return {
    kind: 'shaped',
    outputId: '',
    outputCount: 1,
    cells: Array(9).fill(''),
    inputs: [''],
    smithing: ['', '', ''],
    largeSize: 5,
    largeType: 'extendedcrafting:shaped_table',
    largeCells: Array(25).fill(''),
    largeExtras: '',
    visualType: 'modid:machine_recipe',
    visualInputField: 'ingredients',
    visualInputArray: true,
    visualInputs: [{ id: '', count: 1 }],
    visualOutputField: 'result',
    visualOutputArray: false,
    visualOutputs: [{ id: '', count: 1 }],
    visualExtras: '{\n  "energy": 1000\n}',
    customJson: ''
  }
}

function fallbackPlan(
  raw: Record<string, unknown>,
  modeLabel: string,
  notes: string[]
): RecipeImportPlan {
  const text = pretty(raw)
  if (text.length > MAX_EXTRAS_CHARS) {
    throw new Error('配方 JSON 超过 20000 字符，无法放入生成器')
  }
  return {
    draft: { ...emptyDraft(), kind: 'custom_json', customJson: text },
    modeLabel,
    notes,
    fallback: true
  }
}

interface PatternShape {
  rows: number
  cols: number
  cells: string[]
  keysUsed: number
}

function readPattern(
  raw: Record<string, unknown>,
  options: { allowIdKey: boolean }
): PatternShape | null {
  const pattern = raw.pattern
  const key = raw.key
  if (!Array.isArray(pattern) || !isRecord(key)) return null
  if (pattern.length === 0 || pattern.length > 9) return null
  let cols = 0
  for (const row of pattern) {
    if (typeof row !== 'string' || row.length > 9) return null
    cols = Math.max(cols, row.length)
  }
  if (cols === 0) return null
  const cells = Array(pattern.length * cols).fill('') as string[]
  const seen = new Set<string>()
  for (let row = 0; row < pattern.length; row += 1) {
    const line = pattern[row] as string
    for (let col = 0; col < line.length; col += 1) {
      const symbol = line[col]
      if (symbol === ' ') continue
      if (!/^[A-Za-z]$/.test(symbol)) return null
      if (!(symbol in key)) return null
      const stack = readSingle(key[symbol], {
        allowTag: true,
        allowIdKey: options.allowIdKey
      })
      if (!stack || stack.count !== 1) return null
      seen.add(symbol)
      cells[row * cols + col] = stack.id
    }
  }
  if (seen.size === 0) return null
  return { rows: pattern.length, cols, cells, keysUsed: seen.size }
}

function typeName(type: string): { namespace: string; path: string } {
  const clean = type.trim()
  const index = clean.indexOf(':')
  if (index < 0) return { namespace: 'minecraft', path: clean }
  return { namespace: clean.slice(0, index), path: clean.slice(index + 1) }
}

function ignoredNote(raw: Record<string, unknown>, used: string[]): string[] {
  const keys = Object.keys(raw).filter((key) => !used.includes(key))
  if (keys.length === 0) return []
  const shown = keys.slice(0, 6).join('、')
  return [`未保留字段：${shown}${keys.length > 6 ? ' 等' : ''}`]
}

const BASIC_OUTPUT = { allowTag: false, allowIdKey: true }
const BASIC_INPUT = { allowTag: true, allowIdKey: false }
const CUSTOM_INPUT = { allowTag: true, allowIdKey: false }
const CUSTOM_OUTPUT = { allowTag: false, allowIdKey: false }

function basicResult(
  raw: Record<string, unknown>,
  stack: Stack | null
): { outputId: string; outputCount: number } | null {
  if (!stack || stack.tag) return null
  const count =
    typeof raw.count === 'number' && Number.isInteger(raw.count) && raw.count >= 1 && raw.count <= 64
      ? raw.count
      : stack.count
  return { outputId: stack.id, outputCount: count }
}

function mapBasicCooking(
  type: string,
  raw: Record<string, unknown>
): RecipeImportPlan | null {
  const { namespace, path } = typeName(type)
  if (namespace !== 'minecraft' && namespace !== '') return null
  const kindMap: Record<string, RecipeImportKind> = {
    smelting: 'smelting',
    blasting: 'blasting',
    smoking: 'smoking',
    campfire_cooking: 'campfireCooking',
    stonecutting: 'stonecutting'
  }
  const kind = kindMap[path]
  if (!kind) return null
  const input = readSingle(raw.ingredient, BASIC_INPUT)
  const output = readSingle(raw.result, BASIC_OUTPUT)
  if (!input || !output || output.tag) return null
  const result = basicResult(raw, output)
  if (!result) return null
  const labels: Record<string, string> = {
    smelting: '熔炉',
    blasting: '高炉',
    smoking: '烟熏炉',
    campfireCooking: '营火',
    stonecutting: '切石机'
  }
  return {
    draft: {
      ...emptyDraft(),
      kind,
      outputId: result.outputId,
      outputCount: result.outputCount,
      inputs: [input.id]
    },
    modeLabel: labels[kind] ?? kind,
    notes: ignoredNote(raw, ['type', 'ingredient', 'result', 'count']),
    fallback: false
  }
}

function mapBasicSmithing(
  type: string,
  raw: Record<string, unknown>
): RecipeImportPlan | null {
  const { namespace, path } = typeName(type)
  if (namespace !== 'minecraft' && namespace !== '') return null
  if (path !== 'smithing_transform') return null
  const template = readSingle(raw.template, BASIC_INPUT)
  const base = readSingle(raw.base, BASIC_INPUT)
  const addition = readSingle(raw.addition, BASIC_INPUT)
  const output = readSingle(raw.result, BASIC_OUTPUT)
  if (!template || !base || !addition || !output || output.tag) return null
  const result = basicResult(raw, output)
  if (!result) return null
  return {
    draft: {
      ...emptyDraft(),
      kind: 'smithing',
      outputId: result.outputId,
      outputCount: result.outputCount,
      smithing: [template.id, base.id, addition.id]
    },
    modeLabel: '锻造台',
    notes: ignoredNote(raw, ['type', 'template', 'base', 'addition', 'result']),
    fallback: false
  }
}

function mapVanilla(
  type: string,
  raw: Record<string, unknown>
): RecipeImportPlan | null {
  const { namespace, path } = typeName(type)
  if (namespace !== 'minecraft' && namespace !== '') return null
  const output = readSingle(raw.result, BASIC_OUTPUT)
  if (!output || output.tag) {
    return path === 'crafting_shaped' || path === 'crafting_shapeless'
      ? fallbackPlan(raw, '自定义 JSON', ['产物无法解析为物品'])
      : null
  }
  const result = basicResult(raw, output)
  if (!result) return null

  if (path === 'crafting_shaped') {
    const shape = readPattern(raw, { allowIdKey: false })
    if (!shape) {
      return fallbackPlan(raw, '自定义 JSON', ['pattern/key 中的材料不是可编辑的单一物品或标签'])
    }
    if (shape.rows > 3 || shape.cols > 3) {
      return fallbackPlan(raw, '自定义 JSON', [
        `原版有序合成最大 3×3，这个 pattern 是 ${shape.rows} 行 × ${shape.cols} 列`
      ])
    }
    const cells = Array(9).fill('') as string[]
    for (let row = 0; row < shape.rows; row += 1) {
      for (let col = 0; col < shape.cols; col += 1) {
        cells[row * 3 + col] = shape.cells[row * shape.cols + col]
      }
    }
    return {
      draft: {
        ...emptyDraft(),
        kind: 'shaped',
        outputId: result.outputId,
        outputCount: result.outputCount,
        cells
      },
      modeLabel: '3×3 有序合成',
      notes: ignoredNote(raw, ['type', 'pattern', 'key', 'result']),
      fallback: false
    }
  }

  if (path === 'crafting_shapeless') {
    const list = readList(raw.ingredients, BASIC_INPUT, 9)
    if (!list || list.stacks.some((stack) => stack.count !== 1)) {
      return fallbackPlan(raw, '自定义 JSON', [
        '无序材料包含多选、嵌套或数量，无法用单一材料槽表达'
      ])
    }
    return {
      draft: {
        ...emptyDraft(),
        kind: 'shapeless',
        outputId: result.outputId,
        outputCount: result.outputCount,
        inputs: list.stacks.map((stack) => stack.id)
      },
      modeLabel: '无序合成',
      notes: ignoredNote(raw, ['type', 'ingredients', 'result']),
      fallback: false
    }
  }

  return null
}

function mapCustomPattern(
  type: string,
  raw: Record<string, unknown>
): RecipeImportPlan | null {
  const { namespace, path } = typeName(type)
  if (!path || !TYPE_PATTERN.test(type)) return null
  const resultKeys = ['result', 'output'].filter((key) => key in raw)
  if (resultKeys.length !== 1) return null
  const resultKey = resultKeys[0]
  const output = readSingle(raw[resultKey], CUSTOM_OUTPUT)
  if (!output || output.tag) return null
  const shape = readPattern(raw, { allowIdKey: false })
  if (!shape) return null
  const size = Math.max(shape.rows, shape.cols, 4)
  if (size > 9) {
    return fallbackPlan(raw, '自定义 JSON', [
      `pattern 为 ${shape.rows}×${shape.cols}，超过 9×9 网格`
    ])
  }
  const cells = Array(size * size).fill('') as string[]
  for (let row = 0; row < shape.rows; row += 1) {
    for (let col = 0; col < shape.cols; col += 1) {
      cells[row * size + col] = shape.cells[row * shape.cols + col]
    }
  }
  const exclude = new Set(['type', 'pattern', 'key', resultKey])
  const extras = extrasFor(raw, exclude)
  if (!extras) return fallbackPlan(raw, '自定义 JSON', ['附加字段超过 20000 字符'])
  const notes = [
    `配方 type：${type}`,
    ...(shape.rows < size || shape.cols < size
      ? [
          `原 pattern 为 ${shape.rows} 行 × ${shape.cols} 列，已按 ${size}×${size} 最小网格补齐空位`
        ]
      : [])
  ]
  if (extras.keys.length > 0) notes.push(`附加字段已保留：${extras.keys.join('、')}`)
  return {
    draft: {
      ...emptyDraft(),
      kind: 'large_shaped',
      outputId: output.id,
      outputCount: output.count,
      largeSize: size,
      largeType: type,
      largeCells: cells,
      largeExtras: extras.text
    },
    modeLabel: `大网格 ${size}×${size}`,
    notes,
    fallback: false
  }
}

export const VISUAL_INPUT_FIELDS = ['ingredients', 'inputs', 'ingredient', 'input', 'cast']
export const VISUAL_OUTPUT_FIELDS = ['result', 'output', 'results', 'outputs', 'mainOutput']

function mapVisual(
  type: string,
  raw: Record<string, unknown>
): RecipeImportPlan | null {
  if (!TYPE_PATTERN.test(type)) return null
  if ('pattern' in raw || 'key' in raw) return null
  if ('count' in raw) return null
  const inputField = VISUAL_INPUT_FIELDS.find((field) => field in raw)
  const outputField = VISUAL_OUTPUT_FIELDS.find((field) => field in raw)
  if (!inputField || !outputField || inputField === outputField) return null
  const inputs = readList(raw[inputField], CUSTOM_INPUT, 12)
  if (!inputs) return null
  const outputs = readList(raw[outputField], CUSTOM_OUTPUT, 6)
  if (!outputs) return null
  const exclude = new Set(['type', inputField, outputField])
  const extras = extrasFor(raw, exclude)
  if (!extras) return null
  const notes = [
    `配方 type：${type}`,
    `输入字段 ${inputField}，产物字段 ${outputField}`
  ]
  if (inputs.stacks.some((stack) => stack.count > 1)) {
    notes.push('输入数量已写入 count')
  }
  if (extras.keys.length > 0) {
    notes.push(`其余字段放入附加 JSON：${extras.keys.slice(0, 6).join('、')}${extras.keys.length > 6 ? ' 等' : ''}`)
  }
  const altar = /ritual|altar|infusion|ceremony|offering|sacrifice/i.test(type)
  return {
    draft: {
      ...emptyDraft(),
      kind: 'custom_visual',
      visualType: type,
      visualInputField: inputField,
      visualInputArray: inputs.array,
      visualInputs: inputs.stacks.map((stack) => ({ id: stack.id, count: stack.count })),
      visualOutputField: outputField,
      visualOutputArray: outputs.array,
      visualOutputs: outputs.stacks.map((stack) => ({ id: stack.id, count: stack.count })),
      visualExtras: extras.text
    },
    modeLabel: altar ? '祭坛 / 仪式可视化' : '机器配方可视化',
    notes,
    fallback: false
  }
}

/**
 * 把索引里读出的原始配方 JSON 尽量映射成配方生成器的可视化状态。
 * 无法完整表达的结构会原样放进自定义 JSON，绝不静默丢弃字段。
 */
export function mapImportedRecipe(
  rawValue: Record<string, unknown>,
  fallbackType: string
): RecipeImportPlan {
  const raw = rawValue
  const type =
    typeof raw.type === 'string' && raw.type.trim() ? raw.type.trim() : fallbackType.trim()
  if (!type) return fallbackPlan(raw, '自定义 JSON', ['配方缺少 type'])

  const cooking = mapBasicCooking(type, raw)
  if (cooking) return cooking
  const smithing = mapBasicSmithing(type, raw)
  if (smithing) return smithing
  const vanilla = mapVanilla(type, raw)
  if (vanilla) return vanilla

  const customPattern = mapCustomPattern(type, raw)
  if (customPattern) return customPattern

  const visual = mapVisual(type, raw)
  if (visual) return visual

  return fallbackPlan(raw, '自定义 JSON', [
    `type ${type} 的输入/产物结构不在可视化支持范围内，已原样保留 JSON`
  ])
}
