import type {
  KubeJsExplainPoint,
  KubeJsExplainRequest,
  KubeJsExplainResult
} from '../../shared/types'
import { getAiRuntimeConfig } from './ai'
import { getInstance } from './instances'
import { explainKubeJsAst } from './kubeJsExplainAst'

const AI_TIMEOUT_MS = 65_000

function addPoint(
  points: KubeJsExplainPoint[],
  line: number | null,
  title: string,
  detail: string
): void {
  if (points.length >= 30) return
  const cleanTitle = title.trim().slice(0, 80)
  const cleanDetail = detail.replace(/\s+/g, ' ').trim().slice(0, 500)
  if (!cleanTitle || !cleanDetail) return
  if (points.some((point) => point.line === line && point.title === cleanTitle)) return
  points.push({ line, title: cleanTitle, detail: cleanDetail })
}

function explainKubeJsRegex(path: string, content: string): KubeJsExplainResult {
  const lines = content.split(/\r?\n/)
  const points: KubeJsExplainPoint[] = []
  const actions = new Set<string>()
  const warnings = new Set<string>()
  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index]
    const line = index + 1
    const event = text.match(/\b(ServerEvents|ClientEvents|StartupEvents)\.([A-Za-z0-9_]+)/)
    if (event) {
      const label =
        event[1] === 'ServerEvents'
          ? '服务端事件'
          : event[1] === 'ClientEvents'
            ? '客户端事件'
            : '启动事件'
      addPoint(
        points,
        line,
        `${label} ${event[2]}`,
        `注册 ${event[1]}.${event[2]} 回调，游戏在对应阶段执行这段逻辑。`
      )
      actions.add(`处理 ${event[2]}`)
    }
    const removeObject = text.match(
      /event\.remove\s*\(\s*\{\s*(id|output|mod)\s*:\s*['"]([^'"]+)['"]/
    )
    if (removeObject) {
      const kind = removeObject[1]
      const value = removeObject[2]
      if (kind === 'id') {
        addPoint(points, line, '删除指定配方', `删除配方 ID 为 ${value} 的配方。`)
        actions.add('删除指定配方')
      } else if (kind === 'output') {
        addPoint(points, line, '删除产出配方', `删除所有产出 ${value} 的配方。`)
        actions.add('删除物品产出配方')
      } else {
        addPoint(points, line, '删除整个模组配方', `删除命名空间 ${value} 下的全部配方。`)
        actions.add('删除整个模组配方')
        warnings.add(
          `第 ${line} 行按模组删除配方，范围较大，请确认 ${value} 的所有配方都不需要。`
        )
      }
    }
    const shaped = text.match(/event\.(shaped|shapeless)\s*\(/)
    if (shaped) {
      addPoint(
        points,
        line,
        shaped[1] === 'shaped' ? '添加有序配方' : '添加无序配方',
        shaped[1] === 'shaped'
          ? '按图案添加有序合成；检查输出数量、图案和键是否正确。'
          : '添加无序合成；检查材料与输出是否正确。'
      )
      actions.add('添加合成配方')
    }
    const tagAdd = text.match(/event\.add\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/)
    if (tagAdd) {
      addPoint(points, line, '添加标签成员', `把 ${tagAdd[2]} 加入 ${tagAdd[1]} 标签。`)
      actions.add('修改物品标签')
    }
    const tagRemove = text.match(
      /event\.remove\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/
    )
    if (tagRemove) {
      addPoint(points, line, '移除标签成员', `从 ${tagRemove[1]} 标签移除 ${tagRemove[2]}。`)
      actions.add('修改物品标签')
    }
    if (/LootJS|addLootTableModifier|removeLoot/.test(text)) {
      addPoint(points, line, '修改战利品', '使用 LootJS 调整战利品表；需要 LootJS 模组支持。')
      actions.add('修改战利品')
    }
    if (/console\.(info|log|warn)/.test(text)) {
      addPoint(points, line, '输出日志', '向游戏日志输出提示，用来确认脚本被加载或排查参数。')
    }
  }
  if (/modid|recipe_id|example/i.test(content)) {
    warnings.add('脚本里还有 modid / recipe_id / example 之类的占位符，实际生效前需要替换。')
  }
  if (path.startsWith('client_scripts/') && /ServerEvents\./.test(content)) {
    warnings.add('这是客户端脚本，但使用了 ServerEvents；服务端事件应放到 server_scripts。')
  }
  if (path.startsWith('server_scripts/') && /ClientEvents\./.test(content)) {
    warnings.add('这是服务端脚本，但使用了 ClientEvents；客户端事件应放到 client_scripts。')
  }
  if (path.startsWith('startup_scripts/') && /(ServerEvents|ClientEvents)\./.test(content)) {
    warnings.add(
      'startup_scripts 主要用于注册/启动阶段，ServerEvents/ClientEvents 通常应放到对应脚本目录。'
    )
  }
  const summary =
    actions.size > 0
      ? `这段脚本主要做：${[...actions].join('、')}。`
      : points.length > 0
        ? '这段脚本包含 KubeJS 事件代码，但没有识别到常见配方/标签操作。'
        : '没有识别到常见 KubeJS 事件；可以检查它是否是辅助函数、配置或未完成的脚本。'
  return {
    summary,
    points,
    notes: [...warnings].join('\n'),
    model: null,
    source: 'local'
  }
}

export function explainKubeJsLocal(path: string, content: string): KubeJsExplainResult {
  if (/\.js$/i.test(path)) {
    const parsed = explainKubeJsAst(path, content)
    if (parsed) return parsed
    const fallback = explainKubeJsRegex(path, content)
    fallback.notes = [
      '脚本语法有错误，以下为旧版逐行识别结果；请先在问题页修复语法。',
      fallback.notes
    ]
      .filter(Boolean)
      .join('\n')
    return fallback
  }
  return explainKubeJsRegex(path, content)
}

function stripFence(value: string): string {
  const match = value.trim().match(/```(?:json|javascript|js)?\s*([\s\S]*?)```/i)
  return match ? match[1].trim() : value.trim()
}

async function explainWithAi(request: KubeJsExplainRequest): Promise<KubeJsExplainResult> {
  const config = await getAiRuntimeConfig()
  if (!config.enabled) throw new Error('AI 辅助还没有启用')
  if (!config.baseUrl || !config.model) throw new Error('请先填写 AI 服务地址和模型')
  const content = request.content.trim()
  if (!content) throw new Error('当前脚本是空的')
  const instance = await getInstance(request.instanceId)
  const endpoint = /\/chat\/completions$/i.test(config.baseUrl)
    ? config.baseUrl
    : `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`
  const system = `你是 Minecraft KubeJS 脚本讲解器。当前实例是 Minecraft ${instance.gameVersion}，加载器 ${instance.loader}${instance.loaderVersion ? ` ${instance.loaderVersion}` : ''}。
请用中文解释给定脚本做了什么；按行指出关键行为、涉及的事件、依赖或风险。不要改写脚本，不要编造不存在的模组内容。
只返回一个 JSON 对象，不要 Markdown 代码块：{"summary":"整段脚本的一句话总结","points":[{"line":2,"title":"短标题","detail":"这一行/这一块在做什么"}],"notes":"风险、占位符或需要确认的地方"}。points 最多 24 条，line 从 1 开始。`
  const payload = JSON.stringify({ path: request.path, content: content.slice(0, 12000) }, null, 2)
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
          { role: 'user', content: payload }
        ],
        temperature: 0.1,
        max_tokens: 2200,
        stream: false
      }),
      signal: controller.signal
    })
  } catch (error) {
    if (controller.signal.aborted) throw new Error('AI 讲解超时，请检查网络或换一个模型')
    throw new Error(`无法连接 AI 服务：${error instanceof Error ? error.message : '网络错误'}`)
  } finally {
    clearTimeout(timer)
  }
  const raw = await response.text()
  if (!response.ok) throw new Error(`AI 服务返回 ${response.status}：${raw.slice(0, 240)}`)
  try {
    const parsed = JSON.parse(raw) as {
      choices?: { message?: { content?: string } }[]
      model?: string
    }
    const cleaned = stripFence(parsed.choices?.[0]?.message?.content ?? '')
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start < 0 || end <= start) throw new Error('AI 没有返回可解析的释意')
    const data = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>
    const lineCount = content.split(/\r?\n/).length
    const points: KubeJsExplainPoint[] = []
    if (Array.isArray(data.points)) {
      for (const item of data.points) {
        if (!item || typeof item !== 'object') continue
        const value = item as Record<string, unknown>
        const line =
          typeof value.line === 'number' &&
          Number.isInteger(value.line) &&
          value.line >= 1 &&
          value.line <= lineCount
            ? value.line
            : null
        addPoint(
          points,
          line,
          typeof value.title === 'string' ? value.title : '',
          typeof value.detail === 'string' ? value.detail : ''
        )
      }
    }
    return {
      summary:
        typeof data.summary === 'string' && data.summary.trim()
          ? data.summary.replace(/[\u0000-\u001f]/g, ' ').slice(0, 1200)
          : 'AI 返回了释意。',
      points,
      notes:
        typeof data.notes === 'string'
          ? data.notes.replace(/[\u0000-\u001f]/g, ' ').slice(0, 2000)
          : '',
      model: parsed.model ?? config.model,
      source: 'ai'
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('AI 没有')) throw error
    throw new Error('AI 返回的释意无法解析')
  }
}

export async function explainKubeJsScript(
  request: KubeJsExplainRequest
): Promise<KubeJsExplainResult> {
  if (request.mode === 'ai') return explainWithAi(request)
  return explainKubeJsLocal(request.path, request.content)
}
