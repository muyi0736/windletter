import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { downloadFile } from '../../src/main/core/net'
import { setContentCacheDir } from '../../src/main/core/contentCache'

const root = resolve('scripts/download-smoke-test/.tmp')
const out = join(root, 'out')
const cache = join(root, 'cache')
const payload = Buffer.alloc(3 * 1024 * 1024 + 12345)
for (let i = 0; i < payload.length; i += 1) payload[i] = (i * 31 + 7) % 256
const sha1 = createHash('sha1').update(payload).digest('hex')
let requests = 0
let rangeHeaders: string[] = []
let first = true
let activeSmall = 0
let maxActiveSmall = 0

const smallPayload = Buffer.alloc(1024, 9)
const smallSha1 = createHash('sha1').update(smallPayload).digest('hex')

const server = createServer((req, res) => {
  requests += 1
  const range = req.headers.range
  if (range) rangeHeaders.push(range)
  if (req.url === '/stall') {
    res.writeHead(200, { 'Content-Length': smallPayload.length, ETag: '"stall"' })
    return
  }
  if (req.url === '/fallback') {
    res.writeHead(200, { 'Content-Length': smallPayload.length, ETag: '"fallback"' })
    res.end(smallPayload)
    return
  }
  if (req.url?.startsWith('/small')) {
    activeSmall += 1
    maxActiveSmall = Math.max(maxActiveSmall, activeSmall)
    setTimeout(() => {
      activeSmall -= 1
      res.writeHead(200, { 'Content-Length': 1024, ETag: '"small"' })
      res.end(Buffer.alloc(1024, 7))
    }, 120)
    return
  }
  if (first) {
    first = false
    res.writeHead(200, {
      'Content-Length': payload.length,
      'Content-Type': 'application/octet-stream',
      ETag: '"v1"'
    })
    res.write(payload.subarray(0, 1024 * 1024))
    setTimeout(() => res.destroy(), 80)
    return
  }
  const start = range ? Number(/bytes=(\d+)-/.exec(range)?.[1] ?? 0) : 0
  const chunk = payload.subarray(start)
  res.writeHead(range ? 206 : 200, {
    'Content-Length': chunk.length,
    'Content-Type': 'application/octet-stream',
    ETag: '"v1"',
    ...(range ? { 'Content-Range': `bytes ${start}-${payload.length - 1}/${payload.length}` } : {})
  })
  res.end(chunk)
})

async function main(): Promise<void> {
  await fs.rm(out, { recursive: true, force: true })
  await fs.rm(cache, { recursive: true, force: true })
  await fs.mkdir(out, { recursive: true })
  setContentCacheDir(cache)
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('no address')
  const url = `http://127.0.0.1:${address.port}/file.bin`

  const dest1 = join(out, 'file-1.bin')
  await downloadFile([url], dest1, { sha1, size: payload.length })
  const got1 = await fs.readFile(dest1)
  assert.equal(createHash('sha1').update(got1).digest('hex'), sha1, 'resumed file hash')
  assert.equal(got1.length, payload.length, 'resumed file size')
  assert.ok(rangeHeaders.length >= 1, 'expected a Range resume request')
  const leftover1 = await fs.readdir(out)
  assert.deepEqual(leftover1, ['file-1.bin'], 'no part/sidecar files after success')
  const requestsAfterFirst = requests
  const cacheDirEntries = await fs.readdir(cache)
  assert.ok(cacheDirEntries.length > 0, 'cache object created')

  const dest2 = join(out, 'file-2.bin')
  await downloadFile([url], dest2, { sha1, size: payload.length })
  assert.equal(requests, requestsAfterFirst, 'cache hit should not hit network')
  const [s1, s2] = await Promise.all([fs.stat(dest1), fs.stat(dest2)])
  assert.equal(s1.ino, s2.ino, 'hardlink reuse expected')

  const stallDest = join(out, 'stall-fallback.bin')
  const stallStarted = Date.now()
  await downloadFile(
    [`http://127.0.0.1:${address.port}/stall`, `http://127.0.0.1:${address.port}/fallback`],
    stallDest,
    { sha1: smallSha1, size: smallPayload.length }
  )
  const stallElapsed = Date.now() - stallStarted
  assert.equal(
    createHash('sha1').update(await fs.readFile(stallDest)).digest('hex'),
    smallSha1,
    'fallback payload hash'
  )
  assert.ok(stallElapsed >= 19_000, `expected stall timeout, got ${stallElapsed}ms`)

  const smallJobs = Array.from({ length: 40 }, (_, index) => {
    const dest = join(out, `small-${index}.bin`)
    return downloadFile([`http://127.0.0.1:${address.port}/small?id=${index}`], dest, {
      size: 1024
    })
  })
  await Promise.all(smallJobs)
  assert.ok(maxActiveSmall <= 16, `host concurrency exceeded: ${maxActiveSmall}`)
  assert.ok(maxActiveSmall > 1, 'expected parallel host downloads')

  console.log(JSON.stringify({
    ok: true,
    requests,
    rangeHeaders,
    sha1,
    cacheDirs: cacheDirEntries.length,
    hardlinked: s1.ino === s2.ino,
    maxActiveSmall,
    stallElapsed
  }, null, 2))
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => server.close())
