import type { AccentName, ThemeMode } from '@shared/types'

const THEME_VALUES: ThemeMode[] = ['light', 'dark', 'system']
const ACCENT_VALUES: AccentName[] = ['cyan', 'blue', 'green', 'orange', 'pink', 'violet', 'red', 'slate']

export function normalizeTheme(value: unknown): ThemeMode {
  return THEME_VALUES.includes(value as ThemeMode) ? (value as ThemeMode) : 'system'
}

export function normalizeAccent(value: unknown): AccentName {
  return ACCENT_VALUES.includes(value as AccentName) ? (value as AccentName) : 'cyan'
}

export function resolveDarkTheme(theme: ThemeMode | null | undefined): boolean {
  if (theme === 'dark') return true
  if (theme === 'light') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** Apply a theme to the document immediately, without waiting for the store/IPC round-trip. */
export function applyTheme(theme: ThemeMode | null | undefined): boolean {
  const mode = theme == null ? normalizeTheme(localStorage.getItem('ccl-theme')) : normalizeTheme(theme)
  const dark = resolveDarkTheme(mode)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  if (theme != null) localStorage.setItem('ccl-theme', mode)
  return dark
}

/** Apply an accent to the document immediately, without waiting for the store/IPC round-trip. */
export function applyAccent(accent: AccentName | null | undefined): AccentName {
  const next =
    accent == null ? normalizeAccent(localStorage.getItem('ccl-accent')) : normalizeAccent(accent)
  document.documentElement.dataset.accent = next
  if (accent != null) localStorage.setItem('ccl-accent', next)
  return next
}

export function customBackgroundUrl(name: string | null | undefined): string | null {
  return name ? `windletter-bg://background/${encodeURIComponent(name)}` : null
}
