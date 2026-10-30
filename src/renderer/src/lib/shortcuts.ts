import { useEffect } from 'react'

export interface ShortcutHandlers {
  onLaunch?: () => void
  onInstances?: () => void
  onDownloads?: () => void
  onSettings?: () => void
  onConsole?: () => void
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName.toLowerCase()
  return (
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select' ||
    target.isContentEditable ||
    target.closest('[contenteditable="true"]') !== null
  )
}

export function useShortcuts(handlers: ShortcutHandlers): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.metaKey) return
      if (isTypingTarget(event.target)) return
      const key = event.key.toLowerCase()

      if (key === 'l') {
        event.preventDefault()
        handlers.onLaunch?.()
      } else if (key === 'i') {
        event.preventDefault()
        handlers.onInstances?.()
      } else if (key === 'd') {
        event.preventDefault()
        handlers.onDownloads?.()
      } else if (key === ',') {
        event.preventDefault()
        handlers.onSettings?.()
      } else if (key === '`') {
        event.preventDefault()
        handlers.onConsole?.()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handlers])
}
