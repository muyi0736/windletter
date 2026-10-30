import type {
  KubeJsQaCitation,
  KubeJsQaRequest,
  KubeJsQaResult
} from '../../shared/types'
import { getAiRuntimeConfig } from './ai'
import { getInstance } from './instances'
import {
  getKubeJsQaContext,
  type KubeJsQaContext
} from './kubeJsIndex'

const AI_TIMEOUT_MS = 60_000
const MAX_ANSWER_CHARS = 6000
const ID_PATTERN = /\b[a-z0-9_.-]+:[a-z0-9_./-]+\b/gi

function stripCodeFence(value: string): string {
  const text = value.trim()
  const fenced = text.match(/```(?:json|javascript|js)?\s*([\s\S]*?)```/i)
  return fenced ? fenced[1].trim() : text
}

function localAnswer(context: KubeJsQaContext, reason: string): string {
  if (context.items.length === 0 && context.recipes.length === 0 && context.tags.length === 0) {
    return [
      `本地索引没有找到与“${context.question}”匹配的物品或配方。`,
      '可以换用完整物品 ID 或中文名再问，或者先在知识页重建索引。'
    ].join('\n')
  }
  const lines: string[] = []
  if (context.items.length > 0) {
    lines.push(
      `本地索引命中：${context.items
        .slice(0, 5)
        .map((item) => `${item.nameZh || item.nameEn || item.name}（${item.id}）`)
        .join('、')}。`
    )
  }
  if (context.recipes.length > 0) {
    const samples = context.recipes.slice(0, 4).map((recipe) => {
      const output = recipe.output ? `${recipe.output.name}（${recipe.output.id}）` : recipe.id
      return `${output} · ${recipe.id}`
    })
    lines.push(`相关配方示例：${samples.join('；')}。`)
  }
  if (context.tags.length > 0) {
    lines.push(`相关标签：${context.tags.map((tag) => tag.id).join('、')}。`)
  }
  lines.push(reason)
  return lines.join('\n')
}

function citationsOf(context: KubeJsQaContext): KubeJsQaCitation[] {
  const citations: KubeJsQaCitation[] = []
  for (const item of context.items) {
    citations.push({
      kind: 'item',
      id: item.id,
      label: item.nameZh || item.nameEn || item.name,
      detail: item.id,
      iconId: item.id
    })
  }
  for (const recipe of context.recipes) {
    citations.push({
      kind: 'recipe',
      id: recipe.id,
      label: recipe.output?.name ?? recipe.id,
      detail: recipe.output ? `${recipe.type} → ${recipe.output.id}` : recipe.type,
      iconId: recipe.output?.id ?? null
    })
  }
  for (const tag of context.tags) {
    citations.push({
      kind: 'tag',
      id: tag.id,
      label: tag.id,
      detail: `${tag.type} · ${tag.memberCount} 个成员`,
      iconId: null
    })
  }
  return citations
}

function allowedIds(context: KubeJsQaContext): Set<string> {
  const allowed = new Set<string>()
  for (const item of context.items) allowed.add(item.id.toLowerCase())
  for (const recipe of context.recipes) {
    allowed.add(recipe.id.toLowerCase())
    if (recipe.output) allowed.add(recipe.output.id.toLowerCase())
    for (const input of recipe.inputs) allowed.add(input.id.toLowerCase())
  }
  for (const tag of context.tags) {
    allowed.add(tag.id.toLowerCase())
    for (const member of tag.members) allowed.add(member.id.toLowerCase())
  }
  return allowed
}

function unknownIdsInAnswer(answer: string, allowed: Set<string>): string[] {
  const found = new Set<string>()
  for (const match of answer.matchAll(ID_PATTERN)) {
    const id = match[0].toLowerCase()
    if (!allowed.has(id)) found.add(id)
  }
  return [...found].slice(0, 6)
}

function parseAiAnswer(raw: string): string {
  let content = ''
  try {
    const parsed = JSON.parse(raw) as {
      choices?: { message?: { content?: string } }[]
    }
    content = parsed.choices?.[0]?.message?.content ?? ''
  } catch {
    throw new Error('AI 返回了无法解析的响应')
  }
  const cleaned = stripCodeFence(content).trim()
  if (!cleaned) throw new Error('AI 没有返回内容')
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      const data = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>
      if (typeof data.answer === 'string' && data.answer.trim()) {
        return data.answer.replace(/\u0000/g, '').slice(0, MAX_ANSWER_CHARS)
      }
    } catch {
      /* fall through to plain text */
    }
  }
  return cleaned.slice(0, MAX_ANSWER_CHARS)
}

export async function answerKubeJsQuestion(
  request: KubeJsQaRequest
): Promise<KubeJsQaResult> {
  const instance = await getInstance(request.instanceId)
  const context = await getKubeJsQaContext(instance.id, request.question)
  const citations = citationsOf(context)
  const counts = {
    itemCount: context.items.length,
    recipeCount: context.recipes.length,
    tagCount: context.tags.length
  }
  if (context.items.length === 0 && context.recipes.length === 0 && context.tags.length === 0) {
    return {
      answer: localAnswer(context, '没有发送 AI 请求。'),
      citations: [],
      ...counts,
      model: null,
      warnings: [],
      localOnly: true
    }
  }

  const config = await getAiRuntimeConfig()
  if (!config.enabled || !config.baseUrl || !config.model) {
    return {
      answer: localAnswer(context, 'AI 辅助尚未启用，先展示本地检索结果。'),
      citations,
      ...counts,
      model: null,
      warnings: ['到「设置 → AI 辅助」启用服务后，才能生成解释。'],
      localOnly: true
    }
  }

  const endpoint = /\/chat\/completions$/i.test(config.baseUrl)
    ? config.baseUrl
    : `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`
  const system = `你是 Minecraft 配方/物品问答助手。当前实例是 Minecraft ${instance.gameVersion}，加载器 ${instance.loader}${instance.loaderVersion ? ` ${instance.loaderVersion}` : ''}。
只能依据用户消息里的 <local_index> 回答，不得使用常识补全索引外的物品、配方、标签或模组，不得编造 ID。如果索引数据不足，明确回答“本地索引没有足够信息”，并建议用户换中文名/完整 ID 或重建索引。
回答用简体中文，先给结论，再给简短配方、用途或获取方式；提到物品或配方时保留完整 ID。不要输出 Markdown 表格、代码块或大段客套，控制在 200–500 字。
只返回一个 JSON 对象，不要 Markdown：{"answer":"..."}`
  const payload = JSON.stringify(
    {
      question: context.question,
      items: context.items,
      recipes: context.recipes,
      tags: context.tags
    },
    null,
    2
  )
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.key ? { Authorization: `Bearer ${config.key}` } : {})
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `<local_index>\n${payload}\n</local_index>` }
        ],
        temperature: 0.15,
        max_tokens: 1200,
        stream: false
      }),
      signal: controller.signal
    })
  } catch {
    return {
      answer: localAnswer(context, 'AI 请求失败，先展示本地检索结果。'),
      citations,
      ...counts,
      model: null,
      warnings: ['AI 服务暂时不可用，可稍后重试。'],
      localOnly: true
    }
  } finally {
    clearTimeout(timer)
  }
  if (!response.ok) {
    return {
      answer: localAnswer(context, 'AI 服务返回错误，先展示本地检索结果。'),
      citations,
      ...counts,
      model: null,
      warnings: [`AI 服务返回 ${response.status}，可检查设置或稍后重试。`],
      localOnly: true
    }
  }
  const raw = await response.text()
  let answer: string
  let model: string | null = config.model
  try {
    const parsed = JSON.parse(raw) as { model?: string; choices?: unknown }
    if (typeof parsed.model === 'string' && parsed.model.trim()) model = parsed.model
    answer = parseAiAnswer(raw)
  } catch {
    return {
      answer: localAnswer(context, 'AI 返回格式异常，先展示本地检索结果。'),
      citations,
      ...counts,
      model: null,
      warnings: ['AI 返回格式异常，可换一个模型或稍后重试。'],
      localOnly: true
    }
  }
  const warnings: string[] = []
  const unknown = unknownIdsInAnswer(answer, allowedIds(context))
  if (unknown.length > 0) {
    warnings.push(`回答提到本地索引之外的 ID：${unknown.join('、')}，请核对。`)
  }
  return {
    answer,
    citations,
    ...counts,
    model,
    warnings,
    localOnly: false
  }
}
