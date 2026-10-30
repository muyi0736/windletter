import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type {
  PlaytimeActiveView,
  PlaytimeDay,
  PlaytimeInstanceStat,
  PlaytimeReport,
  PlaytimeSessionView
} from '../../shared/types'
import { getConfigDir } from './config'

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_SESSIONS = 20000
const MAX_SESSION_MS = 7 * DAY_MS
const MIN_SESSION_MS = 1000
const HEARTBEAT_MS = 30_000
const COMPLETION_POLL_MS = 5_000

interface StoredPlaytimeSession {
  id: string
  instanceId: string | null
  name: string
  versionId: string
  startedAt: number
  endedAt: number
  durationMs: number
  exitCode: number | null
}

interface ActivePlaytimeSession {
  id: string
  instanceId: string | null
  name: string
  versionId: string
  startedAt: number
  lastHeartbeat: number
  pid: number | null
}

interface PlaytimeData {
  sessions: StoredPlaytimeSession[]
  active: ActivePlaytimeSession | null
}

let data: PlaytimeData | null = null
let loading: Promise<PlaytimeData> | null = null
let saveQueue: Promise<void> = Promise.resolve()
let heartbeat: NodeJS.Timeout | null = null
let completionPoll: NodeJS.Timeout | null = null
let changedListener: (() => void) | null = null

function playtimePath(): string {
  return join(getConfigDir(), 'playtime.json')
}

function pendingDir(): string {
  return join(getConfigDir(), 'playtime-pending')
}

function completionPath(id: string): string {
  return join(pendingDir(), `${id}.done`)
}

export function setPlaytimeChangedListener(listener: () => void): void {
  changedListener = listener
}

function notifyChanged(): void {
  changedListener?.()
}

function text(value: unknown, fallback: string, max = 120): string {
  if (typeof value !== 'string') return fallback
  const clean = value.replace(/[\u0000-\u001f]/g, '').trim()
  return clean ? clean.slice(0, max) : fallback
}

function safeId(value: unknown): string {
  const id = text(value, '', 80)
  return /^[A-Za-z0-9._-]{8,80}$/.test(id) ? id : randomUUID()
}

function normalizeSession(raw: unknown): StoredPlaytimeSession | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Partial<StoredPlaytimeSession>
  const startedAt = Number(value.startedAt)
  const endedAt = Number(value.endedAt)
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || startedAt <= 0) {
    return null
  }
  if (endedAt < startedAt) return null
  const durationMs = Math.min(MAX_SESSION_MS, endedAt - startedAt)
  if (durationMs < MIN_SESSION_MS) return null
  const versionId = text(value.versionId, 'unknown', 120)
  return {
    id: safeId(value.id),
    instanceId:
      typeof value.instanceId === 'string' && value.instanceId.trim()
        ? text(value.instanceId, '', 80)
        : null,
    name: text(value.name, versionId, 120),
    versionId,
    startedAt,
    endedAt,
    durationMs,
    exitCode:
      typeof value.exitCode === 'number' && Number.isFinite(value.exitCode)
        ? Math.round(value.exitCode)
        : null
  }
}

function normalizeActive(raw: unknown): ActivePlaytimeSession | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Partial<ActivePlaytimeSession>
  const startedAt = Number(value.startedAt)
  const lastHeartbeat = Number(value.lastHeartbeat)
  if (!Number.isFinite(startedAt) || startedAt <= 0) return null
  const versionId = text(value.versionId, 'unknown', 120)
  const pid = Number(value.pid)
  return {
    id: safeId(value.id),
    instanceId:
      typeof value.instanceId === 'string' && value.instanceId.trim()
        ? text(value.instanceId, '', 80)
        : null,
    name: text(value.name, versionId, 120),
    versionId,
    startedAt,
    lastHeartbeat: Number.isFinite(lastHeartbeat) && lastHeartbeat >= startedAt
      ? lastHeartbeat
      : startedAt,
    pid: Number.isFinite(pid) && pid > 0 ? Math.round(pid) : null
  }
}

function trimSessions(sessions: StoredPlaytimeSession[]): StoredPlaytimeSession[] {
  if (sessions.length <= MAX_SESSIONS) return sessions
  return sessions.slice(sessions.length - MAX_SESSIONS)
}

function persist(): Promise<void> {
  const snapshot = JSON.stringify(data ?? { sessions: [], active: null }, null, 2)
  const path = playtimePath()
  saveQueue = saveQueue.catch(() => undefined).then(async () => {
    await fs.mkdir(getConfigDir(), { recursive: true })
    const tmp = `${path}.tmp`
    await fs.writeFile(tmp, snapshot, 'utf8')
    await fs.rename(tmp, path)
  })
  return saveQueue
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function readCompletion(id: string, waitMs = 0): Promise<number | null> {
  const path = completionPath(id)
  const deadline = Date.now() + waitMs
  while (true) {
    try {
      const value = Number((await fs.readFile(path, 'utf8')).trim())
      if (Number.isFinite(value) && value > 0) return Math.round(value)
    } catch {
      /* watcher has not written yet */
    }
    if (Date.now() >= deadline) return null
    await delay(100)
  }
}

async function removeCompletion(id: string): Promise<void> {
  await fs.unlink(completionPath(id)).catch(() => undefined)
}

function processAlive(pid: number | null): boolean {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function sessionFromActive(
  active: ActivePlaytimeSession,
  endedAt: number,
  exitCode: number | null
): StoredPlaytimeSession | null {
  const end = Math.max(active.startedAt, endedAt)
  const durationMs = Math.min(MAX_SESSION_MS, end - active.startedAt)
  if (durationMs < MIN_SESSION_MS) return null
  return {
    id: active.id,
    instanceId: active.instanceId,
    name: active.name,
    versionId: active.versionId,
    startedAt: active.startedAt,
    endedAt: end,
    durationMs,
    exitCode
  }
}

function stopHeartbeat(): void {
  if (heartbeat) clearInterval(heartbeat)
  heartbeat = null
}

function stopCompletionPoll(): void {
  if (completionPoll) clearInterval(completionPoll)
  completionPoll = null
}

function stopTimers(): void {
  stopHeartbeat()
  stopCompletionPoll()
}

function startHeartbeat(): void {
  stopHeartbeat()
  heartbeat = setInterval(() => {
    if (!data?.active) return
    data.active.lastHeartbeat = Date.now()
    void persist()
  }, HEARTBEAT_MS)
  heartbeat.unref?.()
}

function startCompletionPoll(): void {
  stopCompletionPoll()
  completionPoll = setInterval(() => {
    const active = data?.active
    if (!active) {
      stopCompletionPoll()
      return
    }
    void (async () => {
      const endedAt = await readCompletion(active.id, 0)
      if (endedAt) await finishPlaySession({ endedAt, exitCode: null })
    })()
  }, COMPLETION_POLL_MS)
  completionPoll.unref?.()
}

function startTimers(): void {
  if (!data?.active) return
  startHeartbeat()
  startCompletionPoll()
}

async function loadData(): Promise<PlaytimeData> {
  if (data) return data
  if (loading) return loading
  loading = (async () => {
    let parsed: unknown = null
    try {
      parsed = JSON.parse(await fs.readFile(playtimePath(), 'utf8'))
    } catch {
      parsed = null
    }
    const raw = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
    const sessions = Array.isArray(raw.sessions)
      ? raw.sessions
          .map(normalizeSession)
          .filter((session): session is StoredPlaytimeSession => session !== null)
      : []
    const next: PlaytimeData = {
      sessions: trimSessions(sessions),
      active: normalizeActive(raw.active)
    }
    if (next.active) {
      const activeId = next.active.id
      // 原生监视进程在游戏退出时写好结束时间；启动器可能在那之后才重新打开。
      const completedAt = await readCompletion(activeId, 500)
      if (completedAt) {
        const recovered = sessionFromActive(next.active, completedAt, null)
        if (recovered) {
          next.sessions.push(recovered)
          next.sessions = trimSessions(next.sessions)
        }
        next.active = null
        void removeCompletion(activeId)
      } else if (processAlive(next.active.pid)) {
        // 启动器关闭/重开时游戏仍在运行：保留会话，继续计时并等待完成文件。
      } else {
        const recovered = sessionFromActive(
          next.active,
          next.active.lastHeartbeat,
          null
        )
        if (recovered) {
          next.sessions.push(recovered)
          next.sessions = trimSessions(next.sessions)
        }
        next.active = null
        void removeCompletion(activeId)
      }
    }
    data = next
    await persist()
    if (data.active) startTimers()
    return next
  })()
  try {
    return await loading
  } finally {
    loading = null
  }
}

function watcherPath(): string | null {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'playtime-watch.exe')]
    : [
        join(app.getAppPath(), 'build', 'playtime-watch.exe'),
        join(process.cwd(), 'build', 'playtime-watch.exe')
      ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

/** Spawn the tiny native helper that waits for the game and records its exit time. */
export function startPlaytimeWatcher(pid: number, donePath: string): void {
  const executable = watcherPath()
  if (!executable) return
  try {
    const child = spawn(executable, [String(pid), donePath], {
      detached: true,
      windowsHide: true,
      stdio: 'ignore'
    })
    child.on('error', () => undefined)
    child.unref()
  } catch {
    /* fall back to heartbeat recovery */
  }
}

export async function startPlaySession(input: {
  instanceId?: string | null
  name?: string | null
  versionId: string
  pid?: number | null
}): Promise<{ id: string; donePath: string }> {
  const db = await loadData()
  if (db.active) {
    const previous = db.active
    const completedAt = await readCompletion(previous.id, 0)
    const session = sessionFromActive(previous, completedAt ?? Date.now(), null)
    if (session) {
      db.sessions.push(session)
      db.sessions = trimSessions(db.sessions)
    }
    db.active = null
    await removeCompletion(previous.id)
  }
  await fs.mkdir(pendingDir(), { recursive: true })
  const startedAt = Date.now()
  const versionId = text(input.versionId, 'unknown', 120)
  const pid = Number(input.pid)
  db.active = {
    id: randomUUID(),
    instanceId: input.instanceId ? text(input.instanceId, '', 80) : null,
    name: text(input.name, versionId, 120),
    versionId,
    startedAt,
    lastHeartbeat: startedAt,
    pid: Number.isFinite(pid) && pid > 0 ? Math.round(pid) : null
  }
  await persist()
  startTimers()
  return { id: db.active.id, donePath: completionPath(db.active.id) }
}

export async function finishPlaySession(input?: {
  exitCode?: number | null
  endedAt?: number
}): Promise<void> {
  const db = await loadData()
  const active = db.active
  if (!active) return
  const completedAt = await readCompletion(active.id, 800)
  db.active = null
  stopTimers()
  const session = sessionFromActive(
    active,
    completedAt ?? (Number.isFinite(input?.endedAt) ? Number(input?.endedAt) : Date.now()),
    typeof input?.exitCode === 'number' ? Math.round(input.exitCode) : null
  )
  if (session) {
    db.sessions.push(session)
    db.sessions = trimSessions(db.sessions)
  }
  await removeCompletion(active.id)
  await persist()
  // 原生监视进程可能在 finish 之后才落盘；再清一次，避免孤儿文件。
  setTimeout(() => void removeCompletion(active.id), 3000)
  notifyChanged()
}

function localDateKey(ts: number): string {
  const date = new Date(ts)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function startOfDay(ts: number): number {
  const date = new Date(ts)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function startOfWeek(ts: number): number {
  const date = new Date(ts)
  date.setHours(0, 0, 0, 0)
  const offset = (date.getDay() + 6) % 7
  date.setDate(date.getDate() - offset)
  return date.getTime()
}

function viewOf(session: StoredPlaytimeSession): PlaytimeSessionView {
  return {
    id: session.id,
    key: session.instanceId ?? `version:${session.versionId}`,
    name: session.name,
    versionId: session.versionId,
    instanceId: session.instanceId,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    durationMs: session.durationMs,
    exitCode: session.exitCode
  }
}

function activeView(active: ActivePlaytimeSession | null): PlaytimeActiveView | null {
  if (!active) return null
  return {
    name: active.name,
    versionId: active.versionId,
    instanceId: active.instanceId,
    startedAt: active.startedAt
  }
}

export async function getPlaytimeReport(now = Date.now()): Promise<PlaytimeReport> {
  const db = await loadData()
  const weekStart = startOfWeek(now)
  const todayStart = startOfDay(now)
  const todayKey = localDateKey(now)
  const lastWeekDate = new Date(weekStart)
  lastWeekDate.setDate(lastWeekDate.getDate() - 7)
  const lastWeekStart = lastWeekDate.getTime()

  const weekSessions = db.sessions.filter(
    (session) => session.startedAt >= weekStart && session.startedAt <= now
  )
  const lastWeekSessions = db.sessions.filter(
    (session) => session.startedAt >= lastWeekStart && session.startedAt < weekStart
  )
  const byDay = new Map<string, { durationMs: number; sessions: number }>()
  for (const session of weekSessions) {
    const key = localDateKey(session.startedAt)
    const current = byDay.get(key) ?? { durationMs: 0, sessions: 0 }
    current.durationMs += session.durationMs
    current.sessions += 1
    byDay.set(key, current)
  }
  const labels = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
  const days: PlaytimeDay[] = labels.map((label, index) => {
    const date = new Date(weekStart)
    date.setDate(date.getDate() + index)
    const key = localDateKey(date.getTime())
    const stat = byDay.get(key)
    const dayStart = startOfDay(date.getTime())
    return {
      date: key,
      label,
      durationMs: stat?.durationMs ?? 0,
      sessions: stat?.sessions ?? 0,
      today: key === todayKey,
      future: dayStart > todayStart
    }
  })
  const weekMs = days.reduce((sum, day) => sum + day.durationMs, 0)
  const todayMs = days.find((day) => day.today)?.durationMs ?? 0
  const lastWeekMs = lastWeekSessions.reduce((sum, session) => sum + session.durationMs, 0)
  const totalMs = db.sessions.reduce((sum, session) => sum + session.durationMs, 0)

  const instanceMap = new Map<string, PlaytimeInstanceStat>()
  for (const session of weekSessions) {
    const key = session.instanceId ?? `version:${session.versionId}`
    const current = instanceMap.get(key) ?? {
      key,
      name: session.name,
      durationMs: 0,
      sessions: 0
    }
    current.durationMs += session.durationMs
    current.sessions += 1
    instanceMap.set(key, current)
  }
  const instances = [...instanceMap.values()]
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, 8)

  const recent = [...db.sessions]
    .sort((a, b) => b.endedAt - a.endedAt)
    .slice(0, 12)
    .map(viewOf)

  return {
    weekStart,
    weekMs,
    lastWeekMs,
    todayMs,
    totalMs,
    weekSessions: weekSessions.length,
    totalSessions: db.sessions.length,
    days,
    instances,
    recent,
    active: activeView(db.active)
  }
}
