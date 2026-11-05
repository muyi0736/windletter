#!/usr/bin/env node
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const outDir = path.join(root, '.tmp-download-log-test')
fs.rmSync(outDir, { recursive: true, force: true })
const compile = spawnSync(
  process.execPath,
  [
    path.join(root, 'node_modules/typescript/bin/tsc'),
    path.join(root, 'src/main/core/downloadLogFormat.ts'),
    '--outDir',
    outDir,
    '--module',
    'commonjs',
    '--target',
    'es2022',
    '--skipLibCheck'
  ],
  { cwd: root, encoding: 'utf8' }
)
if (compile.status !== 0) {
  console.error(compile.stdout, compile.stderr)
  process.exit(compile.status ?? 1)
}
const mod = require(path.join(outDir, 'main/core/downloadLogFormat.js'))

assert.equal(
  mod.redactDownloadUrl(
    'https://user:pass@mediafilez.forgecdn.net/files/1/2/a.jar?token=secret#frag'
  ),
  'https://mediafilez.forgecdn.net/files/1/2/a.jar'
)
assert.equal(mod.redactDownloadUrl('not a url'), '[invalid-url]')
assert.equal(
  mod.hostOfDownloadUrl('https://mod.mcimirror.top/files/1/2/a.jar'),
  'mod.mcimirror.top'
)

const started = '2026-11-05T08:00:00.000Z'
const text = [
  '# 月月月启动器下载诊断',
  'task: 安装整合包',
  'pack: All the Mods 9',
  `started: ${started}`,
  'size: 123456',
  'status: running',
  '',
  '[08:00:01.000] [speed] 1.00 MB/s',
  '',
  'finished: 2026-11-05T08:01:00.000Z',
  'status: success',
  'bytes: 100000',
  'avgbps: 2048'
].join('\n')
const summary = mod.parseDownloadLogSummary('download-x.log', text, 1, 4096)
assert.equal(summary.task, '安装整合包')
assert.equal(summary.pack, 'All the Mods 9')
assert.equal(summary.status, 'success')
assert.equal(summary.bytes, 100000)
assert.equal(summary.size, 123456)
assert.equal(summary.avgBps, 2048)
assert.equal(summary.startedAt, Date.parse(started))
assert.equal(summary.finishedAt, Date.parse('2026-11-05T08:01:00.000Z'))
assert.equal(summary.logBytes, 4096)

const now = Date.parse('2026-11-05T00:00:00.000Z')
const entries = []
for (let index = 0; index < 35; index += 1) {
  entries.push({ name: `ok-${index}.log`, startedAt: now - (40 - index) * 1000, status: 'success' })
}
for (let index = 0; index < 3; index += 1) {
  entries.push({ name: `fail-${index}.log`, startedAt: now - (60 - index) * 1000, status: 'failed' })
}
const deletions = mod.selectDownloadLogsForDeletion(entries, now, 30)
assert.equal(entries.length - deletions.length, 30)
assert.ok(!deletions.includes('fail-0.log'))
assert.ok(!deletions.includes('fail-1.log'))
assert.ok(!deletions.includes('fail-2.log'))

const aged = [
  { name: 'old-ok.log', startedAt: now - 40 * 24 * 60 * 60 * 1000, status: 'success' },
  { name: 'old-fail.log', startedAt: now - 40 * 24 * 60 * 60 * 1000, status: 'failed' },
  { name: 'new-ok.log', startedAt: now - 1000, status: 'success' }
]
const agedDeletions = mod.selectDownloadLogsForDeletion(aged, now, 30)
assert.deepEqual(agedDeletions, ['old-ok.log'])

assert.equal(mod.formatLogSpeed(1.5 * 1024 * 1024), '1.50 MB/s')
assert.equal(mod.formatLogBytes(1536), '1.5 KB')
console.log('download-log-format: all assertions passed')
