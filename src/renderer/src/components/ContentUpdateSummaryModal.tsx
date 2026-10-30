import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, FileText, Sparkles } from 'lucide-react'
import type {
  ContentKind,
  ContentLedgerUpdateSummary,
  ContentUpdateAiSummary,
  InstanceSummary
} from '@shared/types'
import { cleanError, formatBytes, formatDateTime } from '../lib/format'
import { Badge, EmptyState, Modal, Spinner } from './ui'

const KIND_LABELS: Record<ContentKind, string> = {
  mod: '模组',
  datapack: '数据包',
  resourcepack: '资源包',
  shader: '光影包'
}

function versionText(value: string | null): string {
  return value && value.trim() ? value.trim() : '未知版本'
}

export function ContentUpdateSummaryModal({
  open,
  instance,
  update,
  onClose
}: {
  open: boolean
  instance: InstanceSummary | null
  update: ContentLedgerUpdateSummary | null
  onClose: () => void
}) {
  const [result, setResult] = useState<ContentUpdateAiSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setResult(null)
    setError('')
    setBusy(false)
  }, [open, instance?.id, update?.createdAt])

  const changes = update?.changes ?? []
  const counts = useMemo(() => {
    const map = new Map<ContentKind, number>()
    for (const change of changes) map.set(change.kind, (map.get(change.kind) ?? 0) + 1)
    return [...map.entries()]
  }, [changes])

  const explain = async () => {
    if (!instance || busy) return
    setBusy(true)
    setError('')
    try {
      setResult(await window.ccl.ledger.explainUpdate(instance.id))
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="更新解读"
      subtitle={
        instance
          ? `${instance.name} · 最近一次内容更新`
          : '最近一次内容更新'
      }
      icon={<Sparkles size={18} />}
      size="lg"
      footer={
        <>
          <button type="button" className="button button--ghost" onClick={onClose}>
            关闭
          </button>
          <button
            type="button"
            className="button button--primary"
            disabled={!instance || !update || busy}
            onClick={() => void explain()}
          >
            {busy ? <Spinner size={13} /> : <Sparkles size={13} />}
            {busy ? '解读中…' : result ? '重新解读' : '用 AI 解读'}
          </button>
        </>
      }
    >
      <div className="update-explain">
        {!update ? (
          <EmptyState
            icon={<FileText size={22} />}
            title="还没有可解读的更新"
            description="先在实例内容页更新一次模组、资源包、光影包或数据包。"
          />
        ) : (
          <>
            <div className="update-explain-meta">
              <div>
                <span>更新时间</span>
                <strong>{formatDateTime(update.createdAt)}</strong>
              </div>
              <div>
                <span>变更数量</span>
                <strong>{update.updatedCount} 项</strong>
              </div>
              <div>
                <span>回滚</span>
                <strong>{update.canRollback ? '可用' : '不可用'}</strong>
              </div>
              <div className="update-explain-counts">
                {counts.length > 0 ? (
                  counts.map(([kind, count]) => (
                    <Badge key={kind} tone="neutral">
                      {KIND_LABELS[kind]} {count}
                    </Badge>
                  ))
                ) : (
                  <Badge tone="neutral">没有文件级记录</Badge>
                )}
              </div>
            </div>

            {changes.length > 0 ? (
              <div className="update-explain-changes">
                <div className="update-explain-section-head">
                  <strong>本次变更</strong>
                  <span>版本号来自更新记录；更新日志只在点击「用 AI 解读」后按需读取</span>
                </div>
                <div className="update-explain-change-list">
                  {changes.slice(0, 40).map((change, index) => (
                    <div
                      key={`${change.kind}-${change.file}-${index}`}
                      className="update-explain-change-row"
                    >
                      <span className={`update-explain-kind is-${change.kind}`}>
                        {KIND_LABELS[change.kind]}
                      </span>
                      <strong title={change.file}>{change.title}</strong>
                      <span className="update-explain-version">
                        {versionText(change.fromVersion)}
                        <em>→</em>
                        {versionText(change.toVersion)}
                      </span>
                    </div>
                  ))}
                </div>
                {changes.length > 40 && (
                  <p className="update-explain-hint">
                    还有 {changes.length - 40} 项未展开；AI 只会收到前 24 项摘要。
                  </p>
                )}
              </div>
            ) : (
              <div className="update-explain-empty">
                这次更新没有记录到具体文件变化，提交给 AI 的上下文会很少。
              </div>
            )}

            {error && (
              <div className="update-explain-error">
                <AlertTriangle size={13} />
                <span>{error}</span>
              </div>
            )}

            {result ? (
              <section className="update-explain-result">
                <div className="update-explain-section-head">
                  <strong>{result.localOnly ? '本地摘要' : 'AI 解读'}</strong>
                  <span>
                    {result.model
                      ? `模型 ${result.model}`
                      : result.sentBytes > 0
                        ? 'AI 未返回，已降级本地摘要'
                        : '未调用 AI'}
                    {result.sentBytes > 0 ? ` · 发送 ${formatBytes(result.sentBytes)}` : ''}
                  </span>
                </div>
                <pre className="update-explain-summary">{result.summary}</pre>
                {result.warnings.length > 0 && (
                  <div className="update-explain-warnings">
                    {result.warnings.map((warning, index) => (
                      <span key={`${warning}-${index}`}>
                        <AlertTriangle size={10} />
                        {warning}
                      </span>
                    ))}
                  </div>
                )}
              </section>
            ) : (
              <div className="update-explain-prompt">
                <CheckCircle2 size={15} />
                <span>
                  变更列表已经在本地整理好。点击「用 AI 解读」才会读取更新日志并发送摘要；
                  不会上传模组文件、账户或启动脚本。
                </span>
              </div>
            )}

            <p className="update-explain-note">
              只根据本次更新记录和可用的更新日志生成，缺少日志时会明确说明；解读结果不会自动修改模组或存档。
            </p>
          </>
        )}
      </div>
    </Modal>
  )
}
