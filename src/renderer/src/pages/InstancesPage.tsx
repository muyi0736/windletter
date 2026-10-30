import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Archive,
  ArrowRightLeft,
  ArrowUpCircle,
  Boxes,
  Clock3,
  DatabaseBackup,
  Download,
  ExternalLink,
  Folder,
  FolderOpen,
  FolderSearch,
  Gamepad2,
  HardDrive,
  Images,
  Info,
  PackagePlus,
  Palette,
  Play,
  RefreshCw,
  Search,
  Server,
  Settings2,
  Sparkles,
  Square,
  Star,
  Stethoscope,
  Trash2,
  Wrench,
  X
} from 'lucide-react'
import type { InstanceSummary, ModrinthProjectView } from '@shared/types'
import { useLauncher } from '../store'
import {
  cleanError,
  formatCount,
  formatDate,
  loaderKind,
  loaderLabel,
  relativeTime
} from '../lib/format'
import {
  Badge,
  ConfirmDialog,
  EmptyState,
  IconButton,
  Modal,
  Segmented,
  Spinner
} from '../components/ui'
import { RemoteIcon } from '../components/RemoteIcon'
import { LocalPacksModal } from '../components/LocalPacksModal'
import { InstanceSettingsModal } from '../components/InstanceSettingsModal'
import { InstanceContentModal } from '../components/InstanceContentModal'
import { WorldVaultModal } from '../components/WorldVaultModal'
import { ScreenshotGalleryModal } from '../components/ScreenshotGalleryModal'
import { InstanceTransferModal } from '../components/InstanceTransferModal'
import { ServerPackModal } from '../components/ServerPackModal'
import { PackWorkshopModal } from '../components/PackWorkshopModal'
import { VanillaInstanceModal } from '../components/VanillaInstanceModal'
import { BackupManagerModal } from '../components/BackupManagerModal'

type Tab = 'mine' | 'discover'

const KNOWN_LOADERS = ['fabric', 'quilt', 'forge', 'neoforge']

function latestGameVersion(versions: string[]): string | null {
  return versions.length ? versions[versions.length - 1] : null
}

function folderLabel(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] || path
}

export function InstancesPage() {
  const instances = useLauncher((state) => state.instances)
  const settings = useLauncher((state) => state.settings)
  const instancesLoading = useLauncher((state) => state.instancesLoading)
  const tasks = useLauncher((state) => state.tasks)
  const launch = useLauncher((state) => state.launch)
  const accounts = useLauncher((state) => state.accounts)
  const selectedInstanceId = useLauncher((state) => state.selectedInstanceId)
  const refreshInstances = useLauncher((state) => state.refreshInstances)
  const selectInstance = useLauncher((state) => state.selectInstance)
  const startInstance = useLauncher((state) => state.startInstance)
  const importModpack = useLauncher((state) => state.importModpack)
  const installModrinth = useLauncher((state) => state.installModrinth)
  const removeInstance = useLauncher((state) => state.removeInstance)
  const openDiagnosis = useLauncher((state) => state.openDiagnosis)
  const setAccountModalOpen = useLauncher((state) => state.setAccountModalOpen)
  const setPresetManagerOpen = useLauncher((state) => state.setPresetManagerOpen)
  const setPage = useLauncher((state) => state.setPage)
  const toast = useLauncher((state) => state.toast)

  const [tab, setTab] = useState<Tab>('mine')
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<ModrinthProjectView[]>([])
  const [totalHits, setTotalHits] = useState(0)
  const [offset, setOffset] = useState(0)
  const [searching, setSearching] = useState(false)
  const [searchingMore, setSearchingMore] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<InstanceSummary | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [localPacksOpen, setLocalPacksOpen] = useState(false)
  const [vanillaOpen, setVanillaOpen] = useState(false)
  const [backupInstance, setBackupInstance] = useState<InstanceSummary | null>(null)
  const [settingsInstance, setSettingsInstance] = useState<InstanceSummary | null>(null)
  const [contentInstance, setContentInstance] = useState<InstanceSummary | null>(null)
  const [contentInitialTab, setContentInitialTab] = useState<'resourcepack' | null>(null)
  const [worldInstance, setWorldInstance] = useState<InstanceSummary | null>(null)
  const [screenshotInstance, setScreenshotInstance] = useState<InstanceSummary | null>(null)
  const [transferInstance, setTransferInstance] = useState<InstanceSummary | null>(null)
  const [serverPackInstance, setServerPackInstance] = useState<InstanceSummary | null>(null)
  const [workshopInstance, setWorkshopInstance] = useState<InstanceSummary | null>(null)
  const [preview, setPreview] = useState<ModrinthProjectView | null>(null)
  const searchSeq = useRef(0)
  const discoverStarted = useRef(false)

  const launchBusy = launch.status === 'preparing' || launch.status === 'starting'
  const running = launch.status === 'running'
  const launchActive = launchBusy || running
  const previewLoaders = preview
    ? preview.categories.filter((category) => KNOWN_LOADERS.includes(category.toLowerCase()))
    : []
  const previewSupported =
    previewLoaders.length === 0 ||
    previewLoaders.some((loader) =>
      ['fabric', 'quilt', 'forge', 'neoforge'].includes(loader.toLowerCase())
    )

  useEffect(() => {
    void refreshInstances()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const runSearch = useCallback(
    async (keyword: string, nextOffset: number, append: boolean) => {
      const seq = ++searchSeq.current
      if (append) setSearchingMore(true)
      else setSearching(true)
      setSearchError(null)
      try {
        const result = await window.ccl.modrinth.search(keyword, nextOffset)
        if (seq !== searchSeq.current) return
        setHits((previous) => {
          if (!append) return result.hits
          const seen = new Set(previous.map((project) => `${project.provider}:${project.slug}`))
          return [
            ...previous,
            ...result.hits.filter((project) => {
              const key = `${project.provider}:${project.slug}`
              if (seen.has(key)) return false
              seen.add(key)
              return true
            })
          ]
        })
        setTotalHits(result.totalHits)
        setOffset(result.nextOffset ?? result.offset + result.hits.length)
      } catch (error) {
        if (seq === searchSeq.current) setSearchError(cleanError(error))
      } finally {
        if (seq === searchSeq.current) {
          setSearching(false)
          setSearchingMore(false)
        }
      }
    },
    []
  )

  useEffect(() => {
    if (tab !== 'discover') return
    if (!discoverStarted.current) {
      discoverStarted.current = true
      void runSearch('', 0, false)
      return
    }
    const timer = setTimeout(() => {
      void runSearch(query, 0, false)
    }, 420)
    return () => clearTimeout(timer)
  }, [tab, query, runSearch])

  const taskForProject = (projectId: string) =>
    tasks.find(
      (task) =>
        task.kind === 'modpack' &&
        (task.status === 'running' || task.status === 'paused') &&
        task.projectId === projectId
    )

  const handleLaunch = (instance: InstanceSummary) => {
    if (!accounts.activeId) {
      setAccountModalOpen(true)
      toast('info', '先添加一个账户', '离线账户也可以启动本地整合包')
      return
    }
    if (launchActive) {
      toast(
        'info',
        '已有游戏正在运行',
        launch.instanceId === instance.id ? '请回到启动页结束当前进程' : '请先结束当前游戏'
      )
      return
    }
    void startInstance(instance.id)
  }

  const handleDelete = async () => {
    if (!pendingDelete) return
    setDeleting(true)
    await removeInstance(pendingDelete.id)
    setDeleting(false)
    setPendingDelete(null)
  }

  const openFolder = (instance: InstanceSummary) => {
    void window.ccl.instances.openFolder(instance.id).catch((error) => {
      toast('error', '无法打开实例目录', cleanError(error))
    })
  }

  const openProject = (project: ModrinthProjectView) => {
    void window.ccl.app
      .openExternal(`https://modrinth.com/modpack/${encodeURIComponent(project.slug)}`)
      .catch((error) => toast('error', '无法打开网页', cleanError(error)))
  }

  return (
    <div className="page page--instances">
      <header className="page-head instances-head">
        <div className="page-head-copy">
          <span className="page-eyebrow">
            <Boxes size={14} />
            实例与整合包
          </span>
          <h1>一整包世界，直接出发</h1>
          <p>管理已安装的实例；也可以新建一个隔离的原版实例，或到「下载 → 整合包」寻找整合包。</p>
        </div>
        <div className="instances-head-actions">
          <button
            type="button"
            className="button button--soft"
            onClick={() => setVanillaOpen(true)}
          >
            <Gamepad2 size={15} />
            新建原版实例
          </button>
          <button
            type="button"
            className="button button--soft"
            onClick={() => window.dispatchEvent(new Event('windletter:version-folders'))}
            title="切换版本文件夹"
          >
            <FolderOpen size={15} />
            版本文件夹
          </button>
          <button
            type="button"
            className="button button--soft"
            disabled={instancesLoading}
            onClick={() => void refreshInstances()}
          >
            <RefreshCw size={15} className={instancesLoading ? 'spin' : ''} />
            刷新
          </button>
          <button
            type="button"
            className="button button--soft"
            onClick={() => setPresetManagerOpen(true)}
          >
            <Sparkles size={15} />
            预设模组
          </button>
          <button type="button" className="button button--soft" onClick={() => setLocalPacksOpen(true)}>
            <FolderSearch size={15} />
            扫描本地
          </button>
          <button type="button" className="button button--primary" onClick={() => void importModpack()}>
            <PackagePlus size={15} />
            导入整合包
          </button>
        </div>
      </header>

      <div className="instances-tabs">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'mine', label: `我的实例 ${instances.length ? `· ${instances.length}` : ''}` }
          ]}
        />
        <span className="instances-tabs-hint">每个实例的模组、配置与存档彼此隔离；新整合包请到「下载」页</span>
      </div>

      {tab === 'mine' ? (
        <div className="instances-body">
          {instancesLoading && instances.length === 0 ? (
            <div className="instances-loading card">
              <Spinner size={18} />
              正在读取实例列表…
            </div>
          ) : instances.length === 0 ? (
            <div className="card instances-empty">
              <EmptyState
                icon={<Boxes size={26} />}
                title="还没有实例"
                description="新建一个隔离的原版实例，或导入 .mrpack / .zip 整合包。风信会补齐原版、加载器与模组文件。"
                action={
                  <div className="picker-empty-actions">
                    <button
                      type="button"
                      className="button button--primary"
                      onClick={() => setVanillaOpen(true)}
                    >
                      <Gamepad2 size={15} />
                      新建原版实例
                    </button>
                    <button
                      type="button"
                      className="button button--soft"
                      onClick={() => void importModpack()}
                    >
                      <PackagePlus size={15} />
                      导入整合包
                    </button>
                    <button
                      type="button"
                      className="button button--soft"
                      onClick={() => setLocalPacksOpen(true)}
                    >
                      <FolderSearch size={15} />
                      扫描本地
                    </button>
                    <button type="button" className="button button--soft" onClick={() => setPage('downloads')}>
                      <Search size={15} />
                      去下载整合包
                    </button>
                  </div>
                }
              />
            </div>
          ) : (
            <div className="instance-grid">
              {instances.map((instance) => {
                const isSelected = instance.id === selectedInstanceId
                const isRunning = launchActive && launch.instanceId === instance.id
                const canLaunch = !launchActive
                const boundFolder =
                  instance.external?.baseDir ??
                  instance.baseDir ??
                  settings?.gameDir ??
                  ''
                return (
                  <article
                    key={instance.id}
                    className={`instance-card card ${isSelected ? 'is-selected' : ''}`}
                    onClick={() => selectInstance(instance.id)}
                  >
                    <div className="instance-card-head">
                      <span className="instance-card-icon">
                        {instance.iconUrl ? (
                          <RemoteIcon url={instance.iconUrl} fallback={<Boxes size={26} />} />
                        ) : (
                          <Boxes size={26} />
                        )}
                      </span>
                      <div className="instance-card-title">
                        <strong title={instance.name}>{instance.name}</strong>
                        <span title={instance.summary}>
                          {instance.summary || `Minecraft ${instance.gameVersion} 整合包`}
                        </span>
                      </div>
                      {instance.favorite && (
                        <Star size={14} fill="currentColor" className="instance-favorite-mark" />
                      )}
                      {isSelected && <Badge tone="accent">当前</Badge>}
                      {isRunning && <Badge tone="success">运行中</Badge>}
                    </div>

                    <div className="instance-tags">
                      <span className="type-tag type-tag--release">Minecraft {instance.gameVersion}</span>
                      <span className={`loader-tag loader-tag--${loaderKind(instance.loader)}`}>
                        {instance.loader === 'vanilla'
                          ? '原版'
                          : loaderLabel(instance.loader)}
                      </span>
                      <span className="instance-tag-muted">{instance.modCount} 个模组</span>
                      {instance.category && (
                        <span className="instance-tag-muted">{instance.category}</span>
                      )}
                      {instance.external && (
                        <span
                          className="instance-tag-muted"
                          title={instance.external.gameDir}
                        >
                          外部目录
                        </span>
                      )}
                    </div>

                    <div className="instance-meta">
                      <span>
                        <Clock3 size={12} />
                        {relativeTime(instance.lastPlayed)}
                      </span>
                      <span>
                        <HardDrive size={12} />
                        {formatDate(instance.installedAt)} 安装
                      </span>
                      <span title={boundFolder}>
                        <Folder size={12} />
                        {instance.external ? '外部 · ' : ''}
                        {boundFolder ? folderLabel(boundFolder) : '当前文件夹'}
                      </span>
                    </div>

                    <div className="instance-actions">
                      <button
                        type="button"
                        className={`button button--primary button--sm ${isRunning ? 'is-running' : ''}`}
                        disabled={launchActive || !canLaunch}
                        title={isRunning ? '请回到启动页结束游戏' : undefined}
                        onClick={(event) => {
                          event.stopPropagation()
                          if (isRunning) return
                          handleLaunch(instance)
                        }}
                      >
                        {isRunning ? (
                          <Square size={13} fill="currentColor" />
                        ) : launchBusy ? (
                          <Spinner size={13} />
                        ) : (
                          <Play size={13} fill="currentColor" />
                        )}
                        {isRunning ? '运行中' : '启动'}
                      </button>
                      <button
                        type="button"
                        className="button button--soft button--sm"
                        onClick={(event) => {
                          event.stopPropagation()
                          setContentInitialTab(null)
                          setContentInstance(instance)
                        }}
                      >
                        <Boxes size={14} />
                        内容
                      </button>
                      <button
                        type="button"
                        className="button button--soft button--sm"
                        title="只读预览资源包、光影包、数据包"
                        onClick={(event) => {
                          event.stopPropagation()
                          setContentInitialTab('resourcepack')
                          setContentInstance(instance)
                        }}
                      >
                        <Palette size={14} />
                        资源
                      </button>
                      <button
                        type="button"
                        className="button button--soft button--sm"
                        onClick={(event) => {
                          event.stopPropagation()
                          setWorldInstance(instance)
                        }}
                      >
                        <Archive size={14} />
                        存档
                      </button>
                      <button
                        type="button"
                        className="button button--soft button--sm"
                        onClick={(event) => {
                          event.stopPropagation()
                          setScreenshotInstance(instance)
                        }}
                      >
                        <Images size={14} />
                        截图
                      </button>
                      <button
                        type="button"
                        className="button button--soft button--sm"
                        onClick={(event) => {
                          event.stopPropagation()
                          openFolder(instance)
                        }}
                      >
                        <FolderOpen size={14} />
                        目录
                      </button>
                      <span className="instance-actions-tail">
                        <IconButton
                          label="整合包工坊"
                          disabled={isRunning}
                          onClick={(event) => {
                            event.stopPropagation()
                            setWorkshopInstance(instance)
                          }}
                        >
                          <Wrench size={15} />
                        </IconButton>
                        <IconButton
                          label="制作服务端包"
                          disabled={isRunning}
                          onClick={(event) => {
                            event.stopPropagation()
                            setServerPackInstance(instance)
                          }}
                        >
                          <Server size={15} />
                        </IconButton>
                        <IconButton
                          label="迁移或克隆实例"
                          disabled={isRunning}
                          onClick={(event) => {
                            event.stopPropagation()
                            setTransferInstance(instance)
                          }}
                        >
                          <ArrowRightLeft size={15} />
                        </IconButton>
                        <IconButton
                          label="备份管理"
                          onClick={(event) => {
                            event.stopPropagation()
                            setBackupInstance(instance)
                          }}
                        >
                          <DatabaseBackup size={15} />
                        </IconButton>
                        <IconButton
                          label="启动体检"
                          onClick={(event) => {
                            event.stopPropagation()
                            openDiagnosis(instance.id)
                          }}
                        >
                          <Stethoscope size={15} />
                        </IconButton>
                        <IconButton
                          label="启动设置"
                          disabled={isRunning}
                          onClick={(event) => {
                            event.stopPropagation()
                            setSettingsInstance(instance)
                          }}
                        >
                          <Settings2 size={15} />
                        </IconButton>
                        <IconButton
                          label="删除实例"
                          tone="danger"
                          disabled={isRunning}
                          onClick={(event) => {
                            event.stopPropagation()
                            setPendingDelete(instance)
                          }}
                        >
                          <Trash2 size={15} />
                        </IconButton>
                      </span>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="instances-body">
          <div className="discover-bar">
            <form
              className="text-input discover-search"
              onSubmit={(event) => {
                event.preventDefault()
                void runSearch(query, 0, false)
              }}
            >
              <Search size={16} />
              <input
                value={query}
                placeholder="搜索整合包，支持中文或简写，例如 优化、空岛、冒险"
                onChange={(event) => setQuery(event.target.value)}
                spellCheck={false}
              />
              {query && (
                <button
                  type="button"
                  className="discover-search-clear"
                  aria-label="清空搜索"
                  onClick={() => setQuery('')}
                >
                  <X size={14} />
                </button>
              )}
            </form>
            <span className="discover-count">
              {searching ? '正在搜索…' : searchError ? '搜索失败' : `共 ${formatCount(totalHits)} 个整合包`}
            </span>
          </div>

          {searchError && (
            <div className="discover-error card">
              <span>{searchError}</span>
              <button
                type="button"
                className="button button--soft button--sm"
                onClick={() => void runSearch(query, 0, false)}
              >
                <RefreshCw size={14} />
                重试
              </button>
            </div>
          )}

          {searching && hits.length === 0 ? (
            <div className="instances-loading card">
              <Spinner size={18} />
              正在从 Modrinth 获取整合包…
            </div>
          ) : !searchError && hits.length === 0 && !searching ? (
            <div className="card instances-empty">
              <EmptyState
                icon={<Search size={26} />}
                title={`没有找到「${query}」相关的整合包`}
                description="换一个关键词试试，或者清空搜索看看热门整合包。"
              />
            </div>
          ) : (
            <>
              <div className="discover-list">
                {hits.map((project) => {
                  const task = taskForProject(project.projectId)
                  const gameVersion = latestGameVersion(project.gameVersions)
                  const loaders = project.categories.filter((category) =>
                    KNOWN_LOADERS.includes(category.toLowerCase())
                  )
                  const supported =
                    loaders.length === 0 ||
                    loaders.some((loader) =>
                      ['fabric', 'quilt', 'forge', 'neoforge'].includes(loader.toLowerCase())
                    )
                  return (
                    <article key={project.projectId} className="discover-card card">
                      <span className="discover-icon">
                        {project.iconUrl ? (
                          <RemoteIcon url={project.iconUrl} fallback={<Boxes size={26} />} />
                        ) : (
                          <Boxes size={26} />
                        )}
                      </span>
                      <div className="discover-body">
                        <div className="discover-head">
                          <strong title={project.title}>
                            {project.localizedName ?? project.title}
                          </strong>
                          <span>by {project.author}</span>
                        </div>
                        <p>{project.description || '这个整合包还没有填写简介。'}</p>
                        <div className="discover-tags">
                          {loaders.map((loader) => (
                            <span
                              key={loader}
                              className={`loader-tag loader-tag--${loaderKind(loader)}`}
                            >
                              {loaderLabel(loader)}
                            </span>
                          ))}
                          {gameVersion && (
                            <span className="type-tag type-tag--release">支持至 {gameVersion}</span>
                          )}
                          <span className="instance-tag-muted">
                            {formatCount(project.downloads)} 次下载
                          </span>
                        </div>
                      </div>
                      <div className="discover-actions">
                        <button
                          type="button"
                          className="button button--primary button--sm"
                          disabled={Boolean(task) || !supported}
                          title={supported ? undefined : '目前支持 Fabric / Quilt / Forge / NeoForge 整合包'}
                          onClick={() => void installModrinth(project)}
                        >
                          {task ? (
                            <Spinner size={13} />
                          ) : !supported ? (
                            <X size={13} />
                          ) : (
                            <Download size={14} />
                          )}
                          {task ? '安装中' : supported ? '安装' : '暂不支持'}
                        </button>
                        <IconButton label="快速预览" onClick={() => setPreview(project)}>
                          <Info size={15} />
                        </IconButton>
                        <IconButton label="在 Modrinth 查看" onClick={() => openProject(project)}>
                          <ExternalLink size={15} />
                        </IconButton>
                      </div>
                    </article>
                  )
                })}
              </div>

              <div className="discover-footer">
                <span>
                  已显示 {hits.length} / {formatCount(totalHits)}
                </span>
                {hits.length < Math.min(totalHits, 5000) && (
                  <button
                    type="button"
                    className="button button--soft button--sm"
                    disabled={searchingMore}
                    onClick={() => void runSearch(query, offset, true)}
                  >
                    {searchingMore && <Spinner size={13} />}
                    加载更多
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      <Modal
        open={preview !== null}
        onClose={() => setPreview(null)}
        title={preview ? preview.localizedName ?? preview.title : '整合包预览'}
        subtitle={
          preview
            ? `by ${preview.author}${
                preview.localizedName ? ` · ${preview.title}` : ''
              }`
            : undefined
        }
        icon={<PackagePlus size={18} />}
        size="md"
      >
        {preview && (
          <div className="modpack-preview">
            <div className="modpack-preview-head">
              <span className="modpack-preview-icon">
                <RemoteIcon url={preview.iconUrl} fallback={<Boxes size={26} />} />
              </span>
              <div className="modpack-preview-stats">
                <span>{formatCount(preview.downloads)} 次下载</span>
                <span>{preview.gameVersions.slice(-1)[0] ?? '未知版本'}</span>
              </div>
            </div>
            <p className="modpack-preview-desc">
              {preview.description || '这个整合包还没有填写简介。'}
            </p>
            <div className="modpack-preview-tags">
              {previewLoaders.map((loader) => (
                <span key={loader} className={`loader-tag loader-tag--${loaderKind(loader)}`}>
                  {loaderLabel(loader)}
                </span>
              ))}
              {preview.gameVersions.slice(-6).map((version) => (
                <span key={version} className="type-tag type-tag--release">
                  {version}
                </span>
              ))}
            </div>
            <div className="modpack-preview-actions">
              <button
                type="button"
                className="button button--primary button--sm"
                disabled={!previewSupported}
                onClick={() => {
                  const project = preview
                  setPreview(null)
                  void installModrinth(project)
                }}
              >
                <Download size={13} />
                {previewSupported ? '安装这个整合包' : '加载器暂不支持'}
              </button>
              <button
                type="button"
                className="button button--soft button--sm"
                onClick={() => openProject(preview)}
              >
                <ExternalLink size={13} />
                在 Modrinth 查看
              </button>
            </div>
          </div>
        )}
      </Modal>

      <LocalPacksModal open={localPacksOpen} onClose={() => setLocalPacksOpen(false)} />
      <VanillaInstanceModal open={vanillaOpen} onClose={() => setVanillaOpen(false)} />
      <BackupManagerModal
        open={backupInstance !== null}
        initialInstanceId={backupInstance?.id ?? null}
        onClose={() => setBackupInstance(null)}
      />
      <InstanceContentModal
        open={contentInstance !== null}
        instance={contentInstance}
        initialTab={contentInitialTab}
        onClose={() => setContentInstance(null)}
      />

      <WorldVaultModal
        open={worldInstance !== null}
        instance={worldInstance}
        onClose={() => setWorldInstance(null)}
      />

      <ScreenshotGalleryModal
        instance={screenshotInstance}
        onClose={() => setScreenshotInstance(null)}
      />

      <InstanceTransferModal
        instance={transferInstance}
        onClose={() => setTransferInstance(null)}
      />

      <ServerPackModal
        instance={serverPackInstance}
        onClose={() => setServerPackInstance(null)}
      />

      <PackWorkshopModal
        instance={workshopInstance}
        onClose={() => setWorkshopInstance(null)}
      />


      <InstanceSettingsModal
        open={settingsInstance !== null}
        instance={settingsInstance}
        globalMemoryMb={settings?.maxMemoryMb ?? 8192}
        onClose={() => setSettingsInstance(null)}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除实例"
        message={
          pendingDelete?.external ? (
            <>
              将从风信实例列表移除 <strong>{pendingDelete.name}</strong>。
              <br />
              外部目录 <strong>{pendingDelete.external.gameDir}</strong> 中的游戏文件、模组与存档不会被删除。
            </>
          ) : pendingDelete?.loader === 'vanilla' ? (
            <>
              将删除实例 <strong>{pendingDelete.name}</strong> 及其模组、配置与存档。
              <br />
              原版版本 <strong>{pendingDelete.gameVersion}</strong> 的游戏文件会被保留，可在版本管理中清理；backups/worlds 存档备份会一并删除。
            </>
          ) : (
            <>
              将删除实例 <strong>{pendingDelete?.name}</strong> 及其模组、配置与存档。
              <br />
              该实例专用、且不再被其他实例或已安装启动档案使用的原版与加载器版本会自动清理；共享的 libraries、assets、Java 运行时以及仍被引用的版本会保留。backups/worlds 存档备份会一并删除。
            </> 
          )
        }
        confirmLabel="删除实例"
        danger
        busy={deleting}
        onConfirm={() => void handleDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}
