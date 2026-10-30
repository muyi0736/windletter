import os from 'node:os'
import type { AiCause, AiDiagnosisView, DiagnosticReport } from '../../shared/types'
import { getAiRuntimeConfig } from './ai'
import { getSettings } from './config'
import { runDiagnostics } from './diagnostics'
import { getInstance } from './instances'
import { listInstalledMods } from './mods'

const MAX_EXCERPT = 8_000
const MAX_MODS = 320
const TIMEOUT_MS = 75_000

const SYSTEM_PROMPT = `你是 Minecraft Java 版启动器的故障诊断专家。你会收到一个整合包实例的元数据、本地规则引擎的诊断结果、最近一次崩溃日志的尾部，以及模组文件名。
请只依据提供的信息推断，不要编造日志中没有出现的错误。如果信息不足，请在 summary 中明确说明，并给出下一步应该查看什么。
不要建议删除存档、重装系统、关闭杀毒软件或执行其他高风险操作。建议要具体、可执行、按优先级排序。
只返回一个 JSON 对象，不要 Markdown 代码块，格式如下：
{
  "summary": "一句话结论",
  "confidence": "low | medium | high",
  "causes": [
    {
      "title": "最可能的原因",
      "detail": "为什么这样判断",
      "evidence": "日志中的关键行或证据（可以为空字符串）",
      "fix": "具体怎么修"
    }
  ],
  "checks": ["接下来还应该检查什么"]
}
causes 最多 4 条，checks 最多 5 条。

判断纪律：
- 本地 localDiagnosis.status 为 healthy 或 warning 时，不要使用“确定/一定会/拒绝启动/无法启动”这类断言；没有 lastCrash 时先说明游戏可能可以正常启动。
- 重复 Mod ID 在部分加载器中只会告警或跳过；如果用户能正常游玩，不要建议立刻禁用或删除。
- launchHistory.matchesCurrentConfig 为 true 时，这组模组和启动配置曾经成功进入游戏：不要因为本地规则里的提示断言它现在无法启动，排查重点应放在最近崩溃或本次日志上。
- launchHistory.matchesCurrentConfig 为 false 且 changes 里有新增/替换的模组时，可以把它们列为优先排查对象，但不要断言它们一定导致了问题。
- launchHistory.matchesCurrentConfig 为 false 但 changes 三个数组都为空时，说明只是内存、Java、JVM 参数或加载器版本变化，不要臆测模组更替。
- 只有日志里出现明确的致命异常时，才把某个原因写成高置信度。`

export async function analyzeWithAi(instanceId: string): Promise<AiDiagnosisView> {
  const config = await getAiRuntimeConfig()
  if (!config.enabled) throw new Error('AI 辅助诊断还没有启用')
  if (!config.baseUrl || !config.model) throw new Error('请先填写 AI 服务地址和模型')

  const instance = await getInstance(instanceId)
  const settings = getSettings()
  const report = await runDiagnostics(instanceId)
  const mods = await listInstalledMods(instanceId)

  const payload = buildContext(instance, settings, report, mods)
  const prompt = JSON.stringify(payload, null, 2)
  const sentBytes = Buffer.byteLength(prompt, 'utf8')
  const endpoint = /\/chat\/completions$/i.test(config.baseUrl)
    ? config.baseUrl
    : `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
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
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt }
        ],
        temperature: 0.2,
        max_tokens: 1500,
        stream: false
      }),
      signal: controller.signal
    })
  } catch (error) {
    if (controller.signal.aborted) throw new Error('AI 分析超时，请检查网络或换一个模型')
    throw new Error(`无法连接 AI 服务：${error instanceof Error ? error.message : '网络错误'}`)
  } finally {
    clearTimeout(timer)
  }

  const responseText = await response.text()
  let data: unknown = null
  try {
    data = JSON.parse(responseText)
  } catch {
    /* keep raw */
  }
  if (!response.ok) {
    const message =
      data && typeof data === 'object'
        ? String(
            (data as { error?: { message?: unknown } }).error?.message ??
              (data as { message?: unknown }).message ??
              ''
          )
        : ''
    throw new Error(friendlyHttpError(response.status, message))
  }

  const record = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const choices = Array.isArray(record.choices) ? record.choices : []
  const first = (choices[0] && typeof choices[0] === 'object' ? choices[0] : {}) as Record<
    string,
    unknown
  >
  const message = (first.message && typeof first.message === 'object' ? first.message : {}) as Record<
    string,
    unknown
  >
  const content = typeof message.content === 'string' ? message.content : ''
  if (!content.trim()) throw new Error('AI 服务没有返回分析内容')

  const parsed = parseAiJson(content)
  return {
    model: typeof record.model === 'string' ? record.model : config.model,
    summary: parsed.summary,
    confidence: parsed.confidence,
    causes: parsed.causes,
    checks: parsed.checks,
    raw: parsed.raw,
    sentBytes,
    sentAt: Date.now()
  }
}

function buildContext(
  instance: Awaited<ReturnType<typeof getInstance>>,
  settings: ReturnType<typeof getSettings>,
  report: DiagnosticReport,
  mods: Awaited<ReturnType<typeof listInstalledMods>>
) {
  const excerpt = report.crash?.excerpt.slice(-60).join('\n').slice(-MAX_EXCERPT) ?? ''
  return {
    instance: {
      name: instance.name,
      gameVersion: instance.gameVersion,
      loader: instance.loader,
      loaderVersion: instance.loaderVersion,
      modCount: instance.modCount,
      allocatedMemoryMb: instance.memoryMb ?? settings.maxMemoryMb,
      javaMajor: instance.javaMajor,
      lastPlayed: instance.lastPlayed,
      external: Boolean(instance.external)
    },
    system: {
      platform: process.platform,
      arch: process.arch,
      os: `${os.type()} ${os.release()}`,
      totalMemoryGb: Math.round((os.totalmem() / 1024 / 1024 / 1024) * 10) / 10
    },
    launchHistory: {
      matchesCurrentConfig: report.knownGoodMatch,
      knownGood: report.knownGood
        ? {
            recordedAt: report.knownGood.recordedAt,
            modCount: report.knownGood.modCount,
            gameVersion: report.knownGood.gameVersion,
            loader: report.knownGood.loader,
            javaMajor: report.knownGood.javaMajor,
            memoryMb: report.knownGood.memoryMb
          }
        : null,
      changes: report.changes
        ? {
            added: report.changes.added.slice(0, 30).map(sanitize),
            removed: report.changes.removed.slice(0, 30).map(sanitize),
            changed: report.changes.changed.slice(0, 30).map(sanitize)
          }
        : null
    },
    localDiagnosis: {
      status: report.status,
      ignoredCount: report.ignoredCount,
      issues: report.issues.slice(0, 20).map((issue) => ({
        severity: issue.severity,
        category: issue.category,
        title: sanitize(issue.title),
        detail: sanitize(issue.detail),
        evidence: issue.evidence.slice(0, 6).map(sanitize)
      }))
    },
    lastCrash: report.crash
      ? {
          file: report.crash.file,
          createdAt: report.crash.createdAt,
          summary: sanitize(report.crash.summary ?? ''),
          issues: report.crash.issues.slice(0, 10).map((issue) => ({
            severity: issue.severity,
            title: sanitize(issue.title),
            detail: sanitize(issue.detail),
            evidence: issue.evidence.slice(0, 6).map(sanitize)
          })),
          excerpt: sanitize(excerpt)
        }
      : null,
    modFiles: mods
      .slice(0, MAX_MODS)
      .map((mod) => `${mod.enabled ? '' : '[disabled] '}${sanitize(mod.file)}`)
  }
}

function sanitize(value: string): string {
  let text = value
  const username = os.userInfo().username
  if (username && username.length > 2) {
    text = text.replace(new RegExp(escapeRegExp(username), 'gi'), '%USER%')
  }
  text = text
    .replace(/([A-Za-z]:\\Users\\)[^\\\s]+/gi, '$1%USER%')
    .replace(/(\/Users\/)[^/\s]+/g, '$1%USER%')
    .replace(/--accessToken\s+\S+/gi, '--accessToken [REDACTED]')
    .replace(/--username\s+\S+/gi, '--username [REDACTED]')
    .replace(/--uuid\s+\S+/gi, '--uuid [REDACTED]')
    .replace(/--xuid\s+\S+/gi, '--xuid [REDACTED]')
    .replace(/--clientId\s+\S+/gi, '--clientId [REDACTED]')
    .replace(/--server\s+\S+/gi, '--server [REDACTED]')
    .replace(/Setting user:\s*\S+/gi, 'Setting user: [REDACTED]')
    .replace(/((?:Server address|Connecting to|Resolved server address):?\s*)\S+/gi, '$1[REDACTED]')
    .replace(/token:[^:\s]+:[A-Za-z0-9.-]+/g, 'token:[REDACTED]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b/g, '[IP]')
  return text.slice(0, 20_000)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function friendlyHttpError(status: number, message: string): string {
  if (status === 401 || status === 403) return 'AI 服务拒绝了请求，API Key 可能无效或没有权限'
  if (status === 404) return 'AI 接口地址或模型不存在，请检查服务地址和模型名'
  if (status === 429) return 'AI 请求过于频繁或额度不足，请稍后再试'
  return `AI 服务返回 ${status}${message ? `：${message.slice(0, 160)}` : ''}`
}

function parseAiJson(content: string): {
  summary: string
  confidence: 'low' | 'medium' | 'high' | null
  causes: AiCause[]
  checks: string[]
  raw: string | null
} {
  const cleaned = content
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim()
  const objectText = extractJsonObject(cleaned)
  const candidates = [objectText, cleaned].filter(
    (value): value is string => Boolean(value && value.trim())
  )
  for (const candidate of candidates) {
    for (const attempt of [candidate, repairJson(candidate)]) {
      try {
        const data = JSON.parse(attempt) as Record<string, unknown>
        return normalizeAiResult(data)
      } catch {
        /* try next */
      }
    }
  }
  return {
    summary: 'AI 返回了未结构化的内容，请展开下方原始返回查看。',
    confidence: null,
    causes: [],
    checks: [],
    raw: cleaned.slice(0, 6000)
  }
}

function normalizeAiResult(data: Record<string, unknown>): {
  summary: string
  confidence: 'low' | 'medium' | 'high' | null
  causes: AiCause[]
  checks: string[]
  raw: string | null
} {
  const summary =
    typeof data.summary === 'string' && data.summary.trim()
      ? data.summary.trim().slice(0, 800)
      : 'AI 返回了分析结果'
  const confidence =
    data.confidence === 'high' || data.confidence === 'medium' || data.confidence === 'low'
      ? data.confidence
      : null
  const causes: AiCause[] = Array.isArray(data.causes)
    ? data.causes
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
        .slice(0, 4)
        .map((item) => ({
          title: textField(item.title, '可能原因', 160),
          detail: textField(item.detail, '', 800),
          evidence: textField(item.evidence, '', 600),
          fix: textField(item.fix, '', 800)
        }))
    : []
  const checks = Array.isArray(data.checks)
    ? data.checks
        .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
        .slice(0, 5)
        .map((item) => item.trim().slice(0, 300))
    : []
  return { summary, confidence, causes, checks, raw: null }
}

function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, index + 1)
    }
  }
  return null
}

function repairJson(text: string): string {
  return text
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/,\s*([}\]])/g, '$1')
}

function textField(value: unknown, fallback: string, max: number): string {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, max)
    : fallback
}
