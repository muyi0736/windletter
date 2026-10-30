import type { DownloadSource } from '../../shared/types'

const MIRROR_BASE = 'https://bmclapi2.bangbang93.com'
const MODRINTH_MIRROR = 'https://mod.mcimirror.top'
const CURSEFORGE_ALT_HOST = 'mediafilez.forgecdn.net'
export const OFFICIAL_MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'
export const JAVA_RUNTIME_MANIFEST_URL =
  'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json'
export const ASSET_BASE_URL = 'https://resources.download.minecraft.net'

export function toMirrorUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl)
    if (url.hostname === 'bmclapi2.bangbang93.com') return rawUrl
    const host = url.hostname.toLowerCase()
    if (host === 'libraries.minecraft.net') return `${MIRROR_BASE}/maven${url.pathname}`
    if (host === 'resources.download.minecraft.net') return `${MIRROR_BASE}/assets${url.pathname}`
    if (
      host === 'piston-meta.mojang.com' ||
      host === 'piston-data.mojang.com' ||
      host === 'launchermeta.mojang.com' ||
      host === 'launcher.mojang.com'
    ) {
      return `${MIRROR_BASE}${url.pathname}`
    }
    return null
  } catch {
    return null
  }
}

export function orderedUrls(rawUrl: string, source: DownloadSource): string[] {
  const mirror = toMirrorUrl(rawUrl)
  const result =
    source === 'mirror' ? [mirror ?? rawUrl, rawUrl] : [rawUrl, mirror ?? rawUrl]
  return [...new Set(result)]
}

export function runtimeFileCandidates(rawUrl: string): string[] {
  const mirror = toMirrorUrl(rawUrl)
  return [...new Set([rawUrl, mirror ?? rawUrl])]
}

export function modrinthFileCandidates(rawUrl: string, mirror: boolean): string[] {
  try {
    const url = new URL(rawUrl)
    const host = url.hostname.toLowerCase()
    // edge.forgecdn.net 在国内可能解析到失效节点并直接返回 404，
    // mediafilez.forgecdn.net 是同一套官方文件 CDN，优先尝试它。
    if (host === 'edge.forgecdn.net') {
      const alt = new URL(rawUrl)
      alt.hostname = CURSEFORGE_ALT_HOST
      return [...new Set([alt.toString(), rawUrl])]
    }
    if (!mirror) return [rawUrl]
    if (!host.endsWith('modrinth.com') || !url.pathname.startsWith('/data/')) {
      return [rawUrl]
    }
    return [
      ...new Set([`${MODRINTH_MIRROR}${url.pathname}${url.search}`, rawUrl])
    ]
  } catch {
    return [rawUrl]
  }
}

export function manifestCandidates(source: DownloadSource): string[] {
  const mirror = `${MIRROR_BASE}/mc/game/version_manifest_v2.json`
  return source === 'mirror' ? [mirror, OFFICIAL_MANIFEST_URL] : [OFFICIAL_MANIFEST_URL, mirror]
}

export function javaRuntimeManifestCandidates(source: DownloadSource): string[] {
  return orderedUrls(JAVA_RUNTIME_MANIFEST_URL, source)
}

export function assetObjectUrl(hash: string, source: DownloadSource): string[] {
  return orderedUrls(`${ASSET_BASE_URL}/${hash.slice(0, 2)}/${hash}`, source)
}

export function platformKey(): string {
  if (process.platform === 'win32') {
    const arch = process.arch === 'x64' ? 'x64' : process.arch === 'ia32' ? 'x86' : process.arch
    return `windows-${arch}`
  }
  if (process.platform === 'darwin') {
    return process.arch === 'arm64' ? 'mac-os-arm64' : 'mac-os'
  }
  if (process.platform === 'linux') {
    return process.arch === 'ia32' ? 'linux-i386' : `linux-${process.arch === 'x64' ? 'x64' : process.arch}`
  }
  return `${process.platform}-${process.arch}`
}
