import {
  ChevronRight,
  Clipboard,
  FolderOpen,
  ListChecks,
  Maximize2,
  Pause,
  Play,
  X
} from 'lucide-react'
import type { LaunchLogLine, TaskState } from '@shared/types'
import { ProgressBar } from './ui'

interface RightPanelProps {
  isCollapsed: boolean
  onToggleCollapse: () => void
  tasks: TaskState[]
  logs: LaunchLogLine[]
  onOpenConsole: () => void
  onCopyLog: () => void
  onOpenLogFile: () => void
  onPauseTask: (id: string) => void
  onResumeTask: (id: string) => void
  onCancelTask: (id: string) => void
  onClearFinished: () => void
}

function taskTitle(task: TaskState): string {
  if (task.kind === 'install') return `安装 Minecraft ${task.versionId ?? ''}`.trim()
  if (task.kind === 'java') return '准备 Java 运行时'
  if (task.kind === 'modpack') return task.title.replace(/^安装整合包\s*/, '安装 ')
  if (task.kind === 'preset') return task.title.replace(/^安装预设模组\s*/, '预设 ')
  if (task.kind === 'world') return task.title
  return task.title
}

function taskMark(task: TaskState): string {
  if (task.kind === 'install') return 'MC'
  if (task.kind === 'java') return 'J'
  if (task.kind === 'preset') return '预'
  if (task.kind === 'world') return '存'
  if (task.kind === 'instance') return '实'
  if (task.kind === 'serverPack') return '服'
  return 'PK'
}

export function RightPanel({
  isCollapsed,
  onToggleCollapse,
  tasks,
  logs,
  onOpenConsole,
  onCopyLog,
  onOpenLogFile,
  onPauseTask,
  onResumeTask,
  onCancelTask,
  onClearFinished
}: RightPanelProps) {
  const active = tasks.filter(
    (task) => task.status === 'running' || task.status === 'paused'
  )
  const runningCount = active.filter((task) => task.status === 'running').length
  const pausedCount = active.filter((task) => task.status === 'paused').length
  const finishedCount = tasks.length - active.length
  const recentLogs = logs.slice(-20)

  return (
    <aside className={`right-panel ${isCollapsed ? 'is-collapsed' : ''}`}>
      {!isCollapsed && (
        <button
          type="button"
          className="right-panel-toggle"
          onClick={onToggleCollapse}
          title="折叠侧栏"
        >
          <ChevronRight size={15} />
        </button>
      )}

      {isCollapsed ? (
        <div className="right-rail">
          <button
            type="button"
            className="right-rail-activity"
            onClick={onToggleCollapse}
            title="展开任务与日志"
          >
            <ListChecks size={16} />
            {active.length > 0 && <em>{active.length}</em>}
            <span>活动</span>
          </button>
        </div>
      ) : (
        <>
          <section className="sidebar-card task-panel">
            <div className="sidebar-card-head">
              <span>后台任务</span>
              <span className="sidebar-count">{active.length}</span>
            </div>
            {active.length === 0 ? (
              <p className="sidebar-empty">当前没有后台任务</p>
            ) : (
              <div className="sidebar-task-list">
                {active.slice(0, 3).map((task) => (
                  <div key={task.id} className="sidebar-task">
                    <div className="sidebar-task-line">
                      <span className="sidebar-task-mark">{taskMark(task)}</span>
                      <span className="sidebar-task-title">{taskTitle(task)}</span>
                      <span className="sidebar-task-percent">{Math.round(task.progress)}%</span>
                    </div>
                    <ProgressBar percent={task.progress} size="sm" />
                    <div className="sidebar-task-foot">
                      <p className="sidebar-task-stage">{task.stage}</p>
                      <span className="sidebar-task-actions">
                        {task.status === 'running' ? (
                          <button
                            type="button"
                            title="暂停"
                            onClick={() => onPauseTask(task.id)}
                          >
                            <Pause size={11} />
                          </button>
                        ) : (
                          <button
                            type="button"
                            title="继续"
                            onClick={() => onResumeTask(task.id)}
                          >
                            <Play size={11} />
                          </button>
                        )}
                        <button
                          type="button"
                          title="取消任务"
                          onClick={() => onCancelTask(task.id)}
                        >
                          <X size={11} />
                        </button>
                      </span>
                    </div>
                  </div>
                ))}
                {active.length > 3 && (
                  <p className="sidebar-more">还有 {active.length - 3} 个任务</p>
                )}
              </div>
            )}
            {(runningCount > 0 || pausedCount > 0 || finishedCount > 0) && (
              <div className="sidebar-task-toolbar">
                {runningCount > 0 && (
                  <button
                    type="button"
                    onClick={() => active.filter((task) => task.status === 'running').forEach((task) => onPauseTask(task.id))}
                  >
                    全部暂停
                  </button>
                )}
                {pausedCount > 0 && (
                  <button
                    type="button"
                    onClick={() => active.filter((task) => task.status === 'paused').forEach((task) => onResumeTask(task.id))}
                  >
                    全部继续
                  </button>
                )}
                {finishedCount > 0 && (
                  <button type="button" onClick={onClearFinished}>
                    清理完成
                  </button>
                )}
              </div>
            )}
          </section>

          <section className="sidebar-card log-panel">
            <div className="sidebar-card-head">
              <span>游戏日志</span>
              <span className="sidebar-icon-group">
                <button
                  type="button"
                  className="sidebar-icon-button"
                  onClick={onOpenLogFile}
                  title="打开日志文件"
                >
                  <FolderOpen size={12} />
                </button>
                <button type="button" className="sidebar-icon-button" onClick={onCopyLog} title="复制日志">
                  <Clipboard size={12} />
                </button>
              </span>
            </div>
            <div className="sidebar-log">
              {recentLogs.length === 0 ? (
                <p className="sidebar-empty">等待游戏启动…</p>
              ) : (
                recentLogs.map((line, index) => (
                  <div key={`${line.time}-${index}`} className={`sidebar-log-line is-${line.stream}`}>
                    {line.text}
                  </div>
                ))
              )}
            </div>
            <button type="button" className="button button--soft button--sm sidebar-wide-button" onClick={onOpenConsole}>
              <Maximize2 size={12} />
              展开控制台
            </button>
          </section>

        </>
      )}
    </aside>
  )
}
