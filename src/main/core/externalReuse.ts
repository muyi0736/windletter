import { promises as fs } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { hashFile } from './contentCache'

/**
 * 常见的 Minecraft 数据目录：其他启动器（PCL/HMCL/官方）通常会把
 * versions/libraries/assets 放在 .minecraft 下。这里只做存在性扫描，
 * 不读取内容，找到后由调用方按大小/SHA1 复用。
 */
export async function externalMinecraftRoots(
  gameDir: string,
  extraRoots: string[] = []
): Promise<string[]> {
  const candidates = new Set<string>()
  const add = (value: string): void => {
    const abs = resolve(value)
    if (abs.toLowerCase() !== resolve(gameDir).toLowerCase()) candidates.add(abs)
  }
  if (process.env.APPDATA) add(join(process.env.APPDATA, '.minecraft'))
  if (process.env.USERPROFILE) add(join(process.env.USERPROFILE, '.minecraft'))
  for (const drive of ['C:', 'D:', 'E:', 'F:', 'G:']) {
    add(join(`${drive}\\`, '.minecraft'))
  }
  for (const raw of extraRoots) {
    if (!raw?.trim()) continue
    const abs = resolve(raw.trim())
    const lower = basename(abs).toLowerCase()
    if (lower.endsWith('.exe')) add(join(dirname(abs), '.minecraft'))
    else {
      add(abs)
      add(join(abs, '.minecraft'))
    }
  }

  const roots: string[] = []
  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate)
      if (stat.isDirectory()) roots.push(candidate)
    } catch {
      /* ignore missing root */
    }
  }
  const driveOf = (value: string): string => resolve(value).slice(0, 2).toLowerCase()
  const targetDrive = driveOf(gameDir)
  // 同盘优先：跨盘只能复制，不能硬链接；避免为了复用一个 C 盘旧文件
  // 把几百 MB 资源复制到 D 盘，反而比下载更慢。
  roots.sort((left, right) => {
    const leftSame = driveOf(left) === targetDrive ? 0 : 1
    const rightSame = driveOf(right) === targetDrive ? 0 : 1
    return leftSame - rightSame
  })
  return roots
}

/**
 * 从外部启动器目录复用单个文件：优先硬链接，跨卷退化为复制。
 * 提供 size 时先校验大小；提供 sha1 时再校验哈希，避免复用损坏文件。
 */
export async function reuseExternalFile(
  roots: string[],
  rel: string,
  destination: string,
  size?: number | null,
  sha1?: string | null
): Promise<boolean> {
  const normalized = rel.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!normalized || normalized.includes('..')) return false
  for (const root of roots) {
    const source = join(root, normalized)
    try {
      const stat = await fs.stat(source)
      if (!stat.isFile()) continue
      if (size != null && stat.size !== size) continue
      if (sha1) {
        const info = await hashFile(source)
        if (!info || info.sha1.toLowerCase() !== sha1.toLowerCase()) continue
      }
      await fs.mkdir(dirname(destination), { recursive: true })
      await fs.rm(destination, { force: true }).catch(() => undefined)
      try {
        await fs.link(source, destination)
      } catch {
        await fs.copyFile(source, destination)
      }
      return true
    } catch {
      /* try next root */
    }
  }
  return false
}
