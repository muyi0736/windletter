import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowUpRight,
  Bot,
  Copy,
  MessageCircleQuestion,
  Send,
  Sparkles,
  Trash2,
  Wrench
} from 'lucide-react'
import type {
  InstanceSummary,
  KubeJsQaCitation,
  KubeJsQaResult
} from '@shared/types'
import { cleanError } from '../lib/format'
import { Spinner } from './ui'

interface QaTurn {
  id: string
  question: string
  result: KubeJsQaResult | null
  error: string
  asking: boolean
}

const qaIconCache = new Map<string, string | null>()

const SUGGESTIONS = [
  '铁锭怎么获得？',
  '圆石能做什么？',
  '给我一条从铁矿石到铁块的路线',
  '钢锭属于哪些标签？'
]

function QaTile({
  citation,
  icon
}: {
  citation: KubeJsQaCitation
  icon: string | null
}) {
  if (citation.kind === 'tag') {
    return <span className="kjs-qa-tile is-tag">#</span>
  }
  if (icon) {
    return <img className="kjs-qa-tile" src={icon} alt="" draggable={false} />
  }
  if (!citation.iconId) {
    return (
      <span className="kjs-qa-tile is-recipe">
        <Wrench size={11} />
      </span>
    )
  }
  return (
    <span className="kjs-qa-tile is-fallback">
      {citation.label.replace(/^#/, '').charAt(0).toUpperCase() || '?'}
    </span>
  )
}

function CitationGroup({
  title,
  kind,
  citations,
  icons,
  onCopy,
  copied
}: {
  title: string
  kind: KubeJsQaCitation['kind']
  citations: KubeJsQaCitation[]
  icons: Record<string, string | null>
  onCopy: (id: string) => void
  copied: string | null
}) {
  const list = citations.filter((citation) => citation.kind === kind)
  if (list.length === 0) return null
  return (
    <div className="kjs-qa-citation-group">
      <div className="kjs-qa-citation-head">
        <span>{title}</span>
        <em>{list.length}</em>
      </div>
      <div className="kjs-qa-citations">
        {list.map((citation) => (
          <div key={`${citation.kind}:${citation.id}`} className="kjs-qa-citation">
            <QaTile citation={citation} icon={citation.iconId ? icons[citation.iconId] ?? null : null} />
            <div className="kjs-qa-citation-copy">
              <strong title={citation.label}>{citation.label}</strong>
              <small title={citation.id}>{citation.id}</small>
            </div>
            <button
              type="button"
              className="kjs-qa-copy-btn"
              title={`复制 ${citation.id}`}
              onClick={() => onCopy(citation.id)}
            >
              {copied === citation.id ? <span>已复制</span> : <Copy size={10} />}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function QaAnswer({
  result,
  icons,
  copied,
  onCopy,
  onOpenKnowledge
}: {
  result: KubeJsQaResult
  icons: Record<string, string | null>
  copied: string | null
  onCopy: (id: string) => void
  onOpenKnowledge?: () => void
}) {
  return (
    <div className="kjs-qa-answer">
      <div className="kjs-qa-answer-text">{result.answer}</div>
      {result.warnings.length > 0 && (
        <div className="kjs-qa-warning">
          <AlertTriangle size={11} />
          <div>
            {result.warnings.map((warning, index) => (
              <span key={index}>{warning}</span>
            ))}
          </div>
        </div>
      )}
      {result.citations.length > 0 ? (
        <>
          <div className="kjs-qa-counts">
            <span>本地引用</span>
            <em>物品 {result.itemCount}</em>
            <em>配方 {result.recipeCount}</em>
            <em>标签 {result.tagCount}</em>
            <span className="kjs-qa-model">
              {result.localOnly ? '本地结果' : result.model ?? 'AI'}
            </span>
          </div>
          <CitationGroup
            title="物品"
            kind="item"
            citations={result.citations}
            icons={icons}
            onCopy={onCopy}
            copied={copied}
          />
          <CitationGroup
            title="配方"
            kind="recipe"
            citations={result.citations}
            icons={icons}
            onCopy={onCopy}
            copied={copied}
          />
          <CitationGroup
            title="标签"
            kind="tag"
            citations={result.citations}
            icons={icons}
            onCopy={onCopy}
            copied={copied}
          />
        </>
      ) : (
        <div className="kjs-qa-empty-result">
          <span>本地索引没有返回可引用的物品或配方。</span>
          {onOpenKnowledge && (
            <button type="button" onClick={onOpenKnowledge}>
              去知识页重建索引
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function KubeJsQaPanel({
  instance,
  active,
  onOpenKnowledge
}: {
  instance: InstanceSummary | null
  active: boolean
  onOpenKnowledge?: () => void
}) {
  const [question, setQuestion] = useState('')
  const [turns, setTurns] = useState<QaTurn[]>([])
  const [asking, setAsking] = useState(false)
  const [icons, setIcons] = useState<Record<string, string | null>>({})
  const [copied, setCopied] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const logRef = useRef<HTMLDivElement | null>(null)
  const sequence = useRef(0)
  const iconSeq = useRef(0)

  useEffect(() => {
    setTurns([])
    setQuestion('')
    setAsking(false)
    setIcons({})
    setCopied(null)
  }, [instance?.id])

  useEffect(() => {
    if (!active) return
    if (turns.length === 0) {
      inputRef.current?.focus()
      return
    }
    const log = logRef.current
    if (!log) return
    const last = turns[turns.length - 1]
    const turn = log.querySelector<HTMLElement>(`[data-turn-id="${last.id}"]`)
    if (!turn) return
    const top =
      turn.getBoundingClientRect().top - log.getBoundingClientRect().top + log.scrollTop
    log.scrollTop = Math.max(0, top - 4)
  }, [active, turns])

  useEffect(() => {
    if (!instance) return
    const ids = new Set<string>()
    for (const turn of turns) {
      for (const citation of turn.result?.citations ?? []) {
        if (citation.iconId) ids.add(citation.iconId)
      }
    }
    if (ids.size === 0) return
    const cacheKey = (id: string) => `${instance.id}|${id}`
    const apply = () => {
      const next: Record<string, string | null> = {}
      for (const id of ids) {
        if (qaIconCache.has(cacheKey(id))) next[id] = qaIconCache.get(cacheKey(id)) ?? null
      }
      setIcons(next)
    }
    const missing = [...ids].filter((id) => !qaIconCache.has(cacheKey(id)))
    if (missing.length === 0) {
      apply()
      return
    }
    const request = ++iconSeq.current
    void window.ccl.workshop
      .kubejsItemIcons(instance.id, missing.slice(0, 80))
      .then((group) => {
        if (request !== iconSeq.current) return
        for (const [id, url] of Object.entries(group)) qaIconCache.set(cacheKey(id), url)
      })
      .catch(() => undefined)
      .finally(() => {
        if (request === iconSeq.current) apply()
      })
  }, [instance?.id, turns])

  const copy = (id: string) => {
    void navigator.clipboard
      .writeText(id)
      .then(() => {
        setCopied(id)
        window.setTimeout(() => setCopied(null), 1500)
      })
      .catch(() => undefined)
  }

  const ask = () => {
    const text = question.trim()
    if (!text || !instance || asking) return
    const id = `qa-${Date.now()}-${++sequence.current}`
    setQuestion('')
    setTurns((current) => [
      ...current.slice(-11),
      { id, question: text, result: null, error: '', asking: true }
    ])
    setAsking(true)
    void window.ccl.workshop
      .kubejsQa({ instanceId: instance.id, question: text })
      .then((result) => {
        setTurns((current) =>
          current.map((turn) => (turn.id === id ? { ...turn, result, asking: false } : turn))
        )
      })
      .catch((cause) => {
        setTurns((current) =>
          current.map((turn) =>
            turn.id === id ? { ...turn, error: cleanError(cause), asking: false } : turn
          )
        )
      })
      .finally(() => setAsking(false))
  }

  const useSuggestion = (text: string) => {
    setQuestion(text)
    inputRef.current?.focus()
  }

  return (
    <div className="kjs-qa">
      <div className="kjs-qa-head">
        <MessageCircleQuestion size={13} />
        <strong>AI 配方 / 物品问答</strong>
        <span>可选 · 显式提问</span>
        {turns.length > 0 && (
          <button
            type="button"
            className="kjs-qa-clear"
            title="清空问答"
            onClick={() => {
              if (asking) return
              setTurns([])
              setQuestion('')
            }}
          >
            <Trash2 size={11} />
          </button>
        )}
      </div>
      <p className="kjs-qa-copy">
        先查本地索引，再把命中的物品/配方片段发给 AI；不会上传整个实例、脚本或账户。
      </p>

      <div className="kjs-qa-log" ref={logRef}>
        {turns.length === 0 ? (
          <div className="kjs-qa-intro">
            <Bot size={20} />
            <strong>问物品，问配方</strong>
            <span>
              例如「铁锭怎么获得」「圆石能做什么」「钢锭属于哪些标签」。答案会带可复制的物品/配方 ID。
            </span>
            <div className="kjs-qa-suggestions">
              {SUGGESTIONS.map((text) => (
                <button key={text} type="button" onClick={() => useSuggestion(text)}>
                  <ArrowUpRight size={10} />
                  {text}
                </button>
              ))}
            </div>
            <small>AI 未启用时会显示本地检索结果；需要时请到「设置 → AI 辅助」启用。</small>
          </div>
        ) : (
          turns.map((turn) => (
            <div key={turn.id} className="kjs-qa-turn" data-turn-id={turn.id}>
              <div className="kjs-qa-question">
                <span>问</span>
                <div>{turn.question}</div>
              </div>
              {turn.asking ? (
                <div className="kjs-qa-loading">
                  <Spinner size={12} />
                  正在检索本地索引并请求 AI…
                </div>
              ) : turn.error ? (
                <div className="kjs-qa-error">
                  <AlertTriangle size={12} />
                  <div>
                    <span>{turn.error}</span>
                    {onOpenKnowledge && (
                      <button type="button" onClick={onOpenKnowledge}>
                        去知识页检查索引
                      </button>
                    )}
                  </div>
                </div>
              ) : turn.result ? (
                <QaAnswer
                  result={turn.result}
                  icons={icons}
                  copied={copied}
                  onCopy={copy}
                  onOpenKnowledge={onOpenKnowledge}
                />
              ) : null}
            </div>
          ))
        )}
      </div>

      <div className="kjs-qa-input-wrap">
        <textarea
          ref={inputRef}
          className="kjs-qa-input"
          value={question}
          maxLength={500}
          rows={2}
          placeholder="问一个物品或配方，例如：铁锭怎么获得？"
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault()
              ask()
            }
          }}
        />
        <div className="kjs-qa-input-actions">
          <span>Ctrl+Enter 提问 · 只发送本地命中片段</span>
          <button
            type="button"
            className="button button--primary button--sm"
            disabled={!question.trim() || asking}
            onClick={ask}
          >
            {asking ? <Spinner size={11} /> : <Send size={11} />}
            {asking ? '检索中…' : '提问'}
          </button>
        </div>
      </div>
      <div className="kjs-qa-foot">
        <Sparkles size={10} />
        只读问答：不会自动应用或保存任何配方。
      </div>
    </div>
  )
}
