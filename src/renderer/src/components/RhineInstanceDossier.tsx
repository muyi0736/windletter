import { useMemo } from 'react'
import { useLauncher } from '../store'
import { formatMemory, loaderLabel, relativeTime } from '../lib/format'

export function RhineInstanceDossier() {
  const instances = useLauncher((state) => state.instances)
  const selectedId = useLauncher((state) => state.selectedInstanceId)
  const accounts = useLauncher((state) => state.accounts)
  const launch = useLauncher((state) => state.launch)
  const startInstance = useLauncher((state) => state.startInstance)
  const setAccountModalOpen = useLauncher((state) => state.setAccountModalOpen)
  const toast = useLauncher((state) => state.toast)

  const sorted = useMemo(
    () =>
      [...instances].sort(
        (a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0) || a.name.localeCompare(b.name, 'zh-CN')
      ),
    [instances]
  )
  const instance = instances.find((item) => item.id === selectedId) ?? sorted[0] ?? null
  const account = accounts.accounts.find((item) => item.id === accounts.activeId) ?? null
  const running = launch.status === 'running' && launch.instanceId === instance?.id
  const launchBusy = launch.status === 'preparing' || launch.status === 'starting'

  if (!instance) {
    return (
      <aside className="rhine-dossier rhine-inst-dossier">
        <div className="rhine-dos-head">
          <span>■ SPECIMEN PROFILE</span>
          <b>ARCHIVE / 00</b>
          <span>EMPTY</span>
        </div>
        <div className="rhine-dos-body">
          <div className="rhine-operator-tag"><span className="tag">NO SPECIMEN</span><span className="level">ARCHIVE EMPTY</span></div>
          <p className="rhine-empty-dossier">还没有实例。导入整合包或创建原版实例后，档案会在这里展开。</p>
        </div>
      </aside>
    )
  }

  const handleLaunch = () => {
    if (!account) {
      setAccountModalOpen(true)
      toast('info', '先添加一个账户', '离线账户也可以启动本地实例')
      return
    }
    void startInstance(instance.id)
  }

  return (
    <aside className="rhine-dossier rhine-inst-dossier">
      <div className="rhine-dos-head">
        <span>■ SPECIMEN PROFILE</span>
        <b>ARCHIVE / {String(instances.findIndex((item) => item.id === instance.id) + 1).padStart(2, '0')}</b>
        <span>{running ? 'RUNNING' : 'READY'}</span>
      </div>
      <div className="rhine-dos-body">
        <div className="rhine-operator-tag">
          <span className="tag">SPECIMEN {String(instances.findIndex((item) => item.id === instance.id) + 1).padStart(2, '0')}</span>
          <span className="level">STATUS <b>{running ? 'RUNNING' : 'READY'}</b></span>
        </div>
        <div className="rhine-operator">
          <div className="rhine-avatar">
            <span className="scan" />
            <span className="photo">ICON SEALED</span>
          </div>
          <div className="rhine-operator-name">
            <h3>{instance.name}</h3>
            <p>{instance!.loader === 'vanilla' ? 'VANILLA' : loaderLabel(instance!.loader)?.toUpperCase() ?? 'UNKNOWN'} · {instance!.gameVersion}<br /><b>{instance!.modCount}</b> MODULES · {instance!.external ? 'EXTERNAL' : 'MANAGED'}</p>
          </div>
        </div>
        <div className="rhine-profile">
          <div className="rhine-profile-label"><span>SYSTEM PROFILE</span><span>SEALED</span></div>
          <div className="rhine-profile-row"><span>HOST</span><b>LUNAR-TERMINAL</b></div>
          <div className="rhine-profile-row"><span>JAVA</span><b>{instance.javaMajor ?? 'AUTO'}</b></div>
          <div className="rhine-profile-row"><span>MEMORY</span><b>{instance.memoryMb ? formatMemory(instance.memoryMb) : 'AUTO'}</b></div>
          <div className="rhine-profile-row"><span>LAST PLAYED</span><b>{relativeTime(instance.lastPlayed).toUpperCase()}</b></div>
        </div>
        <div className="rhine-auth">
          <div className="rhine-auth-head"><span>LAUNCH AUTHORIZATION</span><span>LEVEL-A</span></div>
          <div className="rhine-auth-box">
            <span className="key">AUTHORIZATION KEY / <b>{running ? 'ACTIVE' : 'READY'}</b></span>
            <button type="button" className="rhine-auth-button" disabled={launchBusy || running} onClick={handleLaunch}>LAUNCH <span>↗</span></button>
          </div>
        </div>
        <div className="rhine-inst-actions">
          <button type="button" className="button button--soft" onClick={() => void window.ccl.instances.openFolder(instance.id).catch((error) => toast('error', '无法打开目录', String(error)))}>打开目录</button>
          <button type="button" className="button button--soft" onClick={() => window.dispatchEvent(new CustomEvent('windletter:instance-settings', { detail: instance.id }))}>实例设置</button>
        </div>
        <div className="rhine-dos-foot"><span>ARCHIVE RECORD / 01</span><b>POWERED BY 月月月</b></div>
      </div>
    </aside>
  )
}
