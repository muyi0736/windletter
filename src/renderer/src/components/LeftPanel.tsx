import { RemoteIcon } from '../components/RemoteIcon'
import { Boxes, Cog, FolderOpen, Pin, Play, RefreshCw, ShieldCheck, UserRound } from 'lucide-react'
import type { AccountView, JavaInfo } from '@shared/types'
import { formatMemory, javaRequirement, relativeTime } from '../lib/format'
import { Avatar, BlockIcon } from './visuals'

export interface RecentEntry {
  key: string
  kind: 'instance' | 'version'
  id: string
  name: string
  meta: string
  lastPlayed: number | null
  iconUrl?: string | null
  loader?: string | null
  type?: string | null
}

interface LeftPanelProps {
  account: AccountView | null
  accountCount: number
  onManageAccount: () => void
  recent: RecentEntry[]
  pinnedKeys: Set<string>
  onTogglePin: (key: string) => void
  onLaunchRecent: (entry: RecentEntry) => void
  java: JavaInfo | null
  requiredJava: number | null
  memoryMb: number
  onJavaManage: () => void
  onJavaDetect: () => void
  latest: {
    id: string
    installed: boolean
    installing: boolean
    progress: number
    date: string | null
  } | null
  onLatestAction: () => void
  onOpenFolder: () => void
  onOpenConsole: () => void
  onOpenSettings: () => void
}

export function LeftPanel({
  account,
  accountCount,
  onManageAccount,
  recent,
  pinnedKeys,
  onTogglePin,
  onLaunchRecent,
  java,
  requiredJava,
  memoryMb,
  onJavaManage,
  onJavaDetect,
  latest,
  onLatestAction,
  onOpenFolder,
  onOpenConsole,
  onOpenSettings
}: LeftPanelProps) {
  const javaMismatch =
    requiredJava !== null && (!java || (requiredJava !== 8 && java.major < requiredJava))

  return (
    <aside className="left-panel">
      <section className="quick-card account-card">
        <div className="quick-card-head">
          <span className="quick-card-title">当前账户</span>
          {account && <span className="quick-card-note">{accountCount} 个账户</span>}
        </div>

        {account ? (
          <>
            <div className="account-info">
              <Avatar
                name={account.name}
                seed={account.uuid}
                uuid={account.uuid}
                type={account.type}
                size={44}
              />
              <div className="account-details">
                <strong>{account.name}</strong>
                <span>{account.type === 'microsoft' ? 'Microsoft 账户' : '离线账户'}</span>
              </div>
            </div>
            <button type="button" className="button button--soft button--sm quick-card-action" onClick={onManageAccount}>
              管理账户
            </button>
          </>
        ) : (
          <div className="quick-empty">
            <UserRound size={18} />
            <span>还没有添加账户</span>
            <button type="button" className="button button--primary button--sm" onClick={onManageAccount}>
              添加账户
            </button>
          </div>
        )}
      </section>

      <section className="quick-card">
        <div className="quick-card-head">
          <span className="quick-card-title">快速启动</span>
          <span className="quick-card-note">最近</span>
        </div>
        {recent.length === 0 ? (
          <div className="quick-empty quick-empty--compact">
            <span>还没有启动记录</span>
          </div>
        ) : (
          <div className="quick-launch-list">
            {recent.map((entry) => (
              <button
                key={entry.key}
                type="button"
                className="quick-launch-item"
                onClick={() => onLaunchRecent(entry)}
                title={`启动 ${entry.name}`}
              >
                <span className="quick-launch-icon">
                  {entry.kind === 'instance' ? (
                    <RemoteIcon url={entry.iconUrl} fallback={<Boxes size={16} />} />
                  ) : (
                    <BlockIcon loader={entry.loader} type={entry.type} size={26} />
                  )}
                </span>
                <span className="quick-launch-copy">
                  <strong>{entry.name}</strong>
                  <small>{entry.meta}</small>
                </span>
                <span className="quick-launch-tail">
                  <button
                    type="button"
                    className={`quick-pin ${pinnedKeys.has(entry.key) ? 'is-pinned' : ''}`}
                    title={pinnedKeys.has(entry.key) ? '取消固定' : '固定到快速启动'}
                    onClick={(event) => {
                      event.stopPropagation()
                      onTogglePin(entry.key)
                    }}
                  >
                    <Pin size={10} fill={pinnedKeys.has(entry.key) ? 'currentColor' : 'none'} />
                  </button>
                  {relativeTime(entry.lastPlayed)}
                  <Play size={11} fill="currentColor" />
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="quick-card java-card">
        <div className="quick-card-head">
          <span className="quick-card-title">Java 环境</span>
          <button type="button" className="quick-card-link" onClick={onJavaDetect}>
            <RefreshCw size={11} />
            检测
          </button>
        </div>
        {java ? (
          <>
            <div className={`java-status ${javaMismatch ? 'is-warning' : ''}`}>
              <span className="java-status-mark">J{java.major}</span>
              <span className="java-status-copy">
                <strong>
                  Java {java.major}
                  {javaMismatch && requiredJava ? ` · 需要 ${requiredJava}` : ''}
                </strong>
                <small>
                  {java.vendor} · {java.arch}
                </small>
              </span>
            </div>
            <p className="java-path" title={java.path}>
              {java.path}
            </p>
            <div className="java-meta-line">
              <span>分配内存</span>
              <strong>{formatMemory(memoryMb)}</strong>
            </div>
            {requiredJava && !javaMismatch && (
              <p className="java-hint">满足游戏要求：{javaRequirement(requiredJava)}</p>
            )}
            <button type="button" className="button button--soft button--sm quick-card-action" onClick={onJavaManage}>
              <Cog size={12} />
              管理 Java
            </button>
          </>
        ) : (
          <div className="quick-empty">
            <span>{requiredJava ? `未找到 Java ${requiredJava}` : '还没有检测 Java'}</span>
            <button type="button" className="button button--primary button--sm" onClick={onJavaDetect}>
              检测 Java
            </button>
          </div>
        )}
      </section>

      <section className="quick-card">
        <div className="quick-card-head">
          <span className="quick-card-title">最新正式版</span>
          <span className="quick-card-note">{latest?.date ?? '—'}</span>
        </div>
        {latest ? (
          <div className="latest-line latest-line--compact">
            <div>
              <strong>{latest.id}</strong>
              <small>
                {latest.installing
                  ? `安装中 ${Math.round(latest.progress)}%`
                  : latest.installed
                    ? '已安装'
                    : '尚未安装'}
              </small>
            </div>
            <button
              type="button"
              className="button button--soft button--sm"
              disabled={latest.installing}
              onClick={onLatestAction}
            >
              {latest.installing ? '安装中' : latest.installed ? '使用' : '安装'}
            </button>
          </div>
        ) : (
          <div className="quick-empty quick-empty--compact">
            <span>正在同步版本列表</span>
          </div>
        )}
      </section>

      <section className="quick-card workbench-links">
        <button type="button" onClick={onOpenFolder}>
          <FolderOpen size={13} />
          游戏目录
        </button>
        <button type="button" onClick={onOpenConsole}>
          <Play size={13} />
          运行日志
        </button>
        <button type="button" onClick={onOpenSettings}>
          <Cog size={13} />
          启动设置
        </button>
      </section>
    </aside>
  )
}
