import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Boxes,
  ChevronDown,
  ChevronRight,
  Coffee,
  Download,
  FolderOpen,
  Gamepad2,
  HardDrive,
  MemoryStick,
  Package,
  Play,
  Plus,
  RefreshCw,
  Square,
  Trash2,
  Upload,
  UserRound
} from 'lucide-react'
import type { InstanceSummary, JavaInfo } from '@shared/types'
import { useLauncher } from '../store'
import { PlaytimeBadge } from '../components/PlaytimeBadge'
import {
  cleanError,
  formatDate,
  formatMemory,
  formatSpeed,
  greeting,
  loaderKind,
  loaderLabel,
  relativeTime,
  versionTypeLabel
} from '../lib/format'
import { copyText } from '../lib/clipboard'
import { useShortcuts } from '../lib/shortcuts'
import { RemoteIcon } from '../components/RemoteIcon'
import { Avatar, BlockIcon } from '../components/visuals'
import { ConfirmDialog, Modal } from '../components/ui'
import { LibraryTable } from '../components/LibraryTable'
import { ModsModal } from '../components/ModsModal'
import { VersionCleanupModal } from '../components/VersionCleanupModal'
import { RightPanel } from '../components/RightPanel'

function pickJava(list: JavaInfo[], required: number | null, customPath: string | null): JavaInfo | null {
  if (customPath) {
    const custom = list.find((java) => java.path === customPath)
    if (custom) return custom
  }
  if (!required) return list[0] ?? null
  return (
    list.find((java) => java.major === required) ??
    (required === 8
      ? null
      : (list.filter((java) => java.major >= required).sort((a, b) => a.major - b.major)[0] ?? null))
  )
}

function instanceIcon(instance: InstanceSummary): ReactNode {
  return <RemoteIcon url={instance.iconUrl} fallback={<Boxes size={19} />} />
}

function versionGroup(id: string): string {
  const match = id.match(/^(\d+\.\d+)/)
  return match ? `${match[1]}.x` : '其他'
}

export function HomePage() {
  const settings = useLauncher((state) => state.settings)
  const appInfo = useLauncher((state) => state.appInfo)
  const accounts = useLauncher((state) => state.accounts)
  const installed = useLauncher((state) => state.installed)
  const instances = useLauncher((state) => state.instances)
  const installedLoading = useLauncher((state) => state.installedLoading)
  const selectedId = useLauncher((state) => state.selectedVersionId)
  const selectedInstanceId = useLauncher((state) => state.selectedInstanceId)
  const javaList = useLauncher((state) => state.javaList)
  const tasks = useLauncher((state) => state.tasks)
  const launch = useLauncher((state) => state.launch)
  const logs = useLauncher((state) => state.logs)
  const setPage = useLauncher((state) => state.setPage)
  const setAccountModalOpen = useLauncher((state) => state.setAccountModalOpen)
  const setVersionPickerOpen = useLauncher((state) => state.setVersionPickerOpen)
  const startLaunch = useLauncher((state) => state.startLaunch)
  const startInstance = useLauncher((state) => state.startInstance)
  const cancelLaunch = useLauncher((state) => state.cancelLaunch)
  const stopGame = useLauncher((state) => state.stopGame)
  const selectVersion = useLauncher((state) => state.selectVersion)
  const selectInstance = useLauncher((state) => state.selectInstance)
  const refreshInstalled = useLauncher((state) => state.refreshInstalled)
  const refreshJava = useLauncher((state) => state.refreshJava)
  const pauseTask = useLauncher((state) => state.pauseTask)
  const resumeTask = useLauncher((state) => state.resumeTask)
  const cancelTask = useLauncher((state) => state.cancelTask)
  const clearFinishedTasks = useLauncher((state) => state.clearFinishedTasks)
  const createLoaderInstance = useLauncher((state) => state.createLoaderInstance)
  const importModpack = useLauncher((state) => state.importModpack)
  const removeVersion = useLauncher((state) => state.removeVersion)
  const openConsole = useLauncher((state) => state.openConsole)
  const toast = useLauncher((state) => state.toast)

  const [stopOpen, setStopOpen] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(
    () => localStorage.getItem('ccl-home-activity-collapsed') !== 'false'
  )
  const [listMode, setListMode] = useState<'instances' | 'versions'>('instances')
  const [pendingVersionDelete, setPendingVersionDelete] = useState<string | null>(null)
  const [deletingVersion, setDeletingVersion] = useState(false)
  const [previewInstance, setPreviewInstance] = useState<InstanceSummary | null>(null)
  const [loaderOpen, setLoaderOpen] = useState(false)
  const [loaderGameVersion, setLoaderGameVersion] = useState('')
  const [loaderTarget, setLoaderTarget] = useState<'fabric' | 'quilt' | 'forge' | 'neoforge'>('fabric')
  const [loaderVersion, setLoaderVersion] = useState('')
  const [loaderName, setLoaderName] = useState('')
  const [modsInstance, setModsInstance] = useState<InstanceSummary | null>(null)
  const [cleanupOpen, setCleanupOpen] = useState(false)
  const [disk, setDisk] = useState({ freeGb: 0, totalGb: 0 })

  const account = accounts.accounts.find((item) => item.id === accounts.activeId) ?? null
  const selectedInstance = instances.find((instance) => instance.id === selectedInstanceId) ?? null
  const sortedInstances = useMemo(
    () =>
      [...instances].sort(
        (a, b) =>
          (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0) ||
          a.name.localeCompare(b.name, 'zh-CN')
      ),
    [instances]
  )
  const managedVersions = useMemo(() => {
    // 原版实例也会接管对应的基础版本，避免同一份游戏在版本列表里重复出现。
    const current = (settings?.gameDir ?? '').toLowerCase()
    return new Set(
      instances
        .filter(
          (instance) =>
            (instance.external?.baseDir ?? instance.baseDir ?? settings?.gameDir ?? '').toLowerCase() ===
            current
        )
        .map((instance) => instance.versionId)
    )
  }, [instances, settings?.gameDir])
  const visibleInstalled = useMemo(
    () => installed.filter((version) => !managedVersions.has(version.id)),
    [installed, managedVersions]
  )
  const baseVersions = useMemo(
    () => installed.filter((version) => !version.loader).map((version) => version.id),
    [installed]
  )
  const selected =
    visibleInstalled.find((version) => version.id === selectedId && !selectedInstance) ?? null
  const installTask = selectedInstance
    ? undefined
    : tasks.find(
        (task) => task.kind === 'install' && task.versionId === selectedId && (task.status === 'running' || task.status === 'paused')
      )
  const launchBusy = launch.status === 'preparing' || launch.status === 'starting'
  const running = launch.status === 'running'
  const launchActive = launchBusy || running
  const targetJavaMajor = selectedInstance?.javaMajor ?? selected?.javaMajor ?? null
  const java = pickJava(javaList, targetJavaMajor, settings?.javaPath ?? null)

  useEffect(() => {
    let alive = true
    const readDisk = async () => {
      try {
        const space = await window.ccl.app.diskSpace()
        if (alive) setDisk(space)
      } catch {
        /* 磁盘信息不可用时保留上一次值 */
      }
    }
    void readDisk()
    const timer = window.setInterval(readDisk, 30_000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [])

  const openLoaderModal = () => {
    const preferred = selected && !selected.loader ? selected.id : baseVersions[0] ?? ''
    setLoaderGameVersion(preferred)
    setLoaderTarget('fabric')
    setLoaderVersion('')
    setLoaderName('')
    setLoaderOpen(true)
  }

  const submitLoader = () => {
    if (!loaderGameVersion) {
      toast('info', '请先安装一个原版版本')
      return
    }
    setLoaderOpen(false)
    void createLoaderInstance({
      gameVersion: loaderGameVersion,
      loader: loaderTarget,
      loaderVersion: loaderVersion.trim() || null,
      name: loaderName.trim() || undefined
    })
  }

  const javaText = targetJavaMajor
    ? java
      ? `Java ${java.major}`
      : settings?.autoJava
        ? '自动准备'
        : `缺少 Java ${targetJavaMajor}`
    : java
      ? `Java ${java.major}`
      : '检测中'
  const javaWarning = Boolean(targetJavaMajor && !java && !settings?.autoJava)

  const targetLoader = selectedInstance?.loader ?? selected?.loader ?? null
  const targetLastPlayed = selectedInstance?.lastPlayed ?? selected?.lastPlayed ?? null
  const targetMeta = selectedInstance
    ? `Minecraft ${selectedInstance.gameVersion} · ${selectedInstance.modCount} 个模组 · ${relativeTime(selectedInstance.lastPlayed)}`
    : selected
      ? `Minecraft ${selected.id} · ${versionTypeLabel(selected.type)} · ${relativeTime(selected.lastPlayed)}`
      : '安装一个版本，或导入一个整合包'

  const runningName = launch.instanceId
    ? instances.find((instance) => instance.id === launch.instanceId)?.name
    : launch.versionId
      ? `Minecraft ${launch.versionId}`
      : '游戏'

  const launchLabel = installTask
    ? '正在安装游戏文件'
    : launchBusy
      ? launch.stage || '正在准备游戏'
      : running
        ? '结束游戏'
        : !account
          ? '添加账户后启动'
          : !selected && !selectedInstance
            ? instances.length
              ? '选择一个实例'
              : '获取一个游戏版本'
            : '启动游戏'

  const launchSub = installTask
    ? `${installTask.stage} · ${Math.round(installTask.progress)}%`
    : launchBusy
      ? `${launch.message || '正在检查启动环境'} · ${Math.round(launch.progress ?? 0)}%`
      : running
        ? `${runningName} 正在运行${launch.pid ? ` · PID ${launch.pid}` : ''}`
        : !account
          ? '离线或微软账户都可以启动'
          : !selected && !selectedInstance
            ? '从下载中心或实例页开始'
            : `${formatMemory(settings?.maxMemoryMb ?? 0)} 内存 · ${selectedInstance ? `Minecraft ${selectedInstance.gameVersion}` : selected?.id ?? ''}`

  const progressPercent = installTask ? installTask.progress : launchBusy ? (launch.progress ?? 0) : 0
  const targetStatus = running ? '运行中' : launchBusy ? '准备中' : installTask ? '安装中' : '就绪'
  const downloadSpeed =
    tasks
      .filter((task) => task.status === 'running')
      .reduce((total, task) => total + (task.detail?.speed ?? 0), 0) +
    (launch.status === 'running' ? launch.speed ?? 0 : 0)

  const handleLaunch = () => {
    if (installTask) {
      setPage('downloads')
      return
    }
    if (launchBusy) {
      void cancelLaunch()
      return
    }
    if (running) {
      setStopOpen(true)
      return
    }
    if (!account) {
      setAccountModalOpen(true)
      return
    }
    if (selectedInstance) {
      void startInstance(selectedInstance.id)
      return
    }
    if (!selected) {
      setPage(instances.length ? 'instances' : 'downloads')
      return
    }
    void startLaunch(selected.id)
  }

  const handleStop = async () => {
    setStopping(true)
    await stopGame()
    setStopping(false)
    setStopOpen(false)
  }

  const handleQuickPlay = (versionId: string) => {
    if (!account) {
      setAccountModalOpen(true)
      return
    }
    if (launchActive) {
      toast('info', '已有游戏正在运行', '请先结束当前进程')
      return
    }
    if (versionId !== selectedId) selectVersion(versionId)
    void startLaunch(versionId)
  }

  const handleQuickInstance = (instance: InstanceSummary) => {
    if (!account) {
      setAccountModalOpen(true)
      return
    }
    if (launchActive) {
      toast('info', '已有游戏正在运行', '请先结束当前进程')
      return
    }
    if (instance.id !== selectedInstanceId) selectInstance(instance.id)
    void startInstance(instance.id)
  }

  const chooseTarget = () => {
    if (visibleInstalled.length || instances.length) setVersionPickerOpen(true)
    else setPage('downloads')
  }

  const exportVersion = async (id: string) => {
    try {
      const saved = await window.ccl.versions.exportJson(id)
      if (saved) toast('success', '版本配置已导出', `${id}.json`)
    } catch (error) {
      toast('error', '无法导出配置', cleanError(error))
    }
  }

  const confirmDeleteVersion = async () => {
    if (!pendingVersionDelete) return
    setDeletingVersion(true)
    const ok = await removeVersion(pendingVersionDelete)
    setDeletingVersion(false)
    if (ok) setPendingVersionDelete(null)
  }

  const openLogFile = async () => {
    try {
      const path = await window.ccl.logs.latestPath()
      if (path) {
        await window.ccl.app.openPath(path)
      } else {
        await window.ccl.logs.openFolder()
      }
    } catch (error) {
      toast('error', '无法打开日志', cleanError(error))
    }
  }

  useShortcuts({
    onLaunch: handleLaunch,
    onInstances: () => setPage('instances'),
    onDownloads: () => setPage('downloads'),
    onSettings: () => setPage('settings'),
    onConsole: () => openConsole('launch')
  })

  const toggleRightPanel = () => {
    setRightCollapsed((value) => {
      localStorage.setItem('ccl-home-activity-collapsed', String(!value))
      return !value
    })
  }

  const copyLogs = async () => {
    if (!logs.length) {
      toast('info', '还没有可复制的日志')
      return
    }
    if (await copyText(logs.map((line) => line.text).join('\n'))) {
      toast('success', '日志已复制')
    } else {
      toast('error', '复制失败', '请打开控制台后手动选择')
    }
  }

  const focusIcon = selectedInstance ? (
    instanceIcon(selectedInstance)
  ) : selected ? (
    <BlockIcon version={selected} size={46} />
  ) : (
    <Gamepad2 size={24} />
  )

  const focusName = selectedInstance?.name ?? selected?.id ?? '选择一个世界'
  const focusMeta = selectedInstance
    ? `MINECRAFT ${selectedInstance.gameVersion} · ${(selectedInstance.loader === 'vanilla' ? 'VANILLA' : loaderLabel(selectedInstance.loader) ?? '').toUpperCase()} · ${selectedInstance.modCount} MODS`
    : selected
      ? `MINECRAFT ${selected.id.toUpperCase()} · ${(loaderLabel(selected.loader) ?? versionTypeLabel(selected.type)).toUpperCase()}`
      : 'NO TARGET SELECTED'

  return (
    <div className="page page--home home-simple">
      <header className="home-header home-header--simple">
        <div className="home-header-copy">
          <span className="eyebrow">Workspace / 启动</span>
          <h1>
            {greeting()}
            {account ? `，${account.name}` : '，旅人'}
          </h1>
          <p>
            从原版到整合包，今天想进入哪个世界？
            <span className="home-header-stats">
              {instances.length} 实例 · {visibleInstalled.length} 版本
            </span>
            <PlaytimeBadge />
          </p>
        </div>
      </header>

      <div className="home-simple-body">
        <div className="home-simple-main">
          <section className="card home-target-card">
            <div className="home-target-head">
              <span className="mono-label">Current target</span>
              <span
                className={`focus-status ${running ? 'is-live' : launchBusy || installTask ? 'is-busy' : ''}`}
              >
                {targetStatus}
              </span>
            </div>

            <div className="home-target-identity">
              <div className="home-target-icon">{focusIcon}</div>
              <div className="home-target-copy">
                <h2 title={focusName}>{focusName}</h2>
                <p>{targetMeta}</p>
              </div>
              <button type="button" className="focus-switch" onClick={chooseTarget}>
                切换目标
                <ChevronDown size={12} />
              </button>
            </div>

            <div className="home-target-facts">
              <button
                type="button"
                className="home-target-fact"
                onClick={() => setAccountModalOpen(true)}
                title="管理账户"
              >
                {account ? (
                  <Avatar
                    name={account.name}
                    seed={account.uuid}
                    uuid={account.uuid}
                    type={account.type}
                    size={24}
                  />
                ) : (
                  <span className="home-target-fact-icon">
                    <UserRound size={17} />
                  </span>
                )}
                <span className="home-target-fact-copy">
                  <em>账户</em>
                  <strong>{account?.name ?? '添加账户'}</strong>
                </span>
              </button>
              <button
                type="button"
                className="home-target-fact"
                onClick={() => setPage('settings')}
                title="在设置中管理 Java"
              >
                <span className="home-target-fact-icon">
                  <Coffee size={16} />
                </span>
                <span className="home-target-fact-copy">
                  <em>Java</em>
                  <strong className={javaWarning ? 'is-warning' : ''}>{javaText}</strong>
                </span>
              </button>
              <button
                type="button"
                className="home-target-fact"
                onClick={() => setPage('settings')}
                title="在设置中调整内存"
              >
                <span className="home-target-fact-icon">
                  <MemoryStick size={16} />
                </span>
                <span className="home-target-fact-copy">
                  <em>内存</em>
                  <strong>{formatMemory(settings?.maxMemoryMb ?? 0)}</strong>
                </span>
              </button>
            </div>

            <button
              type="button"
              className={`launch-cta home-launch ${launchBusy || installTask ? 'is-busy' : ''} ${running ? 'is-running' : ''}`}
              onClick={handleLaunch}
              title={launchBusy ? '点击取消启动' : running ? '结束游戏进程' : undefined}
            >
              {(launchBusy || installTask) && (
                <span
                  className="launch-cta-progress"
                  style={{ width: `${Math.max(progressPercent, 4)}%` }}
                />
              )}
              <span className="launch-cta-copy">
                <strong>{launchLabel}</strong>
                <small>{launchSub}</small>
              </span>
              <span className="launch-cta-tail">
                {running ? (
                  <>
                    结束
                    <Square size={13} fill="currentColor" />
                  </>
                ) : launchBusy ? (
                  <>
                    取消
                    <Square size={13} />
                  </>
                ) : installTask ? (
                  <>
                    查看
                    <ChevronRight size={14} />
                  </>
                ) : (
                  <>
                    启动
                    <Play size={13} fill="currentColor" />
                  </>
                )}
              </span>
            </button>

            {launch.status === 'error' && launch.error ? (
              <div className="launch-error">
                <span>{launch.error}</span>
                <button type="button" className="link-button" onClick={() => openConsole('launch')}>
                  查看日志
                </button>
              </div>
            ) : (
              <p className="launch-hint">
                {launchBusy
                  ? '点击按钮可取消本次启动，已下载的文件会保留'
                  : running
                    ? '关闭启动器不会结束游戏，可随时回到这里结束进程'
                    : installTask
                      ? '游戏文件准备完成后即可一键启动'
                      : account
                        ? `启动时自动检查 Java 与游戏文件完整性${targetLoader ? ` · ${loaderLabel(targetLoader) ?? targetLoader}` : ''}`
                        : '推荐登录微软正版账户，也可以使用离线账户'}
              </p>
            )}
          </section>

          <section className="card home-library-card">
            <header className="home-library-head">
              <div className="home-library-tabs" role="tablist" aria-label="版本与实例">
                <button
                  type="button"
                  role="tab"
                  aria-selected={listMode === 'instances'}
                  className={listMode === 'instances' ? 'is-active' : ''}
                  onClick={() => setListMode('instances')}
                >
                  实例 <span>{instances.length}</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={listMode === 'versions'}
                  className={listMode === 'versions' ? 'is-active' : ''}
                  onClick={() => setListMode('versions')}
                >
                  版本 <span>{visibleInstalled.length}</span>
                </button>
              </div>
              <div className="home-library-actions">
                {listMode === 'instances' ? (
                  <>
                    <button type="button" onClick={() => void importModpack()}>
                      <Upload size={12} />
                      导入整合包
                    </button>
                    <button type="button" onClick={() => setPage('instances')}>
                      管理实例
                      <ChevronRight size={12} />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => window.dispatchEvent(new Event('windletter:version-folders'))}
                      title="切换版本文件夹"
                    >
                      <FolderOpen size={12} />
                      文件夹
                    </button>
                    <button type="button" onClick={() => void refreshInstalled()} disabled={installedLoading}>
                      <RefreshCw size={12} className={installedLoading ? 'spin' : ''} />
                      刷新
                    </button>
                    <button
                      type="button"
                      onClick={() => setCleanupOpen(true)}
                      title="清理不再被实例或启动档案使用的版本"
                    >
                      <Trash2 size={12} />
                      清理
                    </button>
                    <button type="button" onClick={openLoaderModal}>
                      安装加载器
                    </button>
                    <button type="button" onClick={() => setPage('downloads')}>
                      <Plus size={12} />
                      安装版本
                    </button>
                  </>
                )}
              </div>
            </header>

            {listMode === 'instances' ? (
              sortedInstances.length > 0 ? (
                <div className="home-instance-list">
                  {sortedInstances.map((instance) => {
                    const isSelected = instance.id === selectedInstanceId
                    const isRunning = launchActive && launch.instanceId === instance.id
                    return (
                      <article
                        key={instance.id}
                        className={`home-instance-row ${isSelected ? 'is-selected' : ''}`}
                        onClick={() => selectInstance(instance.id)}
                      >
                        <span className="home-instance-icon">{instanceIcon(instance)}</span>
                        <div className="home-instance-copy">
                          <strong>{instance.name}</strong>
                          <small>
                            Minecraft {instance.gameVersion} · {loaderLabel(instance.loader) ?? '原版'} ·{' '}
                            {instance.modCount} 模组 · {relativeTime(instance.lastPlayed)}
                          </small>
                        </div>
                        <div className="home-instance-actions">
                          <button
                            type="button"
                            className="button button--soft button--xs"
                            disabled={launchActive}
                            onClick={(event) => {
                              event.stopPropagation()
                              if (isRunning) return
                              handleQuickInstance(instance)
                            }}
                          >
                            {isRunning ? (
                              <Square size={11} fill="currentColor" />
                            ) : (
                              <Play size={11} fill="currentColor" />
                            )}
                            {isRunning ? '运行中' : '启动'}
                          </button>
                          <button
                            type="button"
                            className="icon-button"
                            title="管理模组"
                            onClick={(event) => {
                              event.stopPropagation()
                              setModsInstance(instance)
                            }}
                          >
                            <Package size={14} />
                          </button>
                          <button
                            type="button"
                            className="icon-button"
                            title="打开实例目录"
                            onClick={(event) => {
                              event.stopPropagation()
                              void window.ccl.instances.openFolder(instance.id).catch((error) => {
                                toast('error', '无法打开实例目录', cleanError(error))
                              })
                            }}
                          >
                            <FolderOpen size={14} />
                          </button>
                          <button
                            type="button"
                            className="icon-button"
                            title="管理实例"
                            onClick={(event) => {
                              event.stopPropagation()
                              setPage('instances')
                            }}
                          >
                            <ChevronRight size={14} />
                          </button>
                        </div>
                      </article>
                    )
                  })}
                </div>
              ) : (
                <div className="home-list-empty">
                  <Boxes size={20} />
                  <strong>还没有整合包实例</strong>
                  <span>从 Modrinth 安装，或导入一个本地整合包。</span>
                  <div>
                    <button type="button" className="button button--soft button--sm" onClick={() => setPage('instances')}>
                      从 Modrinth 安装
                    </button>
                    <button type="button" className="button button--soft button--sm" onClick={() => void importModpack()}>
                      导入文件
                    </button>
                  </div>
                </div>
              )
            ) : visibleInstalled.length > 0 ? (
              <LibraryTable
                versions={visibleInstalled}
                selectedId={selectedInstance ? null : selectedId}
                onSelect={selectVersion}
                onLaunch={handleQuickPlay}
                onExport={(id) => void exportVersion(id)}
                onDelete={(id) => setPendingVersionDelete(id)}
                onOpenFolder={(id) => {
                  void window.ccl.versions.openFolder(id).catch((error) => {
                    toast('error', '无法打开版本文件夹', cleanError(error))
                  })
                }}
              />
            ) : (
              <div className="home-list-empty">
                <Gamepad2 size={20} />
                <strong>还没有独立版本</strong>
                <span>安装一个原版，或在整合包页下载整合包。</span>
                <div>
                  <button type="button" className="button button--primary button--sm" onClick={() => setPage('downloads')}>
                    去下载
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>

        <RightPanel
          isCollapsed={rightCollapsed}
          onToggleCollapse={toggleRightPanel}
          tasks={tasks}
          logs={logs}
          onOpenConsole={() => openConsole('launch')}
          onCopyLog={() => void copyLogs()}
          onOpenLogFile={() => void openLogFile()}
          onPauseTask={(id) => void pauseTask(id)}
          onResumeTask={(id) => void resumeTask(id)}
          onCancelTask={(id) => void cancelTask(id)}
          onClearFinished={clearFinishedTasks}
        />
      </div>

      <footer className="home-statusbar">
        <span>
          <HardDrive size={11} />
          磁盘剩余{' '}
          <strong>
            {disk.freeGb > 0 && disk.totalGb > 0
              ? `${disk.freeGb} / ${disk.totalGb} GB`
              : '—'}
          </strong>
        </span>
        <span>
          <MemoryStick size={11} />
          游戏内存 <strong>{formatMemory(settings?.maxMemoryMb ?? 0)}</strong>
        </span>
        <span>
          <Download size={11} />
          下载速度 <strong>{downloadSpeed > 0 ? formatSpeed(downloadSpeed) : '—'}</strong>
        </span>
      </footer>
      <ConfirmDialog
        open={stopOpen}
        title="结束游戏"
        message={
          <>
            确定要结束 <strong>{runningName}</strong> 吗？
            <br />
            未保存的游戏进度可能会丢失。
          </>
        }
        confirmLabel="结束进程"
        danger
        busy={stopping}
        onConfirm={() => void handleStop()}
        onCancel={() => setStopOpen(false)}
      />

      <ConfirmDialog
        open={pendingVersionDelete !== null}
        title="删除版本"
        message={
          <>
            确定删除 <strong>{pendingVersionDelete}</strong> 的版本文件吗？
            <br />
            共享的原版文件与运行库不会被删除；正在被实例使用的版本需要先删除实例。
          </>
        }
        confirmLabel="删除"
        danger
        busy={deletingVersion}
        onConfirm={() => void confirmDeleteVersion()}
        onCancel={() => setPendingVersionDelete(null)}
      />

      <Modal
        open={previewInstance !== null}
        onClose={() => setPreviewInstance(null)}
        title={previewInstance?.name ?? '实例详情'}
        subtitle="快速预览"
        icon={<Boxes size={18} />}
        size="md"
      >
        {previewInstance && (
          <div className="instance-preview">
            <p className="instance-preview-summary">
              {previewInstance.summary || '这个实例还没有填写简介。'}
            </p>
            <div className="instance-preview-facts">
              <div>
                <span>Minecraft</span>
                <strong>{previewInstance.gameVersion}</strong>
              </div>
              <div>
                <span>加载器</span>
                <strong>
                  {loaderLabel(previewInstance.loader) ?? '原版'}
                  {previewInstance.loaderVersion ? ` ${previewInstance.loaderVersion}` : ''}
                </strong>
              </div>
              <div>
                <span>模组</span>
                <strong>{previewInstance.modCount}</strong>
              </div>
              <div>
                <span>Java</span>
                <strong>
                  {previewInstance.javaMajor ? `Java ${previewInstance.javaMajor}` : '自动'}
                </strong>
              </div>
              <div>
                <span>上次启动</span>
                <strong>{relativeTime(previewInstance.lastPlayed)}</strong>
              </div>
              <div>
                <span>安装时间</span>
                <strong>{formatDate(previewInstance.installedAt)}</strong>
              </div>
            </div>
            <p className="instance-preview-path" title={previewInstance.versionId}>
              版本配置：{previewInstance.versionId}
            </p>
            <div className="instance-preview-actions">
              <button
                type="button"
                className="button button--primary button--sm"
                onClick={() => {
                  const instance = previewInstance
                  setPreviewInstance(null)
                  handleQuickInstance(instance)
                }}
              >
                <Play size={12} fill="currentColor" />
                启动
              </button>
              <button
                type="button"
                className="button button--soft button--sm"
                onClick={() => {
                  void window.ccl.instances.openFolder(previewInstance.id).catch((error) => {
                    toast('error', '无法打开实例目录', cleanError(error))
                  })
                }}
              >
                <FolderOpen size={12} />
                打开目录
              </button>
              <button
                type="button"
                className="button button--soft button--sm"
                onClick={() => {
                  const instance = previewInstance
                  setPreviewInstance(null)
                  setModsInstance(instance)
                }}
              >
                <Package size={12} />
                管理模组
              </button>
              <button
                type="button"
                className="button button--ghost button--sm"
                onClick={() => {
                  setPreviewInstance(null)
                  setPage('instances')
                }}
              >
                管理实例
                <ChevronRight size={12} />
              </button>
            </div>
          </div>
        )}
      </Modal>

      <ModsModal
        open={modsInstance !== null}
        instance={modsInstance}
        onClose={() => setModsInstance(null)}
        onGoSettings={() => {
          setModsInstance(null)
          setPage('settings')
        }}
      />

      <VersionCleanupModal open={cleanupOpen} onClose={() => setCleanupOpen(false)} />

      <Modal
        open={loaderOpen}
        onClose={() => setLoaderOpen(false)}
        title="安装加载器"
        subtitle="在已安装的原版上创建一个独立实例"
        icon={<Boxes size={18} />}
        size="md"
      >
        <div className="loader-form">
          {baseVersions.length === 0 ? (
            <p className="loader-form-empty">
              还没有原版版本。请先在下载页安装一个原版，再回来安装加载器。
            </p>
          ) : (
            <>
              <label className="form-field">
                <span className="form-label">Minecraft 版本</span>
                <select
                  className="workbench-select"
                  value={loaderGameVersion}
                  onChange={(event) => setLoaderGameVersion(event.target.value)}
                >
                  {baseVersions.map((version) => (
                    <option key={version} value={version}>
                      {version}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span className="form-label">加载器</span>
                <select
                  className="workbench-select"
                  value={loaderTarget}
                  onChange={(event) =>
                    setLoaderTarget(event.target.value as typeof loaderTarget)
                  }
                >
                  <option value="fabric">Fabric</option>
                  <option value="quilt">Quilt</option>
                  <option value="forge">Forge</option>
                  <option value="neoforge">NeoForge</option>
                </select>
              </label>
              <label className="form-field">
                <span className="form-label">加载器版本（可选）</span>
                <div className="text-input">
                  <input
                    value={loaderVersion}
                    placeholder="留空使用该 Minecraft 版本的最新推荐"
                    spellCheck={false}
                    onChange={(event) => setLoaderVersion(event.target.value)}
                  />
                </div>
              </label>
              <label className="form-field">
                <span className="form-label">实例名称（可选）</span>
                <div className="text-input">
                  <input
                    value={loaderName}
                    placeholder={`${loaderGameVersion} ${loaderTarget}`}
                    spellCheck={false}
                    maxLength={80}
                    onChange={(event) => setLoaderName(event.target.value)}
                  />
                </div>
              </label>
              <div className="loader-form-actions">
                <button type="button" className="button button--ghost button--sm" onClick={() => setLoaderOpen(false)}>
                  取消
                </button>
                <button type="button" className="button button--primary button--sm" onClick={submitLoader}>
                  创建实例
                </button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  )
}
