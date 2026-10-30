import { useEffect, useState } from 'react'
import { AlertTriangle, Coffee, Cpu, RefreshCw, WandSparkles } from 'lucide-react'
import type { JavaAssignmentView } from '@shared/types'
import { useLauncher } from '../store'
import { cleanError, loaderLabel } from '../lib/format'
import { Badge, Modal, Spinner } from './ui'

const STATUS_LABEL: Record<JavaAssignmentView['status'], string> = {
  ready: '自动',
  manual: '手动',
  missing: '缺少',
  incompatible: '不兼容'
}

export function JavaAssignModal({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}) {
  const refreshInstances = useLauncher((state) => state.refreshInstances)
  const toast = useLauncher((state) => state.toast)
  const [items, setItems] = useState<JavaAssignmentView[]>([])
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      setItems(await window.ccl.java.assignments())
    } catch (err) {
      setError(cleanError(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!open) return
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const ready = items.filter((item) => item.status === 'ready')
  const manual = items.filter((item) => item.status === 'manual')
  const missing = items.filter((item) => item.status === 'missing' || item.status === 'incompatible')

  const apply = async () => {
    if (ready.length === 0) {
      onClose()
      return
    }
    setApplying(true)
    try {
      await window.ccl.java.applyAssignments(
        ready.map((item) => ({
          instanceId: item.instanceId,
          javaPath: item.javaPath
        }))
      )
      await refreshInstances()
      toast('success', 'Java 已自动分配', `已为 ${ready.length} 个实例写入 Java 路径`)
      onClose()
    } catch (err) {
      toast('error', '无法应用 Java 分配', cleanError(err))
    } finally {
      setApplying(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="自动分配 Java"
      subtitle="按实例需要的 Java 版本选择现有运行时，并写入实例设置"
      icon={<WandSparkles size={18} />}
      size="lg"
      footer={
        <div className="java-assign-footer">
          <span>
            {loading
              ? '正在检查…'
              : `${ready.length} 个自动 · ${manual.length} 个手动 · ${missing.length} 个需要处理`}
          </span>
          <div>
            <button
              type="button"
              className="button button--soft button--sm"
              disabled={loading}
              onClick={() => void load()}
            >
              <RefreshCw size={12} className={loading ? 'spin' : ''} />
              重新检查
            </button>
            <button
              type="button"
              className="button button--primary button--sm"
              disabled={loading || applying || ready.length === 0}
              onClick={() => void apply()}
            >
              {applying ? <Spinner size={12} /> : <WandSparkles size={12} />}
              应用自动分配
            </button>
          </div>
        </div>
      }
    >
      <div className="java-assign">
        {loading ? (
          <div className="downloads-loading">
            <Spinner size={16} />
            正在扫描实例和已安装的 Java…
          </div>
        ) : error ? (
          <div className="mods-error">
            <AlertTriangle size={14} />
            <span>{error}</span>
          </div>
        ) : items.length === 0 ? (
          <p className="mods-empty">还没有实例，先在「实例」页添加或扫描整合包。</p>
        ) : (
          <div className="java-assign-list">
            {items.map((item) => (
              <article
                key={item.instanceId}
                className={`java-assign-row is-${item.status}`}
              >
                <span className="java-assign-icon">
                  <Coffee size={17} />
                </span>
                <div className="java-assign-copy">
                  <div className="java-assign-head">
                    <strong>{item.name}</strong>
                    <span>
                      Minecraft {item.gameVersion}
                      {item.loader !== 'vanilla' ? ` · ${loaderLabel(item.loader)}` : ''}
                    </span>
                  </div>
                  <div className="java-assign-meta">
                    <span>
                      <Cpu size={11} />
                      需要 {item.requiredMajor ? `Java ${item.requiredMajor}` : '未识别 Java'}
                    </span>
                    <span>
                      {item.javaMajor
                        ? `分配 Java ${item.javaMajor} · ${item.javaVersion}`
                        : '未分配 Java'}
                    </span>
                  </div>
                  {item.javaPath && (
                    <span className="java-assign-path" title={item.javaPath}>
                      {item.javaPath}
                    </span>
                  )}
                  {item.message && <span className="java-assign-message">{item.message}</span>}
                </div>
                <Badge
                  tone={
                    item.status === 'ready'
                      ? 'success'
                      : item.status === 'manual'
                        ? 'neutral'
                        : item.status === 'missing'
                          ? 'warning'
                          : 'danger'
                  }
                >
                  {STATUS_LABEL[item.status]}
                </Badge>
              </article>
            ))}
          </div>
        )}
        {!loading && !error && items.length > 0 && (
          <p className="java-assign-tip">
            「自动」会写入选中的 Java 路径；「手动」保留你为实例指定的 Java；「缺少」不会自动下载，启动时仍会按全局自动 Java 设置尝试补齐。
          </p>
        )}
      </div>
    </Modal>
  )
}
