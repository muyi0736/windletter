import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Archive,
  DatabaseBackup,
  FileClock,
  RefreshCw,
  Trash2
} from 'lucide-react'
import type {
  BackupCleanupRequest,
  BackupKind,
  BackupKindUsage,
  BackupOverview
} from '@shared/types'
import { useLauncher } from '../store'
import { cleanError, formatBytes, formatDateTime } from '../lib/format'
import {
  Badge,
  ConfirmDialog,
  EmptyState,
  Modal,
  NumberField,
  Spinner
} from './ui'

const KIND_ORDER: BackupKind[] = ['worlds', 'kubejs', 'content']

const KIND_META: Record<
  BackupKind,
  { label: string; description: string; icon: typeof Archive }
> = {
  worlds: {
    label: '世界备份',
    description: '存档完整副本，手动/加载器更新/恢复前三类分开保留',
    icon: Archive
  },
  kubejs: {
    label: 'KubeJS 历史',
    description: '脚本保存前的快照，按每个文件分别计数',
    icon: FileClock
  },
  content: {
    label: '内容更新备份',
    description: '模组/资源包/数据包更新前的原文件，用于回滚',
    icon: DatabaseBackup
  }
}

type PendingCleanup = {
  request: BackupCleanupRequest
  title: string
  message: string
}

function emptyKinds(): Record<BackupKind, BackupKindUsage> {
  return {
    worlds: { kind: 'worlds', count: 0, bytes: 0, oldestAt: null, newestAt: null },
    kubejs: { kind: 'kubejs', count: 0, bytes: 0, oldestAt: null, newestAt: null },
    content: { kind: 'content', count: 0, bytes: 0, oldestAt: null, newestAt: null }
  }
}

export function BackupManagerModal({
  open,
  initialInstanceId = null,
  onClose
}: {
  open: boolean
  initialInstanceId?: string | null
  onClose: () => void
}) {
  const instances = useLauncher((state) => state.instances)
  const settings = useLauncher((state) => state.settings)
  const toast = useLauncher((state) => state.toast)

  const [overview, setOverview] = useState<BackupOverview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [instanceFilter, setInstanceFilter] = useState('all')
  const [kinds, setKinds] = useState<BackupKind[]>(KIND_ORDER)
  const [days, setDays] = useState(30)
  const [pending, setPending] = useState<PendingCleanup | null>(null)
  const [cleaning, setCleaning] = useState(false)

  const loadOverview = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setOverview(await window.ccl.backups.overview())
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setInstanceFilter(initialInstanceId ?? 'all')
    setKinds(KIND_ORDER)
    setDays(30)
    setPending(null)
    void loadOverview()
  }, [open, initialInstanceId, loadOverview])

  const scopedInstances = useMemo(() => {
    const rows = overview?.instances ?? []
    return instanceFilter === 'all'
      ? rows
      : rows.filter((row) => row.instanceId === instanceFilter)
  }, [overview, instanceFilter])

  const scopedKinds = useMemo(() => {
    const totals = emptyKinds()
    for (const row of scopedInstances) {
      for (const item of row.kinds) {
        const target = totals[item.kind]
        target.count += item.count
        target.bytes += item.bytes
        if (item.oldestAt !== null) {
          target.oldestAt =
            target.oldestAt === null ? item.oldestAt : Math.min(target.oldestAt, item.oldestAt)
        }
        if (item.newestAt !== null) {
          target.newestAt =
            target.newestAt === null ? item.newestAt : Math.max(target.newestAt, item.newestAt)
        }
      }
    }
    return KIND_ORDER.map((kind) => totals[kind])
  }, [scopedInstances])

  const scopedBytes = scopedKinds.reduce((sum, item) => sum + item.bytes, 0)
  const scopedCount = scopedKinds.reduce((sum, item) => sum + item.count, 0)
  const scopedOtherBytes =
    instanceFilter === 'all'
      ? overview?.otherBytes ?? 0
      : scopedInstances[0]?.otherBytes ?? 0

  const toggleKind = (kind: BackupKind) => {
    setKinds((current) =>
      current.includes(kind) ? current.filter((item) => item !== kind) : [...current, kind]
    )
  }

  const buildRequest = (mode: BackupCleanupRequest['mode']): BackupCleanupRequest => ({
    instanceId: instanceFilter === 'all' ? null : instanceFilter,
    kinds: KIND_ORDER.filter((kind) => kinds.includes(kind)),
    mode,
    ...(mode === 'older-than' ? { days } : {})
  })

  const requestCleanup = (mode: BackupCleanupRequest['mode']) => {
    if (kinds.length === 0) {
      toast('info', '先选择要清理的备份类型')
      return
    }
    const request = buildRequest(mode)
    const scope = instanceFilter === 'all' ? '全部实例' : '当前实例'
    if (mode === 'policy') {
      const age = settings?.backupMaxAgeDays ?? 0
      setPending({
        request,
        title: '按保留策略清理',
        message: `将按当前设置清理${scope}的所选备份：世界每种类型保留 ${
          settings?.worldBackupLimit ?? 10
        } 份、KubeJS 每个文件保留 ${settings?.kubeJsBackupLimit ?? 50} 份、内容更新每个实例保留 ${
          settings?.contentBackupLimit ?? 6
        } 份${age > 0 ? `，并删除超过 ${age} 天的备份` : ''}。清理后不可恢复。`
      })
      return
    }
    if (mode === 'older-than') {
      setPending({
        request,
        title: `清理 ${days} 天前的备份`,
        message: `将删除${scope}中早于 ${days} 天的所选备份。内容更新备份被删除后，对应更新将无法回滚；操作不可恢复。`
      })
      return
    }
    setPending({
      request,
      title: '删除所选全部备份',
      message: `将删除${scope}的所选类型全部备份。世界与 KubeJS 历史会丢失；内容更新备份删除后对应更新将无法回滚。操作不可恢复。`
    })
  }

  const confirmCleanup = async () => {
    if (!pending || cleaning) return
    setCleaning(true)
    try {
      const result = await window.ccl.backups.cleanup(pending.request)
      toast(
        'success',
        '备份清理完成',
        result.removed > 0
          ? `删除 ${result.removed} 份备份，释放 ${formatBytes(result.bytes)}${
              result.skipped > 0 ? `；${result.skipped} 份未能删除` : ''
            }`
          : '没有符合条件、需要清理的备份'
      )
      setPending(null)
      await loadOverview()
    } catch (cause) {
      toast('error', '备份清理失败', cleanError(cause))
    } finally {
      setCleaning(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="备份管理"
      subtitle="世界、KubeJS 历史与内容更新备份的实际占用与清理；内容更新备份删除后对应更新无法回滚"
      icon={<DatabaseBackup size={20} />}
      size="xl"
      closeOnEscape={pending === null}
      footer={
        <button type="button" className="button button--soft" onClick={onClose}>
          关闭
        </button>
      }
    >
      <div className="backup-manager">
        <div className="backup-summary">
          <div className="backup-summary-main">
            <span>当前范围占用</span>
            <strong>{formatBytes(scopedBytes)}</strong>
            <small>{scopedCount} 份备份</small>
          </div>
          <div className="backup-summary-meta">
            <span>
              {instanceFilter === 'all'
                ? `${overview?.instances.length ?? 0} 个实例有备份`
                : instances.find((item) => item.id === instanceFilter)?.name ?? '当前实例'}
            </span>
            {scopedOtherBytes > 0 && (
              <span title="backups 下不属于世界/KubeJS/内容的旧目录，不会自动清理">
                其他旧目录 {formatBytes(scopedOtherBytes)}
              </span>
            )}
            <button
              type="button"
              className="button button--ghost button--sm"
              disabled={loading}
              onClick={() => void loadOverview()}
            >
              <RefreshCw size={12} className={loading ? 'spin' : ''} />
              重新统计
            </button>
          </div>
        </div>

        {error && (
          <div className="backup-error">
            <AlertTriangle size={14} />
            <span>{error}</span>
            <button type="button" className="link-button" onClick={() => void loadOverview()}>
              重试
            </button>
          </div>
        )}

        <section className="backup-block">
          <div className="backup-block-head">
            <div>
              <strong>备份类型</strong>
              <span>点选要纳入统计和清理的类型</span>
            </div>
            <Badge tone="neutral">{kinds.length} / {KIND_ORDER.length}</Badge>
          </div>
          <div className="backup-kind-grid">
            {scopedKinds.map((usage) => {
              const meta = KIND_META[usage.kind]
              const Icon = meta.icon
              const active = kinds.includes(usage.kind)
              return (
                <button
                  key={usage.kind}
                  type="button"
                  className={`backup-kind-card ${active ? 'is-selected' : ''}`}
                  onClick={() => toggleKind(usage.kind)}
                >
                  <span className="backup-kind-icon">
                    <Icon size={16} />
                  </span>
                  <span className="backup-kind-copy">
                    <strong>{meta.label}</strong>
                    <small>{meta.description}</small>
                  </span>
                  <span className="backup-kind-stats">
                    <strong>{formatBytes(usage.bytes)}</strong>
                    <small>
                      {usage.count} 份
                      {usage.newestAt ? ` · 最新 ${formatDateTime(usage.newestAt)}` : ''}
                    </small>
                  </span>
                  <span className={`backup-kind-check ${active ? 'is-on' : ''}`}>
                    {active ? '已选' : '未选'}
                  </span>
                </button>
              )
            })}
          </div>
        </section>

        <section className="backup-block">
          <div className="backup-block-head">
            <div>
              <strong>实例占用</strong>
              <span>切换范围只影响统计与本次清理</span>
            </div>
            <select
              className="workbench-select backup-instance-select"
              value={instanceFilter}
              onChange={(event) => setInstanceFilter(event.target.value)}
            >
              <option value="all">全部实例</option>
              {instances.map((instance) => (
                <option key={instance.id} value={instance.id}>
                  {instance.name} · MC {instance.gameVersion}
                </option>
              ))}
            </select>
          </div>
          {loading && !overview ? (
            <div className="backup-loading">
              <Spinner size={16} />
              正在扫描备份目录…
            </div>
          ) : scopedInstances.length === 0 ? (
            <EmptyState
              icon={<Archive size={22} />}
              title={instanceFilter === 'all' ? '还没有备份' : '这个实例还没有备份'}
              description="世界备份、KubeJS 历史、内容更新备份会分别显示在这里。"
            />
          ) : (
            <div className="backup-instance-list">
              {scopedInstances.map((row) => (
                <div key={row.instanceId} className="backup-instance-row">
                  <div className="backup-instance-copy">
                    <strong>{row.instanceName}</strong>
                    <small>
                      Minecraft {row.gameVersion} · {row.totalCount} 份备份
                    </small>
                  </div>
                  <div className="backup-instance-kinds">
                    {row.kinds.map((item) => (
                      <span key={item.kind}>
                        {KIND_META[item.kind].label} {formatBytes(item.bytes)}
                        <small>{item.count} 份</small>
                      </span>
                    ))}
                  </div>
                  <strong className="backup-instance-total">{formatBytes(row.totalBytes)}</strong>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="backup-block backup-cleanup">
          <div className="backup-block-head">
            <div>
              <strong>清理</strong>
              <span>删除不可恢复；内容更新备份被删除后，对应更新记录会同步移除</span>
            </div>
            <span className="backup-policy">
              策略：世界 {settings?.worldBackupLimit ?? 10} 份/类 · KubeJS{' '}
              {settings?.kubeJsBackupLimit ?? 50} 份/文件 · 内容{' '}
              {settings?.contentBackupLimit ?? 6} 份/实例
              {settings?.backupMaxAgeDays
                ? ` · 最长 ${settings.backupMaxAgeDays} 天`
                : ' · 不限天数'}
            </span>
          </div>
          <div className="backup-cleanup-actions">
            <button
              type="button"
              className="button button--primary button--sm"
              disabled={cleaning || kinds.length === 0}
              onClick={() => requestCleanup('policy')}
            >
              <DatabaseBackup size={13} />
              按保留策略清理
            </button>
            <div className="backup-age-clean">
              <NumberField
                ariaLabel="清理多少天前的备份"
                value={days}
                min={1}
                max={3650}
                suffix="天前"
                onCommit={setDays}
              />
              <button
                type="button"
                className="button button--soft button--sm"
                disabled={cleaning || kinds.length === 0}
                onClick={() => requestCleanup('older-than')}
              >
                <Trash2 size={13} />
                清理旧备份
              </button>
            </div>
            <button
              type="button"
              className="button button--danger button--sm"
              disabled={cleaning || kinds.length === 0}
              onClick={() => requestCleanup('all')}
            >
              <AlertTriangle size={13} />
              删除所选全部
            </button>
          </div>
          <p className="backup-cleanup-note">
            自动清理会在创建新备份或保存 KubeJS 脚本时按策略执行；这里可以立即对选中的实例和类型执行。
            删除实例时，它的全部备份会随实例目录一起删除。加载器回滚使用 versions 里的旧加载器档案，
            不占用 backups，可在首页「清理」中回收未使用的版本。
          </p>
        </section>
      </div>

      <ConfirmDialog
        open={pending !== null}
        title={pending?.title ?? '清理备份'}
        message={pending?.message ?? ''}
        confirmLabel="确认清理"
        danger
        busy={cleaning}
        onConfirm={() => void confirmCleanup()}
        onCancel={() => {
          if (!cleaning) setPending(null)
        }}
      />
    </Modal>
  )
}
