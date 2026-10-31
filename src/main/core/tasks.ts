import { randomUUID } from 'node:crypto'
import type { DownloadDetail, ManualModDownload, TaskState, TaskStatus } from '../../shared/types'
import { CancellationError } from './net'
import { emptyDetail, type TaskProgress } from './progress'

export interface StartTaskOptions {
  kind: 'install' | 'java' | 'modpack' | 'loader' | 'preset' | 'world' | 'instance' | 'serverPack'
  title: string
  versionId?: string
  projectId?: string
  instanceId?: string
  run: (context: {
    id: string
    signal: AbortSignal
    progress: TaskProgress
  }) => Promise<{
    instanceId?: string
    message?: string
    manualMods?: ManualModDownload[]
  } | void>
}

class TaskManager {
  private tasks = new Map<string, TaskState>()
  private controllers = new Map<string, AbortController>()
  private options = new Map<string, StartTaskOptions>()
  private paused = new Set<string>()
  private listener: ((task: TaskState) => void) | null = null

  setListener(listener: (task: TaskState) => void): void {
    this.listener = listener
  }

  list(): TaskState[] {
    return [...this.tasks.values()].sort((a, b) => b.createdAt - a.createdAt)
  }

  findRunning(kind: TaskState['kind'], versionId?: string): TaskState | null {
    for (const task of this.tasks.values()) {
      if (
        (task.status === 'running' || task.status === 'paused') &&
        task.kind === kind &&
        (!versionId || task.versionId === versionId)
      ) {
        return { ...task }
      }
    }
    return null
  }

  start(options: StartTaskOptions): TaskState {
    const id = randomUUID()
    const controller = new AbortController()
    const task: TaskState = {
      id,
      kind: options.kind,
      title: options.title,
      stage: '准备中',
      progress: 0,
      detail: emptyDetail(),
      status: 'running',
      versionId: options.versionId,
      projectId: options.projectId,
      instanceId: options.instanceId,
      createdAt: Date.now()
    }
    this.tasks.set(id, task)
    this.controllers.set(id, controller)
    this.options.set(id, options)
    this.emit(task)
    void this.execute(id, controller, options)
    return { ...task }
  }

  private async execute(
    id: string,
    controller: AbortController,
    options: StartTaskOptions
  ): Promise<void> {
    const progress: TaskProgress = (info) => {
      const task = this.tasks.get(id)
      if (!task || task.status !== 'running') return
      task.stage = info.stage
      task.progress = info.percent
      task.detail = { ...info.detail } satisfies DownloadDetail
      task.parallel = info.parallel
        ? {
            stage: info.parallel.stage,
            progress: info.parallel.progress,
            detail: { ...info.parallel.detail }
          }
        : undefined
      task.message = info.message
      this.emit(task)
    }
    try {
      const result = await options.run({ id, signal: controller.signal, progress })
      const task = this.tasks.get(id)
      if (!task) return
      if (result && typeof result === 'object') {
        if (typeof result.instanceId === 'string') task.instanceId = result.instanceId
        if (typeof result.message === 'string' && result.message.trim()) {
          task.message = result.message.trim()
        }
        if (Array.isArray(result.manualMods) && result.manualMods.length > 0) {
          task.manualMods = result.manualMods
        }
      }
      task.status = 'done'
      task.finishedAt = Date.now()
      task.stage = '完成'
      task.progress = 100
      task.detail.speed = 0
      task.parallel = undefined
      this.options.delete(id)
      this.emit(task)
    } catch (err) {
      const task = this.tasks.get(id)
      if (!task) return
      if (controller.signal.aborted || err instanceof CancellationError) {
        if (this.paused.has(id)) {
          task.status = 'paused'
          task.stage = '已暂停'
          task.message = '任务已暂停'
        } else {
          task.status = 'cancelled'
          task.finishedAt = Date.now()
          task.stage = '已取消'
          task.message = '任务已取消'
          this.options.delete(id)
        }
      } else {
        task.status = 'error'
        task.finishedAt = Date.now()
        task.stage = '失败'
        task.error = err instanceof Error ? err.message : String(err)
        task.message = task.error
        const manual = (err as { manualFiles?: unknown } | null)?.manualFiles
        if (Array.isArray(manual)) {
          task.manualFiles = manual as TaskState['manualFiles']
        }
        this.options.delete(id)
      }
      task.detail.speed = 0
      task.parallel = undefined
      this.emit(task)
    } finally {
      this.controllers.delete(id)
    }
  }

  cancel(id: string): void {
    const task = this.tasks.get(id)
    if (!task) return
    if (task.status === 'paused') {
      this.paused.delete(id)
      this.options.delete(id)
      this.controllers.delete(id)
      task.status = 'cancelled'
      task.finishedAt = Date.now()
      task.stage = '已取消'
      task.message = '任务已取消'
      task.parallel = undefined
      this.emit(task)
      return
    }
    if (task.status !== 'running') return
    this.paused.delete(id)
    this.controllers.get(id)?.abort()
    task.stage = '正在取消…'
    this.emit(task)
  }

  pause(id: string): void {
    const task = this.tasks.get(id)
    if (!task || task.status !== 'running') return
    this.paused.add(id)
    this.controllers.get(id)?.abort()
    task.stage = '正在暂停…'
    this.emit(task)
  }

  resume(id: string): void {
    const task = this.tasks.get(id)
    const options = this.options.get(id)
    if (!task || task.status !== 'paused' || !options) return
    this.paused.delete(id)
    const controller = new AbortController()
    this.controllers.set(id, controller)
    task.status = 'running'
    task.stage = '继续中'
    task.error = undefined
    task.parallel = undefined
    task.message = undefined
    this.emit(task)
    void this.execute(id, controller, options)
  }

  private updateStatus(id: string, status: TaskStatus): void {
    const task = this.tasks.get(id)
    if (!task) return
    task.status = status
    this.emit(task)
  }

  private emit(task: TaskState): void {
    this.listener?.({
      ...task,
      detail: { ...task.detail },
      parallel: task.parallel
        ? { ...task.parallel, detail: { ...task.parallel.detail } }
        : undefined
    })
  }
}

export const taskManager = new TaskManager()
