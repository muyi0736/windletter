import { useEffect, useState } from 'react'
import { Archive, Check, PackagePlus } from 'lucide-react'
import type {
  InstanceSummary,
  ModpackExportFormat,
  ModpackExportMode,
  ModpackExportOptions,
  ModpackExportPreview,
  ModpackExportProgress
} from '@shared/types'
import { useLauncher } from '../store'
import { cleanError, formatBytes } from '../lib/format'
import { Modal, ProgressBar, Spinner, Switch } from './ui'

const FORMATS: { value: ModpackExportFormat; label: string; hint: string }[] = [
  { value: 'mrpack', label: 'Modrinth .mrpack', hint: '标准清单，Modrinth/HMCL/PCL 通用' },
  { value: 'curseforge', label: 'CurseForge .zip', hint: 'manifest.json，CF/PCL/HMCL 导入' },
  { value: 'zip', label: '通用 .zip', hint: '目录直铺，PCL/HMCL 自动识别' }
]

export function ExportPackModal({
  open,
  instance,
  onClose
}: {
  open: boolean
  instance: InstanceSummary | null
  onClose: () => void
}) {
  const toast = useLauncher((state) => state.toast)
  const [format, setFormat] = useState<ModpackExportFormat>('mrpack')
  const [mode, setMode] = useState<ModpackExportMode>('download')
  const [mods, setMods] = useState(true)
  const [disabledMods, setDisabledMods] = useState(false)
  const [config, setConfig] = useState(true)
  const [resourcepacks, setResourcepacks] = useState(true)
  const [shaderpacks, setShaderpacks] = useState(true)
  const [datapacks, setDatapacks] = useState(true)
  const [gameSettings, setGameSettings] = useState(true)
  const [personalInfo, setPersonalInfo] = useState(false)
  const [saves, setSaves] = useState(false)
  const [serverList, setServerList] = useState(false)
  const [preview, setPreview] = useState<ModpackExportPreview>({
    resourcepacks: [],
    shaderpacks: []
  })
  const [rpSel, setRpSel] = useState<Set<string>>(new Set())
  const [shSel, setShSel] = useState<Set<string>>(new Set())
  const [exporting, setExporting] = useState(false)
  const [progress, setProgress] = useState<ModpackExportProgress>({ done: 0, total: 0, bytes: 0 })
  const [resultPath, setResultPath] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open || !instance) return
    setExporting(false)
    setProgress({ done: 0, total: 0, bytes: 0 })
    setResultPath('')
    setError('')
    let alive = true
    window.ccl.instances
      .exportPreview(instance.id)
      .then((next) => {
        if (!alive) return
        setPreview(next)
        setRpSel(new Set(next.resourcepacks))
        setShSel(new Set(next.shaderpacks))
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [open, instance?.id])

  useEffect(() => {
    if (!open) return
    return window.ccl.instances.onExportProgress((next) => setProgress(next))
  }, [open])

  if (!instance) return null

  const percent = progress.total > 0 ? (progress.done / progress.total) * 100 : 0

  const toggleSet = (
    set: Set<string>,
    name: string,
    apply: (next: Set<string>) => void
  ): void => {
    const next = new Set(set)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    apply(next)
  }

  const exportPack = async () => {
    const safeName = instance.name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || '整合包'
    const ext = format === 'mrpack' ? 'mrpack' : 'zip'
    const path = await window.ccl.app.pickSaveFile('导出整合包', `${safeName}.${ext}`, [
      { name: format === 'mrpack' ? 'Modrinth 整合包' : '整合包压缩包', extensions: [ext] }
    ])
    if (!path) return
    setExporting(true)
    setError('')
    setResultPath('')
    setProgress({ done: 0, total: 0, bytes: 0 })
    const options: ModpackExportOptions = {
      mods,
      config,
      resourcepacks,
      shaderpacks,
      datapacks,
      format,
      mode: format === 'mrpack' ? mode : 'bundled',
      gameSettings,
      personalInfo,
      saves,
      serverList,
      disabledMods,
      resourcepackFiles: [...rpSel],
      shaderpackFiles: [...shSel]
    }
    try {
      const result = await window.ccl.instances.exportModpack(instance.id, options, path)
      setResultPath(result.path)
      toast('success', '整合包已导出', result.path)
    } catch (err) {
      setError(cleanError(err))
    } finally {
      setExporting(false)
    }
  }

  const fileRows = (
    names: string[],
    sel: Set<string>,
    apply: (next: Set<string>) => void
  ) => (
    <div className="export-file-list">
      {names.length === 0 && <span className="export-file-row">（空）</span>}
      {names.map((name) => (
        <label key={name} className="export-file-row">
          <input
            type="checkbox"
            checked={sel.has(name)}
            onChange={() => toggleSet(sel, name, apply)}
          />
          <span title={name}>{name}</span>
        </label>
      ))}
    </div>
  )

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!exporting) onClose()
      }}
      title="导出整合包"
      subtitle={`${instance.name} · Minecraft ${instance.gameVersion}`}
      icon={<PackagePlus size={18} />}
      size="md"
      footer={
        <>
          <button
            type="button"
            className="button button--ghost button--sm"
            disabled={exporting}
            onClick={onClose}
          >
            关闭
          </button>
          <button
            type="button"
            className="button button--primary button--sm"
            disabled={exporting}
            onClick={() => void exportPack()}
          >
            {exporting ? <Spinner size={12} /> : <Archive size={12} />}
            {exporting ? '正在打包…' : '选择位置并导出'}
          </button>
        </>
      }
    >
      <div className="export-pack-format" role="group" aria-label="导出格式">
        {FORMATS.map((item) => (
          <button
            key={item.value}
            type="button"
            title={item.hint}
            className={format === item.value ? 'is-active' : ''}
            onClick={() => setFormat(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="export-pack-options">
        <div className="export-pack-option">
          <div>
            <strong>打包模式</strong>
            <span>
              {mode === 'bundled'
                ? '资源随包内置，导入后无需下载（离线可用）'
                : '仅写 Modrinth 下载链接，包体更小（需联网导入）'}
            </span>
          </div>
          <Switch
            checked={mode === 'bundled'}
            label="自包含"
            onChange={(value) => setMode(value ? 'bundled' : 'download')}
          />
        </div>

        <div className="export-pack-option">
          <div>
            <strong>模组文件</strong>
            <span>mods 里的 jar 一起打包</span>
          </div>
          <Switch checked={mods} label="模组" onChange={setMods} />
        </div>
        {mods && (
          <div className="export-pack-sub">
            <span>已禁用的 Mod（*.disabled）</span>
            <Switch checked={disabledMods} label="已禁用模组" onChange={setDisabledMods} />
          </div>
        )}

        <div className="export-pack-option">
          <div>
            <strong>Mod 设置</strong>
            <span>config 与 defaultconfigs</span>
          </div>
          <Switch checked={config} label="配置" onChange={setConfig} />
        </div>

        <div className="export-pack-option">
          <div>
            <strong>资源包</strong>
            <span>逐文件选择，保留启用顺序</span>
          </div>
          <Switch checked={resourcepacks} label="资源包" onChange={setResourcepacks} />
        </div>
        {resourcepacks && fileRows(preview.resourcepacks, rpSel, setRpSel)}

        <div className="export-pack-option">
          <div>
            <strong>光影包</strong>
            <span>逐文件选择</span>
          </div>
          <Switch checked={shaderpacks} label="光影包" onChange={setShaderpacks} />
        </div>
        {shaderpacks && fileRows(preview.shaderpacks, shSel, setShSel)}

        <div className="export-pack-option">
          <div>
            <strong>整合包数据</strong>
            <span>数据包 / kubejs / scripts / resources 等</span>
          </div>
          <Switch checked={datapacks} label="数据包" onChange={setDatapacks} />
        </div>

        <div className="export-pack-option">
          <div>
            <strong>游戏本体设置</strong>
            <span>options.txt / 光影设置（保留资源包启用顺序）</span>
          </div>
          <Switch checked={gameSettings} label="游戏设置" onChange={setGameSettings} />
        </div>

        <div className="export-pack-option">
          <div>
            <strong>个人信息</strong>
            <span>JEI 收藏 / 帕秋莉进度 / 地图记录（默认不导出）</span>
          </div>
          <Switch checked={personalInfo} label="个人信息" onChange={setPersonalInfo} />
        </div>

        <div className="export-pack-option">
          <div>
            <strong>单人存档</strong>
            <span>世界/地图（默认不导出）</span>
          </div>
          <Switch checked={saves} label="存档" onChange={setSaves} />
        </div>

        <div className="export-pack-option">
          <div>
            <strong>服务器列表</strong>
            <span>servers.dat（默认不导出）</span>
          </div>
          <Switch checked={serverList} label="服务器列表" onChange={setServerList} />
        </div>
      </div>

      {(exporting || progress.total > 0) && (
        <div className="export-pack-progress">
          <div className="export-pack-progress-head">
            <span>正在写入文件</span>
            <span>
              {progress.done} / {progress.total || '—'} · {formatBytes(progress.bytes)}
            </span>
          </div>
          <ProgressBar percent={percent} size="sm" />
        </div>
      )}

      {resultPath && (
        <div className="export-pack-result">
          <Check size={14} />
          <span>{resultPath}</span>
        </div>
      )}
      {error && <div className="download-detail-error">{error}</div>}
    </Modal>
  )
}
