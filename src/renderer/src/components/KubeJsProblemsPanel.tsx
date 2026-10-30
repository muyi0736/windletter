import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileCode2,
  Play,
  RefreshCw,
  ScanSearch,
  Terminal,
  WandSparkles
} from 'lucide-react'
import type {
  InstanceSummary,
  KubeJsIssue,
  KubeJsLogReport,
  KubeJsProjectLintResult
} from '@shared/types'
import { cleanError, formatDateTime } from '../lib/format'
import { Modal, Spinner } from './ui'
import { DiffView } from './KubeJsHistoryModal'
import type { KubeJsDiagnostic } from './KubeJsCodeEditor'

interface FixDraftItem {
  key: number
  issue: KubeJsDiagnostic
  from: number
  to: number
  original: string
  replacement: string
  title: string
}

interface FixDraft {
  content: string
  items: FixDraftItem[]
}

type PanelMode = 'static' | 'logs'
type StaticScope = 'file' | 'project'

const SOURCE_LABELS: Record<string, string> = {
  syntax: '语法',
  event: '事件',
  side: '脚本侧',
  item: '物品',
  recipe: '配方',
  tag: '标签',
  api: 'API'
}

const LOG_SOURCE_LABELS: Record<string, string> = {
  server: 'server',
  client: 'client',
  startup: 'startup',
  latest: 'latest.log'
}

function severityLabel(severity: string): string {
  return severity === 'error' ? '错误' : severity === 'warning' ? '警告' : '提示'
}

function countIssues(issues: KubeJsIssue[]): { errors: number; warnings: number } {
  let errors = 0
  let warnings = 0
  for (const issue of issues) {
    if (issue.severity === 'error') errors += 1
    else if (issue.severity === 'warning') warnings += 1
  }
  return { errors, warnings }
}

function applyFixItems(
  content: string,
  items: FixDraftItem[]
): { after: string; error: string | null } {
  const sorted = [...items].sort((left, right) => left.from - right.from || left.to - right.to)
  for (let index = 0; index < sorted.length; index += 1) {
    const item = sorted[index]
    if (
      item.from < 0 ||
      item.to > content.length ||
      item.from >= item.to ||
      content.slice(item.from, item.to) !== item.original
    ) {
      return { after: content, error: '脚本内容已经变化，请关闭后重新检查再修复' }
    }
    if (index > 0 && item.from < sorted[index - 1].to) {
      return { after: content, error: '两处修复范围重叠，请逐项应用' }
    }
  }
  let after = content
  for (const item of [...sorted].reverse()) {
    after = `${after.slice(0, item.from)}${item.replacement}${after.slice(item.to)}`
  }
  return { after, error: null }
}

export function KubeJsProblemsPanel({
  instance,
  active,
  activePath,
  content,
  diagnostics,
  indexReady,
  overrides,
  onOpen,
  onApplyFixes,
  onMoveFix,
  onRuntimeCheck
}: {
  instance: InstanceSummary | null
  active: boolean
  activePath: string
  content: string
  diagnostics: KubeJsDiagnostic[]
  indexReady: boolean
  overrides: { path: string; content: string }[]
  onOpen: (path: string, line: number, column?: number) => void
  onApplyFixes: (changes: { from: number; to: number; text: string }[]) => void
  onMoveFix: (targetPath: string) => void
  onRuntimeCheck: () => void
}) {
  const [mode, setMode] = useState<PanelMode>('static')
  const [scope, setScope] = useState<StaticScope>('file')
  const [onlyErrors, setOnlyErrors] = useState(false)
  const [project, setProject] = useState<KubeJsProjectLintResult | null>(null)
  const [scanning, setScanning] = useState(false)
  const [projectError, setProjectError] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [logs, setLogs] = useState<KubeJsLogReport | null>(null)
  const [logBusy, setLogBusy] = useState(false)
  const [logError, setLogError] = useState('')
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set())
  const [fixDraft, setFixDraft] = useState<FixDraft | null>(null)
  const [fixSelected, setFixSelected] = useState<Set<number>>(new Set())
  const [fixError, setFixError] = useState('')
  const instanceRef = useRef(instance)
  instanceRef.current = instance
  const overridesRef = useRef(overrides)
  overridesRef.current = overrides

  const activeIssues = useMemo(
    () =>
      onlyErrors
        ? diagnostics.filter((issue) => issue.severity === 'error')
        : diagnostics,
    [diagnostics, onlyErrors]
  )
  const activeCounts = useMemo(() => countIssues(diagnostics), [diagnostics])
  const fixableIssues = useMemo(() => {
    const items: FixDraftItem[] = []
    const seen = new Set<string>()
    activeIssues.forEach((issue, index) => {
      const fix = issue.fix
      if (!fix || fix.kind !== 'replace') return
      if (
        issue.from < 0 ||
        issue.to > content.length ||
        issue.from >= issue.to ||
        content.slice(issue.from, issue.to) !== fix.original
      ) {
        return
      }
      const dedupe = `${issue.from}:${issue.to}:${fix.replacement}`
      if (seen.has(dedupe)) return
      seen.add(dedupe)
      items.push({
        key: index,
        issue,
        from: issue.from,
        to: issue.to,
        original: fix.original,
        replacement: fix.replacement,
        title: fix.title
      })
    })
    return items
  }, [activeIssues, content])

  const projectIssues = useMemo(() => {
    if (!project) return []
    if (!onlyErrors) return project.files
    return project.files
      .map((file) => ({
        ...file,
        issues: file.issues.filter((issue) => issue.severity === 'error'),
        errorCount: file.issues.filter((issue) => issue.severity === 'error').length,
        warningCount: 0
      }))
      .filter((file) => file.issues.length > 0)
  }, [project, onlyErrors])

  useEffect(() => {
    if (!active) return
    setProject(null)
    setProjectError('')
    setLogs(null)
    setLogError('')
    setExpandedLogs(new Set())
    setScope('file')
    setMode('static')
  }, [active, instance?.id])

  useEffect(() => {
    setFixDraft(null)
    setFixSelected(new Set())
    setFixError('')
  }, [activePath])

  const scanProject = async () => {
    const current = instanceRef.current
    if (!current || scanning) return
    setScanning(true)
    setProjectError('')
    try {
      const result = await window.ccl.workshop.kubejsLintProject({
        instanceId: current.id,
        overrides: overridesRef.current
      })
      setProject(result)
      setScope('project')
      setCollapsed(new Set())
    } catch (cause) {
      setProjectError(cleanError(cause))
    } finally {
      setScanning(false)
    }
  }

  const openFixModal = () => {
    if (fixableIssues.length === 0) return
    setFixDraft({ content, items: fixableIssues })
    setFixSelected(new Set(fixableIssues.map((item) => item.key)))
    setFixError('')
  }

  const toggleFixItem = (key: number) => {
    setFixSelected((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const selectAllFixes = (selected: boolean) => {
    setFixSelected(
      selected && fixDraft ? new Set(fixDraft.items.map((item) => item.key)) : new Set()
    )
  }

  const closeFixModal = () => {
    setFixDraft(null)
    setFixSelected(new Set())
    setFixError('')
  }

  const applySelectedFixes = () => {
    if (!fixDraft) return
    const items = fixDraft.items.filter((item) => fixSelected.has(item.key))
    if (items.length === 0) {
      setFixError('请至少勾选一处修复')
      return
    }
    const preview = applyFixItems(content, items)
    if (preview.error) {
      setFixError(preview.error)
      return
    }
    onApplyFixes(
      [...items]
        .sort((left, right) => left.from - right.from)
        .map((item) => ({ from: item.from, to: item.to, text: item.replacement }))
    )
    closeFixModal()
  }

  const selectedFixItems = fixDraft
    ? fixDraft.items.filter((item) => fixSelected.has(item.key))
    : []
  const fixPreview = fixDraft
    ? applyFixItems(fixDraft.content, selectedFixItems)
    : null

  const loadLogs = async (force = false) => {
    const current = instanceRef.current
    if (!current || (logBusy && !force)) return
    setLogBusy(true)
    setLogError('')
    try {
      const report = await window.ccl.workshop.kubejsLogs(current.id)
      setLogs(report)
    } catch (cause) {
      setLogError(cleanError(cause))
    } finally {
      setLogBusy(false)
    }
  }

  useEffect(() => {
    if (!active || mode !== 'logs' || !instance) return
    if (logs?.instanceId === instance.id) return
    void loadLogs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, mode, instance?.id])

  const toggleCollapse = (path: string) => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const toggleLog = (id: string) => {
    setExpandedLogs((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const logErrors = logs?.entries.filter((entry) => entry.level === 'error').length ?? 0
  const logWarnings = (logs?.entries.length ?? 0) - logErrors
  const logFiles = logs?.files.filter((file) => file.entries > 0) ?? []

  return (
    <div className="kjs-check">
      <div className="kjs-check-tabs">
        <button
          type="button"
          className={`kjs-check-tab ${mode === 'static' ? 'is-active' : ''}`}
          onClick={() => setMode('static')}
        >
          <ScanSearch size={11} />
          代码检查
          {(activeCounts.errors > 0 || activeCounts.warnings > 0) && (
            <em>{activeCounts.errors + activeCounts.warnings}</em>
          )}
        </button>
        <button
          type="button"
          className={`kjs-check-tab ${mode === 'logs' ? 'is-active' : ''}`}
          onClick={() => setMode('logs')}
        >
          <Terminal size={11} />
          运行日志
          {logs && logs.entries.length > 0 && <em>{logs.entries.length}</em>}
        </button>
      </div>

      {mode === 'static' ? (
        <>
          <div className="kjs-check-toolbar">
            <span className="kjs-check-scope">
              <button
                type="button"
                className={scope === 'file' ? 'is-active' : ''}
                onClick={() => setScope('file')}
              >
                当前文件
              </button>
              <button
                type="button"
                className={scope === 'project' ? 'is-active' : ''}
                onClick={() => setScope('project')}
              >
                全项目
              </button>
            </span>
            <button
              type="button"
              className="kjs-check-filter"
              data-active={onlyErrors ? 'true' : 'false'}
              onClick={() => setOnlyErrors((value) => !value)}
            >
              只看错误
            </button>
            {scope === 'file' && activePath && fixableIssues.length > 0 && (
              <button
                type="button"
                className="kjs-check-fix"
                onClick={openFixModal}
                title="预览并勾选确定性的脚本修复；不会自动保存"
              >
                <WandSparkles size={10} />
                一键修复 {fixableIssues.length}
              </button>
            )}
            <span className="kjs-check-spacer" />
            <button
              type="button"
              className="kjs-check-scan"
              disabled={!instance || scanning}
              onClick={() => void scanProject()}
            >
              {scanning ? <Spinner size={10} /> : <RefreshCw size={10} />}
              {scanning ? '检查中…' : '全项目检查'}
            </button>
            <button
              type="button"
              className="kjs-check-runtime"
              disabled={!instance}
              onClick={onRuntimeCheck}
              title="启动临时服务端，实际加载模组与 KubeJS 服务端/启动脚本"
            >
              <Play size={10} />
              实际运行
            </button>
          </div>

          {!instance ? (
            <div className="kjs-problems-empty">
              <AlertTriangle size={16} />
              <span>请选择实例后再检查脚本。</span>
            </div>
          ) : scope === 'file' ? (
            !activePath ? (
              <div className="kjs-problems-empty">
                <FileCode2 size={16} />
                <span>打开脚本后显示实时预检结果。</span>
              </div>
            ) : activeIssues.length === 0 ? (
              <div className="kjs-problems-empty">
                <CheckCircle2 size={16} />
                <strong>{onlyErrors ? '没有错误' : '预检通过'}</strong>
                <span>
                  {activeCounts.warnings > 0 && onlyErrors
                    ? `还有 ${activeCounts.warnings} 个警告，取消筛选查看。`
                    : '语法、事件名、脚本侧与索引中的 ID 均未发现问题。'}
                </span>
                {!indexReady && (
                  <span className="kjs-check-note">
                    实例索引尚未加载，物品 / 配方 / 标签 ID 检查已跳过。
                  </span>
                )}
              </div>
            ) : (
              <>
                <div className="kjs-problems-head">
                  {activeCounts.errors} 错误 · {activeCounts.warnings} 警告 · {activePath}
                </div>
                <div className="kjs-problems">
                  {activeIssues.map((issue, index) => {
                    const moveFix = issue.fix?.kind === 'move-file' ? issue.fix : null
                    return (
                    <div
                      key={`${issue.code}-${issue.line}-${issue.column}-${index}`}
                      className="kjs-problem-wrap"
                    >
                      <button
                        type="button"
                        className={`kjs-problem is-${issue.severity}`}
                        onClick={() => onOpen(activePath, issue.line, issue.column)}
                      >
                        <span className="kjs-problem-line">L{issue.line}</span>
                        <span className="kjs-problem-body">
                          <span className="kjs-problem-tags">
                            <em className={`kjs-sev is-${issue.severity}`}>
                              {severityLabel(issue.severity)}
                            </em>
                            <em>{SOURCE_LABELS[issue.source] ?? issue.source}</em>
                            {issue.fix?.kind === 'replace' && (
                              <em className="kjs-problem-fixable">
                                <WandSparkles size={8} />
                                可修复
                              </em>
                            )}
                          </span>
                          {issue.message}
                        </span>
                      </button>
                      {moveFix && (
                        <button
                          type="button"
                          className="kjs-problem-move"
                          title={`把 ${activePath} 移动到 ${moveFix.targetPath}`}
                          onClick={() => onMoveFix(moveFix.targetPath)}
                        >
                          <WandSparkles size={9} />
                          {moveFix.title}
                        </button>
                      )}
                    </div>
                    )
                  })}
                </div>
                <div className="kjs-check-note">
                  {indexReady
                    ? 'ID 检查基于静态索引；运行时动态注册的物品可能显示为未找到。'
                    : '实例索引尚未加载，物品 / 配方 / 标签 ID 检查已跳过。'}
                </div>
              </>
            )
          ) : !project ? (
            <div className="kjs-problems-empty">
              <ScanSearch size={16} />
              <strong>检查全部 KubeJS 脚本</strong>
              <span>
                会读取 server_scripts、client_scripts、startup_scripts 里的 .js / .json，
                未保存的标签页使用编辑器中的内容。
              </span>
              {projectError && <span className="kjs-check-error">{projectError}</span>}
              <button
                type="button"
                className="button button--primary button--sm"
                disabled={scanning}
                onClick={() => void scanProject()}
              >
                {scanning ? <Spinner size={10} /> : <ScanSearch size={10} />}
                {scanning ? '检查中…' : '开始检查'}
              </button>
            </div>
          ) : (
            <>
              <div className="kjs-check-summary">
                <span>
                  {project.scannedFiles} 个文件 · {project.errorCount} 错误 ·{' '}
                  {project.warningCount} 警告
                </span>
                <span>{Math.max(1, Math.round(project.durationMs))} ms</span>
              </div>
              <div className="kjs-check-summary is-muted">
                <span>
                  {project.cleanFiles} 个文件通过
                  {project.skippedFiles > 0 ? ` · ${project.skippedFiles} 个跳过` : ''}
                </span>
                {!project.indexReady && <span>索引未加载，ID 检查跳过</span>}
              </div>
              <div className="kjs-check-note">
                ID 检查基于静态索引；运行时动态注册的物品可能显示为未找到。一键修复在「当前文件」面板中操作，点击这里的问题会跳转并打开对应文件。
              </div>
              {projectError && <div className="kjs-check-error">{projectError}</div>}
              {projectIssues.length === 0 ? (
                <div className="kjs-problems-empty">
                  <CheckCircle2 size={16} />
                  <strong>{onlyErrors ? '没有错误' : '全部通过'}</strong>
                  <span>
                    {onlyErrors && project.warningCount > 0
                      ? `还有 ${project.warningCount} 个警告。`
                      : '所有脚本的静态预检均未发现问题。'}
                  </span>
                </div>
              ) : (
                <div className="kjs-check-groups">
                  {projectIssues.map((file) => {
                    const open = !collapsed.has(file.path)
                    return (
                      <div key={file.path} className="kjs-check-group">
                        <button
                          type="button"
                          className="kjs-check-group-head"
                          onClick={() => toggleCollapse(file.path)}
                        >
                          {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                          <FileCode2 size={10} />
                          <span className="kjs-check-path" title={file.path}>
                            {file.path}
                          </span>
                          {file.errorCount > 0 && <em className="is-error">{file.errorCount}</em>}
                          {file.warningCount > 0 && <em>{file.warningCount}</em>}
                        </button>
                        {open && (
                          <div className="kjs-check-group-body">
                            {file.issues.map((issue, index) => (
                              <button
                                key={`${issue.code}-${issue.line}-${issue.column}-${index}`}
                                type="button"
                                className={`kjs-problem is-${issue.severity}`}
                                onClick={() => onOpen(file.path, issue.line, issue.column)}
                              >
                                <span className="kjs-problem-line">L{issue.line}</span>
                                <span className="kjs-problem-body">
                                  <span className="kjs-problem-tags">
                                    <em className={`kjs-sev is-${issue.severity}`}>
                                      {severityLabel(issue.severity)}
                                    </em>
                                    <em>{SOURCE_LABELS[issue.source] ?? issue.source}</em>
                                  </span>
                                  {issue.message}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </>
      ) : (
        <>
          <div className="kjs-check-toolbar">
            <span className="kjs-check-summary is-inline">
              {logs ? `${logErrors} 错误 · ${logWarnings} 警告` : '读取 logs/kubejs 与 latest.log'}
            </span>
            <span className="kjs-check-spacer" />
            <button
              type="button"
              className="kjs-check-scan"
              disabled={!instance || logBusy}
              onClick={() => void loadLogs(true)}
            >
              {logBusy ? <Spinner size={10} /> : <RefreshCw size={10} />}
              {logBusy ? '读取中…' : '刷新'}
            </button>
          </div>

          {logError && <div className="kjs-check-error">{logError}</div>}

          {!logs ? (
            <div className="kjs-problems-empty">
              <Terminal size={16} />
              <span>{logBusy ? '正在读取运行日志…' : '读取后显示 KubeJS 报错与脚本行号。'}</span>
            </div>
          ) : logs.entries.length === 0 ? (
            <div className="kjs-problems-empty">
              <CheckCircle2 size={16} />
              <strong>没有找到脚本报错</strong>
              <span>
                {logs.files.length === 0
                  ? '没有 logs/kubejs 或 latest.log；先启动一次游戏再试。'
                  : '最近的日志里没有 KubeJS 的 ERROR / WARN。'}
              </span>
              {logs.truncated && <span className="kjs-check-note">日志较大，只读取了末尾部分。</span>}
            </div>
          ) : (
            <>
              <div className="kjs-check-summary is-muted">
                <span>
                  {logFiles.map((file) => `${file.name} (${file.entries})`).join(' · ')}
                </span>
                <span>{formatDateTime(logs.scannedAt)}</span>
              </div>
              {logs.truncated && (
                <div className="kjs-check-note">日志较大，只读取最近的末尾部分。</div>
              )}
              <div className="kjs-log-list">
                {logs.entries.map((entry) => {
                  const expanded = expandedLogs.has(entry.id)
                  return (
                    <div key={entry.id} className={`kjs-log-entry is-${entry.level}`}>
                      <button
                        type="button"
                        className="kjs-log-head"
                        onClick={() => toggleLog(entry.id)}
                      >
                        <em className={`kjs-sev is-${entry.level}`}>
                          {entry.level === 'error' ? '错误' : '警告'}
                        </em>
                        <span className="kjs-log-time">{entry.time ?? '--:--:--'}</span>
                        <span className="kjs-log-source">
                          {LOG_SOURCE_LABELS[entry.source] ?? entry.source}
                        </span>
                        <span className="kjs-log-message">{entry.message}</span>
                        {(entry.details.length > 0 || entry.frames.length > 0) && (
                          <span className="kjs-log-chevron">
                            {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                          </span>
                        )}
                      </button>
                      <div className="kjs-log-jump">
                        {entry.scriptPath ? (
                          <button
                            type="button"
                            className="kjs-log-path"
                            onClick={() =>
                              onOpen(
                                entry.scriptPath as string,
                                entry.line ?? 1,
                                entry.column ?? undefined
                              )
                            }
                          >
                            {entry.scriptPath}
                            {entry.line ? `:${entry.line}` : ''}
                          </button>
                        ) : entry.rawPath ? (
                          <span className="kjs-log-path is-missing">
                            {entry.rawPath}
                            {entry.line ? `:${entry.line}` : ''}（未找到本地文件）
                          </span>
                        ) : (
                          <span className="kjs-log-path is-missing">没有脚本路径</span>
                        )}
                      </div>
                      {expanded && (
                        <div className="kjs-log-details">
                          {entry.frames.length > 0 && (
                            <div className="kjs-log-frames">
                              {entry.frames.map((frame, index) => (
                                <button
                                  key={`${entry.id}-frame-${index}`}
                                  type="button"
                                  className={`kjs-log-frame ${frame.file && frame.line ? 'is-link' : ''}`}
                                  disabled={!frame.file || !frame.line}
                                  onClick={() => {
                                    if (frame.file && frame.line) {
                                      onOpen(frame.file, frame.line)
                                    }
                                  }}
                                >
                                  {frame.text}
                                </button>
                              ))}
                            </div>
                          )}
                          {entry.details.some((line) => !/^\s*at\s+/.test(line)) && (
                            <pre className="kjs-log-raw">
                              {entry.details
                                .filter((line) => !/^\s*at\s+/.test(line))
                                .join('\n')}
                            </pre>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </>
      )}

      <Modal
        open={fixDraft !== null}
        onClose={closeFixModal}
        title="一键修复"
        subtitle="只应用确定性的命名/事件修复；先在下方预览差异，应用后仍需手动保存"
        icon={<WandSparkles size={18} />}
        size="lg"
        footer={
          <>
            <button type="button" className="button button--ghost" onClick={closeFixModal}>
              取消
            </button>
            <button
              type="button"
              className="button button--primary"
              disabled={!fixDraft || selectedFixItems.length === 0}
              onClick={applySelectedFixes}
            >
              <WandSparkles size={13} />
              应用选中修复
            </button>
          </>
        }
      >
        {fixDraft && (
          <div className="kjs-fix-modal">
            <div className="kjs-fix-selectbar">
              <span>
                已选 {selectedFixItems.length} / {fixDraft.items.length} 处
              </span>
              <button type="button" className="link-button" onClick={() => selectAllFixes(true)}>
                全选
              </button>
              <button type="button" className="link-button" onClick={() => selectAllFixes(false)}>
                全不选
              </button>
            </div>
            <div className="kjs-fix-list">
              {fixDraft.items.map((item) => (
                <label key={item.key} className="kjs-fix-item">
                  <input
                    type="checkbox"
                    checked={fixSelected.has(item.key)}
                    onChange={() => toggleFixItem(item.key)}
                  />
                  <span className="kjs-fix-item-copy">
                    <strong>{item.title}</strong>
                    <small>
                      L{item.issue.line} · {item.issue.message}
                    </small>
                  </span>
                  <code>
                    {item.original} → {item.replacement}
                  </code>
                </label>
              ))}
            </div>
            {fixError && <div className="kjs-check-error">{fixError}</div>}
            {selectedFixItems.length > 0 && fixPreview && !fixPreview.error ? (
              <DiffView
                before={fixDraft.content}
                after={fixPreview.after}
                labelBefore="当前脚本"
                labelAfter="修复后"
              />
            ) : (
              <div className="kjs-fix-empty">
                {fixPreview?.error || '勾选上方修复项后显示差异预览。'}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
