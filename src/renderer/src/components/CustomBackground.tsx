import { useEffect, useState } from 'react'
import { customBackgroundUrls } from '../lib/appearance'

interface CustomBackgroundProps {
  images: string[]
  intervalSec: number
  dim: number
  blur: number
}

export function CustomBackground({ images, intervalSec, dim, blur }: CustomBackgroundProps) {
  const urls = customBackgroundUrls(images)
  const [frame, setFrame] = useState({ current: 0, previous: null as number | null, seq: 0 })

  useEffect(() => {
    if (urls.length < 2) return
    const timer = window.setInterval(
      () => {
        setFrame((value) => ({
          current: (value.current + 1) % urls.length,
          previous: value.current,
          seq: value.seq + 1
        }))
      },
      Math.max(5, intervalSec) * 1000
    )
    return () => window.clearInterval(timer)
  }, [intervalSec, urls.length])

  if (urls.length === 0) return null

  const currentUrl = urls[frame.current] ?? urls[0]
  const previousUrl = frame.previous === null ? null : urls[frame.previous] ?? null

  return (
    <>
      <div
        className="custom-background-stack"
        style={{ filter: blur > 0 ? `blur(${blur}px)` : undefined }}
        aria-hidden="true"
      >
        {previousUrl && (
          <div
            className="custom-background-layer"
            style={{ backgroundImage: `url("${previousUrl}")` }}
          />
        )}
        <div
          key={frame.seq}
          className="custom-background-layer is-current"
          style={{ backgroundImage: `url("${currentUrl}")` }}
        />
      </div>
      <div
        className="custom-background-veil"
        style={{ opacity: Math.max(0, Math.min(80, dim)) / 100 }}
        aria-hidden="true"
      />
    </>
  )
}
