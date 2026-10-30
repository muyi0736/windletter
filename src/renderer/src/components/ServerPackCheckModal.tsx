import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  FolderOpen,
  Info,
  Play,
  RefreshCw,
  ShieldCheck,
  Square,
  Terminal,
  XCircle
} from 'lucide-react'
import type {
  InstanceSummary,
  ServerPackCheckItem,
  ServerPackCheckTone,
  ServerPackInspectReport,
  ServerPackVerifyProgress,
  ServerPackVerifyReport
} from '@shared/types'
import { cleanError, formatBytes } from '../lib/format'
import { Modal, Spinner } from './ui'

function ToneIcon({ tone, size = 13 }: { tone: ServerPackCheckTone; size?: number }) {
  if (tone === 'fail') return <XCircle size={size} />
  if (tone === 'warn') return <AlertTriangle size={size} />
  if (tone === 'pass') return <CheckCircle2 size={size} />
  return <Info size={size} />
}

function checkCount(items: ServerPackCheckItem[], tone: ServerPackCheckTone): number {
  return items.filter((item) => item.tone === tone).length
}

export function ServerPackCheckModal({
  open,
  instance,
  initialPath,
  onClose
}: {
  open: boolean
  instance: InstanceSummary | null
  initialPath: string
  onClose: () => void
}) {
  const [path, setPath] = useState(initialPath)
  const [report, setReport] = useState<ServerPackInspectReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [trusted, setTrusted] = useState(false)
  const [progress, setProgress] = useState<ServerPackVerifyProgress | null>(null)
  const [liveLog, setLiveLog] = useState<string[]>([])
  const [verifyReport, setVerifyReport] = useState<ServerPackVerifyReport | null>(null)
  const verifyingRef = useRef(false)

  useEffect(() => {
    verifyingRef.current = verifying
  }, [verifying])

  useEffect(
    () => () => {
      if (verifyingRef.current) void window.ccl.serverPacks.cancelVerify()
    },
    []
  )

  const inspectPath = useCallback(
    async (target: string) => {
      if (!instance || !target.trim()) {
        setReport(null)
        return
      }
      setLoading(true)
      setError('')
      setVerifyReport(null)
      setProgress(null)
      try {
        const next = await window.ccl.serverPacks.inspect(instance.id, target.trim())
        setReport(next)
      } catch (cause) {
        setError(cleanError(cause))
        setReport(null)
      } finally {
        setLoading(false)
      }
    },
    [instance]
  )

  useEffect(() => {
    if (!open) return
    const target = initialPath.trim()
    setPath(target)
    setReport(null)
    setError('')
    setVerifyReport(null)
    setProgress(null)
    setLiveLog([])
    setTrusted(false)
    if (target) void inspectPath(target)
  }, [open, instance?.id])

  useEffect(() => {
    if (!open) return
    const unsubscribe = window.ccl.serverPacks.onVerifyProgress((payload) => {
      if (payload.path.toLowerCase() !== path.toLowerCase()) return
      setProgress(payload)
      if (payload.line) {
        setLiveLog((current) => [...current, payload.line!].slice(-120))
      }
    })
    return unsubscribe
  }, [open, path])

  useEffect(() => {
    if (!open) return
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (verifying) void window.ccl.serverPacks.cancelVerify()
      onClose()
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [open, verifying, onClose])

  const close = () => {
    if (verifying) void window.ccl.serverPacks.cancelVerify()
    onClose()
  }

  const chooseFile = async () => {
    if (verifying) return
    const picked = await window.ccl.app.pickFile('选择服务端包', [
      { name: 'ZIP 压缩包', extensions: ['zip'] }
    ])
    if (!picked) return
    setPath(picked)
    setVerifyReport(null)
    setProgress(null)
    setLiveLog([])
    setTrusted(false)
    await inspectPath(picked)
  }

  const startVerify = async () => {
    if (!instance || !report?.canRun || verifying || !trusted) return
    setVerifying(true)
    setError('')
    setVerifyReport(null)
    setProgress({ path, stage: '准备启动测试', percent: 0, line: null })
    setLiveLog([])
    try {
      const result = await window.ccl.serverPacks.verify({
        instanceId: instance.id,
        path
      })
      setVerifyReport(result)
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setVerifying(false)
      setProgress(null)
    }
  }

  const cancelVerify = () => {
    if (!verifying) return
    setProgress((current) =>
      current ? { ...current, stage: '正在取消测试…' } : current
    )
    void window.ccl.serverPacks.cancelVerify()
  }

  if (!instance) return null
  const checks = report?.checks ?? []
  const fails = checkCount(checks, 'fail')
  const warns = checkCount(checks, 'warn')
  const passes = checkCount(checks, 'pass')
  const logText = verifying
    ? liveLog.slice(-60).join('\n')
    : verifyReport?.logTail ?? ''
  const runtimeChecks = verifyReport?.checks ?? []

  return (
    <Modal
      open={open}
      onClose={close}
      title="验证服务端包"
      subtitle={`${instance.name} · 静态检查 + 实际启动 + 直接运行启动脚本`}
      icon={<ShieldCheck size={18} />}
      size="xl"
      footer={
        <div className="serverpack-check-footer">
          <span>
            {report
              ? `${passes} 项通过 · ${warns} 项提醒 · ${fails} 项阻断`
              : '选择导出的 ZIP 后先做静态检查'}
          </span>
          <div>
            <button type="button" className="button button--ghost" onClick={close} disabled={false}>
              关闭
            </button>
            {verifying ? (
              <button type="button" className="button button--danger" onClick={cancelVerify}>
                <Square size={12} />
                取消测试
              </button>
            ) : (
              <button
                type="button"
                className="button button--primary"
                onClick={() => void startVerify()}
                disabled={!report?.canRun || !trusted}
                title={
                  report?.runBlockReason ??
                  (trusted ? '会实际启动一次服务器' : '请先确认服务端包来源可信')
                }
              >
                <Play size={13} />
                {verifyReport ? '重新测试' : '启动测试'}
              </button>
            )}
          </div>
        </div>
      }
    >
      <div className="serverpack-check">
        <div className="serverpack-check-path">
          <div>
            <span>服务端包</span>
            <strong title={path}>{path || '尚未选择 ZIP'}</strong>
            {report && (
              <small>
                {formatBytes(report.bytes)} · {report.fileCount} 个文件 ·{' '}
                {report.loader === 'vanilla' ? '原版' : report.loader}
                {report.loaderVersion ? ` ${report.loaderVersion}` : ''} · MC{' '}
                {report.gameVersion}
              </small>
            )}
          </div>
          <button
            type="button"
            className="button button--soft button--sm"
            onClick={() => void chooseFile()}
            disabled={verifying}
          >
            <FolderOpen size={13} />
            选择 ZIP
          </button>
        </div>

        {loading ? (
          <div className="serverpack-check-loading">
            <Spinner size={16} />
            正在读取 ZIP、启动脚本和 Java…
          </div>
        ) : error && !report ? (
          <div className="serverpack-check-error">
            <AlertTriangle size={14} />
            <span>{error}</span>
            <div>
              <button type="button" className="link-button" onClick={() => void chooseFile()}>
                选择 ZIP
              </button>
              {path && (
                <button type="button" className="link-button" onClick={() => void inspectPath(path)}>
                  重试
                </button>
              )}
            </div>
          </div>
        ) : report ? (
          <>
            <div className={`serverpack-check-summary ${report.ok ? 'is-ok' : 'is-fail'}`}>
              {report.ok ? <ShieldCheck size={18} /> : <XCircle size={18} />}
              <div>
                <strong>
                  {report.ok
                    ? report.canRun
                      ? '静态检查通过，可以实际启动测试'
                      : '静态检查通过，但本机暂时不能做启动测试'
                    : `静态检查发现 ${fails} 个阻断问题`}
                </strong>
                <span>
                  {report.ok
                    ? report.canRun
                      ? '结构、启动脚本和 Java 都已就绪。测试会在临时目录实际启动服务器，然后直接运行包内的 start-server.bat/.sh。'
                      : report.runBlockReason ?? '当前环境无法启动测试。'
                    : '先修复下面的阻断项，再重新检查或启动测试。'}
                </span>
              </div>
              <button
                type="button"
                className="button button--ghost button--sm"
                onClick={() => void inspectPath(path)}
                disabled={loading || verifying}
              >
                <RefreshCw size={12} />
                重新检查
              </button>
            </div>

            <div className="serverpack-check-layout">
              <section className="serverpack-check-panel">
                <header>
                  <div>
                    <strong>静态检查</strong>
                    <span>{checks.length} 项</span>
                  </div>
                  {report.java ? (
                    <em>Java {report.java.major} · {report.java.version}</em>
                  ) : (
                    <em className="is-warn">未找到 Java</em>
                  )}
                </header>
                <div className="serverpack-check-items">
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
              </section>

              <section className="serverpack-check-panel serverpack-runtime">
                <header>
                  <div>
                    <strong>实际启动测试</strong>
                    <span>临时副本</span>
                  </div>
                  <Terminal size={13} />
                </header>

                <div className="serverpack-runtime-note">
                  会解压到临时目录，写入测试用 eula=true，换一个空闲端口启动；看到 Done 后自动 stop，
                  再直接运行包内的 start-server.bat/.sh。不会修改 ZIP、原实例或你的存档，测试结束删除临时目录。
                </div>

                {report.canRun && !verifying && (
                  <label className="serverpack-trust">
                    <input
                      type="checkbox"
                      checked={trusted}
                      onChange={(event) => setTrusted(event.target.checked)}
                    />
                    <span>我确认这个 ZIP 来自可信来源；启动测试会以当前用户权限执行包内 jar 和 start-server 脚本。</span>
                  </label>
                )}

                {!report.canRun && !verifying && (
                  <div className="serverpack-runtime-blocked">
                    <AlertTriangle size={13} />
                    <span>{report.runBlockReason ?? '当前环境无法启动测试。'}</span>
                  </div>
                )}

                {report.canRun && !verifying && !verifyReport && (
                  <div className="serverpack-runtime-idle">
                    <Play size={16} />
                    <strong>还没有实际运行</strong>
                    <span>点击右下角「启动测试」，会真实启动服务端，并直接执行导出的启动脚本。</span>
                  </div>
                )}

                {verifying && (
                  <div className="serverpack-check-progress">
                    <div>
                      <strong>
                        <Spinner size={11} />
                        {progress?.stage ?? '启动测试中…'}
                      </strong>
                      <span>{progress ? `${Math.round(progress.percent)}%` : ''}</span>
                    </div>
                    <div className="serverpack-check-bar">
                      <span style={{ width: `${Math.max(2, progress?.percent ?? 2)}%` }} />
                    </div>
                    {progress?.line && <small>{progress.line}</small>}
                  </div>
                )}

                {verifyReport && (
                  <div
                    className={`serverpack-verify-result ${
                      verifyReport.cancelled ? 'is-cancelled' : verifyReport.ok ? 'is-ok' : 'is-fail'
                    }`}
                  >
                    {verifyReport.cancelled ? (
                      <Square size={14} />
                    ) : verifyReport.ok ? (
                      <CheckCircle2 size={14} />
                    ) : (
                      <XCircle size={14} />
                    )}
                    <div>
                      <strong>
                        {verifyReport.cancelled
                          ? '启动测试已取消'
                          : verifyReport.ok
                            ? '实际启动测试通过'
                            : '实际启动测试未通过'}
                      </strong>
                      <span>
                        {verifyReport.summary} · 耗时{' '}
                        {Math.max(0, Math.round(verifyReport.durationMs / 1000))} 秒
                      </span>
                    </div>
                  </div>
                )}

                {runtimeChecks.length > 0 && (
                  <div className="serverpack-verify-checks">
                    {runtimeChecks.map((check) => (
                      <div key={check.id} className={`is-${check.tone}`}>
                        <ToneIcon tone={check.tone} size={12} />
                        <span>{check.detail}</span>
                      </div>
                    ))}
                  </div>
                )}

                {logText && (
                  <pre className="serverpack-check-log" aria-label="服务器测试日志">
                    {logText}
                  </pre>
                )}

                {(verifyReport?.logPath || verifyReport) && (
                  <div className="serverpack-check-actions">
                    {verifyReport?.logPath && (
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => void window.ccl.app.openPath(verifyReport.logPath!)}
                      >
                        <Terminal size={12} />
                        打开完整日志
                      </button>
                    )}
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => void window.ccl.app.revealPath(path)}
                    >
                      <FolderOpen size={12} />
                      定位 ZIP
                    </button>
                  </div>
                )}

                {error && report && (
                  <div className="serverpack-check-error is-compact">
                    <AlertTriangle size={13} />
                    <span>{error}</span>
                  </div>
                )}
              </section>
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  )
}
