import { RemoteIcon } from '../components/RemoteIcon'
import { useEffect, useRef, useState } from 'react'
import {
  ChevronRight,
  Download,
  ExternalLink,
  FolderOpen,
  KeyRound,
  Power,
  PowerOff,
  Search,
  Trash2,
  Upload
} from 'lucide-react'
import type {
  ContentProvider,
  InstanceSummary,
  InstalledModView,
  ManualModDownload,
  ModProjectView,
  ModVersionView
} from '@shared/types'
import { useLauncher } from '../store'
import { cleanError, formatCount, loaderLabel } from '../lib/format'
import { Badge, Modal, Segmented, Spinner } from './ui'
import { ModVersionModal } from './ModVersionModal'
import type { ModVersionActionOptions, ModVersionTarget } from './ModVersionModal'
import {
  MERGED_PAGE_SIZE,
  searchDualSource,
  searchProviderLabel,
  type DualSearchSourceError
} from '../lib/mergedSearch'

type ContentSearchProvider = ContentProvider | 'all'

export function ModsModal({
  open,
  instance,
  onClose,
  onGoSettings
}: {
  open: boolean
  instance: InstanceSummary | null
  onClose: () => void
  onGoSettings: () => void
}) {
  const toast = useLauncher((state) => state.toast)
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
  const searchSeq = useRef(0)
  const [installed, setInstalled] = useState<InstalledModView[]>([])
  const [installing, setInstalling] = useState<string | null>(null)
  const [versionProject, setVersionProject] = useState<ModProjectView | null>(null)
  const [manual, setManual] = useState<ManualModDownload[]>([])
  const [busyFile, setBusyFile] = useState<string | null>(null)

  const instanceId = instance?.id ?? null

  const refreshInstalled = async () => {
    if (!instanceId) return
    try {
      setInstalled(await window.ccl.mods.list(instanceId))
    } catch {
      setInstalled([])
    }
  }

  const runSearch = async (
    nextProvider: ContentSearchProvider = provider,
    nextQuery = query,
    append = false
  ) => {
    if (!instanceId) return
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
    const nextOffset = append ? offset : 0
    try {
      if (nextProvider === 'all') {
        const result = await searchDualSource(
          nextOffset,
          append ? hits : [],
          (source, sourceOffset) =>
            window.ccl.mods.search(source, nextQuery, instanceId, sourceOffset)
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
        const result = await window.ccl.mods.search(
          nextProvider,
          nextQuery,
          instanceId,
          nextOffset
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
            .search(alternative, nextQuery, instanceId, 0)
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
    if (!open || !instanceId) return
    setQuery('')
    setManual([])
    setHits([])
    setTotal(0)
    setHasMore(false)
    setSourceTotals(null)
    setSourceErrors([])
    setAltTotal(null)
    setOffset(0)
    setError('')
    void refreshInstalled()
    void runSearch(provider, '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, instanceId])

  const changeProvider = (next: ContentSearchProvider) => {
    if (next === provider) return
    setProvider(next)
    setError('')
    setManual([])
    setHits([])
    setTotal(0)
    setHasMore(false)
    setSourceTotals(null)
    setSourceErrors([])
    setAltTotal(null)
    setOffset(0)
    void runSearch(next, query)
  }

  if (!instance) return null

  const installVersion = async (
    version: ModVersionView,
    target: ModVersionTarget,
    options: ModVersionActionOptions
  ) => {
    setInstalling(version.id)
    setManual([])
    try {
      const result = await window.ccl.mods.install({
        instanceId: instance.id,
        provider: target.provider,
        projectId: target.projectId,
        title: target.title,
        versionId: version.id,
        includeDependencies: options.includeDependencies
      })
      await refreshInstalled()
      if (result.installed.length > 0) {
        toast('success', '模组已安装', result.installed.map((item) => item.file).join('、'))
      }
      if (result.manual.length > 0) {
        setManual(result.manual)
      } else if (result.installed.length === 0 && result.skipped.length > 0) {
        toast('info', '模组已存在', result.skipped.join('、'))
      }
      setVersionProject(null)
    } catch (err) {
      toast('error', '无法安装模组', cleanError(err))
    } finally {
      setInstalling(null)
    }
  }

  const toggle = async (mod: InstalledModView) => {
    setBusyFile(mod.file)
    try {
      setInstalled(await window.ccl.mods.toggle(instance.id, mod.file, !mod.enabled))
    } catch (err) {
      toast('error', '无法切换模组状态', cleanError(err))
    } finally {
      setBusyFile(null)
    }
  }

  const remove = async (mod: InstalledModView) => {
    setBusyFile(mod.file)
    try {
      setInstalled(await window.ccl.mods.remove(instance.id, mod.file))
      toast('success', '模组已移除', mod.file)
    } catch (err) {
      toast('error', '无法移除模组', cleanError(err))
    } finally {
      setBusyFile(null)
    }
  }

  const importFiles = async () => {
    try {
      const result = await window.ccl.mods.importFiles(instance.id)
      if (!result) return
      setInstalled(result)
      toast('success', '模组文件已导入')
    } catch (err) {
      toast('error', '无法导入模组', cleanError(err))
    }
  }

  const openFolder = () => {
    void window.ccl.mods.openFolder(instance.id).catch((err) => {
      toast('error', '无法打开模组目录', cleanError(err))
    })
  }

  const keyMissing = error.includes('API key')

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="模组管理"
        subtitle={`${instance.name} · Minecraft ${instance.gameVersion} · ${loaderLabel(instance.loader) ?? '原版'}`}
        icon={<Download size={18} />}
        size="lg"
        footer={
          <div className="mods-footer">
            <span>{installed.length} 个模组</span>
            <div>
              <button type="button" className="button button--soft button--sm" onClick={openFolder}>
                <FolderOpen size={12} />
                打开目录
              </button>
              <button type="button" className="button button--soft button--sm" onClick={() => void importFiles()}>
                <Upload size={12} />
                导入本地 jar
              </button>
            </div>
          </div>
        }
      >
      <div className="mods-modal">
        <section className="mods-installed">
          <div className="mods-section-head">
            <span>已安装</span>
            <Badge tone={installed.length ? 'neutral' : 'warning'}>{installed.length}</Badge>
          </div>
          {installed.length === 0 ? (
            <p className="mods-empty">这个实例还没有模组。</p>
          ) : (
            <div className="mods-installed-list">
              {installed.map((mod) => (
                <div key={mod.file} className={`mods-installed-row ${mod.enabled ? '' : 'is-disabled'}`}>
                  <span className="mods-file" title={mod.file}>
                    {mod.file}
                  </span>
                  <span className="mods-size">{Math.round(mod.size / 1024)} KB</span>
                  <button
                    type="button"
                    className="icon-button"
                    title={mod.enabled ? '禁用' : '启用'}
                    disabled={busyFile === mod.file}
                    onClick={() => void toggle(mod)}
                  >
                    {mod.enabled ? <Power size={13} /> : <PowerOff size={13} />}
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    title="移除"
                    disabled={busyFile === mod.file}
                    onClick={() => void remove(mod)}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="mods-browse">
          <div className="mods-section-head">
            <span>查找模组</span>
            <Segmented
              value={provider}
              onChange={(next) => changeProvider(next)}
              options={[
                { value: 'all', label: '全部来源' },
                { value: 'modrinth', label: 'Modrinth' },
                { value: 'curseforge', label: 'CurseForge' }
              ]}
            />
          </div>
          <form
            className="mods-search"
            onSubmit={(event) => {
              event.preventDefault()
              void runSearch()
            }}
          >
            <div className="text-input">
              <input
                value={query}
                placeholder={
                  provider === 'all'
                    ? '搜索模组，支持中文、拼音或简写'
                    : `搜索 ${searchProviderLabel(provider)} 模组，支持中文、拼音或简写`
                }
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <button type="submit" className="button button--primary button--sm" disabled={loading}>
              {loading ? <Spinner size={13} /> : <Search size={13} />}
              搜索
            </button>
          </form>

          {error && (
            <div className="mods-error">
              <span>{error}</span>
              {keyMissing && (
                <button type="button" className="button button--soft button--sm" onClick={onGoSettings}>
                  <KeyRound size={12} />
                  填写 API key
                </button>
              )}
            </div>
          )}

          {!error && provider === 'all' && sourceErrors.length > 0 && (
            <div className="modcatalog-source-note">
              {sourceErrors
                .map(
                  (item) =>
                    `${searchProviderLabel(item.provider)}：${item.message}`
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

          {manual.length > 0 && (
            <div className="mods-manual">
              <strong>需要手动下载</strong>
              {manual.map((item) => (
                <div key={item.url} className="mods-manual-row">
                  <span>{item.title}</span>
                  <button
                    type="button"
                    className="button button--soft button--xs"
                    onClick={() => void window.ccl.app.openExternal(item.url)}
                  >
                    <ExternalLink size={11} />
                    打开页面
                  </button>
                </div>
              ))}
              <button type="button" className="button button--ghost button--sm" onClick={() => void importFiles()}>
                <Upload size={12} />
                下载后导入本地 jar
              </button>
            </div>
          )}

          <div className="mods-results">
            {hits.map((project) => (
              <article
                key={`${project.provider}:${project.projectId}`}
                className="mods-result"
              >
                <span className="mods-result-icon">
                  <RemoteIcon url={project.iconUrl} fallback={<Download size={18} />} />
                </span>
                <div className="mods-result-copy">
                  <div className="mods-result-head">
                    <strong title={project.title}>
                    {project.localizedName ?? project.title}
                  </strong>
                    <span>by {project.author}</span>
                  </div>
                  <p>{project.description || '没有简介'}</p>
                  <div className="mods-result-meta">
                    <span>{formatCount(project.downloads)} 次下载</span>
                    <span>{searchProviderLabel(project.provider)}</span>
                    {project.categories.slice(0, 3).map((category) => (
                      <span key={category}>{category}</span>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  className="button button--soft button--sm"
                  disabled={installing !== null}
                  onClick={() => setVersionProject(project)}
                >
                  <Download size={12} />
                  选择版本
                </button>
              </article>
            ))}
            {!loading && !error && hits.length === 0 && (
              <p className="mods-empty">没有找到匹配的模组。</p>
            )}
          </div>
          {!loading && !error && hits.length > 0 && hasMore && (
            <div className="load-more-row">
              <button
                type="button"
                className="button button--soft button--sm"
                disabled={loadingMore}
                onClick={() => void runSearch(provider, query, true)}
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
        </section>
      </div>
      </Modal>

      <ModVersionModal
        open={versionProject !== null}
        project={versionProject}
        mode="install"
        targetGameVersion={instance.gameVersion}
        targetLoader={instance.loader}
        busyVersionId={installing}
        onClose={() => setVersionProject(null)}
        onInstall={(version, target, options) => void installVersion(version, target, options)}
      />
    </>
  )
}
