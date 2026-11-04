import os from 'node:os'
import type { InstanceLoader } from '../../shared/types'

const MB = 1024 * 1024
/** 给系统、显卡驱动和其他进程最多保留 20% 物理内存。 */
const SYSTEM_RESERVE_RATIO = 0.2
/**
 * 瞬时可用内存不能作为大整合包的唯一天花板：浏览器/编辑器会占用大量工作集，
 * 但 Windows 可以回收缓存，JVM 的 -Xmx 也只是上限而非立即提交。自动估算至少
 * 按总内存的 60% 作为可分配基线；可用内存更高时再按实际值放宽。
 */
const AUTO_BASELINE_RATIO = 0.6

/**
 * 按总物理内存、当前可用内存和模组规模计算自动堆大小，分阶段策略参考 PCL2：
 * 先满足“勉强能玩”的目标，再用更低比例逐段补足更高的目标。
 * 返回 MB，按 512 MB 取整。
 */
export function computeAutoMemoryMb(options: {
  modCount: number
  loader: InstanceLoader
  availableMb: number
  totalMb?: number
  is32Bit?: boolean
}): number {
  const availableGb = Math.max(0.5, Math.max(512, Math.floor(options.availableMb)) / 1024)
  const totalMb = Math.max(1024, Math.floor(options.totalMb ?? totalPhysicalMemoryMb()))
  const totalGb = totalMb / 1024
  const maxBySystemGb = Math.max(0.5, totalGb * (1 - SYSTEM_RESERVE_RATIO))
  const effectiveGb = Math.min(
    maxBySystemGb,
    Math.max(availableGb, totalGb * AUTO_BASELINE_RATIO)
  )

  let minimum: number
  let target1: number
  let target2: number
  let target3: number
  if (options.loader === 'optifine') {
    minimum = 0.5
    target1 = 1.5
    target2 = 3
    target3 = 5
  } else if (options.loader !== 'vanilla' || options.modCount > 0) {
    minimum = 0.5 + options.modCount / 150
    target1 = 1.5 + options.modCount / 90
    target2 = 2.7 + options.modCount / 50
    target3 = 4.5 + options.modCount / 25
  } else {
    minimum = 0.5
    target1 = 1.5
    target2 = 2.5
    target3 = 4
  }

  const stages: Array<[delta: number, ratio: number]> = [
    [target1, 1],
    [target2 - target1, 0.7],
    [target3 - target2, 0.4],
    [target3, 0.15]
  ]
  let give = 0
  let available = effectiveGb
  for (const [delta, ratio] of stages) {
    if (available < 0.1) break
    give += Math.min(available * ratio, Math.max(0, delta))
    available -= Math.max(0, delta) / ratio
  }
  // 自动分配以“估计没啥问题了”的 target2 为上限；更高需求留给手动设置，
  // 避免原版或小整合包在内存充裕时也被分到不必要的大堆。
  give = Math.max(give, minimum)
  give = Math.min(give, effectiveGb, Math.max(target2, minimum))
  if (options.is32Bit) give = Math.min(1, give)

  const systemCapMb = Math.floor((maxBySystemGb * 1024) / 512) * 512
  const memoryMb = Math.min(
    Math.round((give * 1024) / 512) * 512,
    systemCapMb
  )
  return Math.max(512, Math.min(32768, memoryMb))
}

export function totalPhysicalMemoryMb(): number {
  return Math.max(1024, Math.floor(os.totalmem() / MB))
}

export function availablePhysicalMemoryMb(): number {
  // Windows 的 ullAvailPhys 包含可回收缓存；不再把它当作自动分配的唯一上限。
  return Math.max(512, Math.floor(os.freemem() / MB))
}
