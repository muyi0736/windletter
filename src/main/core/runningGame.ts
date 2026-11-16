import { execFile, spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { RunningGameInfo } from '../../shared/types'
import { getConfigDir } from './config'

const execFileAsync = promisify(execFile)
const RECORD_FILE = 'running-game.json'

function recordPath(): string {
  return join(getConfigDir(), RECORD_FILE)
}

function cleanText(value: unknown, max = 500): string {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, '').trim().slice(0, max) : ''
}

function normalizeRecord(raw: unknown): RunningGameInfo | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Partial<RunningGameInfo>
  const pid = Number(value.pid)
  const startedAt = Number(value.startedAt)
  const versionId = cleanText(value.versionId, 120)
  const gameDir = cleanText(value.gameDir, 1000)
  if (!Number.isFinite(pid) || pid <= 0 || !Number.isFinite(startedAt) || startedAt <= 0) {
    return null
  }
  if (!versionId || !gameDir) return null
  return {
    pid: Math.round(pid),
    startedAt: Math.round(startedAt),
    instanceId:
      typeof value.instanceId === 'string' && value.instanceId.trim()
        ? cleanText(value.instanceId, 100)
        : null,
    name: typeof value.name === 'string' && value.name.trim() ? cleanText(value.name, 120) : null,
    versionId,
    gameDir
  }
}

async function readRecords(): Promise<RunningGameInfo[]> {
  try {
    const raw: unknown = JSON.parse(await fs.readFile(recordPath(), 'utf8'))
    if (Array.isArray(raw)) {
      return raw
        .map(normalizeRecord)
        .filter((record): record is RunningGameInfo => record !== null)
    }
    // 旧版单记录格式迁移
    const single = normalizeRecord(raw)
    return single ? [single] : []
  } catch {
    return []
  }
}

async function writeRecords(records: RunningGameInfo[]): Promise<void> {
  const path = recordPath()
  await fs.mkdir(getConfigDir(), { recursive: true })
  if (!records.length) {
    await fs.rm(path, { force: true }).catch(() => undefined)
    return
  }
  const tmp = `${path}.tmp`
  await fs.writeFile(tmp, JSON.stringify(records, null, 2), 'utf8')
  await fs.rename(tmp, path)
}

export async function recordRunningGame(info: RunningGameInfo): Promise<void> {
  const record = normalizeRecord(info)
  if (!record) return
  const records = await readRecords()
  const next = records.filter((item) => item.pid !== record.pid)
  next.push(record)
  await writeRecords(next)
}

export async function clearRunningGame(pid?: number | null): Promise<void> {
  const records = await readRecords()
  if (!records.length) {
    await fs.rm(recordPath(), { force: true }).catch(() => undefined)
    return
  }
  const next = pid == null ? [] : records.filter((item) => item.pid !== pid)
  await writeRecords(next)
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

interface ProcessDetails {
  alive: boolean
  image: string | null
  commandLine: string | null
}

async function queryWindowsProcess(pid: number): Promise<{ image: string | null; commandLine: string | null }> {
  try {
    const script =
      `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}"; ` +
      `if ($p) { $p.Name; $p.CommandLine }`
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: 5000, maxBuffer: 1024 * 1024 }
    )
    const lines = stdout.replace(/^\uFEFF/, '').split(/\r?\n/)
    const image = lines[0]?.trim() || null
    const commandLine = lines.slice(1).join(' ').trim() || null
    if (image) return { image, commandLine }
  } catch {
    /* PowerShell 不可用或被策略限制，尝试 tasklist */
  }
  try {
    const { stdout } = await execFileAsync(
      'tasklist.exe',
      ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'],
      { windowsHide: true, timeout: 3000 }
    )
    const match = /^"([^"]+)"/.exec(stdout.trim())
    if (match) return { image: match[1], commandLine: null }
  } catch {
    /* ignore */
  }
  return { image: null, commandLine: null }
}

async function inspectProcess(pid: number): Promise<ProcessDetails> {
  if (!processAlive(pid)) return { alive: false, image: null, commandLine: null }
  if (process.platform === 'win32') {
    return { alive: true, ...(await queryWindowsProcess(pid)) }
  }
  try {
    const raw = await fs.readFile(`/proc/${pid}/cmdline`, 'utf8')
    return { alive: true, image: null, commandLine: raw.replace(/\u0000/g, ' ').trim() || null }
  } catch {
    return { alive: true, image: null, commandLine: null }
  }
}

function matchesGame(record: RunningGameInfo, details: ProcessDetails): boolean {
  if (!details.alive) return false
  if (details.commandLine) {
    const command = details.commandLine.replace(/\//g, '\\').toLowerCase()
    const gameDir = record.gameDir.replace(/\//g, '\\').toLowerCase()
    if (gameDir && command.includes(gameDir)) return true
    if (record.versionId && command.toLowerCase().includes(record.versionId.toLowerCase())) return true
    return false
  }
  return Boolean(details.image && /^java(w)?\.exe$/i.test(details.image))
}

export async function inspectRunningGame(): Promise<RunningGameInfo | null> {
  const records = await readRecords()
  const alive: RunningGameInfo[] = []
  for (const record of records) {
    const details = await inspectProcess(record.pid)
    if (matchesGame(record, details)) alive.push(record)
  }
  if (alive.length !== records.length) await writeRecords(alive)
  return alive[0] ?? null
}

async function waitForExit(pid: number, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!processAlive(pid)) return true
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200))
  }
  return !processAlive(pid)
}

async function killProcess(pid: number): Promise<void> {
  if (process.platform === 'win32') {
    await new Promise<void>((resolveKill) => {
      const killer = spawn('taskkill', ['/pid', String(pid), '/t', '/f'], {
        windowsHide: true,
        stdio: 'ignore'
      })
      killer.on('exit', () => resolveKill())
      killer.on('error', () => resolveKill())
    })
    return
  }
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    /* already gone */
  }
}

export async function stopRunningGame(): Promise<boolean> {
  const record = await inspectRunningGame()
  if (!record) return false
  await killProcess(record.pid)
  await waitForExit(record.pid)
  await clearRunningGame(record.pid)
  return true
}
