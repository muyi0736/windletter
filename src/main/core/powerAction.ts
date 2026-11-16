import { spawn } from 'node:child_process'
import { app } from 'electron'
import type { AfterDownloadAction, PowerCountdown } from '../../shared/types'

const COUNTDOWN_SECONDS = 60

let timer: ReturnType<typeof setInterval> | null = null
let current: PowerCountdown | null = null
let notify: ((state: PowerCountdown | null) => void) | null = null

export function setPowerNotifier(fn: (state: PowerCountdown | null) => void): void {
  notify = fn
}

export function getPowerCountdown(): PowerCountdown | null {
  return current
}

function stopTimer(): void {
  if (timer) clearInterval(timer)
  timer = null
}

export function cancelPowerCountdown(): void {
  stopTimer()
  current = null
  notify?.(null)
}

function execute(action: PowerCountdown['action']): void {
  if (action === 'quit') {
    app.quit()
    return
  }
  if (action === 'shutdown') {
    const child = spawn(
      'shutdown.exe',
      ['/s', '/t', '0', '/c', '月月月启动器：下载完成，自动关机'],
      { detached: true, stdio: 'ignore', windowsHide: true }
    )
    child.unref()
    return
  }
  const child = spawn(
    'rundll32.exe',
    ['powrprof.dll,SetSuspendState', '0', '1', '0'],
    { detached: true, stdio: 'ignore', windowsHide: true }
  )
  child.unref()
}

/** 下载全部结束后启动 60 秒倒计时；期间可取消，新任务开始也会取消。 */
export function startPowerCountdown(action: AfterDownloadAction): void {
  if (action === 'none') return
  stopTimer()
  current = { action, secondsLeft: COUNTDOWN_SECONDS }
  notify?.(current)
  timer = setInterval(() => {
    if (!current) {
      stopTimer()
      return
    }
    const next = current.secondsLeft - 1
    if (next <= 0) {
      const act = current.action
      stopTimer()
      current = null
      notify?.(null)
      execute(act)
      return
    }
    current = { ...current, secondsLeft: next }
    notify?.(current)
  }, 1000)
}