import { useEffect, useState } from 'react'
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
  const savedFolders = settings?.localPackFolders ?? []

  const runScan = async (extras: string[]) => {
    setLoading(true)
    setError('')
    setSelectedKeys([])
    try {
      setResult(await window.ccl.localPacks.scan(extras))
    } catch (err) {
      setError(cleanError(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!open) return
    setResult(null)
    void runScan(settings?.localPackFolders ?? [])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const chooseFolder = async () => {
    const folder = await window.ccl.app.pickDirectory('选择包含整合包或整合包文件的文件夹')
    if (!folder) return
    const next = savedFolders.includes(folder)
      ? savedFolders
      : [...savedFolders, folder].slice(0, 20)
    if (!savedFolders.includes(folder)) await patchSettings({ localPackFolders: next })
    await runScan(next)
  }

  const removeFolder = async (folder: string) => {
    const next = savedFolders.filter((item) => item !== folder)
    await patchSettings({ localPackFolders: next })
    await runScan(next)
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
      previous.includes(key)
        ? previous.filter((item) => item !== key)
        : [...previous, key]
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
  const existingRoots = (result?.roots.filter((root) => root.exists) ?? []).filter(
    (root) => root.label !== '已保存目录'
  )

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
          {pack.detail && <span>{pack.detail}</span>}
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
          {pack.external
            ? '添加并启动'
            : pack.kind === 'archive'
              ? '安装并启动'
              : '导入并启动'}
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
      title="扫描本地整合包"
      subtitle="外部 .minecraft 版本会直接引用原目录启动，不复制、不重新下载"
      icon={<FolderSearch size={18} />}
      size="xl"
      footer={
        <div className="localpack-footer">
          <span>
            {result
              ? `找到 ${result.packs.length} 个 · 已安装 ${instances.length} 个 · 文件 ${archives.length} 个${
                  selectedPacks.length > 0 ? ` · 已选 ${selectedPacks.length}` : ''
                }`
              : '正在准备扫描…'}
          </span>
          <button type="button" className="button button--ghost button--sm" onClick={onClose}>
            关闭
          </button>
        </div>
      }
    >
      <div className="localpack-modal">
        <div className="localpack-toolbar">
          <div className="localpack-roots">
            {existingRoots.length > 0 ? (
              existingRoots.map((root) => (
                <span key={root.path} className="localpack-root" title={root.path}>
                  {root.label}
                </span>
              ))
            ) : (
              <span className="localpack-root">等待扫描</span>
            )}
          </div>
          <div className="localpack-actions">
            <button
              type="button"
              className="button button--soft button--sm"
              disabled={selectable.length === 0 || importing !== null}
              onClick={() =>
                setSelectedKeys(
                  allSelected ? [] : selectable.slice(0, 50).map((pack) => pack.key)
                )
              }
            >
              {allSelected ? '取消全选' : '全选可添加'}
            </button>
            <button
              type="button"
              className="button button--primary button--sm"
              disabled={selectedPacks.length === 0 || importing !== null}
              onClick={() => void handleBatch()}
            >
              {importing === '__batch__' ? <Spinner size={12} /> : <PackagePlus size={12} />}
              批量添加{selectedPacks.length > 0 ? ` (${selectedPacks.length})` : ''}
            </button>
            <button
              type="button"
              className="button button--soft button--sm"
              disabled={loading}
              onClick={() => void runScan(savedFolders)}
            >
              <RefreshCw size={12} className={loading ? 'spin' : ''} />
              重新扫描
            </button>
            <button
              type="button"
              className="button button--soft button--sm"
              onClick={() => void chooseFolder()}
            >
              <FolderOpen size={12} />
              选择文件夹
            </button>
          </div>
        </div>

        {savedFolders.length > 0 && (
          <div className="localpack-saved">
            <span className="localpack-saved-label">已保存文件夹</span>
            {savedFolders.map((folder) => (
              <span key={folder} className="localpack-saved-item" title={folder}>
                <FolderOpen size={10} />
                <span>{folder.split(/[\\/]/).pop() ?? folder}</span>
                <button
                  type="button"
                  title="移除并重新扫描"
                  onClick={() => void removeFolder(folder)}
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}

        {loading ? (
          <div className="downloads-loading localpack-loading">
            <Spinner size={16} />
            正在扫描本地启动器与整合包文件…
          </div>
        ) : error ? (
          <div className="mods-error">
            <AlertTriangle size={14} />
            <span>{error}</span>
          </div>
        ) : result && result.packs.length === 0 ? (
          <EmptyState
            icon={<FolderSearch size={26} />}
            title="没有找到本地整合包"
            description="可以手动选择一个包含 CurseForge / Prism / Modrinth 实例或 .mrpack / .zip 整合包文件的文件夹。"
            action={
              <button type="button" className="button button--primary" onClick={() => void chooseFolder()}>
                <FolderOpen size={14} />
                选择文件夹
              </button>
            }
          />
        ) : (
          <>
            {instances.length > 0 && (
              <section className="localpack-section">
                <div className="localpack-section-head">
                  <Boxes size={14} />
                  已安装的整合包
                  <span>{instances.length}</span>
                </div>
                <div className="localpack-list">{instances.map(renderPack)}</div>
              </section>
            )}
            {archives.length > 0 && (
              <section className="localpack-section">
                <div className="localpack-section-head">
                  <Archive size={14} />
                  本地整合包文件
                  <span>{archives.length}</span>
                </div>
                <div className="localpack-list">{archives.map(renderPack)}</div>
              </section>
            )}
            <p className="localpack-note">
              外部 .minecraft 版本只添加引用，直接使用原目录、原模组与原运行库启动，不复制也不重新下载。其他启动器实例会补齐原版与加载器并复制模组和配置；存档、日志与共享库不复制。
            </p>
          </>
        )}
      </div>
    </Modal>
  )
}
