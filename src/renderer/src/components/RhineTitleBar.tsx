import { useEffect, useState } from 'react'
import { Copy, Minus, Moon, Search, Square, Sun, Terminal, UserPlus, X } from 'lucide-react'
import { useLauncher, type PageKey } from '../store'
import { applyTheme, resolveDarkTheme } from '../lib/appearance'
import { Avatar } from './visuals'
import { formatBytes } from '../lib/format'

const NAV_ITEMS: { key: PageKey; label: string; en: string; num: string }[] = [
  { key: 'home', label: '启动', en: 'LAUNCH', num: '01' },
  { key: 'instances', label: '实例', en: 'ARCHIVE', num: '02' },
  { key: 'servers', label: '服务器', en: 'NODES', num: '03' },
  { key: 'downloads', label: '下载', en: 'ACQUIRE', num: '04' },
  { key: 'settings', label: '设置', en: 'CONFIG', num: '05' },
  { key: 'more', label: '更多', en: 'AUX', num: '06' }
]

function clockParts(date: Date): { time: string; seconds: string } {
  return {
    time: date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }),
    seconds: String(date.getSeconds()).padStart(2, '0').slice(0, 1)
  }
}

function dateText(date: Date): string {
  const weekday = date.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()
  const month = date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()
  return `${weekday} · ${String(date.getDate()).padStart(2, '0')} ${month} ${date.getFullYear()}`
}

export function RhineTitleBar() {
  const page = useLauncher((state) => state.page)
  const setPage = useLauncher((state) => state.setPage)
  const settings = useLauncher((state) => state.settings)
  const appInfo = useLauncher((state) => state.appInfo)
  const accounts = useLauncher((state) => state.accounts)
  const launch = useLauncher((state) => state.launch)
  const tasks = useLauncher((state) => state.tasks)
  const update = useLauncher((state) => state.updateState)
  const maximized = useLauncher((state) => state.maximized)
  const consoleOpen = useLauncher((state) => state.consoleOpen)
  const setAccountModalOpen = useLauncher((state) => state.setAccountModalOpen)
  const patchSettings = useLauncher((state) => state.patchSettings)
  const openConsole = useLauncher((state) => state.openConsole)
  const closeConsole = useLauncher((state) => state.closeConsole)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 15_000)
    return () => window.clearInterval(timer)
  }, [])

  const account = accounts.accounts.find((item) => item.id === accounts.activeId) ?? null
  const dark = resolveDarkTheme(settings?.theme)
  const launchActive = ['preparing', 'starting', 'running'].includes(launch.status)
  const activeTasks = tasks.filter((task) => task.status === 'running' || task.status === 'paused')
  const updateAttention =
    Boolean(update.info) &&
    ['available', 'downloading', 'verifying', 'ready', 'cancelled', 'installing', 'error'].includes(
      update.phase
    )
  const active = NAV_ITEMS.find((item) => item.key === page) ?? NAV_ITEMS[0]
  const clock = clockParts(now)

  const handleDoubleClick = (event: React.MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('button, input, select, textarea, [data-no-drag]')) return
    void window.ccl.window.toggleMaximize()
  }

  return (
    <>
      <header className="rhine-topbar" onDoubleClick={handleDoubleClick}>
        <div className="rhine-brand">
          <span className="rhine-mark" aria-hidden="true" />
          <div>
            <strong>月月月</strong>
            <span>LUNAR TERMINAL · SYNTHESIZE INFORMATION</span>
          </div>
        </div>
        <div className="rhine-top-right" data-no-drag>
          <div className="rhine-signal" aria-hidden="true">
            <i /><i /><i /><span>SECURE LINK</span>
          </div>
          <div className="rhine-tools">
            <button type="button" className="rhine-tool" aria-label="命令面板" title="命令面板（Ctrl+K）" onClick={() => window.dispatchEvent(new Event('windletter:command-palette'))}><Search size={14} /></button>
            <button type="button" className={`rhine-tool ${consoleOpen ? 'is-active' : ''}`} aria-label={consoleOpen ? '关闭日志控制台' : '打开日志控制台'} title="日志控制台" onClick={() => (consoleOpen ? closeConsole() : openConsole('launch'))}><Terminal size={14} />{launchActive && <span className="rhine-tool-dot" />}</button>
            <button type="button" className="rhine-tool" aria-label="切换明暗主题" title="切换明暗主题" onClick={() => { const next = dark ? 'light' : 'dark'; applyTheme(next); void patchSettings({ theme: next }) }}>{dark ? <Sun size={14} /> : <Moon size={14} />}</button>
          </div>
          <div className="rhine-clock">{clock.time}<small>{clock.seconds}</small></div>
          <div className="rhine-date"><b>{dateText(now)}</b><span>TERMINAL / LUNAR-{active.en}</span></div>
          <div className="rhine-window-controls">
            <button type="button" className="rhine-window-control" aria-label="最小化" title="最小化" onClick={() => void window.ccl.window.minimize()}><Minus size={13} /></button>
            <button type="button" className="rhine-window-control" aria-label={maximized ? '还原窗口' : '最大化'} title={maximized ? '还原窗口' : '最大化'} onClick={() => void window.ccl.window.toggleMaximize()}>{maximized ? <Copy size={11} /> : <Square size={10} />}</button>
            <button type="button" className="rhine-window-control rhine-window-control--close" aria-label="关闭" title="关闭" onClick={() => void window.ccl.window.close()}><X size={14} /></button>
          </div>
        </div>
      </header>

      <aside className="rhine-rail">
        <div className="rhine-sys-label">SYSTEM INDEX / 系统索引</div>
        <nav className="rhine-nav" aria-label="主导航">
          {NAV_ITEMS.map((item) => (
            <button key={item.key} type="button" className={`rhine-nav-item ${page === item.key ? 'is-active' : ''}`} title={item.key === 'more' && updateAttention ? '更多 · 有可用更新' : item.label} onClick={() => setPage(item.key)}>
              <span className="rhine-nav-num">{item.num}</span>
              <span className="rhine-nav-cn">{item.label}</span>
              <span className="rhine-nav-en">{item.en}</span>
              {item.key === 'more' && updateAttention && <span className="rhine-nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="rhine-log">
          <div className="rhine-log-head"><span>COMMAND LOG</span><b>LIVE</b></div>
          <ul>
            <li>LINK ESTABLISHED <span>→ LUNAR-TERMINAL</span></li>
            <li>SESSION READY <span>→ {activeTasks.length ? `${activeTasks.length} ACTIVE` : 'IDLE'}</span></li>
            {activeTasks.slice(0, 3).map((task) => <li key={task.id}>{task.title.slice(0, 22)} <span>→ {task.stage || task.status}</span></li>)}
            {activeTasks.length === 0 && <li>NO PENDING TASKS <span>→ SYSTEM NOMINAL</span></li>}
            <li>AUTH KEY VERIFIED <span>→ {account?.name ?? 'GUEST'}</span></li>
            <li>DOWNLOAD PATH <span>→ {settings?.modrinthMirror ? 'MIRROR / SECURE' : 'DIRECT'}</span></li>
          </ul>
        </div>
        <div className="rhine-rail-foot">
          <button type="button" className="rhine-account" onClick={() => setAccountModalOpen(true)} title="管理账户">
            {account ? <Avatar name={account.name} seed={account.uuid} uuid={account.uuid} type={account.type} size={26} /> : <span className="rhine-account-empty"><UserPlus size={14} /></span>}
            <span><strong>{account?.name ?? 'GUEST / 未登录'}</strong><small>{account ? 'AUTH LEVEL A' : 'LOGIN REQUIRED'}</small></span>
          </button>
          <div className="rhine-keyline"><span><kbd>ENTER</kbd> 启动</span><span><kbd>CTRL</kbd>+<kbd>K</kbd> 命令</span></div>
          <div className="rhine-rail-version">v{appInfo?.version ?? '—'} · BUILD 2026.11.05</div>
        </div>
      </aside>

      <footer className="rhine-statusbar">
        <div>
          <span className="rhine-status-dot" /><b>SECURE LINK</b><span>RTT 24MS</span><span>{activeTasks.length} TASKS ACTIVE</span>
          <button type="button" onClick={() => setPage('instances')}>■ INSTANCES</button>
          <button type="button" onClick={() => openConsole('launch')}>■ LOGS</button>
          <button type="button" onClick={() => setPage('settings')}>■ SETTINGS</button>
        </div>
        <div><span>{activeTasks[0]?.detail ? formatBytes(activeTasks[0].detail.bytesDone) : 'NOTIFICATIONS ON'}</span><span>CN / STANDARD</span><b>POWERED BY 月月月</b></div>
      </footer>
    </>
  )
}
