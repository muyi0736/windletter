import { useCallback, useEffect, useState } from 'react'
import {
  Activity,
  Copy,
  Download,
  FileText,
  FolderOpen,
  RefreshCw
} from 'lucide-react'
import type { DownloadLogSummary } from '@shared/types'
import { useLauncher } from '../store'
import { cleanError, formatBytes, formatDateTime, formatSpeed } from '../lib/format'
import { Badge, EmptyState, Modal, Spinner } from './ui'

const STATUS_META: Record<
  DownloadLogSummary['status'],
  { label: string; tone: 'neutral' | 'success' | 'danger' }
> = {
  running: { label: '未完成', tone: 'neutral' },
  success: { label: '成功', tone: 'success' },
  failed: { label: '失败', tone: 'danger' }
}

export function DownloadLogsModal({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}) {
  const toast = useLauncher((state) => state.toast)
  const [logs, setLogs] = useState<DownloadLogSummary[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [reading, setReading] = useState(false)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')

  const loadText = useCallback(async (name: string) => {
    setSelected(name)
    setReading(true)
    setError('')
    try {
      setText(await window.ccl.downloadLogs.read(name))
    } catch (err) {
      setText('')
      setError(cleanError(err))
    } finally {
      setReading(false)
    }
  }, [])

  const load = useCallback(
    async (prefer?: string) => {
      setLoading(true)
      setError('')
      try {
        const next = await window.ccl.downloadLogs.list()
        setLogs(next)
        const target =
          (prefer && next.some((item) => item.name === prefer) ? prefer : null) ??
          (selected && next.some((item) => item.name === selected) ? selected : null) ??
          next[0]?.name ??
          null
        if (target) await loadText(target)
        else {
          setSelected(null)
          setText('')
        }
      } catch (err) {
        setError(cleanError(err))
      } finally {
        setLoading(false)
      }
    },
    [loadText, selected]
  )

  useEffect(() => {
    if (!open) return
    void load()
    // 只在打开时刷新，选中变化不重复拉列表。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const runNetworkCheck = async () => {
    setChecking(true)
    try {
      const summary = await window.ccl.downloadLogs.networkCheck()
      await load(summary.name)
      toast('success', '线路体检完成', '已生成诊断日志')
    } catch (err) {
      toast('error', '线路体检失败', cleanError(err))
    } finally {
      setChecking(false)
    }
  }

  const exportLog = async () => {
    if (!selected) return
    try {
      const path = await window.ccl.downloadLogs.exportLog(selected)
      if (path) toast('success', '诊断日志已导出', path)
    } catch (err) {
      toast('error', '导出失败', cleanError(err))
    }
  }

  const copyLog = async () => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      toast('success', '已复制下载诊断')
    } catch (err) {
      toast('error', '复制失败', cleanError(err))
    }
  }

  const openFolder = () => {
    void window.ccl.downloadLogs.openFolder().catch((err) => {
      toast('error', '无法打开下载日志目录', cleanError(err))
    })
  }

  const current = logs.find((item) => item.name === selected) ?? null

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title="下载日志"
      subtitle="记录线路测速、阶段耗时、来源主机和慢文件；导出后可直接发送用于排查其他设备"
      icon={<FileText size={18} />}
      footer={
        <div className="download-logs-footer">
          <div className="download-logs-footer-left">
            <button type="button" className="button button--soft button--sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw size={14} />
              刷新
            </button>
            <button
              type="button"
              className="button button--soft button--sm"
              onClick={() => void runNetworkCheck()}
              disabled={checking}
            >
              {checking ? <Spinner size={14} /> : <Activity size={14} />}
              网络体检
            </button>
          </div>
          <div className="download-logs-footer-right">
            <button type="button" className="button button--soft button--sm" onClick={openFolder}>
              <FolderOpen size={14} />
              打开目录
            </button>
            <button type="button" className="button button--soft button--sm" onClick={() => void copyLog()} disabled={!text}>
              <Copy size={14} />
              复制
            </button>
            <button type="button" className="button button--primary button--sm" onClick={() => void exportLog()} disabled={!selected}>
              <Download size={14} />
              导出诊断
            </button>
          </div>
        </div>
      }
    >
      <div className="download-logs">
        <aside className="download-logs-list">
          {loading && logs.length === 0 ? (
            <div className="download-logs-loading">
              <Spinner size={18} /> 正在读取…
            </div>
          ) : logs.length === 0 ? (
            <EmptyState
              icon={<FileText size={24} />}
              title="还没有下载日志"
              description="安装或升级整合包后会自动生成；也可以先运行一次网络体检。"
            />
          ) : (
            logs.map((item) => {
              const meta = STATUS_META[item.status]
              return (
                <button
                  key={item.name}
                  type="button"
                  className={`download-log-item ${item.name === selected ? 'is-active' : ''}`}
                  onClick={() => void loadText(item.name)}
                >
                  <div className="download-log-item-head">
                    <span className="download-log-item-title">{item.pack || item.task}</span>
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                  </div>
                  <div className="download-log-item-meta">
                    <span>{formatDateTime(item.startedAt)}</span>
                    <span>{item.task}</span>
                  </div>
                  <div className="download-log-item-stats">
                    <span>{formatBytes(item.bytes)}</span>
                    <span>{formatSpeed(item.avgBps)}</span>
                  </div>
                </button>
              )
            })
          )}
        </aside>

        <section className="download-logs-detail">
          {error ? <div className="download-logs-error">{error}</div> : null}
          {selected && current ? (
            <header className="download-logs-detail-head">
              <div>
                <strong>{current.pack || current.task}</strong>
                <span>
                  {formatDateTime(current.startedAt)} · {formatBytes(current.bytes)} ·{' '}
                  {formatSpeed(current.avgBps)}
                </span>
              </div>
              <Badge tone={STATUS_META[current.status].tone}>
                {STATUS_META[current.status].label}
              </Badge>
            </header>
          ) : null}
          {reading ? (
            <div className="download-logs-loading">
              <Spinner size={18} /> 正在读取日志…
            </div>
          ) : text ? (
            <pre className="download-log-text">{text}</pre>
          ) : (
            <EmptyState
              icon={<FileText size={24} />}
              title="选择一条日志"
              description="左侧列表按时间倒序排列，失败任务会优先保留。"
            />
          )}
        </section>
      </div>
    </Modal>
  )
}
