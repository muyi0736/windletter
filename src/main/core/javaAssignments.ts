import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type {
  InstanceSummary,
  JavaAssignmentView,
  JavaInfo
} from '../../shared/types'
import {
  availablePhysicalMemoryMb,
  computeAutoMemoryMb,
  totalPhysicalMemoryMb
} from './autoMemory'
import { getSettings } from './config'
import {
  chooseJava,
  detectJava,
  isJavaCompatible
} from './java'
import { getInstanceGameDir, listInstances } from './instances'

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

async function countEnabledMods(gameDir: string): Promise<number | null> {
  try {
    const entries = await fs.readdir(join(gameDir, 'mods'))
    return entries.filter((name) => name.toLowerCase().endsWith('.jar')).length
  } catch {
    return null
  }
}

export async function buildJavaAssignments(): Promise<JavaAssignmentView[]> {
  const settings = getSettings()
  const javaList = await detectJava(settings.gameDir, settings.javaPath, true)
  const instances = await listInstances()
  const availableMemoryMb = availablePhysicalMemoryMb()
  const totalMemoryMb = totalPhysicalMemoryMb()
  return Promise.all(
    instances.map(async (instance) => {
      const baseDir = instance.external?.baseDir ?? instance.baseDir ?? settings.gameDir
      const gameDir = await getInstanceGameDir(instance.id)
      const modCount = (await countEnabledMods(gameDir)) ?? instance.modCount
      const memoryAuto = instance.memoryAuto ?? instance.memoryMb == null
      const recommendedMemoryMb = computeAutoMemoryMb({
        modCount,
        loader: instance.loader,
        availableMb: availableMemoryMb,
        totalMb: totalMemoryMb
      })
      const currentMemoryMb = memoryAuto
        ? recommendedMemoryMb
        : instance.memoryMb ?? settings.maxMemoryMb
      const memoryMessage = memoryAuto
        ? availableMemoryMb < recommendedMemoryMb
          ? '按整合包规模分配；当前可用内存偏低，建议关闭其他程序'
          : '启动时按整合包规模和总内存计算'
        : currentMemoryMb < recommendedMemoryMb
          ? `手动内存低于自动估算的 ${recommendedMemoryMb} MB`
          : '保留实例手动内存'
      const memory = {
        currentMemoryMb,
        recommendedMemoryMb,
        availableMemoryMb,
        totalMemoryMb,
        memoryAuto,
        memoryMessage
      }
      const requiredMajor = await readRequiredJava(baseDir, instance.versionId)
      const strict = isStrictLoader(instance)
      const javaAuto = instance.javaAuto !== false
      const currentJavaPath = instance.javaPath?.trim() || null
      const manualPath = javaAuto ? null : currentJavaPath
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
            message: '实例指定的 Java 不存在或无法运行',
            javaAuto: false,
            ...memory
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
            : `手动指定的 Java ${manualJava.major} 不满足 Java ${requiredMajor} 要求`,
          javaAuto: false,
          ...memory
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
          message: '无法从版本配置确定所需 Java',
          javaAuto,
          ...memory
        } satisfies JavaAssignmentView
      }

      let selected: JavaInfo | null = null
      try {
        selected = chooseJava(javaList, requiredMajor, settings.javaPath, strict)
      } catch {
        selected = null
      }
      if (!selected && settings.autoJava) {
        try {
          selected = chooseJava(javaList, requiredMajor, null, strict)
        } catch {
          selected = null
        }
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
          message: `未找到 Java ${requiredMajor}，启动时${settings.autoJava ? '会尝试自动下载' : '需要手动安装'}`,
          javaAuto,
          ...memory
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
        message: null,
        javaAuto,
        ...memory
      } satisfies JavaAssignmentView
    })
  )
}

