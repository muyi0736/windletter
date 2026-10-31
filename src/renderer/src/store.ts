import { create } from 'zustand'
import type {
  AccountView,
  AccountsPayload,
  AppInfo,
  CurseForgeInstallRequest,
  DownloadSource,
  InstanceMetaPatch,
  InstanceSummary,
  InstanceSettingsPatch,
  InstalledVersion,
  JavaInfo,
  LaunchLogLine,
  LaunchState,
  LauncherSettings,
  LauncherUpdateState,
  LoaderInstanceRequest,
  LocalPackView,
  ManualPackFile,
  ModrinthProjectView,
  PresetCheckResult,
  PresetInstallItem,
  ServerInput,
  ServerView,
  TaskState,
  VanillaInstanceRequest,
  VersionManifestView
} from '@shared/types'
import { cleanError, formatDuration } from './lib/format'

export type PageKey = 'home' | 'instances' | 'servers' | 'downloads' | 'settings' | 'more'
export type ToastKind = 'success' | 'error' | 'info'
export type ConsoleTab = 'launch' | 'file'

export interface ToastItem {
  id: number
  kind: ToastKind
  title: string
  message?: string
}

export interface PresetPrompt {
  instanceId: string
  instanceName: string
  mode: 'install' | 'manual'
  status: 'checking' | 'ready' | 'error'
  result: PresetCheckResult | null
  error: string | null
}

const EMPTY_LAUNCH: LaunchState = {
  status: 'idle',
  message: '',
  progress: null,
  stage: null,
  versionId: null,
  instanceId: null,
  pid: null,
  startedAt: null,
  exitCode: null,
  error: null,
  speed: null
}

const EMPTY_ACCOUNTS: AccountsPayload = { accounts: [], activeId: null }

const EMPTY_UPDATE: LauncherUpdateState = {
  phase: 'idle',
  currentVersion: '',
  info: null,
  progress: { received: 0, total: 0, speed: 0, percent: null },
  error: null,
  checkedAt: null,
  source: null,
  rateLimitedUntil: null,
  silent: false
}

let toastSequence = 0
let initializing = false
let wired = false
const toastTimers = new Map<number, ReturnType<typeof setTimeout>>()
const taskTimers = new Map<string, ReturnType<typeof setTimeout>>()
const pendingLaunchTasks = new Set<string>()
let serversRefreshing = false
let stopRequested = false
let presetCheckSeq = 0
const pendingCfRequests = new Map<string, CurseForgeInstallRequest>()

function javaRequirement(message: string): number | null {
  const incompatible = /与游戏要求的 Java (\d+)/.exec(message)
  if (incompatible) return Number(incompatible[1]) || null
  const missing = /未找到可用的 Java (\d+)/.exec(message)
  if (missing) return Number(missing[1]) || null
  return null
}

function pickSelected(settings: LauncherSettings | null, installed: InstalledVersion[]): string | null {
  const ids = new Set(installed.map((version) => version.id))
  if (settings?.lastVersionId && ids.has(settings.lastVersionId)) return settings.lastVersionId
  return installed[0]?.id ?? null
}

function activeAccountOf(accounts: AccountsPayload): AccountView | null {
  return accounts.accounts.find((account) => account.id === accounts.activeId) ?? null
}

interface LauncherStore {
  booted: boolean
  bootError: string | null
  page: PageKey
  settings: LauncherSettings | null
  appInfo: AppInfo | null
  updateState: LauncherUpdateState
  accounts: AccountsPayload
  installed: InstalledVersion[]
  installedLoading: boolean
  instances: InstanceSummary[]
  instancesLoading: boolean
  manifest: VersionManifestView | null
  manifestLoading: boolean
  manifestError: string | null
  javaList: JavaInfo[]
  javaLoading: boolean
  tasks: TaskState[]
  manualPack: { request: CurseForgeInstallRequest; files: ManualPackFile[] } | null
  javaIssue: { versionId: string; requiredMajor: number | null; message: string } | null
  launch: LaunchState
  logs: LaunchLogLine[]
  consoleOpen: boolean
  consoleTab: ConsoleTab
  accountModalOpen: boolean
  versionPickerOpen: boolean
  presetManagerOpen: boolean
  presetPrompt: PresetPrompt | null
  selectedVersionId: string | null
  selectedInstanceId: string | null
  servers: ServerView[]
  serversLoading: boolean
  serversChecking: boolean
  serversCheckedAt: number | null
  toasts: ToastItem[]
  maximized: boolean

  initialize: () => Promise<void>
  setPage: (page: PageKey) => void
  patchSettings: (patch: Partial<LauncherSettings>) => Promise<LauncherSettings | null>
  toast: (kind: ToastKind, title: string, message?: string) => void
  dismissToast: (id: number) => void
  checkForUpdates: (silent?: boolean) => Promise<void>
  downloadUpdate: () => Promise<void>
  cancelUpdate: () => Promise<void>
  installUpdate: () => Promise<void>

  refreshInstalled: () => Promise<InstalledVersion[]>
  refreshInstances: () => Promise<InstanceSummary[]>
  loadManifest: (force?: boolean) => Promise<void>
  refreshJava: (force?: boolean) => Promise<void>
  selectVersion: (id: string | null) => void
  selectInstance: (id: string | null) => void
  installVersion: (id: string) => Promise<void>
  importModpack: () => Promise<void>
  importLocalPack: (pack: LocalPackView, launchAfter?: boolean) => Promise<TaskState | null>
  importLocalPacks: (packs: LocalPackView[]) => Promise<TaskState | null>
  importLocalArchives: (paths: string[]) => Promise<TaskState | null>
  installModrinth: (project: ModrinthProjectView, versionId?: string) => Promise<void>
  installCurseForgePack: (project: ModrinthProjectView, fileId: string) => Promise<void>
  downloadCurseForgeServerPack: (
    project: ModrinthProjectView,
    fileId: string
  ) => Promise<void>
  setPresetManagerOpen: (open: boolean) => void
  checkPresets: (instanceId: string, mode?: 'install' | 'manual') => Promise<void>
  startPresetInstall: (
    instanceId: string,
    items: PresetInstallItem[]
  ) => Promise<TaskState | null>
  setPresetAutoInstall: (enabled: boolean) => Promise<boolean>
  dismissPresetPrompt: () => void
  dismissManualPack: () => void
  retryManualPack: (paths: string[]) => Promise<void>
  createLoaderInstance: (request: LoaderInstanceRequest) => Promise<void>
  createVanillaInstance: (
    request: VanillaInstanceRequest | string
  ) => Promise<TaskState | null>
  updateInstanceLoader: (
    id: string,
    loaderVersion: string
  ) => Promise<TaskState | null>
  rollbackInstanceLoader: (id: string) => Promise<TaskState | null>
  updateInstanceSettings: (
    id: string,
    patch: InstanceSettingsPatch
  ) => Promise<InstanceSummary | null>
  updateInstanceMeta: (id: string, patch: InstanceMetaPatch) => Promise<InstanceSummary | null>
  openInstanceFolder: (
    id: string,
    kind: 'version' | 'saves' | 'mods' | 'screenshots' | 'logs' | 'crash-reports'
  ) => Promise<void>
  exportInstanceScript: (id: string) => Promise<void>
  repairInstance: (id: string) => Promise<void>
  instanceIconDataUrl: (path: string) => Promise<string | null>
  removeInstance: (id: string, deleteExternalFiles?: boolean) => Promise<boolean>
  cancelTask: (id: string) => Promise<void>
  pauseTask: (id: string) => Promise<void>
  resumeTask: (id: string) => Promise<void>
  clearFinishedTasks: () => void
  removeVersion: (id: string) => Promise<boolean>
  downloadJava: (versionId: string) => Promise<void>
  dismissJavaIssue: () => void

  diagnosticTarget: { instanceId: string; instanceName: string; auto: boolean } | null
  openDiagnosis: (id?: string | null, auto?: boolean) => void
  closeDiagnosis: () => void

  startLaunch: (versionId?: string) => Promise<void>
  startInstance: (id?: string) => Promise<void>
  loadServers: () => Promise<void>
  refreshServers: () => Promise<void>
  refreshServer: (id: string) => Promise<void>
  addServer: (input: ServerInput) => Promise<ServerView | null>
  updateServer: (id: string, input: ServerInput) => Promise<ServerView | null>
  removeServer: (id: string) => Promise<boolean>
  launchServer: (id: string) => Promise<void>
  cancelLaunch: () => Promise<void>
  stopGame: () => Promise<void>

  setAccountModalOpen: (open: boolean) => void
  setVersionPickerOpen: (open: boolean) => void
  openConsole: (tab?: ConsoleTab) => void
  closeConsole: () => void
  setConsoleTab: (tab: ConsoleTab) => void

  activeAccount: () => AccountView | null
  selectedVersion: () => InstalledVersion | null
  selectedInstance: () => InstanceSummary | null
  runningTaskFor: (versionId: string) => TaskState | null
}

export const useLauncher = create<LauncherStore>()((set, get) => ({
  booted: false,
  bootError: null,
  page: 'home',
  settings: null,
  appInfo: null,
  updateState: EMPTY_UPDATE,
  accounts: EMPTY_ACCOUNTS,
  installed: [],
  installedLoading: false,
  instances: [],
  instancesLoading: false,
  manifest: null,
  manifestLoading: false,
  manifestError: null,
  javaList: [],
  javaLoading: false,
  tasks: [],
  manualPack: null,
  javaIssue: null,
  launch: EMPTY_LAUNCH,
  logs: [],
  consoleOpen: false,
  consoleTab: 'launch',
  accountModalOpen: false,
  versionPickerOpen: false,
  presetManagerOpen: false,
  presetPrompt: null,
  selectedVersionId: null,
  selectedInstanceId: null,
  diagnosticTarget: null,
  servers: [],
  serversLoading: false,
  serversChecking: false,
  serversCheckedAt: null,
  toasts: [],
  maximized: false,

  initialize: async () => {
    if (initializing || get().booted) return
    initializing = true
    wireEvents(set, get)
    try {
      const settings = await window.ccl.settings.get()
      set({ settings, selectedVersionId: settings.lastVersionId })

      const [appInfo, updateState, accounts, installed, instances, tasks, launch, logs, servers] =
        await Promise.all([
          window.ccl.app.info().catch(() => null),
          window.ccl.updater.state().catch(() => EMPTY_UPDATE),
          window.ccl.auth.list().catch(() => EMPTY_ACCOUNTS),
          window.ccl.versions.installed().catch(() => [] as InstalledVersion[]),
          window.ccl.instances.list().catch(() => [] as InstanceSummary[]),
          window.ccl.tasks.list().catch(() => [] as TaskState[]),
          window.ccl.launch.getState().catch(() => EMPTY_LAUNCH),
          window.ccl.launch.getLogs().catch(() => [] as LaunchLogLine[]),
          window.ccl.servers.list().catch(() => [] as ServerView[])
        ])
      const selectedInstanceId =
        settings.lastInstanceId && instances.some((instance) => instance.id === settings.lastInstanceId)
          ? settings.lastInstanceId
          : null
      const managedVersions = new Set(
        instances
          .filter((instance) => instance.loader !== 'vanilla')
          .map((instance) => instance.versionId)
      )
      const visibleInstalled = installed.filter((version) => !managedVersions.has(version.id))

      set({
        appInfo,
        updateState,
        accounts,
        installed,
        instances,
        tasks,
        launch,
        logs,
        servers,
        selectedVersionId: pickSelected(settings, visibleInstalled),
        selectedInstanceId,
        booted: true,
        bootError: null
      })

      for (const task of tasks) {
        if (task.status !== 'running' && task.status !== 'paused') scheduleTaskRemoval(task.id, set)
      }
      void get().loadManifest()
      void get().refreshJava()
      if (settings.autoCheckUpdates !== false && settings.updateFeed) {
        setTimeout(() => {
          void get().checkForUpdates(true)
        }, 1400)
      }
    } catch (error) {
      set({ booted: true, bootError: cleanError(error) })
    } finally {
      initializing = false
    }
  },

  setPage: (page) => set({ page }),

  patchSettings: async (patch) => {
    const previous = get().settings
    if (!previous) return null
    set({ settings: { ...previous, ...patch } })
    try {
      const next = await window.ccl.settings.update(patch)
      set({ settings: next })
      return next
    } catch (error) {
      set({ settings: previous })
      get().toast('error', '设置未保存', cleanError(error))
      return null
    }
  },

  toast: (kind, title, message) => {
    const current = get().toasts
    if (current.some((item) => item.kind === kind && item.title === title && item.message === message)) {
      return
    }
    const item: ToastItem = { id: ++toastSequence, kind, title, message }
    set({ toasts: [...current, item].slice(-4) })
    const timer = setTimeout(
      () => {
        toastTimers.delete(item.id)
        set({ toasts: get().toasts.filter((toast) => toast.id !== item.id) })
      },
      kind === 'error' ? 6500 : 3800
    )
    toastTimers.set(item.id, timer)
  },

  dismissToast: (id) => {
    const timer = toastTimers.get(id)
    if (timer) clearTimeout(timer)
    toastTimers.delete(id)
    set({ toasts: get().toasts.filter((toast) => toast.id !== id) })
  },

  checkForUpdates: async (silent = false) => {
    try {
      const next = await window.ccl.updater.check(silent)
      set({ updateState: next })
      if (silent) {
        if (next.phase === 'available' && next.info) {
          get().toast(
            'info',
            `发现新版本 v${next.info.version}`,
            '前往 更多 → 启动器更新 查看并安装'
          )
        }
        return
      }
      if (next.phase === 'up-to-date') {
        get().toast('success', '已是最新版本', `当前版本 v${next.currentVersion}`)
      } else if (next.phase === 'error') {
        get().toast('error', '检查更新失败', next.error ?? '请稍后重试')
      }
    } catch (error) {
      if (!silent) get().toast('error', '检查更新失败', cleanError(error))
    }
  },

  downloadUpdate: async () => {
    try {
      const next = await window.ccl.updater.download()
      set({ updateState: next })
      if (next.phase === 'ready') {
        get().toast('success', '更新已下载', '安装包已通过 SHA-256 校验，可以安装')
      } else if (next.phase === 'error') {
        get().toast('error', '更新下载失败', next.error ?? '请稍后重试')
      }
    } catch (error) {
      get().toast('error', '更新下载失败', cleanError(error))
    }
  },

  cancelUpdate: async () => {
    try {
      set({ updateState: await window.ccl.updater.cancel() })
    } catch (error) {
      get().toast('error', '无法取消更新', cleanError(error))
    }
  },

  installUpdate: async () => {
    try {
      const next = await window.ccl.updater.install()
      set({ updateState: next })
      if (next.phase === 'error') {
        get().toast('error', '安装更新失败', next.error ?? '安装程序未能启动')
      }
    } catch (error) {
      get().toast('error', '安装更新失败', cleanError(error))
    }
  },

  refreshInstalled: async () => {
    set({ installedLoading: true })
    try {
      const installed = await window.ccl.versions.installed()
      const managedVersions = new Set(
        get()
          .instances.filter((instance) => instance.loader !== 'vanilla')
          .map((instance) => instance.versionId)
      )
      const selectable = installed.filter((version) => !managedVersions.has(version.id))
      const current = get().selectedVersionId
      const last = get().settings?.lastVersionId ?? null
      const ids = new Set(selectable.map((version) => version.id))
      const selectedVersionId =
        current && ids.has(current) ? current : last && ids.has(last) ? last : (selectable[0]?.id ?? null)
      set({ installed, selectedVersionId, installedLoading: false })
      return installed
    } catch (error) {
      set({ installedLoading: false })
      get().toast('error', '无法读取已安装版本', cleanError(error))
      return get().installed
    }
  },

  refreshInstances: async () => {
    set({ instancesLoading: true })
    try {
      const instances = await window.ccl.instances.list()
      const current = get().selectedInstanceId
      const ids = new Set(instances.map((instance) => instance.id))
      set({
        instances,
        instancesLoading: false,
        selectedInstanceId: current && ids.has(current) ? current : null
      })
      return instances
    } catch (error) {
      set({ instancesLoading: false })
      get().toast('error', '无法读取实例列表', cleanError(error))
      return get().instances
    }
  },

  loadManifest: async (force = false) => {
    if (get().manifestLoading) return
    if (!force && get().manifest) return
    const settings = get().settings
    if (!settings) return
    set({ manifestLoading: true, manifestError: null })
    try {
      const manifest = await window.ccl.versions.manifest(settings.source)
      set({ manifest, manifestLoading: false })
    } catch (error) {
      set({ manifestLoading: false, manifestError: cleanError(error) })
    }
  },

  refreshJava: async (force = false) => {
    if (get().javaLoading) return
    set({ javaLoading: true })
    try {
      const javaList = await window.ccl.java.detect(force)
      set({ javaList, javaLoading: false })
    } catch {
      set({ javaLoading: false })
    }
  },

  selectVersion: (id) => {
    set({ selectedVersionId: id, selectedInstanceId: null })
    if (id) {
      void window.ccl.settings
        .update({ lastVersionId: id, lastInstanceId: null })
        .catch(() => undefined)
    }
  },

  selectInstance: (id) => {
    set({ selectedInstanceId: id })
    if (id) {
      void window.ccl.settings.update({ lastInstanceId: id }).catch(() => undefined)
    }
  },

  installVersion: async (id) => {
    try {
      const task = await window.ccl.versions.install(id)
      upsertTask(task, set, get)
      get().toast('info', `已加入下载队列：Minecraft ${id}`, '可在任务浮窗中查看进度')
    } catch (error) {
      get().toast('error', '无法开始安装', cleanError(error))
    }
  },

  importModpack: async () => {
    try {
      const task = await window.ccl.instances.importFile()
      if (!task) return
      upsertTask(task, set, get)
      get().toast('info', '已开始导入整合包', '原版、加载器与模组文件会在任务浮窗中依次准备')
    } catch (error) {
      get().toast('error', '无法导入整合包', cleanError(error))
    }
  },

  importLocalPack: async (pack, launchAfter = false) => {
    try {
      const task = await window.ccl.localPacks.import({ path: pack.path, kind: pack.kind })
      upsertTask(task, set, get)
      if (launchAfter) pendingLaunchTasks.add(task.id)
      get().toast(
        'info',
        pack.external ? '已添加外部整合包' : `已开始导入 ${pack.name}`,
        pack.external
          ? launchAfter
            ? '直接使用原目录启动，不复制模组'
            : '已加入实例列表，可直接启动'
          : launchAfter
            ? '导入完成后会自动启动，首次需要补齐原版与加载器'
            : pack.kind === 'archive'
              ? '会补齐原版、加载器并下载整合包文件'
              : `会补齐原版与加载器，并复制 ${pack.modCount} 个模组与配置`
      )
      return task
    } catch (error) {
      get().toast('error', '无法导入本地整合包', cleanError(error))
      return null
    }
  },

  createLoaderInstance: async (request) => {
    try {
      const task = await window.ccl.instances.createLoader(request)
      upsertTask(task, set, get)
      get().toast('info', `已加入安装队列：${request.loader} ${request.gameVersion}`, '可在任务浮窗中查看进度')
    } catch (error) {
      get().toast('error', '无法创建加载器实例', cleanError(error))
    }
  },

  createVanillaInstance: async (request) => {
    const payload: VanillaInstanceRequest =
      typeof request === 'string' ? { gameVersion: request } : request
    try {
      const task = await window.ccl.instances.createVanilla(payload)
      upsertTask(task, set, get)
      get().toast(
        'info',
        `已开始创建原版实例：${payload.gameVersion}`,
        '原版文件会在需要时补齐；进度可在任务浮窗查看'
      )
      return task
    } catch (error) {
      get().toast('error', '无法创建原版实例', cleanError(error))
      return null
    }
  },

  updateInstanceLoader: async (id, loaderVersion) => {
    try {
      const task = await window.ccl.instances.updateLoader({
        instanceId: id,
        loaderVersion
      })
      upsertTask(task, set, get)
      get().toast(
        'info',
        '已开始更新加载器',
        '进度可在任务浮窗查看；模组、配置和存档不会变动'
      )
      return task
    } catch (error) {
      get().toast('error', '无法更新加载器', cleanError(error))
      return null
    }
  },

  rollbackInstanceLoader: async (id) => {
    try {
      const task = await window.ccl.instances.rollbackLoader(id)
      upsertTask(task, set, get)
      get().toast(
        'info',
        '已开始回滚加载器',
        '回到上一版加载器；模组、配置和存档不会变动'
      )
      return task
    } catch (error) {
      get().toast('error', '无法回滚加载器', cleanError(error))
      return null
    }
  },

  importLocalPacks: async (packs) => {
    if (packs.length === 0) return null
    try {
      const task = await window.ccl.localPacks.importMany(
        packs.map((pack) => ({ path: pack.path, kind: pack.kind }))
      )
      upsertTask(task, set, get)
      get().toast(
        'info',
        `已开始批量添加 ${packs.length} 个本地整合包`,
        packs.every((pack) => pack.external)
          ? '外部实例会直接引用原目录，不复制文件'
          : '外部实例瞬时添加，其余整合包会依次补齐并复制'
      )
      return task
    } catch (error) {
      get().toast('error', '无法批量添加本地整合包', cleanError(error))
      return null
    }
  },

  importLocalArchives: async (paths) => {
    const archives = paths.filter((path) => /\.(?:mrpack|zip)$/i.test(path)).slice(0, 50)
    if (archives.length === 0) return null
    try {
      const task = await window.ccl.localPacks.importMany(
        archives.map((path) => ({ path, kind: 'archive' as const }))
      )
      upsertTask(task, set, get)
      get().toast(
        'info',
        archives.length === 1 ? '已开始导入整合包' : `已开始导入 ${archives.length} 个整合包`,
        '原版、加载器与模组文件会在任务浮窗中依次准备'
      )
      return task
    } catch (error) {
      get().toast('error', '无法导入整合包', cleanError(error))
      return null
    }
  },

  installCurseForgePack: async (project, fileId) => {
    try {
      const request: CurseForgeInstallRequest = {
        projectId: project.projectId,
        title: project.title,
        iconUrl: project.iconUrl,
        summary: project.description,
        fileId
      }
      const task = await window.ccl.instances.installCurseForge(request)
      pendingCfRequests.set(task.id, request)
      upsertTask(task, set, get)
      get().toast('info', `已加入安装队列：${project.title}`, '会在任务浮窗中下载 CurseForge 整合包并安装')
    } catch (error) {
      get().toast('error', '无法安装 CurseForge 整合包', cleanError(error))
    }
  },

  downloadCurseForgeServerPack: async (project, fileId) => {
    try {
      const task = await window.ccl.curseforge.downloadServerPack({
        projectId: project.projectId,
        fileId,
        title: project.title,
        slug: project.slug
      })
      upsertTask(task, set, get)
      get().toast(
        'info',
        '已开始下载服务端包',
        `${project.title} · 完成后会打开所在文件夹`
      )
    } catch (error) {
      get().toast('error', '无法下载服务端包', cleanError(error))
    }
  },

  setPresetManagerOpen: (open) => set({ presetManagerOpen: open }),

  checkPresets: async (instanceId, mode = 'manual') => {
    if (mode === 'install') {
      try {
        const presets = await window.ccl.presets.list()
        if (presets.items.length === 0) return
      } catch {
        return
      }
    }
    const sequence = ++presetCheckSeq
    const instance = get().instances.find((item) => item.id === instanceId)
    set({
      presetPrompt: {
        instanceId,
        instanceName: instance?.name ?? '实例',
        mode,
        status: 'checking',
        result: null,
        error: null
      }
    })
    try {
      const result = await window.ccl.presets.check(instanceId)
      if (sequence !== presetCheckSeq) return
      const missing = result.entries.filter((entry) => !entry.present)
      if (mode === 'install') {
        if (!result.applicable || missing.length === 0) {
          set({ presetPrompt: null })
          return
        }
        if (result.autoInstall) {
          const installable = missing.filter((entry) => entry.compatible && entry.versionId)
          const showReady = () =>
            set({
              presetPrompt: {
                instanceId,
                instanceName: result.instanceName,
                mode,
                status: 'ready',
                result,
                error: null
              }
            })
          if (installable.length === 0) {
            showReady()
            return
          }
          const unavailable = missing.length - installable.length
          if (unavailable > 0) {
            get().toast(
              'info',
              '部分预设暂无兼容版本',
              `${unavailable} 个预设不会自动安装，可在实例内容里手动选择版本`
            )
          }
          const task = await get().startPresetInstall(
            instanceId,
            installable.map((entry) => ({
              provider: entry.provider,
              projectId: entry.projectId,
              versionId: entry.versionId,
              title: entry.title
            }))
          )
          if (!task) showReady()
          return
        }
      }
      set({
        presetPrompt: {
          instanceId,
          instanceName: result.instanceName,
          mode,
          status: 'ready',
          result,
          error: null
        }
      })
    } catch (error) {
      if (sequence !== presetCheckSeq) return
      if (mode === 'install') {
        set({ presetPrompt: null })
        return
      }
      set({
        presetPrompt: {
          instanceId,
          instanceName: instance?.name ?? '实例',
          mode,
          status: 'error',
          result: null,
          error: cleanError(error)
        }
      })
    }
  },

  startPresetInstall: async (instanceId, items) => {
    if (items.length === 0) return null
    try {
      const task = await window.ccl.presets.install({ instanceId, items })
      upsertTask(task, set, get)
      set({ presetPrompt: null })
      get().toast(
        'info',
        '已开始安装预设模组',
        `${items.length} 个模组会在任务浮窗中补齐`
      )
      return task
    } catch (error) {
      get().toast('error', '无法安装预设模组', cleanError(error))
      return null
    }
  },

  setPresetAutoInstall: async (enabled) => {
    try {
      const payload = await window.ccl.presets.setAutoInstall(enabled)
      const prompt = get().presetPrompt
      if (prompt?.result) {
        set({
          presetPrompt: {
            ...prompt,
            result: { ...prompt.result, autoInstall: payload.autoInstall }
          }
        })
      }
      get().toast(
        'success',
        enabled ? '已开启预设自动补齐' : '已关闭预设自动补齐',
        enabled
          ? '安装整合包后会自动安装缺失的预设模组'
          : '安装整合包后先询问，再决定是否补齐'
      )
      return true
    } catch (error) {
      get().toast('error', '无法保存预设设置', cleanError(error))
      return false
    }
  },

  dismissPresetPrompt: () => {
    presetCheckSeq += 1
    set({ presetPrompt: null })
  },

  dismissManualPack: () => set({ manualPack: null }),

  retryManualPack: async (paths) => {
    const current = get().manualPack
    if (!current) return
    const request: CurseForgeInstallRequest = { ...current.request, manualFiles: paths }
    set({ manualPack: null })
    try {
      const task = await window.ccl.instances.installCurseForge(request)
      pendingCfRequests.set(task.id, request)
      upsertTask(task, set, get)
      get().toast('info', '继续安装整合包', '已用你选择的文件补齐受限模组')
    } catch (error) {
      get().toast('error', '无法继续安装', cleanError(error))
    }
  },

  installModrinth: async (project, versionId) => {
    try {
      const task = await window.ccl.instances.installModrinth({
        projectId: project.projectId,
        title: project.title,
        iconUrl: project.iconUrl,
        summary: project.description,
        versionId: versionId ?? null
      })
      upsertTask(task, set, get)
      get().toast('info', `已加入安装队列：${project.title}`, '可在任务浮窗中查看进度')
    } catch (error) {
      get().toast('error', '无法安装整合包', cleanError(error))
    }
  },

  updateInstanceSettings: async (id, patch) => {
    try {
      const updated = await window.ccl.instances.updateSettings(id, patch)
      await get().refreshInstances()
      get().toast('success', '实例设置已保存', updated.name)
      return updated
    } catch (error) {
      get().toast('error', '无法保存实例设置', cleanError(error))
      return null
    }
  },

  updateInstanceMeta: async (id, patch) => {
    try {
      const updated = await window.ccl.instances.updateMeta(id, patch)
      await get().refreshInstances()
      return updated
    } catch (error) {
      get().toast('error', '无法保存实例信息', cleanError(error))
      return null
    }
  },

  openInstanceFolder: async (id, kind) => {
    try {
      await window.ccl.instances.openFolder(id, kind)
    } catch (error) {
      get().toast('error', '无法打开文件夹', cleanError(error))
    }
  },

  exportInstanceScript: async (id) => {
    try {
      const path = await window.ccl.instances.exportScript(id)
      if (path) get().toast('success', '启动脚本已导出', path)
    } catch (error) {
      get().toast('error', '无法导出启动脚本', cleanError(error))
    }
  },

  repairInstance: async (id) => {
    try {
      const task = await window.ccl.instances.repair(id)
      upsertTask(task, set, get)
      get().toast('info', '正在补全实例文件', '任务完成后可重新启动')
    } catch (error) {
      get().toast('error', '无法补全文件', cleanError(error))
    }
  },

  instanceIconDataUrl: async (path) => {
    try {
      return await window.ccl.app.imageDataUrl(path)
    } catch {
      return null
    }
  },

  removeInstance: async (id, deleteExternalFiles = false) => {
    try {
      const wasSelected = get().selectedInstanceId === id
      const removedVersions = await window.ccl.instances.remove(id, deleteExternalFiles)
      const remaining = await get().refreshInstances()
      if (wasSelected) {
        if (remaining.length) get().selectInstance(remaining[0].id)
        else get().selectInstance(null)
      }
      await get().refreshInstalled()
      get().toast(
        'success',
        '实例已删除',
        deleteExternalFiles
          ? '原整合包目录、mods 与存档已删除；共享运行库保留'
          : removedVersions.length > 0
            ? `已自动清理 ${removedVersions.length} 个未使用版本：${removedVersions.slice(0, 4).join('、')}${
                removedVersions.length > 4 ? ' 等' : ''
              }`
            : '没有需要清理的独占版本；共享运行库与其他实例依赖保留'
      )
      return true
    } catch (error) {
      get().toast('error', '无法删除实例', cleanError(error))
      return false
    }
  },

  cancelTask: async (id) => {
    try {
      await window.ccl.tasks.cancel(id)
    } catch (error) {
      get().toast('error', '无法取消任务', cleanError(error))
    }
  },

  pauseTask: async (id) => {
    try {
      await window.ccl.tasks.pause(id)
    } catch (error) {
      get().toast('error', '无法暂停任务', cleanError(error))
    }
  },

  resumeTask: async (id) => {
    try {
      await window.ccl.tasks.resume(id)
    } catch (error) {
      get().toast('error', '无法继续任务', cleanError(error))
    }
  },

  clearFinishedTasks: () => {
    for (const task of get().tasks) {
      if (task.status === 'running' || task.status === 'paused') continue
      const timer = taskTimers.get(task.id)
      if (timer) clearTimeout(timer)
      taskTimers.delete(task.id)
    }
    set((state) => ({
      tasks: state.tasks.filter(
        (task) => task.status === 'running' || task.status === 'paused'
      )
    }))
  },

  removeVersion: async (id) => {
    try {
      await window.ccl.versions.remove(id)
      await get().refreshInstalled()
      if (get().settings?.lastVersionId === id) {
        void get().patchSettings({ lastVersionId: get().selectedVersionId })
      }
      get().toast('success', '版本已删除', `Minecraft ${id} 已从版本列表中移除`)
      return true
    } catch (error) {
      get().toast('error', '无法删除版本', cleanError(error))
      return false
    }
  },

  downloadJava: async (versionId) => {
    try {
      const task = await window.ccl.java.downloadForVersion(versionId)
      upsertTask(task, set, get)
      get().toast('info', '正在准备 Java 运行时', '任务完成后即可启动游戏')
    } catch (error) {
      get().toast('error', '无法下载 Java', cleanError(error))
    }
  },

  dismissJavaIssue: () => set({ javaIssue: null }),

  startLaunch: async (versionId) => {
    if (!versionId && get().selectedInstanceId) {
      await get().startInstance(get().selectedInstanceId ?? undefined)
      return
    }
    const target = versionId ?? get().selectedVersionId
    if (!target) {
      get().toast(
        'info',
        '还没有可启动的内容',
        get().instances.length
          ? '请选择一个实例，或前往下载页安装 Minecraft 版本'
          : '请先前往下载页安装一个 Minecraft 版本'
      )
      get().setPage(get().instances.length ? 'instances' : 'downloads')
      return
    }
    if (versionId && versionId !== get().selectedVersionId) get().selectVersion(versionId)
    try {
      await window.ccl.launch.start(target)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      const requiredMajor = javaRequirement(detail)
      if (requiredMajor !== null) {
        set({ javaIssue: { versionId: target, requiredMajor, message: cleanError(error) } })
        return
      }
      const message = cleanError(error)
      const state = get().launch
      if (state.status === 'error' && state.error === message) return
      get().toast('error', '启动失败', message)
    }
  },

  startInstance: async (id) => {
    const target = id ?? get().selectedInstanceId
    if (!target) {
      get().toast('info', '还没有选择实例', '请在实例页导入或安装一个整合包')
      get().setPage('instances')
      return
    }
    if (id && id !== get().selectedInstanceId) get().selectInstance(id)
    try {
      await window.ccl.instances.launch(target)
    } catch (error) {
      reportLaunchFailure(
        error,
        get().instances.find((item) => item.id === target) ?? null,
        target,
        set,
        get
      )
    }
  },

  loadServers: async () => {
    set({ serversLoading: true })
    try {
      const servers = await window.ccl.servers.list()
      set({ servers, serversLoading: false })
    } catch (error) {
      set({ serversLoading: false })
      get().toast('error', '无法读取服务器列表', cleanError(error))
    }
  },

  refreshServers: async () => {
    if (serversRefreshing) return
    const current = get().servers
    if (current.length === 0) {
      set({ serversChecking: false, serversCheckedAt: Date.now() })
      return
    }
    serversRefreshing = true
    set({ serversChecking: true })
    try {
      const results = await window.ccl.servers.pingAll()
      const statuses = new Map(results.map((item) => [item.id, item.status]))
      set((state) => ({
        servers: state.servers.map((server) => {
          const status = statuses.get(server.id)
          return status ? { ...server, status } : server
        }),
        serversChecking: false,
        serversCheckedAt: Date.now()
      }))
    } catch (error) {
      set({ serversChecking: false })
      get().toast('error', '服务器状态获取失败', cleanError(error))
    } finally {
      serversRefreshing = false
    }
  },

  refreshServer: async (id) => {
    try {
      const status = await window.ccl.servers.ping(id)
      set((state) => ({
        servers: state.servers.map((server) =>
          server.id === id ? { ...server, status } : server
        ),
        serversCheckedAt: Date.now()
      }))
    } catch (error) {
      get().toast('error', '无法探测服务器', cleanError(error))
    }
  },

  addServer: async (input) => {
    try {
      const server = await window.ccl.servers.add(input)
      set((state) => ({ servers: [server, ...state.servers] }))
      get().toast('success', '服务器已添加', server.name)
      pingIntoState(server.id, set)
      void get().refreshServers()
      return server
    } catch (error) {
      get().toast('error', '无法添加服务器', cleanError(error))
      return null
    }
  },

  updateServer: async (id, input) => {
    const previous = get().servers.find((item) => item.id === id) ?? null
    try {
      const server = await window.ccl.servers.update(id, input)
      set((state) => ({
        servers: state.servers.map((item) =>
          item.id === id
            ? {
                ...server,
                status:
                  previous && previous.host === server.host && previous.port === server.port
                    ? previous.status
                    : server.status
              }
            : item
        )
      }))
      get().toast('success', '服务器设置已保存', server.name)
      pingIntoState(server.id, set)
      void get().refreshServers()
      return server
    } catch (error) {
      get().toast('error', '无法保存服务器', cleanError(error))
      return null
    }
  },

  removeServer: async (id) => {
    try {
      await window.ccl.servers.remove(id)
      set((state) => ({ servers: state.servers.filter((item) => item.id !== id) }))
      get().toast('success', '服务器已移除', '只会删除这个书签，不会碰实例和存档')
      return true
    } catch (error) {
      get().toast('error', '无法移除服务器', cleanError(error))
      return false
    }
  },

  launchServer: async (id) => {
    const server = get().servers.find((item) => item.id === id)
    if (!server) return
    const instance = server.instanceId
      ? get().instances.find((item) => item.id === server.instanceId) ?? null
      : null
    if (!server.instanceId || !instance) {
      get().toast('info', '还没有绑定实例', '编辑服务器，选择一个实例后才能一键进服')
      return
    }
    if (!get().accounts.accounts.length) {
      get().setAccountModalOpen(true)
      get().toast('info', '需要先登录账户', '添加离线账户或登录微软账户后即可启动')
      return
    }
    get().selectInstance(instance.id)
    const request = window.ccl.servers.launch(id)
    get().setPage('home')
    try {
      await request
    } catch (error) {
      reportLaunchFailure(error, instance, instance.versionId, set, get)
    }
  },

  openDiagnosis: (id, auto = false) => {
    const targetId = id ?? get().selectedInstanceId
    if (!targetId) {
      get().toast('info', '还没有选择实例', '请选择一个实例后再做启动体检')
      get().setPage('instances')
      return
    }
    const instance = get().instances.find((item) => item.id === targetId)
    set({
      diagnosticTarget: {
        instanceId: targetId,
        instanceName: instance?.name ?? '实例',
        auto
      }
    })
  },

  closeDiagnosis: () => set({ diagnosticTarget: null }),

  cancelLaunch: async () => {
    try {
      await window.ccl.launch.cancel()
    } catch (error) {
      get().toast('error', '无法取消启动', cleanError(error))
    }
  },

  stopGame: async () => {
    try {
      stopRequested = true
      await window.ccl.launch.stop()
    } catch (error) {
      get().toast('error', '无法结束游戏', cleanError(error))
    }
  },

  setAccountModalOpen: (open) => set({ accountModalOpen: open }),
  setVersionPickerOpen: (open) => set({ versionPickerOpen: open }),

  openConsole: (tab = 'launch') => {
    set({ consoleOpen: true, consoleTab: tab })
    void window.ccl.launch
      .getLogs()
      .then((logs) => set({ logs }))
      .catch(() => undefined)
  },
  closeConsole: () => set({ consoleOpen: false }),
  setConsoleTab: (tab) => set({ consoleTab: tab }),

  activeAccount: () => activeAccountOf(get().accounts),
  selectedVersion: () => {
    const id = get().selectedVersionId
    return get().installed.find((version) => version.id === id) ?? null
  },
  selectedInstance: () => {
    const id = get().selectedInstanceId
    return get().instances.find((instance) => instance.id === id) ?? null
  },
  runningTaskFor: (versionId) => {
    return (
      get().tasks.find(
        (task) => task.versionId === versionId && task.kind === 'install' && (task.status === 'running' || task.status === 'paused')
      ) ?? null
    )
  }
}))

function upsertTask(task: TaskState, set: SetState, get: () => LauncherStore): void {
  const existing = get().tasks
  const index = existing.findIndex((item) => item.id === task.id)
  const previous = index >= 0 ? existing[index] : null
  const tasks = index >= 0
    ? existing.map((item) => (item.id === task.id ? task : item))
    : [...existing, task]
  const timer = taskTimers.get(task.id)
  if (timer) clearTimeout(timer)
  taskTimers.delete(task.id)
  set({ tasks })
  if (
    previous &&
    (previous.status === 'running' || previous.status === 'paused') &&
    task.status === 'done'
  ) {
    const duration = formatDuration((task.finishedAt ?? Date.now()) - task.createdAt)
    get().toast('success', '任务完成', `${task.title} · 耗时 ${duration}`)
  }
  if (task.status === 'error' && task.manualFiles?.length) {
    const request = pendingCfRequests.get(task.id)
    if (request) {
      pendingCfRequests.delete(task.id)
      set({ manualPack: { request, files: task.manualFiles } })
    }
  }
  if (task.status !== 'running' && task.status !== 'paused') {
    scheduleTaskRemoval(task.id, set)
  }
}

type SetState = (partial: Partial<LauncherStore> | ((state: LauncherStore) => Partial<LauncherStore>)) => void

function reportLaunchFailure(
  error: unknown,
  instance: InstanceSummary | null,
  fallbackVersionId: string | null,
  set: SetState,
  get: () => LauncherStore
): void {
  const detail = error instanceof Error ? error.message : String(error)
  const requiredMajor = javaRequirement(detail)
  if (requiredMajor !== null) {
    set({
      javaIssue: {
        versionId: instance?.versionId ?? fallbackVersionId ?? '',
        requiredMajor,
        message: cleanError(error)
      }
    })
    return
  }
  const message = cleanError(error)
  const state = get().launch
  if (state.status === 'error' && state.error === message) return
  get().toast('error', '启动失败', message)
}

function pingIntoState(id: string, set: SetState): void {
  void window.ccl.servers
    .ping(id)
    .then((status) => {
      set((state) => ({
        servers: state.servers.map((server) =>
          server.id === id ? { ...server, status } : server
        )
      }))
    })
    .catch(() => undefined)
}

function scheduleTaskRemoval(id: string, set: SetState): void {
  if (taskTimers.has(id)) return
  const timer = setTimeout(() => {
    taskTimers.delete(id)
    set((state) => ({ tasks: state.tasks.filter((task) => task.id !== id) }))
  }, 60_000)
  taskTimers.set(id, timer)
}

function wireEvents(set: SetState, get: () => LauncherStore): void {
  if (wired) return
  wired = true

  window.ccl.tasks.onUpdate((task) => {
    const previous = get().tasks.find((item) => item.id === task.id)
    upsertTask(task, set, get)
    if (task.status === 'error' || task.status === 'cancelled') {
      pendingLaunchTasks.delete(task.id)
    }

    if (task.status === 'done' && previous?.status !== 'done') {
      if (task.kind === 'install') {
        const repair = task.title.startsWith('补全实例')
        get().toast(
          'success',
          repair ? '实例文件已补全' : '安装完成',
          repair ? task.title : `Minecraft ${task.versionId ?? ''} 已准备就绪`
        )
        void get().refreshInstalled().then(() => {
          // 原版实例会接管基础版本；安装/补全后回到实例选择，
          // 不要把当前目标留给一个已被实例接管的版本。
          const currentGameDir = (get().settings?.gameDir ?? '').toLowerCase()
          const owner = task.instanceId
            ? null
            : get().instances.find(
                (instance) =>
                  instance.versionId === task.versionId &&
                  (instance.external?.baseDir ?? instance.baseDir ?? currentGameDir).toLowerCase() ===
                    currentGameDir
              )
          const targetInstanceId = task.instanceId ?? owner?.id ?? null
          if (targetInstanceId) {
            void get().refreshInstances().then(() => get().selectInstance(targetInstanceId))
          } else if (task.versionId) {
            get().selectVersion(task.versionId)
          }
        })
      } else if (task.kind === 'java') {
        get().toast('success', 'Java 已就绪', '现在可以启动需要该运行时的版本了')
        void get().refreshJava(true)
      } else if (task.kind === 'instance') {
        const transferTitle = task.title.startsWith('迁移')
          ? '实例已迁移'
          : task.title.startsWith('克隆')
            ? '实例已克隆'
            : '实例已创建'
        void get().refreshInstances().then((instances) => {
          const instance = task.instanceId
            ? instances.find((item) => item.id === task.instanceId)
            : null
          get().toast(
            'success',
            transferTitle,
            instance
              ? `${instance.name} · ${task.message ?? `Minecraft ${instance.gameVersion}`}`
              : task.message ?? '可以在实例列表中继续安装模组'
          )
          if (task.instanceId) get().selectInstance(task.instanceId)
        })
      } else if (task.kind === 'modpack') {
        void get().refreshInstances().then((instances) => {
          const instance = task.instanceId
            ? instances.find((item) => item.id === task.instanceId)
            : null
          const name = instance?.name ?? task.title.replace(/^(安装|导入)整合包\s*/, '')
          get().toast('success', '整合包已就绪', `${name} 已添加到我的实例`)
          if (task.instanceId) get().selectInstance(task.instanceId)
          void get().refreshInstalled()
          const willLaunch = Boolean(task.instanceId && pendingLaunchTasks.has(task.id))
          const isPackTask = task.title.includes('整合包')
          if (task.instanceId && !willLaunch && isPackTask) {
            void get().checkPresets(task.instanceId, 'install')
          }
          if (task.instanceId && pendingLaunchTasks.delete(task.id)) {
            if (!get().accounts.activeId) {
              get().setAccountModalOpen(true)
              get().toast('info', '先添加一个账户', '整合包已导入，登录后即可启动')
            } else {
              void get().startInstance(task.instanceId)
            }
          }
        })
      } else if (task.kind === 'preset') {
        void get().refreshInstances().then((instances) => {
          const instance = task.instanceId
            ? instances.find((item) => item.id === task.instanceId)
            : null
          const manualCount = task.manualMods?.length ?? 0
          get().toast(
            'success',
            '预设模组已安装',
            manualCount > 0
              ? `${instance?.name ?? '实例'} 已安装能自动获取的部分；${manualCount} 个文件需要手动处理`
              : `${instance?.name ?? '实例'} 已补齐预设模组`
          )
          if (task.instanceId) get().selectInstance(task.instanceId)
        })
        if (task.manualMods && task.manualMods.length > 0) {
          get().toast(
            'info',
            '有预设文件需要手动下载',
            task.manualMods.map((item) => item.title).slice(0, 4).join('、')
          )
        }
      } else if (task.kind === 'loader') {
        const rolledBack = task.title.startsWith('回滚')
        void get().refreshInstances().then((instances) => {
          const instance = task.instanceId
            ? instances.find((item) => item.id === task.instanceId)
            : null
          get().toast(
            'success',
            rolledBack ? '加载器已回滚' : '加载器已更新',
            `${instance?.name ?? task.title}${instance?.loaderVersion ? ` · ${instance.loaderVersion}` : ''}`
          )
          if (task.instanceId) get().selectInstance(task.instanceId)
        })
      } else if (task.kind === 'serverPack') {
        if (task.title.startsWith('下载服务端包')) {
          get().toast('success', '服务端包已下载', task.message ?? 'ZIP 已保存')
        } else {
          get().toast(
            'success',
            '服务端包已生成',
            `${task.message ?? 'ZIP 已保存'} · 可重新打开窗口点「验证服务端包」`
          )
        }
      } else if (task.kind === 'world') {
        get().toast(
          'success',
          task.title.startsWith('恢复') ? '存档已恢复' : '存档备份完成',
          task.message
        )
      }
    }

    if (task.status === 'error' && previous?.status !== 'error') {
      const title =
        task.kind === 'install'
          ? '安装未完成'
          : task.kind === 'modpack'
            ? '整合包安装未完成'
            : task.kind === 'instance'
              ? task.title.startsWith('迁移')
                ? '实例迁移未完成'
                : task.title.startsWith('克隆')
                  ? '实例克隆未完成'
                  : '实例创建未完成'
              : task.kind === 'preset'
              ? '预设模组安装未完成'
              : task.kind === 'loader'
                ? task.title.startsWith('回滚')
                  ? '加载器回滚未完成'
                  : '加载器更新未完成'
                : task.kind === 'world'
                  ? '存档操作未完成'
                  : task.kind === 'serverPack'
                    ? task.title.startsWith('下载服务端包')
                      ? '服务端包下载未完成'
                      : '服务端包制作未完成'
                  : 'Java 任务未完成'
      get().toast('error', title, task.error ?? task.message ?? '未知错误')
    }

    if (task.status === 'cancelled' && previous?.status !== 'cancelled') {
      get().toast('info', '任务已取消', task.title)
    }
  })

  window.ccl.launch.onState((state) => {
    const previous = get().launch
    if (state.status === 'preparing' && previous.status !== 'preparing' && previous.status !== 'starting') {
      set({ launch: state, logs: [] })
    } else {
      set({ launch: state })
    }

    if (state.status === 'preparing') stopRequested = false
    if (state.status === 'error' && state.error && previous.error !== state.error) {
      get().toast('error', '启动失败', state.error)
    }
    if (
      state.status === 'exited' &&
      previous.status !== 'exited' &&
      state.instanceId &&
      state.exitCode != null &&
      state.exitCode !== 0 &&
      !stopRequested
    ) {
      get().openDiagnosis(state.instanceId, true)
    }
    if (
      state.status === 'exited' &&
      previous.status === 'running' &&
      state.instanceId &&
      state.exitCode === 0 &&
      !stopRequested &&
      previous.startedAt &&
      Date.now() - previous.startedAt > 60_000
    ) {
      void window.ccl.diagnostics.markKnownGood(state.instanceId).catch(() => undefined)
    }
    if (state.status === 'exited') stopRequested = false
    if (state.status === 'running' && previous.status !== 'running') {
      const instance = state.instanceId
        ? get().instances.find((item) => item.id === state.instanceId)
        : null
      get().toast(
        'success',
        '游戏已启动',
        instance ? instance.name : state.versionId ? `Minecraft ${state.versionId}` : undefined
      )
    }
    if (state.status === 'exited' && previous.status !== 'exited') {
      if (state.exitCode === 0) {
        get().toast('info', '游戏已退出', state.message || '欢迎回来')
      } else {
        get().toast('error', '游戏异常退出', state.message || `退出代码 ${state.exitCode ?? '未知'}`)
        get().openConsole('launch')
      }
      void get().refreshInstalled()
      if (state.instanceId) void get().refreshInstances()
    }
  })

  window.ccl.launch.onLog((line) => {
    const logs = [...get().logs, line]
    set({ logs: logs.length > 2400 ? logs.slice(logs.length - 2400) : logs })
  })

  window.ccl.auth.onChanged((accounts) => set({ accounts }))

  window.ccl.updater.onState((next) => set({ updateState: next }))

  window.ccl.window.onMaximizedChange((maximized) => {
    set({ maximized })
  })

  void window.ccl.window.isMaximized().then((maximized) => set({ maximized })).catch(() => undefined)
}
