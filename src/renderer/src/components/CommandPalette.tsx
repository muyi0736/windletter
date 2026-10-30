import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Boxes,
  Clock3,
  Download,
  Ellipsis,
  FolderOpen,
  HardDrive,
  Moon,
  PackagePlus,
  Play,
  RefreshCw,
  Search,
  Server,
  Settings,
  Stethoscope,
  Sun,
  Terminal,
  Trash2,
  UserRound
} from 'lucide-react'
import type { InstalledVersion } from '@shared/types'
import { useLauncher, type PageKey } from '../store'
import { applyTheme, resolveDarkTheme } from '../lib/appearance'
import { cleanError } from '../lib/format'
import { VersionCleanupModal } from './VersionCleanupModal'

type CommandCategory = '页面' | '实例' | '版本' | '操作'

interface CommandItem {
  id: string
  label: string
  hint?: string
  keywords: string[]
  category: CommandCategory
  icon: ReactNode
  run: () => void | Promise<void>
}

const CATEGORY_ORDER: CommandCategory[] = ['页面', '实例', '版本', '操作']

function scoreCommand(command: CommandItem, query: string): number {
  const q = query.trim().toLowerCase()
  if (!q) return 0
  const label = command.label.toLowerCase()
  if (label === q) return 0
  if (label.startsWith(q)) return 1
  if (label.includes(q)) return 2
  const haystack = [command.hint ?? '', ...command.keywords].join(' ').toLowerCase()
  if (haystack.includes(q)) return 3
  const tokens = q.split(/\s+/).filter(Boolean)
  if (tokens.length > 1 && tokens.every((token) => haystack.includes(token) || label.includes(token))) {
    return 4
  }
  return -1
}

function pageCommand(
  key: PageKey,
  label: string,
  icon: ReactNode,
  keywords: string[],
  setPage: (page: PageKey) => void
): CommandItem {
  return {
    id: `page:${key}`,
    label: `前往${label}`,
    hint: key === 'home' ? '主页' : `${label}页面`,
    keywords: [label, key, ...keywords],
    category: '页面',
    icon,
    run: () => setPage(key)
  }
}

export function CommandPalette() {
  const setPage = useLauncher((state) => state.setPage)
  const instances = useLauncher((state) => state.instances)
  const installed = useLauncher((state) => state.installed)
  const settings = useLauncher((state) => state.settings)
  const accounts = useLauncher((state) => state.accounts)
  const startInstance = useLauncher((state) => state.startInstance)
  const startLaunch = useLauncher((state) => state.startLaunch)
  const openInstanceFolder = useLauncher((state) => state.openInstanceFolder)
  const openDiagnosis = useLauncher((state) => state.openDiagnosis)
  const openConsole = useLauncher((state) => state.openConsole)
  const setAccountModalOpen = useLauncher((state) => state.setAccountModalOpen)
  const importModpack = useLauncher((state) => state.importModpack)
  const refreshInstalled = useLauncher((state) => state.refreshInstalled)
  const refreshInstances = useLauncher((state) => state.refreshInstances)
  const patchSettings = useLauncher((state) => state.patchSettings)
  const toast = useLauncher((state) => state.toast)

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [cleanupOpen, setCleanupOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  const close = useCallback(() => {
    setOpen(false)
    setQuery('')
    setActive(0)
  }, [])

  const show = useCallback(() => {
    setQuery('')
    setActive(0)
    setOpen(true)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      if (event.key.toLowerCase() !== 'k') return
      event.preventDefault()
      if (open) close()
      else show()
    }
    const onOpenRequest = () => show()
    window.addEventListener('keydown', onKey)
    window.addEventListener('windletter:command-palette', onOpenRequest)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('windletter:command-palette', onOpenRequest)
    }
  }, [close, open, show])

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => inputRef.current?.focus(), 20)
    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      close()
    }
    window.addEventListener('keydown', onEscape)
    return () => window.removeEventListener('keydown', onEscape)
  }, [close, open])

  const commands = useMemo<CommandItem[]>(() => {
    const pages: CommandItem[] = [
      pageCommand('home', '启动', <Play size={15} />, ['主页', 'home'], setPage),
      pageCommand('instances', '实例', <Boxes size={15} />, ['整合包', 'instances'], setPage),
      pageCommand('servers', '服务器', <Server size={15} />, ['地址', 'servers'], setPage),
      pageCommand('downloads', '下载', <Download size={15} />, ['安装', 'download'], setPage),
      pageCommand('settings', '设置', <Settings size={15} />, ['配置', 'settings'], setPage),
      pageCommand('more', '更多', <Ellipsis size={15} />, ['扩展', 'more'], setPage)
    ]

    const instanceCommands = instances.flatMap<CommandItem>((instance) => [
      {
        id: `instance:launch:${instance.id}`,
        label: `启动实例：${instance.name}`,
        hint: `Minecraft ${instance.gameVersion} · ${instance.modCount} 个模组`,
        keywords: [instance.name, instance.gameVersion, instance.loader, '启动', '实例'],
        category: '实例',
        icon: <Play size={15} />,
        run: () => startInstance(instance.id)
      },
      {
        id: `instance:folder:${instance.id}`,
        label: `打开实例目录：${instance.name}`,
        hint: instance.external?.gameDir ?? '打开这个实例的 Minecraft 目录',
        keywords: [instance.name, '目录', '文件夹', 'folder'],
        category: '实例',
        icon: <FolderOpen size={15} />,
        run: () => openInstanceFolder(instance.id, 'version')
      },
      {
        id: `instance:doctor:${instance.id}`,
        label: `启动体检：${instance.name}`,
        hint: '检查 Java、模组与最近崩溃',
        keywords: [instance.name, '故障', '医生', '诊断', 'doctor'],
        category: '实例',
        icon: <Stethoscope size={15} />,
        run: () => openDiagnosis(instance.id)
      }
    ])

    const versionCommands = installed.flatMap<CommandItem>((version: InstalledVersion) => [
      {
        id: `version:launch:${version.id}`,
        label: `启动版本：${version.id}`,
        hint: version.loader ? `${version.loader}${version.javaMajor ? ` · Java ${version.javaMajor}` : ''}` : '原版',
        keywords: [version.id, version.loader ?? 'vanilla', '启动', '版本'],
        category: '版本',
        icon: <Play size={15} />,
        run: () => startLaunch(version.id)
      },
      {
        id: `version:folder:${version.id}`,
        label: `打开版本文件夹：${version.id}`,
        hint: '打开 versions 目录',
        keywords: [version.id, '目录', '文件夹', 'folder'],
        category: '版本',
        icon: <FolderOpen size={15} />,
        run: () => window.ccl.versions.openFolder(version.id)
      }
    ])

    const dark = resolveDarkTheme(settings?.theme)
    const actions: CommandItem[] = [
      {
        id: 'action:install',
        label: '安装 Minecraft 或整合包',
        hint: '前往下载中心',
        keywords: ['安装', '下载', '整合包', '版本', 'install'],
        category: '操作',
        icon: <Download size={15} />,
        run: () => setPage('downloads')
      },
      {
        id: 'action:import-pack',
        label: '导入整合包文件',
        hint: '.mrpack / .zip',
        keywords: ['导入', '整合包', 'mrpack', 'zip', 'import'],
        category: '操作',
        icon: <PackagePlus size={15} />,
        run: () => importModpack()
      },
      {
        id: 'action:account',
        label: accounts.activeId ? '管理账户' : '添加账户',
        hint: accounts.activeId ? '切换或添加账户' : '离线账户或微软登录',
        keywords: ['账户', '登录', '微软', '离线', 'account'],
        category: '操作',
        icon: <UserRound size={15} />,
        run: () => setAccountModalOpen(true)
      },
      {
        id: 'action:console',
        label: '打开日志控制台',
        hint: '查看启动日志',
        keywords: ['日志', '终端', '控制台', 'log', 'console'],
        category: '操作',
        icon: <Terminal size={15} />,
        run: () => openConsole('launch')
      },
      {
        id: 'action:logs-folder',
        label: '打开日志文件夹',
        hint: '风信日志目录',
        keywords: ['日志', '文件夹', 'log'],
        category: '操作',
        icon: <FolderOpen size={15} />,
        run: () => window.ccl.logs.openFolder()
      },
      {
        id: 'action:game-folder',
        label: '打开游戏目录',
        hint: settings?.gameDir ?? '共享 Minecraft 目录',
        keywords: ['游戏目录', 'minecraft', '文件夹', 'game'],
        category: '操作',
        icon: <HardDrive size={15} />,
        run: () => window.ccl.app.openPath(settings?.gameDir ?? '')
      },
      {
        id: 'action:playtime',
        label: '查看游戏时长周报',
        hint: '本周游戏时间、每日统计和实例排行',
        keywords: ['游戏时长', '时长', '周报', '统计', 'playtime'],
        category: '操作',
        icon: <Clock3 size={15} />,
        run: () => window.dispatchEvent(new Event('windletter:playtime-report'))
      },
      {
        id: 'action:version-folders',
        label: '选择版本文件夹',
        hint: settings?.gameDir ?? '切换当前版本文件夹',
        keywords: ['版本文件夹', '文件夹', '切换', 'version', 'folder'],
        category: '操作',
        icon: <FolderOpen size={15} />,
        run: () => window.dispatchEvent(new Event('windletter:version-folders'))
      },
      {
        id: 'action:cleanup',
        label: '清理未使用版本',
        hint: '检查不再被实例或启动档案引用的版本',
        keywords: ['清理', '版本', '未使用', '空间', 'cleanup'],
        category: '操作',
        icon: <Trash2 size={15} />,
        run: () => setCleanupOpen(true)
      },
      {
        id: 'action:refresh',
        label: '刷新版本与实例',
        hint: '重新读取已安装内容和实例',
        keywords: ['刷新', '重新加载', 'refresh'],
        category: '操作',
        icon: <RefreshCw size={15} />,
        run: async () => {
          await Promise.all([refreshInstalled(), refreshInstances()])
          toast('success', '已刷新', '版本和实例列表已重新读取')
        }
      },
      {
        id: 'action:theme',
        label: dark ? '切换为浅色主题' : '切换为深色主题',
        hint: '即时应用',
        keywords: ['主题', '明暗', '深色', '浅色', 'theme', 'dark', 'light'],
        category: '操作',
        icon: dark ? <Sun size={15} /> : <Moon size={15} />,
        run: () => {
          const next = dark ? 'light' : 'dark'
          applyTheme(next)
          void patchSettings({ theme: next })
        }
      }
    ]

    return [...pages, ...instanceCommands, ...versionCommands, ...actions]
  }, [
    accounts.activeId,
    importModpack,
    installed,
    instances,
    openConsole,
    openDiagnosis,
    openInstanceFolder,
    patchSettings,
    refreshInstalled,
    refreshInstances,
    setAccountModalOpen,
    setPage,
    settings?.gameDir,
    settings?.theme,
    startInstance,
    startLaunch,
    toast
  ])

  const filtered = useMemo(() => {
    const terms = query.trim().toLowerCase()
    const scored = commands
      .map((command, index) => ({
        command,
        index,
        score: scoreCommand(command, terms)
      }))
      .filter((entry) => entry.score >= 0)
    scored.sort((left, right) => {
      const categoryDiff =
        CATEGORY_ORDER.indexOf(left.command.category) -
        CATEGORY_ORDER.indexOf(right.command.category)
      if (!terms) {
        if (categoryDiff !== 0) return categoryDiff
        return left.index - right.index
      }
      if (left.score !== right.score) return left.score - right.score
      if (categoryDiff !== 0) return categoryDiff
      return left.command.label.localeCompare(right.command.label)
    })
    return scored.slice(0, 40).map((entry) => entry.command)
  }, [commands, query])

  useEffect(() => {
    setActive((current) => Math.min(current, Math.max(0, filtered.length - 1)))
  }, [filtered.length])

  useEffect(() => {
    if (!open) return
    const node = listRef.current?.querySelector<HTMLElement>(
      `[data-command-index="${active}"]`
    )
    node?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  const execute = useCallback(
    async (command: CommandItem) => {
      close()
      try {
        await command.run()
      } catch (cause) {
        toast('error', '命令执行失败', cleanError(cause))
      }
    },
    [close, toast]
  )

  if (!open && !cleanupOpen) return null

  let lastCategory: CommandCategory | null = null
  return (
    <>
      {open && (
    <div
      className="command-palette-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <div
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="命令面板"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="command-palette-input">
          <Search size={17} />
          <input
            ref={inputRef}
            value={query}
            placeholder="搜索页面、实例、版本或操作…"
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => {
              setQuery(event.target.value)
              setActive(0)
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                if (filtered.length > 0) setActive((value) => (value + 1) % filtered.length)
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                if (filtered.length > 0) {
                  setActive((value) => (value - 1 + filtered.length) % filtered.length)
                }
              } else if (event.key === 'Enter') {
                event.preventDefault()
                const command = filtered[active]
                if (command) void execute(command)
              } else if (event.key === 'Escape') {
                event.preventDefault()
                close()
              }
            }}
          />
          <kbd>Ctrl K</kbd>
        </div>
        <div className="command-palette-list" ref={listRef}>
          {filtered.length === 0 ? (
            <div className="command-palette-empty">
              <Search size={18} />
              <span>没有匹配的命令</span>
            </div>
          ) : (
            filtered.map((command, index) => {
              const showGroup = command.category !== lastCategory
              lastCategory = command.category
              return (
                <div key={command.id}>
                  {showGroup && (
                    <div className="command-palette-group">{command.category}</div>
                  )}
                  <button
                    type="button"
                    data-command-index={index}
                    className={`command-palette-item ${index === active ? 'is-active' : ''}`}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => void execute(command)}
                  >
                    <span className="command-palette-icon">{command.icon}</span>
                    <span className="command-palette-copy">
                      <strong>{command.label}</strong>
                      {command.hint && <small>{command.hint}</small>}
                    </span>
                    {index === active && <span className="command-palette-enter">Enter</span>}
                  </button>
                </div>
              )
            })
          )}
        </div>
        <div className="command-palette-footer">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> 选择
          </span>
          <span>
            <kbd>Enter</kbd> 执行
          </span>
          <span>
            <kbd>Esc</kbd> 关闭
          </span>
        </div>
      </div>
    </div>
      )}
      <VersionCleanupModal open={cleanupOpen} onClose={() => setCleanupOpen(false)} />
    </>
  )
}
