import dns from 'node:dns/promises'
import net from 'node:net'
import { domainToASCII } from 'node:url'
import type { ServerPlayerSample, ServerStatus } from '../../shared/types'

const DEFAULT_PORT = 25565
const STATUS_PROTOCOL = 47
const MAX_RESPONSE_BYTES = 512 * 1024
const DEFAULT_TIMEOUT_MS = 4200

export interface ParsedServerAddress {
  host: string
  port: number
  address: string
}

export interface ResolvedServerTarget {
  host: string
  port: number
  srv: boolean
}

export function emptyServerStatus(): ServerStatus {
  return {
    state: 'unknown',
    motd: '',
    version: null,
    protocol: null,
    playersOnline: null,
    playersMax: null,
    playersSample: [],
    latencyMs: null,
    favicon: null,
    checkedAt: null,
    error: null
  }
}

export function offlineServerStatus(error: string): ServerStatus {
  return {
    ...emptyServerStatus(),
    state: 'offline',
    checkedAt: Date.now(),
    error
  }
}

export function parseServerAddress(raw: string): ParsedServerAddress {
  let value = raw.trim()
  if (!value) throw new Error('请填写服务器地址')
  if (value.length > 300) throw new Error('服务器地址过长')
  value = value.replace(/^minecraft:\/\//i, '').replace(/\/+$/, '')
  if (!value || /\s/.test(value)) throw new Error('服务器地址不能包含空格')

  let host = ''
  let port = DEFAULT_PORT

  if (value.startsWith('[')) {
    const end = value.indexOf(']')
    if (end < 0) throw new Error('IPv6 地址缺少右方括号')
    host = value.slice(1, end)
    const rest = value.slice(end + 1)
    if (rest) {
      if (!rest.startsWith(':')) throw new Error('服务器地址格式不正确')
      port = Number(rest.slice(1))
    }
    if (net.isIP(host) !== 6) throw new Error('方括号里不是有效的 IPv6 地址')
  } else {
    const colons = (value.match(/:/g) ?? []).length
    if (colons === 1) {
      const index = value.lastIndexOf(':')
      host = value.slice(0, index)
      port = Number(value.slice(index + 1))
    } else {
      // 不带方括号的 IPv6 使用默认端口。
      host = value
    }
  }

  if (!host) throw new Error('请填写服务器地址')
  if (!/^\d+$/.test(String(port)) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('端口需要在 1–65535 之间')
  }

  if (net.isIP(host) === 0) {
    if (!/^[A-Za-z0-9.-]+$/.test(host) && !/[^\x00-\x7F]/.test(host)) {
      throw new Error('服务器地址格式不正确')
    }
    const ascii = domainToASCII(host)
    if (!ascii) throw new Error('服务器地址格式不正确')
    host = ascii.toLowerCase().replace(/\.$/, '')
    if (
      host.length > 253 ||
      !/^(?=.{1,253}$)([A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(
        host
      )
    ) {
      throw new Error('服务器地址格式不正确')
    }
  }

  return {
    host,
    port,
    address: formatServerAddress(host, port)
  }
}

export function formatServerAddress(host: string, port: number): string {
  return net.isIP(host) === 6 ? `[${host}]:${port}` : `${host}:${port}`
}

export function formatServerHost(host: string): string {
  return net.isIP(host) === 6 ? `[${host}]` : host
}

export async function resolveServerTarget(
  host: string,
  port: number
): Promise<ResolvedServerTarget> {
  if (port !== DEFAULT_PORT || net.isIP(host) !== 0) {
    return { host, port, srv: false }
  }
  try {
    const records = await dns.resolveSrv(`_minecraft._tcp.${host}`)
    if (!records.length) return { host, port, srv: false }
    const candidates = [...records].sort(
      (a, b) => a.priority - b.priority || b.weight - a.weight
    )
    const chosen = candidates[0]
    if (!chosen?.name) return { host, port, srv: false }
    return {
      host: chosen.name.replace(/\.$/, ''),
      port: chosen.port || DEFAULT_PORT,
      srv: true
    }
  } catch {
    return { host, port, srv: false }
  }
}

export async function pingMinecraftServer(
  host: string,
  port: number,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<ServerStatus> {
  const started = Date.now()
  const target = await resolveServerTarget(host, port)
  return new Promise<ServerStatus>((resolve) => {
    let settled = false
    let connected = false
    let buffer = Buffer.alloc(0)
    const socket = net.createConnection({ host: target.host, port: target.port })
    socket.setNoDelay(true)

    const timer = setTimeout(() => {
      finish(offlineServerStatus('连接超时'))
    }, timeoutMs)

    function finish(status: ServerStatus): void {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      resolve({
        ...status,
        latencyMs: status.state === 'online' ? Math.max(1, Date.now() - started) : null,
        checkedAt: Date.now()
      })
    }

    socket.on('connect', () => {
      connected = true
      const hostBuffer = Buffer.from(target.host, 'utf8')
      const handshakeBody = Buffer.concat([
        varInt(0),
        varInt(STATUS_PROTOCOL),
        varInt(hostBuffer.length),
        hostBuffer,
        unsignedShort(target.port),
        varInt(1)
      ])
      const handshake = Buffer.concat([varInt(handshakeBody.length), handshakeBody])
      const request = Buffer.from([0x01, 0x00])
      socket.write(Buffer.concat([handshake, request]))
    })

    socket.on('data', (chunk: Buffer) => {
      if (settled) return
      buffer = Buffer.concat([buffer, chunk])
      if (buffer.length > MAX_RESPONSE_BYTES) {
        finish(offlineServerStatus('服务器返回的数据过大'))
        return
      }
      try {
        const status = tryReadStatus(buffer)
        if (status) finish(status)
      } catch (error) {
        finish(
          offlineServerStatus(
            error instanceof Error ? error.message : '服务器返回的数据无法解析'
          )
        )
      }
    })

    socket.on('error', (error: NodeJS.ErrnoException) => {
      finish(offlineServerStatus(friendlyNetworkError(error)))
    })

    socket.on('close', () => {
      if (!settled) {
        finish(
          offlineServerStatus(
            connected ? '服务器没有返回状态信息' : '无法连接到服务器'
          )
        )
      }
    })
  })
}

function tryReadStatus(buffer: Buffer): ServerStatus | null {
  const frameLength = readVarInt(buffer, 0)
  if (!frameLength) return null
  if (frameLength.value <= 0) throw new Error('服务器返回了无效的数据')
  if (buffer.length < frameLength.size + frameLength.value) return null
  const frame = buffer.subarray(
    frameLength.size,
    frameLength.size + frameLength.value
  )
  const packetId = readVarInt(frame, 0)
  if (!packetId) throw new Error('服务器返回了无效的数据')
  if (packetId.value !== 0) throw new Error('服务器返回了非状态数据')
  const stringLength = readVarInt(frame, packetId.size)
  if (!stringLength) throw new Error('服务器返回了不完整的数据')
  if (stringLength.value < 0 || stringLength.value > MAX_RESPONSE_BYTES) {
    throw new Error('服务器返回的数据过大')
  }
  const start = packetId.size + stringLength.size
  if (frame.length < start + stringLength.value) return null
  const text = frame.subarray(start, start + stringLength.value).toString('utf8')
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('服务器状态不是有效的 JSON')
  }
  return normalizeStatus(parsed)
}

function normalizeStatus(raw: unknown): ServerStatus {
  const data = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const version = data.version
  const players = data.players
  const versionName =
    version && typeof version === 'object' && typeof (version as Record<string, unknown>).name === 'string'
      ? String((version as Record<string, unknown>).name).slice(0, 80)
      : null
  const protocol =
    version &&
    typeof version === 'object' &&
    Number.isFinite(Number((version as Record<string, unknown>).protocol))
      ? Math.max(0, Math.round(Number((version as Record<string, unknown>).protocol)))
      : null
  const online =
    players && typeof players === 'object' && Number.isFinite(Number((players as Record<string, unknown>).online))
      ? Math.max(0, Math.round(Number((players as Record<string, unknown>).online)))
      : null
  const max =
    players && typeof players === 'object' && Number.isFinite(Number((players as Record<string, unknown>).max))
      ? Math.max(0, Math.round(Number((players as Record<string, unknown>).max)))
      : null
  const sample =
    players &&
    typeof players === 'object' &&
    Array.isArray((players as Record<string, unknown>).sample)
      ? normalizePlayerSample((players as Record<string, unknown>).sample as unknown[])
      : []
  const favicon =
    typeof data.favicon === 'string' &&
    data.favicon.startsWith('data:image/png;base64,') &&
    data.favicon.length <= 200_000
      ? data.favicon
      : null
  return {
    state: 'online',
    motd: chatToText(data.description).slice(0, 500),
    version: versionName,
    protocol,
    playersOnline: online,
    playersMax: max,
    playersSample: sample,
    latencyMs: null,
    favicon,
    checkedAt: Date.now(),
    error: null
  }
}

function normalizePlayerSample(raw: unknown[]): ServerPlayerSample[] {
  const result: ServerPlayerSample[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    if (result.length >= 24) break
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const name =
      typeof record.name === 'string'
        ? record.name.replace(/[\u0000-\u001f\u007f§]/g, '').trim().slice(0, 32)
        : ''
    if (!name) continue
    let id: string | null = null
    if (typeof record.id === 'string') {
      const clean = record.id.replace(/-/g, '').toLowerCase()
      if (/^[0-9a-f]{32}$/.test(clean)) id = clean
    }
    const key = id ?? name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ name, id })
  }
  return result
}

const COLOR_CODES: Record<string, string> = {
  black: '0',
  dark_blue: '1',
  dark_green: '2',
  dark_aqua: '3',
  dark_red: '4',
  dark_purple: '5',
  gold: '6',
  gray: '7',
  dark_gray: '8',
  blue: '9',
  green: 'a',
  aqua: 'b',
  red: 'c',
  light_purple: 'd',
  yellow: 'e',
  white: 'f'
}

function styleCodes(component: Record<string, unknown>): string {
  let prefix = ''
  if (typeof component.color === 'string') {
    const color = component.color.toLowerCase()
    if (COLOR_CODES[color]) prefix += `§${COLOR_CODES[color]}`
    else if (/^#[0-9a-f]{6}$/i.test(color)) {
      prefix += `§x${color
        .slice(1)
        .split('')
        .map((char) => `§${char}`)
        .join('')}`
    }
  }
  if (component.bold === true) prefix += '§l'
  if (component.italic === true) prefix += '§o'
  if (component.underlined === true) prefix += '§n'
  if (component.strikethrough === true) prefix += '§m'
  return prefix
}

function chatToText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(chatToText).join('')
  if (!value || typeof value !== 'object') return ''
  const component = value as Record<string, unknown>
  let body = ''
  if (typeof component.text === 'string') body += component.text
  else if (typeof component.translate === 'string') {
    const args = Array.isArray(component.with) ? component.with.map(chatToText) : []
    body += component.translate.replace(/%(\d+\$)?s/g, () => args.shift() ?? '')
  }
  if (Array.isArray(component.extra)) body += component.extra.map(chatToText).join('')
  const prefix = styleCodes(component)
  return prefix ? `${prefix}${body}§r` : body
}

function friendlyNetworkError(error: NodeJS.ErrnoException): string {
  switch (error.code) {
    case 'ECONNREFUSED':
      return '连接被拒绝，服务器可能没有运行'
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return '找不到这个服务器地址'
    case 'ETIMEDOUT':
    case 'ESOCKETTIMEDOUT':
      return '连接超时'
    case 'EHOSTUNREACH':
      return '主机不可达'
    case 'ECONNRESET':
      return '连接被服务器重置'
    default:
      return error.message || '无法连接到服务器'
  }
}

function varInt(value: number): Buffer {
  let unsigned = value >>> 0
  const bytes: number[] = []
  do {
    let byte = unsigned & 0x7f
    unsigned >>>= 7
    if (unsigned !== 0) byte |= 0x80
    bytes.push(byte)
  } while (unsigned !== 0)
  return Buffer.from(bytes)
}

function unsignedShort(value: number): Buffer {
  const buffer = Buffer.alloc(2)
  buffer.writeUInt16BE(value, 0)
  return buffer
}

function readVarInt(
  buffer: Buffer,
  offset: number
): { value: number; size: number } | null {
  let result = 0
  let shift = 0
  let size = 0
  while (offset + size < buffer.length) {
    const byte = buffer[offset + size]
    result |= (byte & 0x7f) << shift
    size += 1
    if ((byte & 0x80) === 0) return { value: result | 0, size }
    shift += 7
    if (shift > 35) throw new Error('服务器返回了无效的数据')
  }
  return null
}
