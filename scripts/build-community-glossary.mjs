import AdmZip from 'adm-zip'
import { promises as fs } from 'node:fs'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { gzipSync } from 'node:zlib'
import { dirname, join, relative, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const args = process.argv.slice(2)
function arg(name, fallback = '') {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] ?? fallback : fallback
}

const source = resolve(
  arg('--source', process.env.CFPA_DIR || 'D:/WindletterUpdateTestData/glossary-build/cfpa')
)
const zipPath = arg('--zip', '')
const outDir = resolve(arg('--out', 'resources/glossary'))
const MAX_ENTRIES = Number(arg('--max', '120000'))
const MAX_SOURCE = 120
const MAX_TARGET = 160
const CJK = /[\u3400-\u9fff]/
const LATIN = /[A-Za-z]/
const FORMAT_CODE = /§[0-9a-fk-or]/gi

function clean(value) {
  return typeof value === 'string'
    ? value
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(FORMAT_CODE, '')
        .replace(/\s+/g, ' ')
        .trim()
    : ''
}

function placeholders(value) {
  return (value.match(/%(?:\d+\$)?[sdif]|\{\d+\}|<[^>]+>/g) ?? []).sort().join('|')
}

function usable(sourceText, targetText) {
  const sourceValue = clean(sourceText)
  const targetValue = clean(targetText)
  if (!sourceValue || !targetValue) return false
  if (sourceValue.length < 2 || targetValue.length < 1) return false
  if (sourceValue.length > MAX_SOURCE || targetValue.length > MAX_TARGET) return false
  if (!LATIN.test(sourceValue) || !CJK.test(targetValue)) return false
  if (sourceValue.toLowerCase() === targetValue.toLowerCase()) return false
  if (sourceValue.includes('=') || targetValue.includes('=')) return false
  if (placeholders(sourceValue) !== placeholders(targetValue)) return false
  return true
}

async function walk(dir, visit) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(full, visit)
    } else if (entry.isFile()) {
      await visit(full)
    }
  }
}

function parseJson(text) {
  try {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const pairs = []
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') pairs.push([key, value])
    }
    return pairs
  } catch {
    return null
  }
}

function parseLangText(text) {
  const pairs = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith('//')) continue
    const index = line.indexOf('=')
    if (index <= 0) continue
    pairs.push([line.slice(0, index).trim(), line.slice(index + 1)])
  }
  return pairs
}

async function parseLang(path) {
  const pairs = []
  const reader = createInterface({
    input: createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Infinity
  })
  for await (const raw of reader) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith('//')) continue
    const index = line.indexOf('=')
    if (index <= 0) continue
    pairs.push([line.slice(0, index).trim(), line.slice(index + 1)])
  }
  return pairs
}

async function fileExists(path) {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

const votes = new Map()
let enFiles = 0
let zhFiles = 0
let pairedFiles = 0
let rawPairs = 0

function addPairs(pairs, zhPairs) {
  if (!pairs || !zhPairs) return
  const targetByKey = new Map(zhPairs)
  pairedFiles += 1
  for (const [key, sourceText] of pairs) {
    const targetText = targetByKey.get(key)
    if (targetText === undefined) continue
    rawPairs += 1
    if (!usable(sourceText, targetText)) continue
    const sourceValue = clean(sourceText)
    const targetValue = clean(targetText)
    const keyLower = sourceValue.toLowerCase()
    let entry = votes.get(keyLower)
    if (!entry) {
      entry = { source: sourceValue, targets: new Map(), count: 0 }
      votes.set(keyLower, entry)
    }
    entry.count += 1
    entry.targets.set(targetValue, (entry.targets.get(targetValue) ?? 0) + 1)
  }
}

if (zipPath) {
  const zip = new AdmZip(resolve(zipPath))
  const entries = zip.getEntries()
  for (const entry of entries) {
    const match = /projects\/assets\/(.+)\/lang\/en_us\.(json|lang)$/.exec(entry.entryName)
    if (!match) continue
    enFiles += 1
    const ext = match[2]
    const zhEntry = zip.getEntry(entry.entryName.replace(/en_us\.(json|lang)$/, `zh_cn.${ext}`))
    if (!zhEntry) continue
    zhFiles += 1
    const pairs =
      ext === 'json' ? parseJson(zip.readAsText(entry)) : parseLangText(zip.readAsText(entry))
    const zhPairs =
      ext === 'json' ? parseJson(zip.readAsText(zhEntry)) : parseLangText(zip.readAsText(zhEntry))
    addPairs(pairs, zhPairs)
  }
} else {
  const assetsRoot = join(source, 'projects', 'assets')
  if (!(await fileExists(assetsRoot))) {
    throw new Error(`找不到 ${assetsRoot}；请先 shallow clone CFPA 仓库并 sparse-checkout projects/assets`)
  }

  await walk(assetsRoot, async (full) => {
    const name = full.split(/[\\/]/).pop()
    if (name !== 'en_us.json' && name !== 'en_us.lang') return
    enFiles += 1
    const zhName = name.endsWith('.json') ? 'zh_cn.json' : 'zh_cn.lang'
    const zhPath = join(dirname(full), zhName)
    if (!(await fileExists(zhPath))) return
    zhFiles += 1
    const pairs = name.endsWith('.json')
      ? parseJson(await fs.readFile(full, 'utf8'))
      : await parseLang(full)
    const zhPairs = name.endsWith('.json')
      ? parseJson(await fs.readFile(zhPath, 'utf8'))
      : await parseLang(zhPath)
    addPairs(pairs, zhPairs)
  })
}

const entries = []
for (const entry of votes.values()) {
  let bestTarget = ''
  let bestCount = -1
  for (const [target, count] of entry.targets) {
    if (count > bestCount || (count === bestCount && target.length > bestTarget.length)) {
      bestTarget = target
      bestCount = count
    }
  }
  if (bestTarget) {
    entries.push({ source: entry.source, target: bestTarget, count: entry.count })
  }
}
entries.sort((a, b) => b.count - a.count || a.source.localeCompare(b.source))
const selected = entries.slice(0, MAX_ENTRIES).map(({ source: s, target }) => ({ source: s, target }))
selected.sort((a, b) => a.source.localeCompare(b.source))

const commit = (() => {
  if (zipPath) return arg('--commit', 'main')
  try {
    return execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
})()

const payload = {
  version: 1,
  source: 'CFPAOrg/Minecraft-Mod-Language-Package',
  repository: 'https://github.com/CFPAOrg/Minecraft-Mod-Language-Package',
  license: 'CC BY-NC-SA 4.0',
  commit,
  generatedAt: new Date().toISOString(),
  stats: { enFiles, zhFiles, pairedFiles, rawPairs, unique: entries.length, selected: selected.length },
  entries: selected
}

await fs.mkdir(outDir, { recursive: true })
const tsv = selected.map((entry) => `${entry.source}\t${entry.target}`).join('\n')
const compressed = gzipSync(Buffer.from(tsv, 'utf8'), { level: 9 })
await fs.writeFile(join(outDir, 'community-glossary.tsv.gz'), compressed)
await fs.writeFile(
  join(outDir, 'community-glossary.meta.json'),
  JSON.stringify(
    {
      version: 1,
      count: selected.length,
      source: payload.source,
      license: payload.license,
      commit,
      generatedAt: payload.generatedAt
    },
    null,
    2
  )
)

let licenseText = null
if (zipPath) {
  const zip = new AdmZip(resolve(zipPath))
  const licenseEntry = zip
    .getEntries()
    .find((entry) => /(^|\/)LICENSE$/.test(entry.entryName))
  if (licenseEntry) licenseText = zip.readAsText(licenseEntry)
} else {
  try {
    licenseText = await fs.readFile(join(source, 'LICENSE'), 'utf8')
  } catch {
    licenseText = null
  }
}
const notice = [
  '# Community translation glossary',
  '',
  'Source: CFPAOrg/Minecraft-Mod-Language-Package',
  `Repository: https://github.com/CFPAOrg/Minecraft-Mod-Language-Package`,
  `Commit: ${commit}`,
  'License: Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International (CC BY-NC-SA 4.0)',
  'License text: https://creativecommons.org/licenses/by-nc-sa/4.0/legalcode',
  '',
  'This glossary is derived from the community translation package. It is provided',
  'for non-commercial use, with attribution, and is shared under the same license.',
  'The launcher does not claim ownership of the translations.',
  ''
].join('\n')
await fs.writeFile(join(outDir, 'NOTICE.md'), notice)
if (licenseText) {
  await fs.writeFile(join(outDir, 'LICENSE-CC-BY-NC-SA-4.0.txt'), licenseText)
}

console.log(
  JSON.stringify(
    {
      out: relative(process.cwd(), join(outDir, 'community-glossary.tsv.gz')),
      bytes: compressed.length,
      textBytes: Buffer.byteLength(tsv),
      ...payload.stats
    },
    null,
    2
  )
)
