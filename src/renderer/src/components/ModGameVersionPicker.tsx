import { useEffect, useMemo, useRef, useState } from 'react'
import { Boxes, Check, ChevronDown, Search } from 'lucide-react'
import type { InstanceSummary, VersionSummary } from '@shared/types'
import { formatDate, loaderLabel } from '../lib/format'

export interface ModGameVersionSelection {
  gameVersion: string
  loader?: string
  instanceId: string | null
}

const MAX_VERSION_ROWS = 60

export function ModGameVersionPicker({
  value,
  instanceId,
  instances,
  versions,
  onSelect
}: {
  value: string
  instanceId: string | null
  instances: InstanceSummary[]
  versions: VersionSummary[]
  onSelect: (selection: ModGameVersionSelection) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const selectedInstance = instanceId
    ? instances.find((instance) => instance.id === instanceId) ?? null
    : null
  const instanceVersions = useMemo(
    () => new Set(instances.map((instance) => instance.gameVersion)),
    [instances]
  )
  const keyword = query.trim().toLowerCase()

  const filteredInstances = useMemo(() => {
    if (!keyword) return instances
    return instances.filter((instance) =>
      [instance.name, instance.gameVersion, instance.loader]
        .join(' ')
        .toLowerCase()
        .includes(keyword)
    )
  }, [instances, keyword])

  const filteredVersions = useMemo(() => {
    const ranked = (list: VersionSummary[]) => [
      ...list.filter((version) => version.type === 'release'),
      ...list.filter((version) => version.type !== 'release')
    ]
    if (!keyword) return ranked(versions)
    const exact = versions.filter((version) => version.id.toLowerCase() === keyword)
    const partial = versions.filter(
      (version) =>
        version.id.toLowerCase() !== keyword && version.id.toLowerCase().includes(keyword)
    )
    return [...exact, ...ranked(partial)]
  }, [versions, keyword])

  useEffect(() => {
    if (!open) return
    setQuery('')
    const timer = setTimeout(() => {
      searchRef.current?.focus()
      listRef.current
        ?.querySelector<HTMLElement>('[data-selected="true"]')
        ?.scrollIntoView({ block: 'nearest' })
    }, 20)
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  const chooseInstance = (instance: InstanceSummary) => {
    onSelect({
      gameVersion: instance.gameVersion,
      loader: instance.loader !== 'vanilla' ? instance.loader : undefined,
      instanceId: instance.id
    })
    setOpen(false)
  }

  const chooseVersion = (version: VersionSummary) => {
    onSelect({ gameVersion: version.id, instanceId: null })
    setOpen(false)
  }

  const pickFirst = () => {
    const exact = keyword
      ? versions.find((version) => version.id.toLowerCase() === keyword)
      : null
    if (exact) {
      chooseVersion(exact)
      return
    }
    if (filteredInstances[0]) {
      chooseInstance(filteredInstances[0])
      return
    }
    if (filteredVersions[0]) chooseVersion(filteredVersions[0])
  }

  const visibleVersions = filteredVersions.slice(0, MAX_VERSION_ROWS)

  return (
    <div className="mod-game-picker" ref={rootRef}>
      <button
        type="button"
        className={`text-input mod-game-trigger ${open ? 'is-open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((previous) => !previous)}
      >
        <span className="mod-game-trigger-copy">
          <strong>{selectedInstance ? selectedInstance.name : value || '选择游戏版本'}</strong>
          <small>
            {selectedInstance
              ? `${value} · ${loaderLabel(selectedInstance.loader) ?? '原版'} · 跟随实例`
              : value
                ? `Minecraft ${value}`
                : '从实例带入或选择版本'}
          </small>
        </span>
        <ChevronDown size={14} className={open ? 'is-open' : ''} />
      </button>

      {open && (
        <div className="mod-game-popover" role="listbox" aria-label="选择游戏版本">
          <div className="mod-game-search">
            <Search size={13} />
            <input
              ref={searchRef}
              value={query}
              placeholder="搜索版本号或实例"
              spellCheck={false}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.stopPropagation()
                  setOpen(false)
                } else if (event.key === 'Enter') {
                  event.preventDefault()
                  pickFirst()
                }
              }}
            />
          </div>

          <div className="mod-game-list" ref={listRef}>
            {filteredInstances.length > 0 && (
              <>
                <span className="mod-game-section">跟随实例 · 同时带入加载器</span>
                {filteredInstances.map((instance) => (
                  <button
                    key={instance.id}
                    type="button"
                    className={`mod-game-option ${
                      instance.id === instanceId ? 'is-selected' : ''
                    }`}
                    data-selected={instance.id === instanceId}
                    onClick={() => chooseInstance(instance)}
                  >
                    <span className="mod-game-option-icon">
                      <Boxes size={13} />
                    </span>
                    <span className="mod-game-option-copy">
                      <strong>{instance.name}</strong>
                      <small>
                        MC {instance.gameVersion} ·{' '}
                        {loaderLabel(instance.loader) ?? '原版'} · {instance.modCount} 个模组
                      </small>
                    </span>
                    {instance.id === instanceId && <Check size={13} />}
                  </button>
                ))}
              </>
            )}

            <span className="mod-game-section">游戏版本</span>
            {visibleVersions.map((version) => {
              const selected = !instanceId && version.id === value
              return (
                <button
                  key={version.id}
                  type="button"
                  className={`mod-game-option ${selected ? 'is-selected' : ''}`}
                  data-selected={selected}
                  onClick={() => chooseVersion(version)}
                >
                  <span
                    className={`mod-game-option-version ${
                      version.type === 'release' ? 'is-release' : 'is-other'
                    }`}
                  >
                    {version.type === 'release' ? 'R' : 'S'}
                  </span>
                  <span className="mod-game-option-copy">
                    <strong>{version.id}</strong>
                    <small>
                      {version.type === 'release' ? '正式版' : '快照 / 远古'}
                      {instanceVersions.has(version.id) ? ' · 已有实例' : ''} ·{' '}
                      {formatDate(version.releaseTime)}
                    </small>
                  </span>
                  {selected && <Check size={13} />}
                </button>
              )
            })}

            {filteredVersions.length === 0 && filteredInstances.length === 0 && (
              <p className="mod-game-empty">没有匹配的版本或实例。</p>
            )}
            {filteredVersions.length > visibleVersions.length && (
              <p className="mod-game-more">
                还有 {filteredVersions.length - visibleVersions.length} 个版本，继续输入版本号筛选
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
