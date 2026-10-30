import { useEffect, useState } from 'react'
import { Server } from 'lucide-react'

export function ServerFavicon({
  favicon,
  name,
  size = 46,
  className = ''
}: {
  favicon: string | null
  name: string
  size?: number
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setFailed(false)
  }, [favicon])

  if (favicon && !failed) {
    return (
      <img
        src={favicon}
        alt=""
        width={size}
        height={size}
        className={`server-favicon ${className}`}
        style={{ width: size, height: size }}
        draggable={false}
        onError={() => setFailed(true)}
      />
    )
  }

  const initial = name.trim().charAt(0).toUpperCase()
  return (
    <span
      className={`server-favicon server-favicon--fallback ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {initial ? <span>{initial}</span> : <Server size={Math.round(size * 0.42)} />}
    </span>
  )
}
