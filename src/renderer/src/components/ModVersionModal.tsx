import { RemoteIcon } from '../components/RemoteIcon'
import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowLeft, Boxes, ChevronRight, Download, Package, Wrench } from 'lucide-react'
import type {
  ContentKind,
  ContentProvider,
  ModDependencyView,
  ModVersionView
} from '@shared/types'
import { cleanError, formatBytes, formatCount, formatDate, loaderLabel, versionTypeLabel } from '../lib/format'
import { useLauncher } from '../store'
import { Badge, Modal, Spinner, Switch } from './ui'

export interface ModVersionTarget {
  provider: ContentProvider
  projectId: string
  title: string
  localizedName?: string | null
  iconUrl?: string | null
  author?: string
}

export interface ModVersionActionOptions {
  includeDependencies: boolean
}

interface VersionGroup {
  key: string
  gameVersion: string
  loader: string
  versions: ModVersionView[]
  dependencies: ModDependencyView[]
}

const LOADER_ORDER = ['fabric', 'quilt', 'forge', 'neoforge']

function compareGame(left: string, right: string): number {
  const a = left.split('.').map((part) => Number(part) || 0)
  const b = right.split('.').map((part) => Number(part) || 0)
  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index += 1) {
    const diff = (b[index] ?? 0) - (a[index] ?? 0)
    if (diff !== 0) return diff
  }
  return right.localeCompare(left)
}

function newestGameVersion(version: ModVersionView): string {
  return [...version.gameVersions].sort(compareGame)[0] ?? ''
}

function majorOf(value: string): string {
  return value.match(/^(\d+\.\d+)/)?.[1] ?? value
}

function isStableGame(value: string): boolean {
  if (/-(?:snapshot|pre|rc)/i.test(value)) return false
  if (/^\d{2}w\d{2}[a-z]/i.test(value)) return false
  return true
}

function majorGamesOf(versions: ModVersionView[], target?: string): string[] {
  const all = [...new Set(versions.flatMap((version) => version.gameVersions).map(majorOf))]
  const stable = [
    ...new Set(
      versions
        .flatMap((version) => version.gameVersions)
        .filter(isStableGame)
        .map(majorOf)
    )
  ]
  const majors = stable.length > 0 ? stable : all
  const targetMajor = target ? majorOf(target) : ''
  if (targetMajor && !majors.includes(targetMajor)) majors.push(targetMajor)
  return majors.sort(compareGame)
}

function typeLetter(type: string): string {
  if (type === 'beta') return 'B'
  if (type === 'alpha') return 'A'
  return 'R'
}

export function ModVersionModal({
  open,
  project,
  mode,
  targetGameVersion = '',
  targetLoader = '',
  kind = 'mod',
  busyVersionId = null,
  onClose,
  onDownload,
  onInstall
}: {
  open: boolean
  project: ModVersionTarget | null
  mode: 'download' | 'install'
  targetGameVersion?: string
  targetLoader?: string
  kind?: ContentKind
  busyVersionId?: string | null
  onClose: () => void
  onDownload?: (
    version: ModVersionView,
    target: ModVersionTarget,
    options: ModVersionActionOptions
  ) => void
  onInstall?: (
    version: ModVersionView,
    target: ModVersionTarget,
    options: ModVersionActionOptions
  ) => void
}) {
  const autoDependencies = useLauncher(
    (state) => state.settings?.autoModDependencies !== false
  )
  const patchSettings = useLauncher((state) => state.patchSettings)
  const [stack, setStack] = useState<ModVersionTarget[]>([])
  const [versions, setVersions] = useState<ModVersionView[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [activeGame, setActiveGame] = useState('all')
  const [visibleGroups, setVisibleGroups] = useState(12)
  const [includeDependencies, setIncludeDependencies] = useState(autoDependencies)

  useEffect(() => {
    if (!open || !project) {
      setStack([])
      return
    }
    setStack([project])
  }, [open, project?.provider, project?.projectId])

  useEffect(() => {
    if (!open || !project) return
    setIncludeDependencies(autoDependencies)
  }, [open, project?.provider, project?.projectId, autoDependencies])

  const changeIncludeDependencies = (next: boolean) => {
    setIncludeDependencies(next)
    void patchSettings({ autoModDependencies: next })
  }

  const current = stack[stack.length - 1] ?? project

  useEffect(() => {
    if (!open || !current) return
    let alive = true
    setLoading(true)
    setError('')
    setVersions([])
    setActiveGame('all')
    window.ccl.mods
      .versions(current.provider, current.projectId, kind)
      .then((list) => {
        if (!alive) return
        setVersions(list)
        const majors = majorGamesOf(list, targetGameVersion)
        const targetMajor = targetGameVersion ? majorOf(targetGameVersion) : ''
        setActiveGame(
          targetMajor && majors.includes(targetMajor) ? targetMajor : majors[0] ?? 'all'
        )
      })
      .catch((err) => {
        if (!alive) return
        setError(cleanError(err))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [open, current?.provider, current?.projectId, targetGameVersion, kind])

  const games = useMemo(
    () => majorGamesOf(versions, targetGameVersion),
    [versions, targetGameVersion]
  )

  useEffect(() => {
    setVisibleGroups(12)
  }, [activeGame, current?.projectId])

  const groups = useMemo<VersionGroup[]>(() => {
    const filtered = versions.filter(
      (version) =>
        activeGame === 'all' ||
        version.gameVersions.some((game) => majorOf(game) === activeGame)
    )
    const hasStableSelection = filtered.some((version) =>
      version.gameVersions.some(
        (game) =>
          (activeGame === 'all' || majorOf(game) === activeGame) && isStableGame(game)
      )
    )
    const preferred = hasStableSelection
      ? filtered.filter((version) =>
          version.gameVersions.some(
            (game) =>
              (activeGame === 'all' || majorOf(game) === activeGame) && isStableGame(game)
          )
        )
      : filtered
    const map = new Map<string, VersionGroup>()
    for (const version of preferred) {
      const candidates =
        activeGame === 'all'
          ? version.gameVersions
          : version.gameVersions.filter((game) => majorOf(game) === activeGame)
      const stable = candidates.filter(isStableGame)
      const effective = stable.length > 0 ? stable : candidates
      const gameVersion = [...effective].sort(compareGame)[0] ?? newestGameVersion(version)
      const loaders = version.loaders.length > 0 ? version.loaders : ['unknown']
      for (const loader of loaders) {
        const key = `${gameVersion}|${loader}`
        let group = map.get(key)
        if (!group) {
          group = {
            key,
            gameVersion: gameVersion || '未知版本',
            loader,
            versions: [],
            dependencies: []
          }
          map.set(key, group)
        }
        group.versions.push(version)
      }
    }
    const result = [...map.values()]
    for (const group of result) {
      group.versions.sort(
        (a, b) => Date.parse(b.datePublished) - Date.parse(a.datePublished)
      )
      const seen = new Set<string>()
      group.dependencies = []
      for (const version of group.versions) {
        for (const dependency of version.dependencies) {
          if (dependency.type !== 'required') continue
          const key = dependency.projectId || dependency.title
          if (seen.has(key)) continue
          seen.add(key)
          group.dependencies.push(dependency)
        }
      }
    }
    result.sort((a, b) => {
      const game = compareGame(a.gameVersion, b.gameVersion)
      if (game !== 0) return game
      const loadA = LOADER_ORDER.indexOf(a.loader)
      const loadB = LOADER_ORDER.indexOf(b.loader)
      return (loadA === -1 ? 99 : loadA) - (loadB === -1 ? 99 : loadB)
    })
    return result
  }, [versions, activeGame])

  const openDependency = (dep: ModDependencyView) => {
    if (!dep.projectId) return
    setStack((previous) => {
      if (
        previous.some(
          (target) => target.provider === dep.provider && target.projectId === dep.projectId
        )
      ) {
        return previous
      }
      return [
        ...previous,
        {
          provider: dep.provider,
          projectId: dep.projectId,
          title: dep.title,
          iconUrl: dep.iconUrl
        }
      ]
    })
  }

  const action =
    mode === 'install'
      ? (version: ModVersionView) =>
          current && onInstall?.(version, current, { includeDependencies })
      : (version: ModVersionView) =>
          current && onDownload?.(version, current, { includeDependencies })

  const targetGame = targetGameVersion.trim()
  const targetLoaderValue = targetLoader.trim().toLowerCase()
  const compatibleWithInstance = (group: VersionGroup) => {
    if (mode !== 'install') return true
    if (targetGame && !group.versions.some((version) => version.gameVersions.includes(targetGame))) {
      return false
    }
    if (targetLoaderValue && group.loader !== targetLoaderValue) return false
    return true
  }

  const subtitle =
    mode === 'install'
      ? `${
          includeDependencies
            ? '选择具体文件版本，必需的前置模组会一起安装'
            : '选择具体文件版本，只安装所选文件'
        }${
          targetLoaderValue
            ? ` · 适配 ${loaderLabel(targetLoaderValue) ?? targetLoaderValue}${
                targetGame ? ` ${targetGame}` : ''
              }`
            : ''
        }`
      : `${
          includeDependencies
            ? '选择具体文件版本，必需的前置模组会一起下载到 downloads/mods'
            : '选择具体文件版本，只下载所选文件'
        }`

  const orderedGroups =
    mode === 'install'
      ? [...groups].sort((a, b) => {
          const compatibleA = compatibleWithInstance(a) ? 1 : 0
          const compatibleB = compatibleWithInstance(b) ? 1 : 0
          if (compatibleA !== compatibleB) return compatibleB - compatibleA
          if (targetLoaderValue) {
            const loaderA = a.loader === targetLoaderValue ? 1 : 0
            const loaderB = b.loader === targetLoaderValue ? 1 : 0
            if (loaderA !== loaderB) return loaderB - loaderA
          }
          return compareGame(a.gameVersion, b.gameVersion)
        })
      : groups
  const shownGroups = orderedGroups.slice(0, visibleGroups)
  const tabGames = games.slice(0, 12)
  const extraGames = games.slice(12)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        current
          ? `${current.localizedName ?? current.title} · 选择版本`
          : '选择模组版本'
      }
      subtitle={subtitle}
      icon={mode === 'install' ? <Wrench size={18} /> : <Package size={18} />}
      size="xl"
      footer={
        <div className="mod-version-footer">
          <span>
            {busyVersionId
              ? '正在处理，关闭窗口不会中断下载'
              : loading
                ? '正在读取版本列表…'
                : `${versions.length} 个文件 · ${games.length} 个游戏版本`}
          </span>
          <button
            type="button"
            className="button button--ghost button--sm"
            title={busyVersionId ? '关闭窗口后会在后台继续处理' : undefined}
            onClick={onClose}
          >
            关闭
          </button>
        </div>
      }
    >
      <div className="mod-version-picker">
        {stack.length > 1 && (
          <div className="mod-version-breadcrumb">
            <button
              type="button"
              className="mod-version-back"
              onClick={() => setStack((previous) => previous.slice(0, -1))}
            >
              <ArrowLeft size={12} />
              返回 {stack[stack.length - 2]?.title ?? '上一级'}
            </button>
            <span>前置 · {current?.title}</span>
          </div>
        )}
        {kind === 'mod' && (
          <div className={`mod-version-options ${includeDependencies ? '' : 'is-off'}`}>
            <div>
              <strong>自动下载必需前置</strong>
              <span>
                {includeDependencies
                  ? mode === 'install'
                    ? '安装时一并处理该版本声明的必需前置'
                    : '下载时一并保存该版本声明的必需前置'
                  : '只处理所选文件；缺少的前置需要自己补装'}
              </span>
            </div>
            <Switch
              checked={includeDependencies}
              label="自动下载必需前置"
              onChange={changeIncludeDependencies}
            />
          </div>
        )}
        {loading ? (
          <div className="downloads-loading">
            <Spinner size={16} />
            正在读取版本列表…
          </div>
        ) : error ? (
          <div className="mods-error">
            <AlertTriangle size={14} />
            <span>{error}</span>
          </div>
        ) : versions.length === 0 ? (
          <p className="mods-empty">这个模组没有可用的公开版本。</p>
        ) : (
          <>
            {games.length > 0 && (
              <div className="mod-version-tabs">
                <button
                  type="button"
                  className={`mod-version-tab ${activeGame === 'all' ? 'is-active' : ''}`}
                  onClick={() => setActiveGame('all')}
                >
                  全部
                </button>
                {tabGames.map((game) => (
                  <button
                    key={game}
                    type="button"
                    className={`mod-version-tab ${activeGame === game ? 'is-active' : ''}`}
                    onClick={() => setActiveGame(game)}
                  >
                    {game}
                  </button>
                ))}
                {extraGames.length > 0 && (
                  <select
                    className="mod-version-select"
                    value={tabGames.includes(activeGame) ? '' : activeGame}
                    onChange={(event) => {
                      if (event.target.value) setActiveGame(event.target.value)
                    }}
                  >
                    <option value="">更多版本…</option>
                    {extraGames.map((game) => (
                      <option key={game} value={game}>
                        {game}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            <div className="mod-version-groups">
              {shownGroups.map((group) => {
                const compatible = compatibleWithInstance(group)
                return (
                <section
                  key={group.key}
                  className={`mod-version-group ${compatible ? '' : 'is-incompatible'}`}
                >
                  <header className="mod-version-group-head">
                    <span className={`loader-tag loader-tag--${group.loader}`}>
                      {loaderLabel(group.loader) ?? group.loader}
                    </span>
                    <strong>{group.gameVersion}</strong>
                    <span>{group.versions.length} 个版本</span>
                    {!compatible && (
                      <span className="mod-version-incompatible">不兼容当前实例</span>
                    )}
                  </header>

                  {group.dependencies.length > 0 && (
                    <div className="mod-version-deps">
                      <span className="mod-version-deps-label">前置资源</span>
                      <div className="mod-version-dep-list">
                        {group.dependencies.map((dep) => (
                          <button
                            key={`${dep.projectId}-${dep.title}`}
                            type="button"
                            className="mod-version-dep"
                            title={
                              dep.projectId
                                ? `查看 ${dep.title} 的版本并下载`
                                : dep.title
                            }
                            disabled={!dep.projectId}
                            onClick={() => openDependency(dep)}
                          >
                            <span className="mod-version-dep-icon">
                              <RemoteIcon url={dep.iconUrl} fallback={<Boxes size={12} />} />
                            </span>
                            <span>{dep.title}</span>
                            {dep.projectId && <ChevronRight size={10} />}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="mod-version-list">
                    {group.versions.map((version, index) => {
                      const required = version.dependencies.filter(
                        (dependency) => dependency.type === 'required'
                      ).length
                      const busy = busyVersionId === version.id
                      return (
                        <div key={`${group.key}-${version.id}`} className="mod-version-row">
                          <span className={`mod-version-type is-${version.versionType}`}>
                            {typeLetter(version.versionType)}
                          </span>
                          <div className="mod-version-copy">
                            <strong>
                              {version.versionNumber}
                              {index === 0 && <Badge tone="accent">最新</Badge>}
                              <span className="mod-version-type-label">
                                {versionTypeLabel(version.versionType)}
                              </span>
                            </strong>
                            <small>{version.name}</small>
                            <div className="mod-version-meta">
                              {version.filename && <span>{version.filename}</span>}
                              {required > 0 && <span>{required} 项前置</span>}
                              <span>{formatDate(version.datePublished)}</span>
                              {version.fileSize !== null && (
                                <span>{formatBytes(version.fileSize)}</span>
                              )}
                              <span>{formatCount(version.downloads)} 次下载</span>
                            </div>
                          </div>
                          <button
                            type="button"
                            className="button button--primary button--sm"
                            disabled={busyVersionId !== null || !compatible}
                            title={compatible ? undefined : '与当前实例的游戏版本或加载器不兼容'}
                            onClick={() => action(version)}
                          >
                            {busy ? <Spinner size={12} /> : <Download size={12} />}
                            {mode === 'install' ? '安装' : '下载'}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </section>
                )
              })}
              {groups.length === 0 && (
                <p className="mods-empty">这个游戏版本下没有可用文件。</p>
              )}
              {orderedGroups.length > visibleGroups && (
                <button
                  type="button"
                  className="mod-version-more"
                  onClick={() => setVisibleGroups((count) => count + 30)}
                >
                  还有 {orderedGroups.length - visibleGroups} 个版本分组，显示更多
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
