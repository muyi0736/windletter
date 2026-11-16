import { Moon, Power, LogOut, X } from 'lucide-react'
import { useLauncher } from '../store'

const ACTION_LABEL: Record<string, string> = {
  sleep: '睡眠',
  shutdown: '关机',
  quit: '退出启动器'
}

export function PowerCountdownBanner() {
  const countdown = useLauncher((state) => state.powerCountdown)
  const cancel = useLauncher((state) => state.cancelPower)
  if (!countdown) return null
  const Icon = countdown.action === 'sleep' ? Moon : countdown.action === 'shutdown' ? Power : LogOut
  return (
    <div className="power-countdown" role="status">
      <Icon size={15} />
      <span>
        任务已完成，<b>{countdown.secondsLeft}</b> 秒后{ACTION_LABEL[countdown.action] ?? countdown.action}
      </span>
      <button type="button" className="button button--soft button--sm" onClick={() => void cancel()}>
        <X size={12} />
        取消
      </button>
    </div>
  )
}