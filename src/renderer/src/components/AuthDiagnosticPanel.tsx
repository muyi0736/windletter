import { useEffect, useState } from 'react'
import { Check, ChevronDown, ChevronUp, Clipboard, Minus, X } from 'lucide-react'
import type { AuthCheckStep, AuthDiagnosticView, AuthVerdict } from '@shared/types'
import { Badge, type BadgeTone } from './ui'
import { copyText } from '../lib/clipboard'
import { useLauncher } from '../store'

const VERDICT_META: Record<AuthVerdict, { label: string; tone: BadgeTone }> = {
  passed: { label: '全部通过', tone: 'success' },
  'not-allowlisted': { label: '未获放行', tone: 'danger' },
  'no-ownership': { label: '无游戏所有权', tone: 'warning' },
  failed: { label: '自检失败', tone: 'danger' }
}

const STATUS_LABEL: Record<AuthCheckStep['status'], string> = {
  ok: '通过',
  fail: '失败',
  skipped: '未执行'
}

function stepIcon(step: AuthCheckStep) {
  if (step.status === 'ok') return <Check size={11} strokeWidth={3} />
  if (step.status === 'fail') return <X size={11} strokeWidth={3} />
  return <Minus size={11} strokeWidth={3} />
}

function formatDiagnostic(diagnostic: AuthDiagnosticView): string {
  const time = new Date(diagnostic.at).toLocaleString('zh-CN', { hour12: false })
  const lines = [
    '风信启动器 · 登录自检',
    `时间：${time}`,
    `结论：${VERDICT_META[diagnostic.verdict].label} — ${diagnostic.summary}`,
    ''
  ]
  for (const step of diagnostic.steps) {
    const meta = [
      step.httpStatus ? `HTTP ${step.httpStatus}` : '',
      step.code ?? ''
    ]
      .filter(Boolean)
      .join(' · ')
    lines.push(
      `- [${STATUS_LABEL[step.status]}] ${step.label}${meta ? ` · ${meta}` : ''}`
    )
    if (step.detail) lines.push(`  ${step.detail}`)
  }
  return lines.join('\n')
}

export function AuthDiagnosticPanel({
  diagnostic,
  defaultOpen
}: {
  diagnostic: AuthDiagnosticView
  defaultOpen?: boolean
}) {
  const toast = useLauncher((state) => state.toast)
  const [open, setOpen] = useState(
    defaultOpen ?? diagnostic.verdict !== 'passed'
  )

  useEffect(() => {
    setOpen(defaultOpen ?? diagnostic.verdict !== 'passed')
  }, [diagnostic, defaultOpen])

  const meta = VERDICT_META[diagnostic.verdict]

  const copy = async () => {
    if (await copyText(formatDiagnostic(diagnostic))) {
      toast('success', '诊断信息已复制')
    } else {
      toast('error', '复制失败', '请手动选择诊断文本')
    }
  }

  return (
    <section className={`auth-diag auth-diag--${diagnostic.verdict}`}>
      <button
        type="button"
        className="auth-diag-head"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className="auth-diag-head-copy">
          <span className="auth-diag-title">
            登录自检
            <Badge tone={meta.tone}>{meta.label}</Badge>
          </span>
          <span className="auth-diag-summary">{diagnostic.summary}</span>
        </span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {open && (
        <ol className="auth-diag-steps">
          {diagnostic.steps.length === 0 ? (
            <li className="auth-diag-empty">没有拿到可用的检查结果。</li>
          ) : (
            diagnostic.steps.map((step) => (
              <li key={step.stage} className={`auth-diag-step is-${step.status}`}>
                <span className="auth-diag-mark">{stepIcon(step)}</span>
                <div className="auth-diag-copy">
                  <div className="auth-diag-line">
                    <strong>{step.label}</strong>
                    <span className="auth-diag-meta">
                      {step.httpStatus ? `HTTP ${step.httpStatus}` : '未发起'}
                      {step.code ? ` · ${step.code}` : ''}
                    </span>
                  </div>
                  {step.detail && <p>{step.detail}</p>}
                </div>
              </li>
            ))
          )}
        </ol>
      )}

      <div className="auth-diag-foot">
        <span>
          本机诊断 ·{' '}
          {new Date(diagnostic.at).toLocaleTimeString('zh-CN', { hour12: false })}
        </span>
        <button type="button" className="link-button" onClick={() => void copy()}>
          <Clipboard size={12} />
          复制诊断
        </button>
      </div>
    </section>
  )
}
