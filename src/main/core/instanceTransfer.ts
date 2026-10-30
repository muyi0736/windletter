import { promises as fs } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'
import type { InstanceSummary, InstanceTransferRequest } from '../../shared/types'
import { getSettings } from './config'
import {
  getInstance,
  getInstanceMinecraftDir,
  getInstancesRoot,
  makeInstanceId,
  writeInstance
} from './instances'
import { CancellationError } from './net'
import type { TaskProgress } from './progress'
import { isRuleAllowed } from './rules'
import {
  mainArtifact,
  nativeArtifact,
  pathExists,
  resolveVersion,
  safeJoin
} from './version'
import { officialGameDir } from './versionFolders'

interface TransferFile {
  source: string
  target: string
  size: number
  link: boolean
}

export interface InstanceTransferResult {
  instanceId: string
  mode: 'move' | 'clone'
  name: string
  targetDir: string
  files: number
  bytes: number
  linkedBytes: number
  copiedBytes: number
  message: string
}

const VERSION_ID = /^[A-Za-z0-9._+\-]{1,128}$/
const LINK_CONTENT_ROOTS = new Set(['resourcepacks', 'shaderpacks'])

function within(parent: string, child: string): boolean {
  const root = resolve(parent).toLowerCase()
  const target = resolve(child).toLowerCase()
  return target === root || target.startsWith(root.endsWith(sep) ? root : root + sep)
}

function cleanName(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const name = value.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80)
  return name || fallback
}

function friendlyError(source: string, target: string): string {
  return `无法复制 ${source} → ${target}`
}

async function walkFiles(
  sourceRoot: string,
  targetRoot: string,
  options: {
    link: (rel: string) => boolean
    skipDir?: (name: string, rel: string) => boolean
    skipFile?: (name: string, rel: string) => boolean
    add: (file: TransferFile) => void
  }
): Promise<void> {
  async function walk(rel: string): Promise<void> {
    const sourceDir = rel ? join(sourceRoot, rel) : sourceRoot
    let entries
    try {
      entries = await fs.readdir(sourceDir, { withFileTypes: true })
    } catch {
      throw new Error(`无法读取源目录 ${sourceDir}`)
    }
    for (const entry of entries) {
      const childRel = rel ? join(rel, entry.name) : entry.name
      if (entry.isDirectory()) {
        if (options.skipDir?.(entry.name, childRel)) continue
        await walk(childRel)
      } else if (entry.isFile()) {
        if (options.skipFile?.(entry.name, childRel)) continue
        const source = join(sourceRoot, childRel)
        const target = join(targetRoot, childRel)
        let stat
        try {
          stat = await fs.stat(source)
        } catch {
          continue
        }
        options.add({
          source,
          target,
          size: stat.size,
          link: options.link(childRel)
        })
      }
    }
  }
  await walk('')
}

async function collectRuntime(
  sourceBase: string,
  targetBase: string,
  versionId: string,
  add: (file: TransferFile) => void
): Promise<void> {
  const version = await resolveVersion(sourceBase, versionId)
  for (const id of version.chain) {
    if (!VERSION_ID.test(id)) throw new Error('版本档案路径不安全，已取消')
    const source = join(sourceBase, 'versions', id)
    const target = join(targetBase, 'versions', id)
    if (!(await pathExists(source))) throw new Error(`源版本档案缺失：${id}`)
    // 只复制版本根目录里的 json/jar；natives 由启动器重新解压。
    // 外部实例的版本目录同时是游戏目录，不能把 mods/config/saves 一起复制进目标版本档案。
    for (const entry of await fs.readdir(source, { withFileTypes: true })) {
      if (!entry.isFile()) continue
      const file = join(source, entry.name)
      const stat = await fs.stat(file)
      add({ source: file, target: join(target, entry.name), size: stat.size, link: true })
    }
  }
  if (!VERSION_ID.test(version.jarId)) throw new Error('客户端 jar 名称不安全，已取消')
  const jarPath = join(sourceBase, 'versions', version.jarId, `${version.jarId}.jar`)
  if (!(await pathExists(jarPath))) {
    throw new Error(`源版本缺少客户端 jar：${version.jarId}.jar`)
  }

  const features = { is_demo_user: false, has_custom_resolution: false }
  for (const library of version.json.libraries ?? []) {
    if (!isRuleAllowed(library.rules, features)) continue
    for (const artifact of [mainArtifact(library), nativeArtifact(library)]) {
      if (!artifact?.path) continue
      const source = join(sourceBase, 'libraries', artifact.path)
      if (!(await pathExists(source))) {
        throw new Error(`源文件夹缺少运行库 ${artifact.path}，无法完整复制版本`)
      }
      const target = safeJoin(join(targetBase, 'libraries'), artifact.path)
      add({ source, target, size: (await fs.stat(source)).size, link: true })
    }
  }

  const indexId = version.json.assetIndex?.id ?? version.json.assets
  if (indexId) {
    if (!VERSION_ID.test(indexId)) throw new Error('资源索引名称不安全，已取消')
    const indexSource = join(sourceBase, 'assets', 'indexes', `${indexId}.json`)
    if (!(await pathExists(indexSource))) {
      throw new Error(`源文件夹缺少资源索引 ${indexId}.json，无法完整复制版本`)
    }
    const indexTarget = join(targetBase, 'assets', 'indexes', `${indexId}.json`)
    add({
      source: indexSource,
      target: indexTarget,
      size: (await fs.stat(indexSource)).size,
      link: true
    })
    let objects: Record<string, { hash?: string; size?: number }> = {}
    try {
      objects =
        (JSON.parse(await fs.readFile(indexSource, 'utf8')) as {
          objects?: Record<string, { hash?: string; size?: number }>
        }).objects ?? {}
    } catch {
      throw new Error(`资源索引 ${indexId}.json 已损坏`)
    }
    const missing: string[] = []
    for (const object of Object.values(objects)) {
      const hash = object?.hash
      if (typeof hash !== 'string' || !/^[a-f0-9]{40}$/i.test(hash)) continue
      const source = join(sourceBase, 'assets', 'objects', hash.slice(0, 2), hash)
      if (!(await pathExists(source))) {
        missing.push(hash)
        continue
      }
      const target = join(targetBase, 'assets', 'objects', hash.slice(0, 2), hash)
      add({ source, target, size: (await fs.stat(source)).size, link: true })
    }
    if (missing.length > 0) {
      throw new Error(
        `源文件夹缺少 ${missing.length} 个资源文件（如 ${missing[0].slice(0, 10)}…），请先在源文件夹补全版本`
      )
    }
  }

  const logFile = version.json.logging?.client?.file
  if (logFile?.id && VERSION_ID.test(logFile.id)) {
    const source = join(sourceBase, 'assets', 'log_configs', logFile.id)
    if (await pathExists(source)) {
      add({
        source,
        target: join(targetBase, 'assets', 'log_configs', logFile.id),
        size: (await fs.stat(source)).size,
        link: true
      })
    }
  }
}

async function copyJobs(
  jobs: TransferFile[],
  stage: string,
  progress: TaskProgress,
  signal: AbortSignal,
  created: string[]
): Promise<{
  bytes: number
  linkedBytes: number
  copiedBytes: number
}> {
  const totalBytes = jobs.reduce((sum, job) => sum + job.size, 0)
  const totalFiles = jobs.length
  let bytesDone = 0
  let filesDone = 0
  let linkedBytes = 0
  let copiedBytes = 0
  let lastEmit = 0
  const startedAt = Date.now()
  const emit = (force = false) => {
    const now = Date.now()
    if (!force && now - lastEmit < 120) return
    lastEmit = now
    const elapsed = Math.max(0.001, (now - startedAt) / 1000)
    progress({
      stage,
      percent: totalBytes > 0 ? Math.min(99, Math.floor((bytesDone / totalBytes) * 100)) : 99,
      detail: {
        current: filesDone,
        total: totalFiles,
        bytesDone,
        bytesTotal: totalBytes,
        speed: bytesDone / elapsed,
        activeFiles: [
          {
            label: totalFiles > 0 ? basename(jobs[Math.min(filesDone, totalFiles - 1)].source) : stage,
            bytes: bytesDone,
            size: totalBytes
          }
        ]
      }
    })
  }
  emit(true)
  for (const job of jobs) {
    if (signal.aborted) throw new CancellationError()
    try {
      await fs.mkdir(dirname(job.target), { recursive: true })
    } catch {
      throw new Error(`无法创建目标目录 ${dirname(job.target)}，请检查目标文件夹结构`)
    }
    if (!(await pathExists(job.target))) {
      let copied = false
      if (job.link) {
        try {
          await fs.link(job.source, job.target)
          linkedBytes += job.size
          copied = true
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code
          if (!['EXDEV', 'EPERM', 'EACCES', 'ENOTSUP', 'EINVAL', 'EMLINK'].includes(code ?? '')) {
            throw error
          }
        }
      }
      if (!copied) {
        try {
          await fs.copyFile(job.source, job.target)
          copiedBytes += job.size
          copied = true
        } catch (error) {
          await fs.rm(job.target, { force: true }).catch(() => undefined)
          throw new Error(friendlyError(job.source, job.target))
        }
      }
      if (copied) created.push(job.target)
    }
    bytesDone += job.size
    filesDone += 1
    emit()
  }
  emit(true)
  return { bytes: bytesDone, linkedBytes, copiedBytes }
}

export async function transferInstance(
  request: InstanceTransferRequest,
  progress: TaskProgress,
  signal: AbortSignal
): Promise<InstanceTransferResult> {
  const instance = await getInstance(request.instanceId)
  const mode = request.mode === 'move' ? 'move' : 'clone'
  if (mode === 'move' && instance.external) {
    throw new Error('外部实例不能迁移，只能克隆到受管目录')
  }
  const sourceBase = resolve(instance.external?.baseDir ?? instance.baseDir ?? getSettings().gameDir)
  const sourceContent = resolve(
    instance.external?.gameDir ?? getInstanceMinecraftDir(instance.id)
  )
  const targetDir = resolve(request.targetDir)
  if (!isAbsolute(targetDir)) throw new Error('目标文件夹必须是绝对路径')
  if (targetDir.toLowerCase() === resolve(officialGameDir()).toLowerCase()) {
    throw new Error('不能迁移或克隆到官方启动器文件夹')
  }
  if (mode === 'move' && targetDir.toLowerCase() === sourceBase.toLowerCase()) {
    throw new Error('目标文件夹与当前文件夹相同')
  }
  if (instance.external && within(instance.external.baseDir, targetDir)) {
    throw new Error('外部实例只能克隆到受管目录，不能写回外部文件夹')
  }
  if (within(sourceContent, targetDir)) {
    throw new Error('目标文件夹不能位于实例内容目录内')
  }

  const cloneName =
    mode === 'clone'
      ? cleanName(request.name, `${instance.name} 副本`)
      : instance.name
  let newId = instance.id
  let contentTarget = sourceContent
  if (mode === 'clone') {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      newId = makeInstanceId(cloneName)
      if (!(await pathExists(join(getInstancesRoot(), newId)))) break
    }
    if (await pathExists(join(getInstancesRoot(), newId))) {
      throw new Error('无法生成新的实例标识，请重试')
    }
    contentTarget = join(getInstancesRoot(), newId, 'minecraft')
  }

  progress({
    stage: '扫描文件',
    percent: 1,
    detail: { current: 0, total: 0, bytesDone: 0, bytesTotal: 0, speed: 0 }
  })

  const jobs: TransferFile[] = []
  const seen = new Set<string>()
  const add = (file: TransferFile) => {
    const key = resolve(file.target).toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    jobs.push(file)
  }

  if (mode === 'clone') {
    if (!(await pathExists(sourceContent))) {
      throw new Error('源实例内容目录不存在，无法克隆')
    }
    await walkFiles(sourceContent, contentTarget, {
      link: (rel) => {
        const parts = rel.split(sep)
        const top = (parts[0] ?? '').toLowerCase()
        const ext = (parts[parts.length - 1] ?? '').toLowerCase().split('.').pop()
        return (top === 'mods' && ext === 'jar') || LINK_CONTENT_ROOTS.has(top)
      },
      skipDir: (_name, rel) => {
        const top = rel.split(sep)[0]?.toLowerCase()
        return top === 'logs' || top === 'crash-reports'
      },
      add
    })
  }

  if (targetDir.toLowerCase() !== sourceBase.toLowerCase()) {
    await collectRuntime(sourceBase, targetDir, instance.versionId, add)
  }

  const totalBytes = jobs.reduce((sum, job) => sum + job.size, 0)
  progress({
    stage: mode === 'move' ? '准备迁移' : '准备克隆',
    percent: 2,
    detail: {
      current: 0,
      total: jobs.length,
      bytesDone: 0,
      bytesTotal: totalBytes,
      speed: 0
    }
  })

  const created: string[] = []
  let contentCreated = false
  let result: InstanceTransferResult
  try {
    if (mode === 'clone') {
      await fs.mkdir(contentTarget, { recursive: true })
      contentCreated = true
    }
    const copyResult = await copyJobs(
      jobs,
      mode === 'move' ? '迁移版本文件' : '复制实例与版本文件',
      progress,
      signal,
      created
    )
    if (mode === 'move') {
      await writeInstance({ ...instance, baseDir: targetDir })
    } else {
      const next: InstanceSummary = {
        ...instance,
        id: newId,
        name: cloneName,
        summary: instance.external
          ? `克隆自外部实例 ${instance.name}`
          : instance.summary,
        external: null,
        baseDir: targetDir,
        source: 'local',
        projectId: null,
        lastPlayed: null,
        installedAt: Date.now()
      }
      await writeInstance(next)
    }
    result = {
      instanceId: mode === 'move' ? instance.id : newId,
      mode,
      name: cloneName,
      targetDir,
      files: jobs.length,
      bytes: copyResult.bytes,
      linkedBytes: copyResult.linkedBytes,
      copiedBytes: copyResult.copiedBytes,
      message:
        mode === 'move'
          ? `已迁移到 ${basename(targetDir)}；源文件夹不会删除`
          : `已克隆为 ${cloneName}；模组优先硬链接，配置和存档独立复制`
    }
  } catch (error) {
    for (const file of [...created].reverse()) {
      await fs.rm(file, { force: true }).catch(() => undefined)
    }
    if (contentCreated) {
      await fs.rm(contentTarget, { recursive: true, force: true }).catch(() => undefined)
    }
    throw error
  }
  return result
}