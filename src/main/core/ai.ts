import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { safeStorage } from 'electron'
import type { AiConfigPatch, AiConfigView } from '../../shared/types'
import { getConfigDir } from './config'

interface AiFile {
  version: 1
  enabled: boolean
  baseUrl: string
  model: string
  apiKeySealed: string
}

interface AiRuntimeConfig {
  enabled: boolean
  baseUrl: string
  model: string
  key: string | null
}

const DEFAULT_CONFIG: AiFile = {
  version: 1,
  enabled: false,
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  apiKeySealed: ''
}

let config: AiFile | null = null
let loadPromise: Promise<void> | null = null
let saveQueue: Promise<void> = Promise.resolve()

function filePath(): string {
  return join(getConfigDir(), 'ai.json')
}

async function ensureLoaded(): Promise<AiFile> {
  if (config) return config
  if (!loadPromise) {
    loadPromise = (async () => {
      let parsed: unknown
      try {
        parsed = JSON.parse(await fs.readFile(filePath(), 'utf8'))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          try {
            await fs.rename(filePath(), `${filePath()}.broken-${Date.now()}`)
          } catch {
            /* ignore */
          }
        }
      }
      const raw = (parsed && typeof parsed === 'object' ? parsed : {}) as Partial<AiFile>
      config = {
        version: 1,
        enabled: raw.enabled === true,
        baseUrl: normalizeBaseUrl(raw.baseUrl) ?? DEFAULT_CONFIG.baseUrl,
        model:
          typeof raw.model === 'string' && raw.model.trim()
            ? raw.model.trim().slice(0, 100)
            : DEFAULT_CONFIG.model,
        apiKeySealed:
          typeof raw.apiKeySealed === 'string' ? raw.apiKeySealed.slice(0, 4000) : ''
      }
    })().finally(() => {
      loadPromise = null
    })
  }
  await loadPromise
  return config ?? DEFAULT_CONFIG
}

async function persist(): Promise<void> {
  const snapshot = config ?? DEFAULT_CONFIG
  const next = JSON.stringify(snapshot, null, 2)
  saveQueue = saveQueue.then(async () => {
    await fs.mkdir(getConfigDir(), { recursive: true })
    const path = filePath()
    const tmp = `${path}.tmp`
    await fs.writeFile(tmp, next, 'utf8')
    await fs.rename(tmp, path)
  })
  return saveQueue
}

function normalizeBaseUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    const local =
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === '::1'
    if (url.protocol === 'http:' && !local) return null
    url.username = ''
    url.password = ''
    return url.toString().replace(/\/+$/, '')
  } catch {
    return null
  }
}

export function encryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

export async function getAiConfigView(): Promise<AiConfigView> {
  const current = await ensureLoaded()
  return {
    enabled: current.enabled,
    baseUrl: current.baseUrl,
    model: current.model,
    hasKey: Boolean(current.apiKeySealed),
    encryption: encryptionAvailable()
  }
}

export async function updateAiConfig(raw: unknown): Promise<AiConfigView> {
  if (!raw || typeof raw !== 'object') throw new Error('无效的 AI 配置')
  const patch = raw as AiConfigPatch
  const current = await ensureLoaded()
  let enabled = current.enabled
  let baseUrl = current.baseUrl
  let model = current.model
  let apiKeySealed = current.apiKeySealed

  if (patch.enabled !== undefined) enabled = patch.enabled === true
  if (patch.baseUrl !== undefined) {
    const normalized = normalizeBaseUrl(patch.baseUrl)
    if (!normalized) throw new Error('服务地址需要是 https，或本机的 http 地址')
    baseUrl = normalized
  }
  if (patch.model !== undefined) {
    if (typeof patch.model !== 'string' || !patch.model.trim()) {
      throw new Error('请填写模型名称')
    }
    model = patch.model.trim().slice(0, 100)
  }
  if (patch.apiKey !== undefined) {
    if (patch.apiKey === null || !patch.apiKey.trim()) {
      apiKeySealed = ''
    } else {
      if (!encryptionAvailable()) {
        throw new Error('系统加密不可用，无法安全保存 API Key')
      }
      if (patch.apiKey.trim().length > 500) throw new Error('API Key 过长')
      apiKeySealed = safeStorage
        .encryptString(patch.apiKey.trim())
        .toString('base64')
    }
  }

  config = { version: 1, enabled, baseUrl, model, apiKeySealed }
  await persist()
  return getAiConfigView()
}

export async function getAiRuntimeConfig(): Promise<AiRuntimeConfig> {
  const current = await ensureLoaded()
  let key: string | null = null
  if (current.apiKeySealed && encryptionAvailable()) {
    try {
      key = safeStorage.decryptString(Buffer.from(current.apiKeySealed, 'base64'))
    } catch {
      key = null
    }
  }
  return {
    enabled: current.enabled,
    baseUrl: current.baseUrl,
    model: current.model,
    key
  }
}
