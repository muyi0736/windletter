import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Boxes,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Gamepad2,
  Info,
  LayoutGrid,
  List,
  Package,
  Play,
  Plus,
  RefreshCw,
  Server,
  Square,
  Trash2,
  Upload
} from 'lucide-react'
import type { InstanceSummary, JavaInfo } from '@shared/types'
import { useLauncher } from '../store'
import { PlaytimeBadge } from '../components/PlaytimeBadge'
import {
  cleanError,
  formatDate,
  formatMemory,
  greeting,
  loaderKind,
  loaderLabel,
  relativeTime,
  versionTypeLabel
} from '../lib/format'
import { copyText } from '../lib/clipboard'
import { useShortcuts } from '../lib/shortcuts'
import { RemoteIcon } from '../components/RemoteIcon'
import { BlockIcon } from '../components/visuals'
import { ConfirmDialog, Modal } from '../components/ui'
import { LeftPanel, type RecentEntry } from '../components/LeftPanel'
import { LibraryTable } from '../components/LibraryTable'
import { ModsModal } from '../components/ModsModal'
import { VersionCleanupModal } from '../components/VersionCleanupModal'
import { ClassicRightPanel as RightPanel } from '../components/ClassicRightPanel'

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

export function HomePageClassic() {
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
  const manifest = useLauncher((state) => state.manifest)
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
  const installVersion = useLauncher((state) => state.installVersion)
  const createLoaderInstance = useLauncher((state) => state.createLoaderInstance)
  const importModpack = useLauncher((state) => state.importModpack)
  const removeVersion = useLauncher((state) => state.removeVersion)
  const openConsole = useLauncher((state) => state.openConsole)
  const toast = useLauncher((state) => state.toast)

  const [stopOpen, setStopOpen] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(
    () => localStorage.getItem('ccl-workbench-right-collapsed') === 'true'
  )
  const [viewMode, setViewMode] = useState<'table' | 'grid'>(() =>
    localStorage.getItem('ccl-workbench-view') === 'grid' ? 'grid' : 'table'
  )
  const [filterVersion, setFilterVersion] = useState('all')
  const [filterLoader, setFilterLoader] = useState('all')
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
  const [pinned, setPinned] = useState<string[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('ccl-pinned-launches') ?? '[]')
      return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : []
    } catch {
      return []
    }
  })
  const [disk, setDisk] = useState({ freeGb: 0, totalGb: 0 })
  const fitFrameRef = useRef<HTMLDivElement>(null)
  const fitContentRef = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState({ scale: 1, offsetX: 0, designWidth: 1680, tallCanvas: false })

  useLayoutEffect(() => {
    const frame = fitFrameRef.current
    const content = fitContentRef.current
    if (!frame || !content) return
    const update = () => {
      const availableWidth = frame.clientWidth
      const availableHeight = frame.clientHeight
      const naturalHeight = Math.max(1, content.scrollHeight)
      if (availableWidth <= 0 || availableHeight <= 0) return
      const tallCanvas = availableHeight / availableWidth > 0.85
      const designWidth = tallCanvas ? availableWidth : 1680
      const scale = Math.max(
        0.1,
        Math.min(1, availableWidth / designWidth, availableHeight / naturalHeight)
      )
      const offsetX = Math.max(0, (availableWidth - designWidth * scale) / 2)
      setFit((previous) =>
        Math.abs(previous.scale - scale) < 0.001 &&
        Math.abs(previous.offsetX - offsetX) < 0.5 &&
        previous.designWidth === designWidth &&
        previous.tallCanvas === tallCanvas
          ? previous
          : { scale, offsetX, designWidth, tallCanvas }
      )
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(frame)
    observer.observe(content)
    return () => observer.disconnect()
  }, [])

  const account = accounts.accounts.find((item) => item.id === accounts.activeId) ?? null
  const selectedInstance = instances.find((instance) => instance.id === selectedInstanceId) ?? null
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
  const pinnedKeys = useMemo(() => new Set(pinned), [pinned])
  const baseVersions = useMemo(
    () => installed.filter((version) => !version.loader).map((version) => version.id),
    [installed]
  )
  const versionGroups = useMemo(
    () =>
      [...new Set(visibleInstalled.map((version) => versionGroup(version.id)))].sort(
        (a, b) => b.localeCompare(a, undefined, { numeric: true })
      ),
    [visibleInstalled]
  )
  const loaderOptions = useMemo(
    () => [...new Set(visibleInstalled.map((version) => loaderKind(version.loader ?? 'vanilla')))].sort(),
    [visibleInstalled]
  )
  const filteredVersions = useMemo(
    () =>
      visibleInstalled.filter((version) => {
        if (filterVersion !== 'all' && versionGroup(version.id) !== filterVersion) return false
        if (filterLoader !== 'all' && loaderKind(version.loader ?? 'vanilla') !== filterLoader) {
          return false
        }
        return true
      }),
    [visibleInstalled, filterVersion, filterLoader]
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

  const latest = manifest?.latest.release ?? null
  const latestInstalled = latest ? installed.some((version) => version.id === latest) : false
  const latestEntry = manifest?.versions.find((version) => version.id === latest) ?? null
  const latestTask = latest
    ? tasks.find(
        (task) => task.kind === 'install' && task.versionId === latest && (task.status === 'running' || task.status === 'paused')
      )
    : undefined

  const recent = useMemo<RecentEntry[]>(() => {
    const entries: RecentEntry[] = []
    for (const instance of instances) {
      entries.push({
        key: `instance-${instance.id}`,
        kind: 'instance',
        id: instance.id,
        name: instance.name,
        meta: `Minecraft ${instance.gameVersion} · ${instance.modCount} 模组`,
        lastPlayed: instance.lastPlayed,
        iconUrl: instance.iconUrl,
        loader: instance.loader
      })
    }
    for (const version of visibleInstalled) {
      entries.push({
        key: `version-${version.id}`,
        kind: 'version',
        id: version.id,
        name: version.id,
        meta: `${versionTypeLabel(version.type)} · ${loaderLabel(version.loader) ?? '原版'}`,
        lastPlayed: version.lastPlayed,
        loader: version.loader,
        type: version.type
      })
    }
    return entries
      .filter((entry) => entry.lastPlayed || pinnedKeys.has(entry.key))
      .sort((a, b) => {
        const pinA = pinnedKeys.has(a.key) ? 1 : 0
        const pinB = pinnedKeys.has(b.key) ? 1 : 0
        if (pinA !== pinB) return pinB - pinA
        return (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0)
      })
      .slice(0, 5)
  }, [instances, visibleInstalled, pinnedKeys])

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

  const togglePin = (key: string) => {
    setPinned((current) => {
      const next = current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key]
      localStorage.setItem('ccl-pinned-launches', JSON.stringify(next))
      return next
    })
  }

  const changeView = (mode: 'table' | 'grid') => {
    setViewMode(mode)
    localStorage.setItem('ccl-workbench-view', mode)
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

  const openGameDir = () => {
    if (!settings?.gameDir) return
    void window.ccl.app.openPath(settings.gameDir).catch((error) => {
      toast('error', '无法打开游戏目录', cleanError(error))
    })
  }

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

  const handleRecent = (entry: RecentEntry) => {
    if (!account) {
      setAccountModalOpen(true)
      return
    }
    if (launchActive) {
      toast('info', '已有游戏正在运行', '请先结束当前进程')
      return
    }
    if (entry.kind === 'instance') {
      if (entry.id !== selectedInstanceId) selectInstance(entry.id)
      void startInstance(entry.id)
    } else {
      if (entry.id !== selectedId) selectVersion(entry.id)
      void startLaunch(entry.id)
    }
  }

  const handleLatestAction = () => {
    if (!latest) return
    if (latestInstalled) {
      selectVersion(latest)
      toast('info', `已切换至 Minecraft ${latest}`)
      return
    }
    void installVersion(latest)
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
      localStorage.setItem('ccl-workbench-right-collapsed', String(!value))
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
    <div className="page page--home home-classic-fit" ref={fitFrameRef}>
      <div
        className={`home-fit-content ${fit.designWidth < 1240 ? 'is-narrow-canvas' : ''} ${fit.tallCanvas ? 'is-tall-canvas' : ''}`}
        ref={fitContentRef}
        style={{
          transform: `translateX(${fit.offsetX}px) scale(${fit.scale})`,
          width: fit.designWidth
        }}
      >
        <header className="home-header">
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
        <div className="home-header-actions">
          <button type="button" className="button button--soft" onClick={() => setPage('instances')}>
            <Boxes size={14} />
            实例
          </button>
          <button type="button" className="button button--soft" onClick={() => setPage('servers')}>
            <Server size={14} />
            服务器
          </button>
          <button type="button" className="button button--primary" onClick={() => setPage('downloads')}>
            <Plus size={14} />
            安装版本
          </button>
        </div>
      </header>

      <div className={`workbench-layout ${rightCollapsed ? 'is-right-collapsed' : ''}`}>
        <LeftPanel
          account={account}
          accountCount={accounts.accounts.length}
          onManageAccount={() => setAccountModalOpen(true)}
          recent={recent}
          pinnedKeys={pinnedKeys}
          onTogglePin={togglePin}
          onLaunchRecent={handleRecent}
          java={java}
          requiredJava={targetJavaMajor}
          memoryMb={settings?.maxMemoryMb ?? 0}
          onJavaManage={() => setPage('settings')}
          onJavaDetect={() => void refreshJava(true)}
          latest={
            latest
              ? {
                  id: latest,
                  installed: latestInstalled,
                  installing: Boolean(latestTask),
                  progress: latestTask?.progress ?? 0,
                  date: latestEntry ? formatDate(latestEntry.releaseTime) : null
                }
              : null
          }
          onLatestAction={handleLatestAction}
          onOpenFolder={openGameDir}
          onOpenConsole={() => openConsole('launch')}
          onOpenSettings={() => setPage('settings')}
        />

        <div className="center-panel">
          <section className="focus-panel">
            <div className="focus-top">
              <span className="mono-label">Current target</span>
              <span
                className={`focus-status ${running ? 'is-live' : launchBusy || installTask ? 'is-busy' : ''}`}
              >
                {targetStatus}
              </span>
            </div>

            <div className="focus-identity">
              <div className="focus-icon">{focusIcon}</div>
              <div className="focus-name">
                <h2 title={focusName}>{focusName}</h2>
                <p>{focusMeta}</p>
              </div>
              <button type="button" className="focus-switch" onClick={chooseTarget}>
                切换目标
                <ChevronDown size={12} />
              </button>
            </div>

            <div className="focus-facts">
              <div>
                <span>加载器</span>
                <strong>{targetLoader ? loaderLabel(targetLoader) ?? targetLoader : '原版'}</strong>
              </div>
              <div>
                <span>内存</span>
                <strong>{formatMemory(settings?.maxMemoryMb ?? 0)}</strong>
              </div>
              <div className={javaWarning ? 'is-warning' : ''}>
                <span>Java</span>
                <strong>{javaText}</strong>
              </div>
              <div>
                <span>上次启动</span>
                <strong>{relativeTime(targetLastPlayed)}</strong>
</div>
            </div>

            <button
              type="button"
              className={`launch-cta ${launchBusy || installTask ? 'is-busy' : ''} ${running ? 'is-running' : ''}`}
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

          <section className="workbench-section">
            <div className="workbench-section-head">
              <div className="workbench-section-title">
                <span className="mono-label">Versions</span>
                <h2>版本</h2>
                <span>{filteredVersions.length.toString().padStart(2, '0')}</span>
              </div>
              <div className="workbench-section-actions">
                <span className="view-toggle">
                  <button
                    type="button"
                    className={viewMode === 'table' ? 'is-active' : ''}
                    title="表格视图"
                    onClick={() => changeView('table')}
                  >
                    <List size={12} />
                  </button>
                  <button
                    type="button"
                    className={viewMode === 'grid' ? 'is-active' : ''}
                    title="网格视图"
                    onClick={() => changeView('grid')}
                  >
                    <LayoutGrid size={12} />
                  </button>
                </span>
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
                <button type="button" onClick={() => setVersionPickerOpen(true)}>
                  全部
                </button>
              </div>
            </div>
            <div className="workbench-filterbar">
              <select value={filterVersion} onChange={(event) => setFilterVersion(event.target.value)}>
                <option value="all">所有游戏版本</option>
                {versionGroups.map((group) => (
                  <option key={group} value={group}>
                    {group}
                  </option>
                ))}
              </select>
              <select value={filterLoader} onChange={(event) => setFilterLoader(event.target.value)}>
                <option value="all">所有加载器</option>
                {loaderOptions.map((loader) => (
                  <option key={loader} value={loader}>
                    {loader === 'vanilla' ? '原版' : loaderLabel(loader) ?? loader}
                  </option>
                ))}
              </select>
              {(filterVersion !== 'all' || filterLoader !== 'all') && (
                <button
                  type="button"
                  className="filter-clear"
                  onClick={() => {
                    setFilterVersion('all')
                    setFilterLoader('all')
                  }}
                >
                  清空筛选
                </button>
              )}
              <span className="filter-count">
                {filteredVersions.length} / {visibleInstalled.length}
              </span>
            </div>
            <LibraryTable
              versions={filteredVersions}
              view={viewMode}
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
          </section>

          <section className="workbench-section">
            <div className="workbench-section-head">
              <div className="workbench-section-title">
                <span className="mono-label">Instances</span>
                <h2>实例</h2>
                <span>{instances.length.toString().padStart(2, '0')}</span>
              </div>
              <div className="workbench-section-actions">
                <button type="button" onClick={() => void importModpack()}>
                  <Upload size={12} />
                  导入整合包
                </button>
                <button type="button" onClick={() => setPage('instances')}>
                  管理
                  <ChevronRight size={12} />
                </button>
              </div>
            </div>

            {instances.length > 0 ? (
              <div className="workbench-instance-grid">
                {instances.map((instance) => {
                  const isSelected = instance.id === selectedInstanceId
                  const isRunning = launchActive && launch.instanceId === instance.id
                  return (
                    <article
                      key={instance.id}
                      className={`workbench-instance-card ${isSelected ? 'is-selected' : ''}`}
                      onClick={() => selectInstance(instance.id)}
                    >
                      <div className="workbench-instance-top">
                        <span className="workbench-instance-icon">{instanceIcon(instance)}</span>
                        <span className="workbench-instance-copy">
                          <strong>{instance.name}</strong>
                          <small>
                            MC {instance.gameVersion} · {loaderLabel(instance.loader) ?? '原版'} ·{' '}
                            {instance.modCount} 模组
                          </small>
                        </span>
                      </div>
                      <div className="workbench-instance-foot">
                        <span>{relativeTime(instance.lastPlayed)}</span>
                        <span className="workbench-instance-actions">
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
                            title="快速预览"
                            onClick={(event) => {
                              event.stopPropagation()
                              setPreviewInstance(instance)
                            }}
                          >
                            <Info size={14} />
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
                        </span>
                      </div>
                    </article>
                  )
                })}
              </div>
            ) : (
              <div className="workbench-instance-grid">
                <div className="workbench-instance-empty">
                  <Boxes size={18} />
                  <span>还没有整合包实例</span>
                  <div>
                    <button type="button" className="button button--soft button--sm" onClick={() => setPage('instances')}>
                      从 Modrinth 安装
                    </button>
                    <button type="button" className="button button--soft button--sm" onClick={() => void importModpack()}>
                      导入文件
                    </button>
                  </div>
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
          diskFreeGb={disk.freeGb || appInfo?.diskFreeGb || 0}
          diskTotalGb={disk.totalGb || appInfo?.diskTotalGb || 0}
          downloadSpeed={downloadSpeed}
          memoryMb={settings?.maxMemoryMb ?? 0}
        />
      </div>
      </div>

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