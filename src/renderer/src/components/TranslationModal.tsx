import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  BookOpen,
  Check,
  FileJson,
  FileText,
  Languages,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  X
} from 'lucide-react'
import type {
  InstanceSummary,
  TranslationApplyResult,
  TranslationFileView,
  TranslationGlossaryEntry,
  TranslationPreview,
  TranslationScanResult,
  TranslationScanScope
} from '@shared/types'
import { cleanError } from '../lib/format'
import {
  cancelTranslationSession,
  clearTranslationSessionError,
  getTranslationSessionSnapshot,
  markTranslationSessionApplied,
  resetTranslationSession,
  retryTranslationSession,
  setTranslationSessionItem,
  startTranslationSession,
  useTranslationSession
} from '../lib/translationSession'
import {
  glossaryToCsv,
  parseGlossaryText,
  selectRelevantGlossary,
  buildGlossaryIndex
} from '../lib/glossary'
import { useLauncher } from '../store'
import { Badge, ConfirmDialog, Modal, ProgressBar, Spinner } from './ui'
import { DiffView } from './KubeJsHistoryModal'

type ViewMode = 'diff' | 'segments'

const KIND_LABEL: Record<TranslationFileView['kind'], string> = {
  'ftb-lang': 'FTB 语言',
  'ftb-chapter': '任务书正文',
  lang: '语言文件',
  config: '配置注释',
  'mod-lang': '模组语言',
  patchouli: '帕秋莉手册',
  'shader-lang': '光影语言'
}

const ACTION_LABEL: Record<TranslationFileView['action'], string> = {
  create: '新建 zh_cn',
  merge: '合并 zh_cn',
  'in-place': '就地修改'
}

const SCOPE_LABEL: Record<TranslationScanScope, string> = {
  all: '全部内容',
  text: '任务书 + lang',
  config: '仅配置注释',
  mods: '模组 + 手册',
  shader: '光影'
}

const GLOSSARY_VISIBLE = 200

function fileIcon(file: TranslationFileView) {
  return /\.json5?$|\.snbt$/i.test(file.path) ? <FileJson size={14} /> : <FileText size={14} />
}

export function TranslationModal({
  instance,
  onClose
}: {
  instance: InstanceSummary | null
  onClose: () => void
}) {
  const toast = useLauncher((state) => state.toast)
  const [scan, setScan] = useState<TranslationScanResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const session = useTranslationSession()
  const translations = session.translations
  const failed = useMemo(() => new Set(session.failed), [session.failed])
  const busy = session.busy
  const progress = session.progress
  const phase = session.phase
  const aiWarnings = session.warnings
  const modelNote = session.model
  const sessionError = session.error
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [activeId, setActiveId] = useState<string | null>(null)
  const [scope, setScope] = useState<TranslationScanScope>('all')
  const [preview, setPreview] = useState<TranslationPreview | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('diff')
  const [query, setQuery] = useState('')
  const [glossary, setGlossary] = useState<TranslationGlossaryEntry[]>([])
  const [glossaryQuery, setGlossaryQuery] = useState('')
  const [glossaryOpen, setGlossaryOpen] = useState(true)
  const [glossarySaving, setGlossarySaving] = useState(false)
  const glossaryFileRef = useRef<HTMLInputElement>(null)
  const [newSource, setNewSource] = useState('')
  const [newTarget, setNewTarget] = useState('')
  const [bilingual, setBilingual] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  const [packBusy, setPackBusy] = useState(false)
  const [startConfirm, setStartConfirm] = useState(false)
  const [applyConfirm, setApplyConfirm] = useState(false)
  const [applying, setApplying] = useState(false)
  const [applyResult, setApplyResult] = useState<TranslationApplyResult | null>(null)

  const instanceId = instance?.id ?? ''

  const adoptSession = useCallback((next: TranslationScanResult, fileIds: string[]) => {
    setScan(next)
    setGlossary(next.glossary)
    setScope(next.scope)
    const available = new Set(next.files.map((file) => file.id))
    const chosen = fileIds.filter((id) => available.has(id))
    const fallback = next.files
      .filter((file) => file.segments.length > 0)
      .map((file) => file.id)
    const selectedIds = chosen.length > 0 ? chosen : fallback
    setSelected(new Set(selectedIds))
    setActiveId(
      selectedIds[0] ??
        next.files.find((file) => file.segments.length > 0)?.id ??
        next.files[0]?.id ??
        null
    )
  }, [])

  const load = useCallback(
    async (nextScope: TranslationScanScope = scope, reset = true) => {
      if (!instanceId) return
      const current = getTranslationSessionSnapshot()
      if (current.instanceId === instanceId && current.scan && !reset) {
        adoptSession(current.scan, current.fileIds)
        return
      }
      if (current.busy && current.instanceId !== instanceId) {
        setScan(null)
        setSelected(new Set())
        setActiveId(null)
        setError('另一个实例的汉化正在后台进行，请等它完成或回到该实例查看。')
        return
      }
      setLoading(true)
      setError('')
      setApplyResult(null)
      setPreview(null)
      resetTranslationSession()
      try {
        const result = await window.ccl.translation.scan(instanceId, nextScope)
        adoptSession(result, [])
      } catch (cause) {
        setError(cleanError(cause))
      } finally {
        setLoading(false)
      }
    },
    [instanceId, scope, adoptSession]
  )

  useEffect(() => {
    if (!instanceId) return
    const current = getTranslationSessionSnapshot()
    if (current.instanceId === instanceId && current.scan) {
      adoptSession(current.scan, current.fileIds)
      return
    }
    if (current.busy && current.instanceId !== instanceId) {
      setScan(null)
      setSelected(new Set())
      setActiveId(null)
      setError('另一个实例的汉化正在后台进行，请等它完成或回到该实例查看。')
      return
    }
    void load('all', true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId])

  const files = scan?.files ?? []
  const selectedFiles = useMemo(
    () => files.filter((file) => selected.has(file.id)),
    [files, selected]
  )
  const activeFile = files.find((file) => file.id === activeId) ?? null
  const pendingSegments = useMemo(
    () =>
      selectedFiles.flatMap((file) =>
        file.segments.filter((segment) => !translations[segment.id])
      ),
    [selectedFiles, translations]
  )
  const pendingTranslateSegments = useMemo(
    () => pendingSegments.filter((segment) => !failed.has(segment.id)),
    [pendingSegments, failed]
  )
  const translatedCount = Object.keys(translations).length
  const failedSegments = useMemo(
    () =>
      selectedFiles.flatMap((file) =>
        file.segments.filter((segment) => failed.has(segment.id))
      ),
    [selectedFiles, failed]
  )
  const filteredFiles = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return files
    return files.filter(
      (file) =>
        file.path.toLowerCase().includes(keyword) ||
        (file.sourceLabel ?? '').toLowerCase().includes(keyword) ||
        (file.targetPath ?? '').toLowerCase().includes(keyword)
    )
  }, [files, query])
  const filteredGlossary = useMemo(() => {
    const keyword = glossaryQuery.trim().toLowerCase()
    const source = keyword
      ? glossary.filter(
          (entry) =>
            entry.source.toLowerCase().includes(keyword) ||
            entry.target.toLowerCase().includes(keyword)
        )
      : glossary
    return source.slice(0, GLOSSARY_VISIBLE)
  }, [glossary, glossaryQuery])
  const hasFtb = files.some(
    (file) => file.kind === 'ftb-lang' || file.kind === 'ftb-chapter'
  )
  const hasPackFiles = files.some(
    (file) => file.kind === 'mod-lang' || file.kind === 'patchouli'
  )
  const hasShaderFiles = files.some((file) => file.kind === 'shader-lang')

  const loadPreview = useCallback(
    async (fileId: string, current: Record<string, string>) => {
      if (!instanceId) return
      setPreviewBusy(true)
      try {
        const next = await window.ccl.translation.preview({
          instanceId,
          fileId,
          translations: current,
          bilingual
        })
        setPreview(next)
      } catch (cause) {
        setPreview(null)
        setError(cleanError(cause))
      } finally {
        setPreviewBusy(false)
      }
    },
    [instanceId, bilingual]
  )

  useEffect(() => {
    if (phase !== 'review' || !activeId) {
      setPreview(null)
      return
    }
    const timer = window.setTimeout(() => {
      void loadPreview(activeId, translations)
    }, 260)
    return () => window.clearTimeout(timer)
  }, [phase, activeId, translations, loadPreview, bilingual])

  const saveGlossary = async (entries: TranslationGlossaryEntry[]) => {
    if (entries.length === 0) {
      setError('术语表至少保留一条术语')
      return
    }
    setGlossarySaving(true)
    try {
      const saved = await window.ccl.translation.saveGlossary(entries)
      setGlossary(saved)
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setGlossarySaving(false)
    }
  }

  const addGlossary = () => {
    const source = newSource.trim()
    const target = newTarget.trim()
    if (!source || !target) {
      setError('请填写术语原文和译文')
      return
    }
    const lower = source.toLowerCase()
    const existing = glossary.findIndex((entry) => entry.source.toLowerCase() === lower)
    const next =
      existing >= 0
        ? glossary.map((entry, index) =>
            index === existing ? { source, target } : entry
          )
        : [...glossary, { source, target }]
    setGlossary(next)
    setNewSource('')
    setNewTarget('')
    void saveGlossary(next)
  }

  const removeGlossary = (index: number) => {
    if (glossary.length <= 1) {
      setError('术语表至少保留一条术语')
      return
    }
    const next = glossary.filter((_, current) => current !== index)
    setGlossary(next)
    void saveGlossary(next)
  }

  const importGlossary = async (file: File) => {
    setError('')
    try {
      const entries = parseGlossaryText(await file.text(), file.name)
      if (entries.length === 0) {
        setError('没有从文件里解析到术语；支持 CSV/TSV/JSON/TXT')
        return
      }
      const merged = new Map(glossary.map((entry) => [entry.source.toLowerCase(), entry]))
      for (const entry of entries) merged.set(entry.source.toLowerCase(), entry)
      const next = [...merged.values()]
      if (next.length > 300_000) {
        setError('术语超过 30 万条，已截断')
      }
      const limited = next.slice(0, 300_000)
      setGlossary(limited)
      await saveGlossary(limited)
      toast('success', '术语库已导入', `新增/更新 ${entries.length} 条，共 ${limited.length} 条`)
    } catch (cause) {
      setError(cleanError(cause))
    }
  }

  const exportGlossary = () => {
    const blob = new Blob([glossaryToCsv(glossary)], {
      type: 'text/csv;charset=utf-8'
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'windletter-glossary.csv'
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const startEditSegment = (id: string, text: string) => {
    setEditingId(id)
    setEditingText(text)
  }

  const saveEditedSegment = () => {
    if (!editingId) return
    if (!editingText.trim()) {
      setError('译文不能为空')
      return
    }
    setTranslationSessionItem(editingId, editingText)
    setEditingId(null)
    setEditingText('')
  }

  const retranslateSegment = async (segment: TranslationFileView['segments'][number]) => {
    if (!scan || !instanceId) return
    setError('')
    try {
      const index = buildGlossaryIndex(glossary)
      const result = await window.ccl.translation.translate({
        instanceId,
        glossary: selectRelevantGlossary(index, [segment.source]),
        items: [
          {
            id: segment.id,
            text: segment.source,
            field: `${segment.fileId} · ${segment.field}`,
            kind: segment.kind
          }
        ]
      })
      const translated = result.items.find((item) => item.id === segment.id)?.text
      if (!translated) {
        setError('单条重译没有返回可用中文，已保留原文')
        return
      }
      setTranslationSessionItem(segment.id, translated)
      toast('success', '已重译', segment.field)
    } catch (cause) {
      setError(cleanError(cause))
    }
  }

  const enablePack = async () => {
    if (!scan || !instanceId) return
    setPackBusy(true)
    setError('')
    try {
      const result = await window.ccl.translation.enablePack(instanceId)
      setScan((current) =>
        current
          ? {
              ...current,
              resourcePack: { ...current.resourcePack, enabled: result.enabled }
            }
          : current
      )
      toast('success', '资源包已加入列表', result.message)
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setPackBusy(false)
    }
  }

  const startTranslate = () => {
    if (!scan || !instanceId) return
    if (!scan.aiEnabled) {
      setError('AI 辅助还没有启用，请先到「设置 → AI 辅助」配置服务')
      return
    }
    if (pendingTranslateSegments.length === 0) return
    if (pendingTranslateSegments.length > 400) {
      setStartConfirm(true)
      return
    }
    setError('')
    const fileIds = selectedFiles
      .filter((file) => file.segments.length > 0)
      .map((file) => file.id)
    void startTranslationSession({ instanceId, scan, fileIds, glossary })
  }

  const retryFailed = () => {
    if (!scan || !instanceId || failedSegments.length === 0) return
    setError('')
    const fileIds = selectedFiles
      .filter((file) => file.segments.length > 0)
      .map((file) => file.id)
    void retryTranslationSession({ instanceId, scan, fileIds, glossary })
  }

  const apply = async () => {
    if (!scan || !instanceId) return
    const payload = selectedFiles
      .map((file) => {
        const picked: Record<string, string> = {}
        for (const segment of file.segments) {
          const translated = translations[segment.id]
          if (translated) picked[segment.id] = translated
        }
        return {
          fileId: file.id,
          translations: picked,
          expectedModified: file.modified,
          expectedTargetModified: file.targetModified
        }
      })
      .filter((file) => Object.keys(file.translations).length > 0)
    if (payload.length === 0) {
      setError('没有可应用的文件')
      return
    }
    setApplyConfirm(false)
    setApplying(true)
    setError('')
    try {
      const result = await window.ccl.translation.apply({
        instanceId,
        files: payload,
        bilingual
      })
      setApplyResult(result)
      markTranslationSessionApplied()
      toast(
        result.skipped.length > 0 ? 'info' : 'success',
        '汉化已应用',
        `已写入 ${result.written.length} 个文件${result.skipped.length > 0 ? `，跳过 ${result.skipped.length} 个` : ''}`
      )
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setApplying(false)
    }
  }

  const close = () => {
    if (applying) return
    if (busy) {
      toast('info', '汉化在后台继续', '可以先去处理别的事；重新打开「汉化」即可查看进度。')
      onClose()
      return
    }
    if (translatedCount > 0 && phase !== 'applied') {
      toast('info', '进度已保留', '重新打开「汉化」可以继续预览或应用。')
    }
    onClose()
  }

  const toggleFile = (file: TranslationFileView) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(file.id)) next.delete(file.id)
      else next.add(file.id)
      return next
    })
  }

  const activeSegments = activeFile?.segments ?? []
  const activeTranslated = activeSegments.filter((segment) => translations[segment.id])
  const appliedPaths = useMemo(
    () => new Set((applyResult?.written ?? []).map((item) => item.path)),
    [applyResult]
  )
  const progressPercent =
    progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <>
      <Modal
        open={instance !== null}
        onClose={close}
        title="整合包汉化"
        subtitle="批量翻译 FTB 任务书、lang、模组配置和光影设置说明；先预览 diff，确认后才写入。术语、占位符和原格式都会保留。"
        icon={<Languages size={18} />}
        size="full"
        closeOnOverlay={!applying}
        closeOnEscape={!applying}
        footer={
          <div className="translation-footer">
            <div className="translation-footer-stats">
              <span>{selectedFiles.length} 个文件</span>
              <span>{translatedCount} 条已翻译</span>
              {failedSegments.length > 0 && <span className="is-warn">{failedSegments.length} 条失败</span>}
              {scan && <span>{scan.totals.characters.toLocaleString('zh-CN')} 字符</span>}
              {modelNote && <span>{modelNote}</span>}
            </div>
            <div className="translation-footer-actions">
              {phase === 'applied' ? (
                <button type="button" className="button button--soft button--sm" onClick={() => void load(scope, true)}>
                  <RefreshCw size={12} />
                  重新扫描
                </button>
              ) : busy ? (
                <>
                  <span className="translation-progress-text">
                    {progress.done}/{progress.total}
                  </span>
                  <ProgressBar percent={progressPercent} size="sm" />
                  <button
                    type="button"
                    className="button button--ghost button--sm"
                    onClick={() => cancelTranslationSession()}
                  >
                    暂停
                  </button>
                </>
              ) : pendingTranslateSegments.length > 0 ? (
                <button
                  type="button"
                  className="button button--primary button--sm"
                  disabled={!scan?.aiEnabled}
                  onClick={startTranslate}
                >
                  <Sparkles size={12} />
                  {translatedCount > 0 ? '继续翻译' : '开始翻译'}
                </button>
              ) : null}
              {failedSegments.length > 0 && !busy && phase === 'review' && (
                <button type="button" className="button button--soft button--sm" onClick={retryFailed}>
                  <RefreshCw size={12} />
                  重试失败
                </button>
              )}
              {phase !== 'applied' && (
                <button
                  type="button"
                  className="button button--primary button--sm"
                  disabled={
                    busy ||
                    applying ||
                    phase !== 'review' ||
                    translatedCount === 0 ||
                    selectedFiles.length === 0
                  }
                  onClick={() => setApplyConfirm(true)}
                >
                  {applying ? <Spinner size={12} /> : <Check size={12} />}
                  应用选中文件
                </button>
              )}
              <button type="button" className="button button--ghost button--sm" onClick={close} disabled={applying}>
                关闭
              </button>
            </div>
          </div>
        }
      >
        <div className="translation-workbench">
          <div className="translation-toolbar">
            <div className="translation-toolbar-title">
              <strong>{scan?.instanceName ?? instance?.name ?? '整合包汉化'}</strong>
              <span>
                Minecraft {scan?.gameVersion ?? instance?.gameVersion} · {scan?.loader ?? instance?.loader}
              </span>
              {scan && (
                <Badge tone={scan.aiEnabled ? 'success' : 'warning'}>
                  {scan.aiEnabled ? `AI ${scan.aiModel ?? '已启用'}` : 'AI 未启用'}
                </Badge>
              )}
            </div>
            <div className="translation-toolbar-actions">
              <label className="translation-scope" title="切换扫描范围；配置、模组或光影很多时可分批处理">
                <select
                  value={scope}
                  disabled={loading || busy}
                  onChange={(event) => {
                    const next = event.target.value as TranslationScanScope
                    if (translatedCount > 0) {
                      toast('info', '已切换扫描范围', '当前翻译结果已清空，请重新翻译。')
                    }
                    setScope(next)
                    void load(next, true)
                  }}
                >
                  {(Object.keys(SCOPE_LABEL) as TranslationScanScope[]).map((value) => (
                    <option key={value} value={value}>
                      {SCOPE_LABEL[value]}
                    </option>
                  ))}
                </select>
              </label>
              {hasFtb && (
                <label className="translation-bilingual" title="任务书译文后保留英文原文">
                  <input
                    type="checkbox"
                    checked={bilingual}
                    onChange={(event) => setBilingual(event.target.checked)}
                  />
                  中英对照
                </label>
              )}
              <label className="translation-search">
                <Search size={12} />
                <input
                  value={query}
                  placeholder="过滤文件"
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <button
                type="button"
                className="button button--soft button--sm"
                onClick={() =>
                  setSelected(
                    new Set(filteredFiles.filter((file) => file.segments.length > 0).map((file) => file.id))
                  )
                }
              >
                全选
              </button>
              <button type="button" className="button button--ghost button--sm" onClick={() => setSelected(new Set())}>
                清空
              </button>
              <button
                type="button"
                className={`button button--sm ${glossaryOpen ? 'button--primary' : 'button--soft'}`}
                onClick={() => setGlossaryOpen((current) => !current)}
              >
                <BookOpen size={12} />
                术语表
              </button>
              <button type="button" className="button button--ghost button--sm" onClick={() => void load(scope, true)} disabled={loading || busy}>
                <RefreshCw size={12} className={loading ? 'spin' : ''} />
                重新扫描
              </button>
            </div>
          </div>

          {(error || sessionError) && (
            <div className="translation-error">
              <AlertTriangle size={14} />
              <span>{error || sessionError}</span>
              <button
                type="button"
                className="translation-icon-btn"
                onClick={() => {
                  setError('')
                  clearTranslationSessionError()
                }}
              >
                <X size={12} />
              </button>
            </div>
          )}
          {scan && !scan.aiEnabled && (
            <div className="translation-warning">
              <AlertTriangle size={13} />
              <span>
                还没有启用 AI 翻译。术语表可以先编辑；到「设置 → AI 辅助」启用服务后重新扫描即可开始翻译。
              </span>
            </div>
          )}
          {scan && scan.warnings.length > 0 && (
            <div className="translation-warning">
              <AlertTriangle size={13} />
              <span>{scan.warnings.slice(0, 3).join('；')}</span>
            </div>
          )}
          {aiWarnings.length > 0 && (
            <div className="translation-warning">
              <AlertTriangle size={13} />
              <span>{aiWarnings.slice(0, 4).join('；')}</span>
            </div>
          )}
          {scan?.resourcePack && hasPackFiles && (
            <div className="translation-pack-note">
              <Languages size={13} />
              <span>
                模组/手册译文会写入补充汉化资源包：<code>{scan.resourcePack.folder}</code>
                {scan.resourcePack.enabled ? '（已在资源包列表）' : '（应用后可加入资源包列表）'}
              </span>
            </div>
          )}
          {hasShaderFiles && (
            <div className="translation-pack-note">
              <Languages size={13} />
              <span>
                光影译文会就地写入 <code>shaderpacks/*/shaders/lang/zh_cn.lang</code>，旧中文语言先备份；不需要资源包启用。
              </span>
            </div>
          )}
          {applyResult && (
            <div className="translation-result">
              <Check size={14} />
              <div>
                <strong>
                  已写入 {applyResult.written.length} 个文件
                  {applyResult.skipped.length > 0 ? `，跳过 ${applyResult.skipped.length} 个` : ''}
                </strong>
                {applyResult.written.slice(0, 6).map((item) => (
                  <span key={item.path}>
                    {item.path} · {item.segments} 条{item.backup ? ` · 备份 ${item.backup}` : ''}
                  </span>
                ))}
                {applyResult.skipped.slice(0, 4).map((item) => (
                  <span key={item.path} className="is-warn">
                    {item.path}：{item.reason}
                  </span>
                ))}
                {scan?.resourcePack &&
                  !scan.resourcePack.enabled &&
                  applyResult.written.some((item) => item.path.startsWith('resourcepacks/')) && (
                    <button
                      type="button"
                      className="button button--soft button--sm"
                      disabled={packBusy}
                      onClick={() => void enablePack()}
                    >
                      {packBusy ? <Spinner size={11} /> : <Check size={11} />}
                      加入资源包列表
                    </button>
                  )}
              </div>
            </div>
          )}

          <div className={`translation-columns ${glossaryOpen ? '' : 'is-glossary-hidden'}`}>
            <aside className="translation-files">
              <div className="translation-panel-head">
                <strong>待翻译文件</strong>
                <span>{filteredFiles.length}</span>
              </div>
              <div className="translation-file-list">
                {loading ? (
                  <div className="translation-empty">
                    <Spinner size={15} />
                    正在扫描任务书、lang 和配置…
                  </div>
                ) : filteredFiles.length === 0 ? (
                  <div className="translation-empty">
                    <Languages size={20} />
                    <span>没有找到可翻译的英文说明</span>
                    <small>支持 FTB Quests、模组 jar、帕秋莉手册、光影 lang 和 TOML/CFG 配置注释。</small>
                  </div>
                ) : (
                  filteredFiles.map((file) => (
                    <button
                      type="button"
                      key={file.id}
                      className={`translation-file ${activeId === file.id ? 'is-active' : ''} ${
                        selected.has(file.id) ? 'is-selected' : ''
                      }`}
                      onClick={() => setActiveId(file.id)}
                    >
                      <span
                        className="translation-file-check"
                        role="checkbox"
                        aria-checked={selected.has(file.id)}
                        onClick={(event) => {
                          event.stopPropagation()
                          toggleFile(file)
                        }}
                      >
                        {selected.has(file.id) ? <Check size={10} /> : null}
                      </span>
                      <span className="translation-file-icon">{fileIcon(file)}</span>
                      <span className="translation-file-copy">
                        <strong>{file.path.split('/').pop()}</strong>
                        <span>{file.sourceLabel ?? file.path}</span>
                        <span className="translation-file-meta">
                          {KIND_LABEL[file.kind]} · {file.segments.length} 条
                          {file.targetPath && ` → ${file.targetPath}`}
                        </span>
                      </span>
                      <span className="translation-file-side">
                        {phase === 'applied' && appliedPaths.has(file.targetPath ?? file.path) ? (
                          <Badge tone="success">已写入</Badge>
                        ) : (
                          <Badge tone={file.action === 'in-place' ? 'warning' : file.action === 'create' ? 'success' : 'accent'}>
                            {ACTION_LABEL[file.action]}
                          </Badge>
                        )}
                        {file.warnings.length > 0 && <span className="translation-file-warn">{file.warnings.length} 警告</span>}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </aside>

            <main className="translation-preview">
              {!activeFile ? (
                <div className="translation-empty translation-empty--large">
                  <Languages size={26} />
                  <span>选择一个文件查看翻译内容</span>
                </div>
              ) : (
                <>
                  <div className="translation-preview-head">
                    <div>
                      <strong>{activeFile.path}</strong>
                      <span>
                        {activeFile.targetPath ? `写入 ${activeFile.targetPath}` : '就地修改原文件'}
                        {activeFile.targetModified ? ' · 目标已存在，只补缺失键' : ''}
                      </span>
                    </div>
                    <div className="translation-preview-tools">
                      <button
                        type="button"
                        className={`translation-tab ${viewMode === 'diff' ? 'is-active' : ''}`}
                        onClick={() => setViewMode('diff')}
                      >
                        整文件 diff
                      </button>
                      <button
                        type="button"
                        className={`translation-tab ${viewMode === 'segments' ? 'is-active' : ''}`}
                        onClick={() => setViewMode('segments')}
                      >
                        改动条目 {activeTranslated.length}
                      </button>
                    </div>
                  </div>
                  <div className="translation-preview-body">
                    {phase === 'select' ? (
                      <div className="translation-empty translation-empty--large">
                        <Sparkles size={24} />
                        <span>{busy ? '正在翻译，完成后会在这里显示预览' : '开始翻译后在这里预览 diff'}</span>
                        <small>只有点击「应用选中文件」才会写入磁盘。</small>
                      </div>
                    ) : previewBusy ? (
                      <div className="translation-empty">
                        <Spinner size={15} />
                        正在生成预览…
                      </div>
                    ) : viewMode === 'diff' ? (
                      preview ? (
                        <div className="translation-diff">
                          <div className="translation-diff-summary">
                            <span>
                              改动 {preview.changed} 条
                              {preview.warnings.length > 0 ? ` · ${preview.warnings.length} 条已保留原文` : ''}
                            </span>
                            <span>{preview.targetPath ? '目标文件' : '原文件'}</span>
                          </div>
                          <DiffView
                            before={preview.before}
                            after={preview.after}
                            labelBefore={preview.targetPath ?? '原文件'}
                            labelAfter="应用后"
                          />
                          {preview.warnings.length > 0 && (
                            <div className="translation-warning">
                              <AlertTriangle size={12} />
                              <span>{preview.warnings.slice(0, 5).join('；')}</span>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="translation-empty">预览不可用，请重新扫描。</div>
                      )
                    ) : (
                      <div className="translation-segment-list">
                        {activeSegments.length === 0 ? (
                          <div className="translation-empty">这个文件没有可翻译的条目。</div>
                        ) : (
                          activeSegments.slice(0, 300).map((segment) => {
                            const translated = translations[segment.id]
                            return (
                              <div key={segment.id} className={`translation-segment ${translated ? 'is-done' : ''}`}>
                                <div className="translation-segment-head">
                                  <span>{segment.field}</span>
                                  <span>第 {segment.line} 行</span>
                                  {failed.has(segment.id) && <em className="is-warn">失败，保留原文</em>}
                                </div>
                                <p className="translation-segment-source">{segment.source}</p>
                                {editingId === segment.id ? (
                                  <div className="translation-segment-editor">
                                    <textarea
                                      value={editingText}
                                      autoFocus
                                      onChange={(event) => setEditingText(event.target.value)}
                                      onKeyDown={(event) => {
                                        if (event.key === 'Escape') {
                                          setEditingId(null)
                                          setEditingText('')
                                        }
                                      }}
                                    />
                                    <div>
                                      <button
                                        type="button"
                                        className="button button--primary button--xs"
                                        onClick={saveEditedSegment}
                                      >
                                        保存
                                      </button>
                                      <button
                                        type="button"
                                        className="button button--ghost button--xs"
                                        onClick={() => {
                                          setEditingId(null)
                                          setEditingText('')
                                        }}
                                      >
                                        取消
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <>
                                    <p className="translation-segment-target">
                                      {translated ?? '未翻译'}
                                    </p>
                                    <div className="translation-segment-actions">
                                      <button
                                        type="button"
                                        className="button button--ghost button--xs"
                                        onClick={() =>
                                          startEditSegment(segment.id, translated ?? '')
                                        }
                                      >
                                        编辑
                                      </button>
                                      <button
                                        type="button"
                                        className="button button--ghost button--xs"
                                        onClick={() => void retranslateSegment(segment)}
                                      >
                                        重译
                                      </button>
                                    </div>
                                  </>
                                )}
                              </div>
                            )
                          })
                        )}
                        {activeSegments.length > 300 && (
                          <p className="translation-segment-more">
                            仅显示前 300 条，共 {activeSegments.length} 条。
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
            </main>

            <aside className="translation-glossary">
              <div className="translation-panel-head">
                <strong>术语表</strong>
                <span>
                  {glossary.length}
                  {glossary.length > GLOSSARY_VISIBLE ? ` · 显示前 ${GLOSSARY_VISIBLE}` : ''}
                  {scan && scan.communityGlossaryCount > 0
                    ? ` · 内置 ${scan.communityGlossaryCount.toLocaleString()}`
                    : ''}
                  {glossarySaving ? ' · 保存中' : ''}
                </span>
              </div>
              <div className="translation-glossary-tools">
                <input
                  value={glossaryQuery}
                  placeholder="搜索术语"
                  onChange={(event) => setGlossaryQuery(event.target.value)}
                />
                <button
                  type="button"
                  className="button button--ghost button--sm"
                  onClick={() => glossaryFileRef.current?.click()}
                >
                  导入
                </button>
                <button
                  type="button"
                  className="button button--ghost button--sm"
                  onClick={exportGlossary}
                >
                  导出
                </button>
                <input
                  ref={glossaryFileRef}
                  type="file"
                  accept=".csv,.tsv,.txt,.json"
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) void importGlossary(file)
                    event.target.value = ''
                  }}
                />
              </div>
              <div className="translation-glossary-add">
                <input
                  value={newSource}
                  placeholder="English"
                  onChange={(event) => setNewSource(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') addGlossary()
                  }}
                />
                <input
                  value={newTarget}
                  placeholder="中文"
                  onChange={(event) => setNewTarget(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') addGlossary()
                  }}
                />
                <button type="button" className="translation-icon-btn is-accent" onClick={addGlossary} title="添加术语">
                  <Plus size={12} />
                </button>
              </div>
              <div className="translation-glossary-list">
                {filteredGlossary.length === 0 ? (
                  <span className="translation-glossary-empty">没有匹配的术语</span>
                ) : (
                  filteredGlossary.map((entry) => {
                    const index = glossary.indexOf(entry)
                    return (
                      <div key={`${entry.source}-${index}`} className="translation-glossary-row">
                        <input
                          value={entry.source}
                          onChange={(event) =>
                            setGlossary((current) =>
                              current.map((item, currentIndex) =>
                                currentIndex === index
                                  ? { ...item, source: event.target.value }
                                  : item
                              )
                            )
                          }
                          onBlur={() => void saveGlossary(glossary)}
                        />
                        <input
                          value={entry.target}
                          onChange={(event) =>
                            setGlossary((current) =>
                              current.map((item, currentIndex) =>
                                currentIndex === index
                                  ? { ...item, target: event.target.value }
                                  : item
                              )
                            )
                          }
                          onBlur={() => void saveGlossary(glossary)}
                        />
                        <button
                          type="button"
                          className="translation-icon-btn"
                          title="删除术语"
                          onClick={() => removeGlossary(index)}
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    )
                  })
                )}
              </div>
              <p className="translation-glossary-tip">
                支持导入 CSV / TSV / JSON 术语库；每批只发送文本命中的术语，不会把整库塞给 AI。修改后自动保存。
                {scan && scan.communityGlossaryCount > 0
                  ? ` 内置社区词库 ${scan.communityGlossaryCount.toLocaleString()} 条会自动参与命中，不写入你的文件（CFPA，CC BY-NC-SA 4.0）。`
                  : ''}
              </p>
            </aside>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={startConfirm}
        title="开始批量翻译"
        message={
          <span>
            将翻译 {pendingTranslateSegments.length.toLocaleString('zh-CN')} 条，约{' '}
            {Math.ceil(pendingTranslateSegments.length / 24).toLocaleString('zh-CN')} 批 AI 请求。
            如果只想先试一部分，可以缩小扫描范围或在左侧取消选择文件。
          </span>
        }
        confirmLabel="继续翻译"
        onConfirm={() => {
          setStartConfirm(false)
          if (!scan || !instanceId) return
          const fileIds = selectedFiles
            .filter((file) => file.segments.length > 0)
            .map((file) => file.id)
          void startTranslationSession({ instanceId, scan, fileIds, glossary })
        }}
        onCancel={() => setStartConfirm(false)}
      />
      <ConfirmDialog
        open={applyConfirm}
        title="应用汉化"
        message={
          <span>
            将写入 {selectedFiles.filter((file) => file.segments.some((segment) => translations[segment.id])).length} 个文件。
            就地修改的配置、任务书和光影包会先备份到实例的 <code>backups/translation</code>；写入后游戏内文本才会变化。
          </span>
        }
        confirmLabel="写入文件"
        busy={applying}
        onConfirm={() => void apply()}
        onCancel={() => setApplyConfirm(false)}
      />
    </>
  )
}

