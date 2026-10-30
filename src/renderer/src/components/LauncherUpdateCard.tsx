import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  CircleArrowDown,
  DownloadCloud,
  ExternalLink,
  Info,
  Link2,
  RefreshCw,
  ShieldCheck,
  Timer
} from 'lucide-react'
import type { LauncherUpdatePhase, LauncherUpdateState } from '@shared/types'
import { useLauncher } from '../store'
import { cleanError, formatBytes, formatDate, formatSpeed, relativeTime } from '../lib/format'
import { Badge, ProgressBar, Switch } from './ui'

function normalizeFeed(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error('更新源不是有效的网址')
  }
  if (url.username || url.password) throw new Error('更新源不能包含账号或密码')
  if (url.protocol === 'https:') return trimmed
  const local = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname.toLowerCase())
  if (url.protocol === 'http:' && local) return trimmed
  throw new Error('更新源必须使用 HTTPS（本机测试可使用 localhost）')
}

function formatEta(received: number, total: number, speed: number): string {
  if (!speed || speed <= 0 || total <= received) return ''
  const seconds = Math.ceil((total - received) / speed)
  if (!Number.isFinite(seconds) || seconds <= 0) return ''
  if (seconds < 60) return `${seconds} 秒`
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)} 分 ${String(seconds % 60).padStart(2, '0')} 秒`
  }
  return `${Math.floor(seconds / 3600)} 小时 ${Math.floor((seconds % 3600) / 60)} 分`
}

function statusCopy(update: LauncherUpdateState): { title: string; detail: string } {
  const current = update.currentVersion ? `当前 v${update.currentVersion}` : '当前版本未知'
  switch (update.phase) {
    case 'checking':
      return { title: '正在连接更新源', detail: '只读取版本清单，不会上传账户、存档或日志。' }
    case 'up-to-date':
      return {
        title: '已是最新版本',
        detail: `${current}${update.checkedAt ? ` · ${relativeTime(update.checkedAt)}检查` : ''}`
      }
    case 'available':
      return {
        title: update.info ? `发现新版本 v${update.info.version}` : '发现新版本',
        detail: update.info
          ? `${current} · 安装包 ${formatBytes(update.info.size)}${
              update.info.publishedAt ? ` · 发布于 ${formatDate(update.info.publishedAt)}` : ''
            }`
          : current
      }
    case 'downloading':
      return {
        title: '正在下载更新',
        detail: '进度、速度与剩余时间均来自实际传输；可随时取消，继续时从断点续传。'
      }
    case 'verifying':
      return {
        title: '正在校验安装包',
        detail: '只有大小与 SHA-256 都匹配，才会运行安装程序。'
      }
    case 'ready':
      return {
        title: '更新已就绪',
        detail: '安装时启动器会退出，安装完成后自动重新打开新版本。'
      }
    case 'installing':
      return {
        title: '正在退出并安装',
        detail: '安装完成后会自动打开新版本；游戏进程不会被关闭。'
      }
    case 'cancelled':
      return {
        title: '下载已暂停',
        detail: '已保留下载进度，继续下载会从断点续传。'
      }
    case 'error':
      return {
        title: '更新未完成',
        detail: update.error ?? '请稍后重试'
      }
    default:
      return {
        title: '尚未检查更新',
        detail: `${current} · 点击检查更新获取最新版本信息。`
      }
  }
}

function PhaseIcon({ phase }: { phase: LauncherUpdatePhase }) {
  if (phase === 'checking' || phase === 'downloading' || phase === 'verifying' || phase === 'installing') {
    return <RefreshCw size={16} className="update-spin" />
  }
  if (phase === 'up-to-date') return <CheckCircle2 size={16} />
  if (phase === 'ready') return <ShieldCheck size={16} />
  if (phase === 'error' || phase === 'cancelled') return <AlertTriangle size={16} />
  if (phase === 'available') return <CircleArrowDown size={16} />
  return <DownloadCloud size={16} />
}

export function LauncherUpdateCard() {
  const settings = useLauncher((state) => state.settings)
  const appInfo = useLauncher((state) => state.appInfo)
  const update = useLauncher((state) => state.updateState)
  const launch = useLauncher((state) => state.launch)
  const patchSettings = useLauncher((state) => state.patchSettings)
  const checkForUpdates = useLauncher((state) => state.checkForUpdates)
  const downloadUpdate = useLauncher((state) => state.downloadUpdate)
  const cancelUpdate = useLauncher((state) => state.cancelUpdate)
  const installUpdate = useLauncher((state) => state.installUpdate)
  const toast = useLauncher((state) => state.toast)
  const [feedDraft, setFeedDraft] = useState(settings?.updateFeed ?? '')
  const [feedSaving, setFeedSaving] = useState(false)

  useEffect(() => {
    setFeedDraft(settings?.updateFeed ?? '')
  }, [settings?.updateFeed])

  if (!settings) return null

  const current = appInfo?.version || update.currentVersion || '—'
  const phase = update.phase
  const info = update.info
  const busy =
    phase === 'checking' || phase === 'downloading' || phase === 'verifying' || phase === 'installing'
  const gameActive =
    launch.status === 'preparing' || launch.status === 'starting' || launch.status === 'running'
  const showProgress =
    (phase === 'downloading' ||
      phase === 'verifying' ||
      phase === 'ready' ||
      phase === 'cancelled' ||
      phase === 'error') &&
    update.progress.total > 0 &&
    update.progress.received > 0
  const showDownload =
    Boolean(info) && (phase === 'available' || phase === 'cancelled' || phase === 'error')
  const showNotes =
    Boolean(info?.notes.length) &&
    phase !== 'up-to-date' &&
    phase !== 'error' &&
    phase !== 'idle'
  const eta = formatEta(update.progress.received, update.progress.total, update.progress.speed)
  const status = statusCopy(update)
  const feedDirty = feedDraft.trim() !== (settings.updateFeed ?? '').trim()

  const saveFeed = async () => {
    let normalized: string
    try {
      normalized = normalizeFeed(feedDraft)
    } catch (error) {
      toast('error', '更新源无效', cleanError(error))
      return
    }
    setFeedSaving(true)
    const next = await patchSettings({ updateFeed: normalized })
    setFeedSaving(false)
    if (next) {
      setFeedDraft(next.updateFeed)
      toast(
        'success',
        normalized ? '更新源已保存' : '已清空更新源',
        normalized ? '现在可以检查更新' : '启动时不会再请求更新清单'
      )
    }
  }

  return (
    <section className="more-card card update-card">
      <header className="more-card-head update-card-head">
        <span className="more-card-icon">
          <DownloadCloud size={17} />
        </span>
        <div>
          <h3>启动器更新</h3>
          <p>检查新版本、校验 SHA-256，并在本机完成安装与重启</p>
        </div>
        <Badge tone="accent" className="update-version-badge">
          v{current}
        </Badge>
      </header>

      <div className="update-auto-row">
        <span className="update-auto-copy">
          <strong>启动时检查更新</strong>
          <small>仅请求版本清单，不上传账户、存档、日志或密钥</small>
        </span>
        <Switch
          checked={settings.autoCheckUpdates !== false}
          onChange={(checked) => void patchSettings({ autoCheckUpdates: checked })}
          label="启动时检查更新"
        />
      </div>

      <div className={`update-status is-${phase}`} aria-live="polite">
        <span className="update-status-icon">
          <PhaseIcon phase={phase} />
        </span>
        <div className="update-status-copy">
          <strong>{status.title}</strong>
          <span>{status.detail}</span>
        </div>
        <div className="update-status-actions">
          {phase === 'downloading' && (
            <button type="button" className="button button--ghost button--sm" onClick={() => void cancelUpdate()}>
              取消下载
            </button>
          )}
          {showDownload && (
            <button type="button" className="button button--primary button--sm" onClick={() => void downloadUpdate()}>
              <CircleArrowDown size={13} />
              {phase === 'cancelled' ? '继续下载' : phase === 'error' ? '重新下载' : '下载更新'}
            </button>
          )}
          {phase === 'ready' && (
            <button
              type="button"
              className="button button--primary button--sm"
              disabled={gameActive}
              title={gameActive ? '游戏运行时请先退出游戏' : '退出启动器并安装新版本'}
              onClick={() => void installUpdate()}
            >
              <ShieldCheck size={13} />
              安装并重启
            </button>
          )}
          {(phase === 'idle' || phase === 'up-to-date' || phase === 'available' || phase === 'cancelled') && (
            <button
              type="button"
              className="button button--soft button--sm"
              disabled={busy}
              onClick={() => void checkForUpdates(false)}
            >
              <RefreshCw size={13} />
              {phase === 'up-to-date' ? '再次检查' : '检查更新'}
            </button>
          )}
          {phase === 'error' && (
            <button
              type="button"
              className="button button--soft button--sm"
              onClick={() => void checkForUpdates(false)}
            >
              <RefreshCw size={13} />
              重新检查
            </button>
          )}
        </div>
      </div>

      {phase === 'ready' && gameActive && (
        <p className="update-warning">
          <Info size={12} />
          游戏正在运行。安装会退出启动器，但不会关闭游戏进程；建议先退出游戏再安装。
        </p>
      )}

      {showProgress && (
        <div className="update-progress">
          <div className="update-progress-meta">
            <strong>
              {update.progress.percent == null ? '已下载' : `${update.progress.percent.toFixed(1)}%`}
            </strong>
            <span>
              {formatBytes(update.progress.received)} / {formatBytes(update.progress.total)}
            </span>
            {phase === 'downloading' ? (
              <>
                <span>{formatSpeed(update.progress.speed)}</span>
                {eta && <span>剩余约 {eta}</span>}
              </>
            ) : (
              <span>
                {phase === 'ready'
                  ? 'SHA-256 校验通过'
                  : phase === 'verifying'
                    ? '正在计算 SHA-256…'
                    : phase === 'cancelled'
                      ? '已保留断点'
                      : '下载未完成'}
              </span>
            )}
          </div>
          <ProgressBar percent={update.progress.percent ?? 0} tone={phase === 'ready' ? 'success' : 'accent'} size="sm" />
        </div>
      )}

      {info && (phase === 'available' || phase === 'ready' || phase === 'downloading' || phase === 'cancelled') && (
        <div className="update-release-meta">
          <span>v{info.version}</span>
          <span>{formatBytes(info.size)}</span>
          {info.publishedAt && (
            <span>
              <Timer size={11} />
              {formatDate(info.publishedAt)}
            </span>
          )}
          {info.mandatory && <Badge tone="danger">重要更新</Badge>}
          {info.pageUrl && (
            <button
              type="button"
              className="link-button update-release-link"
              onClick={() => void window.ccl.app.openExternal(info.pageUrl!)}
            >
              <ExternalLink size={11} />
              查看发布页
            </button>
          )}
        </div>
      )}

      {showNotes && info && (
        <div className="update-notes">
          <span className="update-notes-title">更新内容</span>
          <ul>
            {info.notes.map((note, index) => (
              <li key={`${index}-${note.slice(0, 12)}`}>{note}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="update-feed-row">
        <span className="update-feed-label">
          <Link2 size={12} />
          更新源
        </span>
        <input
          className="update-feed-input"
          value={feedDraft}
          placeholder="https://example.com/windletter/latest.json 或目录"
          spellCheck={false}
          aria-label="更新源地址"
          onChange={(event) => setFeedDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && feedDirty) void saveFeed()
          }}
        />
        <button
          type="button"
          className="button button--soft button--sm"
          disabled={!feedDirty || feedSaving}
          onClick={() => void saveFeed()}
        >
          {feedSaving ? '保存中…' : '保存'}
        </button>
      </div>
      <p className="update-feed-tip">
        填写 latest.json 地址、所在目录或 GitHub Release 地址；GitHub 源会自动改用 api.github.com。仅支持 HTTPS，本机测试可用 localhost；未配置时不会联网。
      </p>
    </section>
  )
}
