import { useEffect, useState } from 'react'
import { ArrowRight, Check, Layers, RefreshCw } from 'lucide-react'
import type { InstanceSummary, LoaderVersionView } from '@shared/types'
import { useLauncher } from '../store'
import { loaderLabel } from '../lib/format'
import { Badge, EmptyState, Modal, Spinner } from './ui'

function versionKey(loader: InstanceSummary['loader'], gameVersion: string, value: string | null): string {
  if (loader !== 'neoforge' || !value) return value ?? ''
  const parts = gameVersion.split('.')
  const prefix =
    parts[0] === '1'
      ? `${parts[1]}.${parts[2] ?? '0'}`
      : `${parts[0]}.${parts[1] ?? '0'}`
  return value.startsWith(`${prefix}.`) ? value.slice(prefix.length + 1) : value
}

export function LoaderUpdateModal({
  open,
  instance,
  onClose,
  onStarted
}: {
  open: boolean
  instance: InstanceSummary | null
  onClose: () => void
  onStarted: () => void
}) {
  const updateInstanceLoader = useLauncher((state) => state.updateInstanceLoader)
  const [versions, setVersions] = useState<LoaderVersionView[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [starting, setStarting] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    if (!open || !instance) return
    if (instance.loader === 'vanilla') return
    let cancelled = false
    setLoading(true)
    setError('')
    setVersions([])
    setShowAll(false)
    window.ccl.instances
      .loaderVersions(
        instance.gameVersion,
        instance.loader as 'fabric' | 'quilt' | 'forge' | 'neoforge' | 'optifine'
      )
      .then((list) => {
        if (!cancelled) setVersions(list)
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, instance?.id, reloadKey])

  if (!instance) return null
  const label = loaderLabel(instance.loader) ?? instance.loader
  const disabledReason =
    instance.loader === 'vanilla'
      ? '原版实例没有加载器，请在下载页安装加载器创建新实例'
      : ''
  const currentKey = versionKey(instance.loader, instance.gameVersion, instance.loaderVersion)
  const currentIndex = versions.findIndex((entry) => entry.version === currentKey)
  const visibleVersions = showAll
    ? versions
    : currentIndex >= 0
      ? versions.slice(0, currentIndex + 1)
      : versions.slice(0, 20)

  const start = async (version: string) => {
    if (starting || disabledReason) return
    setStarting(version)
    const task = await updateInstanceLoader(instance.id, version)
    setStarting(null)
    if (task) {
      onClose()
      onStarted()
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="更新加载器"
      subtitle={`${instance.name} · ${label} ${instance.loaderVersion ?? ''} · Minecraft ${instance.gameVersion}`}
      icon={<Layers size={18} />}
      size="md"
      footer={
        <div className="instance-settings-footer">
          <span className="loader-update-hint">
            只替换加载器版本，模组、配置和存档都不会变动。
          </span>
          <button type="button" className="button button--ghost button--sm" onClick={onClose}>
            关闭
          </button>
        </div>
      }
    >
      {disabledReason ? (
        <EmptyState icon={<Layers size={22} />} title="无法更新加载器" description={disabledReason} />
      ) : (
        <>
          <div className="loader-update-current">
            <span>当前</span>
            <strong>
              {label} {instance.loaderVersion ?? '未知版本'}
            </strong>
            <ArrowRight size={12} />
            <span>选择要切换的加载器版本</span>
          </div>
          {instance.external && (
            <div className="loader-update-warning">
              这是外部实例。加载器档案和运行库会安装到{' '}
              <code>{instance.external.baseDir}</code> 的 versions/libraries，
              原启动器也会看到新版本；模组、配置和存档不受影响。
            </div>
          )}
          {loading ? (
            <div className="downloads-loading">
              <Spinner size={15} />
              正在读取可用的加载器版本…
            </div>
          ) : error ? (
            <div className="mods-error">
              <span>{error}</span>
              <button
                type="button"
                className="button button--soft button--xs"
                onClick={() => setReloadKey((value) => value + 1)}
              >
                <RefreshCw size={11} />
                重试
              </button>
            </div>
          ) : (
            <div className="loader-update-list">
              {visibleVersions.map((entry) => {
                const current = entry.version === currentKey
                const busy = starting === entry.version
                return (
                  <article
                    key={entry.version}
                    className={`loader-update-row ${current ? 'is-current' : ''}`}
                  >
                    <div>
                      <strong>{entry.version}</strong>
                      {entry.latest && <Badge tone="success">最新</Badge>}
                      {current && <Badge tone="accent">当前</Badge>}
                    </div>
                    <button
                      type="button"
                      className="button button--soft button--sm"
                      disabled={current || starting !== null}
                      onClick={() => void start(entry.version)}
                    >
                      {busy ? (
                        <Spinner size={12} />
                      ) : current ? (
                        <Check size={12} />
                      ) : (
                        <ArrowRight size={12} />
                      )}
                      {current ? '使用中' : busy ? '准备中…' : '切换到此版本'}
                    </button>
                  </article>
                )
              })}
              {versions.length === 0 && (
                <EmptyState
                  icon={<Layers size={22} />}
                  title="没有找到可用版本"
                  description="这个游戏版本可能没有更多加载器版本，或网络暂时不可用。"
                />
              )}
              {(showAll || versions.length > visibleVersions.length) && (
                <button
                  type="button"
                  className="doctor-link loader-update-more"
                  onClick={() => setShowAll((value) => !value)}
                >
                  {showAll ? '收起历史版本' : `显示全部 ${versions.length} 个版本`}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </Modal>
  )
}
