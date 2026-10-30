import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Bot,
  CheckSquare,
  FolderOpen,
  Package,
  Search,
  Server,
  ShieldCheck,
  Sparkles,
  Square
} from 'lucide-react'
import type {
  AiConfigView,
  InstanceSummary,
  ServerPackModView,
  ServerPackPreview
} from '@shared/types'
import { useLauncher } from '../store'
import { cleanError, formatBytes } from '../lib/format'
import { ServerPackCheckModal } from './ServerPackCheckModal'
import { Modal, Spinner, Switch } from './ui'

function safeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || 'server-pack'
}

export function ServerPackModal({
  instance,
  onClose
}: {
  instance: InstanceSummary | null
  onClose: () => void
}) {
  const settings = useLauncher((state) => state.settings)
  const toast = useLauncher((state) => state.toast)
  const [preview, setPreview] = useState<ServerPackPreview | null>(null)
  const [mods, setMods] = useState<ServerPackModView[]>([])
  const [aiConfig, setAiConfig] = useState<AiConfigView | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiNotes, setAiNotes] = useState('')
  const [aiReasons, setAiReasons] = useState<Record<string, string>>({})
  const [query, setQuery] = useState('')
  const [outputPath, setOutputPath] = useState('')
  const [includeConfigs, setIncludeConfigs] = useState(true)
  const [includeBootstrap, setIncludeBootstrap] = useState(true)
  const [motd, setMotd] = useState('风信服务端')
  const [port, setPort] = useState('25565')
  const [maxPlayers, setMaxPlayers] = useState('20')
  const [viewDistance, setViewDistance] = useState('10')
  const [onlineMode, setOnlineMode] = useState(true)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [checkOpen, setCheckOpen] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!instance) return
    setLoading(true)
    setError('')
    try {
      const next = await window.ccl.serverPacks.preview(instance.id)
      setPreview(next)
      setMods(next.mods)
      setIncludeBootstrap(next.supportsBootstrap)
      setOutputPath(
        settings?.gameDir
          ? `${settings.gameDir}\\${safeFileName(instance.name)}-server-pack.zip`
          : `${safeFileName(instance.name)}-server-pack.zip`
      )
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setLoading(false)
    }
  }, [instance, settings?.gameDir])

  useEffect(() => {
    if (!instance) return
    setPreview(null)
    setMods([])
    setQuery('')
    setAiNotes('')
    setAiReasons({})
    setError('')
    void load()
    void window.ccl.ai.getConfig().catch(() => null).then(setAiConfig)
  }, [instance?.id, load])

  const included = mods.filter((mod) => mod.include)
  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return mods
    return mods.filter(
      (mod) =>
        mod.file.toLowerCase().includes(keyword) ||
        mod.name.toLowerCase().includes(keyword) ||
        (mod.id ?? '').toLowerCase().includes(keyword)
    )
  }, [mods, query])

  const chooseOutput = async () => {
    if (!instance) return
    const picked = await window.ccl.app.pickSaveFile(
      '保存服务端包',
      outputPath || `${safeFileName(instance.name)}-server-pack.zip`,
      [{ name: 'ZIP 压缩包', extensions: ['zip'] }]
    )
    if (picked) setOutputPath(picked)
  }

  const toggle = (file: string) => {
    setMods((current) =>
      current.map((mod) => (mod.file === file ? { ...mod, include: !mod.include } : mod))
    )
  }

  const suggest = async () => {
    if (!instance || aiBusy) return
    setAiBusy(true)
    setError('')
    try {
      const suggestion = await window.ccl.serverPacks.suggest(instance.id)
      const files = new Set(suggestion.exclude.map((item) => item.file))
      const reasons: Record<string, string> = {}
      for (const item of suggestion.exclude) reasons[item.file] = item.reason
      setAiReasons(reasons)
      setAiNotes(suggestion.notes)
      setMods((current) =>
        current.map((mod) => (files.has(mod.file) ? { ...mod, include: false } : mod))
      )
      toast('info', 'AI 排除建议已应用', `建议排除 ${files.size} 个客户端模组，请确认后生成`)
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setAiBusy(false)
    }
  }

  const submit = async () => {
    if (!instance || busy) return
    if (!outputPath.trim() || !/\.zip$/i.test(outputPath.trim())) {
      setError('请选择以 .zip 结尾的保存路径')
      return
    }
    setBusy(true)
    setError('')
    try {
      await window.ccl.serverPacks.create({
        instanceId: instance.id,
        outputPath: outputPath.trim(),
        includeMods: included.map((mod) => mod.file),
        includeConfigs,
        includeBootstrap,
        properties: {
          motd,
          port: Number(port) || 25565,
          maxPlayers: Number(maxPlayers) || 20,
          onlineMode,
          viewDistance: Number(viewDistance) || 10
        }
      })
      toast('info', '服务端包任务已开始', '进度会显示在后台任务')
      onClose()
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setBusy(false)
    }
  }

  if (!instance) return null
  const aiReady = Boolean(aiConfig?.enabled && aiConfig.baseUrl && aiConfig.model)

  return (
    <>
    <Modal
      open={Boolean(instance)}
      onClose={onClose}
      title="制作服务端包"
      subtitle={`${instance.name} · Minecraft ${instance.gameVersion} · ${instance.loader === 'vanilla' ? '原版' : instance.loader}${instance.loaderVersion ? ` ${instance.loaderVersion}` : ''}`}
      icon={<Server size={18} />}
      size="xl"
      footer={
        <div className="serverpack-footer">
          <span>
            将包含 {included.length} / {mods.length} 个模组
            {included.length > 0
              ? ` · ${formatBytes(included.reduce((sum, mod) => sum + mod.size, 0))}`
              : ''}
          </span>
          <div>
            <button
              type="button"
              className="button button--ghost"
              onClick={() => setCheckOpen(true)}
              disabled={busy}
              title="检查已经导出的 ZIP，或实际启动一次服务器"
            >
              <ShieldCheck size={13} />
              验证服务端包
            </button>
            <button type="button" className="button button--ghost" onClick={onClose} disabled={busy}>
              取消
            </button>
            <button
              type="button"
              className="button button--primary"
              onClick={() => void submit()}
              disabled={busy || loading || !preview}
            >
              {busy ? <Spinner size={13} /> : <Package size={13} />}
              生成服务端包
            </button>
          </div>
        </div>
      }
    >
      {loading && !preview ? (
        <div className="serverpack-loading">
          <Spinner size={16} />
          正在扫描实例模组…
        </div>
      ) : error && !preview ? (
        <div className="serverpack-error">
          <span>{error}</span>
          <button type="button" className="link-button" onClick={() => void load()}>
            重试
          </button>
        </div>
      ) : preview ? (
        <div className="serverpack-body">
          <div className="serverpack-output">
            <div>
              <span>保存到</span>
              <strong title={outputPath}>{outputPath || '尚未选择'}</strong>
            </div>
            <button type="button" className="button button--soft button--sm" onClick={() => void chooseOutput()}>
              <FolderOpen size={13} />
              选择位置
            </button>
          </div>

          <div className="serverpack-options">
            <label>
              <input
                type="checkbox"
                checked={includeConfigs}
                onChange={(event) => setIncludeConfigs(event.target.checked)}
              />
              <span>
                <strong>包含配置和脚本</strong>
                <small>
                  {preview.directories.length > 0
                    ? preview.directories.join(' · ')
                    : '源实例没有 config/defaultconfigs 等目录'}
                </small>
              </span>
            </label>
            <label className={!preview.supportsBootstrap ? 'is-disabled' : ''}>
              <input
                type="checkbox"
                checked={includeBootstrap}
                disabled={!preview.supportsBootstrap}
                onChange={(event) => setIncludeBootstrap(event.target.checked)}
              />
              <span>
                <strong>包含服务端启动器</strong>
                <small>
                  {preview.supportsBootstrap
                    ? '下载对应版本的服务端 jar/安装器并写入启动脚本'
                    : preview.bootstrapNote ?? '这个加载器没有自动启动器'}
                </small>
              </span>
            </label>
          </div>

          <div className="serverpack-properties">
            <label className="serverpack-field is-wide">
              <span>MOTD</span>
              <input value={motd} maxLength={120} onChange={(event) => setMotd(event.target.value)} />
            </label>
            <label className="serverpack-field">
              <span>端口</span>
              <input inputMode="numeric" value={port} onChange={(event) => setPort(event.target.value.replace(/\D/g, ''))} />
            </label>
            <label className="serverpack-field">
              <span>最大玩家</span>
              <input inputMode="numeric" value={maxPlayers} onChange={(event) => setMaxPlayers(event.target.value.replace(/\D/g, ''))} />
            </label>
            <label className="serverpack-field">
              <span>视距</span>
              <input inputMode="numeric" value={viewDistance} onChange={(event) => setViewDistance(event.target.value.replace(/\D/g, ''))} />
            </label>
            <label className="serverpack-toggle">
              <span>正版验证</span>
              <Switch checked={onlineMode} onChange={setOnlineMode} />
            </label>
          </div>

          <div className="serverpack-mods">
            <div className="serverpack-mods-head">
              <div>
                <strong>模组</strong>
                <span>
                  已选 {included.length} / {mods.length}
                </span>
              </div>
              <div className="serverpack-mods-actions">
                <button type="button" className="link-button" onClick={() => setMods((current) => current.map((mod) => ({ ...mod, include: true })))}>
                  <CheckSquare size={12} />
                  全选
                </button>
                <button
                  type="button"
                  className="link-button"
                  onClick={() =>
                    setMods((current) =>
                      current.map((mod) => ({ ...mod, include: mod.side !== 'client' }))
                    )
                  }
                >
                  <Square size={12} />
                  仅双端/服务端
                </button>
                <button
                  type="button"
                  className="button button--ghost button--sm"
                  onClick={() => void suggest()}
                  disabled={!aiReady || aiBusy}
                  title={aiReady ? '让 AI 结合模组元数据建议客户端排除项' : '请先在设置中启用 AI 辅助诊断'}
                >
                  {aiBusy ? <Spinner size={12} /> : <Bot size={13} />}
                  AI 建议
                </button>
              </div>
            </div>

            {aiNotes && (
              <div className="serverpack-ai-note">
                <Sparkles size={13} />
                <span>{aiNotes}</span>
              </div>
            )}

            <div className="serverpack-search">
              <Search size={13} />
              <input
                value={query}
                placeholder="搜索模组文件名、ID 或名称"
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>

            <div className="serverpack-mod-list">
              {filtered.length === 0 ? (
                <p className="serverpack-empty">没有匹配的模组。</p>
              ) : (
                filtered.map((mod) => (
                  <label key={mod.file} className={`serverpack-mod ${mod.include ? 'is-included' : ''}`}>
                    <input
                      type="checkbox"
                      checked={mod.include}
                      onChange={() => toggle(mod.file)}
                    />
                    <span className="serverpack-mod-copy">
                      <span className="serverpack-mod-name">
                        <strong title={mod.name}>{mod.name}</strong>
                        <em className={`serverpack-side is-${mod.side}`}>
                          {mod.side === 'client'
                            ? '仅客户端'
                            : mod.side === 'server'
                              ? '仅服务端'
                              : mod.side === 'unknown'
                                ? '未知'
                                : '双端'}
                        </em>
                        {aiReasons[mod.file] && (
                          <em className="serverpack-side is-ai" title={aiReasons[mod.file]}>
                            AI 建议
                          </em>
                        )}
                      </span>
                      <small title={mod.file}>
                        {mod.file}
                        {mod.id ? ` · ${mod.id}` : ''}
                        {mod.version ? ` · ${mod.version}` : ''}
                      </small>
                      <small className="serverpack-mod-reason">{mod.reason}</small>
                    </span>
                    <span className="serverpack-mod-size">{formatBytes(mod.size)}</span>
                  </label>
                ))
              )}
            </div>
          </div>

          {error && (
            <div className="serverpack-error">
              <span>{error}</span>
              <button type="button" className="link-button" onClick={() => setError('')}>
                关闭
              </button>
            </div>
          )}
        </div>
      ) : null}
    </Modal>
    <ServerPackCheckModal
      open={checkOpen}
      instance={instance}
      initialPath={outputPath}
      onClose={() => setCheckOpen(false)}
    />
    </>
  )
}