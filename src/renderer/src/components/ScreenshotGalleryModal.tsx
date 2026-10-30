import { useCallback, useEffect, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  FolderOpen,
  Images,
  RefreshCw,
  Trash2
} from 'lucide-react'
import type { InstanceSummary, ScreenshotGallery, ScreenshotView } from '@shared/types'
import { useLauncher } from '../store'
import { cleanError, formatBytes, formatDateTime } from '../lib/format'
import { ConfirmDialog, EmptyState, Modal, Spinner } from './ui'

export function ScreenshotGalleryModal({
  instance,
  onClose
}: {
  instance: InstanceSummary | null
  onClose: () => void
}) {
  const toast = useLauncher((state) => state.toast)
  const [gallery, setGallery] = useState<ScreenshotGallery | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<ScreenshotView | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const instanceId = instance?.id ?? null

  const load = useCallback(async () => {
    if (!instanceId) return
    setLoading(true)
    setError('')
    try {
      const next = await window.ccl.screenshots.list(instanceId)
      setGallery(next)
      setSelectedId((current) =>
        current && next.screenshots.some((shot) => shot.id === current) ? current : null
      )
    } catch (cause) {
      setGallery(null)
      setError(cleanError(cause))
    } finally {
      setLoading(false)
    }
  }, [instanceId])

  useEffect(() => {
    if (!instanceId) {
      setGallery(null)
      setSelectedId(null)
      setError('')
      return
    }
    setSelectedId(null)
    void load()
  }, [instanceId, load])

  const selectedIndex = gallery
    ? gallery.screenshots.findIndex((shot) => shot.id === selectedId)
    : -1
  const selected = selectedIndex >= 0 && gallery ? gallery.screenshots[selectedIndex] : null
  const total = gallery?.screenshots.length ?? 0

  const move = (step: number) => {
    if (!gallery || gallery.screenshots.length === 0) return
    const nextIndex =
      (selectedIndex + step + gallery.screenshots.length) % gallery.screenshots.length
    setSelectedId(gallery.screenshots[nextIndex].id)
  }

  useEffect(() => {
    if (!selected) return
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        move(-1)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        move(1)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selected, gallery, selectedIndex])

  const openFolder = async () => {
    if (!instanceId) return
    try {
      await window.ccl.instances.openFolder(instanceId, 'screenshots')
    } catch (cause) {
      toast('error', '无法打开截图文件夹', cleanError(cause))
    }
  }

  const copySelected = async () => {
    if (!instanceId || !selected || busy) return
    setBusy(true)
    try {
      await window.ccl.screenshots.copy(instanceId, selected.name)
      toast('success', '截图已复制', '可以直接粘贴到聊天窗口')
    } catch (cause) {
      toast('error', '无法复制截图', cleanError(cause))
    } finally {
      setBusy(false)
    }
  }

  const openSelected = async () => {
    if (!instanceId || !selected) return
    try {
      await window.ccl.screenshots.open(instanceId, selected.name)
    } catch (cause) {
      toast('error', '无法打开截图', cleanError(cause))
    }
  }

  const removeSelected = async () => {
    if (!instanceId || !pendingDelete || busy) return
    setBusy(true)
    try {
      const index = gallery?.screenshots.findIndex((shot) => shot.id === pendingDelete.id) ?? -1
      await window.ccl.screenshots.remove(instanceId, pendingDelete.name)
      toast('success', '截图已移到回收站', pendingDelete.name)
      const next = gallery
        ? (gallery.screenshots[index + 1] ?? gallery.screenshots[index - 1] ?? null)
        : null
      setSelectedId(next?.id ?? null)
      setPendingDelete(null)
      await load()
    } catch (cause) {
      toast('error', '无法删除截图', cleanError(cause))
    } finally {
      setBusy(false)
    }
  }

  const handleClose = () => {
    if (selectedId) {
      setSelectedId(null)
      return
    }
    onClose()
  }

  const footer = selected ? (
    <div className="screenshot-footer">
      <button type="button" className="button button--ghost" onClick={() => setSelectedId(null)}>
        <ChevronLeft size={13} />
        返回画廊
      </button>
      <div className="screenshot-footer-actions">
        <button type="button" className="button button--ghost" onClick={() => void copySelected()} disabled={busy}>
          <Copy size={13} />
          复制图片
        </button>
        <button type="button" className="button button--ghost" onClick={() => void openSelected()}>
          <ExternalLink size={13} />
          打开
        </button>
        <button
          type="button"
          className="button button--danger"
          onClick={() => setPendingDelete(selected)}
          disabled={busy}
        >
          <Trash2 size={13} />
          移到回收站
        </button>
      </div>
    </div>
  ) : (
    <div className="screenshot-footer">
      <span className="screenshot-footer-hint">
        {gallery?.directory ? `实时读取 ${gallery.directory}` : '截图来自实例的 screenshots 文件夹'}
      </span>
      <div className="screenshot-footer-actions">
        <button type="button" className="button button--ghost" onClick={() => void openFolder()}>
          <FolderOpen size={13} />
          打开截图文件夹
        </button>
        <button type="button" className="button button--soft" onClick={onClose}>
          关闭
        </button>
      </div>
    </div>
  )

  return (
    <>
      <Modal
        open={Boolean(instance)}
        onClose={handleClose}
        title={selected ? '截图预览' : '截图画廊'}
        subtitle={
          selected
            ? `${selected.name} · ${formatDateTime(selected.modifiedAt)} · ${formatBytes(selected.sizeBytes)}`
            : `${instance?.name ?? ''} · 共 ${total} 张 · ${formatBytes(gallery?.totalBytes ?? 0)}`
        }
        icon={<Images size={18} />}
        size="xl"
        footer={footer}
      >
        {loading && !gallery ? (
          <div className="screenshot-loading">
            <Spinner size={16} />
            正在扫描截图…
          </div>
        ) : error ? (
          <div className="screenshot-error">
            <span>{error}</span>
            <button type="button" className="link-button" onClick={() => void load()}>
              重试
            </button>
          </div>
        ) : selected ? (
          <div className="screenshot-preview">
            <div className="screenshot-preview-head">
              <span className="mono-label">Preview</span>
              <span>
                {selectedIndex + 1} / {total}
              </span>
            </div>
            <div className="screenshot-stage">
              <button
                type="button"
                className="screenshot-nav is-prev"
                onClick={() => move(-1)}
                title="上一张"
                aria-label="上一张"
              >
                <ChevronLeft size={22} />
              </button>
              <img src={selected.url} alt={selected.name} />
              <button
                type="button"
                className="screenshot-nav is-next"
                onClick={() => move(1)}
                title="下一张"
                aria-label="下一张"
              >
                <ChevronRight size={22} />
              </button>
            </div>
            <p className="screenshot-preview-hint">← → 切换截图 · Esc 返回画廊</p>
          </div>
        ) : total === 0 ? (
          <EmptyState
            icon={<Images size={26} />}
            title="还没有截图"
            description="在游戏里按 F2 截图后，回到这里刷新即可看到。"
            action={
              <div className="screenshot-empty-actions">
                <button type="button" className="button button--soft" onClick={() => void openFolder()}>
                  <FolderOpen size={14} />
                  打开文件夹
                </button>
                <button type="button" className="button button--soft" onClick={() => void load()} disabled={loading}>
                  <RefreshCw size={14} className={loading ? 'spin' : ''} />
                  刷新
                </button>
              </div>
            }
          />
        ) : (
          <div className="screenshot-gallery">
            <div className="screenshot-gallery-head">
              <span>{total} 张截图</span>
              <div>
                <button type="button" className="link-button" onClick={() => void load()} disabled={loading}>
                  <RefreshCw size={12} className={loading ? 'spin' : ''} />
                  刷新
                </button>
                <button type="button" className="link-button" onClick={() => void openFolder()}>
                  <FolderOpen size={12} />
                  打开文件夹
                </button>
              </div>
            </div>
            <div className="screenshot-grid">
              {gallery?.screenshots.map((shot) => (
                <button
                  key={shot.id}
                  type="button"
                  className="screenshot-tile"
                  onClick={() => setSelectedId(shot.id)}
                  title={shot.name}
                >
                  <span className="screenshot-tile-image">
                    <img src={shot.thumbUrl} alt={shot.name} loading="lazy" />
                  </span>
                  <span className="screenshot-tile-copy">
                    <strong>{shot.name}</strong>
                    <small>
                      {formatDateTime(shot.modifiedAt)} · {formatBytes(shot.sizeBytes)}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="删除截图"
        message={
          <>
            将 <strong>{pendingDelete?.name}</strong> 移到系统回收站，之后可以从回收站恢复。
          </>
        }
        confirmLabel="移到回收站"
        danger
        busy={busy}
        onConfirm={() => void removeSelected()}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  )
}
