import { useEffect, useMemo, useState } from 'react'
import type { PresetCheckEntry } from '@shared/types'
import {
  Check,
  CheckSquare,
  Download,
  Package,
  RefreshCw,
  Sparkles,
  Square,
  X
} from 'lucide-react'
import { useLauncher } from '../store'
import { formatBytes, loaderLabel } from '../lib/format'
import { Badge, EmptyState, Modal, Spinner, Switch } from './ui'
import { RemoteIcon } from './RemoteIcon'
import { searchProviderLabel } from '../lib/mergedSearch'

function entryKey(entry: Pick<PresetCheckEntry, 'provider' | 'projectId'>): string {
  return `${entry.provider}:${entry.projectId}`
}

export function PresetCheckModal() {
  const prompt = useLauncher((state) => state.presetPrompt)
  const dismissPresetPrompt = useLauncher((state) => state.dismissPresetPrompt)
  const checkPresets = useLauncher((state) => state.checkPresets)
  const startPresetInstall = useLauncher((state) => state.startPresetInstall)
  const setPresetAutoInstall = useLauncher((state) => state.setPresetAutoInstall)
  const setPresetManagerOpen = useLauncher((state) => state.setPresetManagerOpen)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [autoBusy, setAutoBusy] = useState(false)
  const [installing, setInstalling] = useState(false)

  const result = prompt?.result ?? null
  const entries = result?.entries ?? []
  const missing = entries.filter((entry) => !entry.present)
  const present = entries.filter((entry) => entry.present)
  const installable = missing.filter((entry) => entry.compatible && entry.versionId)
  const signature = useMemo(
    () =>
      entries
        .map(
          (entry) =>
            `${entryKey(entry)}:${entry.present ? 1 : 0}:${entry.compatible ? 1 : 0}:${entry.versionId ?? ''}`
        )
        .join('|'),
    [entries]
  )

  useEffect(() => {
    if (!result) {
      setSelected(new Set())
      return
    }
    const next = new Set(
      result.entries
        .filter((entry) => !entry.present && entry.compatible && entry.versionId)
        .map((entry) => entryKey(entry))
    )
    setSelected(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt?.instanceId, signature])

  useEffect(() => {
    setAutoBusy(false)
    setInstalling(false)
  }, [prompt?.instanceId, prompt?.status])

  const toggle = (entry: PresetCheckEntry) => {
    if (entry.present || !entry.compatible || !entry.versionId) return
    const key = entryKey(entry)
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const allSelected =
    installable.length > 0 && installable.every((entry) => selected.has(entryKey(entry)))

  const toggleAll = () => {
    setSelected(
      allSelected ? new Set() : new Set(installable.map((entry) => entryKey(entry)))
    )
  }

  const installSelected = async () => {
    if (!prompt || selected.size === 0 || installing) return
    const items = installable
      .filter((entry) => selected.has(entryKey(entry)))
      .map((entry) => ({
        provider: entry.provider,
        projectId: entry.projectId,
        versionId: entry.versionId,
        title: entry.title
      }))
    setInstalling(true)
    await startPresetInstall(prompt.instanceId, items)
    setInstalling(false)
  }

  const changeAuto = async (enabled: boolean) => {
    if (autoBusy) return
    setAutoBusy(true)
    await setPresetAutoInstall(enabled)
    setAutoBusy(false)
  }

  const footer =
    prompt?.status === 'checking' ? (
      <div className="preset-check-footer">
        <span>核对完成后会列出缺失项，不会自动改动实例。</span>
        <button type="button" className="button button--ghost button--sm" onClick={dismissPresetPrompt}>
          关闭
        </button>
      </div>
    ) : prompt?.status === 'error' ? (
      <div className="preset-check-footer">
        <span>可以重试，或在实例页管理预设。</span>
        <div className="preset-check-footer-actions">
          <button type="button" className="button button--ghost button--sm" onClick={dismissPresetPrompt}>
            关闭
          </button>
          <button
            type="button"
            className="button button--soft button--sm"
            onClick={() => void checkPresets(prompt.instanceId, prompt.mode)}
          >
            <RefreshCw size={12} />
            重试
          </button>
        </div>
      </div>
    ) : result && !result.applicable ? (
      <div className="preset-check-footer">
        <span>{result.reason ?? '这个实例暂时不需要补齐预设模组。'}</span>
        <div className="preset-check-footer-actions">
          {result.entries.length === 0 && (
            <button
              type="button"
              className="button button--soft button--sm"
              onClick={() => {
                dismissPresetPrompt()
                setPresetManagerOpen(true)
              }}
            >
              <Sparkles size={12} />
              管理预设
            </button>
          )}
          <button type="button" className="button button--ghost button--sm" onClick={dismissPresetPrompt}>
            关闭
          </button>
        </div>
      </div>
    ) : missing.length === 0 ? (
      <div className="preset-check-footer">
        <span>所有预设模组都已包含在这个整合包里。</span>
        <button type="button" className="button button--soft button--sm" onClick={dismissPresetPrompt}>
          <Check size={12} />
          知道了
        </button>
      </div>
    ) : (
      <div className="preset-check-footer">
        <span>
          已选 {selected.size} 个
          {installable.length > 0 && selected.size < installable.length
            ? ` · 还有 ${installable.length - selected.size} 个可安装`
            : ''}
        </span>
        <div className="preset-check-footer-actions">
          <button type="button" className="button button--ghost button--sm" onClick={dismissPresetPrompt}>
            稍后
          </button>
          <button
            type="button"
            className="button button--primary button--sm"
            disabled={selected.size === 0 || installing}
            onClick={() => void installSelected()}
          >
            {installing ? <Spinner size={12} /> : <Download size={12} />}
            安装选中 ({selected.size})
          </button>
        </div>
      </div>
    )

  return (
    <Modal
      open={Boolean(prompt)}
      onClose={dismissPresetPrompt}
      title="预设模组"
      subtitle={
        prompt
          ? `${prompt.instanceName}${
              result
                ? ` · Minecraft ${result.gameVersion} · ${
                    loaderLabel(result.loader) ?? result.loader
                  }`
                : ''
            }`
          : undefined
      }
      icon={<Sparkles size={18} />}
      size="lg"
      closeOnOverlay={prompt?.status !== 'checking'}
      footer={footer}
    >
      {!prompt ? null : prompt.status === 'checking' ? (
        <div className="preset-check-loading">
          <span className="preset-check-loading-icon">
            <Spinner size={20} />
          </span>
          <strong>正在核对整合包内容</strong>
          <span>读取 mods 文件夹，识别 mod ID，并检查预设模组的兼容版本…</span>
        </div>
      ) : prompt.status === 'error' ? (
        <div className="preset-check-error">
          <EmptyState
            icon={<X size={24} />}
            title="无法检查预设模组"
            description={prompt.error ?? '未知错误'}
          />
        </div>
      ) : result && !result.applicable ? (
        <EmptyState
          icon={<Sparkles size={24} />}
          title={result.entries.length === 0 ? '还没有预设模组' : '这个实例不使用预设模组'}
          description={result.reason ?? '预设只对带加载器的实例生效。'}
        />
      ) : (
        <div className="preset-check">
          <div className="preset-check-summary">
            <div>
              <strong>
                {missing.length > 0
                  ? `缺少 ${missing.length} 个预设模组`
                  : '预设模组已齐全'}
              </strong>
              <span>
                {present.length > 0
                  ? `整合包已包含 ${present.length} 个预设；不会重复安装。`
                  : '在 mods 文件夹里没有找到这些预设模组。'}
              </span>
            </div>
            <Badge tone={missing.length > 0 ? 'warning' : 'success'}>
              {missing.length > 0 ? `缺少 ${missing.length}` : '已齐全'}
            </Badge>
          </div>

          {missing.length > 0 && (
            <>
              <div className="preset-check-toolbar">
                <span>按目标实例的版本和加载器选择最新兼容版本</span>
                {installable.length > 0 && (
                  <button
                    type="button"
                    className="button button--ghost button--xs"
                    onClick={toggleAll}
                  >
                    {allSelected ? '取消全选' : '全选可安装'}
                  </button>
                )}
              </div>
              <div className="preset-check-list">
                {missing.map((entry) => {
                  const key = entryKey(entry)
                  const checked = selected.has(key)
                  const unavailable = !entry.compatible || !entry.versionId
                  return (
                    <article
                      key={key}
                      className={`preset-check-row ${unavailable ? 'is-unavailable' : ''}`}
                    >
                      <button
                        type="button"
                        className={`ledger-select ${checked ? 'is-selected' : ''}`}
                        title={unavailable ? '暂无兼容版本' : checked ? '取消选择' : '选择安装'}
                        disabled={unavailable}
                        onClick={() => toggle(entry)}
                      >
                        {checked ? <CheckSquare size={16} /> : <Square size={16} />}
                      </button>
                      <span className="preset-check-icon">
                        <RemoteIcon url={entry.iconUrl} fallback={<Package size={18} />} />
                      </span>
                      <div className="preset-check-body">
                        <div className="preset-check-head">
                          <strong title={entry.title}>
                            {entry.localizedName ?? entry.title}
                          </strong>
                          <Badge tone="neutral">{searchProviderLabel(entry.provider)}</Badge>
                          {unavailable && <Badge tone="warning">无兼容版本</Badge>}
                        </div>
                        <span className="preset-check-meta">
                          {entry.compatible && entry.versionNumber
                            ? `将安装 ${entry.versionNumber}${
                                entry.fileSize ? ` · ${formatBytes(entry.fileSize)}` : ''
                              }`
                            : entry.message ?? '暂时无法获取兼容版本'}
                        </span>
                      </div>
                    </article>
                  )
                })}
              </div>
            </>
          )}

          {present.length > 0 && (
            <div className="preset-check-present">
              <strong>整合包已包含</strong>
              <div className="preset-check-present-list">
                {present.map((entry) => (
                  <span
                    key={entryKey(entry)}
                    className="preset-check-chip"
                    title={entry.title}
                  >
                    <Check size={11} />
                    {entry.localizedName ?? entry.title}
                    {!entry.enabled && <em>已禁用</em>}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="preset-check-auto">
            <div>
              <strong>以后自动安装缺失的预设模组</strong>
              <span>开启后，安装整合包时直接补齐，不再弹出这个确认。</span>
            </div>
            <Switch
              checked={result?.autoInstall === true}
              label="以后自动安装缺失的预设模组"
              disabled={autoBusy}
              onChange={(value) => void changeAuto(value)}
            />
          </div>
        </div>
      )}
    </Modal>
  )
}
