import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Check,
  Clipboard,
  FolderOpen,
  RefreshCw,
  Terminal,
  X
} from 'lucide-react'
import type { LaunchLogLevel, LaunchLogLine } from '@shared/types'
import { useLauncher } from '../store'
import { copyText } from '../lib/clipboard'
import { formatClock } from '../lib/format'
import { Badge, IconButton, Spinner, type BadgeTone } from './ui'

type ConsoleFilter = 'all' | 'warn' | 'error'

interface ConsoleRow {
  line: LaunchLogLine
  count: number
  firstTime: number
  lastTime: number
}

const FILTERS: Array<{ value: ConsoleFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'warn', label: '警告+' },
  { value: 'error', label: '错误' }
]

const LEVEL_SEVERITY: Record<LaunchLogLevel, number> = {
  trace: 0,
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 3
}

function launchStatusView(status: string): { label: string; tone: BadgeTone } {
  switch (status) {
    case 'preparing':
      return { label: '准备中', tone: 'accent' }
    case 'starting':
      return { label: '启动中', tone: 'accent' }
    case 'running':
      return { label: '游戏运行中', tone: 'success' }
    case 'error':
      return { label: '启动失败', tone: 'danger' }
    case 'exited':
      return { label: '游戏已退出', tone: 'neutral' }
    default:
      return { label: '等待启动', tone: 'neutral' }
  }
}

function readFilter(): ConsoleFilter {
  const value = localStorage.getItem('ccl-console-filter')
  return value === 'warn' || value === 'error' ? value : 'all'
}

function readToggle(key: string, fallback: boolean): boolean {
  const value = localStorage.getItem(key)
  return value === null ? fallback : value === 'true'
}

function severityOf(line: LaunchLogLine): number {
  if (line.level) return LEVEL_SEVERITY[line.level]
  if (line.stream === 'stderr') return 2
  if (line.stream === 'system') return 1
  return /error|exception|failed|could not|caused by/i.test(line.text) ? 3 : 1
}

function levelView(line: LaunchLogLine): { label: string; tone: string } {
  if (line.level === 'fatal') return { label: 'FATAL', tone: 'error' }
  if (line.level) return { label: line.level.toUpperCase(), tone: line.level }
  if (line.stream === 'system') return { label: 'SYS', tone: 'system' }
  if (line.stream === 'stderr') return { label: 'ERR', tone: 'stderr' }
  return { label: 'OUT', tone: 'stdout' }
}

function rowClassOf(line: LaunchLogLine): string {
  if (line.level === 'warn') return 'console-line console-line--warn'
  if (line.level === 'error' || line.level === 'fatal') return 'console-line console-line--error'
  if (line.level === 'debug' || line.level === 'trace') return 'console-line console-line--muted'
  if (!line.level && /error|exception|failed|could not/i.test(line.text)) {
    return 'console-line console-line--error'
  }
  if (line.stream === 'stderr') return 'console-line console-line--stderr'
  if (line.stream === 'system') return 'console-line console-line--system'
  return 'console-line'
}

function loggerLabel(logger: string): string {
  const parts = logger.split('.')
  return parts[parts.length - 1] || logger
}

function sameLogLine(left: LaunchLogLine, right: LaunchLogLine): boolean {
  return (
    left.text === right.text &&
    left.level === right.level &&
    left.logger === right.logger &&
    left.stream === right.stream &&
    (left.detail ?? '') === (right.detail ?? '')
  )
}

function collapseLogs(lines: LaunchLogLine[], collapse: boolean): ConsoleRow[] {
  if (!collapse) {
    return lines.map((line) => ({
      line,
      count: 1,
      firstTime: line.time,
      lastTime: line.time
    }))
  }
  const rows: ConsoleRow[] = []
  for (const line of lines) {
    const previous = rows[rows.length - 1]
    if (previous && sameLogLine(previous.line, line)) {
      previous.count += 1
      previous.lastTime = line.time
      continue
    }
    rows.push({ line, count: 1, firstTime: line.time, lastTime: line.time })
  }
  return rows
}

function formatLineForCopy(line: LaunchLogLine): string {
  const label = line.level ? line.level.toUpperCase() : line.stream.toUpperCase()
  const source = line.logger
    ? ` [${line.logger}${line.thread ? ` / ${line.thread}` : ''}]`
    : ''
  const detail = line.detail ? `\n${line.detail}` : ''
  return `[${formatClock(line.time)}] [${label}]${source} ${line.text}${detail}`
}

export function ConsoleDrawer() {
  const open = useLauncher((state) => state.consoleOpen)
  const tab = useLauncher((state) => state.consoleTab)
  const logs = useLauncher((state) => state.logs)
  const launch = useLauncher((state) => state.launch)
  const closeConsole = useLauncher((state) => state.closeConsole)
  const setConsoleTab = useLauncher((state) => state.setConsoleTab)
  const toast = useLauncher((state) => state.toast)

  const [autoScroll, setAutoScroll] = useState(() => readToggle('ccl-console-autoscroll', true))
  const [filter, setFilter] = useState<ConsoleFilter>(readFilter)
  const [collapse, setCollapse] = useState(() => readToggle('ccl-console-collapse', true))
  const [fileText, setFileText] = useState('')
  const [fileLoading, setFileLoading] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const viewportRef = useRef<HTMLDivElement>(null)

  const loadFile = useCallback(async () => {
    setFileLoading(true)
    setFileError(null)
    try {
      const text = await window.ccl.logs.readLatest()
      setFileText(text)
      if (!text) setFileError('还没有保存过游戏日志，先启动一次游戏吧')
    } catch (error) {
      setFileError(error instanceof Error ? error.message : String(error))
    } finally {
      setFileLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open && tab === 'file') void loadFile()
  }, [open, tab, loadFile])

  useEffect(() => {
    localStorage.setItem('ccl-console-filter', filter)
  }, [filter])

  useEffect(() => {
    localStorage.setItem('ccl-console-collapse', String(collapse))
  }, [collapse])

  useEffect(() => {
    localStorage.setItem('ccl-console-autoscroll', String(autoScroll))
  }, [autoScroll])

  useEffect(() => {
    if (!open || !autoScroll) return
    const viewport = viewportRef.current
    if (viewport) viewport.scrollTop = viewport.scrollHeight
  }, [open, tab, logs, fileText, autoScroll, filter, collapse])

  const stats = useMemo(() => {
    let warn = 0
    let error = 0
    for (const line of logs) {
      const severity = severityOf(line)
      if (severity >= 2) warn += 1
      if (severity >= 3) error += 1
    }
    return { warn, error }
  }, [logs])

  const filteredLogs = useMemo(() => {
    const minimum = filter === 'all' ? 0 : filter === 'warn' ? 2 : 3
    return minimum === 0 ? logs : logs.filter((line) => severityOf(line) >= minimum)
  }, [logs, filter])

  const rows = useMemo(
    () => collapseLogs(filteredLogs, collapse),
    [filteredLogs, collapse]
  )

  if (!open) return null

  const status = launchStatusView(launch.status)
  const content =
    tab === 'launch' ? filteredLogs.map(formatLineForCopy).join('\n') : fileText

  const handleCopy = async () => {
    if (!content) {
      toast('info', '没有可复制的内容')
      return
    }
    const ok = await copyText(content)
    if (ok) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } else {
      toast('error', '复制失败', '系统剪贴板不可用')
    }
  }

  const handleOpenFolder = () => {
    void window.ccl.logs.openFolder().catch((error) => {
      toast('error', '无法打开日志文件夹', error instanceof Error ? error.message : String(error))
    })
  }

  return (
    <section className={`console-drawer ${open ? 'is-open' : ''}`} aria-label="日志控制台">
      <header className="console-head">
        <div className="console-head-title">
          <span className="console-icon">
            <Terminal size={16} />
          </span>
          <div>
            <strong>日志控制台</strong>
            <span>{launch.versionId ? `Minecraft ${launch.versionId}` : '启动器实时日志'}</span>
          </div>
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>
        <div className="console-tabs">
          <button
            type="button"
            className={`console-tab ${tab === 'launch' ? 'is-active' : ''}`}
            onClick={() => setConsoleTab('launch')}
          >
            启动日志
            {logs.length > 0 && <span>{logs.length}</span>}
          </button>
          <button
            type="button"
            className={`console-tab ${tab === 'file' ? 'is-active' : ''}`}
            onClick={() => setConsoleTab('file')}
          >
            最近日志
          </button>
        </div>
        <div className="console-actions">
          <label className="console-auto">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(event) => setAutoScroll(event.target.checked)}
            />
            <span className="console-auto-box">{autoScroll && <Check size={10} strokeWidth={3} />}</span>
            自动滚动
          </label>
          {tab === 'file' && (
            <IconButton label="刷新日志" onClick={() => void loadFile()} disabled={fileLoading}>
              <RefreshCw size={15} className={fileLoading ? 'spin' : ''} />
            </IconButton>
          )}
          <IconButton label="复制日志" onClick={() => void handleCopy()}>
            {copied ? <Check size={15} /> : <Clipboard size={15} />}
          </IconButton>
          <IconButton label="打开日志文件夹" onClick={handleOpenFolder}>
            <FolderOpen size={15} />
          </IconButton>
          <IconButton label="关闭控制台" onClick={closeConsole}>
            <X size={16} />
          </IconButton>
        </div>
      </header>

      {tab === 'launch' && logs.length > 0 && (
        <div className="console-toolbar">
          <div className="console-filters" role="group" aria-label="日志级别筛选">
            {FILTERS.map((item) => {
              const count =
                item.value === 'all' ? logs.length : item.value === 'warn' ? stats.warn : stats.error
              return (
                <button
                  key={item.value}
                  type="button"
                  className={`console-filter ${filter === item.value ? 'is-active' : ''}`}
                  aria-pressed={filter === item.value}
                  onClick={() => setFilter(item.value)}
                  title={
                    item.value === 'all'
                      ? '显示全部日志'
                      : item.value === 'warn'
                        ? '只看警告和错误'
                        : '只看错误和致命错误'
                  }
                >
                  {item.label}
                  <span>{count}</span>
                </button>
              )
            })}
          </div>
          <label className="console-auto console-collapse">
            <input
              type="checkbox"
              checked={collapse}
              onChange={(event) => setCollapse(event.target.checked)}
            />
            <span className="console-auto-box">{collapse && <Check size={10} strokeWidth={3} />}</span>
            折叠重复
          </label>
          <span className="console-visible">
            显示 {rows.length} / {filteredLogs.length} 条
          </span>
        </div>
      )}

      <div
        className="console-viewport"
        ref={viewportRef}
        onScroll={(event) => {
          const element = event.currentTarget
          const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 48
          if (atBottom !== autoScroll) setAutoScroll(atBottom)
        }}
      >
        {tab === 'launch' && logs.length === 0 && (
          <div className="console-empty">
            <Terminal size={22} />
            <span>启动游戏后，运行日志会实时显示在这里</span>
          </div>
        )}

        {tab === 'launch' && logs.length > 0 && rows.length === 0 && (
          <div className="console-empty">
            <AlertTriangle size={22} />
            <span>当前筛选下没有日志</span>
            {filter !== 'all' && (
              <button type="button" className="console-reset" onClick={() => setFilter('all')}>
                查看全部日志
              </button>
            )}
          </div>
        )}

        {tab === 'launch' &&
          rows.map((row, index) => {
            const { line } = row
            const view = levelView(line)
            const lines = line.text.split('\n')
            const long = lines.length > 5 || line.text.length > 700
            const repeatTitle =
              row.count > 1
                ? `连续重复 ${row.count} 次，首次 ${formatClock(row.firstTime)}，最近 ${formatClock(row.lastTime)}`
                : undefined
            return (
              <div key={`${row.firstTime}-${index}`} className={rowClassOf(line)}>
                <time title={new Date(row.lastTime).toLocaleString('zh-CN')}>
                  {formatClock(row.lastTime)}
                </time>
                <span
                  className={`console-stream console-stream--${view.tone}`}
                  title={view.label === 'OUT' ? '未解析的原始输出' : undefined}
                >
                  {view.label}
                </span>
                <div className="console-text">
                  {line.logger && (
                    <span
                      className="console-logger"
                      title={`${line.logger}${line.thread ? ` · ${line.thread}` : ''}`}
                    >
                      {loggerLabel(line.logger)}
                    </span>
                  )}
                  {row.count > 1 && (
                    <span className="console-repeat" title={repeatTitle}>
                      ×{row.count}
                    </span>
                  )}
                  {long ? (
                    <details className="console-long">
                      <summary>
                        <span className="console-long-preview">{lines[0]}</span>
                        <span className="console-long-more">
                          {lines.length > 1 ? `共 ${lines.length} 行` : '长文本'}
                        </span>
                      </summary>
                      <pre className="console-long-body">{line.text}</pre>
                    </details>
                  ) : (
                    <span className="console-message">{line.text}</span>
                  )}
                  {line.detail && (
                    <details className="console-stack">
                      <summary>异常堆栈 · {line.detail.split('\n').length} 行</summary>
                      <pre>{line.detail}</pre>
                    </details>
                  )}
                </div>
              </div>
            )
          })}

        {tab === 'file' && fileLoading && (
          <div className="console-empty">
            <Spinner size={18} />
            <span>正在读取日志文件…</span>
          </div>
        )}
        {tab === 'file' && !fileLoading && fileError && (
          <div className="console-empty">
            <Terminal size={22} />
            <span>{fileError}</span>
          </div>
        )}
        {tab === 'file' && !fileLoading && !fileError && <pre className="console-file">{fileText}</pre>}
      </div>
    </section>
  )
}
