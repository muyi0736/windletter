import { clipboard, ClipboardItem, nativeImage, protocol, shell } from 'electron'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { ScreenshotGallery, ScreenshotView } from '../../shared/types'
import { getCacheDir } from './config'
import { getInstance, getInstanceGameDir } from './instances'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'windletter-shot',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true
    }
  }
])

const SCREENSHOT_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp'])
const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp'
}
const INSTANCE_ID = /^[A-Za-z0-9._-]{1,80}$/
const MAX_THUMB_WIDTH = 520

function imageExtension(name: string): string {
  return extname(name).replace(/^\./, '').toLowerCase()
}

function validName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 255 &&
    !name.includes('\0') &&
    basename(name) === name &&
    SCREENSHOT_EXTENSIONS.has(imageExtension(name))
  )
}

async function screenshotDir(instanceId: string): Promise<{ name: string; dir: string }> {
  if (!INSTANCE_ID.test(instanceId)) throw new Error('无效的实例')
  const instance = await getInstance(instanceId)
  const gameDir = await getInstanceGameDir(instance.id)
  return { name: instance.name, dir: join(gameDir, 'screenshots') }
}

async function screenshotPath(
  instanceId: string,
  name: string
): Promise<{ dir: string; file: string }> {
  if (!validName(name)) throw new Error('无效的截图文件名')
  const { dir } = await screenshotDir(instanceId)
  return { dir, file: join(dir, name) }
}

function shotUrl(instanceId: string, name: string, version: number, thumb: boolean): string {
  return `windletter-shot://screenshot/${encodeURIComponent(instanceId)}/${encodeURIComponent(name)}?v=${version}${thumb ? '&thumb=1' : ''}`
}

export async function listScreenshots(instanceId: string): Promise<ScreenshotGallery> {
  const { name: instanceName, dir } = await screenshotDir(instanceId)
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return {
      instanceId,
      instanceName,
      directory: dir,
      exists: false,
      totalBytes: 0,
      screenshots: []
    }
  }
  const screenshots: ScreenshotView[] = []
  let totalBytes = 0
  for (const entry of entries) {
    if (!entry.isFile() || !validName(entry.name)) continue
    const file = join(dir, entry.name)
    try {
      const stat = await fs.stat(file)
      const version = Math.round(stat.mtimeMs)
      totalBytes += stat.size
      screenshots.push({
        id: entry.name,
        name: entry.name,
        sizeBytes: stat.size,
        modifiedAt: stat.mtimeMs,
        url: shotUrl(instanceId, entry.name, version, false),
        thumbUrl: shotUrl(instanceId, entry.name, version, true)
      })
    } catch {
      /* file disappeared while scanning */
    }
  }
  screenshots.sort((a, b) => b.modifiedAt - a.modifiedAt)
  return {
    instanceId,
    instanceName,
    directory: dir,
    exists: true,
    totalBytes,
    screenshots
  }
}

export async function removeScreenshot(instanceId: string, name: string): Promise<void> {
  const { file } = await screenshotPath(instanceId, name)
  await fs.access(file)
  await shell.trashItem(file)
}

export async function copyScreenshot(instanceId: string, name: string): Promise<void> {
  const { file } = await screenshotPath(instanceId, name)
  const image = nativeImage.createFromPath(file)
  if (image.isEmpty()) throw new Error('无法读取这张截图')
  const data = image.toPNG()
  const copy = new Uint8Array(data.byteLength)
  copy.set(data)
  await clipboard.write([
    new ClipboardItem({ 'image/png': new Blob([copy], { type: 'image/png' }) })
  ])
}

export async function openScreenshot(instanceId: string, name: string): Promise<void> {
  const { file } = await screenshotPath(instanceId, name)
  const error = await shell.openPath(file)
  if (error) throw new Error(error)
}

async function thumbnail(file: string): Promise<Buffer> {
  const stat = await fs.stat(file)
  const key = createHash('sha1')
    .update(`${file}:${stat.mtimeMs}:${stat.size}`)
    .digest('hex')
  const cacheDir = join(getCacheDir(), 'screenshots')
  const cacheFile = join(cacheDir, `${key}.jpg`)
  try {
    return await fs.readFile(cacheFile)
  } catch {
    /* generate below */
  }
  const image = nativeImage.createFromPath(file)
  if (image.isEmpty()) throw new Error('无法读取截图')
  const size = image.getSize()
  const resized =
    size.width > MAX_THUMB_WIDTH
      ? image.resize({ width: MAX_THUMB_WIDTH, quality: 'good' })
      : image
  const buffer = resized.toJPEG(82)
  await fs.mkdir(cacheDir, { recursive: true })
  await fs.writeFile(cacheFile, buffer)
  return buffer
}

export async function registerScreenshotProtocol(): Promise<void> {
  await protocol.handle('windletter-shot', async (request) => {
    try {
      const url = new URL(request.url)
      if (url.hostname !== 'screenshot') {
        return new Response('Not Found', { status: 404 })
      }
      const parts = url.pathname
        .split('/')
        .filter(Boolean)
        .map((part) => decodeURIComponent(part))
      if (parts.length !== 2) return new Response('Not Found', { status: 404 })
      const [instanceId, name] = parts
      const { file } = await screenshotPath(instanceId, name)
      if (url.searchParams.get('thumb') === '1') {
        const buffer = await thumbnail(file)
        return new Response(buffer, {
          headers: {
            'Content-Type': 'image/jpeg',
            'Cache-Control': 'public, max-age=31536000, immutable'
          }
        })
      }
      const data = await fs.readFile(file)
      return new Response(data, {
        headers: {
          'Content-Type': MIME[imageExtension(name)] ?? 'application/octet-stream',
          'Cache-Control': 'private, max-age=60'
        }
      })
    } catch {
      return new Response('Not Found', { status: 404 })
    }
  })
}
