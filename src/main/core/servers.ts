import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  ServerInput,
  ServerProbe,
  ServerPingResult,
  ServerRecord,
  ServerStatus,
  ServerView
} from '../../shared/types'
import { getConfigDir } from './config'
import { getInstance } from './instances'
import { launchGame } from './launcher'
import {
  emptyServerStatus,
  formatServerAddress,
  parseServerAddress,
  pingMinecraftServer,
  resolveServerTarget
} from './serverPing'

interface ServerFile {
  version: 1
  servers: ServerRecord[]
}

const SERVER_ID = /^[a-f0-9-]{8,64}$/i
const MAX_NAME = 48
const MAX_NOTE = 200
const MAX_SERVERS = 200

let servers: ServerRecord[] | null = null
let loading: Promise<void> | null = null
let saveQueue: Promise<void> = Promise.resolve()

function filePath(): string {
  return join(getConfigDir(), 'servers.json')
}

async function ensureLoaded(): Promise<ServerRecord[]> {
  if (servers) return servers
  if (!loading) {
    loading = (async () => {
      let parsed: unknown = null
      try {
        parsed = JSON.parse(await fs.readFile(filePath(), 'utf8'))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          try {
            await fs.rename(filePath(), `${filePath()}.broken-${Date.now()}`)
          } catch {
            /* ignore */
          }
        }
      }
      const raw =
        parsed && typeof parsed === 'object' && Array.isArray((parsed as ServerFile).servers)
          ? (parsed as ServerFile).servers
          : []
      servers = raw
        .map((entry) => normalizeRecord(entry))
        .filter((entry): entry is ServerRecord => Boolean(entry))
        .slice(0, MAX_SERVERS)
    })().finally(() => {
      loading = null
    })
  }
  await loading
  return servers ?? []
}

function normalizeRecord(raw: unknown): ServerRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const entry = raw as Record<string, unknown>
  if (typeof entry.id !== 'string' || !SERVER_ID.test(entry.id)) return null
  if (typeof entry.host !== 'string' || typeof entry.name !== 'string') return null
  if (typeof entry.port !== 'number' || !Number.isInteger(entry.port)) return null
  const host = entry.host.trim()
  const port = entry.port
  if (!host || port < 1 || port > 65535) return null
  return {
    id: entry.id,
    name: entry.name.slice(0, MAX_NAME),
    host,
    port,
    instanceId:
      typeof entry.instanceId === 'string' && entry.instanceId.length <= 128
        ? entry.instanceId
        : null,
    category: typeof entry.category === 'string' ? entry.category.slice(0, 20) : '',
    note: typeof entry.note === 'string' ? entry.note.slice(0, MAX_NOTE) : '',
    createdAt:
      typeof entry.createdAt === 'number' && Number.isFinite(entry.createdAt)
        ? entry.createdAt
        : Date.now(),
    updatedAt:
      typeof entry.updatedAt === 'number' && Number.isFinite(entry.updatedAt)
        ? entry.updatedAt
        : Date.now()
  }
}

async function persist(): Promise<void> {
  const snapshot: ServerFile = {
    version: 1,
    servers: servers ?? []
  }
  const next = JSON.stringify(snapshot, null, 2)
  saveQueue = saveQueue.then(async () => {
    await fs.mkdir(getConfigDir(), { recursive: true })
    const path = filePath()
    const tmp = `${path}.tmp`
    await fs.writeFile(tmp, next, 'utf8')
    await fs.rename(tmp, path)
  })
  return saveQueue
}

function sanitizeInput(raw: unknown): {
  name: string
  host: string
  port: number
  address: string
  instanceId: string | null
  category: string
  note: string
} {
  if (!raw || typeof raw !== 'object') throw new Error('无效的服务器信息')
  const input = raw as Partial<ServerInput>
  const parsed = parseServerAddress(typeof input.address === 'string' ? input.address : '')
  const name =
    typeof input.name === 'string' && input.name.trim()
      ? input.name.trim().slice(0, MAX_NAME)
      : parsed.host
  const instanceId =
    typeof input.instanceId === 'string' && input.instanceId.trim()
      ? input.instanceId.trim().slice(0, 128)
      : null
  const category =
    typeof input.category === 'string' ? input.category.trim().slice(0, 20) : ''
  const note =
    typeof input.note === 'string' ? input.note.trim().slice(0, MAX_NOTE) : ''
  return { name, ...parsed, instanceId, category, note }
}

function toView(record: ServerRecord): ServerView {
  return { ...record, status: emptyServerStatus() }
}

function checkDuplicate(address: string, exceptId?: string): void {
  const duplicate = (servers ?? []).find(
    (entry) =>
      entry.id !== exceptId && formatServerAddress(entry.host, entry.port) === address
  )
  if (duplicate) throw new Error('这个服务器地址已经在列表里了')
}

export async function listServers(): Promise<ServerView[]> {
  return (await ensureLoaded()).map(toView)
}

export async function addServer(raw: unknown): Promise<ServerView> {
  const all = await ensureLoaded()
  if (all.length >= MAX_SERVERS) throw new Error('服务器数量已经达到上限')
  const input = sanitizeInput(raw)
  checkDuplicate(input.address)
  const now = Date.now()
  const record: ServerRecord = {
    id: randomUUID(),
    name: input.name,
    host: input.host,
    port: input.port,
    instanceId: input.instanceId,
    category: input.category,
    note: input.note,
    createdAt: now,
    updatedAt: now
  }
  all.unshift(record)
  await persist()
  return toView(record)
}

export async function updateServer(id: string, raw: unknown): Promise<ServerView> {
  const all = await ensureLoaded()
  const index = all.findIndex((entry) => entry.id === id)
  if (index < 0) throw new Error('服务器不存在')
  const input = sanitizeInput(raw)
  checkDuplicate(input.address, id)
  all[index] = {
    ...all[index],
    name: input.name,
    host: input.host,
    port: input.port,
    instanceId: input.instanceId,
    category: input.category,
    note: input.note,
    updatedAt: Date.now()
  }
  await persist()
  return toView(all[index])
}

export async function removeServer(id: string): Promise<void> {
  const all = await ensureLoaded()
  const next = all.filter((entry) => entry.id !== id)
  if (next.length === all.length) throw new Error('服务器不存在')
  servers = next
  await persist()
}

export async function getServer(id: string): Promise<ServerRecord> {
  const record = (await ensureLoaded()).find((entry) => entry.id === id)
  if (!record) throw new Error('服务器不存在')
  return { ...record }
}

export function requireServerId(value: unknown): string {
  if (typeof value !== 'string' || !SERVER_ID.test(value)) {
    throw new Error('无效的服务器标识')
  }
  return value
}

export async function pingServer(id: string): Promise<ServerStatus> {
  const record = await getServer(id)
  return pingMinecraftServer(record.host, record.port)
}

export async function pingAllServers(): Promise<ServerPingResult[]> {
  const all = await ensureLoaded()
  return Promise.all(
    all.map(async (record) => ({
      id: record.id,
      status: await pingMinecraftServer(record.host, record.port)
    }))
  )
}

export async function probeServer(rawAddress: string): Promise<ServerProbe> {
  if (typeof rawAddress !== 'string') throw new Error('请填写服务器地址')
  const parsed = parseServerAddress(rawAddress)
  const status = await pingMinecraftServer(parsed.host, parsed.port)
  return {
    address: parsed.address,
    host: parsed.host,
    port: parsed.port,
    status
  }
}

export async function launchServer(id: string): Promise<void> {
  const record = await getServer(id)
  if (!record.instanceId) throw new Error('请先给这个服务器选择一个实例')
  let instance
  try {
    instance = await getInstance(record.instanceId)
  } catch {
    throw new Error('服务器绑定的实例不存在，请重新选择')
  }
  const target = await resolveServerTarget(record.host, record.port)
  await launchGame(instance.versionId, instance.id, {
    server: {
      host: target.host,
      port: target.port,
      name: record.name
    }
  })
}
