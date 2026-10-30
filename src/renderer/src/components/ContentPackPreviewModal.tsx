import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Copy,
  File,
  FileArchive,
  FileImage,
  FileText,
  Folder,
  FolderOpen,
  Music,
  Palette,
  Search,
  Sparkles,
  X
} from 'lucide-react'
import type {
  ContentPackPreview,
  ContentPreviewEntry,
  ContentPreviewFile,
  ContentPreviewSearchResult,
  InstanceSummary,
  PreviewableContentKind
} from '@shared/types'
import { cleanError, formatBytes } from '../lib/format'
import { Badge, Modal, Spinner } from './ui'

const KIND_LABEL: Record<PreviewableContentKind, string> = {
  datapack: '数据包',
  resourcepack: '资源包',
  shader: '光影包'
}

const TEXT_EXT = new Set([
  'json',
  'json5',
  'mcmeta',
  'mcfunction',
  'snbt',
  'txt',
  'md',
  'lang',
  'properties',
  'cfg',
  'conf',
  'toml',
  'yaml',
  'yml',
  'csv',
  'log',
  'xml',
  'html',
  'css',
  'glsl',
  'vsh',
  'fsh',
  'gsh',
  'csh',
  'tesc',
  'tese',
  'geom',
  'comp',
  'vert',
  'frag',
  'rsh',
  'inc',
  'h',
  'hh',
  'js',
  'ts'
])

function kindIcon(kind: PreviewableContentKind | null, size = 15) {
  if (kind === 'resourcepack') return <Palette size={size} />
  if (kind === 'shader') return <Sparkles size={size} />
  return <FileArchive size={size} />
}

function extensionOf(path: string): string {
  const name = path.split('/').pop() ?? path
  if (!name.includes('.')) return ''
  return name.slice(name.lastIndexOf('.') + 1).toLowerCase()
}

function fileIcon(path: string) {
  const ext = extensionOf(path)
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) return <FileImage size={11} />
  if (['ogg', 'wav', 'mp3'].includes(ext)) return <Music size={11} />
  if (TEXT_EXT.has(ext)) return <FileText size={11} />
  return <File size={11} />
}

function fileKindLabel(file: ContentPreviewFile): string {
  if (file.kind === 'image') return '图片'
  if (file.kind === 'audio') return '音频'
  if (file.kind === 'text') return '文本'
  return '二进制'
}

export function ContentPackPreviewModal({
  open,
  instance,
  kind,
  file,
  name,
  onClose
}: {
  open: boolean
  instance: InstanceSummary | null
  kind: PreviewableContentKind | null
  file: string | null
  name: string | null
  onClose: () => void
}) {
  const [pack, setPack] = useState<ContentPackPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [children, setChildren] = useState<Record<string, ContentPreviewEntry[]>>({})
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set())
  const [dirTotals, setDirTotals] = useState<Record<string, number>>({})
  const [dirTruncated, setDirTruncated] = useState<Set<string>>(new Set())
  const [dirErrors, setDirErrors] = useState<Record<string, string>>({})
  const [query, setQuery] = useState('')
  const [searchResult, setSearchResult] = useState<ContentPreviewSearchResult | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [fileData, setFileData] = useState<ContentPreviewFile | null>(null)
  const [fileLoading, setFileLoading] = useState(false)
  const [fileError, setFileError] = useState('')
  const [copied, setCopied] = useState(false)
  const fileSeq = useRef(0)
  const searchSeq = useRef(0)

  const loadFile = useCallback(
    (path: string) => {
      if (!instance || !kind || !file) return
      const request = ++fileSeq.current
      setSelectedPath(path)
      setFileLoading(true)
      setFileError('')
      setFileData(null)
      void window.ccl.ledger
        .previewFile(instance.id, kind, file, path)
        .then((result) => {
          if (request === fileSeq.current) setFileData(result)
        })
        .catch((cause) => {
          if (request === fileSeq.current) setFileError(cleanError(cause))
        })
        .finally(() => {
          if (request === fileSeq.current) setFileLoading(false)
        })
    },
    [instance?.id, kind, file]
  )

  useEffect(() => {
    if (!open || !instance || !kind || !file) return
    let cancelled = false
    fileSeq.current += 1
    searchSeq.current += 1
    setPack(null)
    setLoading(true)
    setError('')
    setExpanded(new Set())
    setChildren({})
    setLoadingDirs(new Set())
    setDirTotals({})
    setDirTruncated(new Set())
    setDirErrors({})
    setQuery('')
    setSearchResult(null)
    setSearching(false)
    setSearchError('')
    setSelectedPath(null)
    setFileData(null)
    setFileLoading(false)
    setFileError('')
    setCopied(false)
    void window.ccl.ledger
      .previewPack(instance.id, kind, file)
      .then((result) => {
        if (cancelled) return
        setPack(result)
        setChildren({ '': result.entries })
        setDirTotals({ '': result.rootTotal })
        if (result.suggestedPath) loadFile(result.suggestedPath)
      })
      .catch((cause) => {
        if (!cancelled) setError(cleanError(cause))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
      fileSeq.current += 1
      searchSeq.current += 1
    }
  }, [open, instance?.id, kind, file, loadFile])

  useEffect(() => {
    if (!open || !instance || !kind || !file) return
    const keyword = query.trim()
    if (!keyword) {
      searchSeq.current += 1
      setSearchResult(null)
      setSearching(false)
      setSearchError('')
      return
    }
    const request = ++searchSeq.current
    setSearching(true)
    setSearchError('')
    const timer = window.setTimeout(() => {
      void window.ccl.ledger
        .previewSearch(instance.id, kind, file, keyword)
        .then((result) => {
          if (request === searchSeq.current) setSearchResult(result)
        })
        .catch((cause) => {
          if (request === searchSeq.current) setSearchError(cleanError(cause))
        })
        .finally(() => {
          if (request === searchSeq.current) setSearching(false)
        })
    }, 180)
    return () => window.clearTimeout(timer)
  }, [open, instance?.id, kind, file, query])

  const toggleDir = (entry: ContentPreviewEntry) => {
    if (entry.type !== 'dir' || !instance || !kind || !file) return
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(entry.path)) next.delete(entry.path)
      else next.add(entry.path)
      return next
    })
    if (children[entry.path] || loadingDirs.has(entry.path)) return
    setLoadingDirs((current) => new Set(current).add(entry.path))
    void window.ccl.ledger
      .previewDir(instance.id, kind, file, entry.path)
      .then((result) => {
        setChildren((current) => ({ ...current, [entry.path]: result.entries }))
        setDirTotals((current) => ({ ...current, [entry.path]: result.total }))
        setDirTruncated((current) => {
          const next = new Set(current)
          if (result.truncated) next.add(entry.path)
          else next.delete(entry.path)
          return next
        })
        setDirErrors((current) => {
          if (!(entry.path in current)) return current
          const next = { ...current }
          delete next[entry.path]
          return next
        })
      })
      .catch((cause) => {
        setDirErrors((current) => ({ ...current, [entry.path]: cleanError(cause) }))
      })
      .finally(() => {
        setLoadingDirs((current) => {
          const next = new Set(current)
          next.delete(entry.path)
          return next
        })
      })
  }

  const copyPath = () => {
    if (!selectedPath) return
    void navigator.clipboard
      .writeText(selectedPath)
      .then(() => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1600)
      })
      .catch(() => undefined)
  }

  const renderTree = (entries: ContentPreviewEntry[], depth: number) =>
    entries.map((entry) => {
      const isDir = entry.type === 'dir'
      const isExpanded = expanded.has(entry.path)
      const selected = selectedPath === entry.path
      return (
        <div key={entry.path}>
          <button
            type="button"
            className={`pack-tree-row ${isDir ? 'is-dir' : ''} ${selected ? 'is-active' : ''}`}
            style={{ paddingLeft: 7 + depth * 13 }}
            title={entry.path}
            onClick={() => (isDir ? toggleDir(entry) : loadFile(entry.path))}
          >
            <span className="pack-tree-caret">
              {isDir ? isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} /> : null}
            </span>
            {isDir ? (
              isExpanded ? <FolderOpen size={11} /> : <Folder size={11} />
            ) : (
              fileIcon(entry.name)
            )}
            <span className="pack-tree-name">{entry.name}</span>
            <small>
              {isDir
                ? `${entry.childCount ?? 0} 项`
                : entry.size > 0
                  ? formatBytes(entry.size)
                  : ''}
            </small>
          </button>
          {isDir && isExpanded && (
            <div>
              {loadingDirs.has(entry.path) ? (
                <div className="pack-tree-state" style={{ paddingLeft: 22 + depth * 13 }}>
                  <Spinner size={10} /> 读取…
                </div>
              ) : dirErrors[entry.path] ? (
                <div className="pack-tree-state is-error" style={{ paddingLeft: 22 + depth * 13 }}>
                  {dirErrors[entry.path]}
                </div>
              ) : (
                <>
                  {renderTree(children[entry.path] ?? [], depth + 1)}
                  {dirTruncated.has(entry.path) && (
                    <div className="pack-tree-state" style={{ paddingLeft: 22 + depth * 13 }}>
                      显示前 {children[entry.path]?.length ?? 0} / {dirTotals[entry.path] ?? '?'} 项，用搜索定位更多文件
                    </div>
                  )}
                  {(children[entry.path]?.length ?? 0) === 0 && (
                    <div className="pack-tree-state" style={{ paddingLeft: 22 + depth * 13 }}>
                      空文件夹
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )
    })

  const renderSearch = () => {
    if (searching) {
      return (
        <div className="pack-tree-state">
          <Spinner size={11} /> 搜索中…
        </div>
      )
    }
    if (searchError) {
      return <div className="pack-tree-state is-error">{searchError}</div>
    }
    if (!searchResult || searchResult.items.length === 0) {
      return <div className="pack-tree-state">没有匹配的文件</div>
    }
    return (
      <>
        {searchResult.items.map((entry) => (
          <button
            key={entry.path}
            type="button"
            className={`pack-search-row ${selectedPath === entry.path ? 'is-active' : ''}`}
            title={entry.path}
            onClick={() => loadFile(entry.path)}
          >
            <span className="pack-search-icon">{fileIcon(entry.name)}</span>
            <span className="pack-search-copy">
              <strong>{entry.name}</strong>
              <small>{entry.path}</small>
            </span>
            <em>{formatBytes(entry.size)}</em>
          </button>
        ))}
        {searchResult.total > searchResult.items.length && (
          <div className="pack-tree-state">
            共 {searchResult.total} 个匹配，显示前 {searchResult.items.length} 个
          </div>
        )}
      </>
    )
  }

  const packLabel = kind ? KIND_LABEL[kind] : '资源'

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${packLabel}预览`}
      subtitle={
        name && file && name !== file
          ? `${name} · ${file}`
          : file ?? '只读预览'
      }
      icon={kindIcon(kind, 18)}
      size="full"
      footer={
        <div className="pack-preview-footer">
          <span>只读预览，不会解压、修改或移动压缩包内容。</span>
          <button type="button" className="button button--ghost button--sm" onClick={onClose}>
            关闭
          </button>
        </div>
      }
    >
      <div className="pack-preview">
        {loading ? (
          <div className="pack-preview-state">
            <Spinner size={18} />
            正在读取资源包目录…
          </div>
        ) : error ? (
          <div className="pack-preview-state is-error">
            <AlertTriangle size={20} />
            <strong>无法预览</strong>
            <span>{error}</span>
          </div>
        ) : pack ? (
          <>
            <section className="pack-preview-summary">
              <div className="pack-preview-icon">
                {pack.icon ? (
                  <img src={pack.icon} alt="" draggable={false} />
                ) : (
                  kindIcon(pack.kind, 26)
                )}
              </div>
              <div className="pack-preview-heading">
                <div className="pack-preview-title">
                  <strong>{name && name !== file ? name : pack.name}</strong>
                  <Badge tone="accent">{packLabel}</Badge>
                  {pack.packFormat && <Badge tone="neutral">格式 {pack.packFormat}</Badge>}
                </div>
                <span className="pack-preview-file" title={pack.file}>
                  {pack.file} · {formatBytes(pack.size)}
                </span>
                {pack.description && <p>{pack.description}</p>}
              </div>
              <div className="pack-preview-stats">
                <div>
                  <em>{pack.fileCount.toLocaleString('zh-CN')}</em>
                  <span>文件</span>
                </div>
                <div>
                  <em>{formatBytes(pack.totalBytes)}</em>
                  <span>解压后</span>
                </div>
                {pack.packFormat && (
                  <div>
                    <em>{pack.packFormat}</em>
                    <span>pack_format</span>
                  </div>
                )}
              </div>
            </section>

            <div className="pack-preview-body">
              <aside className="pack-preview-tree">
                <div className="pack-preview-tree-head">
                  <div>
                    <strong>文件</strong>
                    <span>{pack.fileCount.toLocaleString('zh-CN')}</span>
                  </div>
                  <label className="pack-preview-search">
                    <Search size={11} />
                    <input
                      value={query}
                      placeholder="搜索文件路径"
                      onChange={(event) => setQuery(event.target.value)}
                    />
                    {query && (
                      <button
                        type="button"
                        className="pack-preview-search-clear"
                        title="清除搜索"
                        onClick={() => setQuery('')}
                      >
                        <X size={10} />
                      </button>
                    )}
                  </label>
                </div>
                <div className="pack-preview-tree-list">
                  {query.trim() ? (
                    renderSearch()
                  ) : (
                    <>
                      {renderTree(pack.entries, 0)}
                      {pack.rootTotal > pack.entries.length && (
                        <div className="pack-tree-state">
                          根目录只显示前 {pack.entries.length} 项，用搜索定位更多文件
                        </div>
                      )}
                    </>
                  )}
                </div>
                <div className="pack-preview-tree-foot">
                  {selectedPath ? selectedPath : '选择左侧文件查看内容'}
                </div>
              </aside>

              <main className="pack-preview-view">
                {fileLoading ? (
                  <div className="pack-preview-state">
                    <Spinner size={16} />
                    正在读取文件…
                  </div>
                ) : fileError ? (
                  <div className="pack-preview-state is-error">
                    <AlertTriangle size={18} />
                    <strong>无法读取文件</strong>
                    <span>{fileError}</span>
                  </div>
                ) : fileData ? (
                  <>
                    <header className="pack-preview-file-head">
                      <div className="pack-preview-file-path" title={fileData.path}>
                        {fileData.path}
                      </div>
                      <div className="pack-preview-file-meta">
                        <span>{fileKindLabel(fileData)}</span>
                        <span>{formatBytes(fileData.size)}</span>
                        {fileData.width && fileData.height && (
                          <span>
                            {fileData.width} × {fileData.height}
                          </span>
                        )}
                        {fileData.lineCount != null && <span>{fileData.lineCount} 行</span>}
                        {fileData.truncated && <span className="is-warn">已截断预览</span>}
                        <button
                          type="button"
                          className="pack-preview-copy"
                          title="复制内部路径"
                          onClick={copyPath}
                        >
                          <Copy size={11} />
                          {copied ? '已复制' : '复制路径'}
                        </button>
                      </div>
                    </header>
                    <div className={`pack-preview-content is-${fileData.kind}`}>
                      {fileData.kind === 'text' && (
                        <pre className="pack-preview-text">{fileData.text}</pre>
                      )}
                      {fileData.kind === 'image' && (
                        <div className="pack-preview-image">
                          <img src={fileData.dataUrl ?? ''} alt={fileData.name} draggable={false} />
                        </div>
                      )}
                      {fileData.kind === 'audio' && (
                        <div className="pack-preview-audio">
                          <Music size={20} />
                          <strong>{fileData.name}</strong>
                          <audio controls src={fileData.dataUrl ?? ''}>
                            当前环境不支持音频预览
                          </audio>
                        </div>
                      )}
                      {fileData.kind === 'binary' && (
                        <div className="pack-preview-state">
                          <File size={20} />
                          <strong>二进制文件</strong>
                          <span>{fileData.note ?? '暂不解析这个文件类型'}</span>
                        </div>
                      )}
                    </div>
                    {fileData.truncated && (
                      <div className="pack-preview-truncated">
                        文本超过 256 KB，只显示前 256 KB；完整内容请使用外部解压工具查看。
                      </div>
                    )}
                  </>
                ) : (
                  <div className="pack-preview-state">
                    <Search size={20} />
                    <strong>选择左侧文件</strong>
                    <span>可以查看图片、文本、着色器和音频，不会修改压缩包。</span>
                  </div>
                )}
              </main>
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  )
}
