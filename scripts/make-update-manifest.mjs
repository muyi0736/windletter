#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'

function usage() {
  console.log(`用法：
  node scripts/make-update-manifest.mjs <安装包.exe> [选项]

选项：
  --version <版本>       默认读取 package.json 的 version
  --base <地址>          安装包所在目录（https://host/path/）；省略时写相对文件名
  --notes-file <文件>    每行一条更新说明
  --notes "一|二"        直接提供更新说明，用 | 分隔
  --page-url <地址>      发布页地址
  --mandatory            标记为重要更新
  --out <文件>           默认与安装包同目录的 latest.json
`)
}

const args = process.argv.slice(2)
if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  usage()
  process.exit(args.length === 0 ? 1 : 0)
}

const installer = resolve(args[0])
let version = JSON.parse(await readFile(resolve('package.json'), 'utf8')).version
let base = ''
let notesFile = ''
let notesInline = ''
let pageUrl = ''
let mandatory = false
let out = ''

for (let index = 1; index < args.length; index += 1) {
  const arg = args[index]
  if (arg === '--version') version = args[++index] ?? version
  else if (arg === '--base') base = args[++index] ?? ''
  else if (arg === '--notes-file') notesFile = args[++index] ?? ''
  else if (arg === '--notes') notesInline = args[++index] ?? ''
  else if (arg === '--page-url') pageUrl = args[++index] ?? ''
  else if (arg === '--mandatory') mandatory = true
  else if (arg === '--out') out = args[++index] ?? ''
  else {
    console.error(`未知参数：${arg}`)
    usage()
    process.exit(1)
  }
}

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`版本号无效：${version}`)
  process.exit(1)
}
const info = await stat(installer).catch(() => null)
if (!info || !info.isFile()) {
  console.error(`找不到安装包：${installer}`)
  process.exit(1)
}
if (!/\.exe$/i.test(installer)) {
  console.error('安装包必须是 Windows .exe')
  process.exit(1)
}

const hash = createHash('sha256')
await new Promise((resolveHash, reject) => {
  const stream = createReadStream(installer)
  stream.on('error', reject)
  stream.on('data', (chunk) => hash.update(chunk))
  stream.on('end', resolveHash)
})
const sha256 = hash.digest('hex')

let url = basename(installer)
if (base.trim()) {
  let parsed
  try {
    parsed = new URL(base.trim().endsWith('/') ? base.trim() : `${base.trim()}/`)
  } catch {
    console.error(`--base 不是有效网址：${base}`)
    process.exit(1)
  }
  if (!['https:', 'http:'].includes(parsed.protocol)) {
    console.error('--base 只支持 http/https')
    process.exit(1)
  }
  url = new URL(encodeURIComponent(basename(installer)), parsed).toString()
}

const notes = []
const pushNote = (line) => {
  const text = line.trim().replace(/^[-*]\s+/, '')
  if (text) notes.push(text.slice(0, 600))
}
if (notesFile) {
  const content = await readFile(resolve(notesFile), 'utf8').catch(() => null)
  if (content == null) {
    console.error(`找不到说明文件：${notesFile}`)
    process.exit(1)
  }
  for (const line of content.split(/\r?\n/)) pushNote(line)
}
for (const line of notesInline.split('|')) pushNote(line)

const manifest = {
  schema: 1,
  app: 'windletter',
  version,
  publishedAt: new Date().toISOString(),
  url,
  size: info.size,
  sha256,
  notes: notes.slice(0, 20),
  ...(pageUrl.trim() ? { pageUrl: pageUrl.trim() } : {}),
  ...(mandatory ? { mandatory: true } : {})
}

const target = out ? resolve(out) : resolve(dirname(installer), 'latest.json')
await writeFile(target, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
console.log(`已生成 ${target}`)
console.log(`版本 ${version} · ${info.size} 字节 · SHA-256 ${sha256}`)
console.log(`下载地址 ${url}`)
console.log('把安装包与 latest.json 一起上传到同一目录后，在启动器“更多 → 启动器更新”填写 latest.json 地址。')
