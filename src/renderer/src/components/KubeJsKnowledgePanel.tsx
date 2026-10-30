import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Box,
  Database,
  Hash,
  RefreshCw,
  Search,
  SquareStack,
  Tag as TagIcon,
  X
} from 'lucide-react'
import type {
  InstanceSummary,
  KubeJsIndexCounts,
  KubeJsIndexItem,
  KubeJsIndexKind,
  KubeJsIndexProgress,
  KubeJsIndexRecipe,
  KubeJsIndexStatus,
  KubeJsIndexTag
} from '@shared/types'
import { cleanError, formatBytes } from '../lib/format'
import { ProgressBar, Spinner } from './ui'

function formatCount(value: number): string {
  return value.toLocaleString('zh-CN')
}

function elapsedLabel(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return ''
  if (ms < 1000) return `${Math.max(1, Math.round(ms))} ms`
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`
}

function initial(value: string): string {
  const clean = value.trim()
  return clean ? clean[0].toUpperCase() : '?'
}

function modLabel(mods: Map<string, string>, id: string): string {
  return mods.get(id) ?? id
}

const iconCache = new Map<string, string | null>()

function IndexTile({ text, icon }: { text: string; icon?: string | null }) {
  return (
    <span className="kjs-index-tile">
      {icon ? <img src={icon} alt="" draggable={false} /> : initial(text)}
    </span>
  )
}

export function KubeJsKnowledgePanel({
  instance,
  active,
  onInsertId,
  onInsert
}: {
  instance: InstanceSummary | null
  active: boolean
  onInsertId: (id: string) => void
  onInsert: (code: string) => void
}) {
  const [status, setStatus] = useState<KubeJsIndexStatus | null>(null)
  const [progress, setProgress] = useState<KubeJsIndexProgress | null>(null)
  const [loading, setLoading] = useState(false)
  const [building, setBuilding] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [error, setError] = useState('')
  const [kind, setKind] = useState<KubeJsIndexKind>('item')
  const [query, setQuery] = useState('')
  const [modId, setModId] = useState('')
  const [items, setItems] = useState<(KubeJsIndexItem | KubeJsIndexRecipe | KubeJsIndexTag)[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [searching, setSearching] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [expandedRecipe, setExpandedRecipe] = useState<string | null>(null)
  const [searchError, setSearchError] = useState('')
  const [icons, setIcons] = useState<Record<string, string | null>>({})
  const searchSeq = useRef(0)
  const iconSeq = useRef(0)

  const mods = useMemo(() => {
    const map = new Map<string, string>()
    for (const mod of status?.mods ?? []) map.set(mod.id, mod.name)
    return map
  }, [status?.mods])

  const counts: KubeJsIndexCounts = status?.counts ?? {
    items: 0,
    recipes: 0,
    tags: 0,
    mods: 0,
    jars: 0
  }

  const loadStatus = async (showLoading = true) => {
    if (!instance) return
    if (showLoading) setLoading(true)
    setError('')
    try {
      const next = await window.ccl.workshop.kubejsIndexStatus(instance.id)
      setStatus(next)
      if (next.state === 'ready') {
        setBuilding(false)
        setError('')
      }
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      if (showLoading) setLoading(false)
    }
  }

  useEffect(() => {
    if (!active || !instance) return
    setStatus(null)
    setProgress(null)
    setItems([])
    setTotal(0)
    setPage(1)
    setSearchError('')
    void loadStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, instance?.id])

  useEffect(() => {
    if (!instance) return
    return window.ccl.workshop.onKubejsIndexProgress((next) => {
      if (next.instanceId !== instance.id) return
      setProgress(next)
      setBuilding(true)
    })
  }, [instance?.id])

  useEffect(() => {
    if (!instance || items.length === 0) return
    const ids = new Set<string>()
    if (kind === 'item') {
      for (const item of items as KubeJsIndexItem[]) ids.add(item.id)
    } else if (kind === 'recipe') {
      for (const recipe of items as KubeJsIndexRecipe[]) {
        if (recipe.output) ids.add(recipe.output.id)
      }
    }
    const cacheKey = (id: string) => `${instance.id}|${id}`
    const missing = [...ids].filter((id) => !iconCache.has(cacheKey(id)))
    const apply = () => {
      const next: Record<string, string | null> = {}
      for (const id of ids) next[id] = iconCache.get(cacheKey(id)) ?? null
      setIcons(next)
    }
    if (missing.length === 0) {
      apply()
      return
    }
    const request = ++iconSeq.current
    void window.ccl.workshop
      .kubejsItemIcons(instance.id, missing)
      .then((loaded) => {
        if (request !== iconSeq.current) return
        for (const [id, url] of Object.entries(loaded)) {
          iconCache.set(cacheKey(id), url)
        }
        apply()
      })
      .catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, kind, instance?.id])

  const runSearch = async (nextPage: number, append: boolean) => {
    if (!instance || status?.state !== 'ready') return
    const request = ++searchSeq.current
    if (append) setLoadingMore(true)
    else setSearching(true)
    setSearchError('')
    try {
      const result = await window.ccl.workshop.kubejsIndexSearch({
        instanceId: instance.id,
        kind,
        query,
        modId,
        page: nextPage,
        pageSize: 30
      })
      if (request !== searchSeq.current) return
      setItems((previous) => (append ? [...previous, ...result.items] : result.items))
      setTotal(result.total)
      setPage(nextPage)
      if (!append) setExpandedRecipe(null)
    } catch (cause) {
      if (request === searchSeq.current) setSearchError(cleanError(cause))
    } finally {
      if (request === searchSeq.current) {
        setSearching(false)
        setLoadingMore(false)
      }
    }
  }

  useEffect(() => {
    if (!active || status?.state !== 'ready') return
    const timer = window.setTimeout(() => void runSearch(1, false), 220)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, status, kind, query, modId])

  const build = async () => {
    if (!instance || building) return
    setBuilding(true)
    setError('')
    setProgress(null)
    try {
      const next = await window.ccl.workshop.kubejsIndexBuild(instance.id)
      setStatus(next)
      if (next.state === 'ready') {
        iconCache.clear()
        setIcons({})
        setItems([])
        setTotal(0)
        setPage(1)
      } else if (next.error) {
        setError(next.error)
      }
    } catch (cause) {
      setError(cleanError(cause))
      await loadStatus(false)
    } finally {
      setBuilding(false)
    }
  }

  const cancel = async () => {
    if (!instance || cancelling) return
    setCancelling(true)
    try {
      await window.ccl.workshop.kubejsIndexCancel()
      await loadStatus(false)
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setCancelling(false)
    }
  }

  const changeKind = (next: KubeJsIndexKind) => {
    if (next === kind) return
    setKind(next)
    setItems([])
    setTotal(0)
    setExpandedRecipe(null)
    setSearchError('')
  }

  const itemName = (item: KubeJsIndexItem): string =>
    item.nameZh || item.nameEn || item.name || item.id

  if (!instance) return null

  if (loading && !status) {
    return (
      <div className="kjs-index-loading">
        <Spinner size={15} />
        正在读取索引状态…
      </div>
    )
  }

  const showBuildCard = building || !status || status.state !== 'ready'

  if (showBuildCard) {
    const live = progress
    const buildingNow = building || status?.state === 'building'
    const done = live?.done ?? 0
    const totalUnits = live?.total ?? 0
    const percent = totalUnits > 0 ? (done / totalUnits) * 100 : 0
    const liveItems = live?.items ?? status?.counts.items ?? 0
    const liveRecipes = live?.recipes ?? status?.counts.recipes ?? 0
    const liveTags = live?.tags ?? status?.counts.tags ?? 0
    const liveBytes = live?.bytes ?? 0
    const liveElapsed = live?.elapsedMs ?? status?.elapsedMs ?? null
    return (
      <div className="kjs-index-build">
        <div className="kjs-index-build-icon">
          <Database size={20} />
        </div>
        <strong>{buildingNow ? '正在建立实例索引' : '建立实例索引'}</strong>
        <p>
          {buildingNow
            ? '只读扫描模组 jar、原版配方和 kubejs/data。索引期间实例不会被修改。'
            : '扫描当前实例的模组 jar、原版客户端数据、kubejs/data 和启动脚本，生成物品、配方、标签索引。只读，不改实例。'}
        </p>
        {buildingNow ? (
          <div className="kjs-index-progress">
            <div className="kjs-index-progress-head">
              <span>{live?.current ?? '准备中…'}</span>
              <span>
                {done} / {totalUnits || '—'}
              </span>
            </div>
            <ProgressBar percent={percent} size="sm" />
            <div className="kjs-index-progress-meta">
              <span>{formatCount(liveItems)} 物品</span>
              <span>{formatCount(liveRecipes)} 配方</span>
              <span>{formatCount(liveTags)} 标签</span>
              <span>{formatBytes(liveBytes)}</span>
              <span>{elapsedLabel(liveElapsed)}</span>
            </div>
            <button
              type="button"
              className="button button--ghost button--sm"
              onClick={() => void cancel()}
              disabled={cancelling}
            >
              {cancelling ? <Spinner size={12} /> : <X size={12} />}
              取消索引
            </button>
          </div>
        ) : (
          <div className="kjs-index-build-actions">
            <button
              type="button"
              className="button button--primary button--sm"
              onClick={() => void build()}
            >
              <Database size={12} />
              建立索引
            </button>
            <small>首次约 10–20 秒；之后复用缓存。只读扫描，不写入游戏目录。</small>
          </div>
        )}
        {error && (
          <div className="workshop-error is-compact">
            <AlertTriangle size={12} />
            <span>{error}</span>
          </div>
        )}
      </div>
    )
  }

  const currentStatus = status
  if (!currentStatus || currentStatus.state !== 'ready') return null
  const remain = Math.max(0, total - items.length)

  return (
    <div className="kjs-index">
      <div className="kjs-index-head">
        <div>
          <strong>实例索引</strong>
          <span>
            {formatCount(counts.recipes)} 配方 · {formatCount(counts.items)} 物品 ·{' '}
            {formatCount(counts.tags)} 标签 · {elapsedLabel(currentStatus.elapsedMs)}
            {currentStatus.cached ? ' · 缓存' : ''}
          </span>
        </div>
        <button
          type="button"
          className="kjs-icon-btn"
          title="重建索引"
          onClick={() => void build()}
          disabled={building}
        >
          {building ? <Spinner size={11} /> : <RefreshCw size={11} />}
        </button>
      </div>

      <div className="kjs-index-search">
        <Search size={11} />
        <input
          value={query}
          placeholder="搜索物品 / 配方 / 标签 ID 或名称"
          onChange={(event) => setQuery(event.target.value)}
        />
        {query && (
          <button type="button" className="kjs-icon-btn" onClick={() => setQuery('')}>
            <X size={10} />
          </button>
        )}
      </div>
      <div className="kjs-index-filter">
        <select
          value={modId}
          onChange={(event) => setModId(event.target.value)}
          title="按模组过滤"
        >
          <option value="">全部模组</option>
          {currentStatus.mods.map((mod) => (
            <option key={mod.id} value={mod.id}>
              {mod.name} ({mod.id})
            </option>
          ))}
        </select>
        <span>
          {currentStatus.counts.jars} 个 jar · {currentStatus.counts.mods} 个命名空间
        </span>
      </div>

      <div className="kjs-index-kinds">
        <button
          type="button"
          className={kind === 'item' ? 'is-active' : ''}
          onClick={() => changeKind('item')}
        >
          <Box size={11} />
          物品 <em>{formatCount(counts.items)}</em>
        </button>
        <button
          type="button"
          className={kind === 'recipe' ? 'is-active' : ''}
          onClick={() => changeKind('recipe')}
        >
          <SquareStack size={11} />
          配方 <em>{formatCount(counts.recipes)}</em>
        </button>
        <button
          type="button"
          className={kind === 'tag' ? 'is-active' : ''}
          onClick={() => changeKind('tag')}
        >
          <TagIcon size={11} />
          标签 <em>{formatCount(counts.tags)}</em>
        </button>
      </div>

      <div className="kjs-index-results">
        {!query.trim() ? (
          <div className="kjs-index-empty">
            <Search size={18} />
            <strong>搜索实例内容</strong>
            <span>输入物品 / 配方 / 标签的名称或 ID，例如「漏斗」「hopper」「forge:ingots」。</span>
          </div>
        ) : searching ? (
          <div className="kjs-index-empty">
            <Spinner size={14} />
            正在搜索…
          </div>
        ) : searchError ? (
          <div className="workshop-error is-compact">
            <AlertTriangle size={12} />
            <span>{searchError}</span>
          </div>
        ) : items.length === 0 ? (
          <div className="kjs-index-empty">
            <Search size={18} />
            <strong>没有匹配结果</strong>
            <span>试试物品 ID、中文名或配方类型；索引只包含静态数据。</span>
          </div>
        ) : kind === 'item' ? (
          (items as KubeJsIndexItem[]).map((item) => (
            <div key={item.id} className="kjs-index-row">
              <IndexTile text={itemName(item)} icon={icons[item.id]} />
              <div className="kjs-index-row-copy">
                <strong title={itemName(item)}>{itemName(item)}</strong>
                <span>
                  {item.id} · {modLabel(mods, item.modId)}
                  {item.block ? ' · 方块' : ''}
                </span>
              </div>
              <button
                type="button"
                className="kjs-index-insert"
                title="插入带引号的 ID 到光标"
                onClick={() => onInsertId(item.id)}
              >
                插入
              </button>
            </div>
          ))
        ) : kind === 'recipe' ? (
          (items as KubeJsIndexRecipe[]).map((recipe) => {
            const expanded = expandedRecipe === recipe.id
            const output = recipe.output
            const outputNamespace = output?.id.split(':')[0] ?? recipe.modId
            const canRemoveMod = outputNamespace !== 'minecraft' && outputNamespace !== 'kubejs'
            return (
              <div key={recipe.id} className={`kjs-index-recipe ${expanded ? 'is-expanded' : ''}`}>
                <button
                  type="button"
                  className="kjs-index-row"
                  onClick={() => setExpandedRecipe(expanded ? null : recipe.id)}
                  aria-expanded={expanded}
                >
                  <IndexTile text={output?.name ?? recipe.id} icon={output ? icons[output.id] : null} />
                  <div className="kjs-index-row-copy">
                    <strong title={output?.name ?? recipe.id}>
                      {output ? `${output.name}${output.count > 1 ? ` × ${output.count}` : ''}` : recipe.id}
                    </strong>
                    <span>
                      {recipe.id} · {recipe.type}
                      {output ? ` · ${output.id}` : ''}
                    </span>
                  </div>
                  <Hash size={11} className="kjs-index-chevron" />
                </button>
                {expanded && (
                  <div className="kjs-index-detail">
                    {recipe.inputs.length > 0 && (
                      <div className="kjs-index-inputs">
                        {recipe.inputs.map((input) => (
                          <span key={`${input.kind}-${input.id}`} title={input.id}>
                            {input.kind === 'tag' ? '#' : ''}
                            {input.name}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="kjs-index-detail-actions">
                      <button
                        type="button"
                        className="kjs-index-code-btn is-danger"
                        onClick={() => onInsert(`event.remove({ id: '${recipe.id}' })\n`)}
                      >
                        删除此配方
                      </button>
                      {output && (
                        <button
                          type="button"
                          className="kjs-index-code-btn"
                          onClick={() => onInsert(`event.remove({ output: '${output.id}' })\n`)}
                        >
                          按产出删除
                        </button>
                      )}
                      <button
                        type="button"
                        className="kjs-index-code-btn"
                        onClick={() =>
                          onInsert(
                            `event.remove({ mod: '${output?.id.split(':')[0] ?? recipe.modId}' })\n`
                          )
                        }
                      >
                        按模组删除
                      </button>
                    </div>
                    <small>代码会插入到当前光标，仍需自己确认并保存。</small>
                  </div>
                )}
              </div>
            )
          })
        ) : (
          (items as KubeJsIndexTag[]).map((tag) => (
            <div key={tag.id} className="kjs-index-row">
              <IndexTile text={tag.id} />
              <div className="kjs-index-row-copy">
                <strong title={tag.id}>{tag.id}</strong>
                <span>
                  {tag.type} · {tag.count} 个成员 · {modLabel(mods, tag.modId)}
                </span>
              </div>
              <button
                type="button"
                className="kjs-index-insert"
                title="插入标签 ID"
                onClick={() => onInsertId(tag.id)}
              >
                插入
              </button>
            </div>
          ))
        )}
      </div>

      {query.trim() && (
      <div className="kjs-index-foot">
        <span>
          显示 {formatCount(items.length)} / {formatCount(total)}
        </span>
        {remain > 0 && (
          <button
            type="button"
            className="kjs-index-more"
            onClick={() => void runSearch(page + 1, true)}
            disabled={loadingMore || searching}
          >
            {loadingMore ? <Spinner size={11} /> : null}
            加载更多
          </button>
        )}
      </div>
      )}
      {error && (
        <div className="workshop-error is-compact">
          <AlertTriangle size={12} />
          <span>{error}</span>
        </div>
      )}
      <p className="kjs-index-note">
        只读静态索引：来自模组 jar、客户端 jar、kubejs/data 和 startup_scripts；脚本运行时新增的配方不会出现在这里。
      </p>
    </div>
  )
}
