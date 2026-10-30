import type { KubeJsRuntimeIssue } from '../../shared/types'

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g
const SCRIPT_REFERENCE =
  /((?:server_scripts|startup_scripts|client_scripts)[/\\][^\s:()"'`]+?\.js)(?:[:#](\d+))?(?::(\d+))?/i
const LEVEL_TAG = /\[(?:[^\]]*\/)?(ERROR|WARN(?:ING)?|FATAL|INFO|DEBUG|TRACE)\]/i
const ERROR_LEVEL = /\b(?:ERROR|FATAL)\b|Exception|Error:|Failed to|Couldn't|Could not|Unable to/i
const WARN_LEVEL = /\bWARN(?:ING)?\b/i
const RELEVANT = /\bkubejs\b|script|recipe|tag|datapack/i
const MAX_ISSUES = 50

function levelOf(line: string): KubeJsRuntimeIssue['level'] | null {
  const tag = LEVEL_TAG.exec(line)?.[1]?.toUpperCase()
  if (tag) {
    if (tag === 'ERROR' || tag === 'FATAL') return 'error'
    if (tag.startsWith('WARN')) return 'warning'
    return null
  }
  if (ERROR_LEVEL.test(line)) return 'error'
  if (WARN_LEVEL.test(line)) return 'warning'
  return null
}

function cleanLine(value: string): string {
  return value.replace(ANSI, '').replace(/\r/g, '').trimEnd().slice(0, 500)
}

/** 从临时服务端日志里提取 KubeJS 脚本/配方/标签错误，保留脚本行号用于跳转。 */
export function parseKubeJsRuntimeIssues(log: string): KubeJsRuntimeIssue[] {
  const issues: KubeJsRuntimeIssue[] = []
  const seen = new Set<string>()
  for (const raw of log.split(/\r?\n/)) {
    const line = cleanLine(raw)
    if (!line) continue
    const reference = SCRIPT_REFERENCE.exec(line)
    if (!reference && !/\bkubejs\b/i.test(line)) continue
    if (!RELEVANT.test(line) && !reference) continue
    const level = levelOf(line)
    if (!level) continue
    const path = reference?.[1]?.replace(/\\/g, '/') ?? null
    const lineNo = reference?.[2] ? Number(reference[2]) : null
    const column = reference?.[3] ? Number(reference[3]) : null
    const message = line.slice(0, 600)
    const key = `${level}|${path ?? ''}|${lineNo ?? ''}|${message.slice(0, 120)}`
    if (seen.has(key)) continue
    seen.add(key)
    issues.push({
      level,
      message,
      path,
      line: Number.isFinite(lineNo) ? lineNo : null,
      column: Number.isFinite(column) ? column : null
    })
    if (issues.length >= MAX_ISSUES) break
  }
  return issues
}
