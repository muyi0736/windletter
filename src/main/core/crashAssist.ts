import os from 'node:os'
import type {
  AiFixAction,
  CrashAssistView,
  DiagnosticIssue,
  DiagnosticReport,
  InstanceSummary,
  LauncherSettings
} from '../../shared/types'
import { availablePhysicalMemoryMb, computeAutoMemoryMb } from './autoMemory'
import { getSettings } from './config'
import { runDiagnostics } from './diagnostics'
import { getInstance } from './instances'

export interface CrashAssistTrigger {
  instanceId: string | null
  versionId: string
  kind: 'exit' | 'launch-error'
  exitCode: number | null
  message: string
}

const severityRank: Record<DiagnosticIssue['severity'], number> = {
  error: 0,
  warning: 1,
  info: 2
}

/**
 * 从本地诊断报告推导确定性修复动作（不依赖 AI）：
 * - 问题证据指向的模组 → disable_mod（服务端 applyAiFix 会再次校验）
 * - 内存类问题 → 按自动分配策略给出 set_memory 建议
 * Java 类问题不给自动动作，由界面引导去 Java 设置。
 */
export function deriveLocalActions(
  report: DiagnosticReport,
  instance: InstanceSummary,
  settings: LauncherSettings
): AiFixAction[] {
  const actions: AiFixAction[] = []
  const seen = new Set<string>()
  for (const issue of report.issues) {
    if (issue.severity === 'info') continue
    if (issue.category !== 'crash' && issue.category !== 'mods') continue
    for (const file of issue.modFiles) {
      const key = file.toLowerCase()
      if (seen.has(key) || actions.length >= 3) continue
      seen.add(key)
      actions.push({
        type: 'disable_mod',
        title: `禁用 ${file}`,
        detail: `诊断指向该模组：${issue.title}。禁用后文件保留，可随时重新启用。`,
        risk: 'medium',
        file,
        applicable: true
      })
    }
  }
  const memoryIssue = report.issues.find(
    (issue) => issue.category === 'memory' && issue.severity !== 'info'
  )
  if (memoryIssue) {
    const totalMb = Math.floor(os.totalmem() / 1024 / 1024)
    const suggested = computeAutoMemoryMb({
      modCount: instance.modCount,
      loader: instance.loader,
      availableMb: availablePhysicalMemoryMb(),
      totalMb
    })
    const current = instance.memoryMb ?? settings.maxMemoryMb
    if (suggested !== current) {
      actions.push({
        type: 'set_memory',
        title: `内存调整为 ${suggested} MB`,
        detail: `${memoryIssue.title}。按当前物理内存与模组数量重新估算。`,
        risk: 'low',
        memoryMb: suggested,
        currentMemoryMb: current,
        applicable: true
      })
    }
  }
  return actions
}

/** 崩溃/启动失败后组装弹窗载荷；诊断失败时降级为仅展示错误信息。 */
export async function buildCrashAssist(trigger: CrashAssistTrigger): Promise<CrashAssistView> {
  const base: CrashAssistView = {
    instanceId: trigger.instanceId,
    instanceName: trigger.instanceId ?? trigger.versionId,
    versionId: trigger.versionId,
    kind: trigger.kind,
    exitCode: trigger.exitCode,
    message: trigger.message,
    summary: trigger.message,
    issues: [],
    actions: [],
    lastServer: null,
    checkedAt: Date.now()
  }
  if (!trigger.instanceId) return base
  try {
    const instance = await getInstance(trigger.instanceId)
    const report = await runDiagnostics(instance.id)
    const issues = [...report.issues].sort(
      (left, right) => severityRank[left.severity] - severityRank[right.severity]
    )
    const settings = getSettings()
    return {
      ...base,
      instanceName: instance.name,
      summary: report.crash?.summary ?? issues[0]?.title ?? trigger.message,
      issues: issues.slice(0, 6),
      actions: deriveLocalActions(report, instance, settings),
      lastServer: instance.lastServer ?? null
    }
  } catch {
    return base
  }
}