import type { LauncherApi } from '../shared/types'

declare global {
  interface Window {
    ccl: LauncherApi
  }
}

export {}
