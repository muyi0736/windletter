import { app } from 'electron'
import { basename, join, resolve } from 'node:path'
import type { LauncherSettings, VersionFolderView } from '../../shared/types'
import { listInstances } from './instances'
import { pathExists } from './version'
import { listInstalledVersions } from './versions'

export function officialGameDir(): string {
  return join(app.getPath('appData'), '.minecraft')
}

export function mergeVersionFolders(
  current: readonly string[],
  ...extra: (string | null | undefined)[]
): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  for (const value of [...current, ...extra]) {
    if (typeof value !== 'string' || !value.trim()) continue
    const path = resolve(value.trim())
    const key = path.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(path)
  }
  return result.slice(0, 20)
}

export async function listVersionFolders(
  settings: LauncherSettings
): Promise<VersionFolderView[]> {
  const official = resolve(officialGameDir())
  const current = resolve(settings.gameDir)
  const candidates: { path: string; kind: VersionFolderView['kind'] }[] = [
    { path: current, kind: 'current' }
  ]
  if (official.toLowerCase() !== current.toLowerCase()) {
    candidates.push({ path: official, kind: 'official' })
  }
  for (const folder of settings.versionFolders) {
    const path = resolve(folder)
    if (
      path.toLowerCase() === current.toLowerCase() ||
      path.toLowerCase() === official.toLowerCase()
    ) {
      continue
    }
    candidates.push({ path, kind: 'custom' })
  }

  const instances = await listInstances()
  const result: VersionFolderView[] = []
  for (const candidate of candidates) {
    const exists = await pathExists(candidate.path)
    const versionCount = exists
      ? (await listInstalledVersions(candidate.path)).length
      : 0
    const instanceCount = instances.filter((instance) => {
      const base = instance.external?.baseDir ?? instance.baseDir ?? settings.gameDir
      return base.toLowerCase() === candidate.path.toLowerCase()
    }).length
    result.push({
      path: candidate.path,
      name:
        candidate.kind === 'current'
          ? '当前文件夹'
          : candidate.kind === 'official'
            ? '官方启动器文件夹'
            : basename(candidate.path) || candidate.path,
      kind: candidate.kind,
      exists,
      versionCount,
      instanceCount
    })
  }
  return result
}
