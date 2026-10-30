import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  BookOpen,
  Bot,
  Check,
  ChevronRight,
  FileCode2,
  FilePlus2,
  Folder,
  FolderOpen,
  History,
  Library,
  MessageCircleQuestion,
  Minus,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Trash2,
  Wrench,
  WrapText,
  X
} from 'lucide-react'
import type {
  InstanceSummary,
  KubeJsAiResult,
  KubeJsFileContent,
  KubeJsFileView,
  KubeJsLineEnding,
  KubeJsTemplateView
} from '@shared/types'
import { cleanError, formatBytes, formatDateTime } from '../lib/format'
import { useLauncher } from '../store'
import { Modal, Spinner } from './ui'
import {
  KubeJsCodeEditor,
  type KubeJsDiagnostic,
  type KubeJsEditorHandle,
  type KubeJsEditorSelection
} from './KubeJsCodeEditor'
import { KubeJsExplainPanel } from './KubeJsExplainPanel'
import { KubeJsHelpModal } from './KubeJsHelpModal'
import { KubeJsRuntimeModal } from './KubeJsRuntimeModal'
import { KubeJsKnowledgePanel } from './KubeJsKnowledgePanel'
import { DiffView, KubeJsHistoryModal } from './KubeJsHistoryModal'
import { KubeJsProblemsPanel } from './KubeJsProblemsPanel'
import { KubeJsQaPanel } from './KubeJsQaPanel'
import { KubeJsRecipeBuilder } from './KubeJsRecipeBuilder'
import { KubeJsTagBuilder } from './KubeJsTagBuilder'

interface WorkbenchTab {
  path: string
  content: string
  original: string
  bom: boolean
  lineEnding: KubeJsLineEnding
  modified: number | null
  size: number
  isNew: boolean
}

interface TreeNode {
  name: string
  path: string
  isDir: boolean
  children: TreeNode[]
  count: number
}

interface ConflictState {
  path: string
  reason: 'changed' | 'deleted' | 'exists'
  modified: number
}

const SESSION_PREFIX = 'ccl.kubejs.session.'
const WRAP_KEY = 'ccl.kubejs.wrap'
const FONT_KEY = 'ccl.kubejs.font'
const EXTENSIONS = /\.(?:js|json|snbt|txt|properties|md|zs)$/i

function normalizePath(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/^\/+/, '')
}

function validClientPath(path: string): boolean {
  return (
    Boolean(path) &&
    path.length <= 400 &&
    !path.split('/').includes('..') &&
    !/^[A-Za-z]:/.test(path) &&
    EXTENSIONS.test(path)
  )
}

function toTab(file: KubeJsFileContent): WorkbenchTab {
  return {
    path: file.path,
    content: file.content,
    original: file.content,
    bom: file.bom,
    lineEnding: file.lineEnding,
    modified: file.modified,
    size: file.size,
    isNew: false
  }
}

function readPreference<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writePreference(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* preferences are optional */
  }
}

function buildTree(files: KubeJsFileView[]): TreeNode[] {
  const root: TreeNode[] = []
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path, 'zh-CN'))
  for (const file of sorted) {
    const parts = file.path.split('/')
    let level = root
    let prefix = ''
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index]
      prefix = prefix ? `${prefix}/${part}` : part
      const isLeaf = index === parts.length - 1
      if (isLeaf) {
        level.push({ name: part, path: file.path, isDir: false, children: [], count: 0 })
      } else {
        let dir = level.find((node) => node.isDir && node.name === part)
        if (!dir) {
          dir = { name: part, path: prefix, isDir: true, children: [], count: 0 }
          level.push(dir)
        }
        level = dir.children
      }
    }
  }
  const countFiles = (nodes: TreeNode[]): number => {
    let total = 0
    for (const node of nodes) {
      if (node.isDir) node.count = countFiles(node.children)
      else node.count = 1
      total += node.count
    }
    return total
  }
  const dirRank = (name: string): number => {
    const order = ['server_scripts', 'startup_scripts', 'client_scripts', 'data', 'assets', 'config']
    const index = order.indexOf(name)
    return index < 0 ? order.length : index
  }
  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      if (a.isDir && b.isDir) {
        const rank = dirRank(a.name) - dirRank(b.name)
        if (rank !== 0) return rank
      }
      return a.name.localeCompare(b.name, 'zh-CN')
    })
    for (const node of nodes) {
      if (node.isDir) sortNodes(node.children)
    }
  }
  countFiles(root)
  sortNodes(root)
  return root
}

function collectDirs(nodes: TreeNode[], result: string[] = []): string[] {
  for (const node of nodes) {
    if (!node.isDir) continue
    result.push(node.path)
    collectDirs(node.children, result)
  }
  return result
}

function compareGameVersion(left: string, right: string): number {
  const a = left.split(/[.+-]/).map((part) => Number.parseInt(part, 10) || 0)
  const b = right.split(/[.+-]/).map((part) => Number.parseInt(part, 10) || 0)
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0)
    if (delta !== 0) return delta
  }
  return 0
}

function tagNamespaceFor(instance: InstanceSummary | null): 'forge' | 'c' {
  if (!instance) return 'c'
  const oldForge =
    (instance.loader === 'forge' || instance.loader === 'neoforge') &&
    compareGameVersion(instance.gameVersion, '1.20.5') < 0
  return oldForge ? 'forge' : 'c'
}

function fileKind(path: string): string {
  const lower = path.toLowerCase()
  if (lower.endsWith('.js')) return 'JavaScript'
  if (lower.endsWith('.json')) return 'JSON'
  if (lower.endsWith('.snbt')) return 'SNBT'
  if (lower.endsWith('.properties')) return 'Properties'
  if (lower.endsWith('.md')) return 'Markdown'
  return '文本'
}

function nowTime(): string {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false })
}

export function KubeJsWorkbench({
  instance,
  active,
  onDirtyChange,
  onBusyChange,
  onFileCountChange
}: {
  instance: InstanceSummary | null
  active: boolean
  onDirtyChange: (dirty: boolean) => void
  onBusyChange: (busy: boolean) => void
  onFileCountChange: (count: number) => void
}) {
  const toast = useLauncher((state) => state.toast)
  const [files, setFiles] = useState<KubeJsFileView[]>([])
  const [tabs, setTabs] = useState<WorkbenchTab[]>([])
  const [activePath, setActivePath] = useState('')
  const [templates, setTemplates] = useState<KubeJsTemplateView[]>([])
  const [loadingFiles, setLoadingFiles] = useState(true)
  const [opening, setOpening] = useState(false)
  const [saving, setSaving] = useState(false)
  const [fileBusy, setFileBusy] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [newFileOpen, setNewFileOpen] = useState(false)
  const [newPath, setNewPath] = useState('server_scripts/new_script.js')
  const [renameOpen, setRenameOpen] = useState(false)
  const [renamePath, setRenamePath] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [cursor, setCursor] = useState({ line: 1, column: 1 })
  const [diagnostics, setDiagnostics] = useState<Record<string, KubeJsDiagnostic[]>>({})
  const [lintIndexReady, setLintIndexReady] = useState(false)
  const [rightTab, setRightTab] = useState<
    'knowledge' | 'qa' | 'recipe' | 'tag' | 'explain' | 'problems' | 'ai'
  >('knowledge')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [runtimeOpen, setRuntimeOpen] = useState(false)
  const [conflict, setConflict] = useState<ConflictState | null>(null)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState('')
  const [aiResult, setAiResult] = useState<KubeJsAiResult | null>(null)
  const [editorSelection, setEditorSelection] = useState<KubeJsEditorSelection | null>(null)
  const [aiSelection, setAiSelection] = useState<
    (KubeJsEditorSelection & { path: string }) | null
  >(null)
  const [wrap, setWrap] = useState(() => readPreference(WRAP_KEY, false))
  const [fontSize, setFontSize] = useState(() =>
    Math.min(20, Math.max(10, readPreference(FONT_KEY, 12)))
  )
  const [savedAt, setSavedAt] = useState('')
  const editorRef = useRef<KubeJsEditorHandle>(null)
  const sessionReady = useRef(false)
  const newInputRef = useRef<HTMLInputElement | null>(null)
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const pendingJump = useRef<{ path: string; line: number; column?: number } | null>(null)

  const availableTemplates = useMemo(() => {
    const tagNamespace = tagNamespaceFor(instance)
    const gameVersion = instance?.gameVersion ?? ''
    return templates.filter((template) => {
      if (template.tagNamespace && template.tagNamespace !== tagNamespace) return false
      if (template.loaders && instance && !template.loaders.includes(instance.loader)) return false
      if (template.minGameVersion && compareGameVersion(gameVersion, template.minGameVersion) < 0) {
        return false
      }
      if (template.maxGameVersion && compareGameVersion(gameVersion, template.maxGameVersion) > 0) {
        return false
      }
      return true
    })
  }, [templates, instance?.id, instance?.gameVersion, instance?.loader])

  const templateGroups = useMemo(() => {
    const groups = new Map<string, KubeJsTemplateView[]>()
    for (const template of availableTemplates) {
      const category = template.category || '其他'
      const list = groups.get(category) ?? []
      list.push(template)
      groups.set(category, list)
    }
    return [...groups.entries()]
  }, [availableTemplates])

  const activeTab = tabs.find((tab) => tab.path === activePath) ?? null
  const dirtyTabs = tabs.filter((tab) => tab.content !== tab.original)
  const activeDirty = Boolean(activeTab && activeTab.content !== activeTab.original)
  const activeDiagnostics = activePath ? diagnostics[activePath] ?? [] : []
  const activeErrors = activeDiagnostics.filter((issue) => issue.severity === 'error').length
  const activeWarnings = activeDiagnostics.filter((issue) => issue.severity === 'warning').length
  const lintAvailable = Boolean(activeTab && /\.(?:js|json)$/i.test(activeTab.path))
  const aiSelectionTooLarge = Boolean(editorSelection && editorSelection.length > 12000)
  const lintOverrides = useMemo(
    () => tabs.map((tab) => ({ path: tab.path, content: tab.content })),
    [tabs]
  )
  const busy = saving || fileBusy || opening || aiBusy
  const tree = useMemo(() => buildTree(files), [files])
  const filteredFiles = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return []
    return files.filter((file) => file.path.toLowerCase().includes(keyword))
  }, [files, query])

  useEffect(() => {
    onDirtyChange(dirtyTabs.length > 0)
  }, [dirtyTabs.length, onDirtyChange])

  useEffect(() => {
    onBusyChange(busy)
  }, [busy, onBusyChange])

  useEffect(() => {
    onFileCountChange(files.length)
  }, [files.length, onFileCountChange])

  useEffect(() => {
    writePreference(WRAP_KEY, wrap)
  }, [wrap])

  useEffect(() => {
    writePreference(FONT_KEY, fontSize)
  }, [fontSize])

  useEffect(() => {
    if (templateId && !availableTemplates.some((template) => template.id === templateId)) {
      setTemplateId('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableTemplates, templateId])

  useEffect(() => {
    setEditorSelection(null)
    setAiSelection(null)
    setAiResult(null)
    setAiError('')
  }, [activePath])

  useEffect(() => {
    const jump = pendingJump.current
    if (!jump || jump.path !== activePath || !active) return
    const timer = window.setTimeout(() => {
      if (pendingJump.current !== jump) return
      pendingJump.current = null
      editorRef.current?.gotoLine(jump.line, jump.column)
    }, 90)
    return () => window.clearTimeout(timer)
  }, [activePath, active, tabs.length])

  useEffect(() => {
    if (!active || rightTab !== 'problems') return
    const timer = window.setTimeout(() => editorRef.current?.relint(), 150)
    return () => window.clearTimeout(timer)
  }, [active, rightTab, activePath, instance?.id])

  useEffect(() => {
    if (newFileOpen) requestAnimationFrame(() => newInputRef.current?.focus())
  }, [newFileOpen])

  useEffect(() => {
    if (renameOpen) requestAnimationFrame(() => renameInputRef.current?.focus())
  }, [renameOpen])

  useEffect(() => {
    if (!sessionReady.current || !instance) return
    writePreference(`${SESSION_PREFIX}${instance.id}`, {
      tabs: tabs.filter((tab) => !tab.isNew).map((tab) => tab.path),
      active: activePath
    })
  }, [tabs, activePath, instance])

  const refreshFiles = async (): Promise<KubeJsFileView[]> => {
    if (!instance) return []
    const next = await window.ccl.workshop.kubejsFiles(instance.id)
    setFiles(next.files)
    const dirs = collectDirs(buildTree(next.files))
    setExpanded((current) => (current.size === 0 ? new Set(dirs) : current))
    return next.files
  }

  useEffect(() => {
    if (!instance) return
    let cancelled = false
    setLoadingFiles(true)
    setError('')
    setTabs([])
    setActivePath('')
    setDiagnostics({})
    setSavedAt('')
    setAiPrompt('')
    setAiResult(null)
    setAiError('')
    setEditorSelection(null)
    setAiSelection(null)
    setRightTab('knowledge')
    sessionReady.current = false
    void (async () => {
      try {
        const [list, templateList] = await Promise.all([
          window.ccl.workshop.kubejsFiles(instance.id),
          window.ccl.workshop.kubejsTemplates().catch(() => [])
        ])
        if (cancelled) return
        setFiles(list.files)
        setTemplates(templateList)
        setExpanded(new Set(collectDirs(buildTree(list.files))))
        const saved = readPreference<{ tabs?: string[]; active?: string } | null>(
          `${SESSION_PREFIX}${instance.id}`,
          null
        )
        const available = new Set(list.files.map((file) => file.path))
        let paths = Array.isArray(saved?.tabs)
          ? saved.tabs.filter((path) => typeof path === 'string' && available.has(path))
          : []
        if (paths.length === 0) {
          const first =
            list.files.find(
              (file) =>
                file.path.startsWith('server_scripts/') &&
                !file.path.slice('server_scripts/'.length).includes('/')
            ) ??
            list.files.find((file) => file.path.startsWith('server_scripts/')) ??
            list.files[0]
          paths = first ? [first.path] : []
        }
        paths = [...new Set(paths)].slice(0, 12)
        const loaded: WorkbenchTab[] = []
        for (const path of paths) {
          try {
            const file = await window.ccl.workshop.kubejsRead(instance.id, path)
            loaded.push(toTab(file))
          } catch {
            /* skip files that disappeared */
          }
        }
        if (cancelled) return
        setTabs(loaded)
        const preferred =
          saved?.active && loaded.some((tab) => tab.path === saved.active)
            ? saved.active
            : loaded[0]?.path ?? ''
        setActivePath(preferred)
        sessionReady.current = true
      } catch (cause) {
        if (!cancelled) setError(cleanError(cause))
      } finally {
        if (!cancelled) setLoadingFiles(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [instance?.id])

  const updateTab = (path: string, patch: Partial<WorkbenchTab>) => {
    setTabs((current) =>
      current.map((tab) => (tab.path === path ? { ...tab, ...patch } : tab))
    )
  }

  const applyFile = (file: KubeJsFileContent, activate = true) => {
    setTabs((current) => {
      const index = current.findIndex((tab) => tab.path === file.path)
      if (index < 0) return [...current, toTab(file)]
      const next = [...current]
      next[index] = toTab(file)
      return next
    })
    if (activate) setActivePath(file.path)
  }

  const openPath = async (path: string) => {
    if (!instance) return
    if (tabs.some((tab) => tab.path === path)) {
      setActivePath(path)
      return
    }
    setOpening(true)
    setError('')
    try {
      const file = await window.ccl.workshop.kubejsRead(instance.id, path)
      applyFile(file)
    } catch (cause) {
      setError(cleanError(cause))
      toast('error', '无法打开 KubeJS 文件', cleanError(cause))
    } finally {
      setOpening(false)
    }
  }

  const jumpTo = (targetPath: string, line: number, column?: number) => {
    if (!targetPath) return
    if (targetPath === activePath) {
      editorRef.current?.gotoLine(line, column)
      return
    }
    pendingJump.current = { path: targetPath, line, column }
    void openPath(targetPath)
  }

  const openRuntimeCheck = () => {
    if (!instance) return
    if (dirtyTabs.length > 0) {
      toast('info', '先保存所有修改', '实际运行验证读取磁盘文件，请先保存所有标签')
      return
    }
    setRuntimeOpen(true)
  }

  const removeTab = (path: string) => {
    editorRef.current?.forget(path)
    const index = tabs.findIndex((tab) => tab.path === path)
    const next = tabs.filter((tab) => tab.path !== path)
    setTabs(next)
    setDiagnostics((current) => {
      const copy = { ...current }
      delete copy[path]
      return copy
    })
    if (activePath === path) {
      setActivePath(next[Math.min(Math.max(index, 0), Math.max(next.length - 1, 0))]?.path ?? '')
    }
  }

  const closeTab = (path: string) => {
    const tab = tabs.find((item) => item.path === path)
    if (!tab) return
    if (tab.content !== tab.original && !window.confirm(`关闭 ${path}？未保存的修改会丢失。`)) {
      return
    }
    removeTab(path)
  }

  const cycleTab = (direction: 1 | -1) => {
    if (tabs.length < 2) return
    const index = tabs.findIndex((tab) => tab.path === activePath)
    const next = (index + direction + tabs.length) % tabs.length
    setActivePath(tabs[next].path)
  }

  const createFile = () => {
    const path = normalizePath(newPath)
    if (!validClientPath(path)) {
      toast('error', '文件路径无效', '请使用 kubejs 内的相对路径，并以 .js / .json 等结尾')
      return
    }
    if (files.some((file) => file.path === path) || tabs.some((tab) => tab.path === path)) {
      toast('error', '文件已存在', path)
      return
    }
    const tab: WorkbenchTab = {
      path,
      content: '',
      original: '',
      bom: false,
      lineEnding: 'lf',
      modified: null,
      size: 0,
      isNew: true
    }
    setTabs((current) => [...current, tab])
    setActivePath(path)
    setNewFileOpen(false)
    setNewPath('server_scripts/new_script.js')
    setError('')
    const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
    if (parent) {
      setExpanded((current) => {
        const next = new Set(current)
        const parts = parent.split('/')
        let prefix = ''
        for (const part of parts) {
          prefix = prefix ? `${prefix}/${part}` : part
          next.add(prefix)
        }
        return next
      })
    }
    setRightTab('explain')
    requestAnimationFrame(() => editorRef.current?.focus())
  }

  const saveTab = async (tab: WorkbenchTab, force = false): Promise<boolean> => {
    if (!instance) return false
    setSaving(true)
    setError('')
    try {
      const result = await window.ccl.workshop.kubejsSave({
        instanceId: instance.id,
        path: tab.path,
        content: tab.content,
        bom: tab.bom,
        lineEnding: tab.lineEnding,
        expectedModified: tab.isNew ? null : tab.modified,
        force
      })
      if (!result.ok) {
        setConflict({ path: tab.path, reason: result.reason, modified: result.conflictModified })
        return false
      }
      applyFile(result.file, tab.path === activePath)
      setSavedAt(nowTime())
      toast('success', 'KubeJS 已保存', result.file.path)
      await refreshFiles()
      return true
    } catch (cause) {
      const message = cleanError(cause)
      setError(message)
      toast('error', '保存 KubeJS 失败', message)
      return false
    } finally {
      setSaving(false)
    }
  }

  const saveCurrent = async () => {
    if (!activeTab || saving) return
    if (activeTab.content === activeTab.original && !activeTab.isNew) {
      toast('info', '没有需要保存的修改')
      return
    }
    await saveTab(activeTab)
  }

  const saveAll = async () => {
    if (saving || dirtyTabs.length === 0) return
    for (const tab of dirtyTabs) {
      const ok = await saveTab(tab)
      if (!ok) return
    }
    toast('success', 'KubeJS 全部保存', `${dirtyTabs.length} 个文件`)
  }

  const resolveConflictReload = async () => {
    if (!conflict || !instance) return
    const { path, reason } = conflict
    setConflict(null)
    if (reason === 'deleted') {
      removeTab(path)
      toast('info', '文件已不在磁盘上', '标签已关闭')
      return
    }
    try {
      const file = await window.ccl.workshop.kubejsRead(instance.id, path)
      applyFile(file)
      toast('success', '已重新加载磁盘版本', path)
    } catch (cause) {
      setError(cleanError(cause))
    }
  }

  const resolveConflictForce = async () => {
    if (!conflict) return
    const tab = tabs.find((item) => item.path === conflict.path)
    setConflict(null)
    if (tab) await saveTab({ ...tab }, true)
  }

  const applyTextFixes = (changes: { from: number; to: number; text: string }[]) => {
    if (changes.length === 0) return
    editorRef.current?.applyChanges(changes)
    toast(
      'success',
      '已应用修复',
      `${changes.length} 处修改，仅在编辑器中；保存后写入文件`
    )
  }

  const moveFileForFix = async (targetPath: string) => {
    if (!instance || !activeTab) return
    if (activeTab.isNew || activeDirty) {
      toast('info', '请先保存', '有未保存修改时不能移动脚本到其它脚本侧')
      return
    }
    if (targetPath === activeTab.path || fileBusy) return
    setFileBusy(true)
    setError('')
    try {
      const file = await window.ccl.workshop.kubejsRename({
        instanceId: instance.id,
        from: activeTab.path,
        to: targetPath
      })
      const oldPath = activeTab.path
      editorRef.current?.forget(oldPath)
      setTabs((current) =>
        current.map((tab) => (tab.path === oldPath ? toTab(file) : tab))
      )
      setActivePath(file.path)
      setDiagnostics((current) => {
        const copy = { ...current }
        delete copy[oldPath]
        return copy
      })
      await refreshFiles()
      toast('success', '已移动到正确脚本侧', file.path)
    } catch (cause) {
      const message = cleanError(cause)
      setError(message)
      toast('error', '移动脚本失败', message)
    } finally {
      setFileBusy(false)
    }
  }

  const startRename = () => {
    if (!activeTab) return
    if (activeDirty) {
      toast('info', '请先保存', '有未保存修改时不能重命名')
      return
    }
    setRenamePath(activeTab.path)
    setRenameOpen(true)
  }

  const submitRename = async () => {
    if (!instance || !activeTab) return
    const target = normalizePath(renamePath)
    if (target === activeTab.path) {
      setRenameOpen(false)
      return
    }
    if (!validClientPath(target)) {
      toast('error', '文件路径无效', '请使用 kubejs 内的相对路径，并以 .js / .json 等结尾')
      return
    }
    setFileBusy(true)
    setError('')
    try {
      const file = await window.ccl.workshop.kubejsRename({
        instanceId: instance.id,
        from: activeTab.path,
        to: target
      })
      const oldPath = activeTab.path
      editorRef.current?.forget(oldPath)
      setTabs((current) =>
        current.map((tab) => (tab.path === oldPath ? toTab(file) : tab))
      )
      setActivePath(file.path)
      setRenameOpen(false)
      setDiagnostics((current) => {
        const copy = { ...current }
        delete copy[oldPath]
        return copy
      })
      await refreshFiles()
      toast('success', 'KubeJS 文件已重命名', file.path)
    } catch (cause) {
      const message = cleanError(cause)
      setError(message)
      toast('error', '重命名失败', message)
    } finally {
      setFileBusy(false)
    }
  }

  const removeFile = async () => {
    if (!instance || !activeTab) return
    const tab = activeTab
    if (tab.isNew) {
      if (tab.content !== tab.original && !window.confirm('放弃这个未保存的新文件吗？')) return
      removeTab(tab.path)
      return
    }
    if (!window.confirm(`删除 ${tab.path}？删除前会备份到实例的 backups/kubejs。`)) return
    setFileBusy(true)
    setError('')
    try {
      await window.ccl.workshop.kubejsRemove(instance.id, tab.path)
      removeTab(tab.path)
      await refreshFiles()
      toast('success', 'KubeJS 文件已删除', '原文件已备份')
    } catch (cause) {
      const message = cleanError(cause)
      setError(message)
      toast('error', '删除失败', message)
    } finally {
      setFileBusy(false)
    }
  }

  const insertTemplate = () => {
    const template = templates.find((item) => item.id === templateId)
    if (!template) return
    if (!activeTab) {
      toast('info', '先打开一个文件', '模板会插入到当前脚本的光标位置')
      return
    }
    editorRef.current?.insert(template.code)
  }

  const generateAi = async () => {
    if (!instance || !aiPrompt.trim() || aiBusy) return
    if (aiSelectionTooLarge) {
      setAiError('选区超过 12000 字符，请缩小选区后重试')
      return
    }
    const selection =
      activeTab && editorSelection
        ? { ...editorSelection, path: activeTab.path }
        : null
    setAiBusy(true)
    setAiError('')
    setAiResult(null)
    setAiSelection(selection)
    try {
      const result = await window.ccl.workshop.kubejsAi({
        instanceId: instance.id,
        prompt: aiPrompt.trim(),
        currentPath: activeTab?.path ?? null,
        currentContent: activeTab?.content ?? null,
        selection: selection
          ? {
              startLine: selection.startLine,
              endLine: selection.endLine,
              text: selection.text
            }
          : null
      })
      setAiResult(result)
    } catch (cause) {
      setAiError(cleanError(cause))
    } finally {
      setAiBusy(false)
    }
  }

  const applyAiSelection = () => {
    if (!aiResult || !aiSelection) return
    if (!activeTab || activeTab.path !== aiSelection.path) {
      setAiError('请回到生成时选中的文件再应用改写')
      return
    }
    if (
      aiSelection.from < 0 ||
      aiSelection.to > activeTab.content.length ||
      activeTab.content.slice(aiSelection.from, aiSelection.to) !== aiSelection.text
    ) {
      setAiError('选区内容已经变化，请重新生成改写')
      return
    }
    editorRef.current?.replaceRange(
      aiSelection.from,
      aiSelection.to,
      aiResult.code
    )
    setAiResult(null)
    setAiSelection(null)
    setEditorSelection(null)
    setAiError('')
    toast('success', 'AI 已替换选区', '只改了选中的代码，仍然需要手动保存')
    requestAnimationFrame(() => editorRef.current?.focus())
  }

  const discardAiResult = () => {
    setAiResult(null)
    setAiSelection(null)
    setAiError('')
  }

  const applyAiCode = (mode: 'insert' | 'replace') => {
    if (!aiResult) return
    if (!activeTab) {
      let path = 'server_scripts/ai-generated.js'
      if (files.some((file) => file.path === path) || tabs.some((tab) => tab.path === path)) {
        path = `server_scripts/ai-generated-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}.js`
      }
      const tab: WorkbenchTab = {
        path,
        content: aiResult.code,
        original: '',
        bom: false,
        lineEnding: 'lf',
        modified: null,
        size: 0,
        isNew: true
      }
      setTabs((current) => [...current, tab])
      setActivePath(path)
      toast('success', 'AI 脚本已放入新标签', '检查后按 Ctrl+S 保存')
      requestAnimationFrame(() => editorRef.current?.focus())
      return
    }
    if (mode === 'insert') {
      editorRef.current?.insert(aiResult.code)
      toast('success', 'AI 代码已插入光标位置', '仍然需要手动保存')
      return
    }
    if (
      activeDirty &&
      !window.confirm('当前文件有未保存修改，用 AI 生成内容替换编辑器吗？')
    ) {
      return
    }
    updateTab(activeTab.path, { content: aiResult.code })
    setAiError('')
    toast('success', 'AI 代码已放入编辑器', '没有自动保存')
    requestAnimationFrame(() => editorRef.current?.focus())
  }

  const insertKnowledgeId = (id: string) => {
    if (!activeTab) {
      toast('info', '先打开一个脚本', '知识库 ID 需要插入到当前 KubeJS 文件')
      return
    }
    editorRef.current?.insertId(id)
  }

  const insertKnowledgeCode = (code: string) => {
    if (!activeTab) {
      toast('info', '先打开一个脚本', '删除代码需要插入到当前 KubeJS 文件')
      return
    }
    editorRef.current?.insert(code)
  }

  const insertRecipeCode = (code: string) => {
    if (!activeTab) {
      toast('info', '先打开一个脚本', '配方代码需要插入到当前 KubeJS 文件')
      return
    }
    editorRef.current?.insertAtCursor(code)
    toast('success', '配方代码已插入光标', '仍是未保存状态，检查后 Ctrl+S')
    requestAnimationFrame(() => editorRef.current?.focus())
  }

  const replaceRecipeCode = (code: string) => {
    if (!activeTab) {
      toast('info', '先打开一个脚本', '配方代码需要写入当前 KubeJS 文件')
      return
    }
    if (!editorSelection) {
      toast('info', '先在编辑器选中要替换的代码', '没有选区时可以改用「插入光标」')
      return
    }
    editorRef.current?.replaceRange(editorSelection.from, editorSelection.to, code)
    toast('success', '配方代码已替换选区', '只改了选中的代码，仍未保存')
    requestAnimationFrame(() => editorRef.current?.focus())
  }

  const insertTagCode = (code: string) => {
    if (!activeTab) {
      toast('info', '先打开一个脚本', '标签代码需要插入到当前 KubeJS 文件')
      return
    }
    editorRef.current?.insertAtCursor(code)
    toast('success', '标签代码已插入光标', '仍是未保存状态，检查后 Ctrl+S')
    requestAnimationFrame(() => editorRef.current?.focus())
  }

  const replaceTagCode = (code: string) => {
    if (!activeTab) {
      toast('info', '先打开一个脚本', '标签代码需要写入当前 KubeJS 文件')
      return
    }
    if (!editorSelection) {
      toast('info', '先在编辑器选中要替换的代码', '没有选区时可以改用「插入光标」')
      return
    }
    editorRef.current?.replaceRange(editorSelection.from, editorSelection.to, code)
    toast('success', '标签代码已替换选区', '只改了选中的代码，仍未保存')
    requestAnimationFrame(() => editorRef.current?.focus())
  }

  const onEditorSelection = (selection: KubeJsEditorSelection | null) => {
    setEditorSelection(selection)
  }

  const onEditorDiagnostics = (
    path: string,
    list: KubeJsDiagnostic[],
    indexReady: boolean
  ) => {
    setDiagnostics((current) => ({ ...current, [path]: list }))
    setLintIndexReady(indexReady)
  }

  useEffect(() => {
    if (!active) return
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'F2' || renameOpen) return
      const target = event.target as HTMLElement | null
      if (target?.closest('.cm-panel')) return
      if (target?.closest('input, textarea, select') && !target.closest('.cm-editor')) return
      if (!activeTab) return
      event.preventDefault()
      startRename()
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, activeTab?.path, activeDirty, renameOpen])

  const handleRestored = (file: KubeJsFileContent) => {
    applyFile(file)
    setSavedAt(nowTime())
    void refreshFiles()
  }

  const renderTreeNodes = (nodes: TreeNode[], depth = 0): ReactNode =>
    nodes.map((node) => {
      if (node.isDir) {
        const isOpen = expanded.has(node.path)
        return (
          <div key={`dir-${node.path}`} className="kjs-tree-group">
            <button
              type="button"
              className="kjs-tree-row is-dir"
              style={{ paddingLeft: 8 + depth * 12 }}
              onClick={() =>
                setExpanded((current) => {
                  const next = new Set(current)
                  if (next.has(node.path)) next.delete(node.path)
                  else next.add(node.path)
                  return next
                })
              }
            >
              <ChevronRight size={10} className={isOpen ? 'is-open' : ''} />
              {isOpen ? <FolderOpen size={12} /> : <Folder size={12} />}
              <span>{node.name}</span>
              <em>{node.count}</em>
            </button>
            {isOpen && renderTreeNodes(node.children, depth + 1)}
          </div>
        )
      }
      const tab = tabs.find((item) => item.path === node.path)
      const dirty = Boolean(tab && tab.content !== tab.original)
      return (
        <button
          key={`file-${node.path}`}
          type="button"
          className={`kjs-tree-row is-file ${activePath === node.path ? 'is-active' : ''}`}
          style={{ paddingLeft: 18 + depth * 12 }}
          title={node.path}
          onClick={() => void openPath(node.path)}
        >
          <FileCode2 size={11} />
          <span>{node.name}</span>
          {dirty && <i />}
        </button>
      )
    })

  if (!instance) return null

  return (
    <>
      <div className={`kjs-workbench ${active ? 'is-active' : ''}`}>
        <aside className="kjs-sidebar">
          <div className="kjs-sidebar-head">
            <strong>文件</strong>
            <span>{files.length}</span>
            <button
              type="button"
              className="kjs-icon-btn"
              title="刷新文件列表"
              onClick={() => void refreshFiles()}
              disabled={loadingFiles || busy}
            >
              <RefreshCw size={11} />
            </button>
            <button
              type="button"
              className="kjs-icon-btn"
              title="新建文件"
              onClick={() => {
                setNewFileOpen((current) => !current)
                setNewPath('server_scripts/new_script.js')
              }}
            >
              <FilePlus2 size={12} />
            </button>
          </div>
          <div className="kjs-file-search">
            <Search size={11} />
            <input
              value={query}
              placeholder="过滤文件或路径"
              onChange={(event) => setQuery(event.target.value)}
            />
            {query && (
              <button type="button" className="kjs-icon-btn" onClick={() => setQuery('')}>
                <X size={10} />
              </button>
            )}
          </div>
          {newFileOpen && (
            <div className="kjs-new-file">
              <input
                ref={newInputRef}
                value={newPath}
                spellCheck={false}
                placeholder="server_scripts/new_script.js"
                onChange={(event) => setNewPath(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') createFile()
                  if (event.key === 'Escape') setNewFileOpen(false)
                }}
              />
              <button type="button" className="kjs-icon-btn is-accent" onClick={createFile} title="创建">
                <Check size={12} />
              </button>
              <button
                type="button"
                className="kjs-icon-btn"
                onClick={() => setNewFileOpen(false)}
                title="取消"
              >
                <X size={11} />
              </button>
            </div>
          )}
          <div className="kjs-tree">
            {loadingFiles ? (
              <div className="kjs-tree-loading">
                <Spinner size={13} />
                正在读取…
              </div>
            ) : files.length === 0 ? (
              <div className="kjs-tree-empty">
                <FileCode2 size={18} />
                <span>还没有 KubeJS 文件</span>
                <small>新建脚本后保存一次，KubeJS 目录会自动创建。</small>
              </div>
            ) : query.trim() ? (
              filteredFiles.length === 0 ? (
                <div className="kjs-tree-empty">
                  <span>没有匹配的文件</span>
                </div>
              ) : (
                filteredFiles.map((file) => {
                  const tab = tabs.find((item) => item.path === file.path)
                  const dirty = Boolean(tab && tab.content !== tab.original)
                  return (
                    <button
                      key={file.path}
                      type="button"
                      className={`kjs-tree-row is-file ${activePath === file.path ? 'is-active' : ''}`}
                      style={{ paddingLeft: 12 }}
                      title={file.path}
                      onClick={() => void openPath(file.path)}
                    >
                      <FileCode2 size={11} />
                      <span>{file.path}</span>
                      {dirty && <i />}
                    </button>
                  )
                })
              )
            ) : (
              renderTreeNodes(tree)
            )}
          </div>
          <div className="kjs-sidebar-foot">
            <button
              type="button"
              className="kjs-side-foot-btn"
              title="KubeJS 工作台使用说明"
              onClick={() => setHelpOpen(true)}
            >
              <BookOpen size={11} />
              说明
            </button>
            <button type="button" className="kjs-side-foot-btn" onClick={() => setHistoryOpen(true)}>
              <History size={11} />
              历史
            </button>
            <button
              type="button"
              className="kjs-side-foot-btn"
              onClick={() => void window.ccl.instances.openFolder(instance.id, 'kubejs')}
            >
              <FolderOpen size={11} />
              目录
            </button>
          </div>
        </aside>

        <main className="kjs-main">
          <div className="kjs-tabs">
            {tabs.map((tab) => {
              const dirty = tab.content !== tab.original
              const name = tab.path.split('/').pop() ?? tab.path
              return (
                <div
                  key={tab.path}
                  className={`kjs-tab ${activePath === tab.path ? 'is-active' : ''}`}
                  title={tab.path}
                >
                  <button type="button" className="kjs-tab-name" onClick={() => setActivePath(tab.path)}>
                    <FileCode2 size={10} />
                    <span>{name}</span>
                    {dirty && <i />}
                  </button>
                  <button
                    type="button"
                    className="kjs-tab-close"
                    title="关闭"
                    onClick={() => closeTab(tab.path)}
                  >
                    <X size={9} />
                  </button>
                </div>
              )
            })}
            <button
              type="button"
              className="kjs-tab-add"
              title="新建文件"
              onClick={() => {
                setNewFileOpen(true)
                setNewPath('server_scripts/new_script.js')
              }}
            >
              <Plus size={12} />
            </button>
            <button
              type="button"
              className="kjs-tab-help"
              title="KubeJS 工作台使用说明"
              onClick={() => setHelpOpen(true)}
            >
              <BookOpen size={12} />
            </button>
          </div>

          {activeTab ? (
            <>
              <div className="kjs-editor-head">
                <div className="kjs-editor-path">
                  {renameOpen ? (
                    <div className="kjs-rename">
                      <input
                        ref={renameInputRef}
                        value={renamePath}
                        spellCheck={false}
                        onChange={(event) => setRenamePath(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') void submitRename()
                          if (event.key === 'Escape') setRenameOpen(false)
                        }}
                      />
                      <button
                        type="button"
                        className="kjs-icon-btn is-accent"
                        onClick={() => void submitRename()}
                        title="确认重命名"
                      >
                        <Check size={12} />
                      </button>
                      <button
                        type="button"
                        className="kjs-icon-btn"
                        onClick={() => setRenameOpen(false)}
                        title="取消"
                      >
                        <X size={11} />
                      </button>
                    </div>
                  ) : (
                    <>
                      <strong title={activeTab.path}>{activeTab.path}</strong>
                      <span>
                        {activeTab.isNew ? '新文件' : formatBytes(activeTab.size)}
                        {activeDirty ? ' · 未保存' : activeTab.modified ? ` · ${formatDateTime(activeTab.modified)}` : ''}
                      </span>
                    </>
                  )}
                </div>
                <div className="kjs-editor-actions">
                  <select
                    value={templateId}
                    onChange={(event) => setTemplateId(event.target.value)}
                    className="kjs-template-select"
                    title={`可用模板：${tagNamespaceFor(instance)}: 标签 · ${instance.gameVersion}`}
                  >
                    <option value="">模板…</option>
                    {templateGroups.map(([category, list]) => (
                      <optgroup key={category} label={category}>
                        {list.map((template) => (
                          <option key={template.id} value={template.id}>
                            {template.name}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="kjs-action-btn"
                    onClick={insertTemplate}
                    disabled={!templateId || busy}
                    title="插入到光标位置"
                  >
                    插入
                  </button>
                  <button
                    type="button"
                    className="kjs-action-btn is-icon"
                    title="重命名（F2）"
                    onClick={startRename}
                    disabled={busy || activeDirty}
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    type="button"
                    className="kjs-action-btn is-icon is-danger"
                    title="删除文件"
                    onClick={() => void removeFile()}
                    disabled={busy}
                  >
                    <Trash2 size={11} />
                  </button>
                  <span className="kjs-action-divider" />
                  <button
                    type="button"
                    className={`kjs-action-btn is-icon ${wrap ? 'is-active' : ''}`}
                    title="自动换行"
                    onClick={() => setWrap((current) => !current)}
                  >
                    <WrapText size={11} />
                  </button>
                  <button
                    type="button"
                    className="kjs-action-btn is-icon"
                    title="缩小字号"
                    onClick={() => setFontSize((current) => Math.max(10, current - 1))}
                  >
                    <Minus size={10} />
                  </button>
                  <span className="kjs-font-size">{fontSize}</span>
                  <button
                    type="button"
                    className="kjs-action-btn is-icon"
                    title="放大字号"
                    onClick={() => setFontSize((current) => Math.min(20, current + 1))}
                  >
                    <Plus size={10} />
                  </button>
                  <button
                    type="button"
                    className="kjs-action-btn is-icon"
                    title="查找 / 替换（Ctrl+F）"
                    onClick={() => editorRef.current?.openSearch()}
                  >
                    <Search size={11} />
                  </button>
                </div>
              </div>

              <div className="kjs-editor-stage">
                <KubeJsCodeEditor
                  ref={editorRef}
                  path={activeTab.path}
                  instanceId={instance.id}
                  value={activeTab.content}
                  active={active}
                  wrap={wrap}
                  fontSize={fontSize}
                  onChange={(value) => updateTab(activeTab.path, { content: value })}
                  onCursor={(line, column) => setCursor({ line, column })}
                  onSelection={onEditorSelection}
                  onDiagnostics={onEditorDiagnostics}
                  onSave={() => void saveCurrent()}
                  onSaveAll={() => void saveAll()}
                  onClose={() => closeTab(activeTab.path)}
                  onCycleTab={cycleTab}
                />
                {opening && (
                  <div className="kjs-editor-overlay">
                    <Spinner size={14} />
                    正在打开…
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="kjs-editor-empty">
              {loadingFiles ? (
                <>
                  <Spinner size={16} />
                  正在读取 KubeJS…
                </>
              ) : (
                <>
                  <FileCode2 size={24} />
                  <strong>从左侧打开一个脚本</strong>
                  <span>支持多标签、查找替换、历史快照和释意。</span>
                  <button
                    type="button"
                    className="button button--soft button--sm"
                    onClick={() => {
                      setNewFileOpen(true)
                      setNewPath('server_scripts/new_script.js')
                    }}
                  >
                    <FilePlus2 size={12} />
                    新建脚本
                  </button>
                </>
              )}
            </div>
          )}

        </main>

        <aside className="kjs-inspector">
          <div className="kjs-inspector-tabs">
            <button
              type="button"
              className={`kjs-inspector-tab ${rightTab === 'knowledge' ? 'is-active' : ''}`}
              onClick={() => setRightTab('knowledge')}
            >
              <Library size={11} />
              知识
            </button>
            <button
              type="button"
              className={`kjs-inspector-tab ${rightTab === 'qa' ? 'is-active' : ''}`}
              onClick={() => setRightTab('qa')}
            >
              <MessageCircleQuestion size={11} />
              问答
            </button>
            <button
              type="button"
              className={`kjs-inspector-tab ${rightTab === 'recipe' ? 'is-active' : ''}`}
              onClick={() => setRightTab('recipe')}
            >
              <Wrench size={11} />
              配方
            </button>
            <button
              type="button"
              className={`kjs-inspector-tab ${rightTab === 'tag' ? 'is-active' : ''}`}
              onClick={() => setRightTab('tag')}
            >
              标签
            </button>
            <button
              type="button"
              className={`kjs-inspector-tab ${rightTab === 'explain' ? 'is-active' : ''}`}
              onClick={() => setRightTab('explain')}
            >
              释意
            </button>
            <button
              type="button"
              className={`kjs-inspector-tab ${rightTab === 'problems' ? 'is-active' : ''}`}
              onClick={() => setRightTab('problems')}
            >
              问题
              {activeErrors + activeWarnings > 0 && (
                <em className={activeErrors > 0 ? 'is-error' : ''}>
                  {activeErrors + activeWarnings}
                </em>
              )}
            </button>
            <button
              type="button"
              className={`kjs-inspector-tab ${rightTab === 'ai' ? 'is-active' : ''}`}
              onClick={() => setRightTab('ai')}
            >
              <Bot size={11} />
              AI
            </button>
          </div>
          <div className="kjs-inspector-body">
            {rightTab === 'knowledge' ? (
              <KubeJsKnowledgePanel
                instance={instance}
                active={active && rightTab === 'knowledge'}
                onInsertId={insertKnowledgeId}
                onInsert={insertKnowledgeCode}
              />
            ) : rightTab === 'recipe' ? null : rightTab === 'tag' ? null : rightTab === 'qa' ? null : rightTab === 'explain' ? (
              <KubeJsExplainPanel
                instance={instance}
                path={activeTab?.path ?? ''}
                content={activeTab?.content ?? ''}
                active={active && rightTab === 'explain'}
                onJump={(line) => editorRef.current?.gotoLine(line)}
              />
            ) : rightTab === 'ai' ? (
              <div className="kjs-ai-panel">
                <div className="kjs-ai-head">
                  <Bot size={13} />
                  <strong>AI 写 / 改写 KubeJS</strong>
                  <span>可选 · 显式点击</span>
                </div>
                <p className="kjs-ai-copy">
                  选中一段脚本可局部改写；没有选区时生成整份脚本。结果先放在这里预览，
                  不会自动写入或保存。
                </p>
                <textarea
                  value={aiPrompt}
                  className="kjs-ai-prompt"
                  spellCheck={false}
                  placeholder={
                    editorSelection
                      ? '例如：把选中的配方改成删除同标签下的所有物品'
                      : '例如：删除机械动力搅拌器的所有配方，并把钢锭统一到 forge:ingots/steel'
                  }
                  onChange={(event) => setAiPrompt(event.target.value)}
                />
                <div className="kjs-ai-row">
                  <span className="kjs-ai-target" title={editorSelection ? undefined : activeTab?.path}>
                    {editorSelection
                      ? aiSelectionTooLarge
                        ? `选区过长（${editorSelection.length.toLocaleString('zh-CN')} 字符）`
                        : `选区 L${editorSelection.startLine}–L${editorSelection.endLine} · ${editorSelection.endLine - editorSelection.startLine + 1} 行`
                      : `目标：${activeTab ? activeTab.path : '新文件 server_scripts/ai-generated.js'}`}
                  </span>
                  <button
                    type="button"
                    className="button button--primary button--sm"
                    disabled={!aiPrompt.trim() || aiBusy || saving || aiSelectionTooLarge}
                    onClick={() => void generateAi()}
                  >
                    {aiBusy ? <Spinner size={12} /> : <Sparkles size={12} />}
                    {aiBusy
                      ? aiSelection
                        ? '改写中…'
                        : '生成中…'
                      : editorSelection
                        ? '改写选区'
                        : '生成'}
                  </button>
                </div>
                {aiSelectionTooLarge && !aiError && (
                  <div className="kjs-check-note">选区最多 12000 字符；请缩小选区或取消选择。</div>
                )}
                {aiError && (
                  <div className="workshop-error is-compact">
                    <AlertTriangle size={12} />
                    <span>{aiError}</span>
                  </div>
                )}
                {aiBusy && !aiResult ? (
                  <div className="kjs-ai-loading">
                    <Spinner size={14} />
                    {aiSelection ? '正在让 AI 改写选区…' : '正在让 AI 写脚本…'}
                  </div>
                ) : aiResult ? (
                  <div className="kjs-ai-result">
                    <div className="kjs-ai-result-head">
                      <span>{aiSelection ? '选区改写预览' : '生成预览'}</span>
                      <em>{aiResult.model}</em>
                    </div>
                    {aiSelection ? (
                      <div className="kjs-ai-diff">
                        <DiffView
                          before={aiSelection.text}
                          after={aiResult.code}
                          labelBefore={`L${aiSelection.startLine}–${aiSelection.endLine}`}
                          labelAfter="AI 建议"
                        />
                      </div>
                    ) : (
                      <pre>{aiResult.code}</pre>
                    )}
                    {aiResult.notes && <p>{aiResult.notes}</p>}
                    <div className="kjs-ai-result-actions">
                      {aiSelection ? (
                        <>
                          <button
                            type="button"
                            className="button button--ghost button--sm"
                            onClick={discardAiResult}
                          >
                            放弃
                          </button>
                          <button
                            type="button"
                            className="button button--primary button--sm"
                            onClick={applyAiSelection}
                          >
                            替换选区
                          </button>
                        </>
                      ) : (
                        <>
                          {activeTab && (
                            <button
                              type="button"
                              className="button button--ghost button--sm"
                              onClick={() => applyAiCode('insert')}
                            >
                              插入光标
                            </button>
                          )}
                          <button
                            type="button"
                            className="button button--primary button--sm"
                            onClick={() => applyAiCode('replace')}
                          >
                            {activeTab ? '替换当前文件' : '放入新文件'}
                          </button>
                        </>
                      )}
                    </div>
                    <small>
                      {aiSelection
                        ? `只替换选中的 ${aiSelection.endLine - aiSelection.startLine + 1} 行，不会保存。`
                        : '应用后仍然是未保存状态，检查无误再 Ctrl+S。'}
                    </small>
                  </div>
                ) : (
                  !aiBusy && (
                    <div className="kjs-ai-empty">
                      <Sparkles size={16} />
                      <span>AI 只在点击「生成」时调用；未启用时其他功能不受影响。</span>
                    </div>
                  )
                )}
              </div>
            ) : (
              <KubeJsProblemsPanel
                instance={instance}
                active={active && rightTab === 'problems'}
                activePath={activeTab?.path ?? ''}
                content={activeTab?.content ?? ''}
                diagnostics={activeDiagnostics}
                indexReady={lintIndexReady}
                overrides={lintOverrides}
                onOpen={jumpTo}
                onApplyFixes={applyTextFixes}
                onMoveFix={(targetPath) => void moveFileForFix(targetPath)}
                onRuntimeCheck={openRuntimeCheck}
              />
            )}
            <div className="kjs-qa-host" hidden={rightTab !== 'qa'}>
              <KubeJsQaPanel
                instance={instance}
                active={active && rightTab === 'qa'}
                onOpenKnowledge={() => setRightTab('knowledge')}
              />
            </div>
            <div className="kjs-recipe-host" hidden={rightTab !== 'recipe'}>
              <KubeJsRecipeBuilder
                instance={instance}
                active={active && rightTab === 'recipe'}
                path={activeTab?.path ?? ''}
                hasSelection={Boolean(editorSelection)}
                onInsert={insertRecipeCode}
                onReplaceSelection={replaceRecipeCode}
                onOpenKnowledge={() => setRightTab('knowledge')}
              />
            </div>
            <div className="kjs-tag-host" hidden={rightTab !== 'tag'}>
              <KubeJsTagBuilder
                instance={instance}
                active={active && rightTab === 'tag'}
                path={activeTab?.path ?? ''}
                hasSelection={Boolean(editorSelection)}
                onInsert={insertTagCode}
                onReplaceSelection={replaceTagCode}
                onOpenKnowledge={() => setRightTab('knowledge')}
              />
            </div>
          </div>
        </aside>

        <div className="kjs-statusbar">
          <span>Ln {cursor.line}, Col {cursor.column}</span>
          <span>UTF-8{activeTab?.bom ? ' BOM' : ''}</span>
          <span>{activeTab?.lineEnding === 'crlf' ? 'CRLF' : 'LF'}</span>
          <span>{activeTab ? fileKind(activeTab.path) : '—'}</span>
          {!activeTab ? (
            <span>—</span>
          ) : !lintAvailable ? (
            <span>未做预检</span>
          ) : activeErrors > 0 ? (
            <button
              type="button"
              className="kjs-status-link is-warn"
              onClick={() => setRightTab('problems')}
            >
              预检 {activeErrors} 错误
              {activeWarnings > 0 ? ` · ${activeWarnings} 警告` : ''}
            </button>
          ) : activeWarnings > 0 ? (
            <button
              type="button"
              className="kjs-status-link is-warn"
              onClick={() => setRightTab('problems')}
            >
              预检 {activeWarnings} 警告
            </button>
          ) : (
            <span className="is-ok">预检通过</span>
          )}
          {savedAt && <span>已保存 {savedAt}</span>}
          <span className="kjs-status-spacer" />
          {dirtyTabs.length > 1 && (
            <button
              type="button"
              className="kjs-status-link"
              onClick={() => void saveAll()}
              disabled={saving}
            >
              保存全部
            </button>
          )}
          <button
            type="button"
            className="kjs-save-btn"
            onClick={() => void saveCurrent()}
            disabled={!activeTab || saving || (!activeDirty && !activeTab?.isNew)}
          >
            {saving ? <Spinner size={11} /> : <Save size={11} />}
            保存 Ctrl+S
          </button>
        </div>
        {error && (
          <div className="kjs-inline-error">
            <AlertTriangle size={12} />
            <span>{error}</span>
            <button type="button" className="kjs-icon-btn" onClick={() => setError('')}>
              <X size={10} />
            </button>
          </div>
        )}
      </div>

      <KubeJsRuntimeModal
        open={runtimeOpen}
        instance={instance}
        onClose={() => setRuntimeOpen(false)}
        onOpenIssue={jumpTo}
      />

      <KubeJsHelpModal
        open={helpOpen}
        instance={instance}
        onClose={() => setHelpOpen(false)}
        onOpenKnowledge={() => setRightTab('knowledge')}
      />

      <KubeJsHistoryModal
        open={historyOpen}
        instance={instance}
        currentPath={activeTab?.path ?? ''}
        dirtyPaths={dirtyTabs.map((tab) => tab.path)}
        onClose={() => setHistoryOpen(false)}
        onRestored={handleRestored}
      />

      <Modal
        open={Boolean(conflict)}
        onClose={() => setConflict(null)}
        title="文件已在磁盘上变化"
        subtitle={conflict ? conflict.path : ''}
        icon={<AlertTriangle size={18} />}
        size="sm"
        footer={
          <div className="kjs-conflict-actions">
            <button type="button" className="button button--ghost" onClick={() => setConflict(null)}>
              稍后处理
            </button>
            <button type="button" className="button button--ghost" onClick={() => void resolveConflictReload()}>
              {conflict?.reason === 'deleted'
                ? '关闭标签'
                : conflict?.reason === 'exists'
                  ? '打开磁盘文件'
                  : '重新加载磁盘版本'}
            </button>
            <button
              type="button"
              className="button button--danger"
              onClick={() => void resolveConflictForce()}
            >
              {conflict?.reason === 'deleted' ? '重新创建' : '仍然覆盖'}
            </button>
          </div>
        }
      >
        <p className="kjs-conflict-copy">
          {conflict?.reason === 'deleted'
            ? '这个文件已经不在磁盘上。你可以关闭标签，或用当前编辑器内容重新创建它。'
            : conflict?.reason === 'exists'
              ? '这个路径在磁盘上已经有文件。可以打开磁盘文件，或用当前内容覆盖它（会先备份）。'
              : `文件在编辑器打开后被修改过（磁盘时间 ${formatDateTime(conflict?.modified)}）。可以重新加载磁盘版本，或仍然用当前内容覆盖（会先备份）。`}
        </p>
        <p className="kjs-conflict-note">不会自动保存，也不会丢失备份。</p>
      </Modal>
    </>
  )
}
