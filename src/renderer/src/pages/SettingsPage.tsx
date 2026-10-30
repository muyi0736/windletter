import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Archive,
  Check,
  Coffee,
  Cpu,
  DatabaseBackup,
  Download,
  ExternalLink,
  FolderOpen,
  Globe,
  HardDrive,
  ImagePlus,
  Info,
  KeyRound,
  Link2,
  MemoryStick,
  Monitor,
  Moon,
  Palette,
  Play,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Trash2,
  UserRound,
  WandSparkles,
  Wrench
} from 'lucide-react'
import type { AccentName, HomeLayout, ThemeMode } from '@shared/types'
import { useLauncher } from '../store'
import { applyAccent, applyTheme, customBackgroundUrl } from '../lib/appearance'
import { cleanError, formatBytes, formatMemory, javaRequirement, loaderLabel } from '../lib/format'
import {
  Badge,
  EmptyState,
  IconButton,
  NumberField,
  Segmented,
  SettingSlider,
  Spinner,
  Switch
} from '../components/ui'
import { JavaAssignModal } from '../components/JavaAssignModal'
import { JvmPresetsModal } from '../components/JvmPresetsModal'
import { SearchAliasModal } from '../components/SearchAliasModal'
import { BackupManagerModal } from '../components/BackupManagerModal'
import { Avatar } from '../components/visuals'

type SectionKey = 'launch' | 'java' | 'download' | 'worlds' | 'performance' | 'appearance' | 'account'

const NAV: { key: SectionKey; label: string; icon: typeof SlidersHorizontal }[] = [
  { key: 'launch', label: '启动设置', icon: SlidersHorizontal },
  { key: 'java', label: 'Java 环境', icon: Coffee },
  { key: 'download', label: '下载设置', icon: Download },
  { key: 'worlds', label: '备份管理', icon: Archive },
  { key: 'performance', label: '性能', icon: MemoryStick },
  { key: 'appearance', label: '外观主题', icon: Palette },
  { key: 'account', label: '账户与登录', icon: ShieldCheck }
]

const JAVA_SOURCE_LABELS: Record<string, string> = {
  custom: '手动指定',
  path: 'PATH 环境',
  scan: '自动扫描',
  runtime: '启动器运行时'
}

const ACCENTS: { value: AccentName; label: string; light: string; dark: string }[] = [
  { value: 'cyan', label: '青碧', light: '#0f95a6', dark: '#5cc7d5' },
  { value: 'blue', label: '潮蓝', light: '#3b74d8', dark: '#8fb2f2' },
  { value: 'green', label: '森绿', light: '#2e8f6e', dark: '#7fc8a9' },
  { value: 'orange', label: '暖橙', light: '#c47431', dark: '#e5a26d' },
  { value: 'pink', label: '樱粉', light: '#c45a84', dark: '#efa3bf' },
  { value: 'violet', label: '藤紫', light: '#775bb4', dark: '#c0a8ef' },
  { value: 'red', label: '绛红', light: '#b54840', dark: '#ec9a91' },
  { value: 'slate', label: '石墨', light: '#59656f', dark: '#b2bec8' }
]

const THEME_OPTIONS: {
  value: ThemeMode
  label: string
  hint: string
  icon: typeof Sun
}[] = [
  { value: 'light', label: '浅色', hint: '明亮纸张', icon: Sun },
  { value: 'dark', label: '深色', hint: '夜间墨色', icon: Moon },
  { value: 'system', label: '跟随系统', hint: '跟随 Windows', icon: Monitor }
]

function SettingsSection({
  id,
  icon,
  title,
  subtitle,
  children
}: {
  id: SectionKey
  icon: ReactNode
  title: string
  subtitle: string
  children: ReactNode
}) {
  return (
    <section className="settings-section card" id={`settings-${id}`}>
      <header className="settings-section-head">
        <span className="settings-section-icon">{icon}</span>
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
      </header>
      <div className="settings-rows">{children}</div>
    </section>
  )
}

function SettingsRow({
  title,
  description,
  wide = false,
  children
}: {
  title: string
  description?: ReactNode
  wide?: boolean
  children: ReactNode
}) {
  return (
    <div className={`settings-row ${wide ? 'settings-row--wide' : ''}`}>
      <div className="settings-row-copy">
        <strong>{title}</strong>
        {description && <p>{description}</p>}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  )
}

export function SettingsPage() {
  const settings = useLauncher((state) => state.settings)
  const appInfo = useLauncher((state) => state.appInfo)
  const accounts = useLauncher((state) => state.accounts)
  const installed = useLauncher((state) => state.installed)
  const selectedId = useLauncher((state) => state.selectedVersionId)
  const javaList = useLauncher((state) => state.javaList)
  const javaLoading = useLauncher((state) => state.javaLoading)
  const tasks = useLauncher((state) => state.tasks)
  const patchSettings = useLauncher((state) => state.patchSettings)
  const refreshJava = useLauncher((state) => state.refreshJava)
  const refreshInstalled = useLauncher((state) => state.refreshInstalled)
  const refreshInstances = useLauncher((state) => state.refreshInstances)
  const downloadJava = useLauncher((state) => state.downloadJava)
  const cancelTask = useLauncher((state) => state.cancelTask)
  const setAccountModalOpen = useLauncher((state) => state.setAccountModalOpen)
  const setPresetManagerOpen = useLauncher((state) => state.setPresetManagerOpen)
  const toast = useLauncher((state) => state.toast)

  const [activeSection, setActiveSection] = useState<SectionKey>('launch')
  const [jvmArgs, setJvmArgs] = useState('')
  const [cfKey, setCfKey] = useState('')
  const [cfBase, setCfBase] = useState('')
  const [cfError, setCfError] = useState('')
  const [savingCf, setSavingCf] = useState(false)
  const [releasingMemory, setReleasingMemory] = useState(false)
  const [proxyValue, setProxyValue] = useState('')
  const [elevatingMemory, setElevatingMemory] = useState(false)
  const [javaAssignOpen, setJavaAssignOpen] = useState(false)
  const [searchAliasOpen, setSearchAliasOpen] = useState(false)
  const [backupManagerOpen, setBackupManagerOpen] = useState(false)
  const [jvmPresetsOpen, setJvmPresetsOpen] = useState(false)
  const [cacheInfo, setCacheInfo] = useState({ bytes: 0, count: 0 })
  const [clearingCache, setClearingCache] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (activeSection !== 'download') return
    void window.ccl.app
      .cacheStats()
      .then(setCacheInfo)
      .catch(() => undefined)
  }, [activeSection])

  const selected = installed.find((version) => version.id === selectedId) ?? null
  const account = accounts.accounts.find((item) => item.id === accounts.activeId) ?? null
  const totalMemory = appInfo?.totalMemoryGb ?? 16
  const memoryMax = Math.max(
    settings?.maxMemoryMb ?? 2048,
    Math.min(32768, Math.max(2048, Math.round((totalMemory * 1024) / 512) * 512))
  )
  const memoryMin = Math.min(1024, settings?.maxMemoryMb ?? 1024)
  const javaTask = tasks.find(
    (task) => task.kind === 'java' && task.versionId === selectedId && (task.status === 'running' || task.status === 'paused')
  )
  const hasCompatibleJava = selected?.javaMajor
    ? javaList.some(
        (java) =>
          java.major === selected.javaMajor ||
          (selected.javaMajor !== 8 && java.major >= (selected.javaMajor ?? 0))
      )
    : javaList.length > 0

  useEffect(() => {
    setJvmArgs(settings?.extraJvmArgs ?? '')
  }, [settings?.extraJvmArgs])

  useEffect(() => {
    setProxyValue(settings?.downloadProxy ?? '')
  }, [settings?.downloadProxy])

  useEffect(() => {
    setCfKey(settings?.curseForgeApiKey ?? '')
    setCfBase(settings?.curseForgeApiBase ?? 'https://api.curseforge.com')
  }, [settings?.curseForgeApiKey, settings?.curseForgeApiBase])

  if (!settings) return null

  const accentInfo = ACCENTS.find((accent) => accent.value === settings.accent) ?? ACCENTS[0]
  const themeLabel =
    THEME_OPTIONS.find((option) => option.value === settings.theme)?.label ?? '跟随系统'

  const chooseTheme = (value: ThemeMode) => {
    // 先落到 DOM，点击后立即能看到变化；持久化失败时由 patchSettings 回滚并提示。
    applyTheme(value)
    void patchSettings({ theme: value })
  }

  const chooseAccent = (value: AccentName) => {
    applyAccent(value)
    void patchSettings({ accent: value })
  }

  const backgroundUrl = customBackgroundUrl(settings.backgroundImage)

  const chooseBackground = async () => {
    try {
      const name = await window.ccl.settings.chooseBackground()
      if (!name) return
      const next = await patchSettings({ backgroundImage: name })
      if (next) toast('success', '背景已更新', '图片已复制到本机数据目录')
    } catch (error) {
      toast('error', '无法设置背景', cleanError(error))
    }
  }

  const clearBackground = async () => {
    const next = await patchSettings({ backgroundImage: null })
    if (next) toast('success', '已恢复默认背景')
  }

  const scrollTo = (key: SectionKey) => {
    setActiveSection(key)
    const target =
      scrollRef.current?.querySelector<HTMLElement>(`#settings-${key}`) ??
      document.getElementById(`settings-${key}`)
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const commitJvmArgs = () => {
    if (jvmArgs !== settings.extraJvmArgs) {
      void patchSettings({ extraJvmArgs: jvmArgs }).then((next) => {
        if (next) toast('success', 'JVM 参数已保存')
      })
    }
  }

  const chooseGameDir = async () => {
    const path = await window.ccl.app.pickDirectory('选择 Minecraft 游戏目录', settings.gameDir)
    if (!path) return
    const next = await patchSettings({ gameDir: path })
    if (next) {
      toast('success', '版本文件夹已切换', '已有实例会继续使用创建时绑定的文件夹')
      await Promise.all([refreshInstalled(), refreshInstances()])
      void refreshJava(true)
    }
  }

  const openGameDir = () => {
    void window.ccl.app.openPath(settings.gameDir).catch((error) => {
      toast('error', '无法打开游戏目录', cleanError(error))
    })
  }

  const chooseJava = async () => {
    const path = await window.ccl.app.pickFile('选择 java.exe', [
      { name: 'Java 可执行文件', extensions: ['exe'] }
    ])
    if (!path) return
    const next = await patchSettings({ javaPath: path })
    if (next) {
      toast('success', '已指定 Java 运行时', path)
      void refreshJava(true)
    }
  }

  const useJava = async (path: string | null) => {
    const next = await patchSettings({ javaPath: path })
    if (next) {
      toast('success', path ? '已切换 Java 运行时' : '已恢复自动管理 Java')
      void refreshJava(true)
    }
  }

  const saveCurseForge = async () => {
    const base = cfBase.trim() || 'https://api.curseforge.com'
    try {
      const url = new URL(base)
      if (url.protocol !== 'https:') throw new Error('API 地址必须是 https://')
    } catch {
      setCfError('API 地址需要是有效的 https:// 地址')
      return
    }
    setCfError('')
    setSavingCf(true)
    const next = await patchSettings({
      curseForgeApiKey: cfKey.trim(),
      curseForgeApiBase: base.replace(/\/+$/, '')
    })
    setSavingCf(false)
    if (next) toast('success', 'CurseForge 配置已保存', cfKey.trim() ? undefined : '已清空 API key')
  }

  const saveProxy = async () => {
    const next = await patchSettings({ downloadProxy: proxyValue.trim() })
    if (next) {
      toast(
        'success',
        proxyValue.trim() ? '下载代理已启用' : '已恢复直连',
        proxyValue.trim() || undefined
      )
    }
  }

  const releaseMemory = async () => {
    if (releasingMemory) return
    setReleasingMemory(true)
    try {
      const result = await window.ccl.app.releaseMemory('system')
      const freed = Math.max(0, Math.round((result.beforeKb - result.afterKb) / 1024))
      const count = result.processes ?? 0
      toast(
        'success',
        '系统内存已优化',
        freed > 0
          ? `工作集减少约 ${freed} MB${count > 0 ? `，回收了 ${count} 个进程` : ''}`
          : '当前已经比较干净'
      )
    } catch (error) {
      toast('error', '释放内存失败', cleanError(error))
    } finally {
      setReleasingMemory(false)
    }
  }

  const releaseMemoryElevated = async () => {
    if (elevatingMemory) return
    setElevatingMemory(true)
    try {
      const result = await window.ccl.app.releaseMemoryElevated()
      if (result.cancelled) {
        toast('info', '已取消提权', '深度清理没有执行')
        return
      }
      if (result.error) {
        toast('error', '深度清理失败', result.error)
        return
      }
      if (typeof result.beforeKb !== 'number' || typeof result.afterKb !== 'number') {
        toast('error', '深度清理失败', '没有拿到系统返回的结果')
        return
      }
      const freed = Math.max(0, Math.round((result.beforeKb - result.afterKb) / 1024))
      const standby = result.standby === 0 ? '待机列表已清理' : '待机列表清理失败'
      toast(
        'success',
        '深度清理完成',
        `系统工作集减少约 ${freed} MB，${standby}`
      )
    } catch (error) {
      toast('error', '深度清理失败', cleanError(error))
    } finally {
      setElevatingMemory(false)
    }
  }

  return (
    <div className="page page--settings">
      <header className="page-head settings-head">
        <div className="page-head-copy">
          <span className="page-eyebrow">
            <Wrench size={14} />
            设置
          </span>
          <h1>把风信调成你的样子</h1>
          <p>调整启动参数、Java 环境、下载策略与界面外观，所有更改会立即保存在本机。</p>
        </div>
        <div className="settings-head-badge">
          <MemoryStick size={14} />
          系统内存 {totalMemory} GB
        </div>
      </header>

      <div className="settings-layout">
        <nav className="settings-nav card" aria-label="设置分类">
          {NAV.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.key}
                type="button"
                className={`settings-nav-item ${activeSection === item.key ? 'is-active' : ''}`}
                onClick={() => scrollTo(item.key)}
              >
                <Icon size={16} />
                <span>{item.label}</span>
              </button>
            )
          })}
          <div className="settings-nav-foot">
            <span>风信启动器</span>
            <small>v{appInfo?.version ?? '—'}</small>
          </div>
        </nav>

        <div className="settings-scroll" ref={scrollRef}>
          <SettingsSection
            id="launch"
            icon={<SlidersHorizontal size={18} />}
            title="启动设置"
            subtitle="控制游戏目录、内存与启动行为"
          >
            <SettingsRow
              wide
              title="游戏目录"
              description="新下载的版本和直接启动的原版使用这个目录；已有实例会保留创建时绑定的文件夹"
            >
              <div className="path-control">
                <div className="path-box" title={settings.gameDir}>
                  <FolderOpen size={14} />
                  <span>{settings.gameDir}</span>
                </div>
                <div className="path-actions">
                  <button type="button" className="button button--soft button--sm" onClick={() => void chooseGameDir()}>
                    更换目录
                  </button>
                  <button type="button" className="button button--ghost button--sm" onClick={openGameDir}>
                    <FolderOpen size={13} />
                    打开
                  </button>
                </div>
              </div>
            </SettingsRow>

            <SettingsRow
              title="内存分配"
              description={`推荐为游戏分配 ${Math.max(2, Math.round(totalMemory / 4))}–${Math.max(4, Math.round(totalMemory / 2))} GB，过大可能导致系统卡顿`}
            >
              <SettingSlider
                ariaLabel="游戏内存分配"
                value={settings.maxMemoryMb}
                min={memoryMin}
                max={memoryMax}
                step={512}
                format={(value) => formatMemory(value)}
                onCommit={(value) => void patchSettings({ maxMemoryMb: value })}
              />
            </SettingsRow>

            <SettingsRow
              title="自定义游戏分辨率"
              description={
                settings.customResolution
                  ? `${settings.windowWidth} × ${settings.windowHeight}`
                  : '使用游戏内设置或默认窗口大小'
              }
            >
              <div className="resolution-control">
                <Switch
                  checked={settings.customResolution}
                  label="启用自定义分辨率"
                  onChange={(checked) => void patchSettings({ customResolution: checked })}
                />
                {settings.customResolution && (
                  <div className="resolution-fields">
                    <NumberField
                      ariaLabel="窗口宽度"
                      value={settings.windowWidth}
                      min={320}
                      max={7680}
                      suffix="宽"
                      onCommit={(value) => void patchSettings({ windowWidth: value })}
                    />
                    <span>×</span>
                    <NumberField
                      ariaLabel="窗口高度"
                      value={settings.windowHeight}
                      min={240}
                      max={4320}
                      suffix="高"
                      onCommit={(value) => void patchSettings({ windowHeight: value })}
                    />
                  </div>
                )}
              </div>
            </SettingsRow>

            <SettingsRow title="启动后隐藏启动器" description="游戏进程创建后自动最小化到任务栏">
              <Switch
                checked={settings.hideAfterLaunch}
                label="启动后隐藏启动器"
                onChange={(checked) => void patchSettings({ hideAfterLaunch: checked })}
              />
            </SettingsRow>

            <SettingsRow
              wide
              title="额外 JVM 参数"
              description="高级选项，留空即使用启动器默认参数。修改后离开输入框立即保存"
            >
              <textarea
                className="text-area"
                rows={3}
                value={jvmArgs}
                placeholder="例如：-XX:+UseG1GC -Dfile.encoding=UTF-8"
                spellCheck={false}
                onChange={(event) => setJvmArgs(event.target.value)}
                onBlur={commitJvmArgs}
              />
              <div className="jvm-preset-actions">
                <span>常用 G1GC / ZGC 参数可以直接套用</span>
                <button
                  type="button"
                  className="button button--ghost button--sm"
                  onClick={() => setJvmPresetsOpen(true)}
                >
                  <SlidersHorizontal size={13} />
                  JVM 预设
                </button>
              </div>
            </SettingsRow>

            <div className="settings-tip">
              <Info size={14} />
              <span>
                当前启动：{formatMemory(settings.maxMemoryMb)} 内存 ·{' '}
                {settings.extraJvmArgs ? '已添加自定义 JVM 参数' : '默认 JVM 参数'}
              </span>
            </div>
          </SettingsSection>

          <SettingsSection
            id="java"
            icon={<Coffee size={18} />}
            title="Java 环境"
            subtitle="选择或自动下载运行 Minecraft 所需的 Java"
          >
            <SettingsRow
              title="自动下载 Java 运行时"
              description="缺少合适版本时，从 Mojang 官方渠道获取对应运行时"
            >
              <Switch
                checked={settings.autoJava}
                label="自动下载 Java"
                onChange={(checked) => void patchSettings({ autoJava: checked })}
              />
            </SettingsRow>

            <SettingsRow
              wide
              title="自动分配实例 Java"
              description="按每个实例需要的 Java 版本挑选现有运行时，并写入实例设置"
            >
              <button
                type="button"
                className="button button--primary button--sm"
                onClick={() => setJavaAssignOpen(true)}
              >
                <WandSparkles size={13} />
                自动分配
              </button>
            </SettingsRow>

            <SettingsRow wide title="Java 路径" description="留空则由启动器自动管理">
              <div className="path-control">
                <div className={`path-box ${settings.javaPath ? '' : 'is-muted'}`} title={settings.javaPath ?? undefined}>
                  <Coffee size={14} />
                  <span>{settings.javaPath ?? '自动选择最合适的 Java 运行时'}</span>
                </div>
                <div className="path-actions">
                  <button type="button" className="button button--soft button--sm" onClick={() => void chooseJava()}>
                    选择 java.exe
                  </button>
                  {settings.javaPath && (
                    <button
                      type="button"
                      className="button button--ghost button--sm"
                      onClick={() => void useJava(null)}
                    >
                      恢复自动
                    </button>
                  )}
                </div>
              </div>
            </SettingsRow>

            {selected?.javaMajor && (
              <div className={`java-requirement ${hasCompatibleJava ? 'is-ready' : ''}`}>
                <span className="java-requirement-icon">
                  {hasCompatibleJava ? <Check size={17} /> : <Cpu size={17} />}
                </span>
                <div className="java-requirement-copy">
                  <strong>
                    {selected.id}
                    {selected.loader ? ` · ${loaderLabel(selected.loader)}` : ''} 需要 {javaRequirement(selected.javaMajor)}
                  </strong>
                  <p>
                    {javaTask
                      ? `${javaTask.stage} · ${Math.round(javaTask.progress)}%`
                      : hasCompatibleJava
                        ? '已经在系统中找到兼容的 Java 运行时'
                        : settings.autoJava
                          ? '启动游戏时会自动下载，也可以现在提前准备'
                          : '未找到兼容 Java，自动下载已关闭，请手动指定或下载运行时'}
                  </p>
                  {javaTask && (
                    <div className="java-requirement-progress">
                      <div className="mini-progress">
                        <span style={{ width: `${javaTask.progress}%` }} />
                      </div>
                      <button type="button" className="link-button" onClick={() => void cancelTask(javaTask.id)}>
                        取消
                      </button>
                    </div>
                  )}
                </div>
                {!hasCompatibleJava && !javaTask && (
                  <button
                    type="button"
                    className="button button--primary button--sm"
                    onClick={() => void downloadJava(selected.id)}
                  >
                    <Download size={13} />
                    下载 Java {selected.javaMajor}
                  </button>
                )}
                {hasCompatibleJava && <Badge tone="success">已就绪</Badge>}
              </div>
            )}

            <div className="java-list-head">
              <div>
                <strong>已检测到的 Java</strong>
                <span>{javaLoading ? '正在扫描…' : `${javaList.length} 个运行时`}</span>
              </div>
              <IconButton
                label="重新扫描 Java"
                tone="soft"
                disabled={javaLoading}
                onClick={() => void refreshJava(true)}
              >
                <RefreshCw size={14} className={javaLoading ? 'spin' : ''} />
              </IconButton>
            </div>

            <div className="java-list">
              {javaLoading && javaList.length === 0 && (
                <div className="java-loading">
                  <Spinner size={16} />
                  正在扫描系统中的 Java…
                </div>
              )}
              {!javaLoading && javaList.length === 0 && (
                <EmptyState
                  icon={<Coffee size={22} />}
                  title="没有检测到 Java"
                  description="开启自动下载，或手动选择 java.exe。启动游戏时也会自动准备。"
                />
              )}
              {javaList.map((java) => {
                const pinned = settings.javaPath === java.path
                return (
                  <div key={java.path} className={`java-item ${pinned ? 'is-pinned' : ''}`}>
                    <span className="java-item-icon">J{java.major}</span>
                    <div className="java-item-copy">
                      <strong title={java.path}>{java.path}</strong>
                      <span>
                        Java {java.version} · {java.vendor} · {java.arch} ·{' '}
                        {JAVA_SOURCE_LABELS[java.source] ?? java.source}
                      </span>
                    </div>
                    {pinned ? (
                      <Badge tone="accent">
                        <Check size={11} />
                        已指定
                      </Badge>
                    ) : (
                      <button
                        type="button"
                        className="button button--ghost button--xs"
                        onClick={() => void useJava(java.path)}
                      >
                        使用
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </SettingsSection>

          <SettingsSection
            id="download"
            icon={<Download size={18} />}
            title="下载设置"
            subtitle="选择下载源并调整并发下载数量"
          >
            <SettingsRow
              wide
              title="下载源"
              description="镜像源通常在中国大陆网络下更快，下载完成后都会校验文件完整性"
            >
              <div className="download-source-setting">
                <Segmented
                  value={settings.source}
                  options={[
                    { value: 'mirror', label: 'BMCLAPI 镜像' },
                    { value: 'official', label: 'Mojang 官方' }
                  ]}
                  onChange={(value) => {
                    void patchSettings({ source: value })
                  }}
                />
                <p className="source-description">
                  <Globe size={13} />
                  {settings.source === 'mirror'
                    ? '使用 BMCLAPI 加速线路，兼容官方版本元数据与校验值。'
                    : '直接连接 Mojang 官方服务器，适合海外网络环境。'}
                </p>
              </div>
            </SettingsRow>

            <SettingsRow
              title="Modrinth 镜像加速"
              description="通过第三方 MCI 镜像下载 Modrinth 文件；失败会自动回退官方 CDN"
            >
              <Switch
                checked={settings.modrinthMirror}
                label="Modrinth 镜像加速"
                onChange={(value) => void patchSettings({ modrinthMirror: value })}
              />
            </SettingsRow>

            <SettingsRow
              title="并发下载数"
              description="同时进行的文件下载数量，过高可能被网络环境限制"
            >
              <SettingSlider
                ariaLabel="下载并发数量"
                value={settings.downloadConcurrency}
                min={4}
                max={64}
                step={4}
                format={(value) => `${value} 个`}
                onCommit={(value) => void patchSettings({ downloadConcurrency: value })}
              />
            </SettingsRow>

            <SettingsRow
              wide
              title="下载代理"
              description="可选。填本地 HTTP 代理地址（例如 http://127.0.0.1:7890）可让 Modrinth / CurseForge 走代理；留空直连"
            >
              <div className="settings-inline proxy-setting">
                <div className="text-input">
                  <input
                    value={proxyValue}
                    placeholder="http://127.0.0.1:7890"
                    spellCheck={false}
                    onChange={(event) => setProxyValue(event.target.value)}
                  />
                </div>
                <button type="button" className="button button--soft button--sm" onClick={() => void saveProxy()}>
                  保存
                </button>
              </div>
            </SettingsRow>

            <SettingsRow
              wide
              title="下载缓存"
              description="按 SHA1 复用已下载文件；超过上限会优先清理最久未使用的对象"
            >
              <div className="cache-control">
                <div className="cache-summary">
                  <span>{formatBytes(cacheInfo.bytes)}</span>
                  <small>{cacheInfo.count} 个缓存文件</small>
                </div>
                <SettingSlider
                  ariaLabel="下载缓存上限"
                  value={settings.cacheLimitMb}
                  min={0}
                  max={32768}
                  step={512}
                  format={(value) => (value === 0 ? '不限制' : `${value} MB`)}
                  onCommit={(value) => {
                    void patchSettings({ cacheLimitMb: value }).then(() => {
                      void window.ccl.app.cacheStats().then(setCacheInfo)
                    })
                  }}
                />
                <button
                  type="button"
                  className="button button--soft button--sm"
                  disabled={clearingCache || cacheInfo.count === 0}
                  onClick={async () => {
                    setClearingCache(true)
                    try {
                      await window.ccl.app.clearCache()
                      setCacheInfo({ bytes: 0, count: 0 })
                      toast('success', '下载缓存已清理')
                    } catch (error) {
                      toast('error', '无法清理缓存', cleanError(error))
                    } finally {
                      setClearingCache(false)
                    }
                  }}
                >
                  {clearingCache ? <Spinner size={12} /> : <Trash2 size={12} />}
                  清理缓存
                </button>
              </div>
            </SettingsRow>

            <SettingsRow
              wide
              title="CurseForge API"
              description="模组搜索与下载使用你自己的 CurseForge API key；如使用自建代理，可修改 API 地址"
            >
              <div className="curseforge-config">
                <div className="form-field">
                  <span className="form-label">数据源</span>
                  <Segmented
                    value={settings.curseForgeUseMirror ? 'mcim' : 'official'}
                    options={[
                      { value: 'official', label: '官方 API' },
                      { value: 'mcim', label: 'MCIM 镜像' }
                    ]}
                    onChange={(value) =>
                      void patchSettings({ curseForgeUseMirror: value === 'mcim' })
                    }
                  />
                  <span className="form-hint">
                    {settings.curseForgeUseMirror
                      ? '社区镜像 mod.mcimirror.top，不需要 key，可能不稳定；下载不计入作者收益'
                      : '官方接口，使用内置或你填写的 key'}
                  </span>
                </div>
                <label className="form-field">
                  <span className="form-label">API key</span>
                  <div className="text-input">
                    <input
                      type="password"
                      value={cfKey}
                      placeholder="已内置默认 key，可填写覆盖"
                      spellCheck={false}
                      onChange={(event) => setCfKey(event.target.value)}
                    />
                  </div>
                </label>
                <label className="form-field">
                  <span className="form-label">API 地址</span>
                  <div className="text-input">
                    <input
                      value={cfBase}
                      placeholder="https://api.curseforge.com"
                      spellCheck={false}
                      onChange={(event) => setCfBase(event.target.value)}
                    />
                  </div>
                </label>
                <button type="button" className="button button--soft button--sm" disabled={savingCf} onClick={() => void saveCurseForge()}>
                  {savingCf ? <Spinner size={13} /> : <KeyRound size={13} />}
                  保存 CurseForge 配置
                </button>
                {cfError && <span className="form-error">{cfError}</span>}
                <span className="form-hint">
                  默认使用安装包内置的 key，留空也会回退到它；填写则覆盖。key 只保存在本机配置中，内置 key 会随安装包分发。
                </span>
              </div>
            </SettingsRow>

            <SettingsRow
              title="CurseForge 兼容下载"
              description="作者禁止第三方分发时，用文件 ID 拼接官方 CDN 地址并校验 SHA1 下载；开启后整合包不再弹出手动补齐窗口"
            >
              <Switch
                checked={settings.curseForgeCompatDownloads}
                label="CurseForge 兼容下载"
                onChange={(value) => void patchSettings({ curseForgeCompatDownloads: value })}
              />
            </SettingsRow>

            <SettingsRow
              title="中文搜索别名"
              description="内置索引未收录的中文名，可以粘贴 MC百科 class 模组页链接加入本地搜索；也支持 scripts/mcmod-alias-import 生成的 mod-aliases.json 批量表，只读取 class 页面，不抓取搜索页"
            >
              <button
                type="button"
                className="button button--soft button--sm"
                onClick={() => setSearchAliasOpen(true)}
              >
                <Link2 size={13} />
                管理别名
              </button>
            </SettingsRow>

            <SettingsRow
              title="预设模组"
              description="安装整合包后核对常用模组是否包含；可以每次询问，也可以自动补齐缺失项"
            >
              <button
                type="button"
                className="button button--soft button--sm"
                onClick={() => setPresetManagerOpen(true)}
              >
                <Sparkles size={13} />
                管理预设
              </button>
            </SettingsRow>

            <div className="settings-tip">
              <HardDrive size={14} />
              <span>下载的文件会跳过已经完整校验的资源，重复安装只会补齐缺失部分。</span>
            </div>
          </SettingsSection>

          <SettingsSection
            id="worlds"
            icon={<Archive size={18} />}
            title="备份管理"
            subtitle="世界、KubeJS 历史与内容更新备份统一保留、统计和清理"
          >
            <SettingsRow
              title="加载器/整合包更新前自动备份"
              description="更新或回滚加载器、升级整合包前，先把实例中的所有存档复制到备份仓库；备份失败会阻止本次更新"
            >
              <Switch
                checked={settings.autoWorldBackup}
                label="加载器/整合包更新前自动备份"
                onChange={(value) => void patchSettings({ autoWorldBackup: value })}
              />
            </SettingsRow>
            <SettingsRow
              title="世界备份保留份数"
              description="手动、加载器更新、恢复前三类各自计数，超出后只删除该类型最旧的备份；不会跨类型挤掉手动备份"
            >
              <SettingSlider
                ariaLabel="每种世界备份保留的份数"
                value={settings.worldBackupLimit}
                min={1}
                max={30}
                step={1}
                format={(value) => `${value} 份`}
                onCommit={(value) => void patchSettings({ worldBackupLimit: value })}
              />
            </SettingsRow>
            <SettingsRow
              title="KubeJS 历史保留份数"
              description="每个 KubeJS 文件保留最近几份历史快照；保存脚本时自动清理更早的记录"
            >
              <NumberField
                ariaLabel="每个 KubeJS 文件保留的历史份数"
                value={settings.kubeJsBackupLimit}
                min={1}
                max={500}
                suffix="份 / 文件"
                onCommit={(value) => void patchSettings({ kubeJsBackupLimit: value })}
              />
            </SettingsRow>
            <SettingsRow
              title="内容更新备份保留份数"
              description="每个实例保留最近几次模组/资源包/数据包更新的原文件备份；清理后对应更新将无法回滚"
            >
              <NumberField
                ariaLabel="每个实例保留的内容更新备份份数"
                value={settings.contentBackupLimit}
                min={1}
                max={30}
                suffix="份 / 实例"
                onCommit={(value) => void patchSettings({ contentBackupLimit: value })}
              />
            </SettingsRow>
            <SettingsRow
              title="最长保留天数"
              description="超过天数的世界、KubeJS 和内容备份会在下次备份或按策略清理时删除；0 表示不按天数清理"
            >
              <NumberField
                ariaLabel="备份最长保留天数"
                value={settings.backupMaxAgeDays}
                min={0}
                max={3650}
                suffix="天"
                onCommit={(value) => void patchSettings({ backupMaxAgeDays: value })}
              />
            </SettingsRow>
            <SettingsRow
              title="备份占用与清理"
              description="查看每个实例三类备份的实际大小，按当前策略清理，或删除指定天数前/全部备份"
            >
              <button
                type="button"
                className="button button--soft button--sm"
                onClick={() => setBackupManagerOpen(true)}
              >
                <DatabaseBackup size={13} />
                打开备份管理
              </button>
            </SettingsRow>
            <div className="settings-tip">
              <Archive size={14} />
              <span>
                备份保存在实例目录的 backups 下，不会上传；删除实例会连同其备份一起删除。世界备份可在实例卡片「存档」里逐个恢复；加载器回滚使用 versions 里的旧档案，可在首页「清理」中回收。
              </span>
            </div>
          </SettingsSection>

          <SettingsSection
            id="performance"
            icon={<MemoryStick size={18} />}
            title="性能"
            subtitle="控制渲染方式与内存占用"
          >
            <SettingsRow
              title="省内存模式"
              description="关闭硬件加速并让后台窗口尽快回收内存，重启后生效；占用更低，滚动与透明效果可能略逊"
            >
              <div className="settings-inline">
                <Switch
                  checked={settings.memorySaver}
                  label="省内存模式"
                  onChange={(value) => void patchSettings({ memorySaver: value })}
                />
                <button
                  type="button"
                  className="button button--ghost button--sm"
                  onClick={() => void window.ccl.app.restart()}
                >
                  重启生效
                </button>
              </div>
            </SettingsRow>
            <SettingsRow
              title="优化系统内存"
              description="回收系统内可访问进程的工作集；深度清理会申请管理员权限，额外清理待机与已修改内存列表。回收的是工作集，继续使用会逐步回涨，游戏运行时不建议使用"
            >
              <div className="settings-inline">
                <button
                  type="button"
                  className="button button--ghost button--sm"
                  disabled={releasingMemory}
                  onClick={() => void releaseMemory()}
                >
                  {releasingMemory ? <Spinner size={13} /> : <RefreshCw size={13} />}
                  优化系统内存
                </button>
                <button
                  type="button"
                  className="button button--primary button--sm"
                  disabled={elevatingMemory}
                  onClick={() => void releaseMemoryElevated()}
                >
                  {elevatingMemory ? <Spinner size={13} /> : <ShieldCheck size={13} />}
                  深度清理（管理员）
                </button>
              </div>
            </SettingsRow>
          </SettingsSection>

          <SettingsSection
            id="appearance"
            icon={<Palette size={18} />}
            title="外观主题"
            subtitle="选择适合当前环境的配色方案"
          >
            <SettingsRow
              wide
              title="效果预览"
              description="切换主题或主题色后，下面的样例会立即更新"
            >
              <div className="appearance-preview" aria-hidden="true">
                <div className="appearance-preview-chrome">
                  <span className="appearance-preview-brand">
                    <span className="appearance-preview-logo" />
                    风信
                  </span>
                  <span className="appearance-preview-nav">
                    <i className="is-active">启动</i>
                    <i>实例</i>
                    <i>下载</i>
                    <i>设置</i>
                  </span>
                  <span className="appearance-preview-dots">
                    <i />
                    <i />
                    <i />
                  </span>
                </div>
                <div className="appearance-preview-body">
                  <span className="appearance-preview-side">
                    <i className="is-active">
                      <b />
                      启动
                    </i>
                    <i>
                      <b />
                      实例
                    </i>
                    <i>
                      <b />
                      下载
                    </i>
                    <i>
                      <b />
                      设置
                    </i>
                  </span>
                  <span className="appearance-preview-main">
                    <small>
                      {themeLabel} · {accentInfo.label}
                    </small>
                    <strong>风有信 · 月无边</strong>
                    <em>按钮、开关和强调色都会跟随当前主题色。</em>
                    <span className="appearance-preview-actions">
                      <i className="appearance-preview-cta">启动游戏</i>
                      <i className="appearance-preview-toggle">
                        <b />
                      </i>
                      <i className="appearance-preview-tag">整合包</i>
                    </span>
                    <span className="appearance-preview-meter">
                      <i />
                    </span>
                  </span>
                </div>
              </div>
            </SettingsRow>

            <SettingsRow
              wide
              title="界面主题"
              description="跟随系统会随 Windows 的深浅色设置自动切换"
            >
              <div className="theme-tiles" role="group" aria-label="界面主题">
                {THEME_OPTIONS.map((option) => {
                  const Icon = option.icon
                  const active = settings.theme === option.value
                  return (
                    <button
                      key={option.value}
                      type="button"
                      className={`theme-tile ${active ? 'is-active' : ''}`}
                      style={
                        {
                          '--tile-accent': accentInfo.light,
                          '--tile-accent-dark': accentInfo.dark
                        } as React.CSSProperties
                      }
                      aria-pressed={active}
                      onClick={() => chooseTheme(option.value)}
                    >
                      <span className={`theme-tile-shot theme-tile-shot--${option.value}`}>
                        <span className="theme-tile-bar" />
                        <span className="theme-tile-canvas">
                          <span className="theme-tile-side" />
                          <span className="theme-tile-main">
                            <span className="theme-tile-line theme-tile-line--title" />
                            <span className="theme-tile-line" />
                            <span className="theme-tile-button" />
                          </span>
                        </span>
                      </span>
                      <span className="theme-tile-meta">
                        <span>
                          <Icon size={13} />
                          {option.label}
                        </span>
                        {active && <Check size={13} strokeWidth={3} />}
                      </span>
                      <span className="theme-tile-hint">{option.hint}</span>
                    </button>
                  )
                })}
              </div>
            </SettingsRow>

            <SettingsRow title="主题色" description="用于按钮、强调文字与状态高亮的颜色">
              <div className="accent-swatches">
                {ACCENTS.map((accent) => (
                  <button
                    key={accent.value}
                    type="button"
                    className={`accent-swatch ${settings.accent === accent.value ? 'is-active' : ''}`}
                    style={
                      {
                        '--swatch': accent.light,
                        '--swatch-dark': accent.dark
                      } as React.CSSProperties
                    }
                    title={accent.label}
                    aria-label={`主题色：${accent.label}`}
                    aria-pressed={settings.accent === accent.value}
                    onClick={() => chooseAccent(accent.value)}
                  >
                    {settings.accent === accent.value && <Check size={13} strokeWidth={3} />}
                  </button>
                ))}
                <span className="accent-name">
                  <strong>{accentInfo.label}</strong>
                  <em>当前主题色</em>
                </span>
              </div>
            </SettingsRow>

            <SettingsRow
              title="主页布局"
              description="精简版保留单主卡和一个列表；工作台保留上一版三栏布局"
            >
              <Segmented
                size="sm"
                value={settings.homeLayout}
                options={[
                  { value: 'simple', label: '精简' },
                  { value: 'classic', label: '工作台' }
                ]}
                onChange={(value) => void patchSettings({ homeLayout: value as HomeLayout })}
              />
            </SettingsRow>

            <SettingsRow
              wide
              title="自定义背景"
              description="选一张本地图片作为启动器背景；图片会复制到本机数据目录，重启后继续使用"
            >
              <div className="custom-bg-settings">
                <div
                  className={`custom-bg-preview ${backgroundUrl ? 'has-image' : ''}`}
                  style={backgroundUrl ? { backgroundImage: `url("${backgroundUrl}")` } : undefined}
                  aria-hidden="true"
                >
                  {!backgroundUrl && (
                    <>
                      <ImagePlus size={20} />
                      <span>未选择背景</span>
                    </>
                  )}
                </div>
                <div className="custom-bg-controls">
                  <div className="custom-bg-actions">
                    <button
                      type="button"
                      className="button button--soft button--sm"
                      onClick={() => void chooseBackground()}
                    >
                      <ImagePlus size={13} />
                      {backgroundUrl ? '更换图片' : '选择图片'}
                    </button>
                    {backgroundUrl && (
                      <button
                        type="button"
                        className="button button--ghost button--sm"
                        onClick={() => void clearBackground()}
                      >
                        <Trash2 size={13} />
                        移除背景
                      </button>
                    )}
                  </div>
                  <label className="custom-bg-slider">
                    <span>遮罩</span>
                    <SettingSlider
                      ariaLabel="背景遮罩强度"
                      value={settings.backgroundDim}
                      min={0}
                      max={80}
                      step={5}
                      format={(value) => `${value}%`}
                      onCommit={(value) => void patchSettings({ backgroundDim: value })}
                    />
                  </label>
                  <label className="custom-bg-slider">
                    <span>模糊</span>
                    <SettingSlider
                      ariaLabel="背景模糊半径"
                      value={settings.backgroundBlur}
                      min={0}
                      max={24}
                      step={2}
                      format={(value) => `${value}px`}
                      onCommit={(value) => void patchSettings({ backgroundBlur: value })}
                    />
                  </label>
                  <p className="custom-bg-hint">
                    建议使用 16:9 横图；遮罩越高越容易阅读，模糊会稍微增加内存占用。
                  </p>
                </div>
              </div>
            </SettingsRow>

            <div className="appearance-note">
              <Info size={13} />
              <span>切换会立即生效并写入本机配置，下次启动继续使用。</span>
            </div>
          </SettingsSection>

          <SettingsSection
            id="account"
            icon={<ShieldCheck size={18} />}
            title="账户与登录"
            subtitle="管理启动游戏使用的账户与微软登录配置"
          >
            <SettingsRow wide title="当前账户" description="启动游戏时会使用这个账户的玩家身份">
              {account ? (
                <div className="settings-account">
                  <Avatar name={account.name} seed={account.uuid} uuid={account.uuid} type={account.type} size={38} />
                  <div className="settings-account-copy">
                    <strong>{account.name}</strong>
                    <span>{account.type === 'microsoft' ? '微软正版账户' : '离线账户'}</span>
                  </div>
                  <Badge tone={account.type === 'microsoft' ? 'accent' : 'neutral'}>
                    {account.type === 'microsoft' ? 'Microsoft' : '离线'}
                  </Badge>
                  <button
                    type="button"
                    className="button button--soft button--sm"
                    onClick={() => setAccountModalOpen(true)}
                  >
                    <UserRound size={13} />
                    管理账户
                  </button>
                </div>
              ) : (
                <div className="settings-account is-empty">
                  <span className="settings-account-placeholder">
                    <UserRound size={18} />
                  </span>
                  <div className="settings-account-copy">
                    <strong>尚未添加账户</strong>
                    <span>添加离线账户或登录微软账户后即可启动游戏</span>
                  </div>
                  <button
                    type="button"
                    className="button button--primary button--sm"
                    onClick={() => setAccountModalOpen(true)}
                  >
                    添加账户
                  </button>
                </div>
              )}
            </SettingsRow>

          </SettingsSection>

          <div className="settings-footer-note">
            <Info size={13} />
            设置保存在 {appInfo?.configDir ?? '本机应用数据目录'}
          </div>
        </div>
      </div>
      <JavaAssignModal open={javaAssignOpen} onClose={() => setJavaAssignOpen(false)} />
      <SearchAliasModal
        open={searchAliasOpen}
        onClose={() => setSearchAliasOpen(false)}
      />
      <BackupManagerModal
        open={backupManagerOpen}
        onClose={() => setBackupManagerOpen(false)}
      />
      <JvmPresetsModal
        open={jvmPresetsOpen}
        currentArgs={jvmArgs}
        onClose={() => setJvmPresetsOpen(false)}
        onApply={(args, name) => {
          setJvmArgs(args)
          void patchSettings({ extraJvmArgs: args }).then((next) => {
            if (next) toast('success', '已套用 JVM 预设', name)
          })
        }}
      />
    </div>
  )
}
