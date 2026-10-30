import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Archive,
  Boxes,
  Clock3,
  FolderOpen,
  HardDrive,
  RefreshCw,
  RotateCcw,
  Save,
  Trash2
} from 'lucide-react'
import type {
  InstanceSummary,
  TaskState,
  WorldBackupView,
  WorldSummary
} from '@shared/types'
import { useLauncher } from '../store'
import { cleanError, formatBytes, formatSpeed } from '../lib/format'
import {
  Badge,
  ConfirmDialog,
  EmptyState,
  Modal,
  ProgressBar,
  Spinner,
  Switch
} from './ui'

function formatWhen(value: number | null | undefined): string {
  if (!value) return '未知时间'
  return new Date(value).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function WorldVaultModal({
  open,
  instance,
  onClose
}: {
  open: boolean
  instance: InstanceSummary | null
  onClose: () => void
}) {
  const settings = useLauncher((state) => state.settings)
  const patchSettings = useLauncher((state) => state.patchSettings)
  const cancelTask = useLauncher((state) => state.cancelTask)
  const toast = useLauncher((state) => state.toast)

  const [worlds, setWorlds] = useState<WorldSummary[]>([])
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const [backups, setBackups] = useState<WorldBackupView[]>([])
  const [loading, setLoading] = useState(false)
  const [backupLoading, setBackupLoading] = useState(false)
  const [error, setError] = useState('')
  const [activeTask, setActiveTask] = useState<TaskState | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [restoreTarget, setRestoreTarget] = useState<WorldBackupView | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<WorldBackupView | null>(null)
  const [deleting, setDeleting] = useState(false)

  const selectedWorld = useMemo(
    () => worlds.find((world) => world.folder === selectedFolder) ?? null,
    [worlds, selectedFolder]
  )
  const presentWorlds = worlds.filter((world) => world.present)
  const totalBackupBytes = worlds.reduce((sum, world) => sum + world.backupBytes, 0)
  const taskRunning =
    activeTask?.status === 'running' || activeTask?.status === 'paused'
  const busy = taskRunning || deleting

  useEffect(() => {
    if (!open || !instance) return
    let alive = true
    setLoading(true)
    setError('')
    window.ccl.worlds
      .list(instance.id)
      .then((list) => {
        if (!alive) return
        setWorlds(list)
        setSelectedFolder((previous) => {
          if (previous && list.some((world) => world.folder === previous)) return previous
          return list[0]?.folder ?? null
        })
      })
      .catch((cause) => {
        if (!alive) return
        setError(cleanError(cause))
        setWorlds([])
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [open, instance?.id, reloadKey])

  useEffect(() => {
    if (!open || !instance || !selectedFolder) {
      setBackups([])
      return
    }
    let alive = true
    setBackupLoading(true)
    window.ccl.worlds
      .backups(instance.id, selectedFolder)
      .then((list) => {
        if (alive) setBackups(list)
      })
      .catch((cause) => {
        if (alive) {
          setBackups([])
          toast('error', '读取备份失败', cleanError(cause))
        }
      })
      .finally(() => {
        if (alive) setBackupLoading(false)
      })
    return () => {
      alive = false
    }
  }, [open, instance?.id, selectedFolder, reloadKey])

  useEffect(() => {
    if (!activeTask || activeTask.status !== 'running' && activeTask.status !== 'paused') return
    const taskId = activeTask.id
    let alive = true
    const timer = setInterval(async () => {
      try {
        const list = await window.ccl.tasks.list()
        const task = list.find((entry) => entry.id === taskId)
        if (!alive || !task) return
        setActiveTask(task)
        if (task.status !== 'running' && task.status !== 'paused') {
          setReloadKey((value) => value + 1)
        }
      } catch {
        /* 任务列表短暂不可用时继续轮询 */
      }
    }, 600)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [activeTask?.id, activeTask?.status])

  useEffect(() => {
    if (!open) {
      setActiveTask(null)
      setRestoreTarget(null)
      setDeleteTarget(null)
      setSelectedFolder(null)
    }
  }, [open])

  if (!instance) return null

  const startTask = async (promise: Promise<TaskState>) => {
    try {
      setActiveTask(await promise)
    } catch (cause) {
      toast('error', '存档任务未开始', cleanError(cause))
    }
  }

  const backupWorld = async (world?: WorldSummary) => {
    if (!instance || busy) return
    if (!world && presentWorlds.length === 0) {
      toast('info', '没有可备份的存档', '先在游戏里创建一个世界')
      return
    }
    await startTask(
      window.ccl.worlds.backup(instance.id, world ? world.folder : null)
    )
  }

  const confirmRestore = async () => {
    if (!instance || !restoreTarget || busy) return
    const target = restoreTarget
    setRestoreTarget(null)
    await startTask(
      window.ccl.worlds.restore(instance.id, target.worldFolder, target.id)
    )
  }

  const deleteBackup = async () => {
    if (!instance || !deleteTarget || busy) return
    setDeleting(true)
    try {
      await window.ccl.worlds.deleteBackup(
        instance.id,
        deleteTarget.worldFolder,
        deleteTarget.id
      )
      toast('success', '备份已删除')
      setDeleteTarget(null)
      setReloadKey((value) => value + 1)
    } catch (cause) {
      toast('error', '删除备份失败', cleanError(cause))
    } finally {
      setDeleting(false)
    }
  }

  const openFolder = async (kind: 'saves' | 'backups') => {
    if (!instance) return
    try {
      await window.ccl.worlds.openFolder(instance.id, kind)
    } catch (cause) {
      toast('error', '无法打开文件夹', cleanError(cause))
    }
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="存档仓库"
        subtitle={`${instance.name} · Minecraft ${instance.gameVersion}`}
        icon={<Archive size={18} />}
        size="xl"
        footer={
          <div className="world-vault-footer">
            <div className="world-vault-auto">
              <Switch
                checked={settings?.autoWorldBackup ?? true}
                label="加载器更新前自动备份"
                onChange={(value) => void patchSettings({ autoWorldBackup: value })}
              />
              <span>
                加载器更新前自动备份 · 每种备份保留 {settings?.worldBackupLimit ?? 10} 份
                {settings?.backupMaxAgeDays
                  ? ` · 最长 ${settings.backupMaxAgeDays} 天`
                  : ''}
              </span>
            </div>
            <span className="world-vault-total">
              备份占用 {formatBytes(totalBackupBytes)}
            </span>
          </div>
        }
      >
        <div className="world-vault">
          <div className="world-vault-toolbar">
            <div className="world-vault-actions">
              <button
                type="button"
                className="button button--primary button--sm"
                disabled={busy || presentWorlds.length === 0}
                onClick={() => void backupWorld()}
              >
                <Save size={13} />
                备份全部
              </button>
              <button
                type="button"
                className="button button--ghost button--sm"
                onClick={() => void openFolder('saves')}
              >
                <FolderOpen size={13} />
                存档目录
              </button>
              <button
                type="button"
                className="button button--ghost button--sm"
                onClick={() => void openFolder('backups')}
              >
                <Archive size={13} />
                备份目录
              </button>
              <button
                type="button"
                className="button button--ghost button--sm"
                disabled={busy}
                onClick={() => setReloadKey((value) => value + 1)}
              >
                <RefreshCw size={13} />
                刷新
              </button>
            </div>
            <span className="world-vault-hint">
              游戏运行中不能备份或恢复；恢复前会自动备份当前存档
            </span>
          </div>

          {activeTask && (
            <div className={`world-vault-task ${activeTask.status === 'error' ? 'is-error' : ''}`}>
              <div className="world-vault-task-head">
                <strong>{activeTask.stage}</strong>
                <span>{Math.round(activeTask.progress)}%</span>
              </div>
              <ProgressBar percent={activeTask.progress} />
              <div className="world-vault-task-foot">
                <span>
                  {activeTask.detail.bytesTotal > 0
                    ? `${formatBytes(activeTask.detail.bytesDone)} / ${formatBytes(activeTask.detail.bytesTotal)}`
                    : activeTask.message ?? '准备中…'}
                  {activeTask.detail.speed > 0 && ` · ${formatSpeed(activeTask.detail.speed)}`}
                </span>
                {activeTask.status === 'running' && (
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => void cancelTask(activeTask.id)}
                  >
                    取消
                  </button>
                )}
              </div>
              {activeTask.detail.activeFiles?.[0] && (
                <small className="world-vault-current-file" title={activeTask.detail.activeFiles[0].label}>
                  {activeTask.detail.activeFiles[0].label}
                </small>
              )}
              {activeTask.status === 'error' && (
                <small className="world-vault-current-file">{activeTask.error}</small>
              )}
            </div>
          )}

          {error && (
            <div className="world-vault-error">
              <AlertTriangle size={15} />
              <span>{error}</span>
            </div>
          )}

          {loading ? (
            <div className="world-vault-loading">
              <Spinner size={16} />
              正在读取存档…
            </div>
          ) : worlds.length === 0 ? (
            <EmptyState
              icon={<Boxes size={24} />}
              title="还没有存档"
              description="进入游戏创建一个世界后，这里会出现世界列表和备份记录。"
            />
          ) : (
            <div className="world-vault-grid">
              <section className="world-vault-worlds">
                <header>
                  <span>世界 · {worlds.length}</span>
                  <span>{presentWorlds.length} 个在存档目录</span>
                </header>
                <div className="world-vault-world-list">
                  {worlds.map((world) => (
                    <div
                      key={world.folder}
                      role="button"
                      tabIndex={0}
                      className={`world-row ${world.folder === selectedFolder ? 'is-selected' : ''}`}
                      onClick={() => setSelectedFolder(world.folder)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          setSelectedFolder(world.folder)
                        }
                      }}
                    >
                      <span className="world-row-icon">
                        {world.iconDataUrl ? (
                          <img src={world.iconDataUrl} alt="" />
                        ) : (
                          <Boxes size={20} />
                        )}
                      </span>
                      <span className="world-row-body">
                        <strong title={world.name}>{world.name}</strong>
                        <small>
                          {world.present
                            ? `${world.version ?? instance.gameVersion} · ${formatBytes(world.size)}`
                            : '仅备份 · 源存档已不在 saves'}
                        </small>
                        <small>
                          <Clock3 size={10} />
                          {world.present
                            ? formatWhen(world.lastPlayed)
                            : `最后备份 ${formatWhen(world.latestBackupAt)}`}
                          {world.backupCount > 0 && ` · ${world.backupCount} 份备份`}
                        </small>
                      </span>
                      {world.present && (
                        <button
                          type="button"
                          className="world-row-backup"
                          disabled={busy}
                          title="备份这个存档"
                          onClick={(event) => {
                            event.stopPropagation()
                            void backupWorld(world)
                          }}
                        >
                          <Save size={12} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </section>

              <section className="world-vault-backups">
                <header>
                  <span>
                    {selectedWorld ? `${selectedWorld.name} 的备份` : '备份记录'}
                  </span>
                  <span>{backups.length} 份</span>
                </header>
                {selectedWorld && !selectedWorld.present && (
                  <p className="world-vault-warning">
                    这个世界的源目录已经被删除，仍可从备份恢复；恢复时会重新创建 saves/{selectedWorld.folder}。
                  </p>
                )}
                {backupLoading ? (
                  <div className="world-vault-loading">
                    <Spinner size={14} />
                    正在读取备份…
                  </div>
                ) : backups.length === 0 ? (
                  <div className="world-vault-empty">
                    <HardDrive size={20} />
                    <p>还没有备份</p>
                    <span>点左侧的保存按钮备份这个存档。</span>
                  </div>
                ) : (
                  <div className="world-backup-list">
                    {backups.map((backup) => (
                      <div key={backup.id} className="world-backup-row">
                        <div className="world-backup-main">
                          <strong>{formatWhen(backup.createdAt)}</strong>
                          <small>
                            {backup.label} · {formatBytes(backup.bytes)} · {backup.files} 个文件
                          </small>
                        </div>
                        <div className="world-backup-actions">
                          <button
                            type="button"
                            className="button button--soft button--sm"
                            disabled={busy}
                            onClick={() => setRestoreTarget(backup)}
                          >
                            <RotateCcw size={12} />
                            恢复
                          </button>
                          <button
                            type="button"
                            className="button button--ghost button--sm"
                            disabled={busy}
                            title="删除这份备份"
                            aria-label="删除这份备份"
                            onClick={() => setDeleteTarget(backup)}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(restoreTarget)}
        title="恢复这个存档备份？"
        message={
          restoreTarget
            ? `将把「${restoreTarget.worldName}」的 ${formatWhen(restoreTarget.createdAt)} 备份恢复到 saves 中。${
                selectedWorld?.present ? '当前世界会先自动备份；' : ''
              }游戏必须先退出。`
            : ''
        }
        confirmLabel="备份当前并恢复"
        danger
        busy={taskRunning}
        onConfirm={() => void confirmRestore()}
        onCancel={() => setRestoreTarget(null)}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="删除这份备份？"
        message={
          deleteTarget
            ? `这会永久删除 ${formatWhen(deleteTarget.createdAt)} 的备份，无法撤回。`
            : ''
        }
        confirmLabel="永久删除"
        danger
        busy={deleting}
        onConfirm={() => void deleteBackup()}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  )
}
