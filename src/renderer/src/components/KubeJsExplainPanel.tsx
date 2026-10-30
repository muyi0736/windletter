import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  BookOpen,
  Bot,
  CheckCircle2,
  RefreshCw,
  Sparkles
} from 'lucide-react'
import type { InstanceSummary, KubeJsExplainResult } from '@shared/types'
import { cleanError } from '../lib/format'
import { Spinner } from './ui'

export function KubeJsExplainPanel({
  instance,
  path,
  content,
  active,
  onJump
}: {
  instance: InstanceSummary | null
  path: string
  content: string
  active: boolean
  onJump: (line: number) => void
}) {
  const [local, setLocal] = useState<KubeJsExplainResult | null>(null)
  const [ai, setAi] = useState<KubeJsExplainResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [error, setError] = useState('')
  const requestRef = useRef(0)
  const contentRef = useRef(content)
  const pathRef = useRef(path)
  contentRef.current = content
  pathRef.current = path

  const explainLocal = (showLoading: boolean) => {
    if (!instance || !path.trim() || !content.trim()) {
      setLocal(null)
      setLoading(false)
      return
    }
    const request = ++requestRef.current
    if (showLoading) setLoading(true)
    setError('')
    void window.ccl.workshop
      .kubejsExplain({
        instanceId: instance.id,
        path,
        content,
        mode: 'local'
      })
      .then((result) => {
        if (request === requestRef.current) setLocal(result)
      })
      .catch((cause) => {
        if (request === requestRef.current) setError(cleanError(cause))
      })
      .finally(() => {
        if (request === requestRef.current) setLoading(false)
      })
  }

  useEffect(() => {
    if (!active) return
    requestRef.current += 1
    setAi(null)
    setError('')
    if (!instance || !path.trim() || !content.trim()) {
      setLocal(null)
      setLoading(false)
      return
    }
    const timer = window.setTimeout(() => explainLocal(false), 750)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, instance?.id, path, content])

  const askAi = async () => {
    if (!instance || !path.trim() || !content.trim() || aiBusy) return
    setAiBusy(true)
    setError('')
    try {
      const result = await window.ccl.workshop.kubejsExplain({
        instanceId: instance.id,
        path: pathRef.current,
        content: contentRef.current,
        mode: 'ai'
      })
      setAi(result)
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setAiBusy(false)
    }
  }

  const result = ai ?? local
  const sourceIsAi = Boolean(ai)

  if (!path.trim() || !content.trim()) {
    return (
      <div className="kjs-explain-empty">
        <BookOpen size={20} />
        <strong>还没有可解释的脚本</strong>
        <span>打开或新建一个 KubeJS 文件，右侧会自动做本地释意。</span>
      </div>
    )
  }

  return (
    <div className="kjs-explain">
      <div className="kjs-explain-toolbar">
        <span className="kjs-panel-chip">
          {sourceIsAi ? <Bot size={11} /> : <BookOpen size={11} />}
          {sourceIsAi ? 'AI 释意' : 'AST 释意'}
        </span>
        <button
          type="button"
          className="kjs-icon-btn"
          title="重新做 AST 释意"
          onClick={() => explainLocal(true)}
          disabled={loading}
        >
          <RefreshCw size={11} />
        </button>
      </div>

      {loading && !result ? (
        <div className="kjs-explain-loading">
          <Spinner size={14} />
          正在解析脚本结构…
        </div>
      ) : result ? (
        <>
          <div className="kjs-explain-summary">
            {sourceIsAi ? <Bot size={15} /> : <BookOpen size={15} />}
            <div>
              <strong>{result.summary}</strong>
              <span>
                {result.source === 'local'
                  ? '本地 AST 解析，不发送任何内容'
                  : 'AI 讲解基于当前脚本，请结合游戏内结果确认'}
                {result.model ? ` · ${result.model}` : ''}
              </span>
            </div>
          </div>
          {result.points.length > 0 ? (
            <div className="kjs-explain-points">
              {result.points.map((point, index) => (
                <button
                  key={`${point.line ?? 'x'}-${index}`}
                  type="button"
                  className="kjs-explain-point"
                  onClick={() => {
                    if (point.line) onJump(point.line)
                  }}
                  title={point.line ? `跳到第 ${point.line} 行` : undefined}
                >
                  <em>{point.line ? `L${point.line}` : '·'}</em>
                  <span>
                    <strong>{point.title}</strong>
                    <small>{point.detail}</small>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="kjs-explain-empty-text">没有识别到可按行解释的片段。</p>
          )}
          {result.notes && (
            <div className="kjs-explain-notes">
              <AlertTriangle size={12} />
              <span>{result.notes}</span>
            </div>
          )}
          <div className="kjs-explain-tip">
            <CheckCircle2 size={11} />
            <span>{sourceIsAi ? 'AI 只做解释，不会自动修改或保存脚本。' : '本地释意来自脚本 AST；需要更深入解释时再让 AI 讲解。'}</span>
          </div>
        </>
      ) : (
        <div className="kjs-explain-empty is-inline">
          <Sparkles size={16} />
          脚本为空或暂时无法解析。
        </div>
      )}

      {error && (
        <div className="workshop-error is-compact">
          <AlertTriangle size={12} />
          <span>{error}</span>
        </div>
      )}

      <div className="kjs-explain-actions">
        <button
          type="button"
          className="kjs-ai-btn"
          onClick={() => void askAi()}
          disabled={aiBusy || loading}
        >
          {aiBusy ? <Spinner size={12} /> : <Bot size={12} />}
          {sourceIsAi ? '重新让 AI 讲解' : 'AI 深度讲解'}
        </button>
        <small>只在点击时调用，不自动保存。</small>
      </div>
    </div>
  )
}
