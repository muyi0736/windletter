import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

const iconCache = new Map<string, string>()

let converting = 0
const conversionQueue: Array<() => void> = []

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      converting += 1
      task()
        .then(resolve, reject)
        .finally(() => {
          converting -= 1
          const next = conversionQueue.shift()
          if (next) next()
        })
    }
    if (converting < 2) run()
    else conversionQueue.push(run)
  })
}

function shrinkDataUrl(dataUrl: string): Promise<string> {
  return enqueue(
    () =>
      new Promise<string>((resolve, reject) => {
        const image = new Image()
        image.onload = () => {
          try {
            const scale = Math.min(
              1,
              64 / Math.max(image.naturalWidth || 1, image.naturalHeight || 1)
            )
            const canvas = document.createElement('canvas')
            canvas.width = Math.max(1, Math.round((image.naturalWidth || 1) * scale))
            canvas.height = Math.max(1, Math.round((image.naturalHeight || 1) * scale))
            const context = canvas.getContext('2d')
            if (!context) throw new Error('无法缩放图标')
            context.drawImage(image, 0, 0, canvas.width, canvas.height)
            resolve(canvas.toDataURL('image/png'))
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)))
          }
        }
        image.onerror = () => reject(new Error('图标解码失败'))
        image.src = dataUrl
      })
  )
}

/**
 * 远程图标统一走主进程缩到 64px；主进程不支持的格式（例如超大 WebP）
 * 由渲染端用 canvas 缩一次再缓存，避免浏览器长期保留原图解码后的内存。
 */
export function RemoteIcon({
  url,
  fallback = null
}: {
  url?: string | null
  fallback?: ReactNode
}) {
  const [src, setSrc] = useState<string | null>(() => (url ? iconCache.get(url) ?? null : null))

  useEffect(() => {
    if (!url) {
      setSrc(null)
      return
    }
    const cached = iconCache.get(url)
    if (cached) {
      setSrc(cached)
      return
    }
    let alive = true
    setSrc(null)
    window.ccl.app
      .icon(url)
      .then(async (data) => {
        if (!alive || !data) return
        const small =
          data.startsWith('data:image/png') || data.startsWith('data:image/jpeg')
            ? data
            : await shrinkDataUrl(data).catch(() => null)
        if (!alive || !small) return
        if (iconCache.size >= 400) iconCache.clear()
        iconCache.set(url, small)
        setSrc(small)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [url])

  if (!url || !src) return <>{fallback}</>
  return <img src={src} alt="" />
}
