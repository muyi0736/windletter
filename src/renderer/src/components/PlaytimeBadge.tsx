import { useCallback, useEffect, useMemo, useState } from 'react'
import { Clock3, RefreshCw } from 'lucide-react'
import type { PlaytimeReport } from '@shared/types'
import { useLauncher } from '../store'
import { cleanError, formatDuration, formatPlaytimeSpan } from '../lib/format'
import { EmptyState, Modal, Spinner } from './ui'

function shortStamp(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function PlaytimeBadge() {
  const launch = useLauncher((state) => state.launch)
  const instances = useLauncher((state) => state.instances)
  const [report, setReport] = useState<PlaytimeReport | null>(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [now, setNow] = useState(Date.now())

  const liveStart =
    report?.active?.startedAt ??
    (launch.status === 'running' ? launch.startedAt : null)
  const running = Boolean(liveStart)
  const liveMs = liveStart ? Math.max(0, now - liveStart) : 0
  const activeInstanceId = report?.active?.instanceId ?? launch.instanceId
  const runningName =
    instances.find((instance) => instance.id === activeInstanceId)?.name ??
    report?.active?.name ??
    launch.versionId ??
    '当前游戏'

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      setReport(await window.ccl.playtime.report())
      setError('')
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(true)
  }, [load])

  useEffect(() => {
    if (launch.status === 'running' || launch.status === 'exited' || launch.status === 'idle') {
      void load(true)
    }
  }, [launch.status, load])

  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running])

  useEffect(() => {
    if (open) void load(false)
  }, [open, load])

  useEffect(() => {
    const handler = () => setOpen(true)
    window.addEventListener('windletter:playtime-report', handler)
    return () => window.removeEventListener('windletter:playtime-report', handler)
  }, [])

  useEffect(() => window.ccl.playtime.onChanged(() => void load(true)), [load])

  const view = useMemo<PlaytimeReport | null>(() => {
    if (!report) return null
    if (!running || liveMs <= 0) return report
    const key = report.active
      ? (report.active.instanceId ?? `version:${report.active.versionId}`)
      : (launch.instanceId ?? `version:${launch.versionId ?? ''}`)
    const instancesNext = report.instances.map((item) => ({ ...item }))
    const current = instancesNext.find((item) => item.key === key)
    if (current) {
      current.durationMs += liveMs
      current.sessions += 1
    } else {
      instancesNext.push({
        key,
        name: runningName,
        durationMs: liveMs,
        sessions: 1
      })
    }
    instancesNext.sort((a, b) => b.durationMs - a.durationMs)
    return {
      ...report,
      weekMs: report.weekMs + liveMs,
      todayMs: report.todayMs + liveMs,
      totalMs: report.totalMs + liveMs,
      weekSessions: report.weekSessions + 1,
      totalSessions: report.totalSessions + 1,
      days: report.days.map((day) =>
        day.today
          ? { ...day, durationMs: day.durationMs + liveMs, sessions: day.sessions + 1 }
          : day
      ),
      instances: instancesNext.slice(0, 8)
    }
  }, [report, running, liveMs, launch.instanceId, launch.versionId, runningName])

  const badgeText = running
    ? `本次 ${formatDuration(liveMs)}`
    : report && report.weekMs > 0
      ? `本周 ${formatPlaytimeSpan(report.weekMs)}`
      : '本周 0 分钟'
  const maxDayMs = Math.max(1, ...(view?.days.map((day) => day.durationMs) ?? [0]))

  return (
    <>
      <button
        type="button"
        className={`playtime-badge ${running ? 'is-live' : ''}`}
        onClick={() => setOpen(true)}
        title="查看游戏时长周报"
      >
        {running ? <span className="playtime-live-dot" /> : <Clock3 size={12} />}
        <span>{badgeText}</span>
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="游戏时长周报"
        subtitle="本周一至今天，数据只保存在本机"
        icon={<Clock3 size={18} />}
        size="lg"
        footer={
          <div className="playtime-footer">
            <span>从 0.36.0 起记录；关闭启动器后由独立监视进程继续计时，下次打开自动补进周报。</span>
            <div>
              <button
                type="button"
                className="button button--ghost"
                onClick={() => void load(false)}
                disabled={loading}
              >
                <RefreshCw size={13} className={loading ? 'spin' : ''} />
                刷新
              </button>
              <button type="button" className="button button--soft" onClick={() => setOpen(false)}>
                关闭
              </button>
            </div>
          </div>
        }
      >
        {error ? (
          <div className="playtime-error">
            <span>{error}</span>
            <button type="button" className="link-button" onClick={() => void load(false)}>
              重试
            </button>
          </div>
        ) : loading && !view ? (
          <div className="playtime-loading">
            <Spinner size={16} />
            正在读取游戏时长…
          </div>
        ) : !view || (view.totalSessions === 0 && !running) ? (
          <EmptyState
            icon={<Clock3 size={26} />}
            title="还没有游戏时长记录"
            description="从风信启动一次游戏后，这里会自动记录每次游玩时长和本周统计。"
          />
        ) : (
          <div className="playtime-report">
            <div className="playtime-summary">
              <div className="playtime-summary-main">
                <span>本周游戏</span>
                <strong>{formatPlaytimeSpan(view.weekMs)}</strong>
                <em>
                  {view.weekSessions} 次
                  {view.lastWeekMs > 0
                    ? ` · 上周 ${formatPlaytimeSpan(view.lastWeekMs)}`
                    : ''}
                </em>
              </div>
              <div>
                <span>今天</span>
                <strong>{formatPlaytimeSpan(view.todayMs)}</strong>
              </div>
              <div>
                <span>累计</span>
                <strong>{formatPlaytimeSpan(view.totalMs)}</strong>
              </div>
            </div>

            {running && (
              <div className="playtime-live-banner">
                <span className="playtime-live-dot" />
                正在游戏：{runningName} · 本次 {formatDuration(liveMs)}
              </div>
            )}

            <section className="playtime-chart-card">
              <header>
                <span>本周每日</span>
                <span>周一 — 周日</span>
              </header>
              <div className="playtime-bars">
                {view.days.map((day) => {
                  const height = day.durationMs > 0 ? Math.max(6, (day.durationMs / maxDayMs) * 100) : 2
                  return (
                    <div
                      key={day.date}
                      className={`playtime-bar ${day.today ? 'is-today' : ''} ${day.future ? 'is-future' : ''}`}
                      title={`${day.label} · ${formatPlaytimeSpan(day.durationMs)}${day.sessions > 0 ? ` · ${day.sessions} 次` : ''}`}
                    >
                      <span className="playtime-bar-value">
                        {day.durationMs > 0 ? formatDuration(day.durationMs) : ''}
                      </span>
                      <span className="playtime-bar-track">
                        <span style={{ height: `${height}%` }} />
                      </span>
                      <span className="playtime-bar-label">{day.label}</span>
                    </div>
                  )
                })}
              </div>
            </section>

            <div className="playtime-columns">
              <section className="playtime-list-card">
                <header>
                  <span>本周实例</span>
                  <span>{view.instances.length}</span>
                </header>
                {view.instances.length === 0 ? (
                  <p className="playtime-empty-line">本周还没有实例时长。</p>
                ) : (
                  <div className="playtime-instance-list">
                    {view.instances.map((item) => {
                      const max = Math.max(1, view.instances[0]?.durationMs ?? 1)
                      return (
                        <div key={item.key} className="playtime-instance-row">
                          <span className="playtime-instance-head">
                            <strong title={item.name}>{item.name}</strong>
                            <span>{formatPlaytimeSpan(item.durationMs)}</span>
                          </span>
                          <span className="playtime-instance-track">
                            <span style={{ width: `${Math.max(3, (item.durationMs / max) * 100)}%` }} />
                          </span>
                          <small>{item.sessions} 次</small>
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>

              <section className="playtime-list-card">
                <header>
                  <span>最近游戏</span>
                  <span>{view.recent.length}</span>
                </header>
                {view.recent.length === 0 ? (
                  <p className="playtime-empty-line">还没有已结束的游戏记录。</p>
                ) : (
                  <div className="playtime-session-list">
                    {view.recent.map((session) => (
                      <div key={session.id} className="playtime-session-row">
                        <span
                          className={`playtime-session-dot ${session.exitCode !== null && session.exitCode !== 0 ? 'is-abnormal' : ''}`}
                          title={
                            session.exitCode === null
                              ? '没有记录到退出代码'
                              : session.exitCode === 0
                                ? '正常退出'
                                : `异常退出（${session.exitCode}）`
                          }
                        />
                        <span className="playtime-session-copy">
                          <strong title={session.name}>{session.name}</strong>
                          <small>
                            {shortStamp(session.startedAt)} ·{' '}
                            {session.versionId !== session.name ? session.versionId : 'Minecraft'}
                          </small>
                        </span>
                        <span className="playtime-session-duration">
                          {formatPlaytimeSpan(session.durationMs)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
