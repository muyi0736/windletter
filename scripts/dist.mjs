import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const KEY_FILE = 'D:/WindletterOut/curseforge.key'
const UPDATE_FEED =
  process.env.WINDLETTER_DEFAULT_UPDATE_FEED?.trim() ||
  'https://github.com/muyi0736/windletter/releases/latest/download/latest.json'

let key = process.env.WINDLETTER_CURSEFORGE_API_KEY?.trim() ?? ''
if (!key && existsSync(KEY_FILE)) key = readFileSync(KEY_FILE, 'utf8').trim()
if (!key) {
  console.error('[dist] 缺少 CurseForge API Key：请设置 WINDLETTER_CURSEFORGE_API_KEY 或提供 D:/WindletterOut/curseforge.key')
  process.exit(1)
}

const env = {
  ...process.env,
  WINDLETTER_CURSEFORGE_API_KEY: key,
  WINDLETTER_DEFAULT_UPDATE_FEED: UPDATE_FEED
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', env, shell: true })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

console.log('[dist] 已注入 CurseForge Key 与更新源，开始构建')
run('npm', ['run', 'build'])
run('npx', ['electron-builder', '--win', 'nsis', '--publish', 'never'])
