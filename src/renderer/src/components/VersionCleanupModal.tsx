import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, RefreshCw, Trash2 } from 'lucide-react'
import type { VersionCleanupGroup, VersionCleanupPreview } from '@shared/types'
import { useLauncher } from '../store'
import { cleanError, formatBytes } from '../lib/format'
import { EmptyState, Modal, Spinner } from './ui'

function shortIds(group: VersionCleanupGroup): string {
  if (group.ids.length === 1) {
    return /loader|forge|quilt|optifine/i.test(group.ids[0]) ? '加载器档案' : '原版基础文件'
  }
  const children = group.ids.slice(1)
  const visible = children.slice(0, 2).join(' · ')
  return children.length > 2 ? `${visible} · +${children.length - 2}` : visible
}

export function VersionCleanupModal({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}) {
  const toast = useLauncher((state) => state.toast)
  const refreshInstalled = useLauncher((state) => state.refreshInstalled)
  const [preview, setPreview] = useState<VersionCleanupPreview | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [cleaning, setCleaning] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const next = await window.ccl.versions.cleanupPreview()
      setPreview(next)
      setSelected(
        new Set(
          next.groups
            .filter((group) => group.suggested)
            .flatMap((group) => group.ids)
        )
      )
    } catch (cause) {
      setPreview(null)
      setError(cleanError(cause))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    void load()
  }, [open, load])

  useEffect(() => {
    if (!open) {
      setPreview(null)
      setSelected(new Set())
      setError('')
    }
  }, [open])

  const suggested = preview?.groups.filter((group) => group.suggested) ?? []
  const standalone = preview?.groups.filter((group) => !group.suggested) ?? []
  const selectedGroups = useMemo(
    () =>
      (preview?.groups ?? []).filter((group) =>
        group.ids.every((id) => selected.has(id))
      ),
    [preview, selected]
  )
  const selectedBytes = selectedGroups.reduce((sum, group) => sum + group.sizeBytes, 0)

  const toggleGroup = (group: VersionCleanupGroup) => {
    setSelected((current) => {
      const next = new Set(current)
      if (group.ids.every((id) => next.has(id))) {
        for (const id of group.ids) next.delete(id)
      } else {
        for (const id of group.ids) next.add(id)
      }
      return next
    })
  }

  const clean = async () => {
    if (selected.size === 0 || cleaning) return
    setCleaning(true)
    try {
      const result = await window.ccl.versions.cleanup([...selected])
      await refreshInstalled()
      toast(
        'success',
        '版本清理完成',
        result.removed.length > 0
          ? `已删除 ${result.removed.length} 个版本，释放 ${formatBytes(selectedBytes)}`
          : '没有版本被删除'
      )
      if (result.skipped.length > 0) {
        toast(
          'info',
          '部分版本已跳过',
          result.skipped.slice(0, 4).join('、') +
            (result.skipped.length > 4 ? ` 等 ${result.skipped.length} 个` : '')
        )
      }
      onClose()
    } catch (cause) {
      toast('error', '无法清理版本', cleanError(cause))
    } finally {
      setCleaning(false)
    }
  }

  const renderGroup = (group: VersionCleanupGroup) => {
    const checked = group.ids.every((id) => selected.has(id))
    return (
      <label
        key={group.label}
        className={`version-cleanup-group ${checked ? 'is-checked' : ''}`}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={() => toggleGroup(group)}
        />
        <span className="version-cleanup-copy">
          <strong>{group.label}</strong>
          <small>{shortIds(group)}</small>
        </span>
        <span className="version-cleanup-size">{formatBytes(group.sizeBytes)}</span>
      </label>
    )
  }

  const footer = (
    <div className="version-cleanup-footer">
      <span className="version-cleanup-footer-hint">
        只删除版本档案，不会删除存档、模组、配置、libraries 或 assets
      </span>
      <div className="version-cleanup-footer-actions">
        <button type="button" className="button button--ghost" onClick={onClose} disabled={cleaning}>
          取消
        </button>
        <button
          type="button"
          className="button button--danger"
          disabled={cleaning || loading || selected.size === 0}
          onClick={() => void clean()}
        >
          {cleaning ? <Spinner size={14} /> : <Trash2 size={14} />}
          清理 {selected.size} 个版本
          {selectedBytes > 0 ? `（${formatBytes(selectedBytes)}）` : ''}
        </button>
      </div>
    </div>
  )

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="清理未使用版本"
      subtitle="仅检查当前版本文件夹；删除不再被实例或已安装启动档案引用的版本"
      icon={<Trash2 size={18} />}
      size="lg"
      footer={footer}
    >
      <div className="version-cleanup">
        <div className="version-cleanup-warning">
          <AlertTriangle size={15} />
          <span>
            被实例使用的版本不会出现在这里；独立原版默认不勾选，避免误删你手动安装的版本。
          </span>
        </div>
        {loading ? (
          <div className="version-cleanup-loading">
            <Spinner size={18} />
            正在检查未使用版本…
          </div>
        ) : error ? (
          <div className="version-cleanup-error">
            <span>{error}</span>
            <button type="button" className="button button--soft button--sm" onClick={() => void load()}>
              <RefreshCw size={12} />
              重试
            </button>
          </div>
        ) : preview && preview.groups.length === 0 ? (
          <EmptyState
            icon={<Trash2 size={22} />}
            title="没有需要清理的版本"
            description="所有已安装版本都仍被实例、启动档案或最近选择引用。"
          />
        ) : (
          <>
            {suggested.length > 0 && (
              <section className="version-cleanup-section">
                <header>
                  <strong>建议清理</strong>
                  <span>
                    未使用的加载器链 · {formatBytes(preview?.suggestedBytes ?? 0)}
                  </span>
                </header>
                {suggested.map(renderGroup)}
              </section>
            )}
            {standalone.length > 0 && (
              <section className="version-cleanup-section">
                <header>
                  <strong>未引用的独立版本</strong>
                  <span>可能是手动安装的原版，默认不勾选</span>
                </header>
                {standalone.map(renderGroup)}
              </section>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
