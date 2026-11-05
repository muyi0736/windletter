import { useMemo } from 'react'
import { PackagePlus, Plus, Square } from 'lucide-react'
import { useLauncher } from '../store'
import { cleanError, formatBytes, formatMemory, loaderLabel, relativeTime } from '../lib/format'
import { Avatar } from '../components/visuals'

function LunarRig() {
  return (
    <div className="rhine-rig" aria-hidden="true">
      <svg className="rhine-rig-svg" viewBox="0 0 740 740">
        <defs>
          <radialGradient id="rhineMoon" cx="40%" cy="36%" r="62%">
            <stop offset="0" stopColor="#f7f5ef" />
            <stop offset="0.48" stopColor="#d7d3ca" />
            <stop offset="1" stopColor="#9b978e" />
          </radialGradient>
          <linearGradient id="rhineRibbon" x1="0" x2="1">
            <stop offset="0" stopColor="rgba(255,255,255,.08)" />
            <stop offset="0.5" stopColor="rgba(255,255,255,.5)" />
            <stop offset="1" stopColor="rgba(255,255,255,.08)" />
          </linearGradient>
        </defs>
        <g className="rhine-rotor">
          <circle cx="370" cy="370" r="314" fill="none" stroke="rgba(16,16,16,.34)" strokeWidth="1" strokeDasharray="1 10" />
          <circle cx="370" cy="370" r="292" fill="none" stroke="rgba(16,16,16,.18)" strokeWidth="1" />
          <circle cx="370" cy="370" r="214" fill="none" stroke="rgba(16,16,16,.22)" strokeWidth="1" strokeDasharray="2 7" />
          <ellipse cx="370" cy="370" rx="322" ry="118" fill="none" stroke="rgba(16,16,16,.28)" strokeWidth="1" />
          <ellipse cx="370" cy="370" rx="322" ry="118" fill="none" stroke="rgba(16,16,16,.22)" strokeWidth="18" strokeDasharray="1 7" opacity=".42" />
          <ellipse cx="370" cy="370" rx="282" ry="196" fill="none" stroke="url(#rhineRibbon)" strokeWidth="26" opacity=".65" />
          <ellipse cx="370" cy="370" rx="282" ry="196" fill="none" stroke="rgba(16,16,16,.22)" strokeWidth="1" />
          <path d="M 92 426 A 300 300 0 0 1 502 118" fill="none" stroke="rgba(16,16,16,.34)" strokeWidth="1" />
          <path d="M 648 314 A 300 300 0 0 1 238 622" fill="none" stroke="rgba(16,16,16,.34)" strokeWidth="1" />
          <circle cx="370" cy="58" r="24" fill="url(#rhineMoon)" opacity=".9" />
          <circle cx="370" cy="58" r="24" fill="none" stroke="rgba(16,16,16,.25)" />
          <circle cx="640" cy="486" r="14" fill="url(#rhineMoon)" opacity=".8" />
          <circle cx="640" cy="486" r="14" fill="none" stroke="rgba(16,16,16,.25)" />
          <circle cx="116" cy="246" r="9" fill="url(#rhineMoon)" opacity=".8" />
          <circle cx="116" cy="246" r="9" fill="none" stroke="rgba(16,16,16,.25)" />
          <circle cx="370" cy="56" r="4" fill="var(--rhine-orange)" />
          <circle cx="652" cy="470" r="3" fill="var(--rhine-orange)" />
          <circle cx="360" cy="684" r="3" fill="var(--rhine-orange)" />
          <text x="370" y="24" textAnchor="middle">LUNAR PHASE ARRAY / 月相阵列</text>
          <text x="670" y="548" textAnchor="middle" transform="rotate(-17 670 548)">ORBIT 03</text>
        </g>
        <g className="rhine-rotor rev">
          <ellipse cx="370" cy="370" rx="236" ry="92" fill="none" stroke="rgba(16,16,16,.2)" strokeWidth="1" transform="rotate(35 370 370)" />
          <ellipse cx="370" cy="370" rx="236" ry="92" fill="none" stroke="rgba(16,16,16,.16)" strokeWidth="13" strokeDasharray="1 9" transform="rotate(35 370 370)" />
          <circle cx="536" cy="239" r="5" fill="none" stroke="var(--rhine-orange)" strokeWidth="1" />
          <circle cx="536" cy="239" r="2" fill="var(--rhine-orange)" />
        </g>
      </svg>
    </div>
  )
}

export function RhineHomePage() {
  const settings = useLauncher((state) => state.settings)
  const accounts = useLauncher((state) => state.accounts)
  const instances = useLauncher((state) => state.instances)
  const selectedInstanceId = useLauncher((state) => state.selectedInstanceId)
  const launch = useLauncher((state) => state.launch)
  const tasks = useLauncher((state) => state.tasks)
  const setPage = useLauncher((state) => state.setPage)
  const setAccountModalOpen = useLauncher((state) => state.setAccountModalOpen)
  const startInstance = useLauncher((state) => state.startInstance)
  const stopGame = useLauncher((state) => state.stopGame)
  const importModpack = useLauncher((state) => state.importModpack)
  const toast = useLauncher((state) => state.toast)

  const sorted = useMemo(
    () =>
      [...instances].sort(
        (a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0) || a.name.localeCompare(b.name, 'zh-CN')
      ),
    [instances]
  )
  const instance = instances.find((item) => item.id === selectedInstanceId) ?? sorted[0] ?? null
  const account = accounts.accounts.find((item) => item.id === accounts.activeId) ?? null
  const launchBusy = launch.status === 'preparing' || launch.status === 'starting'
  const running = launch.status === 'running' && launch.instanceId === instance?.id
  const task = tasks.find((item) => item.status === 'running' || item.status === 'paused') ?? null
  const progress = task?.detail ?? null
  const percent = task?.progress ?? 0
  const customBackground = (settings?.backgroundImages?.length ?? 0) > 0

  const handlePrimary = () => {
    if (running) {
      void stopGame()
      return
    }
    if (!instance) {
      setPage('instances')
      return
    }
    if (!account) {
      setAccountModalOpen(true)
      toast('info', '先添加一个账户', '离线账户也可以启动本地实例')
      return
    }
    void startInstance(instance.id)
  }

  return (
    <div className={`page page--home rhine-home ${customBackground ? 'has-home-background' : ''}`}>
      <div className="rhine-page-label">
        <b>SERVICES SECTOR</b> / TERMINAL NODE <span>LUNAR-TERMINAL · ACCESS READY</span>
      </div>
      <LunarRig />
      <div className="rhine-coord">
        <span><b>TERMINAL NODE</b>LOCAL ACCESS · PAM AUTHORITY</span>
      </div>

      <article className={`rhine-hero ${instance ? '' : 'is-empty'}`}>
        <div className="rhine-hero-art">
          <span className="rhine-hero-cross" />
          <span className="rhine-hero-code">{instance ? 'LUNAR' : 'EMPTY'}</span>
          <span className="rhine-hero-caption">SPECIMEN / {instance ? '01' : '00'}</span>
        </div>
        <div className="rhine-hero-body">
          <div className="rhine-hero-status">
            <span>STATUS / <b>{running ? 'RUNNING' : instance ? 'READY' : 'EMPTY'}</b></span>
            <span>{instance ? relativeTime(instance.lastPlayed).toUpperCase() : 'NO SPECIMEN'}</span>
          </div>
          <h2>{instance?.name ?? '还没有实例'}</h2>
          <p>
            {instance
              ? `${instance!.loader === 'vanilla' ? 'VANILLA' : loaderLabel(instance!.loader)?.toUpperCase() ?? 'UNKNOWN'} ${instance!.loaderVersion ?? ''} · MINECRAFT ${instance!.gameVersion}`
              : 'CREATE OR IMPORT A SPECIMEN TO CONTINUE'}
            <br />
            {instance ? `${instance.modCount} MODULES · SEALED SECTION` : 'ARCHIVE EMPTY / 00'}
          </p>
          <div className="rhine-hero-meta">
            <div><span>JAVA</span><b>{instance?.javaMajor ?? 'AUTO'} / AUTO</b></div>
            <div><span>MEMORY</span><b>{instance?.memoryMb ? formatMemory(instance.memoryMb) : settings?.maxMemoryMb ? formatMemory(settings.maxMemoryMb) : 'AUTO'}</b></div>
          </div>
          <div className="rhine-hero-actions">
            <button type="button" className={`rhine-launch ${running ? 'is-running' : ''}`} disabled={launchBusy} onClick={handlePrimary}>
              {running ? <Square size={12} fill="currentColor" /> : null}
              {running ? '结束游戏' : launchBusy ? '启动中…' : instance ? '启动游戏' : '新建实例'}
              <span>↗</span>
            </button>
            <button type="button" className="rhine-ghost" onClick={() => setPage('instances')}>实例设置</button>
          </div>
        </div>
      </article>

      <div className="rhine-feed">
        <div className="rhine-feed-head"><span>TASK FEED / 任务流</span><b>{task ? '01 ACTIVE' : 'NOMINAL'}</b></div>
        <div className="rhine-feed-body">
          <div className="rhine-feed-title">
            <strong>{task?.title ?? '没有正在进行的任务'}</strong>
            <span>{task ? `${Math.round(percent)}%` : '100%'}</span>
          </div>
          <div className="rhine-feed-bar"><i style={{ width: `${task ? Math.max(2, percent) : 100}%` }} /></div>
          <div className="rhine-feed-meta">
            <span>{progress ? `${progress.current} / ${progress.total} FILES` : 'SYSTEM NOMINAL'}</span>
            <span>{progress ? `${formatBytes(progress.speed)}/S` : 'LAST SYNC OK'}</span>
          </div>
        </div>
      </div>

      <div className="rhine-caption">
        <b>operator</b>，{instance ? '实例已就绪。请出示启动权限。' : '档案为空。请先建立实例。'}
        <span>{instance ? 'OPERATOR, SPECIMEN IS READY. PRESENT LAUNCH AUTHORIZATION.' : 'OPERATOR, ARCHIVE IS EMPTY. CREATE A SPECIMEN.'}</span>
      </div>

      <aside className="rhine-dossier">
        <div className="rhine-dos-head"><span>■ SECTION PROFILE</span><b>LUNAR / FILE</b><span>GENERAL ACCESS / 01</span></div>
        <div className="rhine-dos-body">
          <div className="rhine-operator-tag"><span className="tag">OPERATOR</span><span className="level">AUTH LEVEL <b>A</b> / 01</span></div>
          <div className="rhine-operator">
            <div className="rhine-avatar">
              {account ? <Avatar name={account.name} seed={account.uuid} uuid={account.uuid} type={account.type} size={74} /> : null}
              <span className="scan" />
              <span className="photo">{account ? 'PHOTO LOADED' : 'PHOTO CLASSIFIED'}</span>
            </div>
            <div className="rhine-operator-name">
              <h3>{account?.name?.slice(0, 8) ?? 'GUEST'}</h3>
              <p>PERSONAL INFORMATION {account ? 'LOADED' : 'REQUIRED'}<br /><b>OPERATOR-01</b> · {account ? 'SESSION READY' : 'LOGIN REQUIRED'}</p>
            </div>
          </div>
          <div className="rhine-profile">
            <div className="rhine-profile-label"><span>PROFILE</span><span>LUNAR / FILE</span></div>
            <div className="rhine-profile-row"><span>HOST</span><b>LUNAR-TERMINAL</b></div>
            <div className="rhine-profile-row"><span>SESSION</span><b>{instance ? (instance!.loader === 'vanilla' ? 'VANILLA' : loaderLabel(instance!.loader)?.toUpperCase() ?? 'UNKNOWN') : '—'}</b></div>
            <div className="rhine-profile-row"><span>LAST SYNC</span><b>{instance ? relativeTime(instance.lastPlayed).toUpperCase() : '—'}</b></div>
            <div className="rhine-profile-row"><span>KEYMAP</span><b>CN / STANDARD</b></div>
          </div>
          <div className="rhine-auth">
            <div className="rhine-auth-head"><span>LAUNCH AUTHORIZATION</span><span>ATTEMPT 01 · LEVEL-A</span></div>
            <div className="rhine-auth-box">
              <span className="key">AUTHORIZATION KEY / <b>{instance ? 'READY' : 'EMPTY'}</b></span>
              <button type="button" className="rhine-auth-button" onClick={handlePrimary} disabled={launchBusy}>LAUNCH <span>↗</span></button>
            </div>
          </div>
          <div className="rhine-dos-foot"><span>DATA SEALED / 01 DISPLAY</span><b>POWERED BY 月月月</b></div>
        </div>
      </aside>

      <div className="rhine-quick-links">
        <button type="button" onClick={() => void importModpack()}><PackagePlus size={13} />导入整合包</button>
        <button type="button" onClick={() => setPage('instances')}><Plus size={13} />新建实例</button>
        <button type="button" onClick={() => { const path = settings?.gameDir; if (path) void window.ccl.app.openPath(path).catch((error) => toast('error', '无法打开目录', cleanError(error))) }}>打开游戏目录</button>
      </div>
    </div>
  )
}
