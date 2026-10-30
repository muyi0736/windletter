import AdmZip from 'adm-zip'

export interface JarModIdentity {
  ids: string[]
  names: string[]
}

const MAX_IDS = 64
const MAX_ENTRY_BYTES = 1_000_000

/** 读取 jar 自身声明的模组 ID / 名称；不解析嵌套 jar，也不把依赖当成自身。 */
function readJsonIdentity(
  zip: AdmZip,
  entryName: string,
  extract: (data: Record<string, unknown>) => { id?: unknown; name?: unknown; provides?: unknown }
): JarModIdentity | null {
  const entry = zip.getEntry(entryName)
  if (!entry || entry.header.size > MAX_ENTRY_BYTES) return null
  try {
    const parsed = JSON.parse(entry.getData().toString('utf8')) as Record<string, unknown>
    const info = extract(parsed)
    const ids: string[] = []
    const names: string[] = []
    if (typeof info.id === 'string' && info.id.trim()) ids.push(info.id.trim())
    if (typeof info.name === 'string' && info.name.trim()) names.push(info.name.trim())
    if (Array.isArray(info.provides)) {
      for (const value of info.provides) {
        if (typeof value === 'string' && value.trim()) ids.push(value.trim())
        else if (value && typeof value === 'object') {
          const provided = (value as Record<string, unknown>).id
          if (typeof provided === 'string' && provided.trim()) ids.push(provided.trim())
        }
      }
    }
    return { ids: ids.slice(0, MAX_IDS), names: names.slice(0, MAX_IDS) }
  } catch {
    return null
  }
}

function readTomlIdentity(zip: AdmZip, entryName: string): JarModIdentity | null {
  const entry = zip.getEntry(entryName)
  if (!entry || entry.header.size > MAX_ENTRY_BYTES) return null
  try {
    const text = entry.getData().toString('utf8')
    const ids: string[] = []
    const names: string[] = []
    // 只读取 [[mods]] 段；[[dependencies.*]] 里的 modId 是前置，不是自身 ID。
    for (const section of text.matchAll(/\[\[mods\]\]([\s\S]*?)(?=\n\s*\[\[|$)/gi)) {
      const body = section[1] ?? ''
      for (const match of body.matchAll(/^\s*modId\s*=\s*["']([^"']+)["']/gim)) {
        if (match[1]) ids.push(match[1])
      }
      for (const match of body.matchAll(/^\s*displayName\s*=\s*["']([^"']+)["']/gim)) {
        if (match[1]) names.push(match[1])
      }
    }
    if (ids.length === 0) return null
    return { ids: ids.slice(0, MAX_IDS), names: names.slice(0, MAX_IDS) }
  } catch {
    return null
  }
}

function readLegacyIdentity(zip: AdmZip): JarModIdentity | null {
  const entry = zip.getEntry('mcmod.info')
  if (!entry || entry.header.size > MAX_ENTRY_BYTES) return null
  try {
    const raw = JSON.parse(entry.getData().toString('utf8')) as unknown
    const list = Array.isArray(raw)
      ? raw
      : raw && typeof raw === 'object' && Array.isArray((raw as { modList?: unknown }).modList)
        ? (raw as { modList: unknown[] }).modList
        : []
    const ids: string[] = []
    const names: string[] = []
    for (const value of list) {
      if (!value || typeof value !== 'object') continue
      const item = value as Record<string, unknown>
      if (typeof item.modid === 'string' && item.modid.trim()) ids.push(item.modid.trim())
      if (typeof item.name === 'string' && item.name.trim()) names.push(item.name.trim())
    }
    if (ids.length === 0) return null
    return { ids: ids.slice(0, MAX_IDS), names: names.slice(0, MAX_IDS) }
  } catch {
    return null
  }
}

function normalizeIds(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))]
}

export async function readJarModIdentity(path: string): Promise<JarModIdentity | null> {
  let zip: AdmZip
  try {
    zip = new AdmZip(path)
  } catch {
    return null
  }
  try {
    const found: JarModIdentity[] = []
    const fabric = readJsonIdentity(zip, 'fabric.mod.json', (data) => ({
      id: data.id,
      name: data.name,
      provides: data.provides
    }))
    if (fabric) found.push(fabric)
    const quilt = readJsonIdentity(zip, 'quilt.mod.json', (data) => {
      const loader =
        data.quilt_loader && typeof data.quilt_loader === 'object'
          ? (data.quilt_loader as Record<string, unknown>)
          : {}
      const metadata =
        loader.metadata && typeof loader.metadata === 'object'
          ? (loader.metadata as Record<string, unknown>)
          : {}
      return { id: loader.id, name: metadata.name, provides: loader.provides }
    })
    if (quilt) found.push(quilt)
    for (const entryName of ['META-INF/neoforge.mods.toml', 'META-INF/mods.toml']) {
      const toml = readTomlIdentity(zip, entryName)
      if (toml) found.push(toml)
    }
    const legacy = readLegacyIdentity(zip)
    if (legacy) found.push(legacy)
    if (found.length === 0) return null
    return {
      ids: normalizeIds(found.flatMap((item) => item.ids)),
      names: [...new Set(found.flatMap((item) => item.names))]
    }
  } catch {
    // 某些 jar 含重复目录条目，adm-zip 会在 getEntry 时抛错；加载器仍能读，识别失败即可。
    return null
  }
}
