import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Download,
  Hash,
  Plus,
  Search,
  Trash2,
  Wrench,
  X
} from 'lucide-react'
import type {
  InstanceSummary,
  KubeJsIndexItem,
  KubeJsIndexRecipe,
  KubeJsIndexStatus,
  KubeJsIndexTag,
  KubeJsRecipeDetail
} from '@shared/types'
import { cleanError } from '../lib/format'
import {
  mapImportedRecipe,
  VISUAL_INPUT_FIELDS,
  VISUAL_OUTPUT_FIELDS,
  type RecipeDraft,
  type RecipeImportPlan
} from '../lib/recipeImport'
import { Spinner } from './ui'

type RecipeKind =
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

type BasicRecipeKind = Exclude<
  RecipeKind,
  'large_shaped' | 'custom_visual' | 'custom_json'
>

interface PickerTarget {
  kind:
    | 'output'
    | 'cell'
    | 'largeCell'
    | 'input'
    | 'smithing'
    | 'visualInput'
    | 'visualOutput'
  index?: number
}

interface PickerResult {
  id: string
  name: string
  modId: string
  tag: boolean
  detail: string
}

const RECIPE_TYPES: { id: RecipeKind; label: string; hint: string }[] = [
  { id: 'shaped', label: '有序合成', hint: '3×3 图案，同一种材料会复用同一个字母键。' },
  { id: 'shapeless', label: '无序合成', hint: '材料顺序无关，重复材料会按重复次数写入。' },
  { id: 'smelting', label: '熔炉', hint: '产出 + 一个输入。' },
  { id: 'blasting', label: '高炉', hint: '产出 + 一个输入。' },
  { id: 'smoking', label: '烟熏炉', hint: '产出 + 一个输入。' },
  { id: 'campfireCooking', label: '营火', hint: '产出 + 一个输入。' },
  { id: 'stonecutting', label: '切石机', hint: '产出 + 一个输入。' },
  { id: 'smithing', label: '锻造台', hint: '产出 + 模板、底材、附加材料。' },
  {
    id: 'large_shaped',
    label: '大网格（4×4–9×9）',
    hint: '生成 event.custom 的 pattern/key/result JSON，适合扩展工作台、大型有序合成；不同模组可再补 tier 等字段。'
  },
  {
    id: 'custom_visual',
    label: '机器 / 祭坛（可视化）',
    hint: '用材料槽和产物槽拼出常见机器/祭坛配方；字段名可切换，额外参数写在附加 JSON 里。'
  },
  {
    id: 'custom_json',
    label: '自定义 JSON（高级）',
    hint: '直接生成 event.custom({...})，用来覆盖任意科技机器、魔法仪式 schema；字段按模组文档填写。'
  }
]

const COOKING_KINDS = new Set<RecipeKind>([
  'smelting',
  'blasting',
  'smoking',
  'campfireCooking',
  'stonecutting'
])

const LARGE_SIZES = [4, 5, 6, 7, 8, 9]
const ID_PATTERN = /^#?[a-z0-9_.-]+:[a-z0-9_./-]+$/i
const TYPE_PATTERN = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/i

const DEFAULT_CUSTOM_JSON = `{
  "type": "modid:recipe_type",
  "ingredients": [
    { "item": "minecraft:iron_ingot" }
  ],
  "result": { "item": "minecraft:iron_block", "count": 1 }
}`

const MACHINE_TEMPLATE = `{
  "type": "modid:machine_recipe",
  "ingredients": [
    { "item": "minecraft:iron_ingot" },
    { "tag": "forge:ingots/copper" }
  ],
  "result": { "item": "minecraft:iron_block", "count": 1 },
  "energy": 1000
}`

const MAGIC_TEMPLATE = `{
  "type": "modid:ritual",
  "ingredients": [
    { "item": "minecraft:gold_ingot" },
    { "item": "minecraft:amethyst_shard" }
  ],
  "output": { "item": "minecraft:enchanted_golden_apple", "count": 1 },
  "mana": 5000
}`

const VISUAL_PROFILES: {
  id: 'machine' | 'altar'
  label: string
  type: string
  inputField: string
  outputField: string
  extras: string
}[] = [
  {
    id: 'machine',
    label: '机器',
    type: 'modid:machine_recipe',
    inputField: 'ingredients',
    outputField: 'result',
    extras: '{\n  "energy": 1000\n}'
  },
  {
    id: 'altar',
    label: '祭坛 / 仪式',
    type: 'modid:ritual',
    inputField: 'ingredients',
    outputField: 'output',
    extras: '{\n  "mana": 5000\n}'
  }
]

function versionAtLeast(value: string, target: string): boolean {
  const parse = (input: string): number[] =>
    input
      .split(/[.+-]/)
      .slice(0, 3)
      .map((part) => Number.parseInt(part, 10))
      .map((part) => (Number.isFinite(part) ? part : 0))
  const left = parse(value)
  const right = parse(target)
  for (let index = 0; index < 3; index += 1) {
    const a = left[index] ?? 0
    const b = right[index] ?? 0
    if (a !== b) return a > b
  }
  return true
}

function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

function shortValue(value: string): string {
  const clean = value.replace(/^#/, '')
  const path = clean.includes(':') ? clean.slice(clean.indexOf(':') + 1) : clean
  const short = path.length > 16 ? `${path.slice(0, 14)}…` : path
  return value.startsWith('#') ? `#${short}` : short
}

function initial(value: string): string {
  const clean = value.replace(/^#/, '')
  const path = clean.includes(':') ? clean.slice(clean.indexOf(':') + 1) : clean
  return path ? path[0].toUpperCase() : '?'
}

function isLikelyId(value: string): boolean {
  return ID_PATTERN.test(value.trim())
}

const recipeIconCache = new Map<string, string | null>()

function keyMapFor(values: string[]): Map<string, string> {
  const keys = new Map<string, string>()
  for (const value of values) {
    if (!value || keys.has(value) || keys.size >= 26) continue
    keys.set(value, String.fromCharCode(65 + keys.size))
  }
  return keys
}

function RecipeTile({
  value,
  icons,
  compact = false
}: {
  value: string
  icons: Record<string, string | null>
  compact?: boolean
}) {
  if (value.startsWith('#')) {
    return (
      <span className={`kjs-recipe-icon is-tag ${compact ? 'is-compact' : ''}`}>#</span>
    )
  }
  const icon = icons[value]
  if (icon) {
    return (
      <img
        className={`kjs-recipe-icon ${compact ? 'is-compact' : ''}`}
        src={icon}
        alt=""
        draggable={false}
      />
    )
  }
  return (
    <span className={`kjs-recipe-icon is-fallback ${compact ? 'is-compact' : ''}`}>
      {initial(value)}
    </span>
  )
}

function customObjectCode(value: unknown): string {
  const json = JSON.stringify(value, null, 2)
  const indented = json
    .split('\n')
    .map((line, index) => (index === 0 ? line : `  ${line}`))
    .join('\n')
  return `ServerEvents.recipes(event => {\n  event.custom(${indented})\n})\n`
}

function injectRecipeRemove(code: string, recipeId: string): string {
  const marker = 'ServerEvents.recipes(event => {\n'
  if (!code.startsWith(marker)) return code
  return `${marker}  event.remove({ id: ${quote(recipeId)} })\n${code.slice(marker.length)}`
}

function parseExtrasJson(text: string): { value: Record<string, unknown>; error: string } {
  if (!text.trim()) return { value: {}, error: '' }
  try {
    const parsed = JSON.parse(text) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { value: {}, error: '附加字段需要是 JSON 对象。' }
    }
    return { value: parsed as Record<string, unknown>, error: '' }
  } catch (error) {
    return {
      value: {},
      error: `附加字段 JSON 错误：${error instanceof Error ? error.message : '无法解析'}`
    }
  }
}

function buildLargeRecipeCode(
  outputId: string,
  outputCount: number,
  size: number,
  type: string,
  cells: string[],
  extrasText: string
): { code: string; error: string } {
  const output = outputId.trim()
  const recipeType = type.trim()
  if (!output) return { code: '', error: '请先选择产物。' }
  if (output.startsWith('#')) return { code: '', error: '产物必须是物品，不能是标签。' }
  if (!isLikelyId(output)) return { code: '', error: '产物 ID 需要是 namespace:path 的格式。' }
  if (!Number.isInteger(outputCount) || outputCount < 1 || outputCount > 64) {
    return { code: '', error: '产物数量需要在 1–64 之间。' }
  }
  if (!recipeType || !TYPE_PATTERN.test(recipeType)) {
    return { code: '', error: '配方 type 需要是 namespace:path 的格式。' }
  }
  if (!Number.isInteger(size) || size < 4 || size > 9) {
    return { code: '', error: '大网格尺寸需要在 4–9 之间。' }
  }
  const extras = parseExtrasJson(extrasText)
  if (extras.error) return { code: '', error: extras.error }
  const values = cells.map((value) => value.trim())
  const filled = values.filter(Boolean)
  if (filled.length === 0) return { code: '', error: '请至少在网格里放置一种材料。' }
  for (const value of filled) {
    if (!isLikelyId(value)) {
      return { code: '', error: `材料 ${value} 需要是 namespace:path 或 #tag。` }
    }
  }
  const keys = keyMapFor(filled)
  if (keys.size > 26) return { code: '', error: '大网格材料种类不能超过 26 种。' }
  const pattern: string[] = []
  for (let row = 0; row < size; row += 1) {
    let text = ''
    for (let col = 0; col < size; col += 1) {
      const value = values[row * size + col] ?? ''
      text += value ? (keys.get(value) ?? ' ') : ' '
    }
    pattern.push(text)
  }
  const keyObject: Record<string, unknown> = {}
  for (const [value, key] of keys) {
    keyObject[key] = value.startsWith('#')
      ? { tag: value.slice(1) }
      : { item: value }
  }
  return {
    code: customObjectCode({
      ...extras.value,
      type: recipeType,
      pattern,
      key: keyObject,
      result: { item: output, count: outputCount }
    }),
    error: ''
  }
}

function ingredientObject(value: string, count = 1): Record<string, string | number> {
  const ingredient: Record<string, string | number> = value.startsWith('#')
    ? { tag: value.slice(1) }
    : { item: value }
  if (count > 1) ingredient.count = count
  return ingredient
}

function buildVisualCustomCode(params: {
  type: string
  inputField: string
  inputArray: boolean
  inputs: { id: string; count: number }[]
  outputField: string
  outputArray: boolean
  outputs: { id: string; count: number }[]
  extras: string
}): { code: string; error: string } {
  const recipeType = params.type.trim()
  if (!recipeType || !TYPE_PATTERN.test(recipeType)) {
    return { code: '', error: '配方 type 需要是 namespace:path 的格式。' }
  }
  if (!VISUAL_INPUT_FIELDS.includes(params.inputField)) {
    return { code: '', error: '请选择输入字段名。' }
  }
  if (!VISUAL_OUTPUT_FIELDS.includes(params.outputField)) {
    return { code: '', error: '请选择产物字段名。' }
  }
  const inputValues = params.inputs
    .map((input) => ({ id: input.id.trim(), count: input.count }))
    .filter((input) => Boolean(input.id))
  if (inputValues.length === 0) return { code: '', error: '请至少添加一种输入材料。' }
  const selectedInputs = params.inputArray ? inputValues : inputValues.slice(0, 1)
  for (const input of selectedInputs) {
    if (!isLikelyId(input.id)) {
      return { code: '', error: `材料 ${input.id} 需要是 namespace:path 或 #tag。` }
    }
    if (!Number.isInteger(input.count) || input.count < 1 || input.count > 64) {
      return { code: '', error: '输入数量需要在 1–64 之间。' }
    }
  }
  const outputValues = params.outputs
    .map((output) => ({ id: output.id.trim(), count: output.count }))
    .filter((output) => Boolean(output.id))
  if (outputValues.length === 0) return { code: '', error: '请至少添加一个产物。' }
  const selectedOutputs = params.outputArray ? outputValues : outputValues.slice(0, 1)
  for (const output of selectedOutputs) {
    if (output.id.startsWith('#')) {
      return { code: '', error: '产物必须是物品，不能是标签。' }
    }
    if (!isLikelyId(output.id)) {
      return { code: '', error: `产物 ${output.id} 需要是 namespace:path 的格式。` }
    }
    if (!Number.isInteger(output.count) || output.count < 1 || output.count > 64) {
      return { code: '', error: '产物数量需要在 1–64 之间。' }
    }
  }
  const extras = parseExtrasJson(params.extras)
  if (extras.error) return { code: '', error: extras.error }
  const recipe: Record<string, unknown> = {
    ...extras.value,
    type: recipeType,
    [params.inputField]: params.inputArray
      ? selectedInputs.map((input) => ingredientObject(input.id, input.count))
      : ingredientObject(selectedInputs[0].id, selectedInputs[0].count),
    [params.outputField]: params.outputArray
      ? selectedOutputs.map((output) => ({ item: output.id, count: output.count }))
      : { item: selectedOutputs[0].id, count: selectedOutputs[0].count }
  }
  return { code: customObjectCode(recipe), error: '' }
}

function buildCustomJsonCode(text: string): { code: string; error: string } {
  const source = text.trim()
  if (!source) return { code: '', error: '请输入配方 JSON。' }
  if (source.length > 20000) return { code: '', error: 'JSON 超过 20000 字符，请精简后重试。' }
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch (error) {
    return {
      code: '',
      error: `JSON 格式错误：${error instanceof Error ? error.message : '无法解析'}`
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { code: '', error: 'event.custom(...) 需要 JSON 对象，不能是数组或普通值。' }
  }
  const record = parsed as Record<string, unknown>
  if (typeof record.type !== 'string' || !record.type.trim()) {
    return { code: '', error: '自定义配方 JSON 需要字符串 type 字段（模组配方类型）。' }
  }
  return { code: customObjectCode(parsed), error: '' }
}

function buildRecipeCode(
  kind: BasicRecipeKind,
  outputId: string,
  outputCount: number,
  cells: string[],
  inputs: string[],
  smithing: string[]
): { code: string; error: string } {
  const output = outputId.trim()
  if (!output) return { code: '', error: '请先选择产物。' }
  if (output.startsWith('#')) return { code: '', error: '产物必须是物品，不能是标签。' }
  if (!isLikelyId(output)) return { code: '', error: '产物 ID 需要是 namespace:path 的格式。' }
  if (!Number.isInteger(outputCount) || outputCount < 1 || outputCount > 64) {
    return { code: '', error: '产物数量需要在 1–64 之间。' }
  }
  const outputExpr =
    outputCount > 1 ? `Item.of(${quote(output)}, ${outputCount})` : quote(output)
  const indent = '  '

  if (kind === 'shaped') {
    const filled = cells
      .map((value, index) => ({ value: value.trim(), index }))
      .filter((entry) => Boolean(entry.value))
    if (filled.length === 0) return { code: '', error: '请至少在 3×3 网格里放置一种材料。' }
    for (const entry of filled) {
      if (!isLikelyId(entry.value)) {
        return { code: '', error: `材料 ${entry.value} 需要是 namespace:path 或 #tag。` }
      }
    }
    const rows = filled.map((entry) => Math.floor(entry.index / 3))
    const cols = filled.map((entry) => entry.index % 3)
    const minRow = Math.min(...rows)
    const maxRow = Math.max(...rows)
    const minCol = Math.min(...cols)
    const maxCol = Math.max(...cols)
    const keys = new Map<string, string>()
    for (const entry of filled) {
      if (![...keys.values()].includes(entry.value)) {
        keys.set(String.fromCharCode(65 + keys.size), entry.value)
      }
    }
    if (keys.size > 9) return { code: '', error: '材料种类不能超过 9 种。' }
    const valueToKey = new Map([...keys.entries()].map(([key, value]) => [value, key]))
    const pattern: string[] = []
    for (let row = minRow; row <= maxRow; row += 1) {
      let text = ''
      for (let col = minCol; col <= maxCol; col += 1) {
        const value = cells[row * 3 + col]?.trim() ?? ''
        text += value ? (valueToKey.get(value) ?? ' ') : ' '
      }
      pattern.push(text)
    }
    const patternLines = pattern.map((text) => `${indent}  ${quote(text)}`).join(',\n')
    const keyLines = [...keys.entries()]
      .map(([key, value]) => `${indent}  ${key}: ${quote(value)}`)
      .join(',\n')
    return {
      code: `ServerEvents.recipes(event => {\n${indent}event.shaped(${outputExpr}, [\n${patternLines}\n${indent}], {\n${keyLines}\n${indent}})\n})\n`,
      error: ''
    }
  }

  if (kind === 'shapeless') {
    const values = inputs.map((value) => value.trim()).filter(Boolean)
    if (values.length === 0) return { code: '', error: '请至少添加一种材料。' }
    for (const value of values) {
      if (!isLikelyId(value)) {
        return { code: '', error: `材料 ${value} 需要是 namespace:path 或 #tag。` }
      }
    }
    const lines = values.map((value) => `${indent}  ${quote(value)}`).join(',\n')
    return {
      code: `ServerEvents.recipes(event => {\n${indent}event.shapeless(${outputExpr}, [\n${lines}\n${indent}])\n})\n`,
      error: ''
    }
  }

  if (COOKING_KINDS.has(kind)) {
    const input = inputs[0]?.trim() ?? ''
    if (!input) return { code: '', error: '请选择输入材料。' }
    if (!isLikelyId(input)) return { code: '', error: '输入材料需要是 namespace:path 或 #tag。' }
    return {
      code: `ServerEvents.recipes(event => {\n${indent}event.${kind}(${outputExpr}, ${quote(input)})\n})\n`,
      error: ''
    }
  }

  const values = smithing.map((value) => value.trim())
  if (values.some((value) => !value)) {
    return { code: '', error: '锻造配方需要模板、底材和附加材料。' }
  }
  if (values.some((value) => !isLikelyId(value))) {
    return { code: '', error: '锻造材料需要是 namespace:path 或 #tag。' }
  }
  return {
    code: `ServerEvents.recipes(event => {\n${indent}event.smithing(${outputExpr}, ${quote(values[0])}, ${quote(values[1])}, ${quote(values[2])})\n})\n`,
    error: ''
  }
}

export function KubeJsRecipeBuilder({
  instance,
  active,
  path,
  hasSelection,
  onInsert,
  onReplaceSelection,
  onOpenKnowledge
}: {
  instance: InstanceSummary | null
  active: boolean
  path: string
  hasSelection: boolean
  onInsert: (code: string) => void
  onReplaceSelection: (code: string) => void
  onOpenKnowledge: () => void
}) {
  const [kind, setKind] = useState<RecipeKind>('shaped')
  const [outputId, setOutputId] = useState('')
  const [outputCount, setOutputCount] = useState(1)
  const [cells, setCells] = useState<string[]>(() => Array(9).fill(''))
  const [inputs, setInputs] = useState<string[]>([''])
  const [smithing, setSmithing] = useState<string[]>(['', '', ''])
  const [largeSize, setLargeSize] = useState(5)
  const [largeType, setLargeType] = useState('extendedcrafting:shaped_table')
  const [largeCells, setLargeCells] = useState<string[]>(() => Array(25).fill(''))
  const [largeExtras, setLargeExtras] = useState('')
  const [visualProfile, setVisualProfile] = useState<'machine' | 'altar'>('machine')
  const [visualType, setVisualType] = useState(VISUAL_PROFILES[0].type)
  const [visualInputField, setVisualInputField] = useState(
    VISUAL_PROFILES[0].inputField
  )
  const [visualInputArray, setVisualInputArray] = useState(true)
  const [visualInputs, setVisualInputs] = useState<
    { id: string; count: number }[]
  >([{ id: '', count: 1 }])
  const [visualOutputField, setVisualOutputField] = useState(
    VISUAL_PROFILES[0].outputField
  )
  const [visualOutputArray, setVisualOutputArray] = useState(false)
  const [visualOutputs, setVisualOutputs] = useState<
    { id: string; count: number }[]
  >([{ id: '', count: 1 }])
  const [visualExtras, setVisualExtras] = useState(VISUAL_PROFILES[0].extras)
  const [customJson, setCustomJson] = useState(DEFAULT_CUSTOM_JSON)
  const [icons, setIcons] = useState<Record<string, string | null>>({})
  const iconSeq = useRef(0)
  const [status, setStatus] = useState<KubeJsIndexStatus | null>(null)
  const [statusError, setStatusError] = useState('')
  const [picker, setPicker] = useState<PickerTarget | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PickerResult[]>([])
  const [resultTotal, setResultTotal] = useState(0)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const searchSeq = useRef(0)
  const [importOpen, setImportOpen] = useState(false)
  const [importQuery, setImportQuery] = useState('')
  const [importResults, setImportResults] = useState<KubeJsIndexRecipe[]>([])
  const [importTotal, setImportTotal] = useState(0)
  const [importPage, setImportPage] = useState(1)
  const [importSearching, setImportSearching] = useState(false)
  const [importError, setImportError] = useState('')
  const [importLoadingId, setImportLoadingId] = useState('')
  const [importedRecipeId, setImportedRecipeId] = useState<string | null>(null)
  const [removeOriginal, setRemoveOriginal] = useState(true)
  const [importNotice, setImportNotice] = useState<{
    id: string
    type: string
    source: string
    modeLabel: string
    notes: string[]
    fallback: boolean
  } | null>(null)
  const importSeq = useRef(0)

  const typeDef = RECIPE_TYPES.find((entry) => entry.id === kind) ?? RECIPE_TYPES[0]
  const modern = instance ? versionAtLeast(instance.gameVersion, '1.20.5') : false
  const isCustom = kind === 'custom_json'
  const isVisual = kind === 'custom_visual'
  const isLarge = kind === 'large_shaped'
  const importStatusHint =
    status?.state === 'building'
      ? '索引正在建立，请稍候再试。'
      : status?.state === 'error'
        ? '索引建立失败，请去知识页重试。'
        : '去知识页建立索引后即可导入。'

  useEffect(() => {
    setKind('shaped')
    setOutputId('')
    setOutputCount(1)
    setCells(Array(9).fill(''))
    setInputs([''])
    setSmithing(['', '', ''])
    setLargeSize(5)
    setLargeType('extendedcrafting:shaped_table')
    setLargeCells(Array(25).fill(''))
    setLargeExtras('')
    setVisualProfile('machine')
    setVisualType(VISUAL_PROFILES[0].type)
    setVisualInputField(VISUAL_PROFILES[0].inputField)
    setVisualInputArray(true)
    setVisualInputs([{ id: '', count: 1 }])
    setVisualOutputField(VISUAL_PROFILES[0].outputField)
    setVisualOutputArray(false)
    setVisualOutputs([{ id: '', count: 1 }])
    setVisualExtras(VISUAL_PROFILES[0].extras)
    setCustomJson(DEFAULT_CUSTOM_JSON)
    setIcons({})
    setStatus(null)
    setStatusError('')
    setPicker(null)
    setQuery('')
    setResults([])
    setImportOpen(false)
    setImportQuery('')
    setImportResults([])
    setImportTotal(0)
    setImportPage(1)
    setImportError('')
    setImportLoadingId('')
    setImportedRecipeId(null)
    setRemoveOriginal(true)
    setImportNotice(null)
  }, [instance?.id])

  useEffect(() => {
    if (!active || !instance) return
    let cancelled = false
    setStatusError('')
    void window.ccl.workshop
      .kubejsIndexStatus(instance.id)
      .then((next) => {
        if (!cancelled) setStatus(next)
      })
      .catch((cause) => {
        if (!cancelled) setStatusError(cleanError(cause))
      })
    return () => {
      cancelled = true
    }
  }, [active, instance?.id])

  useEffect(() => {
    if (!picker) {
      searchSeq.current += 1
      setResults([])
      setResultTotal(0)
      setSearching(false)
      return
    }
    if (!active || !instance || status?.state !== 'ready') {
      searchSeq.current += 1
      setResults([])
      setResultTotal(0)
      setSearching(false)
      return
    }
    const keyword = query.trim()
    if (!keyword) {
      searchSeq.current += 1
      setResults([])
      setResultTotal(0)
      return
    }
    const request = ++searchSeq.current
    setSearching(true)
    setSearchError('')
    const timer = window.setTimeout(() => {
      void Promise.all([
        window.ccl.workshop.kubejsIndexSearch({
          instanceId: instance.id,
          kind: 'item',
          query: keyword,
          page: 1,
          pageSize: 8
        }),
        picker.kind === 'output'
          ? Promise.resolve(null)
          : window.ccl.workshop.kubejsIndexSearch({
              instanceId: instance.id,
              kind: 'tag',
              query: keyword,
              page: 1,
              pageSize: 6
            })
      ])
        .then(([items, tags]) => {
          if (request !== searchSeq.current) return
          const itemResult = items as {
            kind: 'item'
            items: KubeJsIndexItem[]
            total: number
          }
          const next: PickerResult[] = itemResult.items.map((item) => ({
            id: item.id,
            name: item.nameZh || item.nameEn || item.id,
            modId: item.modId,
            tag: false,
            detail: item.block ? '方块' : '物品'
          }))
          let tagTotal = 0
          if (tags && tags.kind === 'tag') {
            tagTotal = tags.total
            for (const tag of tags.items as KubeJsIndexTag[]) {
              next.push({
                id: `#${tag.id}`,
                name: tag.id,
                modId: tag.modId,
                tag: true,
                detail: `${tag.type} 标签 · ${tag.count} 成员`
              })
            }
          }
          setResults(next.slice(0, 14))
          setResultTotal(itemResult.total + tagTotal)
        })
        .catch((cause) => {
          if (request === searchSeq.current) setSearchError(cleanError(cause))
        })
        .finally(() => {
          if (request === searchSeq.current) setSearching(false)
        })
    }, 180)
    return () => window.clearTimeout(timer)
  }, [active, instance?.id, picker, query, status?.state])

  useEffect(() => {
    if (!importOpen) {
      importSeq.current += 1
      setImportSearching(false)
      return
    }
    if (!active || !instance || status?.state !== 'ready') {
      importSeq.current += 1
      setImportResults([])
      setImportTotal(0)
      setImportSearching(false)
      return
    }
    const keyword = importQuery.trim()
    if (!keyword) {
      importSeq.current += 1
      setImportResults([])
      setImportTotal(0)
      setImportSearching(false)
      return
    }
    const request = ++importSeq.current
    setImportSearching(true)
    setImportError('')
    const timer = window.setTimeout(() => {
      void window.ccl.workshop
        .kubejsIndexSearch({
          instanceId: instance.id,
          kind: 'recipe',
          query: keyword,
          page: importPage,
          pageSize: 12
        })
        .then((result) => {
          if (request !== importSeq.current || result.kind !== 'recipe') return
          setImportResults((current) => {
            const base = importPage === 1 ? [] : current
            const seen = new Set(base.map((recipe) => recipe.id))
            return [
              ...base,
              ...result.items.filter((recipe) => !seen.has(recipe.id))
            ]
          })
          setImportTotal(result.total)
        })
        .catch((cause) => {
          if (request === importSeq.current) setImportError(cleanError(cause))
        })
        .finally(() => {
          if (request === importSeq.current) setImportSearching(false)
        })
    }, 180)
    return () => window.clearTimeout(timer)
  }, [active, instance?.id, importOpen, importQuery, importPage, status?.state])

  const largeKeys = useMemo(
    () => keyMapFor(largeCells.map((value) => value.trim()).filter(Boolean)),
    [largeCells]
  )

  const iconIds = useMemo(() => {
    const ids = new Set<string>()
    const add = (value: string): void => {
      const clean = value.trim()
      if (clean && !clean.startsWith('#') && isLikelyId(clean)) ids.add(clean)
    }
    add(outputId)
    for (const value of cells) add(value)
    for (const value of inputs) add(value)
    for (const value of smithing) add(value)
    for (const value of largeCells) add(value)
    for (const input of visualInputs) add(input.id)
    for (const output of visualOutputs) add(output.id)
    for (const result of results) {
      if (!result.tag) add(result.id)
    }
    for (const recipe of importResults) {
      if (recipe.output) add(recipe.output.id)
    }
    return [...ids]
  }, [
    outputId,
    cells,
    inputs,
    smithing,
    largeCells,
    visualInputs,
    visualOutputs,
    results,
    importResults
  ])
  const iconKey = iconIds.join('|')

  useEffect(() => {
    if (!active || !instance) return
    const cacheKey = (id: string): string => `${instance.id}|${id}`
    const apply = (): void => {
      const next: Record<string, string | null> = {}
      for (const id of iconIds) next[id] = recipeIconCache.get(cacheKey(id)) ?? null
      setIcons(next)
    }
    const missing = iconIds.filter((id) => !recipeIconCache.has(cacheKey(id)))
    if (missing.length === 0) {
      apply()
      return
    }
    const request = ++iconSeq.current
    const chunks: string[][] = []
    for (let index = 0; index < missing.length; index += 80) {
      chunks.push(missing.slice(index, index + 80))
    }
    void Promise.all(
      chunks.map((chunk) => window.ccl.workshop.kubejsItemIcons(instance.id, chunk))
    )
      .then((groups) => {
        if (request !== iconSeq.current) return
        for (const group of groups) {
          for (const [id, url] of Object.entries(group)) {
            recipeIconCache.set(cacheKey(id), url)
          }
        }
        apply()
      })
      .catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, instance?.id, iconKey])

  const basePreview = useMemo(() => {
    if (kind === 'custom_json') return buildCustomJsonCode(customJson)
    if (kind === 'custom_visual') {
      return buildVisualCustomCode({
        type: visualType,
        inputField: visualInputField,
        inputArray: visualInputArray,
        inputs: visualInputs,
        outputField: visualOutputField,
        outputArray: visualOutputArray,
        outputs: visualOutputs,
        extras: visualExtras
      })
    }
    if (kind === 'large_shaped') {
      return buildLargeRecipeCode(
        outputId,
        outputCount,
        largeSize,
        largeType,
        largeCells,
        largeExtras
      )
    }
    return buildRecipeCode(kind, outputId, outputCount, cells, inputs, smithing)
  }, [
    kind,
    outputId,
    outputCount,
    cells,
    inputs,
    smithing,
    largeSize,
    largeType,
    largeCells,
    largeExtras,
    customJson,
    visualType,
    visualInputField,
    visualInputArray,
    visualInputs,
    visualOutputField,
    visualOutputArray,
    visualOutputs,
    visualExtras
  ])

  const preview = useMemo(() => {
    if (basePreview.error || !importedRecipeId || !removeOriginal) return basePreview
    return {
      code: injectRecipeRemove(basePreview.code, importedRecipeId),
      error: ''
    }
  }, [basePreview, importedRecipeId, removeOriginal])

  const pickerTitle =
    picker?.kind === 'output'
      ? '选择产物'
      : picker?.kind === 'smithing'
        ? `选择锻造材料 ${(['模板', '底材', '附加'][picker.index ?? 0])}`
        : picker?.kind === 'cell'
          ? `选择图案材料（第 ${(picker.index ?? 0) + 1} 格）`
          : picker?.kind === 'largeCell'
            ? `选择大网格材料（第 ${(picker.index ?? 0) + 1} 格）`
            : picker?.kind === 'visualInput'
              ? `选择机器/祭坛输入（第 ${(picker.index ?? 0) + 1} 个）`
              : picker?.kind === 'visualOutput'
                ? `选择机器/祭坛产物（第 ${(picker.index ?? 0) + 1} 个）`
                : '选择输入材料'

  const manualValue = query.trim()
  const manualTag = manualValue.startsWith('#')
  const manualValid =
    Boolean(manualValue) &&
    isLikelyId(manualValue) &&
    !(picker?.kind === 'output' && manualTag)

  const openPicker = (target: PickerTarget) => {
    searchSeq.current += 1
    setImportOpen(false)
    setPicker(target)
    setQuery('')
    setResults([])
    setResultTotal(0)
    setSearchError('')
  }

  const applyVisualProfile = (profileId: 'machine' | 'altar') => {
    const profile = VISUAL_PROFILES.find((entry) => entry.id === profileId)
    if (!profile) return
    setVisualProfile(profileId)
    setVisualType(profile.type)
    setVisualInputField(profile.inputField)
    setVisualInputArray(profile.inputField.endsWith('s'))
    setVisualInputs([{ id: '', count: 1 }])
    setVisualOutputField(profile.outputField)
    setVisualOutputArray(profile.outputField.endsWith('s'))
    setVisualOutputs([{ id: '', count: 1 }])
    setVisualExtras(profile.extras)
  }

  const applyDraft = (draft: RecipeDraft) => {
    setKind(draft.kind)
    setOutputId(draft.outputId)
    setOutputCount(draft.outputCount)
    setCells([...draft.cells])
    setInputs([...draft.inputs])
    setSmithing([...draft.smithing])
    setLargeSize(draft.largeSize)
    setLargeType(draft.largeType)
    setLargeCells([...draft.largeCells])
    setLargeExtras(draft.largeExtras)
    setVisualProfile(draft.visualOutputField === 'output' ? 'altar' : 'machine')
    setVisualType(draft.visualType)
    setVisualInputField(draft.visualInputField)
    setVisualInputArray(draft.visualInputArray)
    setVisualInputs(draft.visualInputs.map((input) => ({ ...input })))
    setVisualOutputField(draft.visualOutputField)
    setVisualOutputArray(draft.visualOutputArray)
    setVisualOutputs(draft.visualOutputs.map((output) => ({ ...output })))
    setVisualExtras(draft.visualExtras)
    setCustomJson(draft.customJson)
  }

  const openImport = () => {
    if (!instance) return
    setImportOpen(true)
    setImportQuery('')
    setImportResults([])
    setImportTotal(0)
    setImportPage(1)
    setImportError('')
    setImportNotice(null)
    setPicker(null)
    setQuery('')
    setResults([])
  }

  const importRecipe = async (recipe: KubeJsIndexRecipe) => {
    if (!instance || importLoadingId) return
    setImportLoadingId(recipe.id)
    setImportError('')
    try {
      const detail: KubeJsRecipeDetail = await window.ccl.workshop.kubejsRecipeDetail(
        instance.id,
        recipe.id
      )
      let plan: RecipeImportPlan
      try {
        plan = mapImportedRecipe(detail.raw, detail.type)
      } catch (cause) {
        setImportError(cleanError(cause))
        return
      }
      applyDraft(plan.draft)
      setImportedRecipeId(detail.id)
      setRemoveOriginal(true)
      setImportNotice({
        id: detail.id,
        type: detail.type,
        source:
          detail.jarFile ??
          (detail.source === 'data' ? 'kubejs/data' : detail.source || '未知来源'),
        modeLabel: plan.modeLabel,
        notes: plan.notes,
        fallback: plan.fallback
      })
      setImportOpen(false)
      setImportResults([])
      setImportTotal(0)
      setImportPage(1)
      setImportQuery('')
    } catch (cause) {
      setImportError(cleanError(cause))
    } finally {
      setImportLoadingId('')
    }
  }

  const choose = (value: string) => {
    if (!picker) return
    if (picker.kind === 'output') setOutputId(value)
    else if (picker.kind === 'cell' && picker.index !== undefined) {
      setCells((current) => {
        const next = [...current]
        next[picker.index as number] = value
        return next
      })
    } else if (picker.kind === 'largeCell' && picker.index !== undefined) {
      setLargeCells((current) => {
        const next = [...current]
        next[picker.index as number] = value
        return next
      })
    } else if (picker.kind === 'input' && picker.index !== undefined) {
      setInputs((current) => {
        const next = [...current]
        next[picker.index as number] = value
        return next
      })
    } else if (picker.kind === 'visualInput' && picker.index !== undefined) {
      setVisualInputs((current) => {
        const next = [...current]
        next[picker.index as number] = {
          ...next[picker.index as number],
          id: value,
          count: next[picker.index as number]?.count ?? 1
        }
        return next
      })
    } else if (picker.kind === 'visualOutput' && picker.index !== undefined) {
      setVisualOutputs((current) => {
        const next = [...current]
        next[picker.index as number] = { ...next[picker.index as number], id: value }
        return next
      })
    } else if (picker.kind === 'smithing' && picker.index !== undefined) {
      setSmithing((current) => {
        const next = [...current]
        next[picker.index as number] = value
        return next
      })
    }
    setPicker(null)
    setQuery('')
    setResults([])
  }

  const clearCell = (index: number) => {
    setCells((current) => {
      const next = [...current]
      next[index] = ''
      return next
    })
  }

  const clearLargeCell = (index: number) => {
    setLargeCells((current) => {
      const next = [...current]
      next[index] = ''
      return next
    })
  }

  const textFor = (value: string): string => (value ? shortValue(value) : '')

  return (
    <div className="kjs-recipe">
      <div className="kjs-recipe-head">
        <Wrench size={13} />
        <strong>配方生成器</strong>
        <span>本地生成 · 不自动保存</span>
      </div>
      <p className="kjs-recipe-copy">
        选产物和材料，预览 ServerEvents.recipes 代码后插入光标或替换选区。
      </p>
      {path && !path.startsWith('server_scripts/') && (
        <div className="kjs-check-note">
          配方通过 ServerEvents.recipes 注册，通常应放在 server_scripts；当前文件是 {path}。
        </div>
      )}

      <div className="kjs-recipe-import">
        <button
          type="button"
          className="kjs-recipe-import-btn"
          onClick={openImport}
          disabled={!instance}
        >
          <Download size={12} />
          从已有配方导入
        </button>
        <span>
          {status?.state === 'ready'
            ? `读取索引中的 ${status.counts.recipes.toLocaleString('zh-CN')} 个配方，转成可视化后可继续修改。`
            : '建立实例索引后，可以搜索并导入已有配方。'}
        </span>
      </div>

      {importNotice && (
        <div
          className={`kjs-recipe-import-note ${importNotice.fallback ? 'is-fallback' : ''}`}
        >
          <div className="kjs-recipe-import-note-head">
            <strong>
              {importNotice.fallback
                ? '已原样放入自定义 JSON'
                : `已导入为${importNotice.modeLabel}`}
            </strong>
            <button
              type="button"
              className="kjs-icon-btn"
              title="关闭导入提示"
              onClick={() => setImportNotice(null)}
            >
              <X size={11} />
            </button>
          </div>
          <small title={importNotice.id}>
            {importNotice.id} · {importNotice.type} · 来自 {importNotice.source}
          </small>
          {importNotice.notes.length > 0 && (
            <ul>
              {importNotice.notes.map((note, index) => (
                <li key={`${note}-${index}`}>{note}</li>
              ))}
            </ul>
          )}
          {importNotice.fallback && (
            <small>
              生成器的自定义 JSON 模式仍可继续编辑；可视化模式暂时无法完整表达这个 schema。
            </small>
          )}
        </div>
      )}

      {importOpen && (
        <div className="kjs-recipe-picker is-import">
          <div className="kjs-recipe-picker-head">
            <strong>从已有配方导入</strong>
            <button
              type="button"
              className="kjs-icon-btn"
              title="关闭导入"
              onClick={() => setImportOpen(false)}
            >
              <X size={12} />
            </button>
          </div>
          <label className="kjs-recipe-search">
            <Search size={11} />
            <input
              autoFocus
              value={importQuery}
              placeholder="搜索产物、配方 ID 或模组说明"
              onChange={(event) => {
                setImportQuery(event.target.value)
                setImportPage(1)
                setImportResults([])
                setImportTotal(0)
                setImportError('')
              }}
            />
          </label>
          <div className="kjs-recipe-results is-import">
            {status?.state !== 'ready' ? (
              <div className="kjs-recipe-search-state">
                索引未建立。{importStatusHint}
              </div>
            ) : !importQuery.trim() ? (
              <div className="kjs-recipe-search-state">
                输入物品名、配方 ID 或模组关键字；支持中文名和分页加载。
              </div>
            ) : (
              <>
                {importSearching && importPage === 1 && (
                  <div className="kjs-recipe-search-state">
                    <Spinner size={11} /> 搜索中…
                  </div>
                )}
                {!importSearching && importPage === 1 && importResults.length === 0 && !importError && (
                  <div className="kjs-recipe-search-state">
                    没有匹配的配方。
                  </div>
                )}
                {importResults.map((recipe) => (
                  <button
                    key={recipe.id}
                    type="button"
                    className="kjs-recipe-result is-import"
                    disabled={Boolean(importLoadingId)}
                    onClick={() => void importRecipe(recipe)}
                  >
                    <span className="kjs-recipe-result-tile">
                      <RecipeTile
                        value={recipe.output?.id ?? recipe.id}
                        icons={icons}
                        compact
                      />
                    </span>
                    <span className="kjs-recipe-result-copy">
                      <strong>{recipe.output?.name ?? recipe.id}</strong>
                      <small>{recipe.id}</small>
                      <small title={recipe.inputs.map((input) => input.id).join('、')}>
                        {recipe.type}
                        {recipe.inputs.length > 0
                          ? ` · ${recipe.inputs
                              .slice(0, 3)
                              .map((input) => input.id)
                              .join('、')}${recipe.inputs.length > 3 ? ' 等' : ''}`
                          : ''}
                      </small>
                    </span>
                    <em>
                      {importLoadingId === recipe.id ? (
                        <Spinner size={10} />
                      ) : recipe.source === 'data' ? (
                        'kubejs'
                      ) : (
                        '模组'
                      )}
                    </em>
                  </button>
                ))}
                {importSearching && importPage > 1 && (
                  <div className="kjs-recipe-search-state">
                    <Spinner size={11} /> 加载中…
                  </div>
                )}
                {!importSearching && importResults.length < importTotal && (
                  <button
                    type="button"
                    className="kjs-recipe-load-more"
                    onClick={() => setImportPage((current) => current + 1)}
                  >
                    加载更多（已显示 {importResults.length} / {importTotal}）
                  </button>
                )}
              </>
            )}
          </div>
          {importError && status?.state === 'ready' && (
            <div className="kjs-check-error">{importError}</div>
          )}
          {status?.state !== 'ready' && (
            <div className="kjs-recipe-index-hint">
              <span>需要实例索引才能搜索已有配方。</span>
              <button
                type="button"
                onClick={() => {
                  setImportOpen(false)
                  onOpenKnowledge()
                }}
              >
                去知识页
              </button>
            </div>
          )}
          <small className="kjs-recipe-result-total">
            来源为模组 jar 和 kubejs/data；脚本里 event.* 注册的配方不在静态索引里。
          </small>
          <small className="kjs-recipe-result-total">
            可视化无法完整表达的 schema 会原样放进自定义 JSON，不会丢字段。
          </small>
        </div>
      )}

      {picker && (
        <div className="kjs-recipe-picker">
          <div className="kjs-recipe-picker-head">
            <strong>{pickerTitle}</strong>
            <button
              type="button"
              className="kjs-icon-btn"
              title="关闭选择器"
              onClick={() => setPicker(null)}
            >
              <X size={12} />
            </button>
          </div>
          <label className="kjs-recipe-search">
            <Search size={11} />
            <input
              autoFocus
              value={query}
              placeholder="搜索中文名或 ID，也可直接输入"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="kjs-recipe-results">
            {searching && (
              <div className="kjs-recipe-search-state">
                <Spinner size={11} /> 搜索中…
              </div>
            )}
            {!searching && searchError && (
              <div className="kjs-check-error">{searchError}</div>
            )}
            {!searching &&
              !searchError &&
              results.map((result) => (
                <button
                  key={`${result.tag ? 'tag' : 'item'}-${result.id}`}
                  type="button"
                  className="kjs-recipe-result"
                  onClick={() => choose(result.id)}
                >
                  <span className="kjs-recipe-result-tile">
                    <RecipeTile value={result.id} icons={icons} compact />
                  </span>
                  <span className="kjs-recipe-result-copy">
                    <strong>{result.name}</strong>
                    <small>{result.id}</small>
                  </span>
                  <em>{result.tag ? '标签' : result.detail}</em>
                </button>
              ))}
            {!searching && !searchError && query.trim() && manualValid && (
              <button
                type="button"
                className="kjs-recipe-manual"
                onClick={() => choose(manualValue)}
              >
                <Hash size={11} />
                使用原样 ID <code>{manualValue}</code>
              </button>
            )}
            {!searching &&
              !searchError &&
              query.trim() &&
              !manualValid &&
              results.length === 0 && (
                <div className="kjs-recipe-search-state">
                  没有匹配，或 ID 格式不正确（需要 namespace:path）。
                </div>
              )}
            {!query.trim() && (
              <div className="kjs-recipe-search-state">
                {status?.state === 'ready'
                  ? `可搜索 ${status.counts.items.toLocaleString('zh-CN')} 个物品；输入标签名可加入标签。`
                  : '输入物品或标签 ID；建立实例索引后还能按中文名搜索。'}
              </div>
            )}
          </div>
          {resultTotal > results.length && (
            <small className="kjs-recipe-result-total">
              共 {resultTotal} 个结果，继续输入可缩小范围。
            </small>
          )}
          {status?.state !== 'ready' && (
            <div className="kjs-recipe-index-hint">
              <span>索引未建立，仍可手动输入 ID。</span>
              <button
                type="button"
                onClick={() => {
                  setPicker(null)
                  onOpenKnowledge()
                }}
              >
                去知识页建立
              </button>
            </div>
          )}
        </div>
      )}

      <div className="kjs-recipe-field">
        <span className="kjs-recipe-label">配方类型</span>
        <select
          className="kjs-recipe-select"
          value={kind}
          onChange={(event) => setKind(event.target.value as RecipeKind)}
        >
          {RECIPE_TYPES.map((type) => (
            <option key={type.id} value={type.id}>
              {type.label}
            </option>
          ))}
        </select>
        <small className="kjs-recipe-hint">{typeDef.hint}</small>
      </div>

      {!isCustom && !isVisual && (
        <div className="kjs-recipe-field">
          <span className="kjs-recipe-label">产物</span>
          <div className="kjs-recipe-output-row">
            <button
              type="button"
              className={`kjs-recipe-pick ${outputId ? 'has-value' : ''}`}
              onClick={() => openPicker({ kind: 'output' })}
              title={outputId || '选择产物'}
            >
              <span className="kjs-recipe-pick-tile">
                {outputId ? <RecipeTile value={outputId} icons={icons} /> : <Plus size={11} />}
              </span>
              <span className="kjs-recipe-pick-copy">
                <strong>{outputId ? textFor(outputId) : '选择产物'}</strong>
                <small>{outputId || '物品 ID'}</small>
              </span>
            </button>
            <input
              className="kjs-recipe-count"
              type="number"
              min={1}
              max={64}
              value={outputCount}
              title="产物数量 1–64"
              onChange={(event) => {
                const value = Number.parseInt(event.target.value, 10)
                setOutputCount(Number.isFinite(value) ? Math.max(1, Math.min(64, value)) : 1)
              }}
            />
          </div>
        </div>
      )}

      {kind === 'shaped' ? (
        <div className="kjs-recipe-field">
          <div className="kjs-recipe-label-row">
            <span className="kjs-recipe-label">3×3 图案</span>
            <button
              type="button"
              className="kjs-recipe-text-btn"
              onClick={() => setCells(Array(9).fill(''))}
            >
              清空
            </button>
          </div>
          <div className="kjs-recipe-grid">
            {cells.map((value, index) => (
              <button
                key={index}
                type="button"
                className={`kjs-recipe-cell ${value ? 'has-value' : ''}`}
                title={value || '点击选择材料'}
                onClick={() => openPicker({ kind: 'cell', index })}
                onContextMenu={(event) => {
                  event.preventDefault()
                  clearCell(index)
                }}
              >
                {value ? (
                  <>
                    <RecipeTile value={value} icons={icons} compact />
                    <strong>{textFor(value)}</strong>
                    <small>{value.startsWith('#') ? '标签' : '物品'}</small>
                  </>
                ) : (
                  <Plus size={13} />
                )}
              </button>
            ))}
          </div>
          <small className="kjs-recipe-hint">点击格子选材料，右键清空；空行/空列会自动裁掉。</small>
        </div>
      ) : kind === 'shapeless' ? (
        <div className="kjs-recipe-field">
          <div className="kjs-recipe-label-row">
            <span className="kjs-recipe-label">材料</span>
            <button
              type="button"
              className="kjs-recipe-text-btn"
              disabled={inputs.length >= 9}
              onClick={() => setInputs((current) => [...current, ''])}
            >
              <Plus size={10} /> 添加
            </button>
          </div>
          {inputs.map((value, index) => (
            <div className="kjs-recipe-input-row" key={index}>
              <button
                type="button"
                className={`kjs-recipe-pick ${value ? 'has-value' : ''}`}
                onClick={() => openPicker({ kind: 'input', index })}
                title={value || '选择材料'}
              >
                <span className="kjs-recipe-pick-tile">
                  {value ? <RecipeTile value={value} icons={icons} compact /> : <Plus size={11} />}
                </span>
                <span className="kjs-recipe-pick-copy">
                  <strong>{value ? textFor(value) : '选择材料'}</strong>
                  <small>{value || '物品或 #标签'}</small>
                </span>
              </button>
              {inputs.length > 1 && (
                <button
                  type="button"
                  className="kjs-icon-btn"
                  title="移除这行"
                  onClick={() =>
                    setInputs((current) => current.filter((_, itemIndex) => itemIndex !== index))
                  }
                >
                  <Trash2 size={11} />
                </button>
              )}
            </div>
          ))}
          <small className="kjs-recipe-hint">重复材料可以添加多行；会在数组中重复写入。</small>
        </div>
      ) : kind === 'smithing' ? (
        <div className="kjs-recipe-field">
          <span className="kjs-recipe-label">锻造材料</span>
          {['模板', '底材', '附加材料'].map((label, index) => (
            <div className="kjs-recipe-input-row" key={label}>
              <button
                type="button"
                className={`kjs-recipe-pick ${smithing[index] ? 'has-value' : ''}`}
                onClick={() => openPicker({ kind: 'smithing', index })}
                title={smithing[index] || `选择${label}`}
              >
                <span className="kjs-recipe-pick-tile">
                  {smithing[index] ? (
                    <RecipeTile value={smithing[index]} icons={icons} compact />
                  ) : (
                    <Plus size={11} />
                  )}
                </span>
                <span className="kjs-recipe-pick-copy">
                  <strong>
                    {smithing[index] ? textFor(smithing[index]) : `选择${label}`}
                  </strong>
                  <small>{label}</small>
                </span>
              </button>
            </div>
          ))}
          <small className="kjs-recipe-hint">顺序为模板、底材、附加材料。</small>
        </div>
      ) : isVisual ? (
        <>
          <div className="kjs-recipe-field">
            <div className="kjs-recipe-label-row">
              <span className="kjs-recipe-label">可视化模板</span>
              <span className="kjs-recipe-segmented">
                {VISUAL_PROFILES.map((profile) => (
                  <button
                    key={profile.id}
                    type="button"
                    className={visualProfile === profile.id ? 'is-active' : ''}
                    onClick={() => applyVisualProfile(profile.id)}
                  >
                    {profile.label}
                  </button>
                ))}
              </span>
            </div>
            <input
              className="kjs-recipe-text-input"
              value={visualType}
              spellCheck={false}
              placeholder="modid:recipe_type"
              onChange={(event) => setVisualType(event.target.value)}
            />
            <small className="kjs-recipe-hint">
              可视化只负责常用输入/产物字段；复杂 schema 请用高级 JSON。
            </small>
          </div>

          <div className="kjs-recipe-field">
            <div className="kjs-recipe-label-row">
              <span className="kjs-recipe-label">输入</span>
              <button
                type="button"
                className="kjs-recipe-text-btn"
                disabled={!visualInputArray || visualInputs.length >= 12}
                onClick={() =>
                  setVisualInputs((current) => [...current, { id: '', count: 1 }])
                }
              >
                <Plus size={10} /> 添加
              </button>
            </div>
            <div className="kjs-recipe-map-row">
              <select
                className="kjs-recipe-map-select"
                value={visualInputField}
                onChange={(event) => {
                  const field = event.target.value
                  setVisualInputField(field)
                  setVisualInputArray(field.endsWith('s'))
                }}
              >
                {VISUAL_INPUT_FIELDS.map((field) => (
                  <option key={field} value={field}>
                    {field}
                  </option>
                ))}
              </select>
              <select
                className="kjs-recipe-map-select"
                value={visualInputArray ? 'array' : 'single'}
                onChange={(event) => setVisualInputArray(event.target.value === 'array')}
              >
                <option value="array">多个输入 · 数组</option>
                <option value="single">单个输入</option>
              </select>
            </div>
            {(visualInputArray ? visualInputs : visualInputs.slice(0, 1)).map(
              (input, index) => (
                <div className="kjs-recipe-input-row" key={index}>
                  <button
                    type="button"
                    className={`kjs-recipe-pick ${input.id ? 'has-value' : ''}`}
                    onClick={() => openPicker({ kind: 'visualInput', index })}
                    title={input.id || '选择输入材料'}
                  >
                    <span className="kjs-recipe-pick-tile">
                      {input.id ? (
                        <RecipeTile value={input.id} icons={icons} compact />
                      ) : (
                        <Plus size={11} />
                      )}
                    </span>
                    <span className="kjs-recipe-pick-copy">
                      <strong>{input.id ? textFor(input.id) : '选择输入材料'}</strong>
                      <small>{input.id || '物品或 #标签'}</small>
                    </span>
                  </button>
                  <input
                    className="kjs-recipe-count"
                    type="number"
                    min={1}
                    max={64}
                    value={input.count}
                    title="输入数量 1–64"
                    onChange={(event) => {
                      const count = Number.parseInt(event.target.value, 10)
                      setVisualInputs((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                count: Number.isFinite(count)
                                  ? Math.max(1, Math.min(64, count))
                                  : 1
                              }
                            : item
                        )
                      )
                    }}
                  />
                  {visualInputArray && visualInputs.length > 1 && (
                    <button
                      type="button"
                      className="kjs-icon-btn"
                      title="移除这个输入"
                      onClick={() =>
                        setVisualInputs((current) =>
                          current.filter((_, itemIndex) => itemIndex !== index)
                        )
                      }
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
              )
            )}
          </div>

          <div className="kjs-recipe-field">
            <div className="kjs-recipe-label-row">
              <span className="kjs-recipe-label">产物</span>
              <button
                type="button"
                className="kjs-recipe-text-btn"
                disabled={!visualOutputArray || visualOutputs.length >= 6}
                onClick={() =>
                  setVisualOutputs((current) => [...current, { id: '', count: 1 }])
                }
              >
                <Plus size={10} /> 添加
              </button>
            </div>
            <div className="kjs-recipe-map-row">
              <select
                className="kjs-recipe-map-select"
                value={visualOutputField}
                onChange={(event) => {
                  const field = event.target.value
                  setVisualOutputField(field)
                  setVisualOutputArray(field.endsWith('s'))
                }}
              >
                {VISUAL_OUTPUT_FIELDS.map((field) => (
                  <option key={field} value={field}>
                    {field}
                  </option>
                ))}
              </select>
              <select
                className="kjs-recipe-map-select"
                value={visualOutputArray ? 'array' : 'single'}
                onChange={(event) => setVisualOutputArray(event.target.value === 'array')}
              >
                <option value="single">单个产物</option>
                <option value="array">多个产物 · 数组</option>
              </select>
            </div>
            {(visualOutputArray ? visualOutputs : visualOutputs.slice(0, 1)).map(
              (output, index) => (
                <div className="kjs-recipe-input-row" key={index}>
                  <button
                    type="button"
                    className={`kjs-recipe-pick ${output.id ? 'has-value' : ''}`}
                    onClick={() => openPicker({ kind: 'visualOutput', index })}
                    title={output.id || '选择产物'}
                  >
                    <span className="kjs-recipe-pick-tile">
                      {output.id ? (
                        <RecipeTile value={output.id} icons={icons} compact />
                      ) : (
                        <Plus size={11} />
                      )}
                    </span>
                    <span className="kjs-recipe-pick-copy">
                      <strong>{output.id ? textFor(output.id) : '选择产物'}</strong>
                      <small>{output.id || '物品 ID'}</small>
                    </span>
                  </button>
                  <input
                    className="kjs-recipe-count"
                    type="number"
                    min={1}
                    max={64}
                    value={output.count}
                    title="产物数量 1–64"
                    onChange={(event) => {
                      const count = Number.parseInt(event.target.value, 10)
                      setVisualOutputs((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                count: Number.isFinite(count)
                                  ? Math.max(1, Math.min(64, count))
                                  : 1
                              }
                            : item
                        )
                      )
                    }}
                  />
                  {visualOutputArray && visualOutputs.length > 1 && (
                    <button
                      type="button"
                      className="kjs-icon-btn"
                      title="移除这个产物"
                      onClick={() =>
                        setVisualOutputs((current) =>
                          current.filter((_, itemIndex) => itemIndex !== index)
                        )
                      }
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
              )
            )}
          </div>

          <div className="kjs-recipe-field">
            <span className="kjs-recipe-label">附加字段 JSON</span>
            <textarea
              className="kjs-recipe-json is-small"
              value={visualExtras}
              spellCheck={false}
              onChange={(event) => setVisualExtras(event.target.value)}
            />
            <small className="kjs-recipe-hint">
              energy、mana、tier、time 等参数写在这里；不会覆盖 type 和输入/产物字段。
            </small>
          </div>
        </>
      ) : isLarge ? (
        <>
          <div className="kjs-recipe-field">
            <span className="kjs-recipe-label">配方 type</span>
            <input
              className="kjs-recipe-text-input"
              value={largeType}
              spellCheck={false}
              placeholder="extendedcrafting:shaped_table"
              onChange={(event) => setLargeType(event.target.value)}
            />
            <small className="kjs-recipe-hint">
              生成通用 pattern/key/result JSON；不同模组可能还要 tier/energy
              等字段，可在插入后补充，或改用自定义 JSON。
            </small>
          </div>
          <div className="kjs-recipe-field">
            <div className="kjs-recipe-label-row">
              <span className="kjs-recipe-label">大网格</span>
              <span className="kjs-recipe-grid-tools">
                <select
                  className="kjs-recipe-size"
                  value={largeSize}
                  onChange={(event) => {
                    const next = Number.parseInt(event.target.value, 10)
                    if (!Number.isFinite(next)) return
                    setLargeSize(next)
                    setLargeCells(Array(next * next).fill(''))
                  }}
                >
                  {LARGE_SIZES.map((size) => (
                    <option key={size} value={size}>
                      {size}×{size}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="kjs-recipe-text-btn"
                  onClick={() => setLargeCells(Array(largeSize * largeSize).fill(''))}
                >
                  清空
                </button>
              </span>
            </div>
            <div
              className="kjs-recipe-grid is-large"
              style={{ gridTemplateColumns: `repeat(${largeSize}, minmax(0, 1fr))` }}
            >
              {largeCells.map((value, index) => (
                <button
                  key={index}
                  type="button"
                  className={`kjs-recipe-cell is-large ${value ? 'has-value' : ''}`}
                  title={value || `第 ${index + 1} 格`}
                  onClick={() => openPicker({ kind: 'largeCell', index })}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    clearLargeCell(index)
                  }}
                >
                  {value ? (
                    <>
                      <RecipeTile value={value} icons={icons} compact />
                      <em className="kjs-recipe-cell-key">
                        {largeKeys.get(value) ?? '?'}
                      </em>
                    </>
                  ) : (
                    <Plus size={11} />
                  )}
                </button>
              ))}
            </div>
            <small className="kjs-recipe-hint">
              按所选尺寸完整生成，不自动裁剪；点击选材料，右键清空。
            </small>
            {largeKeys.size > 0 && (
              <div className="kjs-recipe-legend">
                {[...largeKeys.entries()].map(([value, key]) => (
                  <div key={value} className="kjs-recipe-legend-row">
                    <em>{key}</em>
                    <RecipeTile value={value} icons={icons} compact />
                    <span title={value}>{value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="kjs-recipe-field">
            <span className="kjs-recipe-label">附加字段 JSON（可选）</span>
            <textarea
              className="kjs-recipe-json is-small"
              value={largeExtras}
              spellCheck={false}
              placeholder={'{\n  "tier": 1\n}'}
              onChange={(event) => setLargeExtras(event.target.value)}
            />
            <small className="kjs-recipe-hint">
              tier、energy、conditions 等字段写在这里；不会覆盖 type、pattern、key、result。
            </small>
          </div>
        </>
      ) : isCustom ? (
        <div className="kjs-recipe-field">
          <span className="kjs-recipe-label">event.custom JSON</span>
          <div className="kjs-recipe-template-row">
            <button
              type="button"
              className="kjs-recipe-text-btn"
              onClick={() => setCustomJson(MACHINE_TEMPLATE)}
            >
              机器模板
            </button>
            <button
              type="button"
              className="kjs-recipe-text-btn"
              onClick={() => setCustomJson(MAGIC_TEMPLATE)}
            >
              祭坛模板
            </button>
            <button
              type="button"
              className="kjs-recipe-text-btn"
              onClick={() => setCustomJson(DEFAULT_CUSTOM_JSON)}
            >
              重置示例
            </button>
          </div>
          <textarea
            className="kjs-recipe-json"
            value={customJson}
            spellCheck={false}
            onChange={(event) => setCustomJson(event.target.value)}
          />
          <small className="kjs-recipe-hint">
            type、ingredients、result 等字段由目标模组决定；模板只作示例，
            插入后请按模组文档调整。可以从 JEI/REI 的配方导出或模组 wiki 粘贴。
          </small>
        </div>
      ) : (
        <div className="kjs-recipe-field">
          <span className="kjs-recipe-label">输入材料</span>
          <div className="kjs-recipe-input-row">
            <button
              type="button"
              className={`kjs-recipe-pick ${inputs[0] ? 'has-value' : ''}`}
              onClick={() => openPicker({ kind: 'input', index: 0 })}
              title={inputs[0] || '选择输入材料'}
            >
              <span className="kjs-recipe-pick-tile">
                {inputs[0] ? <RecipeTile value={inputs[0]} icons={icons} compact /> : <Plus size={11} />}
              </span>
              <span className="kjs-recipe-pick-copy">
                <strong>{inputs[0] ? textFor(inputs[0]) : '选择输入材料'}</strong>
                <small>{inputs[0] || '物品或 #标签'}</small>
              </span>
            </button>
          </div>
        </div>
      )}

      {importedRecipeId && (
        <div className="kjs-recipe-remove">
          <label>
            <input
              type="checkbox"
              checked={removeOriginal}
              onChange={(event) => setRemoveOriginal(event.target.checked)}
            />
            <span>先生成 event.remove 移除原配方</span>
          </label>
          <code title={importedRecipeId}>{importedRecipeId}</code>
          <button
            type="button"
            className="kjs-recipe-text-btn"
            onClick={() => setImportedRecipeId(null)}
          >
            不替换
          </button>
          <small>
            勾选时会在新配方前插入 event.remove；取消或点“不替换”则只是新增一份。
          </small>
        </div>
      )}

      <div className="kjs-recipe-preview">
        <div className="kjs-recipe-preview-head">
          <span>代码预览</span>
          <em>
            {isCustom || isVisual
              ? 'event.custom'
              : modern
                ? '1.21+'
                : instance?.gameVersion ?? ''}
          </em>
        </div>
        {preview.error ? (
          <div className="kjs-recipe-error">
            <AlertTriangle size={12} />
            <span>{preview.error}</span>
          </div>
        ) : (
          <pre>{preview.code}</pre>
        )}
        <small className="kjs-recipe-hint">
          {isCustom
            ? 'JSON 字段由目标模组/版本决定；这里只负责包成 event.custom，不猜测 schema。'
            : isVisual
              ? '可视化只生成常用输入/产物字段；energy、mana、tier 等放在附加 JSON，复杂 schema 用高级 JSON。'
              : isLarge
                ? 'pattern/key/result 是通用结构；tier、energy 等字段可在插入后补充。'
                : modern
                  ? '当前使用纯物品 ID/标签写法，1.21+ 同样可用；NBT/组件请生成后补充。'
                  : '当前使用纯物品 ID/标签写法，1.20.1 可直接使用。'}
        </small>
      </div>

      <div className="kjs-recipe-actions">
        <button
          type="button"
          className="button button--ghost button--sm"
          disabled={Boolean(preview.error) || !path}
          onClick={() => onInsert(preview.code)}
        >
          插入光标
        </button>
        <button
          type="button"
          className="button button--primary button--sm"
          disabled={Boolean(preview.error) || !path || !hasSelection}
          onClick={() => onReplaceSelection(preview.code)}
        >
          替换选区
        </button>
      </div>
      <small className="kjs-recipe-hint">
        {!path
          ? '先打开一个 KubeJS 文件。'
          : hasSelection
            ? '当前有选区；替换只改选区，应用后仍未保存。'
            : '应用后是未保存状态，检查无误再 Ctrl+S。'}
      </small>
      {statusError && <div className="kjs-check-error">{statusError}</div>}
    </div>
  )
}
