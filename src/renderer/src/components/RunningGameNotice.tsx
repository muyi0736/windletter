import { useEffect, useState } from 'react'
import { Gamepad2, Power } from 'lucide-react'
import type { RunningGameInfo } from '@shared/types'
import { useLauncher } from '../store'
import { formatClock } from '../lib/format'
import { ConfirmDialog } from './ui'

export function RunningGameNotice() {
  const toast = useLauncher((state) => state.toast)
  const [game, setGame] = useState<RunningGameInfo | null>(null)
  const [hidden, setHidden] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [stopping, setStopping] = useState(false)

  useEffect(() => {
    let alive = true
    window.ccl.runningGame
      .inspect()
      .then((info) => {
        if (alive) setGame(info)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  if (!game || hidden) return null

  const label = game.name || game.versionId
  const start = new Date(game.startedAt)

  const stop = async () => {
    setStopping(true)
    try {
      const stopped = await window.ccl.runningGame.stop()
      setGame(null)
      setConfirming(false)
      toast(
        stopped ? 'success' : 'info',
        stopped ? '游戏进程已结束' : '进程已经不在运行',
        `${label} · PID ${game.pid}`
      )
    } catch (error) {
      toast('error', '无法结束游戏进程', error instanceof Error ? error.message : String(error))
    } finally {
      setStopping(false)
    }
  }

  return (
    <>
      <div className="running-game-notice" role="status" aria-live="polite">
        <span className="running-game-icon">
          <Gamepad2 size={18} />
        </span>
        <div className="running-game-copy">
          <strong>上次启动的游戏可能仍在运行</strong>
          <span>
            {label} · PID {game.pid} · {formatClock(game.startedAt)} 启动
            {start.toDateString() !== new Date().toDateString()
              ? `（${start.toLocaleDateString('zh-CN')}）`
              : ''}
          </span>
        </div>
        <div className="running-game-actions">
          <button
            type="button"
            className="button button--ghost button--sm"
            onClick={() => setHidden(true)}
          >
            保留运行
          </button>
          <button
            type="button"
            className="button button--danger button--sm"
            onClick={() => setConfirming(true)}
          >
            <Power size={13} />
            结束进程
          </button>
        </div>
      </div>
      <ConfirmDialog
        open={confirming}
        title="结束仍在运行的游戏？"
        message={
          <>
            <strong>{label}</strong>（PID {game.pid}）会在不保存当前世界进度的情况下被结束。
            如果只是想保留它，请选择“取消”。
          </>
        }
        confirmLabel="结束进程"
        cancelLabel="取消"
        danger
        busy={stopping}
        onCancel={() => {
          if (!stopping) setConfirming(false)
        }}
        onConfirm={() => void stop()}
      />
    </>
  )
}
