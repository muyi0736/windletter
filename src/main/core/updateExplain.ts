import type {
  ContentKind,
  ContentUpdateAiSummary,
  ContentUpdateChange,
  InstanceSummary
} from '../../shared/types'
import { getAiRuntimeConfig } from './ai'
import { getContentChangelog, getLatestContentUpdate } from './contentLedger'
import { getInstance } from './instances'

const AI_TIMEOUT_MS = 60_000
const MAX_CHANGES = 24
const MAX_CHANGELOG_ITEMS = 8
const MAX_CHANGELOG_CHARS = 12_000
const PER_CHANGELOG_CHARS = 1_500

const KIND_LABELS: Record<ContentKind, string> = {
  mod: '模组',
  datapack: '数据包',
  resourcepack: '资源包',
  shader: '光影包'
}

const SYSTEM_PROMPT = `你是 Minecraft 整合包维护助手。你只会收到一次内容更新的版本变化，以及部分更新日志摘要。
请用中文回答三部分：
1. 这次更新了什么：按模组/资源包/光影包/数据包归类，概括主要版本变化和新增内容；
2. 可能的影响与风险：更可能的玩法变化、兼容性、配置迁移、性能或依赖风险；
3. 更新后建议检查什么：给玩家和维护者少量可执行的检查项。
只使用提供的信息，不要编造更新日志或模组功能；没有更新日志时要明确说“缺少更新日志”，并根据版本号做有限推断。用简洁的分点，不要使用 Markdown 表格。`

function versionText(value: string | null): string {
  return value && value.trim() ? value.trim() : '未知版本'
}

function localSummary(
  instance: InstanceSummary,
  changes: ContentUpdateChange[],
  createdAt: number
): string {
  const counts = new Map<ContentKind, number>()
  for (const change of changes) counts.set(change.kind, (counts.get(change.kind) ?? 0) + 1)
  const countText = [...counts.entries()]
    .map(([kind, count]) => `${KIND_LABELS[kind]} ${count}`)
    .join('、')
  const lines = [
    `${instance.name} 最近一次内容更新（${new Date(createdAt).toLocaleString('zh-CN')}）`,
    `共 ${changes.length} 项${countText ? `：${countText}` : ''}。`
  ]
  for (const change of changes.slice(0, 40)) {
    lines.push(
      `- [${KIND_LABELS[change.kind]}] ${change.title}: ${versionText(
        change.fromVersion
      )} → ${versionText(change.toVersion)}`
    )
  }
  if (changes.length > 40) lines.push(`- 其余 ${changes.length - 40} 项未展开`)
  lines.push('更新前已保存文件备份和已知可运行快照，可在实例内容页回滚上次更新。')
  return lines.join('\n')
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/sk-[A-Za-z0-9_-]+/g, '[已隐藏]').slice(0, 240)
}

async function fetchChangelogExcerpts(
  changes: ContentUpdateChange[]
): Promise<{ excerpts: (string | null)[]; warnings: string[] }> {
  const excerpts: (string | null)[] = changes.map(() => null)
  const warnings: string[] = []
  const tasks = changes
    .map((change, index) => ({ change, index }))
    .filter(
      ({ change, index }) =>
        index < MAX_CHANGELOG_ITEMS &&
        Boolean(change.provider && change.projectId && change.toVersionId)
    )
  const results = await Promise.allSettled(
    tasks.map(async ({ change }) => {
      const view = await getContentChangelog(
        change.provider as NonNullable<ContentUpdateChange['provider']>,
        change.projectId as string,
        change.toVersionId
      )
      return view
    })
  )
  let total = 0
  for (let index = 0; index < tasks.length; index += 1) {
    const task = tasks[index]
    const result = results[index]
    if (result.status === 'rejected') {
      warnings.push(`读取 ${task.change.title} 的更新日志失败`)
      continue
    }
    const raw = result.value.changelog.trim()
    if (!raw) {
      warnings.push(`${task.change.title} 没有提供更新日志`)
      continue
    }
    const remaining = MAX_CHANGELOG_CHARS - total
    if (remaining <= 0) {
      warnings.push('更新日志总量较大，只保留了前几条摘要')
      break
    }
    const excerpt = raw.slice(0, Math.min(PER_CHANGELOG_CHARS, remaining))
    excerpts[task.index] = excerpt
    total += excerpt.length
  }
  return { excerpts, warnings }
}

function buildLocalResult(
  instance: InstanceSummary,
  changes: ContentUpdateChange[],
  createdAt: number,
  warnings: string[],
  sentBytes = 0
): ContentUpdateAiSummary {
  return {
    summary: localSummary(instance, changes, createdAt),
    model: null,
    localOnly: true,
    warnings,
    sentBytes,
    generatedAt: Date.now()
  }
}

export async function explainContentUpdate(
  instanceId: string
): Promise<ContentUpdateAiSummary> {
  const instance = await getInstance(instanceId)
  const latest = await getLatestContentUpdate(instanceId)
  if (!latest) {
    return {
      summary: '这个实例还没有可解读的内容更新记录。',
      model: null,
      localOnly: true,
      warnings: ['请先在实例内容页执行一次内容更新。'],
      sentBytes: 0,
      generatedAt: Date.now()
    }
  }
  if (latest.changes.length === 0) {
    return buildLocalResult(instance, [], latest.createdAt, [
      '这次更新没有记录到具体文件变化，只能说明更新已完成。'
    ])
  }

  const config = await getAiRuntimeConfig()
  if (!config.enabled || !config.baseUrl || !config.model) {
    return buildLocalResult(instance, latest.changes, latest.createdAt, [
      config.enabled
        ? 'AI 服务地址或模型尚未填写，当前显示本地变更摘要。'
        : 'AI 辅助还没有启用，当前显示本地变更摘要。'
    ])
  }

  const { excerpts, warnings } = await fetchChangelogExcerpts(latest.changes)
  if (!excerpts.some((excerpt) => excerpt)) {
    warnings.push('本次更新没有可用的在线更新日志，AI 只能根据版本号做有限总结。')
  }
  const contextChanges = latest.changes.slice(0, MAX_CHANGES).map((change, index) => ({
    kind: KIND_LABELS[change.kind],
    title: change.title,
    fromVersion: versionText(change.fromVersion),
    toVersion: versionText(change.toVersion),
    changelog: excerpts[index] ?? null
  }))
  const payload = JSON.stringify(
    {
      instance: {
        gameVersion: instance.gameVersion,
        loader: instance.loader,
        loaderVersion: instance.loaderVersion
      },
      updatedAt: new Date(latest.createdAt).toISOString(),
      changes: contextChanges
    },
    null,
    2
  )
  const sentBytes = Buffer.byteLength(payload, 'utf8')
  const endpoint = /\/chat\/completions$/i.test(config.baseUrl)
    ? config.baseUrl
    : `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS)
  try {
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
            { role: 'user', content: payload }
          ],
          temperature: 0.2,
          max_tokens: 1400,
          stream: false
        }),
        signal: controller.signal
      })
    } catch (error) {
      if (controller.signal.aborted) {
        return buildLocalResult(instance, latest.changes, latest.createdAt, [
          ...warnings,
          'AI 解读超时，已返回本地变更摘要。'
        ], sentBytes)
      }
      return buildLocalResult(instance, latest.changes, latest.createdAt, [
        ...warnings,
        `无法连接 AI 服务，已返回本地变更摘要：${friendlyError(error)}`
      ], sentBytes)
    }

    if (!response.ok) {
      return buildLocalResult(instance, latest.changes, latest.createdAt, [
        ...warnings,
        `AI 服务返回 HTTP ${response.status}，已返回本地变更摘要。`
      ], sentBytes)
    }
    const raw = await response.text()
    let content = ''
    let model = config.model
    try {
      const data = JSON.parse(raw) as {
        model?: string
        choices?: { message?: { content?: string } }[]
      }
      content = data.choices?.[0]?.message?.content ?? ''
      if (typeof data.model === 'string' && data.model.trim()) model = data.model
    } catch {
      content = ''
    }
    if (!content.trim()) {
      return buildLocalResult(instance, latest.changes, latest.createdAt, [
        ...warnings,
        'AI 服务没有返回解读内容，已返回本地变更摘要。'
      ], sentBytes)
    }
    return {
      summary: content.trim().slice(0, 20_000),
      model,
      localOnly: false,
      warnings,
      sentBytes,
      generatedAt: Date.now()
    }
  } finally {
    clearTimeout(timer)
  }
}
