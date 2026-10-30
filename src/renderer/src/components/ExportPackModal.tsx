import { useEffect, useState } from 'react'
import { Archive, Check, PackagePlus } from 'lucide-react'
import type { InstanceSummary, ModpackExportOptions, ModpackExportProgress } from '@shared/types'
import { useLauncher } from '../store'
import { cleanError, formatBytes } from '../lib/format'
import { Modal, ProgressBar, Spinner, Switch } from './ui'

const OPTION_ROWS: { key: keyof ModpackExportOptions; label: string; hint: string }[] = [
  { key: 'mods', label: '模组文件', hint: '把 mods 里的 jar 一起打包' },
  { key: 'config', label: '配置', hint: 'config 与 defaultconfigs' },
  { key: 'resourcepacks', label: '资源包', hint: 'resourcepacks 文件夹' },
  { key: 'shaderpacks', label: '光影包', hint: 'shaderpacks 文件夹' },
  { key: 'datapacks', label: '数据包', hint: 'datapacks 文件夹' }
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
  const [options, setOptions] = useState<ModpackExportOptions>({
    mods: true,
    config: true,
    resourcepacks: true,
    shaderpacks: true,
    datapacks: true
  })
  const [exporting, setExporting] = useState(false)
  const [progress, setProgress] = useState<ModpackExportProgress>({
    done: 0,
    total: 0,
    bytes: 0
  })
  const [resultPath, setResultPath] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setExporting(false)
    setProgress({ done: 0, total: 0, bytes: 0 })
    setResultPath('')
    setError('')
  }, [open, instance?.id])

  useEffect(() => {
    if (!open) return
    return window.ccl.instances.onExportProgress((next) => setProgress(next))
  }, [open])

  if (!instance) return null

  const percent = progress.total > 0 ? (progress.done / progress.total) * 100 : 0

  const exportPack = async () => {
    const safeName = instance.name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || '整合包'
    const path = await window.ccl.app.pickSaveFile(
      '导出整合包',
      `${safeName}.mrpack`,
      [{ name: 'Modrinth 整合包', extensions: ['mrpack'] }]
    )
    if (!path) return
    setExporting(true)
    setError('')
    setResultPath('')
    setProgress({ done: 0, total: 0, bytes: 0 })
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
      <p className="manual-pack-lead">
        生成一个 `.mrpack` 整合包。模组会以文件形式放进 overrides，导入后不需要重新下载；
        分享前请确认模组作者允许再分发。
      </p>

      <div className="export-pack-options">
        {OPTION_ROWS.map((row) => (
          <div key={row.key} className="export-pack-option">
            <div>
              <strong>{row.label}</strong>
              <span>{row.hint}</span>
            </div>
            <Switch
              checked={options[row.key]}
              label={row.label}
              onChange={(value) =>
                setOptions((previous) => ({ ...previous, [row.key]: value }))
              }
            />
          </div>
        ))}
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
