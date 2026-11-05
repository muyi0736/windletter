import { app } from 'electron'
import { createServer, type Server } from 'node:http'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { runDownloadPool } from '../src/main/core/downloadPool'
import {
  DownloadLogSession,
  listDownloadLogs,
  readDownloadLog,
  runDownloadNetworkCheck
} from '../src/main/core/downloadLog'

const dataDir =
  process.env.DOWNLOAD_LOG_TEST_DIR ||
  'D:/WindletterUpdateTestData/download-log-20261105'
const payload = Buffer.alloc(1024 * 1024, 0x5a)
const sha1 = createHash('sha1').update(payload).digest('hex')

function rangeServer(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((request, response) => {
      if (request.url?.endsWith('/missing.bin')) {
        response.writeHead(404)
        response.end('missing')
        return
      }
      const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? '')
      if (range) {
        const start = Number(range[1])
        const end = range[2] ? Number(range[2]) : payload.length - 1
        const chunk = payload.subarray(start, Math.min(end + 1, payload.length))
        response.writeHead(206, {
          'Content-Type': 'application/octet-stream',
          'Accept-Ranges': 'bytes',
          'Content-Range': `bytes ${start}-${start + chunk.length - 1}/${payload.length}`,
          'Content-Length': chunk.length
        })
        response.end(chunk)
        return
      }
      response.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Accept-Ranges': 'bytes',
        'Content-Length': payload.length
      })
      response.end(payload)
    })
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('no port')
      resolve({ server, port: address.port })
    })
  })
}

async function main(): Promise<void> {
  await fs.rm(dataDir, { recursive: true, force: true })
  await fs.mkdir(dataDir, { recursive: true })
  app.setPath('userData', dataDir)
  await app.whenReady()
  const { server, port } = await rangeServer()
  const destination = join(dataDir, 'fixture', 'pack-file.bin')
  const signal = new AbortController().signal

  const success = await DownloadLogSession.start({
    task: '夹具整合包安装',
    pack: '本地夹具',
    source: 'local',
    mirror: true,
    proxy: false,
    concurrency: 2,
    files: 1,
    size: payload.length
  })
  if (!success) throw new Error('failed to start success log')
  await runDownloadPool(
    [
      {
        urls: [`http://127.0.0.1:${port}/file.bin`],
        destination,
        size: payload.length,
        sha1,
        label: 'file.bin'
      }
    ],
    { concurrency: 2, signal, log: success }
  )
  await success.finish('success')
  const successText = await readDownloadLog(success.name)
  if (!successText.includes('status: success')) throw new Error('missing success status')
  if (!successText.includes('[host] 127.0.0.1')) throw new Error('missing host summary')
  if (!successText.includes('file.bin')) throw new Error('missing file entry')

  const failure = await DownloadLogSession.start({
    task: '夹具失败下载',
    pack: '本地夹具',
    source: 'local',
    mirror: true,
    proxy: false,
    concurrency: 1,
    files: 1,
    size: payload.length
  })
  if (!failure) throw new Error('failed to start failure log')
  try {
    await runDownloadPool(
      [
        {
          urls: [`http://127.0.0.1:${port}/missing.bin`],
          destination: join(dataDir, 'fixture', 'missing.bin'),
          size: payload.length,
          label: 'missing.bin'
        }
      ],
      { concurrency: 1, signal, log: failure }
    )
    throw new Error('missing download should fail')
  } catch {
    await failure.finish('failed', '夹具 404')
  }
  const failureText = await readDownloadLog(failure.name)
  if (!failureText.includes('status: failed')) throw new Error('missing failed status')
  if (!failureText.includes('file-fail')) throw new Error('missing file failure')

  let traversalBlocked = false
  try {
    await readDownloadLog('../escape.log')
  } catch {
    traversalBlocked = true
  }
  if (!traversalBlocked) throw new Error('path traversal was not blocked')

  const logs = await listDownloadLogs()
  const successSummary = logs.find((item) => item.name === success.name)
  const failureSummary = logs.find((item) => item.name === failure.name)
  if (successSummary?.status !== 'success') throw new Error('list did not parse success')
  if (failureSummary?.status !== 'failed') throw new Error('list did not parse failure')
  if ((successSummary.bytes ?? 0) !== payload.length) throw new Error('wrong byte total')

  const networkCheck = await runDownloadNetworkCheck()
  if (networkCheck.task !== '下载线路体检') throw new Error('network check log missing')
  const checkText = await readDownloadLog(networkCheck.name)
  if (!checkText.includes('[probe]')) throw new Error('network check probes missing')

  console.log(
    JSON.stringify({
      ok: true,
      success: success.name,
      failure: failure.name,
      networkCheck: networkCheck.name,
      logs: (await listDownloadLogs()).length,
      bytes: successSummary.bytes
    })
  )
  server.close()
  app.quit()
}

main().catch((error) => {
  console.error(error)
  app.exit(1)
})
