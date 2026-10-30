import { useEffect, useMemo, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Download,
  FolderOpen,
  Play,
  Trash2
} from 'lucide-react'
import type { InstalledVersion } from '@shared/types'
import { loaderLabel, relativeTime, versionTypeLabel } from '../lib/format'
import { copyText } from '../lib/clipboard'
import { useLauncher } from '../store'
import { BlockIcon } from './visuals'

type SortField = 'name' | 'date'

interface LibraryTableProps {
  versions: InstalledVersion[]
  selectedId: string | null
  view?: 'table' | 'grid'
  onSelect: (id: string) => void
  onLaunch: (id: string) => void
  onOpenFolder: (id: string) => void
  onExport: (id: string) => void
  onDelete: (id: string) => void
}

interface MenuState {
  version: InstalledVersion
  x: number
  y: number
}

function versionUsage(version: InstalledVersion): string {
  const count = version.usedBy?.length ?? 0
  return count > 0 ? `被 ${count} 个实例使用` : ''
}

function versionUsageTitle(version: InstalledVersion): string | undefined {
  return version.usedBy?.length
    ? version.usedBy.map((entry) => entry.name).join('、')
    : undefined
}

export function LibraryTable({
  versions,
  selectedId,
  view = 'table',
  onSelect,
  onLaunch,
  onOpenFolder,
  onExport,
  onDelete
}: LibraryTableProps) {
  const toast = useLauncher((state) => state.toast)
  const [sortBy, setSortBy] = useState<SortField>('date')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [menu, setMenu] = useState<MenuState | null>(null)

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  const changeSort = (field: SortField) => {
    if (field === sortBy) {
      setSortOrder((value) => (value === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(field)
      setSortOrder('desc')
    }
  }

  const sorted = useMemo(() => {
    const copy = [...versions]
    copy.sort((a, b) => {
      let compared = 0
      if (sortBy === 'name') {
        compared = a.id.localeCompare(b.id)
      } else {
        const timeA = a.lastPlayed ?? (a.releaseTime ? Date.parse(a.releaseTime) || 0 : 0)
        const timeB = b.lastPlayed ?? (b.releaseTime ? Date.parse(b.releaseTime) || 0 : 0)
        compared = timeA - timeB
      }
      return sortOrder === 'asc' ? compared : -compared
    })
    return copy
  }, [versions, sortBy, sortOrder])

  const openMenu = (event: React.MouseEvent, version: InstalledVersion) => {
    event.preventDefault()
    event.stopPropagation()
    setMenu({
      version,
      x: Math.max(6, Math.min(event.clientX, window.innerWidth - 196)),
      y: Math.max(6, Math.min(event.clientY, window.innerHeight - 188))
    })
  }

  const copyId = async (version: InstalledVersion) => {
    setMenu(null)
    if (await copyText(version.id)) {
      toast('success', '版本号已复制', version.id)
    } else {
      toast('error', '复制失败')
    }
  }

  const sortIcon = (field: SortField) => {
    if (field !== sortBy) return null
    return sortOrder === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />
  }

  const actions = (version: InstalledVersion) => (
    <>
      <button
        type="button"
        className="button button--soft button--xs"
        onClick={(event) => {
          event.stopPropagation()
          onLaunch(version.id)
        }}
      >
        <Play size={11} fill="currentColor" />
        启动
      </button>
      <button
        type="button"
        className="icon-button"
        title="打开版本文件夹"
        onClick={(event) => {
          event.stopPropagation()
          onOpenFolder(version.id)
        }}
      >
        <FolderOpen size={14} />
      </button>
    </>
  )

  return (
    <>
      {view === 'grid' ? (
        <div className="library-grid">
          {sorted.length === 0 ? (
            <div className="library-table-empty">还没有独立版本</div>
          ) : (
            sorted.map((version) => (
              <article
                key={version.id}
                className={`library-grid-card ${version.id === selectedId ? 'is-selected' : ''}`}
                onClick={() => onSelect(version.id)}
                onContextMenu={(event) => openMenu(event, version)}
              >
                <div className="library-grid-top">
                  <BlockIcon version={version} size={38} />
                  <div className="library-grid-copy">
                    <strong>{version.id}</strong>
                    <small title={versionUsageTitle(version)}>
                      {versionTypeLabel(version.type)} · {loaderLabel(version.loader) ?? 'Vanilla'}
                      {versionUsage(version) ? ` · ${versionUsage(version)}` : ''}
                    </small>
                  </div>
                </div>
                <div className="library-grid-facts">
                  <span>{version.javaMajor ? `Java ${version.javaMajor}` : 'Java 自动'}</span>
                  <span>{relativeTime(version.lastPlayed)}</span>
                </div>
                <div className="library-grid-actions">{actions(version)}</div>
              </article>
            ))
          )}
        </div>
      ) : (
        <div className="library-table">
          <div className="library-table-head">
            <span />
            <button type="button" onClick={() => changeSort('name')}>
              版本 {sortIcon('name')}
            </button>
            <span>类型</span>
            <span>Java</span>
            <button type="button" onClick={() => changeSort('date')}>
              最后启动 {sortIcon('date')}
            </button>
            <span>操作</span>
          </div>
          <div className="library-table-body">
            {sorted.length === 0 ? (
              <div className="library-table-empty">还没有独立版本</div>
            ) : (
              sorted.map((version) => (
                <div
                  key={version.id}
                  className={`library-table-row ${version.id === selectedId ? 'is-selected' : ''}`}
                  onClick={() => onSelect(version.id)}
                  onContextMenu={(event) => openMenu(event, version)}
                >
                  <span className="library-table-icon">
                    <BlockIcon version={version} size={30} />
                  </span>
                  <span className="library-table-name">
                    <strong>{version.id}</strong>
                    <small title={versionUsageTitle(version)}>
                      {version.inheritsFrom ? `基于 ${version.inheritsFrom}` : '原版'} ·{' '}
                      {loaderLabel(version.loader) ?? 'Vanilla'}
                      {versionUsage(version) ? ` · ${versionUsage(version)}` : ''}
                    </small>
                  </span>
                  <span className="library-table-meta">{versionTypeLabel(version.type)}</span>
                  <span className="library-table-meta">
                    {version.javaMajor ? `Java ${version.javaMajor}` : '自动'}
                  </span>
                  <span className="library-table-meta">{relativeTime(version.lastPlayed)}</span>
                  <span className="library-table-actions">{actions(version)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {menu && (
        <div
          className="context-menu"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              setMenu(null)
              onLaunch(menu.version.id)
            }}
          >
            <Play size={13} />
            启动
          </button>
          <button
            type="button"
            onClick={() => {
              setMenu(null)
              onOpenFolder(menu.version.id)
            }}
          >
            <FolderOpen size={13} />
            打开目录
          </button>
          <span className="context-menu-line" />
          <button type="button" onClick={() => void copyId(menu.version)}>
            <Copy size={13} />
            复制版本号
          </button>
          <button
            type="button"
            onClick={() => {
              setMenu(null)
              onExport(menu.version.id)
            }}
          >
            <Download size={13} />
            导出配置
          </button>
          <span className="context-menu-line" />
          <button
            type="button"
            className="is-danger"
            onClick={() => {
              setMenu(null)
              onDelete(menu.version.id)
            }}
          >
            <Trash2 size={13} />
            删除版本
          </button>
        </div>
      )}
    </>
  )
}
