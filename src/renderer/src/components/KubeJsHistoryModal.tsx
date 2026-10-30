import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Clock3,
  FileClock,
  History,
  RotateCcw,
  Sparkles,
  Trash2
} from 'lucide-react'
import type {
  InstanceSummary,
  KubeJsFileContent,
  KubeJsHistoryContent,
  KubeJsHistoryEntry
} from '@shared/types'
import { cleanError, formatBytes, formatDateTime } from '../lib/format'
import { Modal, Spinner } from './ui'
import { useLauncher } from '../store'

interface DiffRow {
  type: 'same' | 'add' | 'del'
  text: string
  oldLine: number | null
  newLine: number | null
}

const MAX_DIFF_LINES = 1600

function buildDiff(before: string, after: string): {
  rows: DiffRow[]
  added: number
  removed: number
  truncated: boolean
} {
  const oldLines = before.replace(/\r\n/g, '\n').split('\n')
  const newLines = after.replace(/\r\n/g, '\n').split('\n')
  if (oldLines.length > MAX_DIFF_LINES || newLines.length > MAX_DIFF_LINES) {
    return { rows: [], added: 0, removed: 0, truncated: true }
  }
  const n = oldLines.length
  const m = newLines.length
  const table = new Uint16Array((n + 1) * (m + 1))
  const width = m + 1
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        oldLines[i] === newLines[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1])
    }
  }
  const rows: DiffRow[] = []
  let i = 0
  let j = 0
  let added = 0
  let removed = 0
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      rows.push({ type: 'same', text: oldLines[i], oldLine: i + 1, newLine: j + 1 })
      i += 1
      j += 1
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      rows.push({ type: 'del', text: oldLines[i], oldLine: i + 1, newLine: null })
      removed += 1
      i += 1
    } else {
      rows.push({ type: 'add', text: newLines[j], oldLine: null, newLine: j + 1 })
      added += 1
      j += 1
    }
  }
  while (i < n) {
    rows.push({ type: 'del', text: oldLines[i], oldLine: i + 1, newLine: null })
    removed += 1
    i += 1
  }
  while (j < m) {
    rows.push({ type: 'add', text: newLines[j], oldLine: null, newLine: j + 1 })
    added += 1
    j += 1
  }
  return { rows, added, removed, truncated: false }
}

export function DiffView({
  before,
  after,
  labelBefore,
  labelAfter
}: {
  before: string
  after: string
  labelBefore: string
  labelAfter: string
}) {
  const diff = useMemo(() => buildDiff(before, after), [before, after])
  if (diff.truncated) {
    return (
      <div className="kjs-diff-empty">
        <AlertTriangle size={14} />
        文件超过 {MAX_DIFF_LINES} 行，暂不在这里展开差异；仍可直接恢复该快照。
      </div>
    )
  }
  return (
    <div className="kjs-diff-wrap">
      <div className="kjs-diff-head">
        <span>{labelBefore}</span>
        <span className="kjs-diff-stats">
          <em className="is-add">+{diff.added}</em>
          <em className="is-del">-{diff.removed}</em>
        </span>
        <span>{labelAfter}</span>
      </div>
      <div className="kjs-diff">
        {diff.rows.map((row, index) => (
          <div key={`${index}-${row.type}`} className={`kjs-diff-row is-${row.type}`}>
            <span className="kjs-diff-line">{row.oldLine ?? ''}</span>
            <span className="kjs-diff-line">{row.newLine ?? ''}</span>
            <span className="kjs-diff-sign">
              {row.type === 'add' ? '+' : row.type === 'del' ? '-' : ' '}
            </span>
            <span className="kjs-diff-text">{row.text || ' '}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function KubeJsHistoryModal({
  open,
  instance,
  currentPath,
  dirtyPaths = [],
  onClose,
  onRestored
}: {
  open: boolean
  instance: InstanceSummary | null
  currentPath: string
  dirtyPaths?: string[]
  onClose: () => void
  onRestored: (file: KubeJsFileContent) => void
}) {
  const toast = useLauncher((state) => state.toast)
  const settings = useLauncher((state) => state.settings)
  const [entries, setEntries] = useState<KubeJsHistoryEntry[]>([])
  const [selectedPath, setSelectedPath] = useState('')
  const [selectedStamp, setSelectedStamp] = useState('')
  const [snapshot, setSnapshot] = useState<KubeJsHistoryContent | null>(null)
  const [current, setCurrent] = useState<KubeJsFileContent | null>(null)
  const [currentMissing, setCurrentMissing] = useState(false)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const requestRef = useRef(0)

  const grouped = useMemo(() => {
    const map = new Map<string, KubeJsHistoryEntry[]>()
    for (const entry of entries) {
      const group = map.get(entry.path) ?? []
      group.push(entry)
      map.set(entry.path, group)
    }
    for (const group of map.values()) {
      group.sort((a, b) => b.stamp.localeCompare(a.stamp))
    }
    return [...map.entries()].sort((a, b) =>
      (b[1][0]?.stamp ?? '').localeCompare(a[1][0]?.stamp ?? '')
    )
  }, [entries])

  const pathEntries = grouped.find(([path]) => path === selectedPath)?.[1] ?? []

  const loadEntries = async (preferredPath?: string) => {
    if (!instance) return
    setLoading(true)
    setError('')
    try {
      const next = await window.ccl.workshop.kubejsHistory(instance.id)
      setEntries(next)
      const paths = [...new Set(next.map((entry) => entry.path))]
      const pick =
        (preferredPath && paths.includes(preferredPath) ? preferredPath : '') ||
        (currentPath && paths.includes(currentPath) ? currentPath : '') ||
        paths[0] ||
        ''
      setSelectedPath(pick)
      const first = pick
        ? next
            .filter((entry) => entry.path === pick)
            .sort((a, b) => b.stamp.localeCompare(a.stamp))[0]
        : null
      setSelectedStamp(first?.stamp ?? '')
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!open || !instance) return
    setSnapshot(null)
    setCurrent(null)
    setCurrentMissing(false)
    setError('')
    void loadEntries(currentPath)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, instance?.id])

  useEffect(() => {
    if (!selectedPath) {
      setSelectedStamp('')
      return
    }
    const first = pathEntries[0]
    setSelectedStamp((previous) =>
      pathEntries.some((entry) => entry.stamp === previous) ? previous : first?.stamp ?? ''
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPath, entries])

  useEffect(() => {
    if (!open || !instance || !selectedPath || !selectedStamp) {
      setSnapshot(null)
      setCurrent(null)
      return
    }
    const request = ++requestRef.current
    setBusy(true)
    setError('')
    void (async () => {
      try {
        const [history, disk] = await Promise.all([
          window.ccl.workshop.kubejsHistoryRead(instance.id, selectedStamp, selectedPath),
          window.ccl.workshop
            .kubejsRead(instance.id, selectedPath)
            .catch(() => null)
        ])
        if (request !== requestRef.current) return
        setSnapshot(history)
        setCurrent(disk)
        setCurrentMissing(!disk)
      } catch (cause) {
        if (request === requestRef.current) setError(cleanError(cause))
      } finally {
        if (request === requestRef.current) setBusy(false)
      }
    })()
  }, [open, instance?.id, selectedPath, selectedStamp])

  if (!instance) return null

  const restore = async () => {
    if (!snapshot || busy) return
    const dirtyNote = dirtyPaths.includes(snapshot.path)
      ? '\n\n这个文件在编辑器里还有未保存的修改，恢复后编辑器会替换为快照内容。'
      : ''
    if (
      !window.confirm(
        `恢复 ${snapshot.path} 的 ${formatDateTime(snapshot.modified)} 快照？当前文件会先备份。${dirtyNote}`
      )
    ) {
      return
    }
    setBusy(true)
    setError('')
    try {
      const file = await window.ccl.workshop.kubejsHistoryRestore({
        instanceId: instance.id,
        stamp: snapshot.stamp,
        path: snapshot.path
      })
      onRestored(file)
      toast('success', 'KubeJS 快照已恢复', file.path)
      await loadEntries(file.path)
      setSelectedPath(file.path)
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setBusy(false)
    }
  }

  const cleanup = async () => {
    if (busy) return
    const keep = settings?.kubeJsBackupLimit ?? 50
    const age = settings?.backupMaxAgeDays ?? 0
    if (
      !window.confirm(
        `清理旧快照吗？每个文件保留最近 ${keep} 份${
          age > 0 ? `，并删除超过 ${age} 天的历史` : ''
        }，更早的会从 backups/kubejs 删除。`
      )
    ) {
      return
    }
    setBusy(true)
    setError('')
    try {
      const result = await window.ccl.workshop.kubejsHistoryClean(instance.id)
      toast(
        'success',
        '历史清理完成',
        result.removed > 0
          ? `删除 ${result.removed} 份旧快照，释放 ${formatBytes(result.bytes)}`
          : '没有需要清理的快照'
      )
      await loadEntries(selectedPath)
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
      title="KubeJS 历史"
      subtitle={`${instance.name} · 备份在实例的 backups/kubejs，不写入游戏目录`}
      icon={<History size={18} />}
      size="xl"
      footer={
        <div className="kjs-history-footer">
          <span>
            {entries.length > 0
              ? `${new Set(entries.map((entry) => entry.path)).size} 个文件 · ${entries.length} 份快照`
              : '还没有历史快照'}
          </span>
          <div>
            <button
              type="button"
              className="button button--ghost button--sm"
              onClick={() => void cleanup()}
              disabled={busy || entries.length === 0}
            >
              <Trash2 size={12} />
              清理旧快照
            </button>
            <button type="button" className="button button--ghost" onClick={onClose}>
              关闭
            </button>
            <button
              type="button"
              className="button button--primary"
              onClick={() => void restore()}
              disabled={busy || !snapshot}
            >
              {busy ? <Spinner size={13} /> : <RotateCcw size={13} />}
              恢复此版本
            </button>
          </div>
        </div>
      }
    >
      {loading ? (
        <div className="kjs-history-loading">
          <Spinner size={16} />
          正在读取 KubeJS 历史…
        </div>
      ) : entries.length === 0 ? (
        <div className="kjs-history-empty">
          <FileClock size={22} />
          <strong>还没有历史快照</strong>
          <span>在 KubeJS 工作台保存一次脚本后，这里会出现可恢复的版本。</span>
        </div>
      ) : (
        <div className="kjs-history">
          <aside className="kjs-history-files">
            <div className="kjs-history-caption">文件</div>
            {grouped.map(([path, list]) => (
              <button
                key={path}
                type="button"
                className={`kjs-history-file ${selectedPath === path ? 'is-active' : ''}`}
                onClick={() => setSelectedPath(path)}
                title={path}
              >
                <span>{path}</span>
                <em>{list.length}</em>
              </button>
            ))}
          </aside>
          <aside className="kjs-history-snapshots">
            <div className="kjs-history-caption">
              <Clock3 size={10} />
              快照
            </div>
            {pathEntries.map((entry) => (
              <button
                key={`${entry.stamp}-${entry.path}`}
                type="button"
                className={`kjs-history-snapshot ${selectedStamp === entry.stamp ? 'is-active' : ''}`}
                onClick={() => setSelectedStamp(entry.stamp)}
              >
                <strong>{formatDateTime(entry.modified)}</strong>
                <span>{formatBytes(entry.size)}</span>
              </button>
            ))}
          </aside>
          <section className="kjs-history-detail">
            {busy && !snapshot ? (
              <div className="kjs-history-loading is-inline">
                <Spinner size={14} />
                正在读取快照…
              </div>
            ) : snapshot ? (
              <>
                <div className="kjs-history-detail-head">
                  <div>
                    <strong>{snapshot.path}</strong>
                    <span>
                      {formatDateTime(snapshot.modified)} · {formatBytes(snapshot.size)} ·{' '}
                      {snapshot.lineEnding === 'crlf' ? 'CRLF' : 'LF'}
                      {snapshot.bom ? ' · BOM' : ''}
                    </span>
                  </div>
                  <em>与磁盘当前版本比较</em>
                </div>
                <DiffView
                  before={current?.content ?? ''}
                  after={snapshot.content}
                  labelBefore={currentMissing ? '当前文件已不存在' : '当前'}
                  labelAfter="快照"
                />
                {currentMissing && (
                  <div className="kjs-history-missing">
                    <AlertTriangle size={12} />
                    当前文件已不存在，恢复会用快照重新创建它。
                  </div>
                )}
              </>
            ) : (
              <div className="kjs-history-empty is-inline">
                <Sparkles size={16} />
                选择一个快照查看差异。
              </div>
            )}
            {error && (
              <div className="workshop-error is-compact">
                <AlertTriangle size={13} />
                <span>{error}</span>
              </div>
            )}
          </section>
        </div>
      )}
    </Modal>
  )
}
