import AdmZip from 'adm-zip'
import { spawn, type ChildProcess } from 'node:child_process'
import { app } from 'electron'
import { createWriteStream, existsSync, promises as fs, type WriteStream } from 'node:fs'
import { dirname, join } from 'node:path'
import type { LaunchLogLine, LaunchState } from '../../shared/types'
import { ensureFreshAccount } from './auth'
import { getActiveAccount, getLogDir, getSettings, markVersionPlayed } from './config'
import { getInstance, getInstanceDir, getInstanceMinecraftDir, markInstancePlayed } from './instances'
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

const MAX_LOG_LINES = 4000
const APP_VERSION = app.getVersion()

interface LauncherEvents {
  onState: (state: LaunchState) => void
  onLog: (line: LaunchLogLine) => void
  onGameStarted?: () => void
  onGameExited?: () => void
}

let events: LauncherEvents | null = null
let currentState: LaunchState = {
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
  speed: null
}
let logs: LaunchLogLine[] = []
let logStream: WriteStream | null = null
let latestLogPath: string | null = null
let child: ChildProcess | null = null
let preparingAbort: AbortController | null = null
let starting = false

export function setLauncherEvents(handlers: LauncherEvents): void {
  events = handlers
}

export function getLaunchState(): LaunchState {
  return { ...currentState }
}

export function getLaunchLogs(): LaunchLogLine[] {
  return [...logs]
}

export function getLatestLogPath(): string | null {
  return latestLogPath
}

export function isGameActive(): boolean {
  return (
    starting ||
    currentState.status === 'preparing' ||
    currentState.status === 'starting' ||
    currentState.status === 'running'
  )
}

function setState(patch: Partial<LaunchState>): void {
  currentState = { ...currentState, ...patch }
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

function writeLogFile(line: LaunchLogLine): void {
  if (!logStream) return
  const tag = line.level ? line.level.toUpperCase() : line.stream
  const source = line.logger
    ? ` [${line.logger}${line.thread ? ` / ${line.thread}` : ''}]`
    : ''
  logStream.write(`[${clockOf(line.time)}] [${tag}]${source} ${line.text}\n`)
  if (line.detail) logStream.write(`${line.detail}\n`)
}

function appendLog(line: LaunchLogLine): void {
  const next: LaunchLogLine = {
    ...line,
    text: redactSecrets(line.text.replace(/\x1b\[[0-9;]*m/g, '')),
    detail: line.detail ? redactSecrets(line.detail) : undefined
  }
  logs.push(next)
  if (logs.length > MAX_LOG_LINES) logs.splice(0, logs.length - MAX_LOG_LINES)
  writeLogFile(next)
  events?.onLog(next)
}

function log(stream: LaunchLogLine['stream'], text: string): void {
  appendLog({ time: Date.now(), stream, text })
}

function logGameEvent(stream: LaunchLogLine['stream'], event: GameLogEvent): void {
  appendLog({
    time: event.time,
    stream,
    text: event.message,
    level: event.level,
    logger: event.logger || undefined,
    thread: event.thread || undefined,
    detail: event.detail ?? undefined
  })
}

async function openLogFile(): Promise<void> {
  try {
    await fs.mkdir(getLogDir(), { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    latestLogPath = join(getLogDir(), `launch-${stamp}.log`)
    logStream?.end()
    logStream = createWriteStream(latestLogPath, { flags: 'a' })
  } catch {
    logStream = null
  }
}

async function closeLogFile(): Promise<void> {
  const stream = logStream
  logStream = null
  if (!stream) return
  await new Promise<void>((resolve) => stream.end(resolve))
}

function resetState(): void {
  logs = []
  currentState = {
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
    speed: null
  }
}

function createLineBuffer(
  stream: 'stdout' | 'stderr'
): { push: (chunk: Buffer) => void; flush: () => void } {
  let buffer = ''
  const assembler = new GameLogAssembler()
  const emit = (feeds: GameLogFeed[]): void => {
    for (const feed of feeds) {
      if (feed.type === 'event') logGameEvent(stream, feed.event)
      else if (feed.text.length) log(stream, feed.text)
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
      log('system', `缺少运行库文件：${native.path}`)
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
      log('system', `解压运行库失败：${native.path}`)
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
  if (isGameActive()) throw new Error('已有游戏正在启动或运行中')
  starting = true
  resetState()
  preparingAbort = new AbortController()
  const signal = preparingAbort.signal
  const settings = getSettings()
  const server = options?.server ?? null

  setState({
    status: 'preparing',
    message: server ? `正在准备进入${server.name ? `「${server.name}」` : '服务器'}` : '正在检查启动环境',
    progress: 1,
    stage: '检查环境',
    versionId,
    instanceId: instanceId ?? null
  })
  await openLogFile()

  try {
    const instance = instanceId ? await getInstance(instanceId) : null
    if (instance && instance.versionId !== versionId) {
      throw new Error('实例与游戏版本不匹配，请重新安装该整合包')
    }
    const baseDir = instance?.external?.baseDir ?? instance?.baseDir ?? settings.gameDir
    const gameDir = instance
      ? instance.external?.gameDir ?? getInstanceMinecraftDir(instance.id)
      : baseDir
    const launchSettings = instance
      ? {
          ...settings,
          maxMemoryMb: instance.memoryMb ?? settings.maxMemoryMb,
          extraJvmArgs: [settings.extraJvmArgs, instance.extraJvmArgs ?? '']
            .filter((value) => value.trim())
            .join(' ')
            .slice(0, 4000),
          javaPath: instance.javaPath ?? settings.javaPath
        }
      : settings
    log(
      'system',
      instance
        ? `风信启动器 ${APP_VERSION} 正在启动整合包「${instance.name}」（Minecraft ${instance.gameVersion}）`
        : `风信启动器 ${APP_VERSION} 正在启动 Minecraft ${versionId}`
    )
    if (instance) log('system', `加载器：${instance.loader === 'vanilla' ? '原版' : instance.loader}`)
    if (instance?.external) log('system', `外部实例：直接使用 ${instance.external.gameDir}`)
    if (server) {
      log(
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
    log('system', `版本类型：${versionJson.type ?? 'release'}，所需 Java：${requiredMajor ?? '自动检测'}`)

    if (signal.aborted) throw new CancellationError()

    const account = getActiveAccount()
    if (!account) throw new Error('尚未登录账户，请先添加离线账户或登录微软账户')
    setState({ stage: '验证账户', message: '正在验证账户信息', progress: 5 })
    const freshAccount = await ensureFreshAccount(account)
    log('system', `账户：${freshAccount.name}（${freshAccount.type === 'microsoft' ? '微软账户' : '离线账户'}）`)

    if (signal.aborted) throw new CancellationError()

    setState({ stage: '准备 Java', message: '正在查找 Java 环境', progress: 12 })
    let lastJavaStage = ''
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
          log('system', progress.stage)
        }
        setState({
          stage: progress.stage,
          message: progress.stage,
          progress: Math.round(8 + progress.percent * 0.55),
          speed: progress.detail.speed > 0 ? progress.detail.speed : null
        })
      }
    })
    log('system', `使用 Java ${java.version}（${java.path}）`)

    if (signal.aborted) throw new CancellationError()
    setState({ stage: '准备游戏文件', message: '正在整理运行库与资源', progress: 68, speed: null })
    await prepareNatives(
      baseDir,
      version,
      instance?.external ? join(getInstanceDir(instance.id), 'natives') : undefined
    )

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
      settings: launchSettings,
      javaPath: java.path,
      launcherVersion: APP_VERSION,
      loggingPath: hasLogging ? loggingPath : null,
      server: server ? { host: server.host, port: server.port } : null
    })

    const missing = command.classpath
      .split(';')
      .filter(Boolean)
      .find((path) => !existsSync(path))
    if (missing) {
      throw new Error(
        instance
          ? `整合包文件不完整（缺少 ${missing.split(/[\\/]/).pop()}），请重新安装该实例`
          : `游戏文件不完整（缺少 ${missing.split(/[\\/]/).pop()}），请在下载页对当前版本执行“补全文件”`
      )
    }

    if (signal.aborted) throw new CancellationError()
    setState({ status: 'starting', stage: '启动游戏', message: '正在创建游戏进程', progress: 82 })
    await fs.mkdir(gameDir, { recursive: true })
    log('system', `游戏目录：${gameDir}`)
    log('system', `内存分配：${launchSettings.maxMemoryMb} MB`)

    const stdoutBuffer = createLineBuffer('stdout')
    const stderrBuffer = createLineBuffer('stderr')
    const gameProcess = spawn(command.executable, command.args, {
      cwd: gameDir,
      windowsHide: true,
      detached: true,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    child = gameProcess
    let exited = false
    let started = false

    gameProcess.stdout?.on('data', (data: Buffer) => stdoutBuffer.push(data))
    gameProcess.stderr?.on('data', (data: Buffer) => stderrBuffer.push(data))

    const handleExit = (code: number | null) => {
      if (exited) return
      exited = true
      stdoutBuffer.flush()
      stderrBuffer.flush()
      child = null
      starting = false
      log('system', `游戏进程已退出，退出代码 ${code ?? '未知'}`)
      void finishPlaySession({ exitCode: code })
      setState({
        status: 'exited',
        message: code === 0 ? '游戏已正常退出' : `游戏异常退出（代码 ${code ?? '未知'}）`,
        progress: null,
        stage: null,
        exitCode: code,
        speed: null
      })
      void closeLogFile()
      events?.onGameExited?.()
    }
    gameProcess.on('exit', handleExit)

    gameProcess.on('error', (err) => {
      log('system', `进程启动失败：${err.message}`)
      if (!started) {
        setState({
          status: 'error',
          message: '无法启动游戏进程',
          error: `无法启动 Java 进程：${err.message}`,
          progress: null
        })
        starting = false
        void closeLogFile()
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

    const session = await startPlaySession({
      instanceId: instance?.id ?? null,
      name: instance?.name ?? versionId,
      versionId,
      pid: gameProcess.pid ?? null
    }).catch(() => null)
    if (session && gameProcess.pid) {
      startPlaytimeWatcher(gameProcess.pid, session.donePath)
    }
    if (exited) return

    starting = false
    setState({
      status: 'running',
      message: '游戏运行中',
      progress: 100,
      stage: '游戏运行中',
      pid: gameProcess.pid ?? null,
      startedAt: Date.now(),
      speed: null
    })
    markVersionPlayed(versionId)
    if (instance) void markInstancePlayed(instance.id)
    log('system', `Minecraft 已启动，进程 PID：${gameProcess.pid ?? '未知'}`)
    events?.onGameStarted?.()
  } catch (err) {
    starting = false
    if (signal.aborted) {
      child = null
      log('system', '启动已取消')
      setState({
        status: 'idle',
        message: '已取消启动',
        progress: null,
        stage: null,
        speed: null
      })
    } else {
      const message = err instanceof Error ? err.message : String(err)
      log('system', `启动失败：${message}`)
      setState({
        status: 'error',
        message: '启动失败',
        error: message,
        progress: null,
        stage: null,
        speed: null
      })
      await closeLogFile()
      throw err
    }
    await closeLogFile()
  } finally {
    preparingAbort = null
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
      killer.on('error', () => {
        try {
          target.kill()
        } catch {
          /* ignore */
        }
        resolve()
      })
    })
  } else {
    try {
      target.kill()
    } catch {
      /* ignore */
    }
  }
}

export async function cancelLaunch(): Promise<void> {
  if (currentState.status === 'preparing' || currentState.status === 'starting') {
    preparingAbort?.abort()
    if (child) await terminateProcess(child)
    return
  }
}

export async function stopGame(): Promise<void> {
  if (currentState.status !== 'running' || !child) return
  log('system', '正在结束游戏进程…')
  await terminateProcess(child)
}
