import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Code2,
  Download,
  Layers,
  RefreshCw,
  Search,
  Square,
  Wrench
} from 'lucide-react'
import type {
  InstanceSummary,
  WorkshopExportProgress,
  WorkshopModView,
  WorkshopReport
} from '@shared/types'
import { useLauncher } from '../store'
import { cleanError, formatBytes } from '../lib/format'
import { Modal, ProgressBar, Spinner, Switch } from './ui'
import { KubeJsWorkbench } from './KubeJsWorkbench'

type Tab = 'mods' | 'kubejs'
type ModFilter = 'all' | 'client' | 'server' | 'both' | 'unknown' | 'missing' | 'duplicate' | 'clientDependency'

const FILTERS: { id: ModFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'client', label: '仅客户端' },
  { id: 'server', label: '仅服务端' },
  { id: 'both', label: '双端' },
  { id: 'unknown', label: '未知' },
  { id: 'missing', label: '缺依赖' },
  { id: 'duplicate', label: '重复 ID' },
  { id: 'clientDependency', label: '客户端依赖' }
]

function safeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || 'modpack'
}

function sideLabel(side: WorkshopModView['side']): string {
  return side === 'client'
    ? '仅客户端'
    : side === 'server'
      ? '仅服务端'
      : side === 'both'
        ? '双端'
        : '未知'
}

export function PackWorkshopModal({
  instance,
  onClose
}: {
  instance: InstanceSummary | null
  onClose: () => void
}) {
  const toast = useLauncher((state) => state.toast)
  const [tab, setTab] = useState<Tab>('kubejs')
  const [report, setReport] = useState<WorkshopReport | null>(null)
  const [mods, setMods] = useState<WorkshopModView[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<ModFilter>('all')
  const [query, setQuery] = useState('')

  const [includeConfigs, setIncludeConfigs] = useState(true)
  const [includeKubejs, setIncludeKubejs] = useState(true)
  const [includePacks, setIncludePacks] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [progress, setProgress] = useState<WorkshopExportProgress>({
    done: 0,
    total: 0,
    bytes: 0
  })
  const [exportResult, setExportResult] = useState('')

  const [kubeFileCount, setKubeFileCount] = useState(0)
  const [kubeDirty, setKubeDirty] = useState(false)
  const [kubeBusy, setKubeBusy] = useState(false)

  const instanceId = instance?.id ?? ''

  const loadReport = useCallback(async () => {
    if (!instanceId) return
    setLoading(true)
    setError('')
    setExportResult('')
    try {
      const next = await window.ccl.workshop.report(instanceId)
      setReport(next)
      setMods(next.mods)
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setLoading(false)
    }
  }, [instanceId])

  useEffect(() => {
    if (!instanceId) return
    setFilter('all')
    setQuery('')
    setIncludeConfigs(true)
    setIncludeKubejs(true)
    setIncludePacks(true)
    setProgress({ done: 0, total: 0, bytes: 0 })
    setKubeFileCount(0)
    setKubeDirty(false)
    setKubeBusy(false)
  }, [instanceId])

  useEffect(() => {
    if (!instanceId) return
    return window.ccl.workshop.onExportProgress((next) => setProgress(next))
  }, [instanceId])

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return mods.filter((mod) => {
      if (
        filter !== 'all' &&
        !(
          (filter === 'missing' && mod.missing.length > 0) ||
          (filter === 'duplicate' && mod.duplicate) ||
          (filter === 'clientDependency' && mod.clientDependency) ||
          (['client', 'server', 'both', 'unknown'] as ModFilter[]).includes(filter) &&
            mod.side === filter
        )
      ) {
        return false
      }
      if (!keyword) return true
      return (
        mod.file.toLowerCase().includes(keyword) ||
        mod.name.toLowerCase().includes(keyword) ||
        (mod.id ?? '').toLowerCase().includes(keyword)
      )
    })
  }, [mods, filter, query])

  const included = mods.filter((mod) => mod.include)
  const includedBytes = included.reduce((sum, mod) => sum + mod.size, 0)

  const toggle = (file: string) => {
    setMods((current) =>
      current.map((mod) => (mod.file === file ? { ...mod, include: !mod.include } : mod))
    )
  }

  const changeTab = (next: Tab) => {
    setTab(next)
    if (next === 'mods' && !report && !loading) void loadReport()
  }

  const requestClose = () => {
    if (exporting) {
      toast('info', '正在导出', '请等待 .mrpack 写入完成')
      return
    }
    if (kubeBusy) {
      toast('info', '正在处理 KubeJS', '请等待当前操作完成')
      return
    }
    if (kubeDirty && !window.confirm('KubeJS 有未保存的修改，确定关闭吗？')) return
    onClose()
  }

  const exportPack = async () => {
    if (!instance || included.length === 0 || exporting) return
    const path = await window.ccl.app.pickSaveFile(
      '导出筛选后的整合包',
      `${safeFileName(instance.name)}-filtered.mrpack`,
      [{ name: 'Modrinth 整合包', extensions: ['mrpack'] }]
    )
    if (!path) return
    setExporting(true)
    setError('')
    setExportResult('')
    setProgress({ done: 0, total: 0, bytes: 0 })
    try {
      const result = await window.ccl.workshop.exportPack({
        instanceId: instance.id,
        outputPath: path,
        options: {
          includeMods: included.map((mod) => mod.file),
          includeConfigs,
          includeKubejs,
          includeResourcepacks: includePacks,
          includeShaderpacks: includePacks,
          includeDatapacks: includePacks
        }
      })
      setExportResult(result.path)
      toast('success', '筛选后的整合包已导出', `${included.length} 个模组 · ${formatBytes(result.bytes)}`)
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setExporting(false)
    }
  }

  const handleKubeDirty = useCallback((value: boolean) => setKubeDirty(value), [])
  const handleKubeBusy = useCallback((value: boolean) => setKubeBusy(value), [])
  const handleKubeFileCount = useCallback((value: number) => setKubeFileCount(value), [])

  if (!instance) return null
  const percent = progress.total > 0 ? (progress.done / progress.total) * 100 : 0

  return (
    <Modal
      open={Boolean(instance)}
      onClose={requestClose}
      title={tab === 'kubejs' ? 'KubeJS 工作台' : '整合包工坊'}
      subtitle={`${instance.name} · Minecraft ${instance.gameVersion} · ${instance.loader === 'vanilla' ? '原版' : instance.loader}`}
      icon={tab === 'kubejs' ? <Code2 size={18} /> : <Wrench size={18} />}
      size={tab === 'kubejs' ? 'full' : 'xl'}
      closeOnEscape={tab !== 'kubejs'}
      footer={
        tab === 'mods' ? (
          <div className="workshop-footer">
            <span>
              已选 {included.length} / {mods.length} 个模组 · {formatBytes(includedBytes)}
            </span>
            <div>
              <button type="button" className="button button--ghost" onClick={requestClose}>
                关闭
              </button>
              <button
                type="button"
                className="button button--primary"
                disabled={included.length === 0 || exporting}
                onClick={() => void exportPack()}
              >
                {exporting ? <Spinner size={13} /> : <Download size={13} />}
                {exporting ? '正在导出…' : '导出筛选后的整合包'}
              </button>
            </div>
          </div>
        ) : undefined
      }
    >
      <div className={`workshop-tabs ${tab === 'kubejs' ? 'is-studio' : ''}`}>
        <button
          type="button"
          className={`workshop-tab ${tab === 'mods' ? 'is-active' : ''}`}
          onClick={() => changeTab('mods')}
        >
          <Layers size={14} />
          模组筛选
          {mods.length > 0 && <em>{mods.length}</em>}
        </button>
        <button
          type="button"
          className={`workshop-tab ${tab === 'kubejs' ? 'is-active' : ''}`}
          onClick={() => changeTab('kubejs')}
        >
          <Code2 size={14} />
          KubeJS 工作台
          {kubeFileCount > 0 && <em>{kubeFileCount}</em>}
        </button>
        {tab === 'mods' && (
          <button
            type="button"
            className="workshop-refresh"
            onClick={() => void loadReport()}
            disabled={loading || exporting}
            title="重新扫描模组和 KubeJS"
          >
            <RefreshCw size={13} />
          </button>
        )}
      </div>

      <div className={`workshop-pane ${tab === 'mods' ? 'is-active' : ''}`}>
        {loading && !report ? (
          <div className="workshop-loading">
            <Spinner size={16} />
            正在扫描模组依赖与 KubeJS…
          </div>
        ) : error && !report ? (
          <div className="workshop-error">
            <AlertTriangle size={14} />
            <span>{error}</span>
            <button type="button" className="link-button" onClick={() => void loadReport()}>
              重试
            </button>
          </div>
        ) : report ? (
          <div className="workshop-mods">
            <div className="workshop-summary">
              <div>
                <strong>{report.counts.total}</strong>
                <span>模组</span>
              </div>
              <div>
                <strong>{report.counts.client}</strong>
                <span>仅客户端</span>
              </div>
              <div>
                <strong>{report.counts.server}</strong>
                <span>仅服务端</span>
              </div>
              <div>
                <strong>{report.counts.unknown}</strong>
                <span>未知双端</span>
              </div>
              <div className={report.counts.missing > 0 ? 'is-warn' : ''}>
                <strong>{report.counts.missing}</strong>
                <span>缺依赖</span>
              </div>
              <div className={report.counts.duplicates > 0 ? 'is-warn' : ''}>
                <strong>{report.counts.duplicates}</strong>
                <span>重复 ID</span>
              </div>
              <div className={report.counts.clientDependency > 0 ? 'is-warn' : ''}>
                <strong>{report.counts.clientDependency}</strong>
                <span>客户端依赖</span>
              </div>
            </div>

            <div className="workshop-toolbar">
              <div className="workshop-search">
                <Search size={13} />
                <input
                  value={query}
                  placeholder="搜索文件名、模组名或 ID"
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <div className="workshop-filters">
                {FILTERS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={filter === item.id ? 'is-active' : ''}
                    onClick={() => setFilter(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="workshop-bulk">
              <button
                type="button"
                className="link-button"
                onClick={() =>
                  setMods((current) => current.map((mod) => ({ ...mod, include: true })))
                }
              >
                <CheckCircle2 size={12} />
                全选
              </button>
              <button
                type="button"
                className="link-button"
                onClick={() =>
                  setMods((current) =>
                    current.map((mod) => ({ ...mod, include: mod.side !== 'client' }))
                  )
                }
              >
                <Square size={12} />
                仅双端/服务端
              </button>
              <button
                type="button"
                className="link-button"
                onClick={() =>
                  setMods((current) =>
                    current.map((mod) => ({ ...mod, include: mod.side !== 'server' }))
                  )
                }
              >
                <Square size={12} />
                仅双端/客户端
              </button>
              <button
                type="button"
                className="link-button"
                onClick={() =>
                  setMods((current) => current.map((mod) => ({ ...mod, include: false })))
                }
              >
                清空
              </button>
              <span>{filtered.length} 条匹配</span>
            </div>

            <div className="workshop-mod-list">
              {filtered.length === 0 ? (
                <p className="workshop-empty">没有匹配的模组。</p>
              ) : (
                filtered.map((mod) => (
                  <label
                    key={mod.file}
                    className={`workshop-mod ${mod.include ? 'is-included' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={mod.include}
                      onChange={() => toggle(mod.file)}
                    />
                    <div className="workshop-mod-copy">
                      <span className="workshop-mod-title">
                        <strong title={mod.name}>{mod.name}</strong>
                        <em className={`workshop-side is-${mod.side}`}>{sideLabel(mod.side)}</em>
                        {mod.duplicate && <em className="workshop-flag is-warn">重复 ID</em>}
                        {mod.missing.length > 0 && (
                          <em className="workshop-flag is-danger">缺 {mod.missing.length} 个依赖</em>
                        )}
                        {mod.clientDependency && (
                          <em className="workshop-flag is-warn">依赖客户端 {mod.clientDependency}</em>
                        )}
                      </span>
                      <small title={mod.file}>
                        {mod.file}
                        {mod.id ? ` · ${mod.id}` : ''}
                        {mod.version ? ` · ${mod.version}` : ''}
                      </small>
                      <small className="workshop-mod-reason">
                        {mod.reason}
                        {mod.requires.length > 0
                          ? ` · 需要 ${mod.requires.slice(0, 4).join('、')}${mod.requires.length > 4 ? ' 等' : ''}`
                          : ''}
                        {mod.requiredBy.length > 0
                          ? ` · 被 ${mod.requiredBy.slice(0, 3).join('、')}${mod.requiredBy.length > 3 ? ' 等' : ''} 需要`
                          : ''}
                      </small>
                      {mod.missing.length > 0 && (
                        <small className="workshop-mod-warning">
                          缺少：{mod.missing.join('、')}
                        </small>
                      )}
                    </div>
                    <span className="workshop-mod-size">{formatBytes(mod.size)}</span>
                  </label>
                ))
              )}
            </div>

            <div className="workshop-export">
              <div className="workshop-export-switches">
                <label>
                  <Switch checked={includeConfigs} onChange={setIncludeConfigs} />
                  配置目录
                </label>
                <label>
                  <Switch checked={includeKubejs} onChange={setIncludeKubejs} />
                  KubeJS / scripts
                </label>
                <label>
                  <Switch checked={includePacks} onChange={setIncludePacks} />
                  资源包 / 光影 / 数据包
                </label>
              </div>
              <span>只导出勾选的模组，不改动当前实例。</span>
            </div>

            {(exporting || progress.total > 0) && (
              <div className="workshop-progress">
                <div>
                  <span>正在写入 .mrpack</span>
                  <span>
                    {progress.done} / {progress.total || '—'} · {formatBytes(progress.bytes)}
                  </span>
                </div>
                <ProgressBar percent={percent} size="sm" />
              </div>
            )}
            {exportResult && (
              <div className="workshop-result">
                <CheckCircle2 size={13} />
                <span>{exportResult}</span>
              </div>
            )}
            {error && report && (
              <div className="workshop-error is-compact">
                <AlertTriangle size={13} />
                <span>{error}</span>
              </div>
            )}
          </div>
        ) : null}
      </div>

      <div className={`workshop-pane workshop-pane--studio ${tab === 'kubejs' ? 'is-active' : ''}`}>
        <KubeJsWorkbench
          key={instance.id}
          instance={instance}
          active={tab === 'kubejs'}
          onDirtyChange={handleKubeDirty}
          onBusyChange={handleKubeBusy}
          onFileCountChange={handleKubeFileCount}
        />
      </div>
    </Modal>
  )
}
