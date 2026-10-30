import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Check,
  Clipboard,
  FolderOpen,
  RefreshCw,
  Terminal,
  X
} from 'lucide-react'
import { useLauncher } from '../store'
import { copyText } from '../lib/clipboard'
import { formatClock } from '../lib/format'
import { Badge, IconButton, Spinner, type BadgeTone } from './ui'

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

export function ConsoleDrawer() {
  const open = useLauncher((state) => state.consoleOpen)
  const tab = useLauncher((state) => state.consoleTab)
  const logs = useLauncher((state) => state.logs)
  const launch = useLauncher((state) => state.launch)
  const closeConsole = useLauncher((state) => state.closeConsole)
  const setConsoleTab = useLauncher((state) => state.setConsoleTab)
  const toast = useLauncher((state) => state.toast)

  const [autoScroll, setAutoScroll] = useState(true)
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
    if (!open || !autoScroll) return
    const viewport = viewportRef.current
    if (viewport) viewport.scrollTop = viewport.scrollHeight
  }, [open, tab, logs, fileText, autoScroll])

  if (!open) return null

  const status = launchStatusView(launch.status)
  const content =
    tab === 'launch'
      ? logs.map((line) => `[${formatClock(line.time)}] [${line.stream}] ${line.text}`).join('\n')
      : fileText

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

  const lineClass = (stream: string, text: string): string => {
    if (/error|exception|failed|could not/i.test(text)) return 'console-line console-line--error'
    if (stream === 'stderr') return 'console-line console-line--stderr'
    if (stream === 'system') return 'console-line console-line--system'
    return 'console-line'
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

        {tab === 'launch' &&
          logs.map((line, index) => (
            <div key={`${line.time}-${index}`} className={lineClass(line.stream, line.text)}>
              <time>{formatClock(line.time)}</time>
              <span className={`console-stream console-stream--${line.stream}`}>{line.stream}</span>
              <span className="console-text">{line.text}</span>
            </div>
          ))}

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
