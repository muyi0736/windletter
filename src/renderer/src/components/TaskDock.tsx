import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  Archive,
  Boxes,
  Check,
  ChevronDown,
  Coffee,
  Download,
  Layers,
  ListChecks,
  Package,
  Server,
  Sparkles,
  X
} from 'lucide-react'
import type { TaskParallelState } from '@shared/types'
import { useLauncher } from '../store'
import { formatBytes, formatDuration, formatSpeed } from '../lib/format'
import { Modal, ProgressBar, Spinner } from './ui'

function parallelMeta(parallel: TaskParallelState): string {
  const { detail } = parallel
  if (parallel.progress >= 100) return '已完成'
  if (detail.total > 0) {
    return `${detail.current}/${detail.total} · ${formatSpeed(detail.speed)}`
  }
  if (detail.bytesTotal > 0) {
    return `${formatBytes(detail.bytesDone)} / ${formatBytes(detail.bytesTotal)} · ${formatSpeed(detail.speed)}`
  }
  return formatSpeed(detail.speed)
}

export function TaskDock() {
  const tasks = useLauncher((state) => state.tasks)
  const cancelTask = useLauncher((state) => state.cancelTask)
  const consoleOpen = useLauncher((state) => state.consoleOpen)
  const [collapsed, setCollapsed] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [detailId, setDetailId] = useState<string | null>(null)

  const hasRunning = tasks.some((task) => task.status === 'running')
  useEffect(() => {
    if (!hasRunning) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [hasRunning])

  if (tasks.length === 0 || consoleOpen) return null

  const ordered = [...tasks].sort((a, b) => {
    if ((a.status === 'running' || a.status === 'paused') && b.status !== 'running' && b.status !== 'paused') return -1
    if (a.status !== 'running' && a.status !== 'paused' && (b.status === 'running' || b.status === 'paused')) return 1
    return b.createdAt - a.createdAt
  })
  const running = ordered.filter((task) => task.status === 'running' || task.status === 'paused').length

  const detailTask = detailId ? tasks.find((task) => task.id === detailId) ?? null : null
  const detailElapsed = detailTask ? (detailTask.finishedAt ?? now) - detailTask.createdAt : 0
  const detailActive = detailTask?.detail.activeFiles ?? []
  const detailEta =
    detailTask &&
    detailTask.detail.speed > 0 &&
    detailTask.detail.bytesTotal > detailTask.detail.bytesDone
      ? formatDuration(
          ((detailTask.detail.bytesTotal - detailTask.detail.bytesDone) /
            detailTask.detail.speed) *
            1000
        )
      : '—'
  const detailStatus = detailTask
    ? ({ running: '进行中', paused: '已暂停', done: '已完成', error: '失败', cancelled: '已取消' } as const)[
        detailTask.status
      ]
    : ''

  return (
    <aside className={`task-dock ${collapsed ? 'is-collapsed' : ''}`} aria-label="任务队列">
      <button type="button" className="task-dock-head" onClick={() => setCollapsed((value) => !value)}>
        <span className="task-dock-title">
          <ListChecks size={15} />
          任务队列
          {running > 0 && <span className="task-dock-count">{running}</span>}
        </span>
        <span className="task-dock-hint">
          {running > 0 ? '正在处理任务' : '全部完成'}
          <ChevronDown size={14} className="task-dock-chevron" />
        </span>
      </button>

      {!collapsed && (
        <div className="task-dock-list">
          {ordered.map((task) => {
            const runningTask = task.status === 'running'
            const total = task.detail.total > 0 ? task.detail.total : 0
            const current = task.detail.current
            const elapsed = (task.finishedAt ?? now) - task.createdAt
            const activeFiles = task.detail.activeFiles ?? []
            const expanded = expandedId === task.id
            return (
              <article key={task.id} className={`task-card task-card--${task.status}`}>
                <div className="task-card-icon">
                  {task.kind === 'install' ? (
                    <Download size={16} />
                  ) : task.kind === 'instance' ? (
                    <Boxes size={16} />
                  ) : task.kind === 'modpack' ? (
                    <Package size={16} />
                  ) : task.kind === 'loader' ? (
                    <Layers size={16} />
                  ) : task.kind === 'preset' ? (
                    <Sparkles size={16} />
                  ) : task.kind === 'world' ? (
                    <Archive size={16} />
                  ) : task.kind === 'serverPack' ? (
                    <Server size={16} />
                  ) : (
                    <Coffee size={16} />
                  )}
                </div>
                <div className="task-card-body">
                  <div className="task-card-top">
                    <strong title={task.title}>{task.title}</strong>
                    <button
                      type="button"
                      className={`task-detail-toggle ${expanded ? 'is-open' : ''}`}
                      title="下载详情"
                      aria-label="下载详情"
                      onClick={() => setExpandedId(expanded ? null : task.id)}
                    >
                      <ChevronDown size={13} />
                    </button>
                    {runningTask ? (
                      <button
                        type="button"
                        className="task-cancel"
                        onClick={() => void cancelTask(task.id)}
                        title="取消任务"
                        aria-label="取消任务"
                      >
                        <X size={13} />
                      </button>
                    ) : task.status === 'done' ? (
                      <span className="task-state task-state--done">
                        <Check size={13} />
                        完成
                      </span>
                    ) : task.status === 'error' ? (
                      <span className="task-state task-state--error">
                        <AlertTriangle size={12} />
                        失败
                      </span>
                    ) : task.status === 'paused' ? (
                      <span className="task-state task-state--muted">已暂停</span>
                    ) : (
                      <span className="task-state task-state--muted">已取消</span>
                    )}
                  </div>
                  <div className="task-card-stage">
                    <span>{task.stage}</span>
                    {runningTask && total > 0 && (
                      <span>
                        {total === 1 && activeFiles.length === 1
                          ? `下载中 ${Math.round(
                              (activeFiles[0].bytes / Math.max(1, activeFiles[0].size)) * 100
                            )}%`
                          : `${current}/${total}`}{' '}
                        · {formatSpeed(task.detail.speed)}
                      </span>
                    )}
                    {runningTask && total === 0 && task.detail.bytesTotal > 0 && (
                      <span>
                        {formatBytes(task.detail.bytesDone)} / {formatBytes(task.detail.bytesTotal)}
                      </span>
                    )}
                    {runningTask && <span className="task-elapsed">{formatDuration(elapsed)}</span>}
                    {runningTask && <Spinner size={12} />}
                  </div>
                  <ProgressBar
                    percent={task.progress}
                    tone={task.status === 'error' ? 'danger' : task.status === 'done' ? 'success' : 'accent'}
                    size="sm"
                  />
                  {runningTask && task.parallel && (
                    <div className="task-parallel">
                      <div className="task-parallel-head">
                        <span title={task.parallel.stage}>{task.parallel.stage}</span>
                        <span>{parallelMeta(task.parallel)}</span>
                      </div>
                      <ProgressBar percent={task.parallel.progress} size="sm" />
                    </div>
                  )}
                  {!runningTask && task.status !== 'paused' && (
                    <div className="task-finished-meta">本次耗时 {formatDuration(elapsed)}</div>
                  )}
                  {task.error && <p className="task-error-text">{task.error}</p>}
                  {expanded && (
                    <div className="task-detail-panel">
                      <div className="task-detail-grid">
                        <span>速度</span>
                        <span>{formatSpeed(task.detail.speed)}</span>
                        <span>文件</span>
                        <span>
                          {current} / {total || '—'}
                        </span>
                        <span>数据</span>
                        <span>
                          {formatBytes(task.detail.bytesDone)} /{' '}
                          {formatBytes(task.detail.bytesTotal)}
                        </span>
                        <span>耗时</span>
                        <span>{formatDuration(elapsed)}</span>
                      </div>
                      <button
                        type="button"
                        className="button button--ghost button--xs task-detail-expand"
                        onClick={() => setDetailId(task.id)}
                      >
                        放大查看
                      </button>
                      {activeFiles.length > 0 && (
                        <div className="task-active-files">
                          <strong>正在下载</strong>
                          {activeFiles.map((file) => (
                            <div key={file.label} className="task-active-file">
                              <div className="task-active-file-head">
                                <span title={file.label}>{file.label}</span>
                                <span>
                                  {file.size > 0
                                    ? `${Math.round((file.bytes / file.size) * 100)}%`
                                    : formatBytes(file.bytes)}
                                </span>
                              </div>
                              <ProgressBar
                                percent={file.size > 0 ? (file.bytes / file.size) * 100 : 0}
                                size="sm"
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}
      <Modal
        open={Boolean(detailTask)}
        onClose={() => setDetailId(null)}
        title="下载详情"
        subtitle={detailTask?.title}
        icon={<Download size={18} />}
        size="lg"
      >
        {detailTask && (
          <div className="download-detail">
            <div className="download-detail-stage">
              <span>{detailTask.stage}</span>
              <strong>{Math.round(detailTask.progress)}%</strong>
            </div>
            <ProgressBar percent={detailTask.progress} size="md" />
            <div className="download-detail-grid">
              <div>
                <span>实时速度</span>
                <strong>{formatSpeed(detailTask.detail.speed)}</strong>
              </div>
              <div>
                <span>文件进度</span>
                <strong>
                  {detailTask.detail.current} / {detailTask.detail.total || '—'}
                </strong>
              </div>
              <div>
                <span>已传输</span>
                <strong>
                  {formatBytes(detailTask.detail.bytesDone)} /{' '}
                  {formatBytes(detailTask.detail.bytesTotal)}
                </strong>
              </div>
              <div>
                <span>已耗时</span>
                <strong>{formatDuration(detailElapsed)}</strong>
              </div>
              <div>
                <span>预计剩余</span>
                <strong>{detailEta}</strong>
              </div>
              <div>
                <span>状态</span>
                <strong>{detailStatus}</strong>
              </div>
            </div>
            <div className="download-detail-files">
              <div className="download-detail-files-head">
                <strong>正在下载</strong>
                <span>{detailActive.length} 个文件</span>
              </div>
              {detailActive.length > 0 ? (
                detailActive.map((file) => (
                  <div key={file.label} className="download-detail-file">
                    <div className="download-detail-file-head">
                      <span title={file.label}>{file.label}</span>
                      <span>
                        {formatBytes(file.bytes)} / {formatBytes(file.size)}
                      </span>
                    </div>
                    <ProgressBar
                      percent={file.size > 0 ? (file.bytes / file.size) * 100 : 0}
                      size="sm"
                    />
                  </div>
                ))
              ) : (
                <p className="download-detail-empty">
                  当前阶段没有逐文件进度，整体进度以上方为准。
                </p>
              )}
            </div>
            {detailTask.error && (
              <div className="download-detail-error">{detailTask.error}</div>
            )}
          </div>
        )}
      </Modal>
    </aside>
  )
}
