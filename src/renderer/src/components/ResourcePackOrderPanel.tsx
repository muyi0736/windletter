import { useCallback, useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Eye, EyeOff, RefreshCw } from 'lucide-react'
import type { ResourcePackList } from '@shared/types'
import { useLauncher } from '../store'
import { cleanError } from '../lib/format'
import { Spinner } from './ui'

export function ResourcePackOrderPanel({ instanceId }: { instanceId: string }) {
  const toast = useLauncher((state) => state.toast)
  const [list, setList] = useState<ResourcePackList | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setList(await window.ccl.instances.resourcePacks(instanceId))
    } catch (err) {
      setError(cleanError(err))
    } finally {
      setLoading(false)
    }
  }, [instanceId])

  useEffect(() => {
    void load()
  }, [load])

  const enabled = (list?.packs ?? []).filter((p) => p.enabled)
  const disabled = (list?.packs ?? []).filter((p) => !p.enabled)

  const apply = async (names: string[]) => {
    setSaving(true)
    setError('')
    try {
      setList(await window.ccl.instances.applyResourcePacks(instanceId, names))
    } catch (err) {
      const message = cleanError(err)
      setError(message)
      toast('error', '资源包调整失败', message)
    } finally {
      setSaving(false)
    }
  }

  const move = (name: string, dir: -1 | 1) => {
    const names = enabled.map((p) => p.name)
    const idx = names.indexOf(name)
    const target = idx + dir
    if (idx < 0 || target < 0 || target >= names.length) return
    ;[names[idx], names[target]] = [names[target], names[idx]]
    void apply(names)
  }

  const setEnabled = (name: string, on: boolean) => {
    const names = enabled.map((p) => p.name)
    if (on) void apply([...names, name])
    else void apply(names.filter((n) => n !== name))
  }

  return (
    <section className="rp-order-panel">
      <button type="button" className="rp-order-head" onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        启用与排序
        <span className="rp-order-count">{enabled.length} 启用</span>
        {saving && <Spinner size={12} />}
      </button>
      {open && (
        <div className="rp-order-body">
          {loading ? (
            <div className="rp-order-loading">
              <Spinner size={14} /> 正在读取资源包…
            </div>
          ) : error ? (
            <div className="mods-error">{error}</div>
          ) : !list?.hasOptions ? (
            <p className="rp-order-note">还没有 options.txt，请先启动一次游戏再调整资源包。</p>
          ) : (
            <>
              <p className="rp-order-note">
                越靠下优先级越高（覆盖上层）。调整会写回 options.txt 并自动备份，下次启动生效。
              </p>
              {enabled.length === 0 && <p className="rp-order-note">暂无启用的资源包。</p>}
              {enabled.map((pack, index) => (
                <div key={pack.name} className="rp-order-row">
                  <span className="rp-order-index">{index + 1}</span>
                  <span className="rp-order-name" title={pack.name}>
                    {pack.name}
                  </span>
                  <span className="rp-order-actions">
                    <button
                      type="button"
                      title="上移"
                      disabled={saving || index === 0}
                      onClick={() => move(pack.name, -1)}
                    >
                      <ArrowUp size={13} />
                    </button>
                    <button
                      type="button"
                      title="下移"
                      disabled={saving || index === enabled.length - 1}
                      onClick={() => move(pack.name, 1)}
                    >
                      <ArrowDown size={13} />
                    </button>
                    <button
                      type="button"
                      title="停用"
                      disabled={saving}
                      onClick={() => setEnabled(pack.name, false)}
                    >
                      <EyeOff size={13} />
                    </button>
                  </span>
                </div>
              ))}
              {disabled.length > 0 && (
                <div className="rp-order-disabled">
                  <span className="rp-order-sub">未启用</span>
                  {disabled.map((pack) => (
                    <div key={pack.name} className="rp-order-row is-disabled">
                      <span className="rp-order-name" title={pack.name}>
                        {pack.name}
                      </span>
                      <span className="rp-order-actions">
                        <button
                          type="button"
                          title="启用"
                          disabled={saving}
                          onClick={() => setEnabled(pack.name, true)}
                        >
                          <Eye size={13} />
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <button type="button" className="button button--ghost button--sm" onClick={() => void load()}>
                <RefreshCw size={12} /> 刷新
              </button>
            </>
          )}
        </div>
      )}
    </section>
  )
}
