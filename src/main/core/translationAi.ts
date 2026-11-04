import type {
  TranslationBatchItem,
  TranslationBatchRequest,
  TranslationBatchResult,
  TranslationGlossaryEntry
} from '../../shared/types'
import { getAiRuntimeConfig } from './ai'
import { getInstance } from './instances'
import { mergeCommunityGlossary } from './translationGlossary'
import { sameProtectedTokens } from './translationText'

const AI_TIMEOUT_MS = 70_000
const MAX_ITEMS = 30
const MAX_ITEM_CHARS = 4000
const MAX_TOTAL_CHARS = 8000
const MAX_GLOSSARY = 200

function stripCodeFence(value: string): string {
  const text = value.trim()
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return fenced ? fenced[1].trim() : text
}

function parseItems(raw: string): { items: { id: string; text: string }[]; model: string | null } {
  const parsed = JSON.parse(raw) as {
    choices?: { message?: { content?: string } }[]
    model?: string
  }
  const content = parsed.choices?.[0]?.message?.content ?? ''
  const cleaned = stripCodeFence(content)
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('AI 没有返回 JSON 翻译结果')
  const data = JSON.parse(cleaned.slice(start, end + 1)) as { items?: unknown }
  if (!Array.isArray(data.items)) throw new Error('AI 返回的翻译结果缺少 items')
  const items: { id: string; text: string }[] = []
  for (const item of data.items) {
    if (!item || typeof item !== 'object') continue
    const value = item as Record<string, unknown>
    if (typeof value.id !== 'string' || typeof value.text !== 'string') continue
    items.push({ id: value.id.slice(0, 160), text: value.text })
  }
  return { items, model: parsed.model ?? null }
}

function sanitizeItems(raw: unknown): TranslationBatchItem[] {
  if (!Array.isArray(raw)) throw new Error('请选择需要翻译的条目')
  const seen = new Set<string>()
  const items: TranslationBatchItem[] = []
  let total = 0
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const value = item as Record<string, unknown>
    const id = typeof value.id === 'string' ? value.id.trim().slice(0, 160) : ''
    const text = typeof value.text === 'string' ? value.text.slice(0, MAX_ITEM_CHARS) : ''
    if (!id || !text.trim() || seen.has(id)) continue
    seen.add(id)
    total += text.length
    if (total > MAX_TOTAL_CHARS || items.length >= MAX_ITEMS) break
    items.push({
      id,
      text,
      field: typeof value.field === 'string' ? value.field.slice(0, 160) : undefined,
      kind:
        value.kind === 'json' ||
        value.kind === 'json5' ||
        value.kind === 'snbt' ||
        value.kind === 'lang' ||
        value.kind === 'comment'
          ? value.kind
          : undefined
    })
  }
  if (items.length === 0) throw new Error('没有可翻译的条目')
  return items
}

function sanitizeGlossary(raw: unknown): TranslationGlossaryEntry[] {
  if (!Array.isArray(raw)) return []
  const entries: TranslationGlossaryEntry[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const value = item as Record<string, unknown>
    const source = typeof value.source === 'string' ? value.source.trim().slice(0, 80) : ''
    const target = typeof value.target === 'string' ? value.target.trim().slice(0, 80) : ''
    if (!source || !target) continue
    entries.push({ source, target })
    if (entries.length >= MAX_GLOSSARY) break
  }
  return entries
}

async function requestTranslations(
  endpoint: string,
  key: string | null,
  model: string,
  system: string,
  payload: string
): Promise<{ items: { id: string; text: string }[]; model: string | null; sentBytes: number }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(key ? { Authorization: `Bearer ${key}` } : {})
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: payload }
        ],
        temperature: 0.1,
        max_tokens: 4096,
        stream: false
      }),
      signal: controller.signal
    })
  } catch (error) {
    if (controller.signal.aborted) throw new Error('AI 翻译超时，请检查网络或换一个模型')
    throw new Error(`无法连接 AI 服务：${error instanceof Error ? error.message : '网络错误'}`)
  } finally {
    clearTimeout(timer)
  }
  const raw = await response.text()
  if (!response.ok) throw new Error(`AI 服务返回 ${response.status}：${raw.slice(0, 240)}`)
  const parsed = parseItems(raw)
  return {
    items: parsed.items,
    model: parsed.model,
    sentBytes: Buffer.byteLength(payload, 'utf8')
  }
}

export async function translateBatch(
  request: TranslationBatchRequest
): Promise<TranslationBatchResult> {
  const instance = await getInstance(request.instanceId)
  const config = await getAiRuntimeConfig()
  if (!config.enabled) throw new Error('AI 翻译还没有启用，请先到「设置 → AI 辅助」配置')
  if (!config.baseUrl || !config.model) throw new Error('请先填写 AI 服务地址和模型')
  const items = sanitizeItems(request.items)
  const glossary = await mergeCommunityGlossary(
    sanitizeGlossary(request.glossary),
    items.map((item) => item.text)
  )
  const endpoint = /\/chat\/completions$/i.test(config.baseUrl)
    ? config.baseUrl
    : `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`
  const system = `你是 Minecraft 整合包本地化译者。把用户给出的 items 中的 text 翻译成简体中文。
规则：
1. 只翻译自然语言；保持原意、语气和标点，不扩写、不解释、不合并条目。
2. 严格保留：占位符（%s、%1$s、{0}、\${...}）、颜色代码（§a、&a）、换行/制表转义、URL、文件路径、命令、物品/方块/配方 ID、数字、英文缩写（AE2、RF、FE 等）。
3. 优先使用术语表；未覆盖的专有名词保留英文或使用社区常用译名。
4. 任务书文本可以自然流畅；配置注释保持简短。
只返回一个 JSON 对象：{"items":[{"id":"原 id","text":"译文"}]}。不要返回 Markdown、解释或额外字段。`
  const context = {
    instance: instance.name,
    gameVersion: instance.gameVersion,
    loader: instance.loader,
    loaderVersion: instance.loaderVersion
  }
  const warnings: string[] = []
  const accepted = new Map<string, string>()
  let sentBytes = 0
  let model: string | null = null

  const run = async (batch: TranslationBatchItem[], secondPass: boolean): Promise<void> => {
    const payload = JSON.stringify(
      {
        context,
        glossary,
        items: batch.map((item) => ({
          id: item.id,
          text: item.text,
          field: item.field ?? null,
          kind: item.kind ?? null
        }))
      },
      null,
      2
    )
    const result = await requestTranslations(endpoint, config.key, config.model, system, payload)
    sentBytes += result.sentBytes
    model = result.model ?? model
    const byId = new Map(result.items.map((item) => [item.id, item.text]))
    for (const item of batch) {
      const raw = byId.get(item.id)
      if (typeof raw !== 'string' || !raw.trim()) {
        warnings.push(`${item.field ?? item.id}：AI 没有返回译文`)
        continue
      }
      const text = raw.trim()
      if (!/[\u3400-\u9fff]/.test(text)) {
        warnings.push(`${item.field ?? item.id}：结果没有中文，已保留原文`)
        continue
      }
      if (!sameProtectedTokens(item.text, text)) {
        warnings.push(`${item.field ?? item.id}：占位符或 ID 不一致，已保留原文`)
        continue
      }
      if (text.length > Math.max(2000, item.text.length * 6)) {
        warnings.push(`${item.field ?? item.id}：译文异常过长，已保留原文`)
        continue
      }
      accepted.set(item.id, text)
    }
    const missing = batch.filter((item) => !accepted.has(item.id))
    if (!secondPass && missing.length > 0 && missing.length < batch.length) {
      await run(missing, true)
    }
  }

  await run(items, false)
  return {
    items: [...accepted].map(([id, text]) => ({ id, text })),
    warnings: [...new Set(warnings)].slice(0, 20),
    model,
    sentBytes
  }
}
