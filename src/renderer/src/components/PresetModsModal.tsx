import { useEffect, useRef, useState } from 'react'
import type {
  ContentProvider,
  ModProjectView,
  PresetModsPayload
} from '@shared/types'
import {
  Check,
  ChevronRight,
  Package,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2
} from 'lucide-react'
import { useLauncher } from '../store'
import { cleanError, formatCount } from '../lib/format'
import { Badge, EmptyState, Modal, Segmented, Spinner, Switch } from './ui'
import { RemoteIcon } from './RemoteIcon'
import {
  MERGED_PAGE_SIZE,
  searchDualSource,
  searchProviderLabel,
  type DualSearchSourceError
} from '../lib/mergedSearch'

type PresetSearchProvider = ContentProvider | 'all'

function projectKey(provider: ContentProvider, projectId: string): string {
  return `${provider}:${projectId}`
}

export function PresetModsModal({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}) {
  const toast = useLauncher((state) => state.toast)
  const setPresetAutoInstall = useLauncher((state) => state.setPresetAutoInstall)
  const [payload, setPayload] = useState<PresetModsPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [autoBusy, setAutoBusy] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)

  const [provider, setProvider] = useState<PresetSearchProvider>('all')
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<ModProjectView[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [searching, setSearching] = useState(false)
  const [searchingMore, setSearchingMore] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [sourceErrors, setSourceErrors] = useState<DualSearchSourceError[]>([])
  const [adding, setAdding] = useState<string | null>(null)
  const searchSeq = useRef(0)

  const load = async () => {
    setLoading(true)
    setLoadError('')
    try {
      setPayload(await window.ccl.presets.list())
    } catch (error) {
      setLoadError(cleanError(error))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!open) {
      searchSeq.current += 1
      setHits([])
      setTotal(0)
      setOffset(0)
      setHasMore(false)
      setSearchError('')
      setSourceErrors([])
      return
    }
    setQuery('')
    setProvider('all')
    setHits([])
    setTotal(0)
    setSearchError('')
    setSourceErrors([])
    setPayload(null)
    void load()
  }, [open])

  const search = async (append = false) => {
    const sequence = ++searchSeq.current
    const nextOffset = append ? offset : 0
    if (append) setSearchingMore(true)
    else {
      setSearching(true)
      setSearchingMore(false)
      setHasMore(false)
      setSourceErrors([])
    }
    setSearchError('')
    try {
      if (provider === 'all') {
        const result = await searchDualSource(
          nextOffset,
          append ? hits : [],
          (source, sourceOffset) =>
            window.ccl.mods.searchCatalog(
              source,
              query,
              '',
              '',
              sourceOffset,
              'mod'
            )
        )
        if (sequence !== searchSeq.current) return
        setHits(result.hits)
        setTotal(result.totalHits)
        setHasMore(result.hasMore)
        setSourceErrors(result.errors)
        setOffset(nextOffset + MERGED_PAGE_SIZE)
        if (result.errors.length === 2) {
          setSearchError(
            result.errors
              .map((item) => `${searchProviderLabel(item.provider)}：${item.message}`)
              .join('；')
          )
        }
      } else {
        const result = await window.ccl.mods.searchCatalog(
          provider,
          query,
          '',
          '',
          nextOffset,
          'mod'
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
        setOffset(result.nextOffset ?? nextOffset + result.hits.length)
        setSourceErrors([])
      }
    } catch (error) {
      if (sequence !== searchSeq.current) return
      if (!append) {
        setHits([])
        setTotal(0)
        setHasMore(false)
        setOffset(0)
      }
      setSearchError(cleanError(error))
    } finally {
      if (sequence === searchSeq.current) {
        setSearching(false)
        setSearchingMore(false)
      }
    }
  }

  const addPreset = async (project: ModProjectView) => {
    const key = projectKey(project.provider, project.projectId)
    if (adding) return
    setAdding(key)
    try {
      const next = await window.ccl.presets.add({
        provider: project.provider,
        projectId: project.projectId,
        slug: project.slug,
        title: project.title,
        iconUrl: project.iconUrl,
        author: project.author
      })
      setPayload(next)
      toast('success', '已加入预设模组', project.title)
    } catch (error) {
      toast('error', '无法加入预设', cleanError(error))
    } finally {
      setAdding(null)
    }
  }

  const removePreset = async (provider: ContentProvider, projectId: string, title: string) => {
    const key = projectKey(provider, projectId)
    if (removing) return
    setRemoving(key)
    try {
      const next = await window.ccl.presets.remove(provider, projectId)
      setPayload(next)
      toast('info', '已移除预设模组', title)
    } catch (error) {
      toast('error', '无法移除预设', cleanError(error))
    } finally {
      setRemoving(null)
    }
  }

  const toggleAuto = async (enabled: boolean) => {
    if (!payload || autoBusy) return
    setAutoBusy(true)
    const saved = await setPresetAutoInstall(enabled)
    setAutoBusy(false)
    if (saved) setPayload({ ...payload, autoInstall: enabled })
  }

  const changeProvider = (next: PresetSearchProvider) => {
    if (next === provider) return
    setProvider(next)
    setHits([])
    setTotal(0)
    setOffset(0)
    setHasMore(false)
    setSearchError('')
    setSourceErrors([])
  }

  const presetKeys = new Set(
    (payload?.items ?? []).map((item) => projectKey(item.provider, item.projectId))
  )

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="预设模组"
      subtitle="安装整合包后自动核对；缺失时按包内版本与加载器补齐"
      icon={<Sparkles size={18} />}
      size="xl"
      footer={
        <div className="preset-manager-footer">
          <span>
            {payload ? `已预设 ${payload.items.length} 个模组` : '正在读取预设…'}
          </span>
          <button type="button" className="button button--soft button--sm" onClick={onClose}>
            关闭
          </button>
        </div>
      }
    >
      {loading && !payload ? (
        <div className="downloads-loading">
          <Spinner size={16} />
          正在读取预设模组…
        </div>
      ) : loadError && !payload ? (
        <div className="mods-error">
          <span>{loadError}</span>
          <button type="button" className="button button--soft button--xs" onClick={() => void load()}>
            <RefreshCw size={12} />
            重试
          </button>
        </div>
      ) : payload ? (
        <div className="preset-manager">
          <section className="preset-manager-settings">
            <div>
              <strong>自动补齐缺失的预设模组</strong>
              <span>
                {payload.autoInstall
                  ? '安装整合包后直接安装缺失项，不再询问。'
                  : '安装整合包后列出缺失项，由你决定是否安装。'}
              </span>
            </div>
            <Switch
              checked={payload.autoInstall}
              label="自动补齐缺失的预设模组"
              disabled={autoBusy}
              onChange={(value) => void toggleAuto(value)}
            />
          </section>

          <section className="preset-manager-section">
            <div className="preset-section-head">
              <h3>已预设 {payload.items.length} 个</h3>
              <span>会按目标实例的 Minecraft 版本与加载器选择兼容版本；已包含的模组不会重复安装。</span>
            </div>
            {payload.items.length === 0 ? (
              <EmptyState
                icon={<Sparkles size={24} />}
                title="还没有预设模组"
                description="在下方搜索常用模组（例如 钠、机械动力、JEI），安装整合包时会自动核对。"
              />
            ) : (
              <div className="preset-list">
                {payload.items.map((item) => {
                  const key = projectKey(item.provider, item.projectId)
                  return (
                    <article key={key} className="preset-row">
                      <span className="preset-row-icon">
                        <RemoteIcon url={item.iconUrl} fallback={<Package size={18} />} />
                      </span>
                      <div className="preset-row-body">
                        <div className="preset-row-head">
                          <strong title={item.title}>
                            {item.localizedName ?? item.title}
                          </strong>
                          <Badge tone="neutral">
                            {searchProviderLabel(item.provider)}
                          </Badge>
                        </div>
                        <span>
                          {item.author ? `by ${item.author}` : item.slug}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="button button--ghost button--xs"
                        title="从预设中移除"
                        disabled={removing !== null}
                        onClick={() =>
                          void removePreset(item.provider, item.projectId, item.title)
                        }
                      >
                        {removing === key ? <Spinner size={12} /> : <Trash2 size={12} />}
                        移除
                      </button>
                    </article>
                  )
                })}
              </div>
            )}
          </section>

          <section className="preset-manager-section">
            <div className="preset-section-head">
              <h3>添加模组</h3>
              <span>按名称搜索 Modrinth 与 CurseForge；预设保存项目，不锁定版本。</span>
            </div>
            <div className="preset-search-row">
              <Segmented
                size="sm"
                value={provider}
                options={[
                  { value: 'all', label: '全部来源' },
                  { value: 'modrinth', label: 'Modrinth' },
                  { value: 'curseforge', label: 'CurseForge' }
                ]}
                onChange={(value) => changeProvider(value as PresetSearchProvider)}
              />
              <div className="text-input preset-search-input">
                <Search size={14} />
                <input
                  value={query}
                  placeholder="搜索模组，支持中文、拼音或简写，例如 jixiedongli、钠、JEI"
                  spellCheck={false}
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
                {searching ? <Spinner size={13} /> : <Search size={13} />}
                搜索
              </button>
            </div>

            {searchError && <div className="mods-error"><span>{searchError}</span></div>}

            {!searchError && provider === 'all' && sourceErrors.length > 0 && (
              <div className="modcatalog-source-note">
                {sourceErrors
                  .map((item) => `${searchProviderLabel(item.provider)}：${item.message}`)
                  .join('；')}
                ，已显示另一来源结果
              </div>
            )}

            {!searching && !searchError && hits.length === 0 && (
              <p className="preset-search-hint">
                输入关键词后搜索；空关键词会列出热门模组。
              </p>
            )}

            <div className="modcatalog-results preset-results">
              {hits.map((project) => {
                const key = projectKey(project.provider, project.projectId)
                const already = presetKeys.has(key)
                return (
                  <article key={key} className="modcatalog-row">
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
                        <span>{searchProviderLabel(project.provider)}</span>
                      </div>
                    </div>
                    {already ? (
                      <span className="preset-added">
                        <Check size={12} />
                        已预设
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="button button--soft button--sm"
                        disabled={adding !== null}
                        onClick={() => void addPreset(project)}
                      >
                        {adding === key ? <Spinner size={12} /> : <Plus size={13} />}
                        加入预设
                      </button>
                    )}
                  </article>
                )
              })}
              {!searching && hits.length > 0 && hasMore && (
                <div className="load-more-row">
                  <button
                    type="button"
                    className="button button--soft button--sm"
                    disabled={searchingMore}
                    onClick={() => void search(true)}
                  >
                    {searchingMore ? <Spinner size={12} /> : <ChevronRight size={12} />}
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
            {!searchError && total > 0 && (
              <p className="mods-total">
                共约 {formatCount(total)} 个结果，已显示 {formatCount(hits.length)} 个
              </p>
            )}
          </section>
        </div>
      ) : null}
    </Modal>
  )
}
