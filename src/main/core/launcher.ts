import AdmZip from 'adm-zip'
import os from 'node:os'
import { spawn, type ChildProcess } from 'node:child_process'
import { app } from 'electron'
import { createWriteStream, promises as fs, type WriteStream } from 'node:fs'
import { dirname, join } from 'node:path'
import type { LaunchLogLine, LaunchState, RunningSessionView } from '../../shared/types'
import { ensureFreshAccount } from './auth'
import { computeAutoMemoryMb } from './autoMemory'
import { releaseMemory } from './memoryOptimize'
import { getActiveAccount, getLogDir, getSettings, markVersionPlayed } from './config'
import {
  getInstance,
  getInstanceDir,
  getInstanceMinecraftDir,
  markInstancePlayed,
  recordInstanceServer
} from './instances'
import { ensureJavaForVersion } from './java'
import { CancellationError } from './net'
import {
  finishPlaySession,
  startPlaySession,
  startPlaytimeWatcher
} from './playtime'
import {
  buildLaunchCommand,
  nativeArtifact,
  pathExists,
  resolveVersion,
  safeJoin,
  type ResolvedVersion
} from './version'
import { isRuleAllowed } from './rules'
import { GameLogAssembler, type GameLogEvent, type GameLogFeed } from './gameLogFormat'
import { clearRunningGame, recordRunningGame } from './runningGame'

const MAX_LOG_LINES = 4000
const APP_VERSION = app.getVersion()

interface LauncherEvents {
  onState: (state: LaunchState) => void
  onLog: (line: LaunchLogLine) => void
  onGameStarted?: () => void
  onGameExited?: () => void
  onCrashAssist?: (info: {
    instanceId: string | null
    versionId: string
    kind: 'exit' | 'launch-error'
    exitCode: number | null
    message: string
  }) => void
}

interface GameSession {
  key: string
  instanceId: string | null
  versionId: string
  child: ChildProcess | null
  state: LaunchState
  logs: LaunchLogLine[]
  logStream: WriteStream | null
  logPath: string | null
  preparingAbort: AbortController | null
  starting: boolean
  intentionalStop: boolean
  playSessionId: string | null
}

/** 活跃会话（preparing/starting/running）；退出后移除，主状态保留最后一次会话。 */
const sessions = new Map<string, GameSession>()
let primary: GameSession | null = null
let events: LauncherEvents | null = null

function idleState(): LaunchState {
  return {
    status: 'idle',
    message: '',
    progress: null,
    stage: null,
    versionId: null,
    instanceId: null,
    pid: null,
    startedAt: null,
    exitCode: null,
    error: null,
    speed: null,
    running: []
  }
}

export function setLauncherEvents(handlers: LauncherEvents): void {
  events = handlers
}

function runningSessions(): RunningSessionView[] {
  return [...sessions.values()]
    .filter(
      (session) =>
        session.state.status === 'preparing' ||
        session.state.status === 'starting' ||
        session.state.status === 'running'
    )
    .map((session) => ({
      key: session.key,
      instanceId: session.instanceId,
      versionId: session.versionId,
      pid: session.child?.pid ?? null,
      startedAt: session.state.startedAt,
      status: session.state.status
    }))
}

export function getLaunchState(): LaunchState {
  const base = primary ? primary.state : idleState()
  return { ...base, running: runningSessions() }
}

export function getLaunchLogs(): LaunchLogLine[] {
  return primary ? [...primary.logs] : []
}

export function getLatestLogPath(): string | null {
  return primary?.logPath ?? null
}

export function isGameActive(): boolean {
  return runningSessions().length > 0
}

export function getRunningPids(): number[] {
  return [...sessions.values()]
    .map((session) => session.child?.pid ?? null)
    .filter((pid): pid is number => typeof pid === 'number' && pid > 0)
}

function setState(session: GameSession, patch: Partial<LaunchState>): void {
  session.state = { ...session.state, ...patch }
  events?.onState(getLaunchState())
}

function clockOf(time: number): string {
  const date = new Date(time)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function redactSecrets(text: string): string {
  // 游戏日志可能包含 ModLauncher 的完整启动参数，令牌永远不应该落盘。
  return text.replace(/(--accessToken(?:\s*,\s*|\s+))[^\s,\]]+/gi, '$1[REDACTED]')
}

function writeLogFile(session: GameSession, line: LaunchLogLine): void {
  if (!session.logStream) return
  const tag = line.level ? line.level.toUpperCase() : line.stream
  const source = line.logger
    ? ` [${line.logger}${line.thread ? ` / ${line.thread}` : ''}]`
    : ''
  session.logStream.write(`[${clockOf(line.time)}] [${tag}]${source} ${line.text}\n`)
  if (line.detail) session.logStream.write(`${line.detail}\n`)
}

function appendLog(session: GameSession, line: LaunchLogLine): void {
  const next: LaunchLogLine = {
    ...line,
    text: redactSecrets(line.text.replace(/\x1b\[[0-9;]*m/g, '')),
    detail: line.detail ? redactSecrets(line.detail) : undefined
  }
  session.logs.push(next)
  if (session.logs.length > MAX_LOG_LINES) session.logs.splice(0, session.logs.length - MAX_LOG_LINES)
  writeLogFile(session, next)
  events?.onLog(next)
}

function log(session: GameSession, stream: LaunchLogLine['stream'], text: string): void {
  appendLog(session, { time: Date.now(), stream, text })
}

function logGameEvent(session: GameSession, stream: LaunchLogLine['stream'], event: GameLogEvent): void {
  appendLog(session, {
    time: event.time,
    stream,
    text: event.message,
    level: event.level,
    logger: event.logger || undefined,
    thread: event.thread || undefined,
    detail: event.detail ?? undefined
  })
}

async function openLogFile(session: GameSession): Promise<void> {
  try {
    await fs.mkdir(getLogDir(), { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    session.logPath = join(getLogDir(), `launch-${stamp}.log`)
    session.logStream?.end()
    session.logStream = createWriteStream(session.logPath, { flags: 'a' })
  } catch {
    session.logStream = null
  }
}

async function closeLogFile(session: GameSession): Promise<void> {
  const stream = session.logStream
  session.logStream = null
  if (!stream) return
  await new Promise<void>((resolve) => stream.end(resolve))
}

function createLineBuffer(
  session: GameSession,
  stream: 'stdout' | 'stderr'
): { push: (chunk: Buffer) => void; flush: () => void } {
  let buffer = ''
  const assembler = new GameLogAssembler()
  const emit = (feeds: GameLogFeed[]): void => {
    for (const feed of feeds) {
      if (feed.type === 'event') logGameEvent(session, stream, feed.event)
      else if (feed.text.length) log(session, stream, feed.text)
    }
  }
  return {
    push(chunk: Buffer) {
      buffer += chunk.toString('utf8')
      const parts = buffer.split(/\r?\n/)
      buffer = parts.pop() ?? ''
      for (const part of parts) emit(assembler.push(part))
    },
    flush() {
      if (buffer) emit(assembler.push(buffer))
      buffer = ''
      emit(assembler.flush())
    }
  }
}

async function prepareNatives(
  session: GameSession,
  baseDir: string,
  version: ResolvedVersion,
  customDir?: string
): Promise<string> {
  const nativesDir = customDir ?? join(baseDir, 'versions', version.chain[0], 'natives')
  await fs.rm(nativesDir, { recursive: true, force: true })
  await fs.mkdir(nativesDir, { recursive: true })
  const features = { is_demo_user: false, has_custom_resolution: false }
  for (const library of version.json.libraries ?? []) {
    if (!isRuleAllowed(library.rules, features)) continue
    const native = nativeArtifact(library)
    if (!native) continue
    const jarPath = safeJoin(join(baseDir, 'libraries'), native.path)
    if (!(await pathExists(jarPath))) {
      log(session, 'system', `缺少运行库文件：${native.path}`)
      continue
    }
    try {
      const zip = new AdmZip(jarPath)
      for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue
        const entryName = entry.entryName.replace(/\\/g, '/')
        if ((library.extract?.exclude ?? ['META-INF/']).some((prefix) => entryName.startsWith(prefix))) {
          continue
        }
        if (entryName.includes('..')) continue
        const target = safeJoin(nativesDir, entryName)
        await fs.mkdir(dirname(target), { recursive: true })
        await fs.writeFile(target, entry.getData())
      }
    } catch {
      log(session, 'system', `解压运行库失败：${native.path}`)
    }
  }
  for (const sub of ['java', 'jna', 'lwjgl', 'netty']) {
    await fs.mkdir(join(nativesDir, sub), { recursive: true })
  }
  return nativesDir
}

function findLoggingPath(baseDir: string, version: ResolvedVersion): string | null {
  const fileId = version.json.logging?.client?.file.id
  if (!fileId) return null
  return join(baseDir, 'assets', 'log_configs', fileId)
}

export interface LaunchServerTarget {
  host: string
  port: number
  name?: string
}

export interface LaunchGameOptions {
  server?: LaunchServerTarget | null
}

export async function launchGame(
  versionId: string,
  instanceId?: string,
  options?: LaunchGameOptions
): Promise<void> {
  const key = instanceId ?? `version:${versionId}`
  if (sessions.has(key)) throw new Error('该实例已有游戏正在启动或运行中')
  const session: GameSession = {
    key,
    instanceId: instanceId ?? null,
    versionId,
    child: null,
    state: idleState(),
    logs: [],
    logStream: null,
    logPath: null,
    preparingAbort: new AbortController(),
    starting: true,
    intentionalStop: false,
    playSessionId: null
  }
  sessions.set(key, session)
  primary = session
  const abort = new AbortController()
  session.preparingAbort = abort
  const signal = abort.signal
  const settings = getSettings()
  const server = options?.server ?? null

  setState(session, {
    status: 'preparing',
    message: server ? `正在准备进入${server.name ? `「${server.name}」` : '服务器'}` : '正在检查启动环境',
    progress: 1,
    stage: '检查环境',
    versionId,
    instanceId: instanceId ?? null
  })
  await openLogFile(session)

  try {
    const instance = instanceId ? await getInstance(instanceId) : null
    if (instance && instance.versionId !== versionId) {
      throw new Error('实例与游戏版本不匹配，请重新安装该整合包')
    }
    if (instance && server) {
      void recordInstanceServer(instance.id, server).catch(() => undefined)
    }
    const baseDir = instance?.external?.baseDir ?? instance?.baseDir ?? settings.gameDir
    const gameDir = instance
      ? instance.external?.gameDir ?? getInstanceMinecraftDir(instance.id)
      : baseDir
    let launchModCount = instance?.modCount ?? 0
    if (instance) {
      try {
        const entries = await fs.readdir(join(gameDir, 'mods'))
        launchModCount = entries.filter((name) => name.toLowerCase().endsWith('.jar')).length
      } catch {
        /* 没有 mods 目录时保留实例记录值 */
      }
    }
    const launchSettings = instance
      ? {
          ...settings,
          maxMemoryMb:
            instance.memoryAuto === false
              ? instance.memoryMb ?? settings.maxMemoryMb
              : settings.maxMemoryMb,
          extraJvmArgs: [settings.extraJvmArgs, instance.extraJvmArgs ?? '']
            .filter((value) => value.trim())
            .join(' ')
            .slice(0, 4000),
          javaPath:
            instance.javaAuto === false
              ? instance.javaPath ?? settings.javaPath
              : settings.javaPath
        }
      : settings
    log(
      session,
      'system',
      instance
        ? `月月月启动器 ${APP_VERSION} 正在启动整合包「${instance.name}」（Minecraft ${instance.gameVersion}）`
        : `月月月启动器 ${APP_VERSION} 正在启动 Minecraft ${versionId}`
    )
    if (instance) log(session, 'system', `加载器：${instance.loader === 'vanilla' ? '原版' : instance.loader}`)
    if (instance?.external) log(session, 'system', `外部实例：直接使用 ${instance.external.gameDir}`)
    if (server) {
      log(
        session,
        'system',
        `服务器目标：${server.name ? `${server.name} · ` : ''}${server.host}:${server.port}`
      )
    }

    let version: ResolvedVersion
    try {
      version = await resolveVersion(baseDir, versionId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (instance && message.includes('未找到版本')) {
        throw new Error(
          `实例的启动版本 ${versionId} 不完整。打开实例设置 →「补全文件」会自动补回原版与加载器；仍失败时请重新安装这个整合包。`
        )
      }
      throw error
    }
    const versionJson = version.json
    const requiredMajor = versionJson.javaVersion?.majorVersion ?? null
    // Mojang 的版本 JSON 指定了它实际支持的 Java 主版本。Fabric/Quilt 的 Mixin
    // 和模组并不保证能读更高版本的 JDK class（例如 Java 25 的 major 69），
    // 因此启动时优先使用完全匹配的运行时，而不是全局里更新的 Java。
    const strictJava = true
    log(session, 'system', `版本类型：${versionJson.type ?? 'release'}，所需 Java：${requiredMajor ?? '自动检测'}`)

    if (signal.aborted) throw new CancellationError()

    const account = getActiveAccount()
    if (!account) throw new Error('尚未登录账户，请先添加离线账户或登录微软账户')
    setState(session, { stage: '验证账户', message: '正在验证账户信息', progress: 5 })
    const freshAccount = await ensureFreshAccount(account)
    log(session, 'system', `账户：${freshAccount.name}（${freshAccount.type === 'microsoft' ? '微软账户' : '离线账户'}）`)

    if (signal.aborted) throw new CancellationError()

    if (settings.optimizeMemoryBeforeLaunch) {
      setState(session, { stage: '优化内存', message: '正在回收系统工作集', progress: 8, speed: null })
      const beforeFreeMb = Math.floor(os.freemem() / 1024 / 1024)
      try {
        const result = await releaseMemory('system', signal)
        const afterFreeMb = Math.floor(os.freemem() / 1024 / 1024)
        log(
          session,
          'system',
          `启动前内存优化：系统工作集 ${Math.round(result.beforeKb / 1024)} → ${Math.round(
            result.afterKb / 1024
          )} MB${typeof result.processes === 'number' ? `（${result.processes} 个进程）` : ''}，可用内存 ${beforeFreeMb} → ${afterFreeMb} MB`
        )
      } catch (error) {
        if (signal.aborted) throw new CancellationError()
        log(
          session,
          'system',
          `启动前内存优化失败，继续启动：${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
    if (signal.aborted) throw new CancellationError()

    setState(session, { stage: '准备 Java', message: '正在查找 Java 环境', progress: 12 })
    let lastJavaStage = ''
    if (instance && instance.javaAuto !== false) {
      log(session, 'system', 'Java：启动时自动选择（忽略之前保存的自动路径）')
    }
    const java = await ensureJavaForVersion({
      gameDir: baseDir,
      settings: launchSettings,
      requiredMajor,
      preferredComponent: versionJson.javaVersion?.component,
      exact: strictJava,
      source: settings.source,
      signal,
      onProgress: (progress) => {
        if (progress.stage !== lastJavaStage) {
          lastJavaStage = progress.stage
          log(session, 'system', progress.stage)
        }
        setState(session, {
          stage: progress.stage,
          message: progress.stage,
          progress: Math.round(8 + progress.percent * 0.55),
          speed: progress.detail.speed > 0 ? progress.detail.speed : null
        })
      }
    })
    log(session, 'system', `使用 Java ${java.version}（${java.path}）`)

    const autoMemory = Boolean(instance && instance.memoryAuto !== false)
    const availableMemoryMb = Math.max(512, Math.floor(os.freemem() / 1024 / 1024))
    const totalMemoryMb = Math.max(1024, Math.floor(os.totalmem() / 1024 / 1024))
    const launchMemoryMb =
      autoMemory && instance
        ? computeAutoMemoryMb({
            modCount: launchModCount,
            loader: instance.loader,
            availableMb: availableMemoryMb,
            totalMb: totalMemoryMb,
            is32Bit: java.arch === 'x86'
          })
        : launchSettings.maxMemoryMb
    const finalSettings = { ...launchSettings, maxMemoryMb: launchMemoryMb }
    log(
      session,
      'system',
      autoMemory && instance
        ? `内存分配：启动时自动计算 ${launchMemoryMb} MB（可用 ${availableMemoryMb} / 总 ${totalMemoryMb} MB，${launchModCount} 个模组）`
        : `内存分配：${launchMemoryMb} MB`
    )

    if (signal.aborted) throw new CancellationError()
    setState(session, { stage: '准备游戏文件', message: '正在整理运行库与资源', progress: 68, speed: null })
    // 多开同一版本时共享 natives 目录会被另一个进程占用（Windows EPERM），
    // 因此每个会话使用独立 natives 目录。
    const sessionNativesDir = instance
      ? join(getInstanceDir(instance.id), 'natives')
      : join(os.tmpdir(), `windletter-natives-${session.key.replace(/[^A-Za-z0-9._-]/g, '_')}`)
    await prepareNatives(session, baseDir, version, sessionNativesDir)

    const loggingPath = findLoggingPath(baseDir, version)
    const hasLogging = loggingPath ? await pathExists(loggingPath) : false
    const command = buildLaunchCommand({
      gameDir,
      baseDir,
      version,
      account: {
        name: freshAccount.name,
        uuid: freshAccount.uuid,
        accessToken: freshAccount.accessToken,
        type: freshAccount.type === 'microsoft' ? 'msa' : 'legacy',
        clientId: freshAccount.clientId,
        xuid: ''
      },
      settings: finalSettings,
      javaPath: java.path,
      launcherVersion: APP_VERSION,
      loggingPath: hasLogging ? loggingPath : null,
      server,
      nativesDir: sessionNativesDir
    })

    if (signal.aborted) throw new CancellationError()
    setState(session, { status: 'starting', stage: '启动游戏', message: '正在创建游戏进程', progress: 82 })
    await fs.mkdir(gameDir, { recursive: true })
    log(session, 'system', `游戏目录：${gameDir}`)

    const stdoutBuffer = createLineBuffer(session, 'stdout')
    const stderrBuffer = createLineBuffer(session, 'stderr')
    const gameProcess = spawn(command.executable, command.args, {
      cwd: gameDir,
      windowsHide: true,
      detached: true,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    session.child = gameProcess
    let exited = false
    let started = false

    gameProcess.stdout?.on('data', (data: Buffer) => stdoutBuffer.push(data))
    gameProcess.stderr?.on('data', (data: Buffer) => stderrBuffer.push(data))

    const handleExit = (code: number | null) => {
      if (exited) return
      exited = true
      stdoutBuffer.flush()
      stderrBuffer.flush()
      session.child = null
      session.starting = false
      sessions.delete(session.key)
      log(session, 'system', `游戏进程已退出，退出代码 ${code ?? '未知'}`)
      if (gameProcess.pid) void clearRunningGame(gameProcess.pid)
      void finishPlaySession({
        sessionId: session.playSessionId ?? undefined,
        pid: gameProcess.pid ?? undefined,
        exitCode: code
      })
      setState(session, {
        status: 'exited',
        message: code === 0 ? '游戏已正常退出' : `游戏异常退出（代码 ${code ?? '未知'}）`,
        progress: null,
        stage: null,
        exitCode: code,
        speed: null
      })
      void closeLogFile(session)
      events?.onGameExited?.()
      if (code !== 0 && !session.intentionalStop) {
        events?.onCrashAssist?.({
          instanceId: session.instanceId,
          versionId,
          kind: 'exit',
          exitCode: code,
          message: `游戏异常退出（代码 ${code ?? '未知'}）`
        })
      }
    }
    gameProcess.on('exit', handleExit)

    gameProcess.on('error', (err) => {
      log(session, 'system', `进程启动失败：${err.message}`)
      if (!started) {
        setState(session, {
          status: 'error',
          message: '无法启动游戏进程',
          error: `无法启动 Java 进程：${err.message}`,
          progress: null
        })
        session.starting = false
        sessions.delete(session.key)
        void closeLogFile(session)
      }
    })

    await new Promise<void>((resolve, reject) => {
      gameProcess.once('spawn', () => {
        started = true
        resolve()
      })
      gameProcess.once('error', reject)
    })

    if (signal.aborted) {
      await terminateProcess(gameProcess)
      throw new CancellationError()
    }
    if (exited) return

    const startedAt = Date.now()
    if (gameProcess.pid) {
      await recordRunningGame({
        pid: gameProcess.pid,
        startedAt,
        instanceId: instance?.id ?? null,
        name: instance?.name ?? versionId,
        versionId,
        gameDir
      }).catch(() => undefined)
      if (exited) void clearRunningGame(gameProcess.pid)
    }

    const playSession = await startPlaySession({
      instanceId: instance?.id ?? null,
      name: instance?.name ?? versionId,
      versionId,
      pid: gameProcess.pid ?? null
    }).catch(() => null)
    if (playSession) {
      session.playSessionId = playSession.id
      if (gameProcess.pid) startPlaytimeWatcher(gameProcess.pid, playSession.donePath)
    }
    if (exited) return

    session.starting = false
    setState(session, {
      status: 'running',
      message: '游戏运行中',
      progress: 100,
      stage: '游戏运行中',
      pid: gameProcess.pid ?? null,
      startedAt,
      speed: null
    })
    markVersionPlayed(versionId)
    if (instance) void markInstancePlayed(instance.id)
    log(session, 'system', `Minecraft 已启动，进程 PID：${gameProcess.pid ?? '未知'}`)
    events?.onGameStarted?.()
  } catch (err) {
    session.starting = false
    sessions.delete(session.key)
    if (signal.aborted) {
      session.child = null
      log(session, 'system', '启动已取消')
      setState(session, {
        status: 'idle',
        message: '已取消启动',
        progress: null,
        stage: null,
        speed: null
      })
    } else {
      const message = err instanceof Error ? err.message : String(err)
      log(session, 'system', `启动失败：${message}`)
      events?.onCrashAssist?.({
        instanceId: instanceId ?? null,
        versionId,
        kind: 'launch-error',
        exitCode: null,
        message
      })
      setState(session, {
        status: 'error',
        message: '启动失败',
        error: message,
        progress: null,
        stage: null,
        speed: null
      })
      await closeLogFile(session)
      throw err
    }
    await closeLogFile(session)
  } finally {
    session.preparingAbort = null
  }
}

async function terminateProcess(target: ChildProcess): Promise<void> {
  if (!target.pid) return
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(target.pid), '/t', '/f'], {
        windowsHide: true,
        stdio: 'ignore'
      })
      killer.on('exit', () => resolve())
      killer.on('error', () => resolve())
    })
    return
  }
  try {
    target.kill('SIGKILL')
  } catch {
    /* already gone */
  }
}

async function stopSession(session: GameSession | null): Promise<void> {
  if (!session || session.state.status !== 'running' || !session.child) return
  session.intentionalStop = true
  log(session, 'system', '正在结束游戏进程…')
  await terminateProcess(session.child)
}

export async function stopGame(): Promise<void> {
  await stopSession(primary)
}

export async function stopInstanceGame(instanceId: string): Promise<void> {
  const session = [...sessions.values()].find((item) => item.instanceId === instanceId)
  await stopSession(session ?? null)
}

export async function cancelLaunch(): Promise<void> {
  if (primary && (primary.state.status === 'preparing' || primary.state.status === 'starting')) {
    primary.preparingAbort?.abort()
  }
}