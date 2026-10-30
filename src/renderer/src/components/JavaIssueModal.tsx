import { Coffee } from 'lucide-react'
import { useLauncher } from '../store'
import { Modal } from './ui'

export function JavaIssueModal() {
  const issue = useLauncher((state) => state.javaIssue)
  const dismiss = useLauncher((state) => state.dismissJavaIssue)
  const downloadJava = useLauncher((state) => state.downloadJava)
  const setPage = useLauncher((state) => state.setPage)

  return (
    <Modal
      open={Boolean(issue)}
      onClose={dismiss}
      title="启动前需要换一个 Java"
      subtitle={issue ? `这个版本需要 Java ${issue.requiredMajor ?? '?'}` : undefined}
      icon={<Coffee size={18} />}
      size="sm"
      footer={
        <>
          <button
            type="button"
            className="button button--ghost"
            onClick={() => {
              setPage('settings')
              dismiss()
            }}
          >
            打开设置
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={() => {
              if (issue) void downloadJava(issue.versionId)
              dismiss()
            }}
          >
            自动准备 Java {issue?.requiredMajor ?? ''}
          </button>
        </>
      }
    >
      <p className="manual-pack-lead">
        当前设置里的 Java 与这个版本不匹配。下载和安装不受影响，但启动前必须使用兼容的 Java。
        可以让风信自动准备一个，或到设置里手动指定。
      </p>
      {issue?.message && <p className="manual-pack-note">{issue.message}</p>}
    </Modal>
  )
}
