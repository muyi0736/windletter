import { useEffect, useRef, useState } from 'react'
import type {
  ContentChangelogView,
  ContentKind,
  ContentLedgerEntryView,
  ContentLedgerView,
  ContentProvider,
  ContentUpdateProgress,
  InstanceSummary,
  ModProjectView,
  ModVersionView,
  PreviewableContentKind
} from '@shared/types'
import {
  CheckSquare,
  ChevronRight,
  Download,
  ExternalLink,
  Eye,
  FileArchive,
  FileText,
  Package,
  Palette,
  RefreshCw,
  Search,
  Sparkles,
  Square,
  Undo2
} from 'lucide-react'
import { useLauncher } from '../store'
import {
  cleanError,
  formatBytes,
  formatCount,
  formatDate,
  relativeTime
} from '../lib/format'
import { Badge, EmptyState, Modal, ProgressBar, Segmented, Spinner } from './ui'
import { RemoteIcon } from './RemoteIcon'
import { ModVersionModal } from './ModVersionModal'
import type { ModVersionActionOptions, ModVersionTarget } from './ModVersionModal'
import { ContentPackPreviewModal } from './ContentPackPreviewModal'
import { ContentUpdateSummaryModal } from './ContentUpdateSummaryModal'
import {
  MERGED_PAGE_SIZE,
  searchDualSource,
  searchProviderLabel,
  type DualSearchSourceError
} from '../lib/mergedSearch'

type ContentTab = 'mod' | 'datapack' | 'resourcepack' | 'shader'
type ContentSearchProvider = ContentProvider | 'all'

const TAB_KIND: Record<ContentTab, ContentKind> = {
  mod: 'mod',
  datapack: 'datapack',
  resourcepack: 'resourcepack',
  shader: 'shader'
}
const TAB_LABEL: Record<ContentTab, string> = {
  mod: '模组',
  datapack: '数据包',
  resourcepack: '资源包',
  shader: '光影包'
}

function ledgerEntryKey(entry: Pick<ContentLedgerEntryView, 'kind' | 'file'>): string {
  return `${entry.kind}:${entry.file}`
}

export function InstanceContentModal({
  open,
  instance,
  initialTab,
  onClose
}: {
  open: boolean
  instance: InstanceSummary | null
  initialTab?: 'mod' | 'datapack' | 'resourcepack' | 'shader' | null
  onClose: () => void
}) {
  const toast = useLauncher((state) => state.toast)
  const [tab, setTab] = useState<ContentTab>('mod')
  const [provider, setProvider] = useState<ContentSearchProvider>('all')
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<ModProjectView[]>([])
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [sourceTotals, setSourceTotals] = useState<Record<
    ContentProvider,
    number
  > | null>(null)
  const [sourceErrors, setSourceErrors] = useState<DualSearchSourceError[]>([])
  const [altTotal, setAltTotal] = useState<{
    provider: ContentProvider
    total: number
  } | null>(null)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [versionProject, setVersionProject] = useState<ModProjectView | null>(null)
  const [previewTarget, setPreviewTarget] = useState<{
    kind: PreviewableContentKind
    file: string
    name: string
  } | null>(null)
  const [busyVersion, setBusyVersion] = useState<string | null>(null)
  const [view, setView] = useState<'installed' | 'browse'>('installed')
  const [ledger, setLedger] = useState<ContentLedgerView | null>(null)
  const [ledgerLoading, setLedgerLoading] = useState(false)
  const [ledgerChecking, setLedgerChecking] = useState(false)
  const [ledgerError, setLedgerError] = useState('')
  const [ledgerFilter, setLedgerFilter] = useState<'all' | 'updates'>('all')
  const [selectedUpdates, setSelectedUpdates] = useState<Set<string>>(new Set())
  const [updating, setUpdating] = useState(false)
  const [rollingBack, setRollingBack] = useState(false)
  const [changelogOpenKey, setChangelogOpenKey] = useState<string | null>(null)
  const [changelogLoading, setChangelogLoading] = useState(false)
  const [changelogCache, setChangelogCache] = useState<
    Record<string, { view: ContentChangelogView | null; error: string | null }>
  >({})
  const [updateProgress, setUpdateProgress] = useState<ContentUpdateProgress | null>(null)
  const [progressSpeed, setProgressSpeed] = useState(0)
  const [updateSummaryOpen, setUpdateSummaryOpen] = useState(false)
  const searchSeq = useRef(0)
  const ledgerSeq = useRef(0)
  const changelogSeq = useRef(0)
  const progressSample = useRef<{ phase: string; bytesDone: number; time: number } | null>(
    null
  )

  const kind = TAB_KIND[tab]

  const refreshLedger = async (force = false) => {
    if (!instance) return
    const sequence = ++ledgerSeq.current
    setLedgerError('')
    setLedgerLoading(true)
    setLedgerChecking(false)
    try {
      const scanned = await window.ccl.ledger.scan(instance.id, force)
      if (sequence !== ledgerSeq.current) return
      setLedger(scanned)
      setLedgerLoading(false)
      setLedgerChecking(true)
      try {
        const checked = await window.ccl.ledger.check(instance.id, force)
        if (sequence !== ledgerSeq.current) return
        setLedger(checked)
      } catch (error) {
        if (sequence === ledgerSeq.current) setLedgerError(cleanError(error))
      } finally {
        if (sequence === ledgerSeq.current) setLedgerChecking(false)
      }
    } catch (error) {
      if (sequence === ledgerSeq.current) {
        setLedgerError(cleanError(error))
        setLedgerLoading(false)
      }
    }
  }

  const forceCheckLedger = async () => {
    if (!instance) return
    const sequence = ++ledgerSeq.current
    setLedgerError('')
    setLedgerChecking(true)
    try {
      const checked = await window.ccl.ledger.check(instance.id, true)
      if (sequence !== ledgerSeq.current) return
      setLedger(checked)
    } catch (error) {
      if (sequence === ledgerSeq.current) setLedgerError(cleanError(error))
    } finally {
      if (sequence === ledgerSeq.current) setLedgerChecking(false)
    }
  }

  const search = async (
    append = false,
    next: { provider?: ContentSearchProvider; query?: string; tab?: ContentTab } = {}
  ) => {
    if (!instance) return
    const nextProvider = next.provider ?? provider
    const nextQuery = next.query ?? query
    const nextTab = next.tab ?? tab
    const nextKind = TAB_KIND[nextTab]
    const nextOffset = append ? offset : 0
    const sequence = ++searchSeq.current
    if (append) {
      setLoadingMore(true)
    } else {
      setLoading(true)
      setLoadingMore(false)
      setAltTotal(null)
      setHasMore(false)
      setSourceTotals(null)
      setSourceErrors([])
    }
    setError('')
    const gameVersion = nextTab === 'mod' ? instance.gameVersion : ''
    const loader = nextTab === 'mod' ? instance.loader : ''
    try {
      if (nextProvider === 'all') {
        const result = await searchDualSource(
          nextOffset,
          append ? hits : [],
          (source, sourceOffset) =>
            window.ccl.mods.searchCatalog(
              source,
              nextQuery,
              gameVersion,
              loader,
              sourceOffset,
              nextKind
            )
        )
        if (sequence !== searchSeq.current) return
        setHits(result.hits)
        setTotal(result.totalHits)
        setHasMore(result.hasMore)
        setSourceTotals(result.sourceTotals)
        setSourceErrors(result.errors)
        setOffset(nextOffset + MERGED_PAGE_SIZE)
        if (result.errors.length === 2) {
          setError(
            result.errors
              .map((item) => `${searchProviderLabel(item.provider)}：${item.message}`)
              .join('；')
          )
        }
      } else {
        const result = await window.ccl.mods.searchCatalog(
          nextProvider,
          nextQuery,
          gameVersion,
          loader,
          nextOffset,
          nextKind
        )
        if (sequence !== searchSeq.current) return
        setHits((previous) => {
          if (!append) return result.hits
          const seen = new Set(previous.map((project) => `${project.provider}:${project.slug}`))
          return [
            ...previous,
            ...result.hits.filter((project) => {
              const key = `${project.provider}:${project.slug}`
              if (seen.has(key)) return false
              seen.add(key)
              return true
            })
          ]
        })
        setTotal(result.totalHits)
        setHasMore(
          (result.nextOffset ?? nextOffset + result.hits.length) < result.totalHits
        )
        setSourceTotals({
          modrinth: nextProvider === 'modrinth' ? result.totalHits : 0,
          curseforge: nextProvider === 'curseforge' ? result.totalHits : 0
        })
        setSourceErrors([])
        setOffset(result.nextOffset ?? nextOffset + result.hits.length)
        if (!append) {
          const alternative: ContentProvider =
            nextProvider === 'modrinth' ? 'curseforge' : 'modrinth'
          void window.ccl.mods
            .searchCatalog(
              alternative,
              nextQuery,
              gameVersion,
              loader,
              0,
              nextKind
            )
            .then((other) => {
              if (sequence !== searchSeq.current) return
              setAltTotal({ provider: alternative, total: other.totalHits })
            })
            .catch(() => {
              if (sequence === searchSeq.current) setAltTotal(null)
            })
        }
      }
    } catch (err) {
      if (sequence !== searchSeq.current) return
      if (!append) {
        setHits([])
        setTotal(0)
        setHasMore(false)
        setOffset(0)
      }
      setSourceTotals(null)
      setSourceErrors([])
      setError(cleanError(err))
    } finally {
      if (sequence === searchSeq.current) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }

  useEffect(() => {
    if (!open || !initialTab) return
    setTab(initialTab)
  }, [open, initialTab])

  useEffect(() => {
    if (!open || !instance) {
      setHits([])
      setTotal(0)
      setHasMore(false)
      setSourceTotals(null)
      setSourceErrors([])
      setAltTotal(null)
      setOffset(0)
      setError('')
      return
    }
    if (instance.loader === 'vanilla' && tab === 'mod') {
      setTab('resourcepack')
      return
    }
    if (view !== 'browse') return
    setQuery('')
    setHits([])
    setTotal(0)
    setHasMore(false)
    setSourceTotals(null)
    setSourceErrors([])
    setAltTotal(null)
    setOffset(0)
    void search(false, { provider, tab, query: '' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, instance?.id, tab, view])

  useEffect(() => {
    if (!open || !instance) {
      ledgerSeq.current += 1
      setLedger(null)
      setLedgerError('')
      setLedgerLoading(false)
      setLedgerChecking(false)
      setLedgerFilter('all')
      setSelectedUpdates(new Set())
      setChangelogOpenKey(null)
      setChangelogCache({})
      setUpdateProgress(null)
      setProgressSpeed(0)
      progressSample.current = null
      return
    }
    if (view !== 'installed') return
    if (ledger && ledger.instanceId === instance.id) return
    void refreshLedger(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, instance?.id, view])

  useEffect(() => {
    if (!open || !instance) return
    const off = window.ccl.ledger.onProgress((progress) => {
      if (progress.instanceId !== instance.id) return
      const now = performance.now()
      const last = progressSample.current
      if (progress.bytesTotal > 0 && progress.bytesDone > 0) {
        if (!last || last.phase !== progress.phase || progress.bytesDone < last.bytesDone) {
          progressSample.current = {
            phase: progress.phase,
            bytesDone: progress.bytesDone,
            time: now
          }
          setProgressSpeed(0)
        } else if (now - last.time >= 120) {
          const instant = ((progress.bytesDone - last.bytesDone) * 1000) / (now - last.time)
          setProgressSpeed((previous) =>
            previous > 0 ? previous * 0.35 + instant * 0.65 : instant
          )
          progressSample.current = {
            phase: progress.phase,
            bytesDone: progress.bytesDone,
            time: now
          }
        }
      } else {
        progressSample.current = null
        setProgressSpeed(0)
      }
      setUpdateProgress(progress)
    })
    return off
  }, [open, instance?.id])

  useEffect(() => {
    const valid = new Set(
      (ledger?.entries ?? [])
        .filter((entry) => entry.updateAvailable)
        .map((entry) => ledgerEntryKey(entry))
    )
    setSelectedUpdates((previous) => {
      const next = new Set([...previous].filter((key) => valid.has(key)))
      if (
        next.size === previous.size &&
        [...next].every((key) => previous.has(key))
      ) {
        return previous
      }
      return next
    })
  }, [ledger])

  const changeTab = (next: ContentTab) => {
    setTab(next)
  }

  const changeProvider = (next: ContentSearchProvider) => {
    if (next === provider) return
    setProvider(next)
    setHits([])
    setTotal(0)
    setHasMore(false)
    setSourceTotals(null)
    setSourceErrors([])
    setAltTotal(null)
    setOffset(0)
    setError('')
    void search(false, { provider: next, tab, query })
  }

  const ledgerSummaryFor = (target: ContentKind) =>
    ledger?.summary.find((item) => item.kind === target) ?? {
      kind: target,
      total: 0,
      identified: 0,
      updates: 0
    }
  const summary = ledgerSummaryFor(kind)
  const kindEntries = ledger?.entries.filter((entry) => entry.kind === kind) ?? []
  const visibleEntries =
    ledgerFilter === 'updates'
      ? kindEntries.filter((entry) => entry.updateAvailable)
      : kindEntries
  const kindUpdateEntries = kindEntries.filter((entry) => entry.updateAvailable)
  const selectedEntries = (ledger?.entries ?? []).filter(
    (entry) => entry.updateAvailable && selectedUpdates.has(ledgerEntryKey(entry))
  )
  const selectedBytes = selectedEntries.reduce(
    (sum, entry) => sum + (entry.latestFileSize ?? 0),
    0
  )
  const allKindSelected =
    kindUpdateEntries.length > 0 &&
    kindUpdateEntries.every((entry) => selectedUpdates.has(ledgerEntryKey(entry)))
  const progressActive = Boolean(updateProgress && (updating || rollingBack))

  const toggleSelection = (entry: ContentLedgerEntryView) => {
    if (!entry.updateAvailable || updating || rollingBack) return
    const key = ledgerEntryKey(entry)
    setSelectedUpdates((previous) => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleSelectKind = () => {
    if (updating || rollingBack) return
    setSelectedUpdates((previous) => {
      const next = new Set(previous)
      for (const entry of kindUpdateEntries) {
        const key = ledgerEntryKey(entry)
        if (allKindSelected) next.delete(key)
        else next.add(key)
      }
      return next
    })
  }

  const runUpdates = async () => {
    if (!instance || updating || rollingBack || selectedEntries.length === 0) return
    setUpdating(true)
    setLedgerError('')
    setProgressSpeed(0)
    progressSample.current = null
    setUpdateProgress({
      instanceId: instance.id,
      phase: 'prepare',
      stage: '正在准备更新…',
      percent: 0,
      filesDone: 0,
      filesTotal: 0,
      file: null,
      bytesDone: 0,
      bytesTotal: 0
    })
    try {
      const result = await window.ccl.ledger.update({
        instanceId: instance.id,
        files: selectedEntries.map((entry) => ({
          kind: entry.kind,
          file: entry.file
        }))
      })
      setLedger(result.ledger)
      setSelectedUpdates(new Set())
      setChangelogOpenKey(null)
      if (result.ok) {
        toast(
          'success',
          '内容更新完成',
          `已更新 ${result.updated.length} 项；更新前已保存可运行快照和文件备份`
        )
        if (result.manual.length > 0) {
          toast(
            'info',
            '有前置需要手动处理',
            result.manual.map((item) => item.title).join('、')
          )
        }
      } else {
        toast(
          'error',
          result.rolledBack ? '更新失败，已自动回滚' : '更新失败',
          result.error ?? '未知错误'
        )
      }
    } catch (error) {
      toast('error', '更新失败', cleanError(error))
    } finally {
      setUpdating(false)
      setUpdateProgress(null)
      setProgressSpeed(0)
      progressSample.current = null
    }
  }

  const rollbackUpdates = async () => {
    if (!instance || updating || rollingBack) return
    setRollingBack(true)
    setLedgerError('')
    setProgressSpeed(0)
    progressSample.current = null
    setUpdateProgress({
      instanceId: instance.id,
      phase: 'rollback',
      stage: '正在准备回滚…',
      percent: 0,
      filesDone: 0,
      filesTotal: 0,
      file: null,
      bytesDone: 0,
      bytesTotal: 0
    })
    try {
      const result = await window.ccl.ledger.rollback(instance.id)
      setLedger(result.ledger)
      setSelectedUpdates(new Set())
      setChangelogOpenKey(null)
      if (result.ok) {
        toast('success', '已回滚上次更新', '已恢复原版本和更新前的已知可运行快照')
      } else {
        toast('error', '回滚失败', result.error ?? '未知错误')
      }
    } catch (error) {
      toast('error', '回滚失败', cleanError(error))
    } finally {
      setRollingBack(false)
      setUpdateProgress(null)
      setProgressSpeed(0)
      progressSample.current = null
    }
  }

  const toggleChangelog = async (entry: ContentLedgerEntryView) => {
    if (!entry.provider || !entry.projectId || !entry.latestVersionId) return
    const key = `${entry.provider}:${entry.projectId}:${entry.latestVersionId}`
    if (changelogOpenKey === key) {
      setChangelogOpenKey(null)
      return
    }
    setChangelogOpenKey(key)
    if (changelogCache[key] && !changelogCache[key].error) return
    const sequence = ++changelogSeq.current
    setChangelogLoading(true)
    try {
      const view = await window.ccl.ledger.changelog(
        entry.provider,
        entry.projectId,
        entry.latestVersionId
      )
      if (sequence !== changelogSeq.current) return
      setChangelogCache((previous) => ({
        ...previous,
        [key]: { view, error: null }
      }))
    } catch (error) {
      if (sequence !== changelogSeq.current) return
      setChangelogCache((previous) => ({
        ...previous,
        [key]: { view: null, error: cleanError(error) }
      }))
    } finally {
      if (sequence === changelogSeq.current) setChangelogLoading(false)
    }
  }

  const install = async (
    version: ModVersionView,
    target: ModVersionTarget,
    options: ModVersionActionOptions
  ) => {
    if (!instance) return
    setBusyVersion(version.id)
    try {
      const result = await window.ccl.mods.install({
        instanceId: instance.id,
        provider: target.provider,
        projectId: target.projectId,
        title: target.title,
        versionId: version.id,
        kind,
        includeDependencies: options.includeDependencies
      })
      const count = result.installed.length + result.skipped.length
      toast(
        'success',
        `${TAB_LABEL[tab]}已安装`,
        count > 0 ? `${count} 个文件已放入实例的 ${kind === 'mod' ? 'mods' : kind === 'shader' ? 'shaderpacks' : kind === 'datapack' ? 'datapacks' : 'resourcepacks'}` : '没有新增文件'
      )
      setVersionProject(null)
      if (result.manual.length > 0) {
        toast(
          'info',
          '有文件需要手动处理',
          result.manual.map((item) => item.title).join('、')
        )
      }
    } catch (err) {
      toast('error', '无法安装到实例', cleanError(err))
    } finally {
      setBusyVersion(null)
    }
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="实例内容"
        subtitle={
          instance
            ? `${instance.name} · Minecraft ${instance.gameVersion}`
            : '数据包、资源包和光影包'
        }
        icon={<Package size={18} />}
        size="xl"
        closeOnEscape={previewTarget === null && !updateSummaryOpen}
      >
        <div className="instance-content-toolbar">
          <Segmented
            size="sm"
            value={tab}
            options={[
              ...(instance?.loader !== 'vanilla'
                ? [
                    {
                      value: 'mod',
                      label: (
                        <span className="instance-tab-label">
                          模组
                          {ledgerSummaryFor('mod').updates > 0 && (
                            <em>{ledgerSummaryFor('mod').updates}</em>
                          )}
                        </span>
                      )
                    }
                  ]
                : []),
              {
                value: 'datapack',
                label: (
                  <span className="instance-tab-label">
                    数据包
                    {ledgerSummaryFor('datapack').updates > 0 && (
                      <em>{ledgerSummaryFor('datapack').updates}</em>
                    )}
                  </span>
                )
              },
              {
                value: 'resourcepack',
                label: (
                  <span className="instance-tab-label">
                    资源包
                    {ledgerSummaryFor('resourcepack').updates > 0 && (
                      <em>{ledgerSummaryFor('resourcepack').updates}</em>
                    )}
                  </span>
                )
              },
              {
                value: 'shader',
                label: (
                  <span className="instance-tab-label">
                    光影包
                    {ledgerSummaryFor('shader').updates > 0 && (
                      <em>{ledgerSummaryFor('shader').updates}</em>
                    )}
                  </span>
                )
              }
            ]}
            onChange={(value) => changeTab(value as ContentTab)}
          />
          <Segmented
            size="sm"
            value={view}
            options={[
              { value: 'installed', label: '已安装' },
              { value: 'browse', label: '搜索安装' }
            ]}
            onChange={(value) => setView(value as 'installed' | 'browse')}
          />
        </div>

        {view === 'browse' ? (
          <>
            <div className="instance-content-toolbar">
              <Segmented
                size="sm"
                value={provider}
                options={[
                  { value: 'all', label: '全部来源' },
                  { value: 'modrinth', label: 'Modrinth' },
                  {
                    value: 'curseforge',
                    label:
                      tab === 'resourcepack'
                        ? 'CurseForge 纹理包'
                        : tab === 'shader'
                          ? 'CurseForge 光影'
                          : tab === 'datapack'
                            ? 'CurseForge 数据包'
                            : 'CurseForge'
                  }
                ]}
                onChange={(value) => changeProvider(value as ContentSearchProvider)}
              />
              <div className="text-input instance-content-search">
                <Search size={14} />
                <input
                  value={query}
                  placeholder={
                    tab === 'mod'
                      ? '搜索模组名称，支持中文、拼音或简写'
                      : `搜索${TAB_LABEL[tab]}名称`
                  }
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void search()
                  }}
                />
              </div>
              <button
                type="button"
                className="button button--primary button--sm"
                onClick={() => void search()}
              >
                {loading ? <Spinner size={13} /> : <Search size={13} />}
                搜索
              </button>
            </div>

            {error && (
              <div className="mods-error">
                <span>{error}</span>
              </div>
            )}

            {!error && provider === 'all' && sourceErrors.length > 0 && (
              <div className="modcatalog-source-note">
                {sourceErrors
                  .map(
                    (item) => `${searchProviderLabel(item.provider)}：${item.message}`
                  )
                  .join('；')}
                ，已显示另一来源结果
              </div>
            )}

            {!loading &&
              !error &&
              provider !== 'all' &&
              altTotal &&
              altTotal.total > total && (
                <div className="modcatalog-alt-source">
                  <span>
                    {searchProviderLabel(provider)} 当前 {formatCount(total)} 个；{' '}
                    {searchProviderLabel(altTotal.provider)} 同一条件有{' '}
                    {formatCount(altTotal.total)} 个
                  </span>
                  <button
                    type="button"
                    className="button button--soft button--xs"
                    onClick={() => changeProvider(altTotal.provider)}
                  >
                    查看 {searchProviderLabel(altTotal.provider)}
                  </button>
                </div>
              )}

            {!loading && !error && hits.length === 0 && (
              <EmptyState
                icon={<Package size={24} />}
                title={`没有找到${TAB_LABEL[tab]}`}
                description="换个关键词，或切换数据源再试"
              />
            )}

            <div className="modcatalog-results instance-content-results">
              {hits.map((project) => (
                <article
                  key={`${project.provider}:${project.projectId}`}
                  className="modcatalog-row"
                >
                  <span className="modpack-row-icon">
                    <RemoteIcon url={project.iconUrl} fallback={<Package size={20} />} />
                  </span>
                  <div className="modpack-row-body">
                    <div className="modpack-row-head">
                      <strong title={project.title}>
                        {project.localizedName ?? project.title}
                      </strong>
                      {project.author && (
                        <span className="modpack-row-author">by {project.author}</span>
                      )}
                    </div>
                    <p className="modpack-row-desc">{project.description}</p>
                    <div className="modpack-row-meta">
                      <span>{formatCount(project.downloads)} 次下载</span>
                      <span>
                        {project.provider === 'curseforge' ? 'CurseForge' : 'Modrinth'}
                      </span>
                      <Badge tone="neutral">{TAB_LABEL[tab]}</Badge>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="button button--primary button--sm"
                    disabled={busyVersion !== null}
                    onClick={() => setVersionProject(project)}
                  >
                    <Download size={13} />
                    安装
                  </button>
                </article>
              ))}
              {!loading && !error && hits.length > 0 && hasMore && (
                <div className="load-more-row">
                  <button
                    type="button"
                    className="button button--soft button--sm"
                    disabled={loadingMore}
                    onClick={() => void search(true)}
                  >
                    {loadingMore ? <Spinner size={12} /> : <ChevronRight size={12} />}
                    加载更多结果
                  </button>
                  <span>
                    {provider === 'all'
                      ? '继续合并加载两个来源'
                      : `还有 ${formatCount(Math.max(0, total - hits.length))} 个结果`}
                  </span>
                </div>
              )}
            </div>
            {!error && total > 0 && (
              <p className="mods-total">
                {provider === 'all' ? (
                  <>
                    共约 {formatCount(total)} 个来源结果
                    {sourceTotals
                      ? `（Modrinth ${formatCount(sourceTotals.modrinth)} · CurseForge ${formatCount(sourceTotals.curseforge)}）`
                      : ''}
                    ，已显示 {formatCount(hits.length)} 个（按结果量加权，重复项已合并）
                  </>
                ) : (
                  <>共 {formatCount(total)} 个结果，已显示 {formatCount(hits.length)} 个</>
                )}
              </p>
            )}
          </>
        ) : (
          <>
            <div className="instance-ledger-toolbar">
              <Segmented
                size="sm"
                value={ledgerFilter}
                options={[
                  { value: 'all', label: `全部 ${summary.total}` },
                  { value: 'updates', label: `可更新 ${summary.updates}` }
                ]}
                onChange={(value) => setLedgerFilter(value as 'all' | 'updates')}
              />
              <span className="instance-ledger-status">
                {updating ? (
                  <>
                    <Spinner size={12} />
                    正在备份并更新…
                  </>
                ) : rollingBack ? (
                  <>
                    <Spinner size={12} />
                    正在回滚…
                  </>
                ) : ledgerChecking ? (
                  <>
                    <Spinner size={12} />
                    正在检查更新…
                  </>
                ) : ledger ? (
                  <>
                    已识别 {summary.identified}/{summary.total}
                    {ledger.checkedAt
                      ? ` · 检查于 ${relativeTime(ledger.checkedAt)}`
                      : ' · 尚未检查更新'}
                  </>
                ) : ledgerLoading ? (
                  <>
                    <Spinner size={12} />
                    正在整理本地内容…
                  </>
                ) : (
                  '等待整理'
                )}
              </span>
              <div className="instance-ledger-actions">
                {ledger?.lastUpdate && (
                  <button
                    type="button"
                    className="button button--soft button--sm"
                    disabled={updating || rollingBack || ledgerLoading || ledgerChecking}
                    onClick={() => setUpdateSummaryOpen(true)}
                  >
                    <Sparkles size={12} />
                    更新解读
                  </button>
                )}
                {ledger?.lastUpdate?.canRollback && (
                  <button
                    type="button"
                    className="button button--ghost button--sm"
                    disabled={updating || rollingBack || ledgerLoading || ledgerChecking}
                    onClick={() => void rollbackUpdates()}
                  >
                    <Undo2 size={12} />
                    回滚上次更新
                  </button>
                )}
                <button
                  type="button"
                  className="button button--soft button--sm"
                  disabled={updating || rollingBack || ledgerLoading || ledgerChecking}
                  onClick={() => void refreshLedger(false)}
                >
                  <RefreshCw size={12} className={ledgerLoading ? 'spin' : ''} />
                  刷新
                </button>
                <button
                  type="button"
                  className="button button--soft button--sm"
                  disabled={updating || rollingBack || ledgerLoading || ledgerChecking || !ledger}
                  onClick={() => void forceCheckLedger()}
                >
                  <Search size={12} />
                  检查更新
                </button>
              </div>
            </div>

            {ledgerError && (
              <div className="mods-error">
                <span>{ledgerError}</span>
              </div>
            )}

            {ledger && ledger.errors.length > 0 && (
              <div className="modcatalog-source-note">
                {ledger.errors.join('；')}
              </div>
            )}

            {ledgerLoading && !ledger ? (
              <div className="downloads-loading">
                <Spinner size={16} />
                正在读取本地文件并计算 SHA1 与 CurseForge 指纹…
              </div>
            ) : (
              <div className="instance-ledger-list">
                {visibleEntries.map((entry) => {
                  const key = ledgerEntryKey(entry)
                  const changelogKey = `${entry.provider}:${entry.projectId}:${entry.latestVersionId}`
                  const changelog = changelogCache[changelogKey]
                  const changelogOpen = changelogOpenKey === changelogKey
                  const selected = selectedUpdates.has(key)
                  const externalUrl =
                    changelog?.view?.url ??
                    (entry.provider === 'curseforge' &&
                    entry.slug &&
                    entry.latestVersionId
                      ? `https://www.curseforge.com/minecraft/mc-mods/${entry.slug}/files/${entry.latestVersionId}`
                      : null)
                  return (
                    <div key={key} className="ledger-entry">
                      <article
                        className={`ledger-row ${entry.updateAvailable ? 'is-update' : ''}`}
                      >
                        {entry.updateAvailable ? (
                          <button
                            type="button"
                            className={`ledger-select ${selected ? 'is-selected' : ''}`}
                            title={selected ? '取消选择' : '选择更新'}
                            disabled={updating || rollingBack}
                            onClick={() => toggleSelection(entry)}
                          >
                            {selected ? <CheckSquare size={15} /> : <Square size={15} />}
                          </button>
                        ) : (
                          <span className="ledger-select-spacer" />
                        )}
                        <span className="ledger-icon">
                          {entry.kind === 'mod' ? (
                            <Package size={15} />
                          ) : entry.kind === 'datapack' ? (
                            <FileArchive size={15} />
                          ) : entry.kind === 'resourcepack' ? (
                            <Palette size={15} />
                          ) : (
                            <Sparkles size={15} />
                          )}
                        </span>
                        <div className="ledger-body">
                          <div className="ledger-head">
                            <strong>{entry.projectTitle ?? entry.name}</strong>
                            <Badge tone={entry.provider ? 'accent' : 'neutral'}>
                              {entry.provider
                                ? searchProviderLabel(entry.provider)
                                : '本地/未知'}
                            </Badge>
                            {entry.updateAvailable && <Badge tone="success">可更新</Badge>}
                            {entry.kind === 'mod' && !entry.enabled && (
                              <Badge tone="warning">已禁用</Badge>
                            )}
                          </div>
                          <span className="ledger-file" title={entry.file}>
                            {entry.name} · {formatBytes(entry.size)}
                          </span>
                          <div className="ledger-version">
                            {entry.provider ? (
                              entry.updateAvailable ? (
                                <>
                                  <span className="is-current">
                                    {entry.versionNumber ?? '当前版本'}
                                  </span>
                                  <ChevronRight size={11} />
                                  <span className="is-latest">
                                    {entry.latestVersionNumber ?? '新版本'}
                                  </span>
                                </>
                              ) : entry.checkState === 'current' ? (
                                <span className="is-ok">
                                  已是最新
                                  {entry.versionNumber &&
                                  entry.versionNumber !== entry.name
                                    ? ` · ${entry.versionNumber}`
                                    : ''}
                                </span>
                              ) : entry.checkState === 'error' ? (
                                <span className="is-error">
                                  {entry.checkMessage ?? '检查失败'}
                                </span>
                              ) : (
                                <span className="is-muted">
                                  {entry.versionNumber ?? '已识别'} · 待检查
                                </span>
                              )
                            ) : (
                              <span className="is-muted">
                                未识别来源，保留为本地文件
                              </span>
                            )}
                          </div>
                          {entry.updateAvailable && (
                            <div className="ledger-extra">
                              <button
                                type="button"
                                className="doctor-link ledger-changelog-toggle"
                                disabled={updating || rollingBack}
                                onClick={() => void toggleChangelog(entry)}
                              >
                                <FileText size={11} />
                                {changelogOpen ? '收起更新日志' : '更新日志'}
                              </button>
                              {entry.latestFileSize != null && (
                                <span className="ledger-size">
                                  新文件 {formatBytes(entry.latestFileSize)}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                        {entry.kind !== 'mod' && (
                          <button
                            type="button"
                            className="ledger-preview-btn"
                            title={`只读预览${TAB_LABEL[tab]}`}
                            onClick={() =>
                              setPreviewTarget({
                                kind: entry.kind as PreviewableContentKind,
                                file: entry.name,
                                name: entry.projectTitle ?? entry.name
                              })
                            }
                          >
                            <Eye size={12} />
                            预览
                          </button>
                        )}
                      </article>
                      {entry.updateAvailable && changelogOpen && (
                        <div className="ledger-changelog">
                          {changelogLoading && !changelog ? (
                            <div className="ledger-changelog-loading">
                              <Spinner size={12} />
                              正在读取更新日志…
                            </div>
                          ) : changelog?.error ? (
                            <span className="is-error">{changelog.error}</span>
                          ) : changelog?.view ? (
                            <>
                              <div className="ledger-changelog-head">
                                <strong>{changelog.view.versionNumber}</strong>
                                <span>
                                  {changelog.view.fileSize != null
                                    ? formatBytes(changelog.view.fileSize)
                                    : ''}
                                  {changelog.view.datePublished
                                    ? ` · ${formatDate(changelog.view.datePublished)}`
                                    : ''}
                                </span>
                                {externalUrl && (
                                  <button
                                    type="button"
                                    className="doctor-link"
                                    onClick={() =>
                                      void window.ccl.app.openExternal(externalUrl)
                                    }
                                  >
                                    <ExternalLink size={11} />
                                    打开页面
                                  </button>
                                )}
                              </div>
                              <pre>
                                {changelog.view.changelog || '作者没有提供更新日志。'}
                              </pre>
                            </>
                          ) : (
                            <span className="is-muted">暂无更新日志</span>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
                {!ledgerLoading && visibleEntries.length === 0 && (
                  <EmptyState
                    icon={<Package size={24} />}
                    title={
                      ledgerFilter === 'updates'
                        ? '没有发现可更新内容'
                        : `这个实例还没有${TAB_LABEL[tab]}`
                    }
                    description={
                      ledgerFilter === 'updates'
                        ? '当前分类下所有已识别内容都是最新版本。'
                        : '到「搜索安装」里挑一些内容，或在实例目录里放入文件后刷新。'
                    }
                  />
                )}
              </div>
            )}

            {!ledgerLoading &&
              ledger &&
              (progressActive ||
                kindUpdateEntries.length > 0 ||
                selectedEntries.length > 0) && (
                <div
                  className={`instance-ledger-updatebar ${progressActive ? 'is-busy' : ''}`}
                >
                  {progressActive && updateProgress ? (
                    <div className="instance-update-progress">
                      <div className="instance-update-progress-head">
                        <span>
                          <Spinner size={12} />
                          {updateProgress.stage || '正在处理…'}
                        </span>
                        <strong>{Math.round(updateProgress.percent)}%</strong>
                      </div>
                      <ProgressBar
                        percent={Math.max(0, Math.min(100, updateProgress.percent))}
                        size="sm"
                      />
                      <div className="instance-update-progress-meta">
                        {updateProgress.phase === 'backup' &&
                          updateProgress.filesTotal > 0 && (
                            <span>
                              {Math.min(
                                updateProgress.filesDone,
                                updateProgress.filesTotal
                              )}
                              /{updateProgress.filesTotal} 个文件
                            </span>
                          )}
                        {updateProgress.bytesTotal > 0 && (
                          <span>
                            {formatBytes(updateProgress.bytesDone)} /{' '}
                            {formatBytes(updateProgress.bytesTotal)}
                          </span>
                        )}
                        {progressSpeed >= 1024 && (
                          <span>{formatBytes(progressSpeed)}/s</span>
                        )}
                        {updateProgress.phase === 'rollback' && (
                          <span>失败会自动恢复，不会留下半成品</span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div>
                      <strong>
                        已选 {selectedEntries.length} 项
                        {selectedBytes > 0 ? ` · 约 ${formatBytes(selectedBytes)}` : ''}
                      </strong>
                      <span>
                        更新前会自动创建已知可运行快照并备份原文件；失败自动回滚。
                      </span>
                    </div>
                  )}
                  {!progressActive && (
                    <div className="instance-ledger-updatebar-actions">
                      {kindUpdateEntries.length > 0 && (
                        <button
                          type="button"
                          className="button button--ghost button--sm"
                          disabled={updating || rollingBack}
                          onClick={toggleSelectKind}
                        >
                          {allKindSelected ? '取消全选本类' : '全选本类'}
                        </button>
                      )}
                      <button
                        type="button"
                        className="button button--primary button--sm"
                        disabled={
                          selectedEntries.length === 0 ||
                          updating ||
                          rollingBack
                        }
                        onClick={() => void runUpdates()}
                      >
                        {updating ? <Spinner size={12} /> : <Download size={12} />}
                        更新选中
                        {selectedEntries.length > 0 ? ` (${selectedEntries.length})` : ''}
                      </button>
                    </div>
                  )}
                </div>
              )}
          </>
        )}
      </Modal>

      <ModVersionModal
        open={versionProject !== null}
        project={versionProject}
        mode="install"
        kind={kind}
        targetGameVersion={tab === 'mod' ? instance?.gameVersion ?? '' : ''}
        targetLoader={instance?.loader ?? ''}
        busyVersionId={busyVersion}
        onClose={() => setVersionProject(null)}
        onInstall={(version, target, options) => void install(version, target, options)}
      />

      <ContentPackPreviewModal
        open={previewTarget !== null}
        instance={instance}
        kind={previewTarget?.kind ?? null}
        file={previewTarget?.file ?? null}
        name={previewTarget?.name ?? null}
        onClose={() => setPreviewTarget(null)}
      />

      <ContentUpdateSummaryModal
        open={updateSummaryOpen}
        instance={instance}
        update={ledger?.lastUpdate ?? null}
        onClose={() => setUpdateSummaryOpen(false)}
      />
    </>
  )
}
