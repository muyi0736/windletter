import { useEffect, useState } from 'react'
import {
  Activity,
  Globe2,
  Layers,
  Link2,
  Plus,
  Save,
  Server,
  Tag,
  Users
} from 'lucide-react'
import type { ServerProbe, ServerView } from '@shared/types'
import { cleanError, loaderLabel } from '../lib/format'
import { useLauncher } from '../store'
import { Modal, Spinner } from './ui'
import { ServerFavicon } from './ServerFavicon'
import { ServerMotd } from './ServerMotd'

export function ServerModal({
  open,
  server,
  onClose
}: {
  open: boolean
  server: ServerView | null
  onClose: () => void
}) {
  const instances = useLauncher((state) => state.instances)
  const selectedInstanceId = useLauncher((state) => state.selectedInstanceId)
  const addServer = useLauncher((state) => state.addServer)
  const updateServer = useLauncher((state) => state.updateServer)

  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [category, setCategory] = useState('')
  const [instanceId, setInstanceId] = useState('')
  const [note, setNote] = useState('')
  const [probe, setProbe] = useState<ServerProbe | null>(null)
  const [probing, setProbing] = useState(false)
  const [probeError, setProbeError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(server?.name ?? '')
    setCategory(server?.category ?? '')
    setAddress(server ? formatAddress(server.host, server.port) : '')
    setInstanceId(server?.instanceId ?? selectedInstanceId ?? (instances.length === 1 ? instances[0].id : ''))
    setNote(server?.note ?? '')
    setProbe(
      server && server.status.state !== 'unknown'
        ? {
            address: formatAddress(server.host, server.port),
            host: server.host,
            port: server.port,
            status: server.status
          }
        : null
    )
    setProbeError(null)
    setProbing(false)
    setSaving(false)
  }, [open, server?.id])

  if (!open) return null

  const selectedInstance = instances.find((instance) => instance.id === instanceId) ?? null

  const testConnection = async () => {
    if (!address.trim() || probing) return
    setProbing(true)
    setProbeError(null)
    try {
      const result = await window.ccl.servers.probe(address.trim())
      setProbe(result)
      if (result.status.state === 'offline') {
        setProbeError(result.status.error || '服务器当前无法连接')
      }
    } catch (error) {
      setProbe(null)
      setProbeError(cleanError(error))
    } finally {
      setProbing(false)
    }
  }

  const save = async () => {
    if (!address.trim() || saving) return
    setSaving(true)
    const input = {
      name: name.trim(),
      address: address.trim(),
      instanceId: instanceId || null,
      category: category.trim(),
      note: note.trim()
    }
    const saved = server
      ? await updateServer(server.id, input)
      : await addServer(input)
    setSaving(false)
    if (saved) onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={server ? '编辑服务器' : '添加服务器'}
      subtitle="保存地址和绑定的实例，之后就能一键启动并进服"
      icon={<Server size={18} />}
      size="md"
      footer={
        <div className="server-modal-footer">
          <button
            type="button"
            className="button button--ghost button--sm"
            disabled={saving}
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="button"
            className="button button--primary button--sm"
            disabled={saving || !address.trim()}
            onClick={() => void save()}
          >
            {saving ? <Spinner size={12} /> : server ? <Save size={12} /> : <Plus size={12} />}
            {server ? '保存修改' : '添加服务器'}
          </button>
        </div>
      }
    >
      <div className="server-form">
        <label className="form-field">
          <span className="form-label">名称</span>
          <div className="text-input">
            <Server size={13} />
            <input
              value={name}
              maxLength={48}
              placeholder="例如：月月的小屋（留空则使用服务器地址）"
              spellCheck={false}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
        </label>

        <label className="form-field">
          <span className="form-label">分类</span>
          <div className="text-input">
            <Tag size={13} />
            <input
              value={category}
              maxLength={20}
              placeholder="例如：科技冒险 / 生存 / 红石"
              spellCheck={false}
              onChange={(event) => setCategory(event.target.value)}
            />
          </div>
          <span className="form-hint">显示在服务器档案的 FILE 标签上；留空则只显示 FILE 编号。</span>
        </label>

        <label className="form-field">
          <span className="form-label">服务器地址</span>
          <div className="server-address-row">
            <div className="text-input">
              <Globe2 size={13} />
              <input
                value={address}
                maxLength={300}
                placeholder="mc.example.com:25565"
                spellCheck={false}
                autoFocus
                onChange={(event) => {
                  setAddress(event.target.value)
                  setProbe(null)
                  setProbeError(null)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void testConnection()
                }}
              />
            </div>
            <button
              type="button"
              className="button button--soft button--sm"
              disabled={probing || !address.trim()}
              onClick={() => void testConnection()}
            >
              {probing ? <Spinner size={12} /> : <Activity size={12} />}
              测试
            </button>
          </div>
          <span className="form-hint">支持域名、IPv4、带方括号的 IPv6 和自定义端口。</span>
        </label>

        {probeError && <p className="server-form-error">{probeError}</p>}

        {probe && (
          <div className={`server-probe ${probe.status.state === 'online' ? 'is-online' : 'is-offline'}`}>
            <div className="server-probe-head">
              <ServerFavicon
                favicon={probe.status.favicon}
                name={name || probe.host}
                size={34}
              />
              <div className="server-probe-title">
                <strong>{name.trim() || probe.address}</strong>
                <span>
                  {probe.status.state === 'online'
                    ? '连接成功'
                    : probe.status.state === 'offline'
                      ? '连接失败'
                      : '尚未检测'}
                </span>
              </div>
              {probe.status.state === 'online' && (
                <span className="server-probe-state">
                  {probe.status.latencyMs != null ? `${probe.status.latencyMs} ms` : '在线'}
                </span>
              )}
            </div>
            {probe.status.state === 'online' && (
              <>
                <div className="server-screen server-screen--probe">
                  <ServerMotd text={probe.status.motd} />
                </div>
                <div className="server-probe-facts">
                  <span>
                    <Users size={11} />
                    {probe.status.playersOnline ?? 0} / {probe.status.playersMax ?? '—'}
                  </span>
                  <span>
                    <Layers size={11} />
                    {probe.status.version ?? '未知版本'}
                  </span>
                  <span>
                    <Globe2 size={11} />
                    {probe.address}
                  </span>
                </div>
              </>
            )}
          </div>
        )}

        <label className="form-field">
          <span className="form-label">关联实例</span>
          <div className="server-select-wrap">
            <Link2 size={13} />
            <select
              className="server-select"
              value={instanceId}
              onChange={(event) => setInstanceId(event.target.value)}
            >
              <option value="">不绑定实例（只保存地址）</option>
              {instances.map((instance) => (
                <option key={instance.id} value={instance.id}>
                  {instance.name} · {instance.gameVersion}
                  {instance.loader !== 'vanilla' ? ` · ${loaderLabel(instance.loader)}` : ''}
                </option>
              ))}
            </select>
          </div>
          <span className="form-hint">
            {selectedInstance
              ? `启动时使用「${selectedInstance.name}」的模组、配置和 Java。`
              : instances.length
                ? '不绑定实例也可以保存地址，绑定后才能一键进服。'
                : '还没有实例；可以先保存地址，安装好整合包后再回来绑定。'}
          </span>
        </label>

        <label className="form-field">
          <span className="form-label">备注</span>
          <textarea
            className="server-note-input"
            value={note}
            maxLength={200}
            rows={2}
            placeholder="例如：和月月一起玩的生存服"
            onChange={(event) => setNote(event.target.value)}
          />
          <span className="form-hint">只显示在服务器卡片上，不会发给服务器。</span>
        </label>
      </div>
    </Modal>
  )
}

function formatAddress(host: string, port: number): string {
  return host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`
}
