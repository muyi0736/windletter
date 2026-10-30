import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  FolderOpen,
  Play,
  Square,
  Terminal,
  XCircle
} from 'lucide-react'
import type {
  InstanceSummary,
  KubeJsRuntimeProgress,
  KubeJsRuntimeReport
} from '@shared/types'
import { cleanError } from '../lib/format'
import { Modal, Spinner } from './ui'

function ToneIcon({ tone, size = 13 }: { tone: 'pass' | 'warn' | 'fail' | 'info'; size?: number }) {
  if (tone === 'fail') return <XCircle size={size} />
  if (tone === 'warn') return <AlertTriangle size={size} />
  if (tone === 'pass') return <CheckCircle2 size={size} />
  return <AlertTriangle size={size} />
}

export function KubeJsRuntimeModal({
  open,
  instance,
  onClose,
  onOpenIssue
}: {
  open: boolean
  instance: InstanceSummary | null
  onClose: () => void
  onOpenIssue: (path: string, line: number, column?: number) => void
}) {
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<KubeJsRuntimeProgress | null>(null)
  const [report, setReport] = useState<KubeJsRuntimeReport | null>(null)
  const [error, setError] = useState('')
  const runningRef = useRef(false)

  useEffect(() => {
    runningRef.current = running
  }, [running])

  useEffect(
    () => () => {
      if (runningRef.current) void window.ccl.workshop.cancelKubejsRuntime()
    },
    []
  )

  useEffect(() => {
    if (!open) return
    setRunning(false)
    setProgress(null)
    setReport(null)
    setError('')
    return window.ccl.workshop.onKubejsRuntimeProgress((next) => setProgress(next))
  }, [open, instance?.id])

  const start = async () => {
    if (!instance || running) return
    setRunning(true)
    setReport(null)
    setError('')
    setProgress({ stage: '准备运行验证', percent: 1, line: null })
    try {
      const next = await window.ccl.workshop.kubejsRuntimeCheck(instance.id)
      setReport(next)
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setRunning(false)
    }
  }

  const cancel = () => {
    void window.ccl.workshop.cancelKubejsRuntime()
  }

  if (!instance) return null

  const errors = report?.issues.filter((issue) => issue.level === 'error').length ?? 0
  const warnings = report?.issues.filter((issue) => issue.level === 'warning').length ?? 0
  const checks = report?.checks ?? []

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!running) onClose()
      }}
      title="KubeJS 实际运行验证"
      subtitle={`${instance.name} · 临时服务端`}
      icon={<Terminal size={18} />}
      size="lg"
      closeOnOverlay={!running}
      closeOnEscape={!running}
      footer={
        <div className="kjs-runtime-footer">
          {report && !running && (
            <button type="button" className="button button--ghost" onClick={onClose}>
              关闭
            </button>
          )}
          {running && (
            <button type="button" className="button button--ghost" onClick={cancel}>
              <Square size={12} />
              取消验证
            </button>
          )}
          {!running && (
            <button type="button" className="button button--primary" onClick={() => void start()}>
              <Play size={12} />
              {report ? '再运行一次' : '开始验证'}
            </button>
          )}
        </div>
      }
    >
      <div className="kjs-runtime-modal">
        <div className="kjs-runtime-note">
          <AlertTriangle size={14} />
          <span>
            会根据当前实例生成临时服务端包，补齐服务端启动器后实际启动，检查服务端/启动脚本、
            配方与标签注册是否报错。不会修改实例、脚本或存档；结束后删除临时包。
            client_scripts 只在客户端执行，本验证不会运行它们。
          </span>
        </div>

        {running && (
          <div className="serverpack-check-progress">
            <div>
              <strong>
                <Spinner size={11} />
                {progress?.stage ?? '正在准备临时服务端…'}
              </strong>
              <span>{progress ? `${Math.round(progress.percent)}%` : ''}</span>
            </div>
            <div className="serverpack-check-bar">
              <span style={{ width: `${Math.max(2, progress?.percent ?? 2)}%` }} />
            </div>
            {progress?.line && <small>{progress.line}</small>}
          </div>
        )}

        {report && (
          <>
            <div
              className={`serverpack-verify-result ${
                report.cancelled ? 'is-cancelled' : report.ok ? 'is-ok' : 'is-fail'
              }`}
            >
              {report.cancelled ? (
                <Square size={14} />
              ) : report.ok ? (
                <CheckCircle2 size={14} />
              ) : (
                <XCircle size={14} />
              )}
              <div>
                <strong>
                  {report.cancelled
                    ? '运行验证已取消'
                    : report.ok
                      ? '实际运行验证通过'
                      : '实际运行验证未通过'}
                </strong>
                <span>
                  {report.summary} · 耗时 {Math.max(0, Math.round(report.durationMs / 1000))} 秒
                </span>
              </div>
            </div>

            {checks.length > 0 && (
              <div className="serverpack-check-items kjs-runtime-checks">
                {checks.map((check) => (
                  <div key={check.id} className={`serverpack-check-item is-${check.tone}`}>
                    <ToneIcon tone={check.tone} />
                    <div>
                      <strong>{check.title}</strong>
                      <span>{check.detail}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {report.issues.length > 0 && (
              <div className="kjs-runtime-issues">
                <div className="kjs-runtime-issues-head">
                  <strong>KubeJS 运行日志</strong>
                  <span>
                    {errors} 错误 · {warnings} 警告
                  </span>
                </div>
                {report.issues.map((issue, index) => (
                  <button
                    key={`${issue.level}-${index}-${issue.message.slice(0, 30)}`}
                    type="button"
                    className={`kjs-runtime-issue is-${issue.level}`}
                    disabled={!issue.path}
                    title={issue.path ? '跳到脚本对应行' : issue.message}
                    onClick={() => {
                      if (!issue.path) return
                      onOpenIssue(issue.path, issue.line ?? 1, issue.column ?? undefined)
                      onClose()
                    }}
                  >
                    {issue.level === 'error' ? <XCircle size={12} /> : <AlertTriangle size={12} />}
                    <span>{issue.message}</span>
                    {issue.path && (
                      <code>
                        {issue.path}
                        {issue.line ? `:${issue.line}` : ''}
                      </code>
                    )}
                  </button>
                ))}
              </div>
            )}

            {report.logPath && (
              <div className="serverpack-check-actions">
                <button
                  type="button"
                  className="link-button"
                  onClick={() => void window.ccl.app.openPath(report.logPath!)}
                >
                  <Terminal size={12} />
                  打开完整日志
                </button>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => void window.ccl.app.revealPath(report.logPath!)}
                >
                  <FolderOpen size={12} />
                  打开日志目录
                </button>
              </div>
            )}
          </>
        )}

        {error && (
          <div className="serverpack-check-error is-compact">
            <AlertTriangle size={13} />
            <span>{error}</span>
          </div>
        )}
      </div>
    </Modal>
  )
}
