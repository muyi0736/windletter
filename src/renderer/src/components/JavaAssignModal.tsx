import { useEffect, useState } from 'react'
import { AlertTriangle, Coffee, Cpu, MemoryStick, RefreshCw, WandSparkles } from 'lucide-react'
import type { JavaAssignmentView } from '@shared/types'
import { cleanError, loaderLabel } from '../lib/format'
import { Badge, Modal, Spinner } from './ui'

const STATUS_LABEL: Record<JavaAssignmentView['status'], string> = {
  ready: '自动',
  manual: '手动',
  missing: '缺少',
  incompatible: '不兼容'
}

function formatGb(memoryMb: number): string {
  return `${Math.round((memoryMb / 1024) * 10) / 10} GB`
}

export function JavaAssignModal({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}) {
  const [items, setItems] = useState<JavaAssignmentView[]>([])
  const [loading, setLoading] = useState(false)
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

  const autoJava = items.filter((item) => item.javaAuto).length
  const autoMemory = items.filter((item) => item.memoryAuto).length
  const manualJava = items.filter((item) => !item.javaAuto).length
  const manualMemory = items.filter((item) => !item.memoryAuto).length
  const missing = items.filter(
    (item) => item.status === 'missing' || item.status === 'incompatible'
  ).length
  const availableMb = items[0]?.availableMemoryMb ?? 0
  const totalMb = items[0]?.totalMemoryMb ?? 0
  const pressured = items.filter(
    (item) => item.memoryAuto && item.availableMemoryMb < item.recommendedMemoryMb
  )

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Java 与内存自动策略"
      subtitle="启动时按整合包规模和总内存计算，并选择已安装的 Java；手动设置优先，不会在启动时被覆盖"
      icon={<WandSparkles size={18} />}
      size="lg"
      footer={
        <div className="java-assign-footer">
          <span>
            {loading
              ? '正在检查…'
              : `${autoJava} 个 Java 自动 · ${autoMemory} 个内存自动 · ${manualJava} 个 Java 手动 · ${manualMemory} 个内存手动 · ${missing} 个需处理`}
          </span>
          <div>
            <button
              type="button"
              className="button button--soft button--sm"
              disabled={loading}
              onClick={() => void load()}
            >
              <RefreshCw size={12} className={loading ? 'spin' : ''} />
              重新估算
            </button>
            <button type="button" className="button button--primary button--sm" onClick={onClose}>
              关闭
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
          <>
            {pressured.length > 0 && (
              <div className="java-assign-warning">
                <AlertTriangle size={13} />
                <span>
                  当前可用内存约 {formatGb(availableMb)}，低于 {pressured.length} 个自动实例的估算值。
                  自动分配会优先保证整合包规模，不再按瞬时可用内存压到很低；如果启动后卡顿，建议关闭其他程序或开启「启动前优化内存」。
                </span>
              </div>
            )}
            <div className="java-assign-list">
            {items.map((item) => (
              <article key={item.instanceId} className={`java-assign-row is-${item.status}`}>
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
                      {item.javaAuto
                        ? item.javaMajor
                          ? `启动时自动选择 Java ${item.javaMajor} · ${item.javaVersion}`
                          : '启动时自动选择 Java'
                        : item.javaMajor
                          ? `手动 Java ${item.javaMajor} · ${item.javaVersion}`
                          : '未指定 Java'}
                    </span>
                    <span>
                      <MemoryStick size={11} />
                      {item.memoryAuto
                        ? `启动时计算：约 ${formatGb(item.recommendedMemoryMb)}`
                        : `手动 ${formatGb(item.currentMemoryMb)}（自动估算 ${formatGb(item.recommendedMemoryMb)}）`}
                    </span>
                  </div>
                  {item.javaPath && (
                    <span className="java-assign-path" title={item.javaPath}>
                      {item.javaAuto ? '当前预计：' : ''}
                      {item.javaPath}
                    </span>
                  )}
                  {(item.message || item.memoryMessage) && (
                    <span className="java-assign-message">
                      {[item.message, item.memoryMessage].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </div>
                <div className="java-assign-badges">
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
                  <Badge tone={item.memoryAuto ? 'accent' : 'neutral'}>
                    {item.memoryAuto ? '启动时计算' : '内存手动'}
                  </Badge>
                </div>
              </article>
            ))}
            </div>
          </>
        )}
        {!loading && !error && items.length > 0 && (
          <p className="java-assign-tip">
            以上是当前时刻的预估：启动游戏时会按实例模组数量和总内存重新计算（最多预留 20% 给系统），并重新选择 Java。可用内存高于总内存的 60% 时按实际值放宽；瞬时占用偏低时也不会把大型整合包压到只剩一点。想在某个实例上固定值，可在实例启动设置里手动指定内存或 Java；「缺少」的 Java 仍会在启动时按全局自动 Java 设置尝试补齐。当前可用约 {formatGb(availableMb)}，总内存约 {formatGb(totalMb)}。
          </p>
        )}
      </div>
    </Modal>
  )
}
