import type { DownloadDetail, TaskParallelState } from '../../shared/types'

export interface TaskProgressInfo {
  stage: string
  percent: number
  detail: DownloadDetail
  parallel?: TaskParallelState
  message?: string
}

export type TaskProgress = (info: TaskProgressInfo) => void

export function emptyDetail(): DownloadDetail {
  return { current: 0, total: 0, bytesDone: 0, bytesTotal: 0, speed: 0 }
}

export function ratioPercent(detail: DownloadDetail): number {
  if (detail.bytesTotal > 0) return Math.min(1, detail.bytesDone / detail.bytesTotal)
  if (detail.total > 0) return Math.min(1, detail.current / detail.total)
  return 0
}
