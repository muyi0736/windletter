import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  EyeOff,
  Copy,
  FolderOpen,
  KeyRound,
  Link2,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Wrench
} from 'lucide-react'
import type {
  AiConfigView,
  AiDiagnosisView,
  DiagnosticIssue,
  DiagnosticReport
} from '@shared/types'
import { useLauncher } from '../store'
import { cleanError, formatBytes } from '../lib/format'
import { copyText } from '../lib/clipboard'
import { Badge, Modal, Spinner, Switch } from './ui'

const AI_PRESETS = [
  {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat'
  },
  {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini'
  },
  {
    label: '本地 Ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'qwen2.5:7b'
  }
]

const CATEGORY_LABELS: Record<DiagnosticIssue['category'], string> = {
  java: 'JAVA',
  memory: 'MEMORY',
  files: 'FILES',
  mods: 'MODS',
  crash: 'CRASH',
  graphics: 'GRAPHICS',
  other: 'OTHER'
}

const SEVERITY_META: Record<
  DiagnosticIssue['severity'],
  { label: string; tone: 'neutral' | 'warning' | 'danger' }
> = {
  info: { label: '提示', tone: 'neutral' },
  warning: { label: '提醒', tone: 'warning' },
  error: { label: '错误', tone: 'danger' }
}

export function FaultDoctorModal() {
  const target = useLauncher((state) => state.diagnosticTarget)
  const closeDiagnosis = useLauncher((state) => state.closeDiagnosis)
  const toast = useLauncher((state) => state.toast)

  const [report, setReport] = useState<DiagnosticReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [disabling, setDisabling] = useState<string | null>(null)
  const [marking, setMarking] = useState(false)
  const [ignoring, setIgnoring] = useState<string | null>(null)
  const [clearingIgnored, setClearingIgnored] = useState(false)

  const [aiConfig, setAiConfig] = useState<AiConfigView | null>(null)
  const [aiConfigLoading, setAiConfigLoading] = useState(false)
  const [aiSetupOpen, setAiSetupOpen] = useState(false)
  const [aiSaving, setAiSaving] = useState(false)
  const [aiAnalyzing, setAiAnalyzing] = useState(false)
  const [aiResult, setAiResult] = useState<AiDiagnosisView | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiForm, setAiForm] = useState({
    enabled: false,
    baseUrl: '',
    model: '',
    apiKey: ''
  })

  useEffect(() => {
    if (!target) return
    let cancelled = false
    setReport(null)
    setLoading(true)
    setError(null)
    setAiResult(null)
    setAiError(null)
    setAiSetupOpen(false)

    void (async () => {
      try {
        const next = await window.ccl.diagnostics.run(target.instanceId)
        if (!cancelled) setReport(next)
      } catch (caught) {
        if (!cancelled) setError(cleanError(caught))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    setAiConfigLoading(true)
    void (async () => {
      try {
        const config = await window.ccl.ai.getConfig()
        if (!cancelled) {
          setAiConfig(config)
          setAiForm({
            enabled: config.enabled,
            baseUrl: config.baseUrl,
            model: config.model,
            apiKey: ''
          })
        }
      } catch (caught) {
        if (!cancelled) setAiError(cleanError(caught))
      } finally {
        if (!cancelled) setAiConfigLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [target?.instanceId])

  if (!target) return null

  const allIssues = report
    ? [...report.issues, ...(report.crash?.issues ?? [])]
    : []
  const errors = allIssues.filter((item) => item.severity === 'error').length
  const warnings = allIssues.filter((item) => item.severity === 'warning').length

  const refresh = async () => {
    if (!target || loading) return
    setLoading(true)
    setError(null)
    setAiResult(null)
    setAiError(null)
    try {
      const next = await window.ccl.diagnostics.run(target.instanceId)
      setReport(next)
    } catch (caught) {
      setError(cleanError(caught))
    } finally {
      setLoading(false)
    }
  }

  const markAsKnownGood = async () => {
    if (!target || marking) return
    setMarking(true)
    try {
      await window.ccl.diagnostics.markKnownGood(target.instanceId)
      toast('success', '已记录为可运行', '当前模组与启动配置已保存为已知可运行快照')
      await refresh()
    } catch (caught) {
      toast('error', '无法记录可运行状态', cleanError(caught))
    } finally {
      setMarking(false)
    }
  }

  const ignoreOne = async (issueId: string) => {
    if (!target || ignoring) return
    setIgnoring(issueId)
    try {
      await window.ccl.diagnostics.ignoreIssue(target.instanceId, issueId)
      toast('success', '已忽略这条提示', '模组或启动配置变化后会重新检查')
      await refresh()
    } catch (caught) {
      toast('error', '无法忽略这条提示', cleanError(caught))
    } finally {
      setIgnoring(null)
    }
  }

  const clearIgnoredIssues = async () => {
    if (!target || clearingIgnored) return
    setClearingIgnored(true)
    try {
      await window.ccl.diagnostics.clearIgnored(target.instanceId)
      await refresh()
    } catch (caught) {
      toast('error', '无法恢复已忽略的提示', cleanError(caught))
    } finally {
      setClearingIgnored(false)
    }
  }

  const disableMod = async (file: string) => {
    if (!target || disabling) return
    setDisabling(file)
    try {
      await window.ccl.mods.toggle(target.instanceId, file, false)
      toast('success', '已禁用模组', file)
      await refresh()
    } catch (caught) {
      toast('error', '无法禁用模组', cleanError(caught))
    } finally {
      setDisabling(null)
    }
  }

  const disableAllManualMods = async (files: string[]) => {
    if (!target || disabling || files.length === 0) return
    setDisabling('__all__')
    try {
      for (const file of files) {
        await window.ccl.mods.toggle(target.instanceId, file, false)
      }
      toast('success', '已禁用不兼容的手动模组', `共 ${files.length} 个文件`)
      await refresh()
    } catch (caught) {
      toast('error', '无法全部禁用', cleanError(caught))
    } finally {
      setDisabling(null)
    }
  }

  const openFolder = (kind: 'mods' | 'logs' | 'crash-reports') => {
    if (!target) return
    void window.ccl.instances
      .openFolder(target.instanceId, kind)
      .catch((caught) => toast('error', '无法打开文件夹', cleanError(caught)))
  }

  const copyReport = () => {
    if (!report) return
    const text = buildReportText(report, errors, warnings)
    void copyText(text)
      .then(() => toast('success', '诊断已复制', '可以粘贴到聊天或日志里'))
      .catch((caught) => toast('error', '复制失败', cleanError(caught)))
  }

  const saveAiConfig = async () => {
    if (!aiForm.baseUrl.trim() || !aiForm.model.trim() || aiSaving) return
    setAiSaving(true)
    try {
      const config = await window.ccl.ai.updateConfig({
        enabled: aiForm.enabled,
        baseUrl: aiForm.baseUrl.trim(),
        model: aiForm.model.trim(),
        ...(aiForm.apiKey.trim() ? { apiKey: aiForm.apiKey.trim() } : {})
      })
      setAiConfig(config)
      setAiForm({
        enabled: config.enabled,
        baseUrl: config.baseUrl,
        model: config.model,
        apiKey: ''
      })
      setAiSetupOpen(false)
      toast(
        'success',
        'AI 设置已保存',
        config.enabled ? '可以让 AI 分析这次体检了' : 'AI 辅助当前保持关闭'
      )
    } catch (caught) {
      toast('error', 'AI 设置保存失败', cleanError(caught))
    } finally {
      setAiSaving(false)
    }
  }

  const clearAiKey = async () => {
    if (aiSaving) return
    setAiSaving(true)
    try {
      const config = await window.ccl.ai.updateConfig({ apiKey: null })
      setAiConfig(config)
      setAiForm((form) => ({ ...form, apiKey: '' }))
      toast('success', '已清除 API Key')
    } catch (caught) {
      toast('error', '无法清除 API Key', cleanError(caught))
    } finally {
      setAiSaving(false)
    }
  }

  const runAi = async () => {
    if (!target || !aiConfig?.enabled || aiAnalyzing) return
    setAiAnalyzing(true)
    setAiError(null)
    try {
      const result = await window.ccl.ai.analyze(target.instanceId)
      setAiResult(result)
    } catch (caught) {
      setAiError(cleanError(caught))
    } finally {
      setAiAnalyzing(false)
    }
  }

  const status = report?.status ?? 'warning'
  const statusTitle =
    status === 'healthy'
      ? '没有发现明显问题'
      : status === 'error'
        ? '发现需要处理的问题'
        : '有几点需要留意'
  const statusDetail =
    status === 'healthy'
      ? 'Java、内存、文件、模组与最近崩溃报告都通过了检查。'
      : status === 'error'
        ? `${errors} 个错误${warnings ? ` · ${warnings} 个提醒` : ''}。先处理错误，再启动游戏。`
        : `${warnings} 个提醒。可以先启动，但建议顺手处理。`

  return (
    <Modal
      open
      onClose={closeDiagnosis}
      title="故障医生"
      subtitle={`${target.instanceName} · 本地规则体检 + 可选 AI`}
      icon={<Stethoscope size={18} />}
      size="xl"
      footer={
        <div className="doctor-footer">
          <button
            type="button"
            className="button button--ghost button--sm"
            disabled={!report}
            onClick={copyReport}
          >
            <Copy size={12} />
            复制诊断
          </button>
          <button
            type="button"
            className="button button--soft button--sm"
            disabled={loading}
            onClick={() => void refresh()}
          >
            <RefreshCw size={12} className={loading ? 'spin' : ''} />
            重新体检
          </button>
          <button type="button" className="button button--primary button--sm" onClick={closeDiagnosis}>
            关闭
          </button>
        </div>
      }
    >
      {target.auto && (
        <div className="doctor-auto">
          <AlertTriangle size={14} />
          检测到游戏上次异常退出，已自动打开故障医生并分析最近的崩溃报告。
        </div>
      )}

      {loading && !report ? (
        <div className="doctor-loading">
          <Spinner size={18} />
          <div>
            <strong>正在体检</strong>
            <span>读取 Java、内存、游戏文件、模组元数据与最近崩溃报告…</span>
          </div>
        </div>
      ) : error ? (
        <div className="doctor-error">
          <AlertTriangle size={18} />
          <div>
            <strong>体检没有完成</strong>
            <span>{error}</span>
          </div>
          <button type="button" className="button button--soft button--sm" onClick={() => void refresh()}>
            重试
          </button>
        </div>
      ) : report ? (
        <>
          <section className={`doctor-banner doctor-banner--${status}`}>
            <div className="doctor-banner-icon">
              {status === 'healthy' ? (
                <ShieldCheck size={20} />
              ) : (
                <AlertTriangle size={20} />
              )}
            </div>
            <div className="doctor-banner-copy">
              <strong>{statusTitle}</strong>
              <p>{statusDetail}</p>
              <span>
                检查于{' '}
                {new Date(report.checkedAt).toLocaleTimeString('zh-CN', {
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </span>
            </div>
            <div className="doctor-banner-counts">
              {errors > 0 && <em className="is-error">{errors} 错误</em>}
              {warnings > 0 && <em className="is-warning">{warnings} 提醒</em>}
              {errors === 0 && warnings === 0 && <em className="is-pass">PASS</em>}
            </div>
          </section>

          <KnownGoodPanel
            report={report}
            marking={marking}
            onMark={() => void markAsKnownGood()}
          />

          <section className="doctor-section">
            <header className="doctor-section-head">
              <div>
                <span className="doctor-kicker">PREFLIGHT</span>
                <h3>启动检查</h3>
              </div>
              <div className="doctor-section-tools">
                {report.ignoredCount > 0 && (
                  <button
                    type="button"
                    className="doctor-link doctor-link--muted"
                    disabled={clearingIgnored || loading}
                    onClick={() => void clearIgnoredIssues()}
                  >
                    <RotateCcw size={12} className={clearingIgnored ? 'spin' : ''} />
                    已忽略 {report.ignoredCount} 条 · 恢复
                  </button>
                )}
                <button
                  type="button"
                  className="doctor-link"
                  onClick={() => openFolder('mods')}
                >
                  <FolderOpen size={12} />
                  Mod 文件夹
                </button>
              </div>
            </header>
            {report.issues.length === 0 ? (
              <div className="doctor-clear">
                <CheckCircle2 size={16} />
                Java、内存、版本文件和模组检查没有发现明显问题。
              </div>
            ) : (
              <div className="doctor-issue-list">
                {report.issues.map((item) => (
                  <IssueCard
                    key={item.id}
                    issue={item}
                    disabling={disabling}
                    ignoring={ignoring}
                    onDisable={disableMod}
                    onDisableAll={disableAllManualMods}
                    onIgnore={ignoreOne}
                    onOpenMods={() => openFolder('mods')}
                  />
                ))}
              </div>
            )}
          </section>

          {report.crash && (
            <section className="doctor-section">
              <header className="doctor-section-head">
                <div>
                  <span className="doctor-kicker">LAST CRASH</span>
                  <h3>最近崩溃</h3>
                </div>
                <span className="doctor-file" title={report.crash.file ?? ''}>
                  {report.crash.file ?? '日志'}
                </span>
              </header>
              <div className="doctor-crash-summary">
                <strong>{report.crash.summary || '游戏异常退出'}</strong>
                {report.crash.createdAt && (
                  <span>
                    {new Date(report.crash.createdAt).toLocaleString('zh-CN', {
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </span>
                )}
              </div>
              {report.crash.issues.length > 0 && (
                <div className="doctor-issue-list">
                  {report.crash.issues.map((item) => (
                    <IssueCard
                      key={item.id}
                      issue={item}
                      disabling={disabling}
                      onDisable={disableMod}
                      onDisableAll={disableAllManualMods}
                      onOpenMods={() => openFolder('mods')}
                    />
                  ))}
                </div>
              )}
              {report.crash.excerpt.length > 0 && (
                <details className="doctor-log">
                  <summary>查看日志尾部 · {report.crash.excerpt.length} 行</summary>
                  <pre>{report.crash.excerpt.join('\n')}</pre>
                </details>
              )}
              <div className="doctor-inline-actions">
                <button type="button" className="doctor-link" onClick={() => openFolder('logs')}>
                  <FolderOpen size={12} />
                  日志文件夹
                </button>
                <button type="button" className="doctor-link" onClick={() => openFolder('crash-reports')}>
                  <FolderOpen size={12} />
                  崩溃报告
                </button>
              </div>
            </section>
          )}

          <section className="doctor-section doctor-ai">
            <header className="doctor-section-head">
              <div>
                <span className="doctor-kicker">OPTIONAL</span>
                <h3>AI 辅助诊断</h3>
              </div>
              <Badge tone="neutral">可关闭</Badge>
            </header>
            <p className="doctor-privacy">
              本地体检不会联网。只有你点击「让 AI 分析」时，才会发送脱敏后的实例信息、体检结果、崩溃日志尾部和模组文件名；不会发送存档、账户凭据或服务器地址。
            </p>

            {aiConfigLoading ? (
              <div className="doctor-ai-loading">
                <Spinner size={14} />
                正在读取 AI 设置…
              </div>
            ) : aiConfig ? (
              <>
                {aiConfig.enabled ? (
                  <div className="doctor-ai-run">
                    <div className="doctor-ai-model">
                      <strong>{aiConfig.model}</strong>
                      <span>{aiConfig.baseUrl}</span>
                    </div>
                    <button
                      type="button"
                      className="button button--ghost button--sm"
                      onClick={() => setAiSetupOpen((open) => !open)}
                    >
                      设置
                    </button>
                    <button
                      type="button"
                      className="button button--primary button--sm"
                      disabled={aiAnalyzing}
                      onClick={() => void runAi()}
                    >
                      {aiAnalyzing ? <Spinner size={12} /> : <Sparkles size={12} />}
                      让 AI 分析
                    </button>
                  </div>
                ) : (
                  <div className="doctor-ai-off">
                    <div>
                      <strong>AI 辅助未启用</strong>
                      <span>本地体检已经完成；AI 是第二意见，默认不发送任何数据。</span>
                    </div>
                    <button
                      type="button"
                      className="button button--soft button--sm"
                      onClick={() => setAiSetupOpen(true)}
                    >
                      配置 AI
                    </button>
                  </div>
                )}

                {aiAnalyzing && (
                  <div className="doctor-ai-loading">
                    <Spinner size={14} />
                    AI 正在阅读体检结果与日志尾部…
                  </div>
                )}
                {aiError && <p className="doctor-ai-error">{aiError}</p>}
                {aiSetupOpen && (
                  <AiSetup
                    config={aiConfig}
                    form={aiForm}
                    saving={aiSaving}
                    onForm={setAiForm}
                    onSave={() => void saveAiConfig()}
                    onClearKey={() => void clearAiKey()}
                  />
                )}
                {aiResult && <AiResult result={aiResult} />}

              </>
            ) : (
              <div className="doctor-ai-error">无法读取 AI 设置，请重新打开故障医生。</div>
            )}
          </section>
        </>
      ) : null}
    </Modal>
  )
}

function KnownGoodPanel({
  report,
  marking,
  onMark
}: {
  report: DiagnosticReport
  marking: boolean
  onMark: () => void
}) {
  const known = report.knownGood
  const match = report.knownGoodMatch
  const changes = report.changes
  const changedFiles =
    (changes?.added.length ?? 0) + (changes?.removed.length ?? 0) + (changes?.changed.length ?? 0)
  const blocked = report.status === 'error'

  const title = match
    ? '当前配置和上次成功启动一致'
    : known
      ? '和上次成功启动相比有变化'
      : '还没有可运行快照'
  const detail = match
    ? '这组模组在同一套启动配置下正常进入过游戏。模组规则里的提示已自动降为参考，不会阻止你启动。'
    : known
      ? changedFiles > 0
        ? '对照上次成功启动记录到了模组变化。如果这次也能正常进入游戏，可以重新记录；如果启动失败，优先排查新增或替换的模组。'
        : '模组没有增减，但内存、Java、JVM 参数或加载器版本发生了变化。确认能正常游玩后可以重新记录。'
      : '正常退出游戏后会自动记录，也可以现在把当前模组与启动配置标记为可运行。之后有改动时，这里会列出差异。'

  return (
    <section
      className={`doctor-known ${
        match ? 'doctor-known--good' : known ? 'doctor-known--changed' : 'doctor-known--empty'
      }`}
    >
      <div className="doctor-known-icon">
        {match ? <ShieldCheck size={18} /> : known ? <Clock3 size={18} /> : <Clock3 size={18} />}
      </div>
      <div className="doctor-known-body">
        <div className="doctor-known-head">
          <span className="doctor-kicker">KNOWN GOOD</span>
          {match ? (
            <Badge tone="success">已知可运行</Badge>
          ) : known ? (
            <Badge tone="warning">配置已变化</Badge>
          ) : (
            <Badge tone="neutral">未记录</Badge>
          )}
        </div>
        <strong>{title}</strong>
        <p>{detail}</p>

        {known && !match && changes && changedFiles > 0 && (
          <div className="doctor-known-diff">
            <div className="doctor-known-counts">
              {changes.added.length > 0 && <em className="is-add">+{changes.added.length} 新增</em>}
              {changes.removed.length > 0 && (
                <em className="is-remove">−{changes.removed.length} 移除</em>
              )}
              {changes.changed.length > 0 && (
                <em className="is-change">~{changes.changed.length} 变化</em>
              )}
            </div>
            <DiffList label="新增" tone="add" files={changes.added} />
            <DiffList label="移除" tone="remove" files={changes.removed} />
            <DiffList label="变化" tone="change" files={changes.changed} />
          </div>
        )}

        <span className="doctor-known-meta">
          {known
            ? `记录于 ${formatTimestamp(known.recordedAt)} · 当时 ${known.modCount} 个模组 · ${known.memoryMb} MB`
            : blocked
              ? '先处理上面的错误，再记录可运行状态'
              : '正常退出游戏后会自动记录'}
        </span>
      </div>
      {!match && (
        <button
          type="button"
          className="button button--soft button--sm doctor-known-mark"
          disabled={marking || blocked}
          title={blocked ? '当前还有错误，先处理后再记录' : '把当前模组与启动配置记录为可运行'}
          onClick={onMark}
        >
          {marking ? <Spinner size={12} /> : <CheckCircle2 size={12} />}
          标记为可运行
        </button>
      )}
    </section>
  )
}

function DiffList({
  label,
  tone,
  files
}: {
  label: string
  tone: 'add' | 'remove' | 'change'
  files: string[]
}) {
  if (files.length === 0) return null
  const shown = files.slice(0, 6)
  return (
    <div className={`doctor-diff-line doctor-diff-line--${tone}`}>
      <span>{label}</span>
      <div>
        {shown.map((file) => (
          <code key={file} title={file}>
            {shortFile(file)}
          </code>
        ))}
        {files.length > shown.length && <em>+{files.length - shown.length} 个文件</em>}
      </div>
    </div>
  )
}

function IssueCard({
  issue,
  disabling,
  ignoring,
  onDisable,
  onDisableAll,
  onIgnore,
  onOpenMods
}: {
  issue: DiagnosticIssue
  disabling: string | null
  ignoring?: string | null
  onDisable: (file: string) => Promise<void>
  onDisableAll?: (files: string[]) => Promise<void>
  onIgnore?: (issueId: string) => Promise<void>
  onOpenMods: () => void
}) {
  const meta = SEVERITY_META[issue.severity]
  const canIgnore = Boolean(onIgnore) && issue.severity !== 'error'
  const hasActions = issue.modFiles.length > 0 || issue.category === 'mods' || canIgnore
  return (
    <article className={`doctor-issue doctor-issue--${issue.severity}`}>
      <header className="doctor-issue-head">
        <span className="doctor-category">{CATEGORY_LABELS[issue.category]}</span>
        <Badge tone={meta.tone}>{meta.label}</Badge>
        <strong>{issue.title}</strong>
      </header>
      <p>{issue.detail}</p>
      {issue.evidence.length > 0 && (
        <pre className="doctor-evidence">{issue.evidence.join('\n')}</pre>
      )}
      {hasActions && (
        <div className="doctor-issue-actions">
          {issue.id === 'mod-incompatible-manual' &&
            issue.modFiles.length > 1 &&
            onDisableAll && (
              <button
                type="button"
                className="button button--ghost button--sm doctor-disable"
                disabled={Boolean(disabling)}
                title="禁用所有不兼容的手动模组"
                onClick={() => void onDisableAll(issue.modFiles)}
              >
                {disabling === '__all__' ? <Spinner size={11} /> : <Wrench size={11} />}
                全部禁用 {issue.modFiles.length} 个
              </button>
            )}
          {issue.modFiles.map((file) => (
            <button
              key={file}
              type="button"
              className="button button--ghost button--sm doctor-disable"
              disabled={Boolean(disabling)}
              title={`禁用 ${file}`}
              onClick={() => void onDisable(file)}
            >
              {disabling === file ? <Spinner size={11} /> : <Wrench size={11} />}
              禁用 {shortFile(file)}
            </button>
          ))}
          {(issue.modFiles.length > 0 || issue.category === 'mods') && (
            <button type="button" className="doctor-link" onClick={onOpenMods}>
              <FolderOpen size={11} />
              打开 Mod 文件夹
            </button>
          )}
          {canIgnore && (
            <button
              type="button"
              className="doctor-link doctor-link--muted"
              disabled={Boolean(ignoring)}
              title="在当前模组与启动配置不变时隐藏这条提示"
              onClick={() => onIgnore && void onIgnore(issue.id)}
            >
              {ignoring === issue.id ? <Spinner size={11} /> : <EyeOff size={11} />}
              误报，忽略
            </button>
          )}
        </div>
      )}
    </article>
  )
}

function AiSetup({
  config,
  form,
  saving,
  onForm,
  onSave,
  onClearKey
}: {
  config: AiConfigView
  form: { enabled: boolean; baseUrl: string; model: string; apiKey: string }
  saving: boolean
  onForm: (next: { enabled: boolean; baseUrl: string; model: string; apiKey: string }) => void
  onSave: () => void
  onClearKey: () => void
}) {
  return (
    <div className="doctor-ai-setup">
      <div className="doctor-presets">
        {AI_PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            className={`doctor-preset ${
              form.baseUrl === preset.baseUrl && form.model === preset.model ? 'is-active' : ''
            }`}
            onClick={() =>
              onForm({ ...form, baseUrl: preset.baseUrl, model: preset.model })
            }
          >
            {preset.label}
          </button>
        ))}
      </div>

      <label className="form-field">
        <span className="form-label">服务地址</span>
        <div className="text-input">
          <Link2 size={13} />
          <input
            value={form.baseUrl}
            spellCheck={false}
            placeholder="https://api.deepseek.com/v1"
            onChange={(event) => onForm({ ...form, baseUrl: event.target.value })}
          />
        </div>
        <span className="form-hint">OpenAI 兼容的 /v1 地址；本机 Ollama 可以填 http://127.0.0.1:11434/v1。</span>
      </label>

      <div className="doctor-ai-grid">
        <label className="form-field">
          <span className="form-label">模型</span>
          <div className="text-input">
            <Sparkles size={13} />
            <input
              value={form.model}
              spellCheck={false}
              placeholder="deepseek-chat"
              onChange={(event) => onForm({ ...form, model: event.target.value })}
            />
          </div>
        </label>
        <label className="form-field">
          <span className="form-label">API Key</span>
          <div className="text-input">
            <KeyRound size={13} />
            <input
              type="password"
              value={form.apiKey}
              spellCheck={false}
              placeholder={config.hasKey ? '已保存，留空不修改' : '本地 Ollama 可留空'}
              onChange={(event) => onForm({ ...form, apiKey: event.target.value })}
            />
          </div>
        </label>
      </div>

      {config.hasKey && (
        <button type="button" className="doctor-link doctor-clear-key" onClick={onClearKey}>
          清除已保存的 API Key
        </button>
      )}
      {!config.encryption && (
        <p className="doctor-ai-error">
          系统加密不可用，无法安全保存 API Key；仍可使用不需要 Key 的本地 Ollama。
        </p>
      )}

      <div className="doctor-ai-enable">
        <div>
          <strong>启用 AI 辅助</strong>
          <span>关闭时故障医生完全本地运行，不会发起任何 AI 请求。</span>
        </div>
        <Switch
          checked={form.enabled}
          label="启用 AI 辅助"
          onChange={(enabled) => onForm({ ...form, enabled })}
        />
      </div>

      <div className="doctor-ai-save">
        <button
          type="button"
          className="button button--primary button--sm"
          disabled={saving || !form.baseUrl.trim() || !form.model.trim()}
          onClick={onSave}
        >
          {saving ? <Spinner size={12} /> : <CheckCircle2 size={12} />}
          保存 AI 设置
        </button>
        <span>配置会加密保存在本机。</span>
      </div>
    </div>
  )
}

function AiResult({ result }: { result: AiDiagnosisView }) {
  return (
    <div className="doctor-ai-result">
      <div className="doctor-ai-result-head">
        <div>
          <span className="doctor-kicker">AI · {result.model}</span>
          <strong>{result.summary}</strong>
        </div>
        {result.confidence && (
          <Badge tone={result.confidence === 'high' ? 'success' : result.confidence === 'low' ? 'warning' : 'neutral'}>
            置信度 {result.confidence}
          </Badge>
        )}
      </div>

      {result.causes.length > 0 && (
        <div className="doctor-ai-causes">
          {result.causes.map((cause, index) => (
            <div key={`${cause.title}-${index}`} className="doctor-ai-cause">
              <span className="doctor-ai-index">{String(index + 1).padStart(2, '0')}</span>
              <div>
                <strong>{cause.title}</strong>
                {cause.detail && <p>{cause.detail}</p>}
                {cause.evidence && <pre>{cause.evidence}</pre>}
                {cause.fix && <em>建议：{cause.fix}</em>}
              </div>
            </div>
          ))}
        </div>
      )}

      {result.checks.length > 0 && (
        <div className="doctor-ai-checks">
          <span>还可以检查</span>
          <ul>
            {result.checks.map((check, index) => (
              <li key={`${check}-${index}`}>{check}</li>
            ))}
          </ul>
        </div>
      )}

      {result.raw && (
        <details className="doctor-log">
          <summary>AI 原始返回</summary>
          <pre>{result.raw}</pre>
        </details>
      )}

      <div className="doctor-ai-meta">
        <span>发送约 {formatBytes(result.sentBytes)} 的脱敏数据</span>
        <span>AI 建议仅供参考</span>
      </div>
    </div>
  )
}

function shortFile(file: string): string {
  return file.length > 30 ? `${file.slice(0, 27)}…` : file
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function buildReportText(report: DiagnosticReport, errors: number, warnings: number): string {
  const lines = [
    `风信 · 故障医生`,
    `实例：${report.instanceName}`,
    `状态：${report.status}（${errors} 错误 / ${warnings} 提醒）`,
    `可运行快照：${
      report.knownGoodMatch
        ? '与当前配置一致'
        : report.knownGood
          ? '当前配置已变化'
          : '未记录'
    }${report.ignoredCount > 0 ? ` · 已忽略 ${report.ignoredCount} 条` : ''}`,
    '',
    '启动检查：'
  ]
  if (report.issues.length === 0) {
    lines.push('- 没有发现明显问题')
  } else {
    for (const item of report.issues) {
      lines.push(`- [${item.severity}] ${item.title}：${item.detail}`)
    }
  }
  if (report.knownGood && !report.knownGoodMatch && report.changes) {
    const diff = report.changes
    if (diff.added.length) lines.push('', `新增：${diff.added.join('、')}`)
    if (diff.removed.length) lines.push(`移除：${diff.removed.join('、')}`)
    if (diff.changed.length) lines.push(`变化：${diff.changed.join('、')}`)
  }
  if (report.crash) {
    lines.push('', `最近崩溃：${report.crash.file ?? '日志'}`, report.crash.summary ?? '未知异常')
    for (const item of report.crash.issues) {
      lines.push(`- [${item.severity}] ${item.title}：${item.detail}`)
    }
  }
  return lines.join('\n')
}
