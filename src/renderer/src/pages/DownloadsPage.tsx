import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Boxes,
  ChevronRight,
  Download,
  ExternalLink,
  FolderOpen,
  FolderSearch,
  Gamepad2,
  Globe,
  Layers,
  Package,
  RefreshCw,
  Search,
  Server,
  Sparkles
} from 'lucide-react'
import type {
  ContentProvider,
  CurseForgeModpackFileScope,
  DownloadSource,
  InstanceSummary,
  LoaderVersionView,
  ManualModDownload,
  ModpackVersionView,
  ModProjectView,
  ModVersionView,
  ModrinthProjectView,
  VersionSummary
} from '@shared/types'
import { useLauncher } from '../store'
import {
  cleanError,
  formatBytes,
  formatCount,
  formatDate,
  loaderKind,
  loaderLabel,
  versionTypeLabel
} from '../lib/format'
import { Badge, EmptyState, IconButton, Modal, ProgressBar, Segmented, Spinner } from '../components/ui'
import { BlockIcon } from '../components/visuals'
import { RemoteIcon } from '../components/RemoteIcon'
import { ModsModal } from '../components/ModsModal'
import { ModVersionModal } from '../components/ModVersionModal'
import type { ModVersionActionOptions, ModVersionTarget } from '../components/ModVersionModal'
import { ModGameVersionPicker } from '../components/ModGameVersionPicker'
import type { ModGameVersionSelection } from '../components/ModGameVersionPicker'
import type { ContentKind } from '@shared/types'
import { LocalPacksModal } from '../components/LocalPacksModal'
import {
  MERGED_PAGE_SIZE,
  searchDualSource,
  searchProviderLabel,
  type DualSearchSourceError
} from '../lib/mergedSearch'

type Mode = 'game' | 'modpack' | 'mods' | 'datapack' | 'resourcepack' | 'shader'
type ContentMode = 'mods' | 'datapack' | 'resourcepack' | 'shader'
type ModSearchProvider = ContentProvider | 'all'

const CONTENT_KIND: Record<ContentMode, ContentKind> = {
  mods: 'mod',
  datapack: 'datapack',
  resourcepack: 'resourcepack',
  shader: 'shader'
}

const CONTENT_LABEL: Record<ContentMode, string> = {
  mods: '模组',
  datapack: '数据包',
  resourcepack: '资源包',
  shader: '光影包'
}

function isContentMode(mode: Mode): mode is ContentMode {
  return mode === 'mods' || mode === 'datapack' || mode === 'resourcepack' || mode === 'shader'
}
type Category = 'release' | 'snapshot' | 'old' | 'all'
type LoaderChoice = 'none' | 'fabric' | 'quilt' | 'forge' | 'neoforge' | 'optifine'

const CATEGORIES: { value: Category; label: string }[] = [
  { value: 'release', label: '正式版' },
  { value: 'snapshot', label: '快照' },
  { value: 'old', label: '远古' },
  { value: 'all', label: '全部' }
]

const LOADERS: { value: LoaderChoice; label: string }[] = [
  { value: 'none', label: '原版' },
  { value: 'fabric', label: 'Fabric' },
  { value: 'quilt', label: 'Quilt' },
  { value: 'forge', label: 'Forge' },
  { value: 'neoforge', label: 'NeoForge' }
]

function categoryOf(version: VersionSummary): Category {
  if (version.type === 'snapshot') return 'snapshot'
  if (version.type === 'old_beta' || version.type === 'old_alpha') return 'old'
  return 'release'
}

function groupOf(id: string): string {
  const match = id.match(/^(\d+\.\d+)/)
  return match ? `${match[1]}.x` : id
}

export function DownloadsPage() {
  const settings = useLauncher((state) => state.settings)
  const manifest = useLauncher((state) => state.manifest)
  const manifestLoading = useLauncher((state) => state.manifestLoading)
  const manifestError = useLauncher((state) => state.manifestError)
  const installed = useLauncher((state) => state.installed)
  const instances = useLauncher((state) => state.instances)
  const instancesLoading = useLauncher((state) => state.instancesLoading)
  const tasks = useLauncher((state) => state.tasks)
  const loadManifest = useLauncher((state) => state.loadManifest)
  const patchSettings = useLauncher((state) => state.patchSettings)
  const installVersion = useLauncher((state) => state.installVersion)
  const createLoaderInstance = useLauncher((state) => state.createLoaderInstance)
  const createVanillaInstance = useLauncher((state) => state.createVanillaInstance)
  const installModrinth = useLauncher((state) => state.installModrinth)
  const installCurseForgePack = useLauncher((state) => state.installCurseForgePack)
  const downloadCurseForgeServerPack = useLauncher(
    (state) => state.downloadCurseForgeServerPack
  )
  const importModpack = useLauncher((state) => state.importModpack)
  const cancelTask = useLauncher((state) => state.cancelTask)
  const toast = useLauncher((state) => state.toast)

  const [mode, setMode] = useState<Mode>('game')
  const [category, setCategory] = useState<Category>('release')
  const [query, setQuery] = useState('')
  const [visibleCount, setVisibleCount] = useState(60)
  const [selectedGame, setSelectedGame] = useState<string | null>(null)
  const [loaderChoice, setLoaderChoice] = useState<LoaderChoice>('none')
  const [loaderVersion, setLoaderVersion] = useState('')

  const [packQuery, setPackQuery] = useState('')
  const [packVersion, setPackVersion] = useState('')
  const [packSource, setPackSource] = useState<ModSearchProvider>('all')
  const [packType, setPackType] = useState('all')
  const [packLoader, setPackLoader] = useState('all')
  const [packHits, setPackHits] = useState<ModrinthProjectView[]>([])
  const [packTotal, setPackTotal] = useState(0)
  const [packHasMore, setPackHasMore] = useState(false)
  const [packSourceTotals, setPackSourceTotals] = useState<Record<
    ContentProvider,
    number
  > | null>(null)
  const [packSourceErrors, setPackSourceErrors] = useState<DualSearchSourceError[]>([])
  const [packOffset, setPackOffset] = useState(0)
  const [packLoading, setPackLoading] = useState(false)
  const [packLoadingMore, setPackLoadingMore] = useState(false)
  const [packError, setPackError] = useState('')
  const packSearchSeq = useRef(0)
  const [modsInstance, setModsInstance] = useState<InstanceSummary | null>(null)
  const [localPacksOpen, setLocalPacksOpen] = useState(false)

  const [versionProject, setVersionProject] = useState<ModrinthProjectView | null>(null)
  const [versionScope, setVersionScope] = useState<CurseForgeModpackFileScope>('client')
  const [packVersions, setPackVersions] = useState<ModpackVersionView[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [versionsError, setVersionsError] = useState('')
  const [chosenVersionId, setChosenVersionId] = useState<string | null>(null)

  const [loaderVersions, setLoaderVersions] = useState<LoaderVersionView[]>([])
  const [loaderVersionsLoading, setLoaderVersionsLoading] = useState(false)
  const [loaderVersionsError, setLoaderVersionsError] = useState('')
  const [optifineVersions, setOptiFineVersions] = useState<LoaderVersionView[]>([])
  const [optifineLoading, setOptiFineLoading] = useState(false)
  const [optifineError, setOptiFineError] = useState('')
  const [optifineRetry, setOptiFineRetry] = useState(0)
  const optifineCache = useRef(
    new Map<string, { at: number; versions: LoaderVersionView[]; error?: string }>()
  )

  const [modProvider, setModProvider] = useState<ModSearchProvider>('all')
  const [modGameVersion, setModGameVersion] = useState('')
  const [modPresetInstanceId, setModPresetInstanceId] = useState<string | null>(null)
  const [modFilterInitialized, setModFilterInitialized] = useState(false)
  const [modLoader, setModLoader] = useState('fabric')
  const [modQuery, setModQuery] = useState('')
  const [modHits, setModHits] = useState<ModProjectView[]>([])
  const [modTotal, setModTotal] = useState(0)
  const [modHasMore, setModHasMore] = useState(false)
  const [modSourceTotals, setModSourceTotals] = useState<Record<
    ContentProvider,
    number
  > | null>(null)
  const [modSourceErrors, setModSourceErrors] = useState<DualSearchSourceError[]>([])
  const [modAltTotal, setModAltTotal] = useState<{
    provider: ContentProvider
    total: number
  } | null>(null)
  const [modOffset, setModOffset] = useState(0)
  const [modLoading, setModLoading] = useState(false)
  const [modLoadingMore, setModLoadingMore] = useState(false)
  const [modError, setModError] = useState('')
  const [modVersionProject, setModVersionProject] = useState<ModProjectView | null>(null)
  const [modBusyVersion, setModBusyVersion] = useState<string | null>(null)
  const [modManual, setModManual] = useState<ManualModDownload[]>([])
  const [downloadedFiles, setDownloadedFiles] = useState<string[]>([])
  const modSearchSeq = useRef(0)

  const source = settings?.source ?? 'mirror'
  const installedIds = useMemo(() => new Set(installed.map((version) => version.id)), [installed])

  useEffect(() => {
    if (!settings) return
    if (!manifest) void loadManifest()
    else if (manifest.source !== settings.source) void loadManifest(true)
  }, [settings, manifest, loadManifest])

  useEffect(() => {
    setVisibleCount(60)
  }, [category, query])

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return (manifest?.versions ?? []).filter((version) => {
      if (category !== 'all' && categoryOf(version) !== category) return false
      if (keyword && !version.id.toLowerCase().includes(keyword)) return false
      return true
    })
  }, [manifest, category, query])

  const latest = manifest?.latest.release ?? null
  const effectiveSelected =
    selectedGame ?? (latest && filtered.some((version) => version.id === latest) ? latest : filtered[0]?.id ?? null)
  const selectedEntry = filtered.find((version) => version.id === effectiveSelected) ?? null
  const visible = filtered.slice(0, visibleCount)
  const remaining = filtered.length - visible.length
  const installedSelected = effectiveSelected ? installedIds.has(effectiveSelected) : false
  const installedEntry = effectiveSelected
    ? installed.find((version) => version.id === effectiveSelected)
    : undefined
  const installedReady = Boolean(installedEntry?.hasJar)
  const loaderMatches = effectiveSelected
    ? instances.filter(
        (instance) =>
          instance.gameVersion === effectiveSelected &&
          (loaderChoice === 'none'
            ? instance.loader === 'vanilla'
            : instance.loader === loaderChoice)
      )
    : []
  const selectedInstance = loaderMatches[0] ?? null
  const installTask = effectiveSelected
    ? tasks.find(
        (task) =>
          task.kind === 'install' &&
          task.versionId === effectiveSelected &&
          (task.status === 'running' || task.status === 'paused')
      )
    : undefined
  const loaderTaskTitle = effectiveSelected
    ? loaderChoice === 'none'
      ? `创建原版 ${effectiveSelected} 实例`
      : `创建 ${loaderLabel(loaderChoice)} ${effectiveSelected} 实例`
    : null
  const loaderTask = loaderTaskTitle
    ? tasks.find(
        (task) =>
          task.kind === 'instance' &&
          task.title === loaderTaskTitle &&
          (task.status === 'running' || task.status === 'paused')
      )
    : undefined
  const activeTask = installTask ?? loaderTask

  const versionGroups = useMemo(
    () => [...new Set((manifest?.versions ?? []).map((version) => groupOf(version.id)))].slice(0, 20),
    [manifest]
  )

  const runPackSearch = async (append = false) => {
    const sequence = ++packSearchSeq.current
    if (append) {
      setPackLoadingMore(true)
    } else {
      setPackLoading(true)
      setPackLoadingMore(false)
      setPackHasMore(false)
      setPackSourceTotals(null)
      setPackSourceErrors([])
    }
    setPackError('')
    const offset = append ? packOffset : 0
    const loader = packLoader === 'all' ? '' : packLoader
    try {
      if (packSource === 'all') {
        const result = await searchDualSource(
          offset,
          append ? packHits : [],
          (source, sourceOffset) =>
            source === 'curseforge'
              ? window.ccl.curseforge.searchModpacks(
                  packQuery,
                  packVersion.trim(),
                  loader,
                  sourceOffset
                )
              : window.ccl.modrinth.search(packQuery, sourceOffset)
        )
        if (sequence !== packSearchSeq.current) return
        setPackHits(result.hits)
        setPackTotal(result.totalHits)
        setPackHasMore(result.hasMore)
        setPackSourceTotals(result.sourceTotals)
        setPackSourceErrors(result.errors)
        setPackOffset(offset + MERGED_PAGE_SIZE)
        if (result.errors.length === 2) {
          setPackError(
            result.errors
              .map((item) => `${searchProviderLabel(item.provider)}：${item.message}`)
              .join('；')
          )
        }
      } else {
        const result =
          packSource === 'curseforge'
            ? await window.ccl.curseforge.searchModpacks(
                packQuery,
                packVersion.trim(),
                loader,
                offset
              )
            : await window.ccl.modrinth.search(packQuery, offset)
        if (sequence !== packSearchSeq.current) return
        setPackHits((previous) => {
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
        setPackTotal(result.totalHits)
        setPackHasMore(
          (result.nextOffset ?? offset + result.hits.length) < result.totalHits
        )
        setPackSourceTotals({
          modrinth: packSource === 'modrinth' ? result.totalHits : 0,
          curseforge: packSource === 'curseforge' ? result.totalHits : 0
        })
        setPackSourceErrors([])
        setPackOffset(result.nextOffset ?? offset + result.hits.length)
      }
    } catch (error) {
      if (sequence !== packSearchSeq.current) return
      if (!append) {
        setPackHits([])
        setPackTotal(0)
        setPackHasMore(false)
        setPackOffset(0)
      }
      setPackSourceTotals(null)
      setPackSourceErrors([])
      setPackError(cleanError(error))
    } finally {
      if (sequence === packSearchSeq.current) {
        setPackLoading(false)
        setPackLoadingMore(false)
      }
    }
  }

  useEffect(() => {
    if (mode === 'modpack' && packHits.length === 0 && !packLoading && !packError) {
      void runPackSearch()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  const filteredPacks = useMemo(
    () =>
      packHits.filter((project) => {
        if (packType !== 'all' && packType !== 'modpack') return false
        if (packLoader !== 'all') {
          if (!project.categories.some((category) => category.toLowerCase() === packLoader)) return false
        }
        if (packVersion.trim()) {
          const wanted = packVersion.trim().toLowerCase()
          if (!project.gameVersions.some((version) => version.toLowerCase().includes(wanted))) {
            return false
          }
        }
        return true
      }),
    [packHits, packVersion, packType, packLoader]
  )

  useEffect(() => {
    if (mode !== 'game' || !effectiveSelected) {
      setOptiFineVersions([])
      setOptiFineError('')
      setOptiFineLoading(false)
      return
    }
    const key = effectiveSelected
    const cached = optifineCache.current.get(key)
    if (cached && Date.now() - cached.at < 5 * 60_000) {
      setOptiFineVersions(cached.versions)
      setOptiFineError(cached.error ?? '')
      setOptiFineLoading(false)
      return
    }
    let alive = true
    setOptiFineLoading(true)
    setOptiFineError('')
    setOptiFineVersions([])
    window.ccl.instances
      .loaderVersions(key, 'optifine')
      .then((list) => {
        if (!alive) return
        setOptiFineVersions(list)
        optifineCache.current.set(key, { at: Date.now(), versions: list })
      })
      .catch((error) => {
        if (!alive) return
        const message = cleanError(error)
        setOptiFineError(message)
        optifineCache.current.set(key, { at: Date.now(), versions: [], error: message })
      })
      .finally(() => {
        if (alive) setOptiFineLoading(false)
      })
    return () => {
      alive = false
    }
  }, [effectiveSelected, optifineRetry, mode])

  useEffect(() => {
    if (!effectiveSelected || loaderChoice === 'none') {
      setLoaderVersions([])
      setLoaderVersionsError('')
      return
    }
    if (loaderChoice === 'optifine') {
      const cached = optifineCache.current.get(effectiveSelected)
      if (cached && !cached.error && cached.versions.length > 0) {
        setLoaderVersions(cached.versions)
        setLoaderVersionsError('')
        setLoaderVersionsLoading(false)
        setLoaderVersion(cached.versions[0]?.version ?? '')
        return
      }
    }
    let alive = true
    setLoaderVersionsLoading(true)
    setLoaderVersionsError('')
    window.ccl.instances
      .loaderVersions(effectiveSelected, loaderChoice)
      .then((list) => {
        if (!alive) return
        setLoaderVersions(list)
        setLoaderVersion(list[0]?.version ?? '')
      })
      .catch((error) => {
        if (!alive) return
        setLoaderVersions([])
        setLoaderVersionsError(cleanError(error))
      })
      .finally(() => {
        if (alive) setLoaderVersionsLoading(false)
      })
    return () => {
      alive = false
    }
  }, [effectiveSelected, loaderChoice])

  useEffect(() => {
    if (!isContentMode(mode) || modFilterInitialized) return
    if (instancesLoading || manifestLoading) return
    const preferred =
      (mode === 'mods'
        ? instances.find((instance) => instance.loader !== 'vanilla')
        : null) ?? instances[0] ?? null
    if (preferred) {
      setModGameVersion(preferred.gameVersion)
      if (preferred.loader !== 'vanilla') {
        setModPresetInstanceId(preferred.id)
        setModLoader(preferred.loader)
      } else {
        setModPresetInstanceId(null)
      }
      setModFilterInitialized(true)
      return
    }
    if (latest) {
      setModGameVersion(latest)
      setModFilterInitialized(true)
    }
  }, [
    mode,
    modFilterInitialized,
    instances,
    instancesLoading,
    manifestLoading,
    latest
  ])

  useEffect(() => {
    if (!isContentMode(mode) || !modGameVersion) return
    void runModSearch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, modGameVersion, modLoader, modProvider])

  const openPackVersions = async (
    project: ModrinthProjectView,
    scope: CurseForgeModpackFileScope = 'client'
  ) => {
    setVersionProject(project)
    setVersionScope(scope)
    setChosenVersionId(null)
    setPackVersions([])
    setVersionsError('')
    setVersionsLoading(true)
    try {
      const list =
        project.provider === 'curseforge'
          ? await window.ccl.curseforge.modpackVersions(project.projectId, scope)
          : await window.ccl.modrinth.versions(project.projectId)
      setPackVersions(list)
      setChosenVersionId(list[0]?.id ?? null)
    } catch (error) {
      setVersionsError(cleanError(error))
    } finally {
      setVersionsLoading(false)
    }
  }

  const installChosenVersion = () => {
    if (!versionProject || !chosenVersionId) return
    const project = versionProject
    const versionId = chosenVersionId
    setVersionProject(null)
    if (project.provider === 'curseforge') {
      if (versionScope === 'server') {
        void downloadCurseForgeServerPack(project, versionId)
      } else {
        void installCurseForgePack(project, versionId)
      }
    } else {
      void installModrinth(project, versionId)
    }
  }

  const runModSearch = async (
    append = false,
    overrides?: { game?: string; kind?: ContentKind; provider?: ModSearchProvider }
  ) => {
    const game = overrides?.game ?? modGameVersion
    const kind = overrides?.kind ?? (isContentMode(mode) ? CONTENT_KIND[mode] : 'mod')
    const provider = overrides?.provider ?? modProvider
    if (!game) return
    const sequence = ++modSearchSeq.current
    if (append) {
      setModLoadingMore(true)
    } else {
      setModLoading(true)
      setModLoadingMore(false)
      setModHits([])
      setModTotal(0)
      setModHasMore(false)
      setModSourceTotals(null)
      setModSourceErrors([])
      setModAltTotal(null)
      setModOffset(0)
      setModManual([])
      setDownloadedFiles([])
    }
    setModError('')
    const offset = append ? modOffset : 0
    const loader = kind === 'mod' ? modLoader : ''
    try {
      if (provider === 'all') {
        const result = await searchDualSource(
          offset,
          append ? modHits : [],
          (source, sourceOffset) =>
            window.ccl.mods.searchCatalog(
              source,
              modQuery,
              game,
              loader,
              sourceOffset,
              kind
            )
        )
        if (sequence !== modSearchSeq.current) return
        setModHits(result.hits)
        setModTotal(result.totalHits)
        setModSourceTotals(result.sourceTotals)
        setModSourceErrors(result.errors)
        setModHasMore(result.hasMore)
        setModOffset(offset + MERGED_PAGE_SIZE)
        if (result.errors.length === 2) {
          setModError(
            result.errors
              .map((item) => `${searchProviderLabel(item.provider)}：${item.message}`)
              .join('；')
          )
        }
      } else {
        const result = await window.ccl.mods.searchCatalog(
          provider,
          modQuery,
          game,
          loader,
          offset,
          kind
        )
        if (sequence !== modSearchSeq.current) return
        setModHits((previous) => {
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
        setModTotal(result.totalHits)
        setModHasMore(
          (result.nextOffset ?? offset + result.hits.length) < result.totalHits
        )
        setModSourceTotals({
          modrinth: provider === 'modrinth' ? result.totalHits : 0,
          curseforge: provider === 'curseforge' ? result.totalHits : 0
        })
        setModSourceErrors([])
        setModOffset(result.nextOffset ?? offset + result.hits.length)
        if (!append) {
          const alternative: ContentProvider =
            provider === 'modrinth' ? 'curseforge' : 'modrinth'
          void window.ccl.mods
            .searchCatalog(alternative, modQuery, game, loader, 0, kind)
            .then((other) => {
              if (sequence !== modSearchSeq.current) return
              setModAltTotal({ provider: alternative, total: other.totalHits })
            })
            .catch(() => {
              if (sequence === modSearchSeq.current) setModAltTotal(null)
            })
        }
      }
    } catch (error) {
      if (sequence !== modSearchSeq.current) return
      if (!append) {
        setModHits([])
        setModTotal(0)
        setModHasMore(false)
        setModOffset(0)
      }
      setModSourceTotals(null)
      setModSourceErrors([])
      setModError(cleanError(error))
    } finally {
      if (sequence === modSearchSeq.current) {
        setModLoading(false)
        setModLoadingMore(false)
      }
    }
  }

  const openModVersions = (project: ModProjectView) => {
    setModManual([])
    setDownloadedFiles([])
    setModVersionProject(project)
  }

  const handleContentMode = (next: ContentMode) => {
    setMode(next)
    setModHits([])
    setModTotal(0)
    setModHasMore(false)
    setModSourceTotals(null)
    setModSourceErrors([])
    setModAltTotal(null)
    setModOffset(0)
    setModError('')
    setModManual([])
    setModVersionProject(null)
  }

  const selectModGameVersion = (selection: ModGameVersionSelection) => {
    setModFilterInitialized(true)
    setModPresetInstanceId(selection.instanceId)
    setModGameVersion(selection.gameVersion)
    if (selection.loader) setModLoader(selection.loader)
  }

  const changeModLoader = (next: string) => {
    setModFilterInitialized(true)
    setModLoader(next)
    setModPresetInstanceId(null)
  }

  const downloadModVersion = async (
    version: ModVersionView,
    target: ModVersionTarget,
    options: ModVersionActionOptions
  ) => {
    setModBusyVersion(version.id)
    setModManual([])
    setDownloadedFiles([])
    try {
      const kind = isContentMode(mode) ? CONTENT_KIND[mode] : 'mod'
      const result = await window.ccl.mods.download({
        provider: target.provider,
        projectId: target.projectId,
        gameVersion: modGameVersion,
        loader: kind === 'mod' ? modLoader : '',
        versionId: version.id,
        kind,
        includeDependencies: options.includeDependencies
      })
      if (result.files.length > 0) {
        setDownloadedFiles(result.files)
        toast(
          'success',
          result.files.length > 1
            ? `已下载 ${result.files.length} 个文件（含前置）`
            : `${isContentMode(mode) ? CONTENT_LABEL[mode] : '模组'}已下载`,
          result.files[0]
        )
      }
      if (result.manual.length > 0) setModManual(result.manual)
      setModVersionProject(null)
    } catch (error) {
      toast('error', '无法下载模组', cleanError(error))
    } finally {
      setModBusyVersion(null)
    }
  }

  const taskForProject = (projectId: string) =>
    tasks.find(
      (task) =>
        task.kind === 'modpack' &&
        task.projectId === projectId &&
        (task.status === 'running' || task.status === 'paused')
    )

  const handleSourceChange = async (next: DownloadSource) => {
    if (next === source) return
    const updated = await patchSettings({ source: next })
    if (updated) {
      await loadManifest(true)
      toast('info', next === 'mirror' ? '已切换到 BMCLAPI 镜像源' : '已切换到官方下载源')
    }
  }

  const startGameInstall = () => {
    if (!effectiveSelected || activeTask) return
    // 原版同样创建独立实例，才能把 mods/config/saves 与其它实例隔开；
    // 游戏文件本身仍然是版本文件夹里共享的一份。
    if (loaderChoice === 'none') {
      void createVanillaInstance({ gameVersion: effectiveSelected })
      return
    }
    // 同一个 Minecraft + 加载器版本可以创建多个实例；
    // 它们复用加载器运行库，但 mods/config/saves 彼此独立。
    void createLoaderInstance({
      gameVersion: effectiveSelected,
      loader: loaderChoice,
      loaderVersion: loaderVersion.trim() || null
    })
  }

  const resetPackFilters = () => {
    setPackQuery('')
    setPackVersion('')
    setPackSource('all')
    setPackType('all')
    setPackLoader('all')
    setPackHasMore(false)
    setPackSourceTotals(null)
    setPackSourceErrors([])
    setPackError('')
  }

  return (
    <div className="page page--downloads-hub">
      <header className="page-head downloads-head">
        <div className="page-head-copy">
          <span className="page-eyebrow">
            <Download size={14} />
            下载中心
          </span>
          <h1>获取内容</h1>
          <p>原版、加载器、整合包和模组，在这里一次准备好。</p>
        </div>
        <div className="downloads-head-actions">
          <div className="source-control">
            <span className="source-control-label">
              <Globe size={13} />
              下载源
            </span>
            <Segmented
              size="sm"
              value={source}
              options={[
                { value: 'mirror', label: 'BMCLAPI 镜像' },
                { value: 'official', label: '官方源' }
              ]}
              onChange={(value) => void handleSourceChange(value)}
            />
          </div>
          <IconButton label="刷新版本列表" tone="soft" onClick={() => void loadManifest(true)}>
            <RefreshCw size={15} className={manifestLoading ? 'spin' : ''} />
          </IconButton>
        </div>
      </header>

      <div className="downloads-hub">
        <nav className="downloads-nav" aria-label="下载分类">
          <span className="downloads-nav-title">社区资源</span>
          <button type="button" className={mode === 'game' ? 'is-active' : ''} onClick={() => setMode('game')}>
            <Gamepad2 size={15} />
            原版游戏
          </button>
          <button type="button" className={mode === 'modpack' ? 'is-active' : ''} onClick={() => setMode('modpack')}>
            <Boxes size={15} />
            整合包
          </button>
          <button type="button" className={mode === 'mods' ? 'is-active' : ''} onClick={() => handleContentMode('mods')}>
            <Package size={15} />
            Mod
          </button>
          <button type="button" className={mode === 'datapack' ? 'is-active' : ''} onClick={() => handleContentMode('datapack')}>
            <Layers size={15} />
            数据包
          </button>
          <button type="button" className={mode === 'resourcepack' ? 'is-active' : ''} onClick={() => handleContentMode('resourcepack')}>
            <Layers size={15} />
            资源包
          </button>
          <button type="button" className={mode === 'shader' ? 'is-active' : ''} onClick={() => handleContentMode('shader')}>
            <Sparkles size={15} />
            光影包
          </button>
        </nav>

        <div className="downloads-content">
          {mode === 'game' && (
            <>
              {manifestError && !manifest && (
                <div className="downloads-error card">
                  <AlertTriangle size={20} />
                  <div>
                    <h3>无法获取版本列表</h3>
                    <p>{manifestError}</p>
                  </div>
                  <button type="button" className="button button--primary" onClick={() => void loadManifest(true)}>
                    重试
                  </button>
                </div>
              )}

              {!manifest && manifestLoading && (
                <div className="downloads-loading card">
                  <Spinner size={18} />
                  正在同步 Mojang 版本列表…
                </div>
              )}

              {manifest && (
                <div className="game-install-layout">
                  <section className="game-version-panel card">
                    <div className="game-version-head">
                      <span>选择版本</span>
                      <span>{filtered.length}</span>
                    </div>
                    <div className="game-version-tools">
                      <Segmented size="sm" value={category} options={CATEGORIES} onChange={setCategory} />
                      <div className="text-input">
                        <Search size={14} />
                        <input
                          value={query}
                          placeholder="搜索版本"
                          onChange={(event) => setQuery(event.target.value)}
                        />
                      </div>
                    </div>
                    <div className="game-version-list">
                      {visible.map((version) => (
                        <button
                          key={version.id}
                          type="button"
                          className={`game-version-row ${version.id === effectiveSelected ? 'is-selected' : ''}`}
                          onClick={() => {
                            setSelectedGame(version.id)
                            setLoaderChoice('none')
                          }}
                        >
                          <BlockIcon type={version.type} size={30} />
                          <span>
                            <strong>{version.id}</strong>
                            <small>
                              {versionTypeLabel(version.type)} · {formatDate(version.releaseTime)}
                            </small>
                          </span>
                          {installedIds.has(version.id) && <Badge tone="success">已装</Badge>}
                        </button>
                      ))}
                      {remaining > 0 && (
                        <button
                          type="button"
                          className="load-more"
                          onClick={() => setVisibleCount((count) => count + 80)}
                        >
                          加载更多 <span>还有 {remaining} 个</span>
                        </button>
                      )}
                    </div>
                  </section>

                  <section className="game-install-panel card">
                    {selectedEntry ? (
                      <>
                        <div className="game-install-head">
                          <BlockIcon type={selectedEntry.type} size={44} />
                          <div>
                            <h2>{selectedEntry.id}</h2>
                            <p>
                              {versionTypeLabel(selectedEntry.type)} · {formatDate(selectedEntry.releaseTime)}
                              {selectedEntry.id === latest ? ' · 最新正式版' : ''}
                            </p>
                          </div>
                        </div>

                        <div className="game-loader-section">
                          <div className="game-loader-head">
                            <span>实例类型</span>
                            <span>原版与加载器都会创建独立实例</span>
                          </div>
                          <div className="game-loader-list">
                            {LOADERS.map((loader) => {
                              const matching = instances.filter(
                                (instance) =>
                                  instance.gameVersion === selectedEntry.id &&
                                  (loader.value === 'none'
                                    ? instance.loader === 'vanilla'
                                    : instance.loader === loader.value)
                              )
                              const exists = matching[0]
                              return (
                                <button
                                  key={loader.value}
                                  type="button"
                                  className={`game-loader-row ${
                                    loaderChoice === loader.value ? 'is-selected' : ''
                                  }`}
                                  onClick={() => {
                                    setLoaderChoice(loader.value)
                                    if (loader.value === 'none') setLoaderVersion('')
                                  }}
                                >
                                  <span className="game-loader-name">
                                    {loader.value === 'none' ? '原版（不装加载器）' : loader.label}
                                  </span>
                                  <span className="game-loader-state">
                                    {matching.length > 0
                                      ? `已有 ${
                                          matching.length > 1
                                            ? `${matching.length} 个`
                                            : exists.name
                                        } · 可再建`
                                      : loader.value === 'none'
                                        ? '创建独立原版实例'
                                        : '可以添加'}
                                  </span>
                                  <ChevronRight size={14} />
                                </button>
                              )
                            })}
                            {(() => {
                              const matching = instances.filter(
                                (instance) =>
                                  instance.gameVersion === selectedEntry.id &&
                                  instance.loader === 'optifine'
                              )
                              const exists = matching[0]
                              const unavailable =
                                !optifineLoading &&
                                !optifineError &&
                                optifineVersions.length === 0
                              const previewOnly =
                                optifineVersions.length > 0 &&
                                optifineVersions.every((entry) => entry.channel === 'preview')
                              const disabled =
                                optifineLoading || unavailable || Boolean(optifineError)
                              return (
                                <button
                                  type="button"
                                  className={`game-loader-row ${
                                    loaderChoice === 'optifine' ? 'is-selected' : ''
                                  } ${optifineError ? 'is-error' : disabled ? 'is-disabled' : ''}`}
                                  onClick={() => {
                                    if (optifineError) {
                                      optifineCache.current.delete(selectedEntry.id)
                                      setOptiFineRetry((value) => value + 1)
                                      return
                                    }
                                    if (disabled) return
                                    setLoaderChoice('optifine')
                                    setLoaderVersion(optifineVersions[0]?.version ?? '')
                                  }}
                                  title={
                                    optifineError
                                      ? `读取 OptiFine 版本失败，点击重试：${optifineError}`
                                      : unavailable
                                        ? `OptiFine 官方尚未发布支持 Minecraft ${selectedEntry.id} 的版本`
                                        : undefined
                                  }
                                >
                                  <span className="game-loader-name">OptiFine</span>
                                  <span className="game-loader-state">
                                    {exists
                                      ? `已有 ${
                                          matching.length > 1
                                            ? `${matching.length} 个`
                                            : exists.name
                                        } · 可再建`
                                      : optifineLoading
                                        ? '检查可用版本…'
                                        : optifineError
                                          ? '读取失败，点击重试'
                                          : unavailable
                                            ? '暂无此版本'
                                            : `${optifineVersions.length} 个${
                                                previewOnly ? '测试版' : '版本'
                                              }可用`}
                                  </span>
                                  <ChevronRight size={14} />
                                </button>
                              )
                            })()}
                          </div>
                          <p className="game-loader-note">
                            游戏文件只下载一份；实例只隔离 mods、config、saves 等个人内容。删除原版实例不会删除版本文件。
                          </p>
                          {!optifineLoading &&
                            !optifineError &&
                            optifineVersions.length === 0 && (
                              <p className="game-loader-note">
                                OptiFine 的更新通常落后于最新正式版，官方尚未发布 Minecraft{' '}
                                {selectedEntry.id} 的构建。可切换到 OptiFine 已支持的旧版本再安装。
                              </p>
                            )}
                        </div>

                        {loaderChoice !== 'none' && (
                          <div className="game-loader-version">
                            <div className="game-loader-version-head">
                              <span>{loaderLabel(loaderChoice)} 版本</span>
                              {loaderVersionsLoading ? (
                                <span>
                                  <Spinner size={11} />
                                  读取中
                                </span>
                              ) : (
                                <span>{loaderVersions.length} 个可用版本</span>
                              )}
                            </div>
                            {loaderChoice === 'optifine' && (
                              <p className="game-loader-version-hint">
                                使用本机 Java 应用 OptiFine 补丁，安装为独立的 OptiFine 版本（不含 Forge）。
                                {loaderVersions.some((entry) => entry.channel === 'preview') &&
                                  ' 测试版可能不稳定；标记“不兼容 Forge”的构建不能与 Forge 一起使用。'}
                              </p>
                            )}
                            {loaderVersionsError ? (
                              <p className="game-loader-version-error">{loaderVersionsError}</p>
                            ) : (
                              <div className="game-loader-version-list">
                                {loaderVersions.map((entry) => (
                                  <button
                                    key={entry.version}
                                    type="button"
                                    className={`game-loader-version-row ${
                                      loaderVersion === entry.version ? 'is-selected' : ''
                                    }`}
                                    onClick={() => setLoaderVersion(entry.version)}
                                  >
                                    <span className="game-loader-version-label">
                                      <span>
                                        {loaderChoice === 'optifine'
                                          ? entry.version.replace(/_/g, ' ')
                                          : entry.version}
                                      </span>
                                      {entry.channel === 'preview' && (
                                        <small>
                                          测试版
                                          {entry.releasedAt
                                            ? ` · ${entry.releasedAt.replace(/-/g, '/')}`
                                            : ''}
                                          {entry.note ? ` · ${entry.note}` : ''}
                                        </small>
                                      )}
                                    </span>
                                    {entry.channel !== 'preview' && entry.latest && (
                                      <Badge tone="accent">最新推荐</Badge>
                                    )}
                                  </button>
                                ))}
                                {!loaderVersionsLoading && loaderVersions.length === 0 && (
                                  <p className="game-loader-version-error">没有找到可用版本</p>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {activeTask && (
                          <div className="game-install-progress">
                            <div>
                              <span>{activeTask.stage}</span>
                              <span>{Math.round(activeTask.progress)}%</span>
                            </div>
                            <ProgressBar percent={activeTask.progress} />
                            <button type="button" className="link-button" onClick={() => void cancelTask(activeTask.id)}>
                              取消
                            </button>
                          </div>
                        )}

                        <div className="game-install-footer">
                          <div className="game-install-footer-copy">
                            <span className={`game-install-status ${installedReady ? 'is-ready' : ''}`}>
                              {loaderMatches.length > 0
                                ? `已有 ${
                                    loaderMatches.length > 1
                                      ? `${loaderMatches.length} 个`
                                      : selectedInstance.name
                                  }，再创建会得到独立实例`
                                : loaderChoice === 'none'
                                  ? installedReady
                                    ? '原版文件已就绪 · 将创建独立实例'
                                    : installedSelected
                                      ? '原版文件不完整 · 创建时会补齐'
                                      : '下载原版并创建独立实例'
                                  : `将创建 ${loaderLabel(loaderChoice)} 实例`}
                            </span>
                            {loaderChoice === 'none' && (
                              <button
                                type="button"
                                className="link-button game-install-secondary"
                                disabled={Boolean(activeTask) || installedReady}
                                onClick={() => {
                                  if (effectiveSelected) void installVersion(effectiveSelected)
                                }}
                              >
                                {installedReady
                                  ? '原版游戏文件已安装'
                                  : installedSelected
                                    ? '只补全游戏文件，不创建实例'
                                    : '只下载游戏文件，不创建实例'}
                              </button>
                            )}
                          </div>
                          <button
                            type="button"
                            className="button button--primary game-start-button"
                            onClick={startGameInstall}
                            disabled={
                              Boolean(activeTask) ||
                              (loaderChoice !== 'none' && !loaderVersion)
                            }
                          >
                            <Download size={15} />
                            {activeTask
                              ? '下载中…'
                              : loaderMatches.length > 0
                                ? '再创建一个'
                                : loaderChoice === 'none'
                                  ? '创建原版实例'
                                  : '开始下载'}
                          </button>
                        </div>
                      </>
                    ) : (
                      <EmptyState
                        icon={<Search size={24} />}
                        title="选择一个版本"
                        description="从左侧列表选择 Minecraft 版本，再决定是否添加加载器。"
                      />
                    )}
                  </section>
                </div>
              )}
            </>
          )}

          {mode === 'modpack' && (
            <section className="modpack-panel card">
              <div className="modpack-search-head">
                <div>
                  <span className="mono-label">MODPACKS</span>
                  <h2>搜索整合包</h2>
                </div>
                <div className="modpack-head-actions">
                  <button
                    type="button"
                    className="button button--soft button--sm"
                    onClick={() => setLocalPacksOpen(true)}
                  >
                    <FolderSearch size={13} />
                    扫描本地
                  </button>
                  <button type="button" className="button button--soft button--sm" onClick={() => void importModpack()}>
                    <FolderOpen size={13} />
                    安装已有整合包
                  </button>
                </div>
              </div>
              <div className="modpack-form">
                <label className="form-field">
                  <span className="form-label">名称</span>
                  <div className="text-input">
                    <Search size={14} />
                    <input
                      value={packQuery}
                      placeholder="输入整合包名称，支持中文或简写"
                      onChange={(event) => setPackQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void runPackSearch()
                      }}
                    />
                  </div>
                </label>
                <label className="form-field">
                  <span className="form-label">版本</span>
                  <div className="text-input">
                    <input
                      value={packVersion}
                      placeholder="全部（可输入 1.21.1）"
                      list="pack-version-options"
                      onChange={(event) => setPackVersion(event.target.value)}
                    />
                    <datalist id="pack-version-options">
                      {versionGroups.map((group) => (
                        <option key={group} value={group.replace(/\.x$/, '')} />
                      ))}
                    </datalist>
                  </div>
                </label>
                <label className="form-field">
                  <span className="form-label">来源</span>
                  <select
                    className="workbench-select"
                    value={packSource}
                    onChange={(event) => {
                      setPackSource(event.target.value as ModSearchProvider)
                      setPackHits([])
                      setPackTotal(0)
                      setPackHasMore(false)
                      setPackSourceTotals(null)
                      setPackSourceErrors([])
                      setPackOffset(0)
                      setPackError('')
                    }}
                  >
                    <option value="all">全部来源</option>
                    <option value="modrinth">Modrinth</option>
                    <option value="curseforge">CurseForge</option>
                  </select>
                </label>
                <label className="form-field">
                  <span className="form-label">类型</span>
                  <select
                    className="workbench-select"
                    value={packType}
                    onChange={(event) => setPackType(event.target.value)}
                  >
                    <option value="all">全部</option>
                    <option value="modpack">整合包</option>
                  </select>
                </label>
                <label className="form-field">
                  <span className="form-label">加载器</span>
                  <select
                    className="workbench-select"
                    value={packLoader}
                    onChange={(event) => setPackLoader(event.target.value)}
                  >
                    <option value="all">全部</option>
                    <option value="fabric">Fabric</option>
                    <option value="quilt">Quilt</option>
                    <option value="forge">Forge</option>
                    <option value="neoforge">NeoForge</option>
                  </select>
                </label>
              </div>
              <div className="modpack-form-actions">
                <button type="button" className="button button--primary button--sm" onClick={() => void runPackSearch()}>
                  {packLoading ? <Spinner size={13} /> : <Search size={13} />}
                  搜索
                </button>
                <button type="button" className="button button--soft button--sm" onClick={resetPackFilters}>
                  重置条件
                </button>
                <span className="modpack-count">
                  {packSource === 'all' ? (
                    <>
                      共约 {formatCount(packTotal)} 个来源整合包
                      {packSourceTotals
                        ? `（Modrinth ${formatCount(packSourceTotals.modrinth)} · CurseForge ${formatCount(packSourceTotals.curseforge)}）`
                        : ''}
                      ，已显示 {formatCount(packHits.length)} 个（按结果量加权，重复项已合并）
                    </>
                  ) : (
                    <>
                      共 {formatCount(packTotal)} 个整合包
                      {packHits.length > 0 && packHasMore
                        ? `，已显示 ${formatCount(packHits.length)} 个`
                        : ''}
                    </>
                  )}
                </span>
              </div>

              {packError && (
                <div className="mods-error">
                  <AlertTriangle size={14} />
                  <span>{packError}</span>
                </div>
              )}

              {!packError && packSource === 'all' && packSourceErrors.length > 0 && (
                <div className="modcatalog-source-note">
                  {packSourceErrors
                    .map(
                      (item) =>
                        `${searchProviderLabel(item.provider)}：${item.message}`
                    )
                    .join('；')}
                  ，已显示另一来源结果
                </div>
              )}

              <div className="modpack-results">
                {filteredPacks.map((project) => {
                  const task = taskForProject(project.projectId)
                  const serverTask = tasks.find(
                    (item) =>
                      item.kind === 'serverPack' &&
                      item.projectId === project.projectId &&
                      (item.status === 'running' || item.status === 'paused')
                  )
                  const loaders = project.categories.filter((item) =>
                    ['fabric', 'quilt', 'forge', 'neoforge'].includes(item.toLowerCase())
                  )
                  const latestVersion = project.gameVersions[project.gameVersions.length - 1]
                  return (
                    <article
                      key={`${project.provider}:${project.projectId}`}
                      className="modpack-row"
                    >
                      <span className="modpack-row-icon">
                        <RemoteIcon url={project.iconUrl} fallback={<Boxes size={22} />} />
                      </span>
                      <div className="modpack-row-body">
                        <div className="modpack-row-head">
                          <strong title={project.title}>
                            {project.localizedName ?? project.title}
                          </strong>
                          <span>by {project.author}</span>
                        </div>
                        <p>{project.description || '没有简介'}</p>
                        <div className="modpack-row-meta">
                          {loaders.map((loader) => (
                            <span key={loader} className={`loader-tag loader-tag--${loaderKind(loader)}`}>
                              {loaderLabel(loader)}
                            </span>
                          ))}
                          {latestVersion && <span className="instance-tag-muted">{latestVersion}</span>}
                          <span className="instance-tag-muted">{formatCount(project.downloads)} 次下载</span>
                          <span className="instance-tag-muted">
                            {project.provider === 'curseforge' ? 'CurseForge' : 'Modrinth'}
                          </span>
                        </div>
                      </div>
                      <div className="modpack-row-actions">
                        <button
                          type="button"
                          className="button button--primary button--sm"
                          disabled={Boolean(task)}
                          onClick={() => void openPackVersions(project)}
                        >
                          {task ? <Spinner size={12} /> : <Download size={13} />}
                          {task ? '安装中' : '安装'}
                        </button>
                        {project.provider === 'curseforge' && (
                          <button
                            type="button"
                            className="button button--ghost button--sm"
                            disabled={Boolean(serverTask)}
                            title="下载 CurseForge 服务端包（ServerFiles）"
                            onClick={() => void openPackVersions(project, 'server')}
                          >
                            {serverTask ? <Spinner size={12} /> : <Server size={13} />}
                            {serverTask ? '下载中' : '服务端'}
                          </button>
                        )}
                        <button
                          type="button"
                          className="button button--ghost button--sm"
                          onClick={() =>
                            void window.ccl.app.openExternal(
                              project.provider === 'curseforge'
                                ? `https://www.curseforge.com/minecraft/modpacks/${project.slug}`
                                : `https://modrinth.com/modpack/${project.slug}`
                            )
                          }
                        >
                          查看
                        </button>
                      </div>
                    </article>
                  )
                })}
                {!packLoading && !packError && filteredPacks.length === 0 && (
                  <EmptyState
                    icon={<Search size={24} />}
                    title="没有找到整合包"
                    description="换一个名称或游戏版本再试。"
                  />
                )}
              </div>
              {!packLoading && !packError && packHits.length > 0 && packHasMore && (
                <div className="load-more-row">
                  <button
                    type="button"
                    className="button button--soft button--sm"
                    disabled={packLoadingMore}
                    onClick={() => void runPackSearch(true)}
                  >
                    {packLoadingMore ? <Spinner size={12} /> : <ChevronRight size={12} />}
                    加载更多整合包
                  </button>
                  <span>
                    {packSource === 'all'
                      ? '继续合并加载两个来源'
                      : `还有 ${formatCount(Math.max(0, packTotal - packHits.length))} 个结果`}
                  </span>
                </div>
              )}
            </section>
          )}

          {isContentMode(mode) && (
            <>
              <section className="modcatalog-panel card">
                <div className="modpack-search-head">
                  <div>
                    <span className="mono-label">
                      {mode === 'mods'
                        ? 'MODS'
                        : mode === 'datapack'
                          ? 'DATAPACKS'
                          : mode === 'resourcepack'
                            ? 'RESOURCEPACKS'
                            : 'SHADERS'}
                    </span>
                    <h2>搜索{CONTENT_LABEL[mode]}</h2>
                  </div>
                  <Segmented
                    size="sm"
                    value={modProvider}
                    options={[
                      { value: 'all', label: '全部来源' },
                      { value: 'modrinth', label: 'Modrinth' },
                      {
                        value: 'curseforge',
                        label:
                          mode === 'resourcepack'
                            ? 'CurseForge 纹理包'
                            : mode === 'shader'
                              ? 'CurseForge 光影'
                              : mode === 'datapack'
                                ? 'CurseForge 数据包'
                                : 'CurseForge'
                      }
                    ]}
                    onChange={(value) => setModProvider(value as ModSearchProvider)}
                  />
                </div>
                <div className="modcatalog-form">
                  <label className="form-field">
                    <span className="form-label">Minecraft 版本</span>
                    <ModGameVersionPicker
                      value={modGameVersion}
                      instanceId={modPresetInstanceId}
                      instances={
                        mode === 'mods'
                          ? instances.filter((instance) => instance.loader !== 'vanilla')
                          : instances
                      }
                      versions={manifest?.versions ?? []}
                      onSelect={selectModGameVersion}
                    />
                  </label>
                  {mode === 'mods' && (
                    <label className="form-field">
                      <span className="form-label">加载器</span>
                      <select
                        className="workbench-select"
                        value={modLoader}
                        onChange={(event) => changeModLoader(event.target.value)}
                      >
                        <option value="fabric">Fabric</option>
                        <option value="quilt">Quilt</option>
                        <option value="forge">Forge</option>
                        <option value="neoforge">NeoForge</option>
                      </select>
                    </label>
                  )}
                  <label className="form-field modcatalog-query">
                    <span className="form-label">名称</span>
                    <div className="text-input">
                      <Search size={14} />
                      <input
                        value={modQuery}
                        placeholder={
                          mode === 'mods'
                            ? '搜索模组名称，支持中文、拼音或简写'
                            : `搜索${CONTENT_LABEL[mode]}名称`
                        }
                        onChange={(event) => setModQuery(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') void runModSearch()
                        }}
                      />
                    </div>
                  </label>
                  <button
                    type="button"
                    className="button button--primary button--sm"
                    disabled={modLoading || modLoadingMore}
                    onClick={() => void runModSearch()}
                  >
                    {modLoading ? <Spinner size={13} /> : <Search size={13} />}
                    搜索
                  </button>
                </div>

                {modError && (
                  <div className="mods-error">
                    <AlertTriangle size={14} />
                    <span>{modError}</span>
                  </div>
                )}

                {!modError &&
                  modProvider === 'all' &&
                  modSourceErrors.length > 0 && (
                    <div className="modcatalog-source-note">
                      {modSourceErrors
                        .map(
                          (item) =>
                            `${searchProviderLabel(item.provider)}：${item.message}`
                        )
                        .join('；')}
                      ，已显示另一来源结果
                    </div>
                  )}

                {!modLoading &&
                  !modError &&
                  modProvider !== 'all' &&
                  modAltTotal &&
                  modAltTotal.total > modTotal && (
                    <div className="modcatalog-alt-source">
                      <span>
                        {searchProviderLabel(modProvider)} 当前{' '}
                        {formatCount(modTotal)} 个；{' '}
                        {searchProviderLabel(modAltTotal.provider)} 同一条件有{' '}
                        {formatCount(modAltTotal.total)} 个
                      </span>
                      <button
                        type="button"
                        className="button button--soft button--xs"
                        onClick={() => setModProvider(modAltTotal.provider)}
                      >
                        查看 {searchProviderLabel(modAltTotal.provider)}
                      </button>
                    </div>
                  )}

                {modManual.length > 0 && (
                  <div className="mods-manual">
                    <strong>需要手动下载</strong>
                    {modManual.map((item) => (
                      <div key={item.url} className="mods-manual-row">
                        <span>{item.title}</span>
                        <button
                          type="button"
                          className="button button--soft button--xs"
                          onClick={() => void window.ccl.app.openExternal(item.url)}
                        >
                          <ExternalLink size={11} />
                          打开页面
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {downloadedFiles.length > 0 && (
                  <div className="modcatalog-downloaded">
                    <span title={downloadedFiles.join('\n')}>
                      {downloadedFiles[0]}
                      {downloadedFiles.length > 1 ? `（含 ${downloadedFiles.length - 1} 个前置）` : ''}
                    </span>
                    <button
                      type="button"
                      className="button button--soft button--xs"
                      onClick={() => void window.ccl.app.revealPath(downloadedFiles[0])}
                    >
                      <FolderOpen size={11} />
                      在文件夹中显示
                    </button>
                  </div>
                )}

                <div className="modcatalog-results">
                  {modHits.map((project) => (
                    <article
                      key={`${project.provider}:${project.projectId}`}
                      className="modcatalog-row"
                    >
                      <span className="modpack-row-icon">
                        <RemoteIcon url={project.iconUrl} fallback={<Package size={20} />} />
                      </span>
                      <div className="modpack-row-body">
                        <div className="modpack-row-head">
                          <strong title={project.title}>
                            {project.localizedName ?? project.title}
                          </strong>
                          <span>by {project.author}</span>
                        </div>
                        <p>{project.description || '没有简介'}</p>
                        <div className="modpack-row-meta">
                          {project.categories.slice(0, 3).map((category) => (
                            <span key={category}>{category}</span>
                          ))}
                          <span className="instance-tag-muted">{formatCount(project.downloads)} 次下载</span>
                          <span className="instance-tag-muted">
                            {project.provider === 'curseforge' ? 'CurseForge' : 'Modrinth'}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="button button--primary button--sm"
                        disabled={modBusyVersion !== null}
                        onClick={() => openModVersions(project)}
                      >
                        {modBusyVersion !== null ? <Spinner size={12} /> : <Download size={13} />}
                        选择版本
                      </button>
                    </article>
                  ))}
                  {!modLoading && !modError && modHits.length === 0 && (
                    <EmptyState
                      icon={<Search size={24} />}
                      title={`没有找到${CONTENT_LABEL[mode]}`}
                      description={`当前筛选 ${modGameVersion || '未选择版本'}${
                        mode === 'mods'
                          ? ` · ${loaderLabel(modLoader) ?? modLoader}`
                          : ''
                      }，换个版本、加载器或名称再试。`}
                    />
                  )}
                </div>
                {!modLoading && !modError && modHits.length > 0 && modHasMore && (
                  <div className="load-more-row">
                    <button
                      type="button"
                      className="button button--soft button--sm"
                      disabled={modLoadingMore}
                      onClick={() => void runModSearch(true)}
                    >
                      {modLoadingMore ? <Spinner size={12} /> : <ChevronRight size={12} />}
                      加载更多结果
                    </button>
                    <span>
                      {modProvider === 'all'
                        ? '继续合并加载两个来源'
                        : `还有 ${formatCount(Math.max(0, modTotal - modHits.length))} 个结果`}
                    </span>
                  </div>
                )}
                <p className="modpack-count">
                  {modGameVersion
                    ? `MC ${modGameVersion}${
                        mode === 'mods' ? ` · ${loaderLabel(modLoader) ?? modLoader}` : ''
                      } · `
                    : ''}
                  {modProvider === 'all' ? (
                    <>
                      共约 {formatCount(modTotal)} 个来源结果
                      {modSourceTotals
                        ? `（Modrinth ${formatCount(modSourceTotals.modrinth)} · CurseForge ${formatCount(modSourceTotals.curseforge)}）`
                        : ''}
                      ，已显示 {formatCount(modHits.length)} 个（按结果量加权，重复项已合并）
                    </>
                  ) : (
                    <>
                      共 {formatCount(modTotal)} 个结果，已显示 {formatCount(modHits.length)} 个
                    </>
                  )}
                </p>
              </section>

              {instances.length > 0 && (
                <section className="mods-instance-panel card">
                  <div className="modpack-search-head">
                    <div>
                      <span className="mono-label">INSTALL TO</span>
                      <h2>安装到实例</h2>
                    </div>
                  </div>
                  <div className="mods-instance-list">
                    {instances.map((instance) => (
                      <article key={instance.id} className="mods-instance-row">
                        <span className="workbench-instance-icon">
                          <RemoteIcon url={instance.iconUrl} fallback={<Boxes size={18} />} />
                        </span>
                        <div>
                          <strong>{instance.name}</strong>
                          <small>
                            MC {instance.gameVersion} · {loaderLabel(instance.loader) ?? '原版'} · {instance.modCount} 个模组
                          </small>
                        </div>
                        <button type="button" className="button button--soft button--sm" onClick={() => setModsInstance(instance)}>
                          <Package size={13} />
                          管理模组
                        </button>
                      </article>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>

      <Modal
        open={versionProject !== null}
        onClose={() => setVersionProject(null)}
        title={
          versionProject
            ? `${versionProject.localizedName ?? versionProject.title}${
                versionScope === 'server' ? ' · 服务端包' : ''
              }`
            : '选择整合包版本'
        }
        subtitle={
          versionScope === 'server'
            ? '下载 CurseForge 服务端包（ServerFiles），不会创建客户端实例'
            : '选择一个版本安装，不再固定为最新版'
        }
        icon={versionScope === 'server' ? <Server size={18} /> : <Boxes size={18} />}
        size="lg"
      >
        <div className="pack-version-picker">
          {versionsLoading ? (
            <div className="downloads-loading">
              <Spinner size={16} />
              {versionScope === 'server'
                ? '正在读取服务端包，首次可能需要几秒…'
                : '正在读取版本列表…'}
            </div>
          ) : versionsError ? (
            <div className="mods-error">
              <AlertTriangle size={14} />
              <span>{versionsError}</span>
            </div>
          ) : (
            <>
              <div className="pack-version-list">
                {packVersions.map((version, index) => (
                  <button
                    key={version.id}
                    type="button"
                    className={`pack-version-row ${chosenVersionId === version.id ? 'is-selected' : ''}`}
                    onClick={() => setChosenVersionId(version.id)}
                  >
                    <span className="pack-version-copy">
                      <strong>
                        {version.versionNumber}
                        {index === 0 && <Badge tone="accent">最新</Badge>}
                      </strong>
                      <small>{version.name}</small>
                    </span>
                    <span className="pack-version-meta">
                      MC {version.gameVersion}
                      {version.loaders.length > 0
                        ? ` · ${version.loaders
                            .map((loader) => loaderLabel(loader) ?? loader)
                            .join(' / ')}`
                        : ''}{' '}
                      · {versionTypeLabel(version.versionType)}
                    </span>
                    <span className="pack-version-side">
                      <span>{formatDate(version.datePublished)}</span>
                      <span>{version.fileSize ? formatBytes(version.fileSize) : '—'}</span>
                    </span>
                  </button>
                ))}
                {packVersions.length === 0 && (
                  <p className="mods-empty">
                    {versionScope === 'server'
                      ? '这个整合包没有提供 CurseForge 服务端包。'
                      : '这个整合包没有可安装的版本。'}
                  </p>
                )}
              </div>
              {versionScope === 'server' && (
                <p className="pack-version-server-note">
                  只下载 ZIP，不会创建客户端实例；文件保存到「下载/服务端包/整合包名」，完成后会自动打开所在文件夹。
                </p>
              )}
              <div className="pack-version-footer">
                <span>
                  {chosenVersionId
                    ? `${
                        versionScope === 'server' ? '将下载' : '将安装'
                      } ${packVersions.find((version) => version.id === chosenVersionId)?.versionNumber ?? ''}`
                    : '请选择一个版本'}
                </span>
                <button
                  type="button"
                  className="button button--primary"
                  disabled={!chosenVersionId}
                  onClick={installChosenVersion}
                >
                  {versionScope === 'server' ? <Server size={14} /> : <Download size={14} />}
                  {versionScope === 'server' ? '下载服务端包' : '安装这个版本'}
                </button>
              </div>
            </>
          )}
        </div>
      </Modal>

      <LocalPacksModal open={localPacksOpen} onClose={() => setLocalPacksOpen(false)} />

      <ModVersionModal
        open={modVersionProject !== null}
        project={modVersionProject}
        mode="download"
        targetGameVersion={modGameVersion}
        targetLoader={modLoader}
        kind={isContentMode(mode) ? CONTENT_KIND[mode] : 'mod'}
        busyVersionId={modBusyVersion}
        onClose={() => setModVersionProject(null)}
        onDownload={(version, target, options) =>
          void downloadModVersion(version, target, options)
        }
      />

      <ModsModal
        open={modsInstance !== null}
        instance={modsInstance}
        onClose={() => setModsInstance(null)}
        onGoSettings={() => {
          setModsInstance(null)
          useLauncher.getState().setPage('settings')
        }}
      />
    </div>
  )
}
