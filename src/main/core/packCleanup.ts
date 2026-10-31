import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { pathExists, safeJoin } from './version'

/** 读取 versions 下的目录名；包括只下载了一半、还没有版本 JSON 的目录。 */
export async function listVersionFolderNames(gameDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(join(gameDir, 'versions'), { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

async function removeVersionFolder(gameDir: string, id: string): Promise<void> {
  if (!id || id.includes('/') || id.includes('\\') || id.includes('..')) {
    throw new Error('无效的版本名称')
  }
  const folder = safeJoin(join(gameDir, 'versions'), id)
  if (!(await pathExists(folder))) throw new Error(`版本 ${id} 不存在`)
  await fs.rm(folder, { recursive: true, force: true })
}

function belongsToInstall(
  id: string,
  gameVersion: string,
  loader: string,
  loaderVersion: string | null
): boolean {
  if (id === gameVersion) return true
  if (!loader || loader === 'vanilla') return false
  const lower = id.toLowerCase()
  if (lower.includes(loader.toLowerCase())) return true
  return Boolean(loaderVersion && id.includes(loaderVersion))
}

/**
 * 整合包安装失败时，移除本次新建且未注册实例引用的 vanilla/loader 版本目录。
 * 只处理 versions 目录；libraries/assets 属于共享缓存，保留。
 */
export async function cleanupFailedPackVersions(options: {
  gameDir: string
  baseline: Iterable<string>
  gameVersion: string
  loader: string
  loaderVersion: string | null
  usedVersionIds: Iterable<string>
}): Promise<string[]> {
  const baseline = new Set(options.baseline)
  const used = new Set(options.usedVersionIds)
  let after: string[]
  try {
    after = await listVersionFolderNames(options.gameDir)
  } catch {
    return []
  }
  const removed: string[] = []
  for (const id of after) {
    if (baseline.has(id) || used.has(id)) continue
    if (!belongsToInstall(id, options.gameVersion, options.loader, options.loaderVersion)) continue
    try {
      await removeVersionFolder(options.gameDir, id)
      removed.push(id)
    } catch {
      /* 清理失败不覆盖原始安装错误 */
    }
  }
  return removed
}
