import { useState } from 'react'
import { LifeBuoy, Play, Server, Wrench } from 'lucide-react'
import type { AiFixAction } from '@shared/types'
import { useLauncher } from '../store'
import { Badge, Modal, Spinner, Switch } from './ui'

const severityLabel: Record<string, string> = {
  error: '错误',
  warning: '警告',
  info: '提示'
}

export function CrashAssistModal() {
  const view = useLauncher((state) => state.crashAssist)
  const close = useLauncher((state) => state.closeCrashAssist)
  const applyFix = useLauncher((state) => state.applyCrashFix)
  const relaunch = useLauncher((state) => state.relaunchFromCrash)
  const openDiagnosis = useLauncher((state) => state.openDiagnosis)
  const patchSettings = useLauncher((state) => state.patchSettings)
  const setPage = useLauncher((state) => state.setPage)
  const autoAssist = useLauncher((state) => state.settings?.crashAutoAssist !== false)
  const [busyAction, setBusyAction] = useState<AiFixAction | null>(null)
  const [relaunching, setRelaunching] = useState(false)

  if (!view) return null
  const hasJavaIssue = view.issues.some((issue) => issue.category === 'java')

  const runFix = async (action: AiFixAction) => {
    setBusyAction(action)
    try {
      await applyFix(action)
    } finally {
      setBusyAction(null)
    }
  }

  const runRelaunch = async (withServer: boolean) => {
    setRelaunching(true)
    try {
      await relaunch(withServer)
    } finally {
      setRelaunching(false)
    }
  }

  return (
    <Modal
      open
      onClose={close}
      title={view.kind === 'exit' ? '游戏异常退出' : '启动失败'}
      subtitle={`${view.instanceName}${view.exitCode != null ? ` · 退出代码 ${view.exitCode}` : ''}`}
      icon={<LifeBuoy size={18} />}
      size="md"
      footer={
        <div className="crash-assist-footer">
          <label className="crash-assist-auto">
            <Switch
              checked={!autoAssist}
              label="不再自动弹出"
              onChange={(checked) => {
                void patchSettings({ crashAutoAssist: !checked })
              }}
            />
            <span>不再自动弹出</span>
          </label>
          <div className="crash-assist-actions">
            <button type="button" className="button button--ghost" onClick={close}>
              关闭
            </button>
            {view.instanceId && (
              <button
                type="button"
                className="button button--ghost"
                onClick={() => {
                  openDiagnosis(view.instanceId)
                  close()
                }}
              >
                <Wrench size={13} />
                完整诊断
              </button>
            )}
            <button
              type="button"
              className="button button--soft"
              disabled={relaunching}
              onClick={() => void runRelaunch(false)}
            >
              {relaunching ? <Spinner size={13} /> : <Play size={13} />}
              重新启动
            </button>
            {view.lastServer && (
              <button
                type="button"
                className="button button--primary"
                disabled={relaunching}
                onClick={() => void runRelaunch(true)}
              >
                {relaunching ? <Spinner size={13} /> : <Server size={13} />}
                重启并回 {view.lastServer.name || view.lastServer.host}
              </button>
            )}
          </div>
        </div>
      }
    >
      <div className="crash-assist">
        <p className="crash-assist-summary">{view.summary}</p>

        {view.issues.length > 0 && (
          <ul className="crash-assist-issues">
            {view.issues.map((issue) => (
              <li key={issue.id} className={`crash-assist-issue is-${issue.severity}`}>
                <Badge tone={issue.severity === 'error' ? 'danger' : issue.severity === 'warning' ? 'warning' : 'neutral'}>
                  {severityLabel[issue.severity] ?? issue.severity}
                </Badge>
                <div>
                  <strong>{issue.title}</strong>
                  <small>{issue.detail}</small>
                </div>
              </li>
            ))}
          </ul>
        )}

        {view.actions.length > 0 && (
          <div className="crash-assist-fixes">
            <span className="crash-assist-fixes-title">一键修复（执行前会再次校验）</span>
            {view.actions.map((action) => (
              <button
                key={`${action.type}-${action.file ?? action.memoryMb}`}
                type="button"
                className="button button--soft crash-assist-fix"
                disabled={busyAction !== null || relaunching}
                onClick={() => void runFix(action)}
              >
                {busyAction === action ? <Spinner size={13} /> : <Wrench size={13} />}
                <span>{action.title}</span>
                <Badge tone={action.risk === 'low' ? 'success' : 'warning'}>
                  {action.risk === 'low' ? '低风险' : '中风险'}
                </Badge>
              </button>
            ))}
          </div>
        )}

        {hasJavaIssue && (
          <button
            type="button"
            className="button button--ghost crash-assist-java"
            onClick={() => {
              setPage('settings')
              close()
            }}
          >
            去 Java 设置查看推荐运行时
          </button>
        )}

        {view.issues.length === 0 && view.actions.length === 0 && (
          <p className="crash-assist-empty">
            本地诊断没有发现明确问题。可以打开完整诊断查看日志，或直接重新启动。
          </p>
        )}
      </div>
    </Modal>
  )
}