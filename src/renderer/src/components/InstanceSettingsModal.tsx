import { useEffect, useState } from 'react'
import {
  Boxes,
  Coffee,
  FileDown,
  FolderOpen,
  Layers,
  PackagePlus,
  RotateCcw,
  Save,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trash2,
  Wrench
} from 'lucide-react'
import type { InstanceSummary, LoaderRollbackState } from '@shared/types'
import { useLauncher } from '../store'
import { loaderLabel } from '../lib/format'
import { Modal, SettingSlider, Spinner, Switch } from './ui'
import { RemoteIcon } from './RemoteIcon'
import { ExportPackModal } from './ExportPackModal'
import { LoaderUpdateModal } from './LoaderUpdateModal'
import { JvmPresetsModal } from './JvmPresetsModal'

type FolderKind = 'version' | 'saves' | 'mods' | 'screenshots'

const FOLDERS: { kind: FolderKind; label: string }[] = [
  { kind: 'version', label: '版本文件夹' },
  { kind: 'saves', label: '存档文件夹' },
  { kind: 'mods', label: 'Mod 文件夹' },
  { kind: 'screenshots', label: '截图文件夹' }
]

export function InstanceSettingsModal({
  open,
  instance,
  globalMemoryMb,
  onClose
}: {
  open: boolean
  instance: InstanceSummary | null
  globalMemoryMb: number
  onClose: () => void
}) {
  const updateInstanceSettings = useLauncher((state) => state.updateInstanceSettings)
  const updateInstanceMeta = useLauncher((state) => state.updateInstanceMeta)
  const openInstanceFolder = useLauncher((state) => state.openInstanceFolder)
  const exportInstanceScript = useLauncher((state) => state.exportInstanceScript)
  const repairInstance = useLauncher((state) => state.repairInstance)
  const removeInstance = useLauncher((state) => state.removeInstance)
  const rollbackInstanceLoader = useLauncher((state) => state.rollbackInstanceLoader)
  const checkPresets = useLauncher((state) => state.checkPresets)
  const toast = useLauncher((state) => state.toast)

  const [customMemory, setCustomMemory] = useState(false)
  const [memoryMb, setMemoryMb] = useState(globalMemoryMb)
  const [extraJvmArgs, setExtraJvmArgs] = useState('')
  const [javaPath, setJavaPath] = useState('')
  const [jvmPresetsOpen, setJvmPresetsOpen] = useState(false)

  const [name, setName] = useState('')
  const [summary, setSummary] = useState('')
  const [category, setCategory] = useState('')
  const [favorite, setFavorite] = useState(false)
  const [iconUrl, setIconUrl] = useState<string | null>(null)
  const [selectingIcon, setSelectingIcon] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteExternalFiles, setDeleteExternalFiles] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [loaderOpen, setLoaderOpen] = useState(false)
  const [loaderRollback, setLoaderRollback] = useState<LoaderRollbackState | null>(null)
  const [rollbackBusy, setRollbackBusy] = useState(false)

  useEffect(() => {
    if (!open || !instance) return
    const custom = instance.memoryMb != null
    setCustomMemory(custom)
    setMemoryMb(instance.memoryMb ?? globalMemoryMb)
    setExtraJvmArgs(instance.extraJvmArgs ?? '')
    setJavaPath(instance.javaPath ?? '')
    setName(instance.name)
    setSummary(instance.summary)
    setCategory(instance.category ?? '')
    setFavorite(Boolean(instance.favorite))
    setIconUrl(instance.iconUrl ?? null)
    setConfirmDelete(false)
    setDeleteExternalFiles(Boolean(instance.external))
    setLoaderOpen(false)
    setLoaderRollback(null)
    setRollbackBusy(false)
  }, [open, instance, globalMemoryMb])

  useEffect(() => {
    if (!open || !instance || instance.loader === 'vanilla') {
      setLoaderRollback(null)
      return
    }
    let cancelled = false
    window.ccl.instances
      .loaderRollbackState(instance.id)
      .then((state) => {
        if (!cancelled) setLoaderRollback(state)
      })
      .catch(() => {
        if (!cancelled) setLoaderRollback(null)
      })
    return () => {
      cancelled = true
    }
  }, [open, instance?.id, instance?.versionId, instance?.loaderVersion])

  if (!instance) return null

  const chooseJava = async () => {
    const path = await window.ccl.app.pickFile('选择这个实例使用的 java.exe', [
      { name: 'Java', extensions: ['exe'] }
    ])
    if (path) setJavaPath(path)
  }

  const chooseIcon = async () => {
    const path = await window.ccl.app.pickFile('选择实例图标', [
      { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }
    ])
    if (!path) return
    setSelectingIcon(true)
    const data = await window.ccl.app.imageDataUrl(path)
    setSelectingIcon(false)
    if (data) setIconUrl(data)
    else toast('error', '无法读取这张图片', '请换一张 png/jpg/webp 图片')
  }

  const save = async () => {
    if (!name.trim()) {
      toast('error', '实例名称不能为空')
      return
    }
    setSaving(true)
    const meta = await updateInstanceMeta(instance.id, {
      name: name.trim(),
      summary,
      category: category.trim(),
      favorite,
      iconUrl
    })
    const settings = await updateInstanceSettings(instance.id, {
      memoryMb: customMemory ? memoryMb : null,
      extraJvmArgs,
      javaPath: javaPath.trim() || null
    })
    setSaving(false)
    if (meta && settings) {
      toast('success', '实例已保存', name.trim())
      onClose()
    }
  }

  const deleteInstance = async () => {
    const deleted = await removeInstance(
      instance.id,
      instance.external ? deleteExternalFiles : false
    )
    if (deleted) onClose()
  }

  const rollbackLoader = async () => {
    if (rollbackBusy) return
    setRollbackBusy(true)
    const task = await rollbackInstanceLoader(instance.id)
    setRollbackBusy(false)
    if (task) onClose()
  }

  return (
    <>
    <Modal
      open={open}
      onClose={onClose}
      title="实例管理"
      subtitle={`${instance.name} · Minecraft ${instance.gameVersion}`}
      icon={<Settings2 size={18} />}
      size="lg"
      footer={
        <div className="instance-settings-footer">
          <button type="button" className="button button--ghost button--sm" disabled={saving} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="button button--primary button--sm"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? <Spinner size={12} /> : <Save size={12} />}
            保存实例
          </button>
        </div>
      }
    >
      <div className="instance-settings-form instance-manager">
        <section className="instance-manager-section">
          <h3>个性化</h3>
          <div className="instance-manager-identity">
            <span className="instance-manager-icon">
              {iconUrl ? (
                iconUrl.startsWith('data:') ? (
                  <img src={iconUrl} alt="" />
                ) : (
                  <RemoteIcon url={iconUrl} fallback={<Boxes size={28} />} />
                )
              ) : (
                <Boxes size={28} />
              )}
            </span>
            <div className="instance-manager-identity-body">
              <label className="form-field">
                <span className="form-label">版本名</span>
                <div className="text-input">
                  <input
                    value={name}
                    maxLength={80}
                    spellCheck={false}
                    onChange={(event) => setName(event.target.value)}
                  />
                </div>
              </label>
              <div className="instance-manager-icon-actions">
                <button
                  type="button"
                  className="button button--soft button--sm"
                  disabled={selectingIcon}
                  onClick={() => void chooseIcon()}
                >
                  {selectingIcon ? <Spinner size={12} /> : <Boxes size={12} />}
                  更换图标
                </button>
                {iconUrl && (
                  <button
                    type="button"
                    className="button button--ghost button--sm"
                    onClick={() => setIconUrl(null)}
                  >
                    恢复默认
                  </button>
                )}
              </div>
            </div>
          </div>

          <label className="form-field">
            <span className="form-label">版本描述</span>
            <textarea
                className="instance-summary-input"
                value={summary}
                maxLength={300}
                rows={2}
                placeholder="给这个实例写一句描述"
                onChange={(event) => setSummary(event.target.value)}
              />
          </label>

          <div className="instance-manager-inline">
            <label className="form-field">
              <span className="form-label">分类</span>
              <div className="text-input">
                <input
                  value={category}
                  maxLength={20}
                  placeholder="例如 冒险、科技、整合包"
                  spellCheck={false}
                  onChange={(event) => setCategory(event.target.value)}
                />
              </div>
            </label>
            <div className="instance-manager-favorite">
              <Star size={14} />
              <span>加入收藏夹</span>
              <Switch checked={favorite} label="加入收藏夹" onChange={setFavorite} />
            </div>
          </div>
        </section>

        <section className="instance-manager-section">
          <h3>加载器</h3>
          <div className="instance-loader-row">
            <div>
              <strong>
                {loaderLabel(instance.loader) ?? '原版'}{' '}
                {instance.loaderVersion ?? ''}
              </strong>
              <span>
                {instance.external
                  ? `外部实例：会写入 ${instance.external.baseDir}\\versions 与 libraries`
                  : instance.loader === 'vanilla'
                    ? '原版实例没有加载器，可在下载页安装后创建新实例'
                    : `Minecraft ${instance.gameVersion} · ${instance.versionId}`}
              </span>
            </div>
            <button
              type="button"
              className="button button--soft button--sm"
              disabled={instance.loader === 'vanilla'}
              title={
                instance.loader === 'vanilla'
                  ? '原版实例没有加载器'
                  : instance.external
                    ? '会写入外部目录；模组、配置和存档不受影响'
                    : '选择另一个加载器版本，模组与存档不受影响'
              }
              onClick={() => setLoaderOpen(true)}
            >
              <Layers size={13} />
              更新加载器
            </button>
          </div>
          {loaderRollback && (
            <div className="instance-loader-rollback">
              <div>
                <strong>可回滚到 {loaderRollback.fromLoaderVersion}</strong>
                <span>
                  上次从 {loaderRollback.fromLoaderVersion} 更新到{' '}
                  {loaderRollback.toLoaderVersion}
                </span>
              </div>
              <button
                type="button"
                className="button button--ghost button--sm"
                disabled={rollbackBusy}
                onClick={() => void rollbackLoader()}
              >
                {rollbackBusy ? <Spinner size={12} /> : <RotateCcw size={12} />}
                回滚上次加载器
              </button>
            </div>
          )}
        </section>

        <section className="instance-manager-section">
          <h3>快捷方式</h3>
          <div className="instance-manager-buttons">
            {FOLDERS.map((folder) => (
              <button
                key={folder.kind}
                type="button"
                className="button button--soft button--sm"
                onClick={() => void openInstanceFolder(instance.id, folder.kind)}
              >
                <FolderOpen size={13} />
                {folder.label}
              </button>
            ))}
          </div>
        </section>

        <section className="instance-manager-section">
          <h3>高级管理</h3>
          <div className="instance-manager-buttons">
            <button
              type="button"
              className="button button--soft button--sm"
              onClick={() => setExportOpen(true)}
            >
              <PackagePlus size={13} />
              导出整合包
            </button>
            <button
              type="button"
              className="button button--soft button--sm"
              onClick={() => void exportInstanceScript(instance.id)}
            >
              <FileDown size={13} />
              导出启动脚本
            </button>
            <button
              type="button"
              className="button button--soft button--sm"
              title="检查这个实例缺少哪些预设模组，并选择是否补齐"
              onClick={() => {
                onClose()
                void checkPresets(instance.id, 'manual')
              }}
            >
              <Sparkles size={13} />
              检查预设模组
            </button>
            <button
              type="button"
              className="button button--soft button--sm"
              title={
                instance.external
                  ? '检查原版、加载器和运行库，会写入外部目录的 versions / assets / libraries；旧加载器档案被清理时会重新安装'
                  : '检查原版、加载器和运行库；旧加载器档案被清理时会重新安装'
              }
              onClick={() => void repairInstance(instance.id)}
            >
              <Wrench size={13} />
              补全文件
            </button>
            <button
              type="button"
              className="button button--danger button--sm"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 size={13} />
              删除版本
            </button>
          </div>
          {confirmDelete && (
            <div className="instance-delete-confirm">
              <span>
                {instance.external
                  ? `确定删除「${instance.name}」吗？`
                  : `确定删除「${instance.name}」吗？只删除风信中的实例，不删除其他启动器的文件。`}
              </span>
              {instance.external && (
                <>
                  <label className="instance-delete-check">
                    <input
                      type="checkbox"
                      checked={deleteExternalFiles}
                      onChange={(event) => setDeleteExternalFiles(event.target.checked)}
                    />
                    <span>同时永久删除原整合包目录（含 mods、config、saves）</span>
                  </label>
                  <div className="instance-delete-path">
                    {deleteExternalFiles ? (
                      <>
                        <span>
                          将删除：<code>{instance.external.gameDir}</code>
                        </span>
                        <span>
                          不会删除 {instance.external.baseDir} 下的 libraries、assets
                          或其他版本；操作不可恢复。
                        </span>
                      </>
                    ) : (
                      <span>只从风信移除这条引用，原整合包目录与存档保持不变。</span>
                    )}
                  </div>
                </>
              )}
              <button
                type="button"
                className="button button--danger button--sm"
                onClick={() => void deleteInstance()}
              >
                {instance.external
                  ? deleteExternalFiles
                    ? '永久删除'
                    : '仅移除引用'
                  : '确认删除'}
              </button>
              <button
                type="button"
                className="button button--ghost button--sm"
                onClick={() => setConfirmDelete(false)}
              >
                取消
              </button>
            </div>
          )}
        </section>

        <section className="instance-manager-section">
          <h3>启动设置</h3>
          <div className="instance-settings-row">
            <div>
              <strong>内存分配</strong>
              <span>当前{buildMemoryHint(customMemory, memoryMb, globalMemoryMb)}</span>
            </div>
            <Switch
              checked={customMemory}
              label="自定义内存"
              onChange={(value) => {
                setCustomMemory(value)
                if (value && memoryMb === globalMemoryMb) {
                  setMemoryMb(Math.min(16384, Math.max(4096, globalMemoryMb)))
                }
              }}
            />
          </div>
          {customMemory && (
            <SettingSlider
              ariaLabel="实例内存分配"
              value={memoryMb}
              min={1024}
              max={16384}
              step={512}
              format={(value) => `${value / 1024} GB`}
              onCommit={setMemoryMb}
            />
          )}

          <label className="form-field">
            <span className="form-label">额外 JVM 参数</span>
            <div className="instance-java-row">
              <div className="text-input">
                <input
                  value={extraJvmArgs}
                  placeholder="例如 -XX:+UseG1GC，留空则使用全局参数"
                  spellCheck={false}
                  onChange={(event) => setExtraJvmArgs(event.target.value)}
                />
              </div>
              <button
                type="button"
                className="button button--soft button--sm"
                onClick={() => setJvmPresetsOpen(true)}
              >
                <SlidersHorizontal size={12} />
                预设
              </button>
            </div>
            <span className="form-hint">会追加在全局 JVM 参数之后，只对这个实例生效。</span>
          </label>

          <label className="form-field">
            <span className="form-label">Java 路径</span>
            <div className="instance-java-row">
              <div className="text-input">
                <Coffee size={13} />
                <input value={javaPath} placeholder="留空则自动选择匹配的 Java" readOnly />
              </div>
              <button type="button" className="button button--soft button--sm" onClick={() => void chooseJava()}>
                <FolderOpen size={12} />
                选择
              </button>
              <button type="button" className="button button--ghost button--sm" onClick={() => setJavaPath('')}>
                <RotateCcw size={12} />
                自动
              </button>
            </div>
          </label>

          <p className="instance-settings-tip">
            外部实例与原来的 .minecraft 共享文件；这里只改变风信启动它时使用的内存、JVM 参数和 Java。
          </p>
        </section>
      </div>
    </Modal>
      <ExportPackModal
        open={exportOpen}
        instance={instance}
        onClose={() => setExportOpen(false)}
      />
      <LoaderUpdateModal
        open={loaderOpen}
        instance={instance}
        onClose={() => setLoaderOpen(false)}
        onStarted={onClose}
      />
      <JvmPresetsModal
        open={jvmPresetsOpen}
        currentArgs={extraJvmArgs}
        onClose={() => setJvmPresetsOpen(false)}
        onApply={(args, presetName) => {
          setExtraJvmArgs(args)
          toast('info', '已套用 JVM 预设', presetName + ' · 点击保存设置后生效')
        }}
      />
    </>
  )
}

function buildMemoryHint(custom: boolean, memoryMb: number, globalMb: number): string {
  if (!custom) return `跟随全局：${globalMb / 1024} GB`
  return `独立分配：${memoryMb / 1024} GB（全局 ${globalMb / 1024} GB）`
}
