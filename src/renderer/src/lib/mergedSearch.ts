import type { ContentProvider } from '@shared/types'
import { cleanError } from './format'

export const MERGED_PAGE_SIZE = 20

export interface MergeableProject {
  provider: ContentProvider
  projectId: string
  slug: string
  title: string
}

export interface DualSearchSourceError {
  provider: ContentProvider
  message: string
}

export interface DualSearchResult<H> {
  hits: H[]
  totalHits: number
  sourceTotals: Record<ContentProvider, number>
  hasMore: boolean
  errors: DualSearchSourceError[]
}

export function searchProviderLabel(provider: ContentProvider): string {
  return provider === 'modrinth' ? 'Modrinth' : 'CurseForge'
}

function projectKey(project: MergeableProject): string {
  const slug = project.slug.trim().toLowerCase()
  // 全部来源按“来源 + 项目”去重：同一个模组在 CurseForge 和 Modrinth
  // 各有一条记录时都保留，和 PCL 的多来源列表一致。
  if (slug) return `${project.provider}:${slug}`
  return `${project.provider}:title:${project.title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '')}`
}

export async function searchDualSource<H extends MergeableProject>(
  offset: number,
  previous: H[],
  call: (provider: ContentProvider, offset: number) => Promise<{ hits: H[]; totalHits: number }>
): Promise<DualSearchResult<H>> {
  const providers: ContentProvider[] = ['modrinth', 'curseforge']
  const settled = await Promise.allSettled(
    providers.map((provider) => call(provider, offset))
  )
  const pages: { provider: ContentProvider; hits: H[]; totalHits: number }[] = []
  const sourceTotals: Record<ContentProvider, number> = { modrinth: 0, curseforge: 0 }
  const errors: DualSearchSourceError[] = []
  settled.forEach((outcome, index) => {
    const provider = providers[index]
    if (outcome.status === 'fulfilled') {
      pages.push({ provider, hits: outcome.value.hits, totalHits: outcome.value.totalHits })
      sourceTotals[provider] = outcome.value.totalHits
    } else {
      errors.push({ provider, message: cleanError(outcome.reason) })
    }
  })

  const availablePages = pages.filter((page) => page.hits.length > 0)
  const positiveTotals = availablePages
    .map((page) => Math.max(page.totalHits, page.hits.length))
    .filter((total) => total > 0)
  const baseTotal = positiveTotals.length > 0 ? Math.min(...positiveTotals) : 1
  const weights = new Map<ContentProvider, number>()
  for (const page of availablePages) {
    const raw = Math.max(page.totalHits, page.hits.length) / baseTotal
    weights.set(page.provider, Math.max(1, Math.min(3, raw)))
  }
  const totalWeight = [...weights.values()].reduce((sum, weight) => sum + weight, 0)
  const cursors: Record<ContentProvider, number> = { modrinth: 0, curseforge: 0 }
  const selected: Record<ContentProvider, number> = { modrinth: 0, curseforge: 0 }
  const ordered: H[] = []
  const slots = availablePages.reduce((sum, page) => sum + page.hits.length, 0)

  for (let slot = 0; slot < slots; slot += 1) {
    let pick: (typeof availablePages)[number] | null = null
    let bestDeficit = Number.NEGATIVE_INFINITY
    for (const page of availablePages) {
      if (cursors[page.provider] >= page.hits.length) continue
      const weight = weights.get(page.provider) ?? 1
      const target = ((slot + 1) * weight) / totalWeight
      const deficit = target - selected[page.provider]
      const better =
        !pick ||
        deficit > bestDeficit + 1e-9 ||
        (Math.abs(deficit - bestDeficit) <= 1e-9 &&
          (selected[page.provider] < selected[pick.provider] ||
            (selected[page.provider] === selected[pick.provider] &&
              weight > (weights.get(pick.provider) ?? 1))))
      if (better) {
        pick = page
        bestDeficit = deficit
      }
    }
    if (!pick) break
    const project = pick.hits[cursors[pick.provider]]
    cursors[pick.provider] += 1
    selected[pick.provider] += 1
    ordered.push(project)
  }

  const merged = [...previous]
  const seen = new Set(merged.map(projectKey))
  for (const project of ordered) {
    const key = projectKey(project)
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(project)
  }

  return {
    hits: merged,
    totalHits: pages.reduce((sum, page) => sum + page.totalHits, 0),
    sourceTotals,
    hasMore: pages.some(
      (page) => page.hits.length > 0 && offset + page.hits.length < page.totalHits
    ),
    errors
  }
}
