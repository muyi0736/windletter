import { useSyncExternalStore } from 'react'
import type {
  TranslationFileView,
  TranslationGlossaryEntry,
  TranslationScanResult,
  TranslationSegmentView
} from '@shared/types'
import { useLauncher } from '../store'
import { buildGlossaryIndex, selectRelevantGlossary } from './glossary'

export interface TranslationSessionState {
  instanceId: string | null
  scan: TranslationScanResult | null
  fileIds: string[]
  translations: Record<string, string>
  failed: string[]
  busy: boolean
  progress: { done: number; total: number }
  phase: 'select' | 'review' | 'applied'
  warnings: string[]
  model: string
  sentBytes: number
  error: string
}

const initial: TranslationSessionState = {
  instanceId: null,
  scan: null,
  fileIds: [],
  translations: {},
  failed: [],
  busy: false,
  progress: { done: 0, total: 0 },
  phase: 'select',
  warnings: [],
  model: '',
  sentBytes: 0,
  error: ''
}

let snapshot: TranslationSessionState = initial
const listeners = new Set<() => void>()
let cancelRequested = false
let generation = 0

function set(patch: Partial<TranslationSessionState>): void {
  snapshot = { ...snapshot, ...patch }
  for (const listener of listeners) listener()
}

export function subscribeTranslationSession(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getTranslationSessionSnapshot(): TranslationSessionState {
  return snapshot
}

export function useTranslationSession(): TranslationSessionState {
  return useSyncExternalStore(
    subscribeTranslationSession,
    getTranslationSessionSnapshot,
    getTranslationSessionSnapshot
  )
}

function chunkItems(
  segments: TranslationSegmentView[],
  maxItems = 24,
  maxChars = 5200
): TranslationSegmentView[][] {
  const batches: TranslationSegmentView[][] = []
  let batch: TranslationSegmentView[] = []
  let chars = 0
  for (const segment of segments) {
    if (
      batch.length >= maxItems ||
      (batch.length > 0 && chars + segment.source.length > maxChars)
    ) {
      batches.push(batch)
      batch = []
      chars = 0
    }
    batch.push(segment)
    chars += segment.source.length
  }
  if (batch.length > 0) batches.push(batch)
  return batches
}

function segmentsOf(
  scan: TranslationScanResult,
  fileIds: string[],
  failedOnly: boolean
): TranslationSegmentView[] {
  const selected = new Set(fileIds)
  const failed = new Set(snapshot.failed)
  return scan.files
    .filter((file) => selected.has(file.id))
    .flatMap((file) => file.segments)
    .filter((segment) =>
      failedOnly ? failed.has(segment.id) : !snapshot.translations[segment.id] && !failed.has(segment.id)
    )
}

async function run(
  instanceId: string,
  scan: TranslationScanResult,
  fileIds: string[],
  glossary: TranslationGlossaryEntry[],
  retryOnly: boolean
): Promise<void> {
  if (snapshot.busy) return
  const currentGeneration = ++generation
  cancelRequested = false
  const existingTranslations =
    snapshot.instanceId === instanceId ? { ...snapshot.translations } : {}
  const existingFailed =
    snapshot.instanceId === instanceId ? new Set(snapshot.failed) : new Set<string>()
  const pendingBase = segmentsOf(scan, fileIds, retryOnly)
  if (pendingBase.length === 0) {
    set({
      instanceId,
      scan,
      fileIds,
      translations: existingTranslations,
      failed: [...existingFailed],
      busy: false,
      phase: 'review',
      progress: { done: 0, total: 0 },
      error: ''
    })
    return
  }
  const pending = retryOnly
    ? pendingBase
    : pendingBase.filter((segment) => !existingFailed.has(segment.id))
  if (pending.length === 0) {
    set({
      instanceId,
      scan,
      fileIds,
      translations: existingTranslations,
      failed: [...existingFailed],
      busy: false,
      phase: 'review',
      progress: { done: 0, total: 0 },
      error: ''
    })
    return
  }

  set({
    instanceId,
    scan,
    fileIds,
    translations: existingTranslations,
    failed: [...existingFailed],
    busy: true,
    phase: 'select',
    progress: { done: 0, total: pending.length },
    warnings: [],
    model: '',
    sentBytes: 0,
    error: ''
  })

  const translations = existingTranslations
  const failed = new Set(existingFailed)
  const warnings: string[] = []
  let done = 0
  let bytes = 0
  let model = ''
  let stopped = false
  const glossaryIndex = buildGlossaryIndex(glossary)
  for (const batch of chunkItems(pending)) {
    if (cancelRequested || generation !== currentGeneration) {
      stopped = true
      break
    }
    try {
      const result = await window.ccl.translation.translate({
        instanceId,
        glossary: selectRelevantGlossary(
          glossaryIndex,
          batch.map((segment) => segment.source)
        ),
        items: batch.map((segment) => ({
          id: segment.id,
          text: segment.source,
          field: `${segment.fileId} · ${segment.field}`,
          kind: segment.kind
        }))
      })
      const got = new Set<string>()
      for (const item of result.items) {
        translations[item.id] = item.text
        failed.delete(item.id)
        got.add(item.id)
      }
      for (const segment of batch) {
        if (!got.has(segment.id)) failed.add(segment.id)
      }
      warnings.push(...result.warnings)
      bytes += result.sentBytes
      if (result.model) model = result.model
    } catch (cause) {
      for (const segment of batch) failed.add(segment.id)
      if (generation !== currentGeneration) return
      const message = cause instanceof Error ? cause.message : '翻译请求失败'
      set({
        translations: { ...translations },
        failed: [...failed],
        busy: false,
        phase: 'review',
        warnings: [...new Set(warnings)].slice(0, 8),
        model,
        sentBytes: bytes,
        error: message
      })
      useLauncher.getState().toast('error', '汉化翻译中断', message)
      return
    }
    done += batch.length
    if (generation !== currentGeneration) return
    set({
      translations: { ...translations },
      failed: [...failed],
      progress: { done, total: pending.length },
      warnings: [...new Set(warnings)].slice(0, 8),
      model,
      sentBytes: bytes
    })
  }

  if (generation !== currentGeneration) return
  set({
    translations: { ...translations },
    failed: [...failed],
    busy: false,
    phase: 'review',
    progress: { done, total: pending.length },
    warnings: [...new Set(warnings)].slice(0, 8),
    model,
    sentBytes: bytes,
    error: ''
  })
  const translated = Object.keys(translations).length
  useLauncher
    .getState()
    .toast(
      stopped ? 'info' : failed.size > 0 ? 'info' : 'success',
      stopped ? '汉化翻译已暂停' : '汉化翻译完成',
      `${translated} 条已翻译${failed.size > 0 ? `，${failed.size} 条保留原文` : ''}`
    )
}

export function startTranslationSession(options: {
  instanceId: string
  scan: TranslationScanResult
  fileIds: string[]
  glossary: TranslationGlossaryEntry[]
}): Promise<void> {
  return run(options.instanceId, options.scan, options.fileIds, options.glossary, false)
}

export function retryTranslationSession(options: {
  instanceId: string
  scan: TranslationScanResult
  fileIds: string[]
  glossary: TranslationGlossaryEntry[]
}): Promise<void> {
  return run(options.instanceId, options.scan, options.fileIds, options.glossary, true)
}

export function cancelTranslationSession(): void {
  cancelRequested = true
}

export function resetTranslationSession(): void {
  generation += 1
  cancelRequested = true
  snapshot = initial
  for (const listener of listeners) listener()
}

export function markTranslationSessionApplied(): void {
  set({ phase: 'applied', busy: false })
}

export function clearTranslationSessionError(): void {
  if (snapshot.error) set({ error: '' })
}

export function setTranslationSessionItem(id: string, text: string): void {
  if (!id || !text.trim()) return
  set({
    translations: { ...snapshot.translations, [id]: text.trim() },
    failed: snapshot.failed.filter((item) => item !== id),
    phase: snapshot.phase === 'applied' ? 'review' : snapshot.phase
  })
}

export function translationFileById(
  fileId: string | null
): TranslationFileView | null {
  if (!fileId || !snapshot.scan) return null
  return snapshot.scan.files.find((file) => file.id === fileId) ?? null
}
