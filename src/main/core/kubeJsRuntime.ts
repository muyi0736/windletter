import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  KubeJsRuntimeProgress,
  KubeJsRuntimeReport,
  ServerPackCheckItem
} from '../../shared/types'
import { getCacheDir } from './config'
import { getInstance } from './instances'
import { CancellationError } from './net'
import { listKubeJsFiles } from './packWorkshop'
import { createServerPack, previewServerPack } from './serverPack'
import { verifyServerPack } from './serverPackCheck'
import { parseKubeJsRuntimeIssues } from './kubeJsRuntimeLog'

const RUNTIME_LOADERS = new Set(['fabric', 'forge', 'neoforge'])

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function item(
  id: string,
  title: string,
  tone: ServerPackCheckItem['tone'],
  detail: string
): ServerPackCheckItem {
  return { id, title, tone, detail }
}

function emptyReport(
  summary: string,
  checks: ServerPackCheckItem[],
  scriptCount = 0,
  clientScriptCount = 0
): KubeJsRuntimeReport {
  return {
    ok: false,
    cancelled: false,
    summary,
    durationMs: 0,
    checks,
    issues: [],
    logPath: null,
    logTail: '',
    scriptCount,
    clientScriptCount
  }
}

export async function verifyKubeJsRuntime(
  instanceId: string,
  onProgress: (progress: KubeJsRuntimeProgress) => void,
  signal: AbortSignal
): Promise<KubeJsRuntimeReport> {
  const startedAt = Date.now()
  const instance = await getInstance(instanceId)
  if (!RUNTIME_LOADERS.has(instance.loader)) {
    return emptyReport(
      '当前加载器暂不支持实际运行验证；请使用 Fabric / Forge / NeoForge 实例。',
      [item('loader', '加载器', 'fail', `当前为 ${instance.loader}，无法启动临时服务端。`)]
    )
  }

  const files = await listKubeJsFiles(instanceId).catch(() => null)
  const scripts = (files?.files ?? []).filter((file) => /\.js$/i.test(file.path))
  const serverScripts = scripts.filter((file) => /^(?:server_scripts|startup_scripts)\//.test(file.path))
  const clientScripts = scripts.filter((file) => /^client_scripts\//.test(file.path))
  if (serverScripts.length === 0) {
    return emptyReport(
      clientScripts.length > 0
        ? '没有服务端/启动脚本可验证；client_scripts 只在客户端执行，不会被临时服务端加载。'
        : '没有找到 KubeJS 服务端/启动脚本。',
      [
        item(
          'scripts',
          'KubeJS 脚本',
          clientScripts.length > 0 ? 'warn' : 'fail',
          clientScripts.length > 0
            ? `${clientScripts.length} 个客户端脚本不会在服务端执行。`
            : 'kubejs/server_scripts 与 kubejs/startup_scripts 均为空。'
        )
      ],
      0,
      clientScripts.length
    )
  }

  const preview = await previewServerPack(instanceId)
  const hasKubeJsMod = preview.mods.some(
    (mod) => /kubejs/i.test(mod.id ?? '') || /kubejs/i.test(mod.file)
  )
  if (!hasKubeJsMod) {
    return emptyReport(
      '实例模组里没有检测到 KubeJS，实际运行不会加载这些脚本。',
      [item('kubejs-mod', 'KubeJS 模组', 'fail', '请先安装 KubeJS 再运行验证。')],
      serverScripts.length,
      clientScripts.length
    )
  }

  const includeSet = new Set(preview.mods.filter((mod) => mod.include).map((mod) => mod.file))
  for (const mod of preview.mods) {
    if (/kubejs/i.test(mod.id ?? '') || /kubejs/i.test(mod.file)) includeSet.add(mod.file)
  }
  const includeMods = [...includeSet]
  const zipPath = join(getCacheDir(), `kubejs-runtime-${randomUUID()}.zip`)
  const checks: ServerPackCheckItem[] = []
  let logPath: string | null = null
  let logTail = ''

  const progress = (stage: string, percent: number, line: string | null = null): void => {
    try {
      onProgress({ stage, percent: clampPercent(percent), line })
    } catch {
      /* renderer may be closed */
    }
  }

  try {
    progress('准备临时服务端', 2)
    await createServerPack(
      {
        instanceId,
        outputPath: zipPath,
        includeMods,
        includeConfigs: true,
        includeBootstrap: true,
        properties: {
          motd: 'Windletter KubeJS runtime check',
          port: 25565,
          maxPlayers: 1,
          onlineMode: false,
          viewDistance: 2
        }
      },
      (task) => {
        progress(
          task.stage,
          4 + Math.min(22, Math.round((task.percent / 100) * 22)),
          null
        )
      },
      signal
    )
    checks.push(
      item('server-pack', '临时服务端包', 'pass', `包含 ${includeMods.length} 个服务端模组与 KubeJS 配置。`)
    )
    if (signal.aborted) throw new CancellationError()

    const verification = await verifyServerPack(
      instanceId,
      zipPath,
      (next) => {
        progress(
          next.stage,
          26 + Math.min(68, Math.round((next.percent / 100) * 68)),
          next.line
        )
      },
      signal
    )
    logPath = verification.logPath
    logTail = verification.logTail

    let fullLog = verification.logTail
    if (verification.logPath) {
      fullLog = await fs.readFile(verification.logPath, 'utf8').catch(() => verification.logTail)
    }
    progress('分析 KubeJS 日志', 97)
    const issues = parseKubeJsRuntimeIssues(fullLog)
    const errors = issues.filter((issue) => issue.level === 'error')
    const warnings = issues.filter((issue) => issue.level === 'warning')
    if (verification.ok) {
      checks.push(
        item(
          'kubejs-load',
          'KubeJS 实际加载',
          errors.length > 0 ? 'fail' : warnings.length > 0 ? 'warn' : 'pass',
          errors.length > 0
            ? `${errors.length} 个错误，${warnings.length} 个警告。`
            : warnings.length > 0
              ? `${warnings.length} 个警告；没有发现错误。`
              : `${serverScripts.length} 个服务端/启动脚本已随服务端加载。`
        )
      )
    } else {
      checks.push(
        item(
          'kubejs-load',
          'KubeJS 实际加载',
          errors.length > 0 ? 'fail' : 'warn',
          errors.length > 0
            ? `${errors.length} 个错误，${warnings.length} 个警告。`
            : '服务端未完成启动，未能确认 KubeJS 脚本是否加载。'
        )
      )
    }
    if (clientScripts.length > 0) {
      checks.push(
        item(
          'client-scripts',
          '客户端脚本',
          'warn',
          `${clientScripts.length} 个 client_scripts 只在客户端执行，本次服务端验证不会运行它们。`
        )
      )
    }

    const ok = verification.ok && errors.length === 0 && !verification.cancelled
    const summary = verification.cancelled
      ? '实际运行验证已取消。'
      : !verification.ok
        ? `服务端验证未通过：${verification.summary}`
        : errors.length > 0
          ? `实际运行发现 ${errors.length} 个 KubeJS 错误。`
          : warnings.length > 0
            ? `实际运行通过，${warnings.length} 个 KubeJS 警告。`
            : `实际运行通过，${serverScripts.length} 个脚本加载正常。`
    progress(verification.cancelled ? '已取消' : ok ? '验证通过' : '验证未通过', 100)
    return {
      ok,
      cancelled: verification.cancelled,
      summary,
      durationMs: Math.max(0, Date.now() - startedAt),
      checks: [...verification.checks, ...checks],
      issues,
      logPath,
      logTail: verification.logTail,
      scriptCount: serverScripts.length,
      clientScriptCount: clientScripts.length
    }
  } catch (error) {
    if (error instanceof CancellationError || signal.aborted) {
      progress('已取消', 100)
      return {
        ok: false,
        cancelled: true,
        summary: '实际运行验证已取消。',
        durationMs: Math.max(0, Date.now() - startedAt),
        checks: [...checks, item('cancelled', '运行验证', 'warn', '已取消。')],
        issues: [],
        logPath,
        logTail,
        scriptCount: serverScripts.length,
        clientScriptCount: clientScripts.length
      }
    }
    const message = error instanceof Error ? error.message : '实际运行验证失败'
    progress('验证失败', 100)
    return {
      ok: false,
      cancelled: false,
      summary: message,
      durationMs: Math.max(0, Date.now() - startedAt),
      checks: [...checks, item('runtime-error', '实际运行', 'fail', message)],
      issues: [],
      logPath,
      logTail,
      scriptCount: serverScripts.length,
      clientScriptCount: clientScripts.length
    }
  } finally {
    await fs.rm(zipPath, { force: true }).catch(() => undefined)
  }
}
