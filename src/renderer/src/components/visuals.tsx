import { useEffect, useId, useState } from 'react'
import type { InstalledVersion } from '@shared/types'
import { hashString, loaderKind } from '../lib/format'

interface Palette {
  top: string
  left: string
  right: string
  tint: string
  mark: string
}

const PALETTES: Record<string, Palette> = {
  release: { top: '#dce5de', left: '#94afa4', right: '#648276', tint: 'rgba(100, 130, 118, 0.10)', mark: '#45685c' },
  snapshot: { top: '#e6ddca', left: '#c2ad82', right: '#967f57', tint: 'rgba(150, 127, 87, 0.10)', mark: '#75603d' },
  old: { top: '#dfdae6', left: '#aaa2b8', right: '#7c748d', tint: 'rgba(124, 116, 141, 0.10)', mark: '#5f586e' },
  fabric: { top: '#d8e4e8', left: '#8fb4bf', right: '#628b98', tint: 'rgba(98, 139, 152, 0.10)', mark: '#476d79' },
  forge: { top: '#e7d9c9', left: '#c09c79', right: '#8f6c4c', tint: 'rgba(143, 108, 76, 0.10)', mark: '#6f5238' },
  neoforge: { top: '#e6d4c8', left: '#c08f72', right: '#92644b', tint: 'rgba(146, 100, 75, 0.10)', mark: '#714a36' },
  quilt: { top: '#e4dbe9', left: '#b4a2c2', right: '#847491', tint: 'rgba(132, 116, 145, 0.10)', mark: '#65566f' },
  optifine: { top: '#dce5d6', left: '#9db68e', right: '#708a62', tint: 'rgba(112, 138, 98, 0.10)', mark: '#526a47' },
  liteloader: { top: '#dfe2e4', left: '#acb2b7', right: '#7f868c', tint: 'rgba(127, 134, 140, 0.10)', mark: '#61686e' }
}

function paletteFor(kind: string | null | undefined, loader: string | null | undefined): Palette {
  const key = loaderKind(loader)
  if (key && PALETTES[key]) return PALETTES[key]
  return PALETTES[kind ?? 'release'] ?? PALETTES.release
}

const LOADER_MARKS: Record<string, string> = {
  fabric: 'F',
  forge: 'Fg',
  neoforge: 'N',
  quilt: 'Q',
  optifine: 'O',
  liteloader: 'L'
}

export function BlockIcon({
  version,
  type,
  loader,
  size = 48,
  className = ''
}: {
  version?: Pick<InstalledVersion, 'type' | 'loader'> | null
  type?: string | null
  loader?: string | null
  size?: number
  className?: string
}) {
  const kind =
    type ??
    (version?.type === 'snapshot' ? 'snapshot' : version?.type === 'old_beta' || version?.type === 'old_alpha' ? 'old' : 'release')
  const resolvedLoader = loader ?? version?.loader ?? null
  const palette = paletteFor(kind, resolvedLoader)
  const mark = LOADER_MARKS[loaderKind(resolvedLoader)]
  const uid = useId().replace(/:/g, '')
  const cubeGradient = `cube-${uid}`
  const topGradient = `cube-top-${uid}`

  return (
    <div
      className={`block-icon ${className}`}
      style={{ width: size, height: size, background: palette.tint }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 64 64" width={size * 0.76} height={size * 0.76}>
        <defs>
          <linearGradient id={cubeGradient} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={palette.left} />
            <stop offset="100%" stopColor={palette.right} />
          </linearGradient>
          <linearGradient id={topGradient} x1="0" y1="0" x2="0.6" y2="1">
            <stop offset="0%" stopColor={palette.top} />
            <stop offset="100%" stopColor={palette.left} />
          </linearGradient>
        </defs>
        <path d="M32 6 57 20 32 34 7 20Z" fill={`url(#${topGradient})`} />
        <path d="M7 20 32 34v23L7 43Z" fill={palette.left} />
        <path d="M57 20 32 34v23l25-14Z" fill={palette.right} />
        <path d="M32 27.3 48.3 18 32 8.7 15.7 18Z" fill="rgba(255,255,255,0.17)" />
        <path d="M32 25.5 48.3 16.2 32 6.9 15.7 16.2Z" fill="rgba(255,255,255,0.12)" />
        <path d="M12.5 26.5 18 29.6v5.2L12.5 31.7Z" fill="rgba(255,255,255,0.13)" />
        <path d="M32 34 57 20v6L32 40Z" fill="rgba(0,0,0,0.06)" />
      </svg>
      {mark && size >= 38 && (
        <span className="block-icon-mark" style={{ color: palette.mark }}>
          {mark}
        </span>
      )}
    </div>
  )
}

function useSkin(uuid: string | null | undefined, enabled: boolean): string | null {
  const [skin, setSkin] = useState<string | null>(null)
  useEffect(() => {
    const clean = uuid?.replace(/-/g, '') ?? ''
    setSkin(null)
    if (!enabled || !/^[0-9a-f]{32}$/i.test(clean)) return
    let alive = true
    window.ccl.auth
      .skin(clean)
      .then((url) => {
        if (alive) setSkin(url)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [uuid, enabled])
  return skin
}

function SkinAvatar({
  skin,
  name,
  size,
  className
}: {
  skin: string
  name: string
  size: number
  className: string
}) {
  const layer = (offsetX: number) => ({
    backgroundImage: `url("${skin}")`,
    backgroundSize: `${size * 8}px ${size * 8}px`,
    backgroundPosition: `-${offsetX}px -${size}px`
  })
  return (
    <div
      className={`avatar avatar--skin ${className}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${name} 的皮肤头像`}
    >
      <span className="skin-face skin-face--head" style={layer(size)} />
      <span className="skin-face skin-face--hat" style={layer(size * 5)} />
    </div>
  )
}

interface PixelPalette {
  bg: string
  skin: string
  shade: string
  hair: string
  eye: string
  mouth: string
  accent: string
}

const PIXEL_PALETTES: PixelPalette[] = [
  { bg: '#d9c9ad', skin: '#f0c69d', shade: '#d6a27a', hair: '#3b2a20', eye: '#2e4034', mouth: '#9a5346', accent: '#728f72' },
  { bg: '#cfd8cd', skin: '#e6b98f', shade: '#c9976d', hair: '#6b432b', eye: '#31465b', mouth: '#8f4b40', accent: '#8b6fa8' },
  { bg: '#d8cfc2', skin: '#c68d63', shade: '#a56f4c', hair: '#241f1b', eye: '#2f3c46', mouth: '#753e35', accent: '#b06a4f' },
  { bg: '#cdd6dc', skin: '#8f5b3d', shade: '#744630', hair: '#161413', eye: '#1e2b33', mouth: '#5f2f29', accent: '#7b9a9c' },
  { bg: '#e0d3b8', skin: '#f3d3b3', shade: '#d9b08e', hair: '#c79a55', eye: '#3a5568', mouth: '#b06a5a', accent: '#a58d5c' },
  { bg: '#d5c8d8', skin: '#dca87b', shade: '#c1885f', hair: '#5a3b5e', eye: '#3d2f45', mouth: '#8e4a44', accent: '#b59ac9' },
  { bg: '#c9d4c4', skin: '#b97950', shade: '#9a5f3d', hair: '#3a2a21', eye: '#344b3a', mouth: '#6f3a31', accent: '#7f9e7d' },
  { bg: '#ded4c6', skin: '#f0c9a6', shade: '#d5a67f', hair: '#8a5a3c', eye: '#4a5a43', mouth: '#a35c4c', accent: '#a7a37a' }
]

function PixelAvatar({
  name,
  seed,
  size,
  className
}: {
  name: string
  seed?: string | null
  size: number
  className: string
}) {
  const hash = hashString(seed || name || 'cyan')
  const palette = PIXEL_PALETTES[hash % PIXEL_PALETTES.length]
  let state = (hash || 1) >>> 0
  const random = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
  const hairStyle = Math.floor(random() * 4)
  const accessory = Math.floor(random() * 5)

  return (
    <div
      className={`avatar avatar--pixel ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 12 12"
        width={size}
        height={size}
        shapeRendering="crispEdges"
      >
        <rect width="12" height="12" fill={palette.bg} />
        <path
          d="M0 9 L12 4 L12 12 L0 12Z"
          fill={palette.accent}
          opacity="0.14"
        />
        <rect x="5" y="9" width="2" height="2" fill={palette.shade} />
        <rect x="3" y="10" width="6" height="2" fill={palette.accent} />
        <rect x="1" y="5" width="1" height="2" fill={palette.skin} />
        <rect x="10" y="5" width="1" height="2" fill={palette.skin} />
        <rect x="2" y="2" width="8" height="8" fill={palette.skin} />
        <rect x="2" y="9" width="8" height="1" fill={palette.shade} opacity="0.22" />

        {hairStyle === 0 && (
          <>
            <rect x="2" y="1" width="8" height="3" fill={palette.hair} />
            <rect x="2" y="4" width="1" height="4" fill={palette.hair} />
            <rect x="9" y="4" width="1" height="3" fill={palette.hair} />
          </>
        )}
        {hairStyle === 1 && (
          <>
            <rect x="2" y="1" width="8" height="2" fill={palette.hair} />
            <rect x="2" y="3" width="4" height="1" fill={palette.hair} />
            <rect x="2" y="3" width="1" height="5" fill={palette.hair} />
            <rect x="9" y="3" width="1" height="3" fill={palette.hair} />
          </>
        )}
        {hairStyle === 2 && (
          <>
            <rect x="2" y="1" width="8" height="3" fill={palette.hair} />
            <rect x="2" y="3" width="1" height="7" fill={palette.hair} />
            <rect x="9" y="3" width="1" height="7" fill={palette.hair} />
            <rect x="1" y="6" width="1" height="3" fill={palette.hair} />
            <rect x="10" y="6" width="1" height="3" fill={palette.hair} />
          </>
        )}
        {hairStyle === 3 && (
          <>
            <rect x="2" y="1" width="8" height="3" fill={palette.hair} />
            <rect x="2" y="3" width="8" height="1" fill={palette.hair} />
            <rect x="2" y="4" width="1" height="2" fill={palette.hair} />
            <rect x="9" y="4" width="1" height="2" fill={palette.hair} />
          </>
        )}

        <rect x="3" y="4" width="2" height="1" fill={palette.hair} />
        <rect x="7" y="4" width="2" height="1" fill={palette.hair} />
        <rect x="4" y="5" width="1" height="2" fill={palette.eye} />
        <rect x="7" y="5" width="1" height="2" fill={palette.eye} />
        <rect x="6" y="6" width="1" height="2" fill={palette.shade} opacity="0.7" />
        <rect x="5" y="8" width="2" height="1" fill={palette.mouth} />
        <rect x="3" y="7" width="1" height="1" fill={palette.accent} opacity="0.5" />
        <rect x="8" y="7" width="1" height="1" fill={palette.accent} opacity="0.5" />

        {accessory === 1 && (
          <g fill="none" stroke={palette.eye} strokeWidth="0.65">
            <rect x="3.2" y="4.5" width="2.2" height="2.3" rx="0.4" />
            <rect x="6.6" y="4.5" width="2.2" height="2.3" rx="0.4" />
            <path d="M5.4 5.6h1.2" />
          </g>
        )}
        {accessory === 2 && (
          <g fill={palette.accent}>
            <rect x="1" y="4" width="1" height="3" />
            <rect x="10" y="4" width="1" height="3" />
            <rect x="2" y="1" width="8" height="1" />
          </g>
        )}
        {accessory === 3 && (
          <g fill={palette.accent}>
            <rect x="2" y="0" width="8" height="2" />
            <rect x="1" y="2" width="10" height="1" opacity="0.8" />
          </g>
        )}
        {accessory === 4 && (
          <g fill={palette.accent}>
            <rect x="3" y="10" width="6" height="2" />
            <rect x="4" y="9" width="4" height="1" opacity="0.65" />
          </g>
        )}
      </svg>
    </div>
  )
}

export function Avatar({
  name,
  seed,
  size = 38,
  className = '',
  uuid,
  type
}: {
  name: string
  seed?: string | null
  size?: number
  className?: string
  uuid?: string | null
  type?: string | null
}) {
  const skin = useSkin(uuid ?? seed, type === 'microsoft')
  if (skin) return <SkinAvatar skin={skin} name={name} size={size} className={className} />
  return (
    <PixelAvatar
      name={name}
      seed={seed}
      size={size}
      className={className}
    />
  )
}

export function PlayerAvatar({
  name,
  uuid,
  size = 26,
  className = ''
}: {
  name: string
  uuid?: string | null
  size?: number
  className?: string
}) {
  const [skin, setSkin] = useState<string | null>(null)
  useEffect(() => {
    setSkin(null)
    if (!name) return
    let alive = true
    window.ccl.servers
      .playerSkin(name, uuid ?? null)
      .then((url) => {
        if (alive) setSkin(url)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [name, uuid])
  if (skin) return <SkinAvatar skin={skin} name={name} size={size} className={className} />
  return <PixelAvatar name={name} seed={uuid ?? name} size={size} className={className} />
}

export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg className="brand-logo" width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <rect width="40" height="40" rx="8" fill="#1a1d19" />
      <rect
        x="0.5"
        y="0.5"
        width="39"
        height="39"
        rx="7.5"
        fill="none"
        stroke="rgba(244,240,230,0.14)"
        strokeWidth="0.6"
      />
      <circle cx="21" cy="20.5" r="11" fill="#f4f0e6" />
      <circle cx="25.2" cy="16.2" r="10.2" fill="#1a1d19" />
      <path
        d="M7.5 29c5-2.4 9.5-1.3 13.2 1.2s7.6 2 11.8-1.4"
        fill="none"
        stroke="#7fb9aa"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M11 34c3.5-1.5 6.4-.8 9 .7"
        fill="none"
        stroke="#f4f0e6"
        strokeOpacity="0.32"
        strokeWidth="0.8"
        strokeLinecap="round"
      />
      <circle cx="31.6" cy="9.8" r="1.25" fill="#c98a63" />
    </svg>
  )
}

export function HeroArt() {
  const uid = useId().replace(/:/g, '')
  return (
    <div className="hero-art" aria-hidden="true">
      <svg viewBox="0 0 480 380" width="100%" height="100%">
        <defs>
          <linearGradient id={`hero-top-${uid}`} x1="0" y1="0" x2="0.7" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.82" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.5" />
          </linearGradient>
          <linearGradient id={`hero-left-${uid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.9" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.58" />
          </linearGradient>
          <linearGradient id={`hero-right-${uid}`} x1="0" y1="0" x2="0.6" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.55" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.24" />
          </linearGradient>
          <radialGradient id={`hero-glow-${uid}`}>
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.36" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </radialGradient>
          <filter id={`hero-blur-${uid}`} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="14" />
          </filter>
        </defs>

        <circle cx="300" cy="205" r="160" fill={`url(#hero-glow-${uid})`} />
        <circle cx="350" cy="150" r="110" fill={`url(#hero-glow-${uid})`} opacity="0.5" />

        <g className="hero-orbit" opacity="0.55">
          <ellipse cx="278" cy="204" rx="192" ry="77" transform="rotate(-16 278 204)" />
          <circle cx="102" cy="148" r="4" fill="var(--accent)" opacity="0.65" />
          <circle cx="435" cy="264" r="3" fill="var(--accent)" opacity="0.5" />
        </g>

        <g className="hero-cloud" opacity="0.5">
          <rect x="70" y="83" width="58" height="16" rx="8" />
          <rect x="91" y="70" width="42" height="16" rx="8" />
          <rect x="352" y="55" width="72" height="15" rx="7.5" opacity="0.7" />
          <rect x="376" y="44" width="40" height="14" rx="7" opacity="0.7" />
        </g>

        <g className="hero-island hero-island--main">
          <path
            d="M318 124 424 183v6l-106 59-106-59v-6Z"
            fill={`url(#hero-top-${uid})`}
          />
          <path d="M212 183 318 242v82l-106-59Z" fill={`url(#hero-left-${uid})`} />
          <path d="M424 183 318 242v82l106-59Z" fill={`url(#hero-right-${uid})`} />
          <path d="M318 144 392 185 318 226 244 185Z" fill="rgba(255,255,255,0.1)" />
          <g className="hero-trees">
            <path d="M282 155 296 148l14 8-14 8Z" fill="rgba(255,255,255,0.34)" />
            <path d="M296 163v19l-14-8v-19Z" fill="rgba(23,42,54,0.24)" />
            <path d="M296 163v19l14-8v-19Z" fill="rgba(23,42,54,0.14)" />
            <path d="M340 137 351 132l11 6-11 6Z" fill="rgba(255,255,255,0.26)" />
            <path d="M351 143v15l-11-6v-15Z" fill="rgba(23,42,54,0.2)" />
            <path d="M351 143v15l11-6v-15Z" fill="rgba(23,42,54,0.12)" />
          </g>
          <g opacity="0.4" stroke="rgba(255,255,255,0.6)" strokeWidth="1">
            <path d="M244 209l30 17M392 209l-30 17" />
          </g>
        </g>

        <g className="hero-island hero-island--small">
          <path d="M128 256 178 284v3l-50 28-50-28v-3Z" fill={`url(#hero-top-${uid})`} opacity="0.85" />
          <path d="M78 284 128 312v38l-50-28Z" fill={`url(#hero-left-${uid})`} opacity="0.7" />
          <path d="M178 284 128 312v38l50-28Z" fill={`url(#hero-right-${uid})`} opacity="0.55" />
          <path d="M128 270 155 285 128 300 101 285Z" fill="rgba(255,255,255,0.12)" />
        </g>

        <g className="hero-island hero-island--tiny">
          <path d="M392 281 423 298v2l-31 17-31-17v-2Z" fill={`url(#hero-top-${uid})`} opacity="0.7" />
          <path d="M361 298 392 315v23l-31-17Z" fill={`url(#hero-left-${uid})`} opacity="0.58" />
          <path d="M423 298 392 315v23l31-17Z" fill={`url(#hero-right-${uid})`} opacity="0.44" />
        </g>

        <g className="hero-sparks" fill="var(--accent)">
          <path d="M158 104l3 8 8 3-8 3-3 8-3-8-8-3 8-3Z" opacity="0.7" />
          <path d="M403 128l2 6 6 2-6 2-2 6-2-6-6-2 6-2Z" opacity="0.5" />
          <circle cx="92" cy="201" r="2.6" opacity="0.5" />
          <circle cx="451" cy="205" r="2" opacity="0.4" />
          <circle cx="190" cy="75" r="2.2" opacity="0.35" />
          <circle cx="279" cy="330" r="2.4" opacity="0.45" />
          <circle cx="431" cy="349" r="1.8" opacity="0.35" />
        </g>
      </svg>
    </div>
  )
}

export function TextureDots() {
  return (
    <div className="texture-dots" aria-hidden="true">
      {Array.from({ length: 24 }, (_, index) => (
        <span key={index} style={{ animationDelay: `${(index % 7) * 0.4}s` }} />
      ))}
    </div>
  )
}
