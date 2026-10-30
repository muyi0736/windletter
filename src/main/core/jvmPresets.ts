import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type {
  JvmPresetInput,
  JvmPresetPayload,
  JvmPresetView
} from '../../shared/types'
import { getConfigDir } from './config'
import { writeFileAtomic } from './version'

const MAX_CUSTOM = 20
const MAX_NAME = 40
const MAX_ARGS = 4000
const MAX_DESCRIPTION = 160

const BUILT_INS: JvmPresetView[] = [
  {
    id: 'builtin-default',
    name: '默认（清空）',
    args: '',
    description: '清空额外 JVM 参数，使用启动器默认参数。',
    builtIn: true
  },
  {
    id: 'builtin-g1-balanced',
    name: 'G1GC 平滑',
    args: '-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 -XX:G1HeapRegionSize=8M -XX:G1ReservePercent=20 -XX:G1HeapWastePercent=5 -XX:G1MixedGCCountTarget=4 -XX:InitiatingHeapOccupancyPercent=15 -XX:G1MixedGCLiveThresholdPercent=90 -XX:G1RSetUpdatingPauseTimePercent=5 -XX:SurvivorRatio=32 -XX:+PerfDisableSharedMem -XX:MaxTenuringThreshold=1',
    description: '常见 G1GC 平滑参数，适合大多数客户端和较重的模组包。',
    builtIn: true
  },
  {
    id: 'builtin-g1-low-latency',
    name: 'G1GC 低延迟',
    args: '-XX:+UseG1GC -XX:MaxGCPauseMillis=100 -XX:+ParallelRefProcEnabled -XX:+DisableExplicitGC -XX:+PerfDisableSharedMem',
    description: '更短的 GC 停顿目标，适合追求帧稳定性；极端情况下可能略微降低吞吐。',
    builtIn: true
  },
  {
    id: 'builtin-zgc',
    name: 'ZGC 低延迟',
    args: '-XX:+UseZGC -XX:+ZGenerational',
    description: '需要 Java 21 及以上；Java 17 不支持 ZGenerational，套用前请确认实例 Java。',
    builtIn: true,
    minJava: 21
  }
]

interface StoredPreset {
  id: string
  name: string
  args: string
  description: string
}

let custom: StoredPreset[] | null = null
let loading: Promise<StoredPreset[]> | null = null
let saveQueue: Promise<void> = Promise.resolve()

function presetPath(): string {
  return join(getConfigDir(), 'jvm-presets.json')
}

function cleanText(value: unknown, fallback: string, max: number): string {
  if (typeof value !== 'string') return fallback
  const clean = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim()
  return clean ? clean.slice(0, max) : fallback
}

function cleanArgs(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, MAX_ARGS)
}

function normalizePreset(raw: unknown): StoredPreset | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Partial<StoredPreset>
  if (typeof value.id !== 'string' || !/^[A-Za-z0-9._-]{8,80}$/.test(value.id)) return null
  const name = cleanText(value.name, '', MAX_NAME)
  if (!name) return null
  return {
    id: value.id,
    name,
    args: cleanArgs(value.args),
    description: cleanText(value.description, '自定义 JVM 参数', MAX_DESCRIPTION)
  }
}

async function persist(): Promise<void> {
  const snapshot = JSON.stringify(custom ?? [], null, 2)
  saveQueue = saveQueue.catch(() => undefined).then(async () => {
    await fs.mkdir(getConfigDir(), { recursive: true })
    await writeFileAtomic(presetPath(), snapshot)
  })
  return saveQueue
}

async function load(): Promise<StoredPreset[]> {
  if (custom) return custom
  if (loading) return loading
  loading = (async () => {
    let parsed: unknown = null
    try {
      parsed = JSON.parse(await fs.readFile(presetPath(), 'utf8'))
    } catch {
      parsed = null
    }
    const list = Array.isArray(parsed) ? parsed : []
    custom = list
      .map(normalizePreset)
      .filter((preset): preset is StoredPreset => preset !== null)
      .slice(0, MAX_CUSTOM)
    return custom
  })()
  try {
    return await loading
  } finally {
    loading = null
  }
}

function payload(): JvmPresetPayload {
  return {
    presets: [
      ...BUILT_INS,
      ...(custom ?? []).map((preset) => ({
        ...preset,
        builtIn: false
      }))
    ]
  }
}

export async function listJvmPresets(): Promise<JvmPresetPayload> {
  await load()
  return payload()
}

export async function saveJvmPreset(input: JvmPresetInput): Promise<JvmPresetPayload> {
  const list = await load()
  const name = cleanText(input.name, '', MAX_NAME)
  if (!name) throw new Error('预设名称不能为空')
  const args = cleanArgs(input.args)
  const description = cleanText(input.description, '自定义 JVM 参数', MAX_DESCRIPTION)
  const existingIndex =
    typeof input.id === 'string'
      ? list.findIndex((preset) => preset.id === input.id)
      : -1
  if (typeof input.id === 'string' && input.id.startsWith('builtin-')) {
    throw new Error('内置预设不能修改')
  }
  if (existingIndex >= 0) {
    list[existingIndex] = { ...list[existingIndex], name, args, description }
  } else {
    if (list.length >= MAX_CUSTOM) throw new Error(`最多保存 ${MAX_CUSTOM} 个自定义预设`)
    list.push({ id: randomUUID(), name, args, description })
  }
  custom = list
  await persist()
  return payload()
}

export async function removeJvmPreset(id: string): Promise<JvmPresetPayload> {
  if (typeof id !== 'string' || id.startsWith('builtin-')) {
    throw new Error('内置预设不能删除')
  }
  const list = await load()
  custom = list.filter((preset) => preset.id !== id)
  await persist()
  return payload()
}