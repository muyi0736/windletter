import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { getConfigDir } from './config'
import { USER_AGENT } from './net'

const UUID = /^[0-9a-f]{32}$/i
const SKIN_HOST = /(^|\.)minecraft\.net$/i
const MEMORY_TTL = 10 * 60_000
const DISK_TTL = 2 * 60 * 60_000
const MAX_SKIN_BYTES = 2 * 1024 * 1024

interface SkinEntry {
  at: number
  dataUrl: string | null
}

const cache = new Map<string, SkinEntry>()
const littleSkinCache = new Map<string, SkinEntry>()

function remember(uuid: string, dataUrl: string | null): string | null {
  cache.set(uuid, { at: Date.now(), dataUrl })
  return dataUrl
}

function skinCachePath(uuid: string): string {
  return join(getConfigDir(), 'cache', 'skins', `${uuid}.png`)
}

function littleSkinKey(name: string): string {
  return `littleskin-${createHash('sha1').update(name.toLowerCase()).digest('hex')}`
}

function littleSkinCachePath(name: string): string {
  return join(getConfigDir(), 'cache', 'skins', `${littleSkinKey(name)}.png`)
}

async function readCachedFile(path: string): Promise<string | null> {
  try {
    const stat = await fs.stat(path)
    if (Date.now() - stat.mtimeMs > DISK_TTL) return null
    const buffer = await fs.readFile(path)
    if (buffer.length === 0 || buffer.length > MAX_SKIN_BYTES) return null
    return `data:image/png;base64,${buffer.toString('base64')}`
  } catch {
    return null
  }
}

async function readCachedSkin(uuid: string): Promise<string | null> {
  return readCachedFile(skinCachePath(uuid))
}

async function writeCachedFile(path: string, buffer: Buffer): Promise<void> {
  try {
    await fs.mkdir(dirname(path), { recursive: true })
    await fs.writeFile(path, buffer)
  } catch {
    /* 缓存失败不影响显示 */
  }
}

async function writeCachedSkin(uuid: string, buffer: Buffer): Promise<void> {
  await writeCachedFile(skinCachePath(uuid), buffer)
}

/**
 * Resolve the public skin of a Minecraft account and return it as a data URL.
 * The renderer draws the 8×8 face and the 8×8 hat layer from this image.
 */
export async function getSkinDataUrl(raw: unknown): Promise<string | null> {
  if (typeof raw !== 'string') return null
  const uuid = raw.replace(/-/g, '').toLowerCase()
  if (!UUID.test(uuid)) return null

  const memory = cache.get(uuid)
  if (memory && Date.now() - memory.at < MEMORY_TTL) return memory.dataUrl

  const disk = await readCachedSkin(uuid)
  if (disk) return remember(uuid, disk)

  try {
    const profileResponse = await fetch(
      `https://sessionserver.mojang.com/session/minecraft/profile/${uuid}`,
      {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(8000)
      }
    )
    if (!profileResponse.ok) return remember(uuid, null)

    const profile = (await profileResponse.json()) as {
      properties?: { name?: string; value?: string }[]
    }
    const textures = profile.properties?.find((entry) => entry.name === 'textures')
    if (!textures?.value) return remember(uuid, null)

    let decoded: { textures?: { SKIN?: { url?: string } } }
    try {
      decoded = JSON.parse(Buffer.from(textures.value, 'base64').toString('utf8')) as typeof decoded
    } catch {
      return remember(uuid, null)
    }
    const rawUrl = decoded.textures?.SKIN?.url
    if (typeof rawUrl !== 'string') return remember(uuid, null)

    let skinUrl: URL
    try {
      skinUrl = new URL(rawUrl)
    } catch {
      return remember(uuid, null)
    }
    if (!SKIN_HOST.test(skinUrl.hostname)) return remember(uuid, null)
    if (skinUrl.protocol === 'http:') {
      skinUrl.protocol = 'https:'
    } else if (skinUrl.protocol !== 'https:') {
      return remember(uuid, null)
    }

    const skinResponse = await fetch(skinUrl, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'image/png,image/*' },
      signal: AbortSignal.timeout(10_000)
    })
    if (!skinResponse.ok) return remember(uuid, null)

    const contentType = skinResponse.headers.get('content-type') ?? ''
    if (!contentType.toLowerCase().startsWith('image/')) return remember(uuid, null)

    const buffer = Buffer.from(await skinResponse.arrayBuffer())
    if (buffer.length === 0 || buffer.length > MAX_SKIN_BYTES) return remember(uuid, null)
    if (!buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      return remember(uuid, null)
    }

    await writeCachedSkin(uuid, buffer)
    return remember(uuid, `data:image/png;base64,${buffer.toString('base64')}`)
  } catch {
    return remember(uuid, null)
  }
}

function pngDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (
    buffer.length < 24 ||
    !buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return null
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  }
}

function isMinecraftSkinSheet(buffer: Buffer): boolean {
  const dimensions = pngDimensions(buffer)
  return Boolean(
    dimensions &&
      dimensions.width === 64 &&
      (dimensions.height === 64 || dimensions.height === 32)
  )
}

function validLittleSkinName(name: string): boolean {
  return (
    name.length >= 1 &&
    name.length <= 32 &&
    /^[A-Za-z0-9_\u3400-\u9fff -]+$/u.test(name)
  )
}

function rememberLittleSkin(name: string, dataUrl: string | null): string | null {
  littleSkinCache.set(littleSkinKey(name), { at: Date.now(), dataUrl })
  return dataUrl
}

async function readLittleSkinCache(name: string): Promise<string | null> {
  const disk = await readCachedFile(littleSkinCachePath(name))
  if (disk) return rememberLittleSkin(name, disk)
  return null
}

async function fetchLittleSkin(name: string): Promise<string | null> {
  try {
    const response = await fetch(
      `https://littleskin.cn/skin/${encodeURIComponent(name)}.png`,
      {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'image/png,image/*;q=0.8'
        },
        signal: AbortSignal.timeout(8000)
      }
    )
    if (!response.ok) return rememberLittleSkin(name, null)
    const buffer = Buffer.from(await response.arrayBuffer())
    if (!isMinecraftSkinSheet(buffer)) return rememberLittleSkin(name, null)
    await writeCachedFile(littleSkinCachePath(name), buffer)
    return rememberLittleSkin(name, `data:image/png;base64,${buffer.toString('base64')}`)
  } catch {
    return rememberLittleSkin(name, null)
  }
}

async function getLittleSkinDataUrl(name: string): Promise<string | null> {
  const memory = littleSkinCache.get(littleSkinKey(name))
  if (memory && Date.now() - memory.at < MEMORY_TTL) return memory.dataUrl
  const cached = await readLittleSkinCache(name)
  if (cached) return cached
  return fetchLittleSkin(name)
}

interface FallbackSkin {
  source: 'mojang' | 'littleskin'
  id: string
}

// 公开的默认/知名皮肤，用于玩家没有自己的皮肤时的兜底；
// 选择由玩家名和 UUID 稳定决定，刷新不会跳变。
const FALLBACK_SKINS: FallbackSkin[] = [
  { source: 'mojang', id: 'c06f89064c8a49119c29ea1dbd1aab82' }, // MHF_Steve
  { source: 'mojang', id: '6ab4317889fd490597f60f67d9d76fd9' }, // MHF_Alex
  { source: 'mojang', id: '853c80ef3c3749fdaa49938b674adae6' }, // jeb_
  { source: 'mojang', id: 'e6b5c088068044df9e1b9bf11792291b' }, // Grumm
  { source: 'littleskin', id: 'Grumm' },
  { source: 'littleskin', id: 'Herobrine' }
]

async function fallbackSkinDataUrl(name: string, uuid: string): Promise<string | null> {
  const seed = createHash('sha1')
    .update(`${name.toLowerCase()}\u0000${uuid}`)
    .digest()
  const start = seed.readUInt32BE(0) % FALLBACK_SKINS.length
  for (let index = 0; index < FALLBACK_SKINS.length; index += 1) {
    const entry = FALLBACK_SKINS[(start + index) % FALLBACK_SKINS.length]
    const skin =
      entry.source === 'mojang'
        ? await getSkinDataUrl(entry.id)
        : await getLittleSkinDataUrl(entry.id)
    if (skin) return skin
  }
  return null
}

/**
 * 服务器玩家头像优先用 Mojang 公开皮肤；离线 UUID 或 Mojang 缺失时，
 * 再按玩家名到 LittleSkin 查询一次；两者都没有时，稳定挑选一个公开皮肤兜底。
 */
export async function getPlayerSkinDataUrl(
  rawName: unknown,
  rawUuid: unknown
): Promise<string | null> {
  const name = typeof rawName === 'string' ? rawName.trim().slice(0, 32) : ''
  const uuid =
    typeof rawUuid === 'string' ? rawUuid.replace(/-/g, '').toLowerCase() : ''
  if (UUID.test(uuid)) {
    const version = Number.parseInt(uuid[12], 16)
    // v3 是离线模式按名字生成的 UUID，Mojang 不会有对应档案。
    if (version !== 3) {
      const mojang = await getSkinDataUrl(uuid)
      if (mojang) return mojang
    }
  }
  if (validLittleSkinName(name)) {
    const littleSkin = await getLittleSkinDataUrl(name)
    if (littleSkin) return littleSkin
  }
  if (!name && !uuid) return null
  return fallbackSkinDataUrl(name, uuid)
}
