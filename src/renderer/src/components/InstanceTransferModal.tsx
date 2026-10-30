import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowRightLeft, FolderOpen, RefreshCw } from 'lucide-react'
import type { InstanceSummary, VersionFolderView } from '@shared/types'
import { useLauncher } from '../store'
import { cleanError } from '../lib/format'
import { Modal, Spinner } from './ui'

type TransferMode = 'move' | 'clone'

function folderLabel(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] || path
}

export function InstanceTransferModal({
  instance,
  onClose
}: {
  instance: InstanceSummary | null
  onClose: () => void
}) {
  const settings = useLauncher((state) => state.settings)
  const toast = useLauncher((state) => state.toast)
  const [folders, setFolders] = useState<VersionFolderView[]>([])
  const [mode, setMode] = useState<TransferMode>('move')
  const [target, setTarget] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const sourceBase =
    instance?.external?.baseDir ?? instance?.baseDir ?? settings?.gameDir ?? ''
  const external = Boolean(instance?.external)

  const loadFolders = useCallback(async () => {
    setLoading(true)
    try {
      setFolders(await window.ccl.versions.folders())
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!instance) return
    setMode(instance.external ? 'clone' : 'move')
    setName(`${instance.name} 副本`)
    setTarget('')
    setError('')
    void loadFolders()
  }, [instance?.id, instance?.external, instance?.name, loadFolders])

  const targets = useMemo(() => {
    return folders.filter((folder) => {
      if (folder.kind === 'official') return false
      if (mode === 'move' && folder.path.toLowerCase() === sourceBase.toLowerCase()) return false
      if (
        external &&
        instance?.external &&
        folder.path.toLowerCase() === instance.external.baseDir.toLowerCase()
      ) {
        return false
      }
      return true
    })
  }, [folders, mode, sourceBase, external, instance?.external])

  useEffect(() => {
    if (!instance || loading) return
    if (target && targets.some((folder) => folder.path === target)) return
    const preferred =
      targets.find((folder) => folder.path.toLowerCase() === settings?.gameDir.toLowerCase()) ??
      targets[0]
    setTarget(preferred?.path ?? '')
  }, [instance, loading, target, targets, settings?.gameDir])

  if (!instance) return null

  const submit = async () => {
    if (!target || busy) return
    if (mode === 'clone' && !name.trim()) {
      setError('实例名称不能为空')
      return
    }
    setBusy(true)
    setError('')
    try {
      await window.ccl.instances.transfer({
        instanceId: instance.id,
        mode,
        targetDir: target,
        name: mode === 'clone' ? name.trim() : undefined
      })
      toast(
        'info',
        mode === 'move' ? '迁移任务已开始' : '克隆任务已开始',
        '进度和结果会显示在后台任务'
      )
      onClose()
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={Boolean(instance)}
      onClose={onClose}
      title="迁移 / 克隆实例"
      subtitle={`${instance.name} · ${external ? '外部实例' : '受管实例'}`}
      icon={<ArrowRightLeft size={18} />}
      size="lg"
      footer={
        <div className="transfer-footer">
          <span className="transfer-footer-hint">
            {mode === 'move'
              ? '只改变实例绑定的版本文件夹，不会删除源文件夹'
              : '模组优先硬链接；配置、存档和截图独立复制'}
          </span>
          <div>
            <button type="button" className="button button--ghost" onClick={onClose} disabled={busy}>
              取消
            </button>
            <button
              type="button"
              className="button button--primary"
              onClick={() => void submit()}
              disabled={!target || busy || loading}
            >
              {busy ? <Spinner size={13} /> : <ArrowRightLeft size={13} />}
              {mode === 'move' ? '开始迁移' : '开始克隆'}
            </button>
          </div>
        </div>
      }
    >
      <div className="transfer-body">
        <div className="transfer-source">
          <span>当前版本文件夹</span>
          <strong title={sourceBase}>{sourceBase || '未设置'}</strong>
          {external && instance.external && (
            <small title={instance.external.gameDir}>
              外部内容目录：{instance.external.gameDir}
            </small>
          )}
        </div>

        <div className="transfer-mode">
          <button
            type="button"
            className={mode === 'move' ? 'is-active' : ''}
            onClick={() => setMode('move')}
            disabled={external || busy}
            title={external ? '外部实例不能迁移，只能克隆到受管目录' : undefined}
          >
            <strong>迁移绑定</strong>
            <small>实例内容留在原位，只换版本文件夹</small>
          </button>
          <button
            type="button"
            className={mode === 'clone' ? 'is-active' : ''}
            onClick={() => setMode('clone')}
            disabled={busy}
          >
            <strong>克隆实例</strong>
            <small>复制一份独立实例，源实例不改动</small>
          </button>
        </div>

        {external && (
          <p className="transfer-note is-warning">
            外部实例只能克隆到受管目录，外部原目录不会被移动、删除或改写。
          </p>
        )}

        <div className="transfer-section-head">
          <span>目标版本文件夹</span>
          <button
            type="button"
            className="link-button"
            onClick={() => void loadFolders()}
            disabled={loading}
          >
            <RefreshCw size={12} className={loading ? 'spin' : ''} />
            刷新
          </button>
        </div>

        {loading && targets.length === 0 ? (
          <div className="transfer-loading">
            <Spinner size={15} />
            正在读取版本文件夹…
          </div>
        ) : targets.length === 0 ? (
          <div className="transfer-empty">
            <p>还没有可用的目标文件夹。</p>
            <button
              type="button"
              className="button button--soft button--sm"
              onClick={() => {
                onClose()
                window.dispatchEvent(new Event('windletter:version-folders'))
              }}
            >
              <FolderOpen size={13} />
              去添加版本文件夹
            </button>
          </div>
        ) : (
          <div className="transfer-targets">
            {targets.map((folder) => (
              <button
                key={folder.path}
                type="button"
                className={`transfer-target ${target === folder.path ? 'is-active' : ''}`}
                onClick={() => setTarget(folder.path)}
                disabled={busy}
                title={folder.path}
              >
                <span className="transfer-target-icon">
                  <FolderOpen size={15} />
                </span>
                <span className="transfer-target-copy">
                  <strong>
                    {folder.kind === 'current' ? '当前文件夹' : folder.name}
                    {folder.kind === 'current' && <em>当前</em>}
                  </strong>
                  <small>{folder.path}</small>
                </span>
                <span className="transfer-target-meta">
                  {folder.versionCount} 个版本
                  {folder.instanceCount > 0 ? ` · ${folder.instanceCount} 个实例` : ''}
                </span>
              </button>
            ))}
          </div>
        )}

        {mode === 'clone' && (
          <label className="transfer-name">
            <span>新实例名称</span>
            <input
              type="text"
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              disabled={busy}
              placeholder="例如 miao 副本"
            />
          </label>
        )}

        <p className="transfer-note">
          {mode === 'move'
            ? '迁移完成后，实例会使用目标文件夹里的版本、运行库和资源；源文件夹保持原样，不会自动删除。'
            : external
              ? '会把外部内容复制到受管实例目录，并补齐目标文件夹的版本、运行库和资源；外部目录只读。'
              : '会把实例内容复制到新的受管目录；同类文件优先硬链接，配置、存档和截图使用独立副本。'}
        </p>

        {error && <div className="transfer-error">{error}</div>}
      </div>
    </Modal>
  )
}