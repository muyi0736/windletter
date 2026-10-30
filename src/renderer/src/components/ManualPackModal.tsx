import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { AlertTriangle, ExternalLink, FolderOpen } from 'lucide-react'
import { useLauncher } from '../store'
import { formatBytes } from '../lib/format'
import { Modal } from './ui'

export function ManualPackModal() {
  const manualPack = useLauncher((state) => state.manualPack)
  const dismissManualPack = useLauncher((state) => state.dismissManualPack)
  const retryManualPack = useLauncher((state) => state.retryManualPack)
  const [picked, setPicked] = useState<{ name: string; path: string }[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  const files = manualPack?.files ?? []
  const totalSize = files.reduce((sum, file) => sum + (file.size ?? 0), 0)

  const close = () => {
    setPicked([])
    dismissManualPack()
  }

  const onPick = (event: ChangeEvent<HTMLInputElement>) => {
    const next = Array.from(event.target.files ?? [])
      .map((file) => ({ name: file.name, path: window.ccl.app.getPathForFile(file) }))
      .filter((item) => Boolean(item.path))
    setPicked((previous) => {
      const map = new Map(previous.map((item) => [item.path, item]))
      for (const item of next) map.set(item.path, item)
      return [...map.values()]
    })
    event.target.value = ''
  }

  const retry = async () => {
    if (picked.length === 0) return
    const paths = picked.map((item) => item.path)
    setPicked([])
    await retryManualPack(paths)
  }

  return (
    <Modal
      open={Boolean(manualPack)}
      onClose={close}
      title="需要手动下载几个模组"
      subtitle={
        manualPack
          ? `${manualPack.request.title} · ${files.length} 个文件 · 约 ${formatBytes(totalSize)}`
          : undefined
      }
      icon={<AlertTriangle size={18} />}
      size="lg"
      footer={
        <>
          <button type="button" className="button button--ghost" onClick={close}>
            稍后处理
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={() => void retry()}
            disabled={picked.length === 0}
          >
            继续安装
          </button>
        </>
      }
    >
      <p className="manual-pack-lead">
        这些模组的作者关闭了第三方 API 下载，CurseForge
        不会把直链交给启动器，风信也不会绕过限制。请在浏览器里逐个下载，再把下载到的 jar
        一起选进来，启动器会按 SHA1 自动匹配。
      </p>
      <ul className="manual-pack-list">
        {files.map((file) => (
          <li key={file.fileId}>
            <div>
              <strong>{file.fileName}</strong>
              <span>{file.size ? formatBytes(file.size) : '大小未知'}</span>
            </div>
            <button
              type="button"
              className="button button--ghost button--sm"
              onClick={() => void window.ccl.app.openExternal(file.pageUrl)}
            >
              <ExternalLink size={13} />
              打开下载页
            </button>
          </li>
        ))}
      </ul>
      <div className="manual-pack-pick">
        <input ref={inputRef} type="file" accept=".jar" multiple hidden onChange={onPick} />
        <button
          type="button"
          className="button button--ghost"
          onClick={() => inputRef.current?.click()}
        >
          <FolderOpen size={14} />
          选择已下载的 jar
        </button>
        <span>
          {picked.length > 0 ? `已选择 ${picked.length} 个文件` : '可以一次多选，不需要改名'}
        </span>
      </div>
      {picked.length > 0 && (
        <ul className="manual-pack-picked">
          {picked.map((item) => (
            <li key={item.path}>{item.name}</li>
          ))}
        </ul>
      )}
      <p className="manual-pack-note">
        继续后，已下载的整合包和模组会从缓存复用，不会重新下载；没匹配上的文件会再次提示。
      </p>
    </Modal>
  )
}
