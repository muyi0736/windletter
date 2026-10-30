import { useEffect, useMemo, useState } from 'react'
import { Check, Download, Gamepad2, RefreshCw, Search } from 'lucide-react'
import { useLauncher } from '../store'
import {
  formatDate,
  javaRequirement,
  versionTypeLabel
} from '../lib/format'
import { Badge, EmptyState, Modal, Segmented, Spinner } from './ui'
import { BlockIcon } from './visuals'

interface VersionOption {
  id: string
  type: string
  releaseTime: string | null
  installed: boolean
  javaMajor: number | null
}

type VersionFilter = 'release' | 'snapshot' | 'all'

const PAGE_SIZE = 40

const VERSION_FILTERS: { value: VersionFilter; label: string }[] = [
  { value: 'release', label: '正式版' },
  { value: 'snapshot', label: '快照' },
  { value: 'all', label: '全部' }
]

export function VanillaInstanceModal({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}) {
  const installed = useLauncher((state) => state.installed)
  const manifest = useLauncher((state) => state.manifest)
  const manifestLoading = useLauncher((state) => state.manifestLoading)
  const manifestError = useLauncher((state) => state.manifestError)
  const loadManifest = useLauncher((state) => state.loadManifest)
  const refreshInstalled = useLauncher((state) => state.refreshInstalled)
  const createVanillaInstance = useLauncher((state) => state.createVanillaInstance)

  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [versionFilter, setVersionFilter] = useState<VersionFilter>('release')
  const [visibleOnline, setVisibleOnline] = useState(PAGE_SIZE)
  const [submitting, setSubmitting] = useState(false)

  const installedOptions = useMemo<VersionOption[]>(
    () =>
      installed
        .filter((version) => !version.loader && !version.inheritsFrom)
        .map((version) => ({
          id: version.id,
          type: version.type,
          releaseTime: version.releaseTime,
          installed: true,
          javaMajor: version.javaMajor
        })),
    [installed]
  )

  const installedIds = useMemo(
    () => new Set(installed.map((version) => version.id)),
    [installed]
  )

  const onlineOptions = useMemo<VersionOption[]>(
    () =>
      (manifest?.versions ?? [])
        .filter((version) => !installedIds.has(version.id))
        .map((version) => ({
          id: version.id,
          type: version.type,
          releaseTime: version.releaseTime,
          installed: false,
          javaMajor: null
        })),
    [manifest, installedIds]
  )

  const keyword = query.trim().toLowerCase()
  const filterOptions = (options: VersionOption[]): VersionOption[] =>
    keyword
      ? options.filter(
          (option) =>
            option.id.toLowerCase().includes(keyword) ||
            versionTypeLabel(option.type).includes(keyword)
        )
      : options

  const filteredInstalled = filterOptions(installedOptions)
  const filteredOnline = filterOptions(onlineOptions).filter((option) => {
    if (versionFilter === 'all') return true
    if (versionFilter === 'snapshot') return option.type === 'snapshot'
    return option.type !== 'snapshot' && option.type !== 'old_beta' && option.type !== 'old_alpha'
  })
  const shownOnline = filteredOnline.slice(0, visibleOnline)
  const remainingOnline = filteredOnline.length - shownOnline.length

  useEffect(() => {
    if (!open) return
    setQuery('')
    setName('')
    setVersionFilter('release')
    setVisibleOnline(PAGE_SIZE)
    setSelected(installedOptions[0]?.id ?? manifest?.latest.release ?? null)
    void loadManifest()
    void refreshInstalled()
    // 仅在打开时重置；已安装列表变化不应抢走当前选择。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open || selected) return
    const fallback =
      installedOptions[0]?.id ?? manifest?.latest.release ?? onlineOptions[0]?.id ?? null
    if (fallback) setSelected(fallback)
  }, [open, selected, installedOptions, manifest, onlineOptions])

  useEffect(() => {
    setVisibleOnline(PAGE_SIZE)
  }, [query, versionFilter])

  const selectedOption = [...installedOptions, ...onlineOptions].find(
    (option) => option.id === selected
  )

  const submit = async () => {
    if (!selected || submitting) return
    setSubmitting(true)
    try {
      const task = await createVanillaInstance({
        gameVersion: selected,
        name: name.trim() || undefined
      })
      if (task) onClose()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="新建原版实例"
      subtitle="原版游戏文件共享一份，实例只隔离 mods、config、saves 等个人内容"
      icon={<Gamepad2 size={20} />}
      size="md"
      footer={
        <>
          <button type="button" className="button button--ghost" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="button button--primary"
            disabled={!selected || submitting}
            onClick={() => void submit()}
          >
            {submitting ? <Spinner size={14} /> : <Gamepad2 size={14} />}
            创建原版实例
          </button>
        </>
      }
    >
      <div className="text-input picker-search">
        <Search size={15} />
        <input
          value={query}
          placeholder="搜索版本，例如 1.21.1、26.3"
          onChange={(event) => setQuery(event.target.value)}
          spellCheck={false}
        />
      </div>

      {filteredInstalled.length > 0 && (
        <section className="picker-section">
          <div className="picker-section-head">
            <span>已安装原版</span>
            <Badge tone="success">{filteredInstalled.length}</Badge>
          </div>
          <div className="vanilla-version-list">
            {filteredInstalled.map((option) => {
              const active = option.id === selected
              return (
                <button
                  key={option.id}
                  type="button"
                  className={`version-pick-row ${active ? 'is-selected' : ''}`}
                  onClick={() => setSelected(option.id)}
                >
                  <BlockIcon type={option.type} size={36} />
                  <span className="version-pick-copy">
                    <span className="version-pick-name">
                      {option.id}
                      <Badge tone="success">已安装</Badge>
                    </span>
                    <span className="version-pick-meta">
                      {versionTypeLabel(option.type)} · {formatDate(option.releaseTime)} ·{' '}
                      {javaRequirement(option.javaMajor)} · 直接创建
                    </span>
                  </span>
                  <span className={`version-pick-check ${active ? 'is-on' : ''}`}>
                    {active && <Check size={12} strokeWidth={3} />}
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      )}

      <section className="picker-section">
        <div className="picker-section-head">
          <span>下载并创建</span>
          <span>
            {manifestLoading && onlineOptions.length === 0
              ? '读取中'
              : `已显示 ${shownOnline.length} / ${filteredOnline.length}`}
          </span>
          {manifestError && (
            <button
              type="button"
              className="link-button"
              onClick={() => void loadManifest(true)}
              title={manifestError}
            >
              <RefreshCw size={11} />
              重试
            </button>
          )}
        </div>
        <div className="vanilla-version-filter">
          <Segmented
            size="sm"
            value={versionFilter}
            options={VERSION_FILTERS}
            onChange={setVersionFilter}
          />
        </div>
        {manifestLoading && onlineOptions.length === 0 ? (
          <div className="picker-loading">
            <Spinner size={14} /> 正在同步 Mojang 版本列表…
          </div>
        ) : shownOnline.length > 0 ? (
          <div className="vanilla-version-list">
            {shownOnline.map((option) => {
              const active = option.id === selected
              return (
                <button
                  key={option.id}
                  type="button"
                  className={`version-pick-row ${active ? 'is-selected' : ''}`}
                  onClick={() => setSelected(option.id)}
                >
                  <BlockIcon type={option.type} size={36} />
                  <span className="version-pick-copy">
                    <span className="version-pick-name">
                      {option.id}
                      <span className="vanilla-version-needs">
                        <Download size={9} />
                        需下载
                      </span>
                    </span>
                    <span className="version-pick-meta">
                      {versionTypeLabel(option.type)} · {formatDate(option.releaseTime)}
                    </span>
                  </span>
                  <span className={`version-pick-check ${active ? 'is-on' : ''}`}>
                    {active && <Check size={12} strokeWidth={3} />}
                  </span>
                </button>
              )
            })}
          </div>
        ) : (
          !manifestLoading && (
            <EmptyState
              icon={<Search size={20} />}
              title={
                keyword
                  ? `没有匹配「${query}」的版本`
                  : manifestError
                    ? '版本列表读取失败'
                    : '没有可下载的版本'
              }
              description={
                manifestError ||
                (keyword ? '换个关键词试试。' : '所有可用版本都已在本地，或下载源暂时不可用。')
              }
            />
          )
        )}
        {remainingOnline > 0 && (
          <button
            type="button"
            className="button button--soft button--sm"
            onClick={() => setVisibleOnline((count) => count + PAGE_SIZE)}
          >
            加载更多 · 还有 {remainingOnline} 个
          </button>
        )}
      </section>

      <label className="form-field">
        <span className="form-label">实例名称（可选）</span>
        <div className="text-input">
          <input
            value={name}
            placeholder={selected ? `${selected} 原版` : '留空自动命名'}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            spellCheck={false}
          />
        </div>
      </label>

      <div className="vanilla-instance-summary">
        <span>
          将创建 <strong>{selected ? `Minecraft ${selected} · 原版` : '原版实例'}</strong>
        </span>
        <span>
          {selectedOption?.installed
            ? '原版文件已就绪，只创建实例目录'
            : '会先下载原版游戏文件，再创建实例'}
        </span>
      </div>
    </Modal>
  )
}
