import { createReadStream, createWriteStream, promises as fs } from 'node:fs'
import { once } from 'node:events'
import { crc32 } from 'node:zlib'

export interface StoreZipEntry {
  name: string
  data?: Buffer
  source?: string
}

const FLAGS = 0x0808 // data descriptor + UTF-8 names
const METHOD_STORE = 0
const DOS_TIME = 0
const DOS_DATE = 0x21

function localHeader(name: Buffer): Buffer {
  const header = Buffer.alloc(30)
  header.writeUInt32LE(0x04034b50, 0)
  header.writeUInt16LE(20, 4)
  header.writeUInt16LE(FLAGS, 6)
  header.writeUInt16LE(METHOD_STORE, 8)
  header.writeUInt16LE(DOS_TIME, 10)
  header.writeUInt16LE(DOS_DATE, 12)
  header.writeUInt32LE(0, 14)
  header.writeUInt32LE(0, 18)
  header.writeUInt32LE(0, 22)
  header.writeUInt16LE(name.length, 26)
  header.writeUInt16LE(0, 28)
  return Buffer.concat([header, name])
}

function dataDescriptor(crc: number, size: number): Buffer {
  const descriptor = Buffer.alloc(16)
  descriptor.writeUInt32LE(0x08074b50, 0)
  descriptor.writeUInt32LE(crc >>> 0, 4)
  descriptor.writeUInt32LE(size, 8)
  descriptor.writeUInt32LE(size, 12)
  return descriptor
}

function centralHeader(name: Buffer, crc: number, size: number, offset: number): Buffer {
  const header = Buffer.alloc(46)
  header.writeUInt32LE(0x02014b50, 0)
  header.writeUInt16LE(20, 4)
  header.writeUInt16LE(20, 6)
  header.writeUInt16LE(FLAGS, 8)
  header.writeUInt16LE(METHOD_STORE, 10)
  header.writeUInt16LE(DOS_TIME, 12)
  header.writeUInt16LE(DOS_DATE, 14)
  header.writeUInt32LE(crc >>> 0, 16)
  header.writeUInt32LE(size, 20)
  header.writeUInt32LE(size, 24)
  header.writeUInt16LE(name.length, 28)
  header.writeUInt16LE(0, 30)
  header.writeUInt16LE(0, 32)
  header.writeUInt16LE(0, 34)
  header.writeUInt16LE(0, 36)
  header.writeUInt32LE(0, 38)
  header.writeUInt32LE(offset, 42)
  return Buffer.concat([header, name])
}

export async function writeStoreZip(
  destination: string,
  entries: StoreZipEntry[],
  options: {
    signal?: AbortSignal
    onProgress?: (done: number, total: number, bytes: number) => void
  } = {}
): Promise<{ files: number; bytes: number }> {
  const out = createWriteStream(destination)
  let offset = 0
  const central: Buffer[] = []
  let done = 0
  let bytes = 0

  const write = async (buffer: Buffer): Promise<void> => {
    if (!out.write(buffer)) await once(out, 'drain')
    offset += buffer.length
  }

  try {
    for (const entry of entries) {
      if (options.signal?.aborted) throw new Error('导出已取消')
      const name = Buffer.from(entry.name.replace(/\\/g, '/'), 'utf8')
      const entryOffset = offset
      await write(localHeader(name))

      let crc = 0
      let size = 0
      if (entry.data) {
        crc = crc32(entry.data)
        size = entry.data.length
        await write(entry.data)
      } else if (entry.source) {
        for await (const chunk of createReadStream(entry.source)) {
          if (options.signal?.aborted) throw new Error('导出已取消')
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          crc = crc32(buffer, crc)
          size += buffer.length
          await write(buffer)
        }
      }
      await write(dataDescriptor(crc, size))
      central.push(centralHeader(name, crc, size, entryOffset))
      done += 1
      bytes += size
      options.onProgress?.(done, entries.length, bytes)
    }

    const centralOffset = offset
    for (const header of central) await write(header)
    const centralSize = offset - centralOffset

    const end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0)
    end.writeUInt16LE(0, 4)
    end.writeUInt16LE(0, 6)
    end.writeUInt16LE(central.length, 8)
    end.writeUInt16LE(central.length, 10)
    end.writeUInt32LE(centralSize, 12)
    end.writeUInt32LE(centralOffset, 16)
    end.writeUInt16LE(0, 20)
    await write(end)
  } finally {
    out.end()
    await once(out, 'finish').catch(() => undefined)
  }

  return { files: done, bytes }
}
