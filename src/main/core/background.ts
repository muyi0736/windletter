import { dialog, protocol, type BrowserWindow, type OpenDialogOptions } from 'electron'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { getConfigDir } from './config'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'windletter-bg',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true
    }
  }
])

const BACKGROUND_DIR = 'backgrounds'
const MAX_BYTES = 40 * 1024 * 1024
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'])
const BACKGROUND_NAME = /^custom-[a-z0-9-]+\.(?:png|jpe?g|webp|gif|bmp|avif)$/i

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  avif: 'image/avif'
}

export function getBackgroundDir(): string {
  return join(getConfigDir(), BACKGROUND_DIR)
}

export async function pickCustomBackground(
  owner: BrowserWindow | null = null
): Promise<string | null> {
  const options: OpenDialogOptions = {
    title: '选择自定义背景',
    properties: ['openFile'],
    filters: [
      {
        name: '图片',
        extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif']
      }
    ]
  }
  const result = owner
    ? await dialog.showOpenDialog(owner, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || result.filePaths.length === 0) return null

  const source = result.filePaths[0]
  const ext = extname(source).replace(/^\./, '').toLowerCase()
  if (!IMAGE_EXTENSIONS.has(ext)) throw new Error('不支持的图片格式')
  const stat = await fs.stat(source)
  if (stat.size > MAX_BYTES) throw new Error('图片不能超过 40 MB')

  const name = `custom-${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`
  const dir = getBackgroundDir()
  await fs.mkdir(dir, { recursive: true })
  await fs.copyFile(source, join(dir, name))
  return name
}

export async function pruneBackgrounds(keep: string | null): Promise<void> {
  const dir = getBackgroundDir()
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && BACKGROUND_NAME.test(entry.name))
      .filter((entry) => entry.name !== keep)
      .map((entry) => fs.rm(join(dir, entry.name), { force: true }).catch(() => undefined))
  )
}

export async function registerBackgroundProtocol(): Promise<void> {
  await protocol.handle('windletter-bg', async (request) => {
    try {
      const url = new URL(request.url)
      if (url.hostname !== 'background') {
        return new Response('Not Found', { status: 404 })
      }
      const name = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
      if (!BACKGROUND_NAME.test(name) || basename(name) !== name) {
        return new Response('Forbidden', { status: 403 })
      }
      const data = await fs.readFile(join(getBackgroundDir(), name))
      const ext = extname(name).replace(/^\./, '').toLowerCase()
      return new Response(data, {
        headers: {
          'Content-Type': MIME[ext] ?? 'application/octet-stream',
          'Cache-Control': 'public, max-age=31536000, immutable'
        }
      })
    } catch {
      return new Response('Not Found', { status: 404 })
    }
  })
}
