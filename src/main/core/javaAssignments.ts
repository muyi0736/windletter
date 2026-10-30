import { promises as fs } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type {
  InstanceSummary,
  JavaAssignmentApply,
  JavaAssignmentView,
  JavaInfo
} from '../../shared/types'
import { getSettings } from './config'
import {
  chooseJava,
  detectJava,
  isJavaCompatible
} from './java'
import { listInstances, updateInstanceSettings } from './instances'

interface VersionJavaMeta {
  inheritsFrom?: string
  javaVersion?: { majorVersion?: number }
}

async function readRequiredJava(
  baseDir: string,
  versionId: string
): Promise<number | null> {
  let cursor: string | undefined = versionId
  const visited = new Set<string>()
  for (let depth = 0; cursor && depth < 8; depth += 1) {
    if (visited.has(cursor)) break
    visited.add(cursor)
    try {
      const raw = await fs.readFile(
        join(baseDir, 'versions', cursor, `${cursor}.json`),
        'utf8'
      )
      const json = JSON.parse(raw) as VersionJavaMeta
      const major = json.javaVersion?.majorVersion
      if (typeof major === 'number' && Number.isFinite(major)) return Math.round(major)
      cursor = json.inheritsFrom
    } catch {
      return null
    }
  }
  return null
}

function isStrictLoader(instance: InstanceSummary): boolean {
  return instance.loader === 'forge' || instance.loader === 'neoforge'
}

function javaCompatible(
  java: JavaInfo,
  required: number | null,
  strict: boolean
): boolean {
  if (!required) return java.major >= 8
  if (strict) return java.major === required
  return isJavaCompatible(java.major, required)
}

export async function buildJavaAssignments(): Promise<JavaAssignmentView[]> {
  const settings = getSettings()
  const javaList = await detectJava(settings.gameDir, settings.javaPath, true)
  const instances = await listInstances()
  return Promise.all(
    instances.map(async (instance) => {
      const baseDir = instance.external?.baseDir ?? instance.baseDir ?? settings.gameDir
      const requiredMajor = await readRequiredJava(baseDir, instance.versionId)
      const strict = isStrictLoader(instance)
      const manualPath = instance.javaPath?.trim() || null
      const manualJava = manualPath
        ? javaList.find((java) => java.path.toLowerCase() === manualPath.toLowerCase())
        : null

      if (manualPath) {
        if (!manualJava) {
          return {
            instanceId: instance.id,
            name: instance.name,
            gameVersion: instance.gameVersion,
            loader: instance.loader,
            requiredMajor,
            javaPath: manualPath,
            javaVersion: null,
            javaMajor: null,
            status: 'incompatible',
            message: '实例指定的 Java 不存在或无法运行'
          } satisfies JavaAssignmentView
        }
        const compatible = javaCompatible(manualJava, requiredMajor, strict)
        return {
          instanceId: instance.id,
          name: instance.name,
          gameVersion: instance.gameVersion,
          loader: instance.loader,
          requiredMajor,
          javaPath: manualJava.path,
          javaVersion: manualJava.version,
          javaMajor: manualJava.major,
          status: compatible ? 'manual' : 'incompatible',
          message: compatible
            ? '使用实例手动指定的 Java'
            : `手动指定的 Java ${manualJava.major} 不满足 Java ${requiredMajor} 要求`
        } satisfies JavaAssignmentView
      }

      if (!requiredMajor) {
        return {
          instanceId: instance.id,
          name: instance.name,
          gameVersion: instance.gameVersion,
          loader: instance.loader,
          requiredMajor: null,
          javaPath: null,
          javaVersion: null,
          javaMajor: null,
          status: 'missing',
          message: '无法从版本配置确定所需 Java'
        } satisfies JavaAssignmentView
      }

      let selected: JavaInfo | null = null
      try {
        selected = chooseJava(javaList, requiredMajor, null, strict)
      } catch {
        selected = null
      }
      if (!selected) {
        return {
          instanceId: instance.id,
          name: instance.name,
          gameVersion: instance.gameVersion,
          loader: instance.loader,
          requiredMajor,
          javaPath: null,
          javaVersion: null,
          javaMajor: null,
          status: 'missing',
          message: `未找到 Java ${requiredMajor}，启动时${settings.autoJava ? '会尝试自动下载' : '需要手动安装'}`
        } satisfies JavaAssignmentView
      }
      return {
        instanceId: instance.id,
        name: instance.name,
        gameVersion: instance.gameVersion,
        loader: instance.loader,
        requiredMajor,
        javaPath: selected.path,
        javaVersion: selected.version,
        javaMajor: selected.major,
        status: 'ready',
        message: null
      } satisfies JavaAssignmentView
    })
  )
}

export async function applyJavaAssignments(
  list: JavaAssignmentApply[]
): Promise<InstanceSummary[]> {
  const instances = await listInstances()
  const ids = new Set(instances.map((instance) => instance.id))
  for (const item of list.slice(0, 100)) {
    if (!ids.has(item.instanceId)) continue
    let path: string | null = null
    if (item.javaPath !== null) {
      if (
        typeof item.javaPath !== 'string' ||
        !item.javaPath.trim() ||
        item.javaPath.length > 1024 ||
        !isAbsolute(item.javaPath)
      ) {
        throw new Error('无效的 Java 路径')
      }
      path = item.javaPath.trim()
    }
    await updateInstanceSettings(item.instanceId, { javaPath: path })
  }
  return listInstances()
}
