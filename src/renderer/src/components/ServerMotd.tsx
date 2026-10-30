import type { CSSProperties, ReactNode } from 'react'

// 服务器 MOTD 有两套读法：弹窗里的深色状态屏，以及详情里的浅色纸面板。
const DARK_COLORS: Record<string, string> = {
  '0': '#80857d',
  '1': '#809bff',
  '2': '#75c984',
  '3': '#5fd1d1',
  '4': '#ff8a80',
  '5': '#d7a2ff',
  '6': '#ffc857',
  '7': '#c3c6be',
  '8': '#959a91',
  '9': '#9db8ff',
  a: '#8eea9a',
  b: '#a1f4f4',
  c: '#ffb3ab',
  d: '#f0b6ff',
  e: '#fff3a3',
  f: '#f3f0e6'
}

// 浅色纸面上的 Minecraft 原色需要压暗；白字在这里变成深墨色。
const LIGHT_COLORS: Record<string, string> = {
  '0': '#62675f',
  '1': '#2e4a9e',
  '2': '#2e6b39',
  '3': '#0f6b6b',
  '4': '#9e2f2b',
  '5': '#6b2f80',
  '6': '#8a5a00',
  '7': '#5f645c',
  '8': '#7b8077',
  '9': '#2f5aa8',
  a: '#2f7d3a',
  b: '#0e7b7b',
  c: '#b33a32',
  d: '#8e4ca8',
  e: '#8a6a00',
  f: '#2c2b26'
}

type MotdTone = 'dark' | 'light'

function luminanceOf(r: number, g: number, b: number): number {
  return (
    0.2126 * linear(r / 255) + 0.7152 * linear(g / 255) + 0.0722 * linear(b / 255)
  )
}

function readableHexOnDark(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16)
  const r = (value >> 16) & 255
  const g = (value >> 8) & 255
  const b = value & 255
  if (luminanceOf(r, g, b) >= 0.22) return hex
  const mix = 0.35
  const lift = (channel: number): number => Math.round(channel + (255 - channel) * mix)
  return `#${[lift(r), lift(g), lift(b)].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

function readableHexOnLight(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16)
  const r = (value >> 16) & 255
  const g = (value >> 8) & 255
  const b = value & 255
  const luminance = luminanceOf(r, g, b)
  const target = 0.3
  if (luminance <= target) return hex
  // 浅纸面上把过亮的自定义颜色往墨色压，保留色相但保证对比度。
  const mix = Math.min(0.72, (luminance - target) / Math.max(0.05, luminance))
  const lower = (channel: number): number => Math.round(channel * (1 - mix))
  return `#${[lower(r), lower(g), lower(b)]
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`
}

function readableHex(hex: string, tone: MotdTone): string {
  return tone === 'light' ? readableHexOnLight(hex) : readableHexOnDark(hex)
}

function linear(channel: number): number {
  return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4)
}

interface MotdStyle {
  color?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
}

function styleOf(style: MotdStyle): CSSProperties {
  const decorations = [
    style.underline ? 'underline' : '',
    style.strike ? 'line-through' : ''
  ].filter(Boolean)
  return {
    color: style.color,
    fontWeight: style.bold ? 700 : undefined,
    fontStyle: style.italic ? 'italic' : undefined,
    textDecoration: decorations.length ? decorations.join(' ') : undefined
  }
}

function parseMotd(text: string, tone: MotdTone): ReactNode[] {
  const palette = tone === 'light' ? LIGHT_COLORS : DARK_COLORS
  const nodes: ReactNode[] = []
  let buffer = ''
  let style: MotdStyle = {}
  let key = 0
  let line = 1

  const flush = (): void => {
    if (!buffer) return
    nodes.push(
      <span key={`motd-${key++}`} style={styleOf(style)}>
        {buffer}
      </span>
    )
    buffer = ''
  }

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '\n') {
      flush()
      if (line >= 4) break
      nodes.push(<br key={`break-${key++}`} />)
      line += 1
      continue
    }
    if (char !== '§' || index + 1 >= text.length) {
      buffer += char
      continue
    }
    const code = text[index + 1].toLowerCase()
    if (palette[code]) {
      flush()
      style = { color: palette[code] }
      index += 1
      continue
    }
    if (code === 'l' || code === 'o' || code === 'n' || code === 'm') {
      flush()
      style = {
        ...style,
        bold: code === 'l' ? true : style.bold,
        italic: code === 'o' ? true : style.italic,
        underline: code === 'n' ? true : style.underline,
        strike: code === 'm' ? true : style.strike
      }
      index += 1
      continue
    }
    if (code === 'r') {
      flush()
      style = {}
      index += 1
      continue
    }
    if (code === 'x') {
      const chars: string[] = []
      let cursor = index + 2
      for (let part = 0; part < 6; part += 1) {
        if (text[cursor] !== '§' || cursor + 1 >= text.length) break
        chars.push(text[cursor + 1])
        cursor += 2
      }
      if (chars.length === 6 && /^[0-9a-f]{6}$/i.test(chars.join(''))) {
        flush()
        style = { color: readableHex(`#${chars.join('')}`, tone) }
        index = cursor - 1
        continue
      }
    }
    // §k（乱序）等不支持的效果只跳过格式码，保留后面的文字。
    index += 1
  }
  flush()
  return nodes
}

export function motdToPlainText(value: string): string {
  let output = ''
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (char !== '§' || index + 1 >= value.length) {
      output += char
      continue
    }
    const code = value[index + 1].toLowerCase()
    if (code === 'x') {
      index += 1
      for (let part = 0; part < 6; part += 1) {
        if (value[index + 1] === '§' && index + 2 < value.length) index += 2
        else break
      }
      continue
    }
    index += 1
  }
  return output
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function ServerMotd({
  text,
  className = '',
  tone = 'dark'
}: {
  text: string
  className?: string
  tone?: MotdTone
}) {
  const clean = text.replace(/\r/g, '')
  if (!clean.trim()) {
    return (
      <div className={`server-motd server-motd--${tone} ${className}`}>暂无 MOTD</div>
    )
  }
  return (
    <div className={`server-motd server-motd--${tone} ${className}`}>
      {parseMotd(clean, tone)}
    </div>
  )
}
