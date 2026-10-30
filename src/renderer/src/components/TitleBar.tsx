import {
  Boxes,
  ChevronDown,
  Copy,
  Download,
  Ellipsis,
  Minus,
  Moon,
  Play,
  Search,
  Server,
  Settings,
  Square,
  Sun,
  Terminal,
  UserPlus,
  X
} from 'lucide-react'
import { useLauncher, type PageKey } from '../store'
import { applyTheme, resolveDarkTheme } from '../lib/appearance'
import { Avatar, Logo } from './visuals'

const NAV_ITEMS: { key: PageKey; label: string; icon: typeof Play }[] = [
  { key: 'home', label: '启动', icon: Play },
  { key: 'instances', label: '实例', icon: Boxes },
  { key: 'servers', label: '服务器', icon: Server },
  { key: 'downloads', label: '下载', icon: Download },
  { key: 'settings', label: '设置', icon: Settings },
  { key: 'more', label: '更多', icon: Ellipsis }
]

export function TitleBar() {
  const page = useLauncher((state) => state.page)
  const setPage = useLauncher((state) => state.setPage)
  const settings = useLauncher((state) => state.settings)
  const accounts = useLauncher((state) => state.accounts)
  const launch = useLauncher((state) => state.launch)
  const update = useLauncher((state) => state.updateState)
  const maximized = useLauncher((state) => state.maximized)
  const consoleOpen = useLauncher((state) => state.consoleOpen)
  const setAccountModalOpen = useLauncher((state) => state.setAccountModalOpen)
  const patchSettings = useLauncher((state) => state.patchSettings)
  const openConsole = useLauncher((state) => state.openConsole)
  const closeConsole = useLauncher((state) => state.closeConsole)

  const activeAccount = accounts.accounts.find((account) => account.id === accounts.activeId) ?? null
  const dark = resolveDarkTheme(settings?.theme)
  const launchActive =
    launch.status === 'preparing' || launch.status === 'starting' || launch.status === 'running'
  const updateAttention =
    Boolean(update.info) &&
    ['available', 'downloading', 'verifying', 'ready', 'cancelled', 'installing', 'error'].includes(
      update.phase
    )

  const handleTitleBarDoubleClick = (event: React.MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement
    if (target.closest('button, input, select, textarea, [data-no-drag]')) return
    void window.ccl.window.toggleMaximize()
  }

  return (
    <header className="titlebar" onDoubleClick={handleTitleBarDoubleClick}>
      <div className="titlebar-brand">
        <Logo size={30} />
        <div className="brand-text">
          <strong>风信启动器</strong>
          <span>WINDLETTER</span>
        </div>
      </div>

      <nav className="titlebar-nav" aria-label="主导航">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.key}
              type="button"
              className={`nav-item ${page === item.key ? 'is-active' : ''}`}
              title={item.key === 'more' && updateAttention ? '更多 · 有可用更新' : item.label}
              onClick={() => setPage(item.key)}
            >
              <Icon size={15} strokeWidth={2.2} />
              <span>{item.label}</span>
              {item.key === 'more' && updateAttention && (
                <span className="nav-update-dot" aria-label="有可用更新" />
              )}
            </button>
          )
        })}
      </nav>

      <div className="titlebar-right">
        <button
          type="button"
          className="titlebar-account"
          onClick={() => setAccountModalOpen(true)}
          title="管理账户"
        >
          {activeAccount ? (
            <Avatar name={activeAccount.name} seed={activeAccount.uuid} uuid={activeAccount.uuid} type={activeAccount.type} size={28} />
          ) : (
            <span className="titlebar-account-empty">
              <UserPlus size={15} />
            </span>
          )}
          <span className="titlebar-account-text">
            <strong>{activeAccount?.name ?? '未登录'}</strong>
            <small>{activeAccount ? (activeAccount.type === 'microsoft' ? '微软账户' : '离线账户') : '添加账户'}</small>
          </span>
          <ChevronDown size={13} className="titlebar-account-chevron" />
        </button>

        <div className="titlebar-tools">
          <button
            type="button"
            className="titlebar-tool"
            aria-label="命令面板"
            aria-keyshortcuts="Control+K"
            title="命令面板（Ctrl+K）"
            onClick={() => window.dispatchEvent(new Event('windletter:command-palette'))}
          >
            <Search size={16} />
          </button>
          <button
            type="button"
            className={`titlebar-tool ${consoleOpen ? 'is-active' : ''}`}
            aria-label={consoleOpen ? '关闭日志控制台' : '打开日志控制台'}
            title="日志控制台"
            onClick={() => (consoleOpen ? closeConsole() : openConsole('launch'))}
          >
            <Terminal size={16} />
            {launchActive && <span className="tool-live-dot" />}
          </button>
          <button
            type="button"
            className="titlebar-tool"
            aria-label="切换明暗主题"
            title="切换明暗主题"
            onClick={() => {
              const next = dark ? 'light' : 'dark'
              applyTheme(next)
              void patchSettings({ theme: next })
            }}
          >
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>

        <div className="window-controls">
          <button
            type="button"
            className="window-control"
            aria-label="最小化"
            title="最小化"
            onClick={() => void window.ccl.window.minimize()}
          >
            <Minus size={15} />
          </button>
          <button
            type="button"
            className="window-control"
            aria-label={maximized ? '还原窗口' : '最大化'}
            title={maximized ? '还原窗口' : '最大化'}
            onClick={() => void window.ccl.window.toggleMaximize()}
          >
            {maximized ? <Copy size={13} /> : <Square size={12} />}
          </button>
          <button
            type="button"
            className="window-control window-control--close"
            aria-label="关闭"
            title="关闭"
            onClick={() => void window.ccl.window.close()}
          >
            <X size={16} />
          </button>
        </div>
      </div>
    </header>
  )
}
