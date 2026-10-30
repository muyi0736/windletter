import { RemoteIcon } from '../components/RemoteIcon'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Boxes,
  Check,
  ChevronDown,
  Download,
  Folder,
  FolderOpen,
  Layers,
  PackagePlus,
  Plus,
  Search,
  Trash2,
  X
} from 'lucide-react'
import type { InstanceSummary, InstalledVersion, VersionFolderView } from '@shared/types'
import { useLauncher } from '../store'
import {
  cleanError,
  javaRequirement,
  loaderKind,
  loaderLabel,
  relativeTime,
  versionTypeLabel
} from '../lib/format'
import { Badge, ConfirmDialog, EmptyState, IconButton, Modal } from './ui'
import { BlockIcon } from './visuals'

function folderLabel(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] || path
}

export function VersionPicker() {
  const open = useLauncher((state) => state.versionPickerOpen)
  const setOpen = useLauncher((state) => state.setVersionPickerOpen)
  const installed = useLauncher((state) => state.installed)
  const instances = useLauncher((state) => state.instances)
  const loading = useLauncher((state) => state.installedLoading || state.instancesLoading)
  const selectedId = useLauncher((state) => state.selectedVersionId)
  const selectedInstanceId = useLauncher((state) => state.selectedInstanceId)
  const launch = useLauncher((state) => state.launch)
  const selectVersion = useLauncher((state) => state.selectVersion)
  const selectInstance = useLauncher((state) => state.selectInstance)
  const setPage = useLauncher((state) => state.setPage)
  const removeVersion = useLauncher((state) => state.removeVersion)
  const importModpack = useLauncher((state) => state.importModpack)
  const settings = useLauncher((state) => state.settings)
  const patchSettings = useLauncher((state) => state.patchSettings)
  const refreshInstalled = useLauncher((state) => state.refreshInstalled)
  const refreshInstances = useLauncher((state) => state.refreshInstances)
  const refreshJava = useLauncher((state) => state.refreshJava)
  const toast = useLauncher((state) => state.toast)

  const [query, setQuery] = useState('')
  const [pendingDelete, setPendingDelete] = useState<InstalledVersion | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [folders, setFolders] = useState<VersionFolderView[]>([])
  const [foldersOpen, setFoldersOpen] = useState(false)
  const [foldersLoading, setFoldersLoading] = useState(false)
  const [folderBusy, setFolderBusy] = useState(false)

  const loadFolders = useCallback(async () => {
    setFoldersLoading(true)
    try {
      setFolders(await window.ccl.versions.folders())
    } catch (cause) {
      toast('error', '无法读取版本文件夹', cleanError(cause))
    } finally {
      setFoldersLoading(false)
    }
  }, [toast])

  useEffect(() => {
    if (open) void loadFolders()
  }, [open, loadFolders])

  useEffect(() => {
    if (!open) setFoldersOpen(false)
  }, [open])

  useEffect(() => {
    const openFolders = () => {
      setOpen(true)
      setFoldersOpen(true)
      void loadFolders()
    }
    window.addEventListener('windletter:version-folders', openFolders)
    return () => window.removeEventListener('windletter:version-folders', openFolders)
  }, [loadFolders, setOpen])

  const currentFolder = folders.find((folder) => folder.kind === 'current')
  const currentFolderPath = currentFolder?.path ?? settings?.gameDir ?? ''

  const switchFolder = async (folder: VersionFolderView) => {
    if (folderBusy || folder.kind === 'current') return
    setFolderBusy(true)
    try {
      const next = await patchSettings({ gameDir: folder.path })
      if (!next) return
      await Promise.all([refreshInstalled(), refreshInstances()])
      void refreshJava(true)
      setFoldersOpen(false)
      setQuery('')
      await loadFolders()
      toast('success', '版本文件夹已切换', folder.path)
    } finally {
      setFolderBusy(false)
    }
  }

  const addFolder = async () => {
    if (folderBusy) return
    const path = await window.ccl.app.pickDirectory('选择已有版本文件夹', settings?.gameDir)
    if (!path) return
    const exists = folders.some((folder) => folder.path.toLowerCase() === path.toLowerCase())
    if (exists) {
      toast('info', '文件夹已经在列表里', path)
      return
    }
    setFolderBusy(true)
    try {
      const next = await patchSettings({
        versionFolders: [...(settings?.versionFolders ?? []), path]
      })
      if (!next) return
      await loadFolders()
      toast('success', '已添加版本文件夹', '点击文件夹即可切换到它')
    } finally {
      setFolderBusy(false)
    }
  }

  const removeFolder = async (folder: VersionFolderView) => {
    if (folderBusy || folder.kind !== 'custom') return
    setFolderBusy(true)
    try {
      const next = await patchSettings({
        versionFolders: (settings?.versionFolders ?? []).filter(
          (path) => path.toLowerCase() !== folder.path.toLowerCase()
        )
      })
      if (!next) return
      await loadFolders()
      toast('info', '已从列表移除版本文件夹', '磁盘上的文件不会被删除')
    } finally {
      setFolderBusy(false)
    }
  }

  const keyword = query.trim().toLowerCase()
  const currentBase = (settings?.gameDir ?? '').toLowerCase()
  const visibleInstalled = useMemo(() => {
    // 实例已经在列表里单独展示；原版实例会接管对应的基础版本，
    // 避免同一个 26.3 同时出现在「实例」和「已安装版本」里造成误选。
    const managed = new Set(
      instances
        .filter(
          (instance) =>
            (instance.external?.baseDir ?? instance.baseDir ?? settings?.gameDir ?? '').toLowerCase() ===
              currentBase
        )
        .map((instance) => instance.versionId)
    )
    return installed.filter((version) => !managed.has(version.id))
  }, [installed, instances, currentBase])
  const filteredVersions = useMemo(() => {
    if (!keyword) return visibleInstalled
    return visibleInstalled.filter(
      (version) =>
        version.id.toLowerCase().includes(keyword) ||
        (version.loader ?? '').toLowerCase().includes(keyword)
    )
  }, [visibleInstalled, keyword])
  const filteredInstances = useMemo(() => {
    if (!keyword) return instances
    return instances.filter(
      (instance) =>
        instance.name.toLowerCase().includes(keyword) ||
        instance.gameVersion.toLowerCase().includes(keyword) ||
        instance.loader.toLowerCase().includes(keyword)
    )
  }, [instances, keyword])

  const handlePick = (version: InstalledVersion) => {
    selectVersion(version.id)
    setOpen(false)
  }

  const handlePickInstance = (instance: InstanceSummary) => {
    selectInstance(instance.id)
    setOpen(false)
  }

  const handleRemove = async () => {
    if (!pendingDelete) return
    setDeleting(true)
    await removeVersion(pendingDelete.id)
    setDeleting(false)
    setPendingDelete(null)
  }

  const openFolder = (version: InstalledVersion) => {
    void window.ccl.versions.openFolder(version.id).catch((error) => {
      toast('error', '无法打开版本文件夹', cleanError(error))
    })
  }

  const openInstanceFolder = (instance: InstanceSummary) => {
    void window.ccl.instances.openFolder(instance.id).catch((error) => {
      toast('error', '无法打开实例文件夹', cleanError(error))
    })
  }

  const launchActive = launch.status === 'running' || launch.status === 'starting'
  const runningInstanceId = launchActive ? launch.instanceId : null
  const runningVersion = launchActive ? launch.versionId : null
  const totalCount = visibleInstalled.length + instances.length
  const noMatch = totalCount > 0 && filteredInstances.length === 0 && filteredVersions.length === 0

  return (
    <>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="选择版本或实例"
        subtitle={`${visibleInstalled.length} 个版本 · ${instances.length} 个实例，单击即可设为当前目标`}
        icon={<Layers size={20} />}
        size="md"
        footer={
          <div className="version-picker-footer">
            <div className="version-picker-footer-group">
              <button
                type="button"
                className="button button--ghost"
                onClick={() => {
                  setOpen(false)
                  void importModpack()
                }}
              >
                <PackagePlus size={15} />
                导入整合包
              </button>
              <button
                type="button"
                className="button button--ghost"
                onClick={() => {
                  setOpen(false)
                  setPage('downloads')
                }}
              >
                <Download size={15} />
                下载新版本
              </button>
            </div>
            <button type="button" className="button button--soft" onClick={() => setOpen(false)}>
              关闭
            </button>
          </div>
        }
      >
        <div className="version-folder-bar">
          <button
            type="button"
            className={`version-folder-trigger ${foldersOpen ? 'is-open' : ''}`}
            onClick={() => {
              setFoldersOpen((value) => !value)
              if (!folders.length) void loadFolders()
            }}
            disabled={folderBusy}
          >
            <span className="version-folder-trigger-icon">
              <FolderOpen size={15} />
            </span>
            <span className="version-folder-trigger-copy">
              <strong>{currentFolder?.name ?? '当前文件夹'}</strong>
              <small title={currentFolderPath}>{currentFolderPath || '未设置'}</small>
            </span>
            {currentFolder && (
              <span className="version-folder-count">{currentFolder.versionCount} 个版本</span>
            )}
            <ChevronDown size={14} className={foldersOpen ? 'is-open' : ''} />
          </button>
        </div>

        {foldersOpen && (
          <div className="version-folder-panel">
            {foldersLoading ? (
              <div className="version-folder-loading">正在读取版本文件夹…</div>
            ) : (
              <div className="version-folder-list">
                {folders.map((folder) => (
                  <div
                    key={`${folder.kind}:${folder.path}`}
                    className={`version-folder-row ${folder.kind === 'current' ? 'is-current' : ''}`}
                  >
                    <button
                      type="button"
                      className="version-folder-select"
                      disabled={folderBusy || folder.kind === 'current'}
                      onClick={() => void switchFolder(folder)}
                      title={folder.path}
                    >
                      <Folder size={15} />
                      <span className="version-folder-copy">
                        <strong>
                          {folder.name}
                          {folder.kind === 'current' && <span className="version-folder-current">当前</span>}
                          {!folder.exists && <span className="version-folder-missing">未创建</span>}
                        </strong>
                        <small>{folder.path}</small>
                      </span>
                      <span className="version-folder-meta">
                        {folder.versionCount} 个版本
                        {folder.instanceCount > 0 ? ` · ${folder.instanceCount} 个实例` : ''}
                      </span>
                      {folder.kind === 'current' && <Check size={14} />}
                    </button>
                    {folder.kind === 'custom' && (
                      <IconButton
                        label="从列表移除"
                        onClick={() => void removeFolder(folder)}
                        disabled={folderBusy}
                      >
                        <X size={13} />
                      </IconButton>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="version-folder-actions">
              <button type="button" className="button button--ghost button--sm" onClick={() => void addFolder()} disabled={folderBusy}>
                <Plus size={13} />
                添加已有文件夹
              </button>
              <button
                type="button"
                className="button button--ghost button--sm"
                onClick={() => {
                  setFoldersOpen(false)
                  setOpen(false)
                  void importModpack()
                }}
                disabled={folderBusy}
              >
                <PackagePlus size={13} />
                导入整合包
              </button>
            </div>
            <p className="version-folder-hint">
              切换只影响之后下载的版本和直接启动的原版；已有实例会继续使用创建时绑定的文件夹。
            </p>
          </div>
        )}

        <div className="text-input picker-search">
          <Search size={15} />
          <input
            value={query}
            placeholder="搜索版本、实例、加载器"
            onChange={(event) => setQuery(event.target.value)}
            spellCheck={false}
          />
        </div>

        {loading && <div className="picker-loading">正在扫描版本与实例…</div>}

        {!loading && totalCount === 0 && (
          <EmptyState
            icon={<Boxes size={24} />}
            title="还没有版本或实例"
            description="下载一个原版版本，或导入一个 .mrpack / .zip 整合包开始。"
            action={
              <div className="picker-empty-actions">
                <button
                  type="button"
                  className="button button--primary"
                  onClick={() => {
                    setOpen(false)
                    setPage('downloads')
                  }}
                >
                  <Download size={15} />
                  前往下载中心
                </button>
                <button
                  type="button"
                  className="button button--soft"
                  onClick={() => {
                    setOpen(false)
                    setPage('instances')
                  }}
                >
                  <Boxes size={15} />
                  管理实例
                </button>
              </div>
            }
          />
        )}

        {!loading && noMatch && <div className="picker-loading">没有匹配「{query}」的内容</div>}

        <div className="picker-scroll">
          {filteredInstances.length > 0 && (
            <section className="picker-section">
              <div className="picker-section-head">
                <span>我的实例</span>
                <Badge tone="accent">{filteredInstances.length}</Badge>
              </div>
              <div className="version-pick-list">
                {filteredInstances.map((instance) => {
                  const selected = instance.id === selectedInstanceId
                  const isRunning = instance.id === runningInstanceId
                  const boundDir = instance.external?.baseDir ?? instance.baseDir ?? ''
                  const otherFolder =
                    boundDir && boundDir.toLowerCase() !== currentBase ? boundDir : null
                  return (
                    <button
                      key={instance.id}
                      type="button"
                      className={`version-pick-row ${selected ? 'is-selected' : ''}`}
                      onClick={() => handlePickInstance(instance)}
                    >
                      <span className="instance-pick-icon">
                        <RemoteIcon url={instance.iconUrl} fallback={<Boxes size={20} />} />
                      </span>
                      <span className="version-pick-copy">
                        <span className="version-pick-name">
                          {instance.name}
                          {instance.loader !== 'vanilla' && (
                            <span className={`loader-tag loader-tag--${loaderKind(instance.loader)}`}>
                              {loaderLabel(instance.loader)}
                            </span>
                          )}
                          {otherFolder && (
                            <span
                              className="version-folder-tag"
                              title={`位于 ${otherFolder}，切换文件夹不会移动这个实例`}
                            >
                              <Folder size={9} />
                              <span>{folderLabel(otherFolder)}</span>
                            </span>
                          )}
                          {isRunning && <Badge tone="success">运行中</Badge>}
                        </span>
                        <span className="version-pick-meta">
                          Minecraft {instance.gameVersion} · {instance.modCount} 个模组 ·{' '}
                          {relativeTime(instance.lastPlayed)}
                        </span>
                      </span>
                      <span className="version-pick-actions">
                        <IconButton
                          label="打开实例目录"
                          onClick={(event) => {
                            event.stopPropagation()
                            openInstanceFolder(instance)
                          }}
                        >
                          <FolderOpen size={15} />
                        </IconButton>
                      </span>
                      <span className={`version-pick-check ${selected ? 'is-on' : ''}`}>
                        {selected && <Check size={13} strokeWidth={3} />}
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>
          )}

          {filteredVersions.length > 0 && (
            <section className="picker-section">
              <div className="picker-section-head">
                <span>已安装版本</span>
                <Badge tone="neutral">{filteredVersions.length}</Badge>
              </div>
              <div className="version-pick-list">
                {filteredVersions.map((version) => {
                  const selected = !selectedInstanceId && version.id === selectedId
                  const isRunning = !runningInstanceId && version.id === runningVersion
                  return (
                    <button
                      key={version.id}
                      type="button"
                      className={`version-pick-row ${selected ? 'is-selected' : ''}`}
                      onClick={() => handlePick(version)}
                    >
                      <BlockIcon version={version} size={42} />
                      <span className="version-pick-copy">
                        <span className="version-pick-name">
                          {version.id}
                          {version.loader && (
                            <span className={`loader-tag loader-tag--${loaderKind(version.loader)}`}>
                              {loaderLabel(version.loader)}
                            </span>
                          )}
                          {isRunning && <Badge tone="success">运行中</Badge>}
                        </span>
                        <span className="version-pick-meta">
                          {versionTypeLabel(version.type)} · {javaRequirement(version.javaMajor)} ·{' '}
                          {relativeTime(version.lastPlayed)}
                        </span>
                      </span>
                      <span className="version-pick-actions">
                        <IconButton
                          label="打开版本文件夹"
                          onClick={(event) => {
                            event.stopPropagation()
                            openFolder(version)
                          }}
                        >
                          <FolderOpen size={15} />
                        </IconButton>
                        <IconButton
                          label="删除版本"
                          tone="danger"
                          disabled={isRunning}
                          onClick={(event) => {
                            event.stopPropagation()
                            setPendingDelete(version)
                          }}
                        >
                          <Trash2 size={15} />
                        </IconButton>
                      </span>
                      <span className={`version-pick-check ${selected ? 'is-on' : ''}`}>
                        {selected && <Check size={13} strokeWidth={3} />}
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除版本"
        message={
          <>
            将删除版本 <strong>{pendingDelete?.id}</strong> 及其同目录下的游戏文件。
            <br />
            共享的资源与运行库不会受到影响。
          </>
        }
        confirmLabel="删除"
        danger
        busy={deleting}
        onConfirm={() => void handleRemove()}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  )
}
