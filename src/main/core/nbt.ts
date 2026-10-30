import { promises as fs } from 'node:fs'
import { gunzipSync } from 'node:zlib'

const MAX_LEVEL_DAT_BYTES = 32 * 1024 * 1024
const MAX_STRING_BYTES = 1024 * 1024
const MAX_COLLECTION = 1_000_000
const MAX_DEPTH = 32

class NbtReader {
  private pos = 0

  constructor(private readonly buffer: Buffer) {}

  private need(length: number): void {
    if (length < 0 || this.pos + length > this.buffer.length) {
      throw new Error('NBT 数据不完整')
    }
  }

  private u8(): number {
    this.need(1)
    const value = this.buffer[this.pos]
    this.pos += 1
    return value
  }

  private i16(): number {
    this.need(2)
    const value = this.buffer.readInt16BE(this.pos)
    this.pos += 2
    return value
  }

  private i32(): number {
    this.need(4)
    const value = this.buffer.readInt32BE(this.pos)
    this.pos += 4
    return value
  }

  private i64(): number {
    this.need(8)
    const value = Number(this.buffer.readBigInt64BE(this.pos))
    this.pos += 8
    return value
  }

  private f32(): number {
    this.need(4)
    const value = this.buffer.readFloatBE(this.pos)
    this.pos += 4
    return value
  }

  private f64(): number {
    this.need(8)
    const value = this.buffer.readDoubleBE(this.pos)
    this.pos += 8
    return value
  }

  private string(): string {
    this.need(2)
    const length = this.buffer.readUInt16BE(this.pos)
    this.pos += 2
    if (length > MAX_STRING_BYTES) throw new Error('NBT 字符串过长')
    this.need(length)
    const value = this.buffer.toString('utf8', this.pos, this.pos + length)
    this.pos += length
    return value
  }

  private payload(type: number, depth: number): unknown {
    if (depth > MAX_DEPTH) throw new Error('NBT 嵌套过深')
    switch (type) {
      case 1:
        return this.u8() << 24 >> 24
      case 2:
        return this.i16()
      case 3:
        return this.i32()
      case 4:
        return this.i64()
      case 5:
        return this.f32()
      case 6:
        return this.f64()
      case 7: {
        const length = this.i32()
        if (length < 0 || length > MAX_LEVEL_DAT_BYTES) throw new Error('NBT 字节数组过长')
        this.need(length)
        const value = this.buffer.subarray(this.pos, this.pos + length)
        this.pos += length
        return value
      }
      case 8:
        return this.string()
      case 9: {
        const itemType = this.u8()
        const length = this.i32()
        if (length < 0 || length > MAX_COLLECTION) throw new Error('NBT 列表过长')
        const list: unknown[] = []
        for (let index = 0; index < length; index += 1) {
          list.push(this.payload(itemType, depth + 1))
        }
        return list
      }
      case 10: {
        const compound: Record<string, unknown> = {}
        for (;;) {
          const keyType = this.u8()
          if (keyType === 0) break
          const key = this.string()
          compound[key] = this.payload(keyType, depth + 1)
        }
        return compound
      }
      case 11: {
        const length = this.i32()
        if (length < 0 || length > MAX_COLLECTION) throw new Error('NBT 整型数组过长')
        const list: number[] = []
        for (let index = 0; index < length; index += 1) list.push(this.i32())
        return list
      }
      case 12: {
        const length = this.i32()
        if (length < 0 || length > MAX_COLLECTION) throw new Error('NBT 长整型数组过长')
        const list: number[] = []
        for (let index = 0; index < length; index += 1) list.push(this.i64())
        return list
      }
      default:
        throw new Error(`未知 NBT 标签类型 ${type}`)
    }
  }

  readRoot(): unknown {
    const type = this.u8()
    if (type !== 10) throw new Error('level.dat 根标签不是 Compound')
    this.string()
    return this.payload(type, 0)
  }
}

export interface LevelData {
  name: string | null
  lastPlayed: number | null
  version: string | null
  dataVersion: number | null
}

export async function readLevelDat(path: string): Promise<LevelData | null> {
  try {
    const stat = await fs.stat(path)
    if (stat.size <= 0 || stat.size > MAX_LEVEL_DAT_BYTES) return null
    const raw = await fs.readFile(path)
    const body =
      raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw
    const root = new NbtReader(body).readRoot()
    if (!root || typeof root !== 'object' || Array.isArray(root)) return null
    const rootRecord = root as Record<string, unknown>
    const data =
      rootRecord.Data && typeof rootRecord.Data === 'object' && !Array.isArray(rootRecord.Data)
        ? (rootRecord.Data as Record<string, unknown>)
        : rootRecord
    const name = typeof data.LevelName === 'string' ? data.LevelName : null
    const lastPlayed =
      typeof data.LastPlayed === 'number' && Number.isFinite(data.LastPlayed) && data.LastPlayed > 0
        ? data.LastPlayed
        : null
    const versionNode = data.Version
    const version =
      versionNode && typeof versionNode === 'object' && !Array.isArray(versionNode)
        ? (() => {
            const candidate = (versionNode as Record<string, unknown>).Name
            return typeof candidate === 'string' ? candidate : null
          })()
        : typeof versionNode === 'string'
          ? versionNode
          : null
    return {
      name,
      lastPlayed,
      version,
      dataVersion: typeof data.DataVersion === 'number' ? data.DataVersion : null
    }
  } catch {
    return null
  }
}
