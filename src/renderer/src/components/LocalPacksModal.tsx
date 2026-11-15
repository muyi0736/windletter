import { useEffect, useState, type DragEvent } from 'react'
import {
  AlertTriangle,
  Archive,
  Boxes,
  FolderOpen,
  FolderSearch,
  HardDrive,
  PackagePlus,
  Play,
  RefreshCw,
  Upload,
  X
} from 'lucide-react'
import type { LocalPackScanResult, LocalPackView } from '@shared/types'
import { useLauncher } from '../store'
import { cleanError, loaderLabel } from '../lib/format'
import { Badge, EmptyState, Modal, Spinner } from './ui'

export function LocalPacksModal({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}) {
  const importLocalPack = useLauncher((state) => state.importLocalPack)
  const importLocalPacks = useLauncher((state) => state.importLocalPacks)
  const settings = useLauncher((state) => state.settings)
  const patchSettings = useLauncher((state) => state.patchSettings)
  const [result, setResult] = useState<LocalPackScanResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [importing, setImporting] = useState<string | null>(null)
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [focus, setFocus] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const savedFolders = settings?.localPackFolders ?? []

  const runScan = async (extras: string[], scope: 'all' | 'extra') => {
    setLoading(true)
    setError('')
    setSelectedKeys([])
    try {
      setResult(await window.ccl.localPacks.scan(extras, scope))
    } catch (err) {
      setError(cleanError(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!open) return
    setResult(null)
    setFocus(null)
    void runScan(settings?.localPackFolders ?? [], 'all')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const focusOn = async (path: string, save: boolean) => {
    setFocus(path)
    if (save && !savedFolders.includes(path)) {
      await patchSettings({ localPackFolders: [...savedFolders, path].slice(0, 20) })
    }
    await runScan([path], 'extra')
  }

  const chooseFolder = async () => {
    const folder = await window.ccl.app.pickDirectory('选择整合包文件夹 / 游戏目录（.minecraft）')
    if (folder) await focusOn(folder, true)
  }

  const chooseFile = async () => {
    const file = await window.ccl.app.pickFile('选择整合包文件', [
      { name: '整合包', extensions: ['mrpack', 'zip'] }
    ])
    if (file) await focusOn(file, false)
  }

  const onDrop = async (event: DragEvent) => {
    event.preventDefault()
    setDragOver(false)
    const file = event.dataTransfer.files?.[0]
    if (!file) return
    const path = window.ccl.app.getPathForFile(file)
    if (path && /\.(mrpack|zip)$/i.test(path)) await focusOn(path, false)
  }

  const clearFocus = () => {
    setFocus(null)
    void runScan(savedFolders, 'all')
  }

  const handleImport = async (pack: LocalPackView, launchAfter: boolean) => {
    setImporting(pack.key)
    const task = await importLocalPack(pack, launchAfter)
    setImporting(null)
    if (task) onClose()
  }

  const selectable = (result?.packs ?? []).filter((pack) => pack.importable)
  const selectedPacks = selectable.filter((pack) => selectedKeys.includes(pack.key))
  const allSelected = selectable.length > 0 && selectedPacks.length === selectable.length

  const toggleSelected = (key: string) => {
    setSelectedKeys((previous) =>
      previous.includes(key) ? previous.filter((item) => item !== key) : [...previous, key]
    )
  }

  const handleBatch = async () => {
    if (selectedPacks.length === 0) return
    setImporting('__batch__')
    const task = await importLocalPacks(selectedPacks)
    setImporting(null)
    if (task) onClose()
  }

  const instances = result?.packs.filter((pack) => pack.kind === 'instance') ?? []
  const archives = result?.packs.filter((pack) => pack.kind === 'archive') ?? []

  const renderPack = (pack: LocalPackView) => (
    <article key={pack.key} className={`localpack-row ${pack.importable ? '' : 'is-invalid'}`}>
      <input
        type="checkbox"
        className="localpack-check"
        checked={selectedKeys.includes(pack.key)}
        disabled={!pack.importable || importing !== null}
        aria-label={`选择 ${pack.name}`}
        onChange={() => toggleSelected(pack.key)}
      />
      <span className="localpack-icon">
        {pack.kind === 'instance' ? <HardDrive size={20} /> : <Archive size={20} />}
      </span>
      <div className="localpack-copy">
        <div className="localpack-head">
          <strong>{pack.name}</strong>
          {pack.external && <Badge tone="accent">外部</Badge>}
          <Badge tone="neutral">{pack.source}</Badge>
        </div>
        <div className="localpack-meta">
          <span>{pack.gameVersion ? `Minecraft ${pack.gameVersion}` : '版本未知'}</span>
          <span>{loaderLabel(pack.loader) ?? '原版'}</span>
          {pack.loaderVersion && <span>{pack.loaderVersion}</span>}
          <span>{pack.modCount} {pack.kind === 'archive' ? '个文件' : '个模组'}</span>
        </div>
        <span className="localpack-path" title={pack.path}>
          {pack.path}
        </span>
        {!pack.importable && pack.reason && (
          <span className="localpack-reason">
            <AlertTriangle size={11} />
            {pack.reason}
          </span>
        )}
      </div>
      <div className="localpack-row-actions">
        <button
          type="button"
          className="button button--primary button--sm"
          disabled={!pack.importable || importing !== null}
          onClick={() => void handleImport(pack, true)}
        >
          {importing === pack.key ? <Spinner size={12} /> : <Play size={12} />}
          {pack.external ? '添加并启动' : pack.kind === 'archive' ? '安装并启动' : '导入并启动'}
        </button>
        <button
          type="button"
          className="button button--ghost button--sm"
          disabled={!pack.importable || importing !== null}
          onClick={() => void handleImport(pack, false)}
        >
          <PackagePlus size={12} />
          {pack.external ? '仅添加' : pack.kind === 'archive' ? '仅安装' : '仅导入'}
        </button>
      </div>
    </article>
  )

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="导入整合包"
      subtitle="选一个整合包文件或文件夹，识别后一键导入；外部 .minecraft 版本直接引用原目录"
      icon={<FolderSearch size={18} />}
      size="xl"
      footer={
        <div className="localpack-footer">
          <span>
            {result
              ? `找到 ${result.packs.length} 个 · 可导入 ${selectable.length} 个${
                  selectedPacks.length > 0 ? ` · 已选 ${selectedPacks.length}` : ''
                }`
              : '正在准备…'}
          </span>
          <button type="button" className="button button--ghost button--sm" onClick={onClose}>
            关闭
          </button>
        </div>
      }
    >
      <div
        className={`localpack-modal ${dragOver ? 'is-dragover' : ''}`}
        onDragOver={(event) => {
          event.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => void onDrop(event)}
      >
        <div className="localpack-picker">
          <button type="button" className="button button--primary" onClick={() => void chooseFile()}>
            <Archive size={14} />
            选择整合包文件
          </button>
          <button type="button" className="button button--soft" onClick={() => void chooseFolder()}>
            <FolderOpen size={14} />
            选择文件夹 / 游戏目录
          </button>
          <span className="localpack-drop-hint">
            <Upload size={12} />
            也可把 .mrpack / .zip 拖进来
          </span>
          {focus && (
            <button type="button" className="button button--ghost button--sm" onClick={clearFocus}>
              <X size={12} />
              查看全部
            </button>
          )}
        </div>

        {focus && (
          <div className="localpack-focus" title={focus}>
            <FolderOpen size={12} />
            正在查看：{focus}
          </div>
        )}

        {loading ? (
          <div className="downloads-loading localpack-loading">
            <Spinner size={16} />
            正在识别整合包…
          </div>
        ) : error ? (
          <div className="mods-error">
            <AlertTriangle size={14} />
            <span>{error}</span>
          </div>
        ) : result && result.packs.length === 0 ? (
          <EmptyState
            icon={<FolderSearch size={26} />}
            title={focus ? '这个位置没有可导入的整合包' : '没有自动发现整合包'}
            description="选择整合包文件（.mrpack / .zip），或选择包含实例 / .minecraft 游戏目录的文件夹。"
            action={
              <button type="button" className="button button--primary" onClick={() => void chooseFolder()}>
                <FolderOpen size={14} />
                选择文件夹
              </button>
            }
          />
        ) : (
          <>
            <div className="localpack-toolbar">
              <div className="localpack-actions">
                <button
                  type="button"
                  className="button button--soft button--sm"
                  disabled={selectable.length === 0 || importing !== null}
                  onClick={() =>
                    setSelectedKeys(allSelected ? [] : selectable.slice(0, 50).map((p) => p.key))
                  }
                >
                  {allSelected ? '取消全选' : '全选可导入'}
                </button>
                <button
                  type="button"
                  className="button button--primary button--sm"
                  disabled={selectedPacks.length === 0 || importing !== null}
                  onClick={() => void handleBatch()}
                >
                  {importing === '__batch__' ? <Spinner size={12} /> : <PackagePlus size={12} />}
                  批量导入{selectedPacks.length > 0 ? ` (${selectedPacks.length})` : ''}
                </button>
                {!focus && (
                  <button
                    type="button"
                    className="button button--soft button--sm"
                    disabled={loading}
                    onClick={() => void runScan(savedFolders, 'all')}
                  >
                    <RefreshCw size={12} className={loading ? 'spin' : ''} />
                    重新扫描
                  </button>
                )}
              </div>
            </div>
            {instances.length > 0 && (
              <section className="localpack-section">
                <div className="localpack-section-head">
                  <Boxes size={14} />
                  已安装的整合包 / 外部版本
                  <span>{instances.length}</span>
                </div>
                <div className="localpack-list">{instances.map(renderPack)}</div>
              </section>
            )}
            {archives.length > 0 && (
              <section className="localpack-section">
                <div className="localpack-section-head">
                  <Archive size={14} />
                  整合包文件
                  <span>{archives.length}</span>
                </div>
                <div className="localpack-list">{archives.map(renderPack)}</div>
              </section>
            )}
            <p className="localpack-note">
              外部 .minecraft 版本只添加引用，直接用原目录、原模组与原运行库启动，不复制不重新下载；
              其他启动器实例会补齐原版与加载器并复制模组/配置，存档与共享库不复制。
            </p>
          </>
        )}
      </div>
    </Modal>
  )
}
