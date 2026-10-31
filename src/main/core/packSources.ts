import { CancellationError, probeSourceSpeed } from './net'

export interface SourceJob {
  urls: string[]
  size?: number | null
}

export interface PackSourceProbe {
  origin: string
  host: string
  bytesPerMs: number
  mbps: number
}

const DEFAULT_PROBE_BYTES = 256 * 1024
const MIN_SAMPLE_BYTES = 512 * 1024

function originOf(url: string): string | null {
  try {
    return new URL(url).origin.toLowerCase()
  } catch {
    return null
  }
}

/**
 * 用每个候选源站的一个中等大小文件做 4 路 Range 吞吐量探测。
 * 返回按速度从高到低排列的源站；不足两个源站或探测失败时返回空数组。
 */
export async function probePackSources(
  jobs: SourceJob[],
  options: { signal: AbortSignal; probeBytes?: number; minSampleBytes?: number }
): Promise<PackSourceProbe[]> {
  const samples = new Map<string, string>()
  const minSample = options.minSampleBytes ?? MIN_SAMPLE_BYTES
  for (const job of jobs) {
    if ((job.size ?? 0) < minSample) continue
    for (const url of job.urls) {
      const origin = originOf(url)
      if (origin && !samples.has(origin)) samples.set(origin, url)
    }
  }
  if (samples.size < 2) return []

  const probes = await Promise.all(
    [...samples.entries()].map(async ([origin, url]): Promise<PackSourceProbe | null> => {
      const speed = await probeSourceSpeed(
        url,
        options.probeBytes ?? DEFAULT_PROBE_BYTES,
        options.signal
      )
      if (speed === null || !Number.isFinite(speed) || speed <= 0) return null
      return {
        origin,
        host: new URL(origin).hostname,
        bytesPerMs: speed,
        mbps: (speed * 1000) / (1024 * 1024)
      }
    })
  )
  if (options.signal.aborted) throw new CancellationError()
  return probes
    .filter((probe): probe is PackSourceProbe => Boolean(probe))
    .sort((left, right) => right.bytesPerMs - left.bytesPerMs)
}

export function sortUrlsBySourceSpeed(urls: string[], probes: PackSourceProbe[]): string[] {
  if (probes.length < 2) return [...urls]
  const rank = new Map(probes.map((probe, index) => [probe.origin, index]))
  return [...urls].sort((left, right) => {
    const a = rank.get(originOf(left) ?? '') ?? Number.MAX_SAFE_INTEGER
    const b = rank.get(originOf(right) ?? '') ?? Number.MAX_SAFE_INTEGER
    return a - b
  })
}

export function formatSourceProbe(probes: PackSourceProbe[]): string {
  return probes
    .map((probe) => `${probe.host} ${probe.mbps.toFixed(1)} MB/s`)
    .join(' · ')
}
