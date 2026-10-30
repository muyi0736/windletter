import { useEffect, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Copy,
  Pencil,
  Plus,
  RefreshCw,
  Server,
  Trash2,
  Users,
  Wifi,
  WifiOff
} from 'lucide-react'
import type { ServerPlayerSample, ServerStatus, ServerView } from '@shared/types'
import { useLauncher } from '../store'
import { cleanError, loaderLabel } from '../lib/format'
import { copyText } from '../lib/clipboard'
import { ConfirmDialog, EmptyState, IconButton, Spinner } from '../components/ui'
import { ServerFavicon } from '../components/ServerFavicon'
import { ServerModal } from '../components/ServerModal'
import { ServerMotd } from '../components/ServerMotd'
import { PlayerAvatar } from '../components/visuals'

const REFRESH_INTERVAL = 60_000

export function ServersPage() {
  const servers = useLauncher((state) => state.servers)
  const serversLoading = useLauncher((state) => state.serversLoading)
  const serversChecking = useLauncher((state) => state.serversChecking)
  const serversCheckedAt = useLauncher((state) => state.serversCheckedAt)
  const instances = useLauncher((state) => state.instances)
  const launch = useLauncher((state) => state.launch)
  const refreshServers = useLauncher((state) => state.refreshServers)
  const refreshServer = useLauncher((state) => state.refreshServer)
  const launchServer = useLauncher((state) => state.launchServer)
  const removeServer = useLauncher((state) => state.removeServer)
  const setPage = useLauncher((state) => state.setPage)
  const toast = useLauncher((state) => state.toast)

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<ServerView | null>(null)
  const [pendingDelete, setPendingDelete] = useState<ServerView | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [probingId, setProbingId] = useState<string | null>(null)

  const launchActive =
    launch.status === 'preparing' || launch.status === 'starting' || launch.status === 'running'

  useEffect(() => {
    if (!serversCheckedAt || Date.now() - serversCheckedAt > REFRESH_INTERVAL) {
      void refreshServers()
    }
    const timer = setInterval(() => void refreshServers(), REFRESH_INTERVAL)
    return () => clearInterval(timer)
  }, [refreshServers, serversCheckedAt])

  const selected =
    servers.find((server) => server.id === selectedId) ?? servers[0] ?? null
  const selectedIndex = selected ? servers.findIndex((server) => server.id === selected.id) : -1
  const selectedInstance = selected?.instanceId
    ? instances.find((instance) => instance.id === selected.instanceId) ?? null
    : null
  const selectedStatus = selected?.status ?? null
  const selectedNote = selected ? selected.note.trim() : ''
  const selectedPlayers = selectedStatus?.playersSample ?? []
  const selectedServerVersion = selectedStatus ? minecraftVersionOf(selectedStatus.version) : null
  const versionMismatch = Boolean(
    selectedInstance &&
      selectedServerVersion &&
      selectedServerVersion !== selectedInstance.gameVersion
  )
  const selectedAddress = selected ? formatAddress(selected.host, selected.port) : ''
  const selectedRunning =
    Boolean(selectedInstance) && launchActive && launch.instanceId === selectedInstance?.id

  const onlineCount = servers.filter((server) => server.status.state === 'online').length
  const checkedLabel = serversCheckedAt
    ? new Date(serversCheckedAt).toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit'
      })
    : null

  const openAdd = () => {
    setEditing(null)
    setModalOpen(true)
  }

  const openEdit = (server: ServerView) => {
    setEditing(server)
    setModalOpen(true)
  }

  const closeModal = () => {
    setModalOpen(false)
    setEditing(null)
  }

  const handleLaunch = (server: ServerView) => {
    const instance = instances.find((item) => item.id === server.instanceId)
    if (!instance) {
      openEdit(server)
      return
    }
    void launchServer(server.id)
  }

  const handleProbe = async (server: ServerView) => {
    if (probingId) return
    setProbingId(server.id)
    await refreshServer(server.id)
    setProbingId(null)
  }

  const handleCopy = (server: ServerView) => {
    const address = formatAddress(server.host, server.port)
    void copyText(address)
      .then(() => toast('success', '地址已复制', address))
      .catch((error) => toast('error', '复制失败', cleanError(error)))
  }

  const handleCopyPlayer = (player: ServerPlayerSample) => {
    void copyText(player.name)
      .then(() => toast('success', '玩家名已复制', player.name))
      .catch((error) => toast('error', '复制失败', cleanError(error)))
  }

  const confirmDelete = async () => {
    if (!pendingDelete || deleting) return
    setDeleting(true)
    const removed = await removeServer(pendingDelete.id)
    setDeleting(false)
    if (removed) setPendingDelete(null)
  }

  const categoryOf = (server: ServerView): string => server.category.trim()

  return (
    <div className="page page--servers">
      <header className="page-head servers-head">
        <div className="page-head-copy">
          <span className="page-eyebrow">
            <Server size={14} />
            服务器
          </span>
          <h1>常去的地方，点一下就走</h1>
          <p>保存服务器地址并绑定实例，启动器会带着对应模组直接进入服务器。</p>
        </div>
        <div className="servers-head-actions">
          <button
            type="button"
            className="button button--soft"
            disabled={serversChecking}
            onClick={() => void refreshServers()}
          >
            <RefreshCw size={15} className={serversChecking ? 'spin' : ''} />
            {serversChecking ? '检测中' : '刷新状态'}
          </button>
          <button type="button" className="button button--primary" onClick={openAdd}>
            <Plus size={15} />
            添加服务器
          </button>
        </div>
      </header>

      <div className="servers-body">
        {serversLoading && servers.length === 0 ? (
          <div className="servers-loading card">
            <Spinner size={18} />
            正在读取服务器列表…
          </div>
        ) : servers.length === 0 ? (
          <div className="card servers-empty">
            <EmptyState
              icon={<Server size={26} />}
              title="还没有保存服务器"
              description="把常去的服务器地址放在这里。绑定实例后，点一次就能启动游戏并直接进服。"
              action={
                <div className="picker-empty-actions">
                  <button type="button" className="button button--primary" onClick={openAdd}>
                    <Plus size={15} />
                    添加服务器
                  </button>
                  <button
                    type="button"
                    className="button button--soft"
                    onClick={() => setPage('instances')}
                  >
                    先准备实例
                  </button>
                </div>
              }
            />
          </div>
        ) : (
          <div className="server-desk">
            <aside className="server-index">
              <div className="server-index-head">
                <span>Files / 服务器</span>
                <span className="server-index-count">
                  <i className={serversChecking ? 'is-checking' : ''} />
                  {onlineCount} / {servers.length} 在线
                </span>
              </div>

              <div className="server-index-list">
                {servers.map((server, index) => {
                  const instance = server.instanceId
                    ? instances.find((item) => item.id === server.instanceId)
                    : null
                  const active = selected?.id === server.id
                  const status = server.status
                  const category = categoryOf(server)
                  return (
                    <button
                      key={server.id}
                      type="button"
                      className={`server-file ${active ? 'is-active' : ''} server-file--${status.state}`}
                      onClick={() => setSelectedId(server.id)}
                    >
                      <ServerFavicon
                        favicon={status.favicon}
                        name={server.name}
                        size={28}
                      />
                      <span className="server-file-copy">
                        <span className="server-file-code">
                          FILE {fileLetter(index)}
                          {category && (
                            <>
                              <em>·</em>
                              <span>{category}</span>
                            </>
                          )}
                        </span>
                        <strong title={server.name}>{server.name}</strong>
                        <span className="server-file-meta">
                          <i className={`server-file-dot server-file-dot--${status.state}`} />
                          {statusLabel(status, serversChecking)}
                          {status.state === 'online' && (
                            <span className="server-file-players">
                              {status.playersOnline ?? 0}/{status.playersMax ?? '—'}
                            </span>
                          )}
                          {!instance && <span className="server-file-warning">未绑定</span>}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>

              <div className="server-index-foot">
                <button type="button" className="server-index-add" onClick={openAdd}>
                  <Plus size={13} />
                  添加服务器
                </button>
                <span className="server-index-updated">
                  {serversChecking
                    ? '正在检测…'
                    : checkedLabel
                      ? `更新 ${checkedLabel}`
                      : '尚未检测'}
                </span>
              </div>
            </aside>

            {selected && selectedStatus && (
              <article
                key={selected.id}
                className={`server-dossier card server-dossier--${selectedStatus.state}`}
              >
                <header className="dossier-head">
                  <span className="dossier-file">
                    <i className="dossier-file-mark" />
                    FILE {fileLetter(selectedIndex)}
                    {categoryOf(selected) && (
                      <>
                        <em>·</em>
                        <span>{categoryOf(selected)}</span>
                      </>
                    )}
                  </span>
                  <span className={`dossier-status dossier-status--${selectedStatus.state}`}>
                    {selectedStatus.state === 'online' ? (
                      <Wifi size={12} />
                    ) : selectedStatus.state === 'offline' ? (
                      <WifiOff size={12} />
                    ) : (
                      <RefreshCw
                        size={12}
                        className={serversChecking || probingId === selected.id ? 'spin' : ''}
                      />
                    )}
                    {statusLabel(selectedStatus, serversChecking)}
                  </span>
                </header>

                <div className="dossier-hero">
                  <h2>{selected.name}</h2>
                  <p className="dossier-subtitle">
                    {selectedInstance
                      ? `Minecraft ${selectedInstance.gameVersion} · ${
                          loaderLabel(selectedInstance.loader) ?? '原版'
                        } · ${selectedInstance.modCount} 模组`
                      : selectedStatus.version
                        ? `Minecraft ${selectedStatus.version} · 尚未绑定实例`
                        : '尚未绑定实例'}
                  </p>
                  {selectedStatus.state === 'online' ? (
                    <div className="dossier-players">
                      <strong>{selectedStatus.playersOnline ?? 0}</strong>
                      <span>/ {selectedStatus.playersMax ?? '—'}</span>
                      <em>人在线</em>
                    </div>
                  ) : (
                    <p className="dossier-players-empty">
                      {selectedStatus.state === 'offline'
                        ? '服务器当前离线，无法读取在线人数。'
                        : '探测服务器后显示在线人数。'}
                    </p>
                  )}
                </div>

                <div className="dossier-meta">
                  <div className="dossier-cell">
                    <span>版本</span>
                    <strong>
                      {selectedStatus.version ?? selectedInstance?.gameVersion ?? '—'}
                    </strong>
                  </div>
                  <div className="dossier-cell">
                    <span>协议</span>
                    <strong>{selectedStatus.protocol ?? '—'}</strong>
                  </div>
                  <div className="dossier-cell">
                    <span>加载器</span>
                    <strong>
                      {selectedInstance
                        ? loaderLabel(selectedInstance.loader) ?? '原版'
                        : '—'}
                    </strong>
                  </div>
                  <div className="dossier-cell">
                    <span>绑定实例</span>
                    <strong
                      className={selectedInstance ? '' : 'is-warning'}
                      title={selectedInstance?.name}
                    >
                      {selectedInstance?.name ?? '未绑定'}
                    </strong>
                  </div>
                </div>

                <div className="dossier-screen">
                  <div className="dossier-screen-bar">
                    <span className="dossier-screen-kicker">
                      {selectedStatus.state === 'online'
                        ? 'MOTD / LIVE'
                        : selectedStatus.state === 'offline'
                          ? 'MOTD / OFFLINE'
                          : 'MOTD / WAITING'}
                    </span>
                    <span className="dossier-screen-address">{selectedAddress}</span>
                    <span
                      className={`dossier-screen-signal dossier-screen-signal--${selectedStatus.state}`}
                    >
                      <i />
                      {selectedStatus.state === 'online'
                        ? 'ONLINE'
                        : selectedStatus.state === 'offline'
                          ? 'OFFLINE'
                          : 'UNKNOWN'}
                      {selectedStatus.state === 'online' &&
                        selectedStatus.latencyMs != null && (
                          <em>{selectedStatus.latencyMs} ms</em>
                        )}
                    </span>
                  </div>
                  {selectedStatus.state === 'online' ? (
                    <ServerMotd
                      text={selectedStatus.motd}
                      tone="light"
                      className="dossier-screen-motd"
                    />
                  ) : (
                    <p className="dossier-screen-placeholder">
                      {selectedStatus.state === 'offline'
                        ? selectedStatus.error || '无法连接服务器'
                        : '还没有探测过这个服务器'}
                    </p>
                  )}
                  <div className="dossier-screen-facts">
                    <span>
                      <Users size={10} />
                      {selectedStatus.state === 'online'
                        ? `${selectedStatus.playersOnline ?? 0} / ${
                            selectedStatus.playersMax ?? '—'
                          } 在线`
                        : '— 在线'}
                    </span>
                    <span>
                      <Activity size={10} />
                      {selectedStatus.version ??
                        selectedInstance?.gameVersion ??
                        '未知版本'}
                    </span>
                    <span>协议 {selectedStatus.protocol ?? '—'}</span>
                  </div>
                </div>

                <section className="dossier-roster">
                  <header className="dossier-roster-head">
                    <span
                      className="dossier-roster-title"
                      title="皮肤优先使用 Mojang 公开档案，缺失时按玩家名从 LittleSkin 读取"
                    >
                      <Users size={12} />
                      在线玩家
                    </span>
                    <span className="dossier-roster-summary">
                      {selectedStatus.state === 'online'
                        ? selectedPlayers.length > 0
                          ? `公开样本 ${selectedPlayers.length} 个 · 共 ${
                              selectedStatus.playersOnline ?? 0
                            } 人在线`
                          : `${selectedStatus.playersOnline ?? 0} 人在线 · 未公开名单`
                        : selectedStatus.state === 'offline'
                          ? '服务器离线'
                          : '等待探测'}
                    </span>
                    <button
                      type="button"
                      className="dossier-roster-refresh"
                      title="刷新玩家列表"
                      disabled={probingId === selected.id}
                      onClick={() => void handleProbe(selected)}
                    >
                      <RefreshCw
                        size={12}
                        className={probingId === selected.id ? 'spin' : ''}
                      />
                    </button>
                  </header>
                  {selectedStatus.state === 'online' ? (
                    selectedPlayers.length > 0 ? (
                      <div className="dossier-roster-grid">
                        {selectedPlayers.map((player) => (
                          <button
                            key={`${player.id ?? 'name'}:${player.name}`}
                            type="button"
                            className="dossier-player"
                            title={`复制玩家名 ${player.name}`}
                            onClick={() => handleCopyPlayer(player)}
                          >
                            <PlayerAvatar
                              name={player.name}
                              uuid={player.id}
                              size={26}
                              className="dossier-player-avatar"
                            />
                            <span>{player.name}</span>
                            <Copy size={10} className="dossier-player-copy" />
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="dossier-roster-empty">
                        服务器没有公开在线玩家名单，只提供在线人数。部分服务器会在状态信息里隐藏完整列表。
                      </p>
                    )
                  ) : (
                    <p className="dossier-roster-empty">
                      {selectedStatus.state === 'offline'
                        ? '无法读取玩家列表，服务器当前不可达。'
                        : '探测服务器后，这里会显示服务器公开的在线玩家样本。'}
                    </p>
                  )}
                </section>

                {selectedNote && (
                  <div className="dossier-note">
                    <span>NOTE</span>
                    <p>{selectedNote}</p>
                  </div>
                )}

                {versionMismatch && (
                  <p className="dossier-alert">
                    <AlertTriangle size={12} />
                    服务器版本 {selectedServerVersion} 与实例 {selectedInstance?.gameVersion} 不一致
                  </p>
                )}

                <footer className="dossier-actions">
                  <button
                    type="button"
                    className="dossier-address"
                    onClick={() => handleCopy(selected)}
                    title="复制服务器地址"
                  >
                    <span className="dossier-address-label">ADDRESS</span>
                    <span className="dossier-address-value">{selectedAddress}</span>
                    <Copy size={12} />
                  </button>
                  <button
                    type="button"
                    className="dossier-probe"
                    disabled={probingId === selected.id}
                    onClick={() => void handleProbe(selected)}
                  >
                    <RefreshCw
                      size={12}
                      className={probingId === selected.id ? 'spin' : ''}
                    />
                    探测
                  </button>
                  <span className="dossier-checked">
                    {selectedStatus.checkedAt
                      ? `上次检测 ${formatClock(selectedStatus.checkedAt)}`
                      : '尚未检测'}
                  </span>
                  <div className="dossier-buttons">
                    <IconButton label="编辑服务器" onClick={() => openEdit(selected)}>
                      <Pencil size={14} />
                    </IconButton>
                    <IconButton
                      label="移除服务器"
                      onClick={() => setPendingDelete(selected)}
                    >
                      <Trash2 size={14} />
                    </IconButton>
                    {selectedInstance ? (
                      <button
                        type="button"
                        className="button button--primary dossier-launch"
                        disabled={launchActive}
                        onClick={() => handleLaunch(selected)}
                      >
                        {selectedRunning ? '运行中' : '启动并进服'}
                        <ArrowUpRight size={14} />
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="button button--primary dossier-launch"
                        onClick={() => openEdit(selected)}
                      >
                        选择实例
                        <ArrowUpRight size={14} />
                      </button>
                    )}
                  </div>
                </footer>
              </article>
            )}
          </div>
        )}
      </div>

      <ServerModal open={modalOpen} server={editing} onClose={closeModal} />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="移除这个服务器？"
        message={
          pendingDelete
            ? `只会从风信移除「${pendingDelete.name}」这个书签，不会改动实例、存档或服务器本身。`
            : ''
        }
        confirmLabel="移除"
        danger
        busy={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}

function statusLabel(status: ServerStatus, checking: boolean): string {
  if (status.state === 'online') return '在线'
  if (status.state === 'offline') return '离线'
  return checking ? '检测中' : '未检测'
}

function fileLetter(index: number): string {
  if (index < 0) return '?'
  return index < 26 ? String.fromCharCode(65 + index) : String(index + 1)
}

function formatClock(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit'
  })
}

function minecraftVersionOf(name: string | null): string | null {
  if (!name) return null
  const matches = name.match(/\d+\.\d+(?:\.\d+)?/g)
  return matches?.length === 1 ? matches[0] : null
}

function formatAddress(host: string, port: number): string {
  return host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`
}
