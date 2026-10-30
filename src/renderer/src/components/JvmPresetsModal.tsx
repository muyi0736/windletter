import { useCallback, useEffect, useState } from 'react'
import { Check, Plus, RefreshCw, SlidersHorizontal, Trash2 } from 'lucide-react'
import type { JvmPresetPayload, JvmPresetView } from '@shared/types'
import { useLauncher } from '../store'
import { cleanError } from '../lib/format'
import { IconButton, Modal, Spinner } from './ui'

export function JvmPresetsModal({
  open,
  currentArgs,
  onClose,
  onApply
}: {
  open: boolean
  currentArgs: string
  onClose: () => void
  onApply: (args: string, name: string) => void
}) {
  const toast = useLauncher((state) => state.toast)
  const [payload, setPayload] = useState<JvmPresetPayload | null>(null)
  const [saveName, setSaveName] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setPayload(await window.ccl.jvm.presets())
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setSaveName('')
    void load()
  }, [open, load])

  useEffect(() => {
    if (!open) return
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [open, onClose])

  const apply = (preset: JvmPresetView) => {
    onApply(preset.args, preset.name)
    onClose()
  }

  const save = async () => {
    if (!saveName.trim() || saving) return
    setSaving(true)
    setError('')
    try {
      const next = await window.ccl.jvm.savePreset({
        name: saveName.trim(),
        args: currentArgs,
        description: '保存自当前额外 JVM 参数'
      })
      setPayload(next)
      setSaveName('')
      toast('success', 'JVM 预设已保存', saveName.trim())
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (preset: JvmPresetView) => {
    if (preset.builtIn) return
    try {
      const next = await window.ccl.jvm.removePreset(preset.id)
      setPayload(next)
      toast('info', '已删除 JVM 预设', preset.name)
    } catch (cause) {
      toast('error', '无法删除预设', cleanError(cause))
    }
  }

  const builtIns = payload?.presets.filter((preset) => preset.builtIn) ?? []
  const customs = payload?.presets.filter((preset) => !preset.builtIn) ?? []

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="JVM 参数预设"
      subtitle="套用到全局或实例的额外 JVM 参数；内置预设不会被修改"
      icon={<SlidersHorizontal size={18} />}
      size="lg"
      footer={
        <div className="jvm-preset-footer">
          <span>
            当前参数：{currentArgs.trim() ? `${currentArgs.trim().slice(0, 90)}${currentArgs.trim().length > 90 ? '…' : ''}` : '（留空）'}
          </span>
          <button type="button" className="button button--soft" onClick={onClose}>
            关闭
          </button>
        </div>
      }
    >
      <div className="jvm-preset-modal">
        <div className="jvm-preset-toolbar">
          <span>选择预设</span>
          <button type="button" className="link-button" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={12} className={loading ? 'spin' : ''} />
            刷新
          </button>
        </div>

        {loading && !payload ? (
          <div className="jvm-preset-loading">
            <Spinner size={15} />
            正在读取预设…
          </div>
        ) : (
          <>
            <div className="jvm-preset-list">
              {builtIns.map((preset) => (
                <PresetCard key={preset.id} preset={preset} onApply={apply} />
              ))}
            </div>

            <div className="jvm-preset-section">
              <div className="jvm-preset-toolbar">
                <span>我的预设</span>
                <span>{customs.length} 个</span>
              </div>
              {customs.length === 0 ? (
                <p className="jvm-preset-empty">还没有自定义预设，可直接保存当前参数。</p>
              ) : (
                <div className="jvm-preset-list">
                  {customs.map((preset) => (
                    <PresetCard
                      key={preset.id}
                      preset={preset}
                      onApply={apply}
                      onRemove={remove}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="jvm-preset-save">
              <div>
                <strong>把当前参数保存为预设</strong>
                <small>当前输入框里的内容会保存为自定义预设，可反复套用。</small>
              </div>
              <div className="jvm-preset-save-row">
                <input
                  value={saveName}
                  maxLength={40}
                  onChange={(event) => setSaveName(event.target.value)}
                  placeholder="预设名称，例如 miao 专用"
                  disabled={saving}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void save()
                  }}
                />
                <button
                  type="button"
                  className="button button--soft button--sm"
                  onClick={() => void save()}
                  disabled={saving || !saveName.trim()}
                >
                  {saving ? <Spinner size={12} /> : <Plus size={13} />}
                  保存
                </button>
              </div>
            </div>
          </>
        )}

        {error && (
          <div className="jvm-preset-error">
            {error}
            <button type="button" className="link-button" onClick={() => void load()}>
              重试
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}

function PresetCard({
  preset,
  onApply,
  onRemove
}: {
  preset: JvmPresetView
  onApply: (preset: JvmPresetView) => void
  onRemove?: (preset: JvmPresetView) => void
}) {
  return (
    <div className="jvm-preset-card">
      <div className="jvm-preset-card-main">
        <div className="jvm-preset-card-head">
          <strong>{preset.name}</strong>
          <span className={`jvm-preset-tag ${preset.builtIn ? 'is-builtin' : ''}`}>
            {preset.builtIn ? '内置' : '自定义'}
          </span>
          {preset.minJava && <span className="jvm-preset-tag is-java">Java {preset.minJava}+</span>}
        </div>
        <p>{preset.description}</p>
        <code>{preset.args || '（留空，使用启动器默认参数）'}</code>
      </div>
      <div className="jvm-preset-card-actions">
        <button type="button" className="button button--soft button--sm" onClick={() => onApply(preset)}>
          <Check size={12} />
          套用
        </button>
        {onRemove && (
          <IconButton label="删除预设" tone="danger" onClick={() => onRemove(preset)}>
            <Trash2 size={13} />
          </IconButton>
        )}
      </div>
    </div>
  )
}