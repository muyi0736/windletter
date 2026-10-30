import { app } from 'electron'
import { createHash } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import { spawn } from 'node:child_process'
import { basename, dirname, join, resolve } from 'node:path'
import type {
  LauncherUpdateInfo,
  LauncherUpdateProgress,
  LauncherUpdateSource,
  LauncherUpdateState
} from '../../shared/types'
import { getCacheDir, getSettings } from './config'
import { CancellationError, downloadFile, NetworkError } from './net'

const MANIFEST_MAX_BYTES = 512 * 1024
const MANIFEST_TIMEOUT_MS = 20_000
const GITHUB_API_TIMEOUT_MS = 20_000
const GITHUB_API_MAX_BYTES = 1024 * 1024
const RELEASE_CACHE_MAX_BYTES = 64 * 1024
const AUTO_CHECK_CACHE_MS = 6 * 60 * 60_000
const RATE_LIMIT_MAX_BYTES = 4 * 1024
const RATE_LIMIT_MAX_AHEAD_MS = 24 * 60 * 60_000
const INSTALLER_MIN_BYTES = 1024 * 1024
const INSTALLER_MAX_BYTES = 2 * 1024 * 1024 * 1024
const UPDATE_DIR = 'updates'

interface ReleaseFile {
  info: LauncherUpdateInfo
  version: string
  urls: string[]
  size: number
  sha256: string
  source: LauncherUpdateSource
  /** API 返回或缓存写入的时间，用于显示“上次缓存”。 */
  fetchedAt: number
  rateLimitedUntil: number | null
}

interface GitHubReleaseSource {
  apiUrl: URL
  fallbackUrl: URL | null
}

interface RateLimitFile {
  schema: 1
  source: string
  until: number
}

class GitHubRateLimitError extends Error {
  constructor(
    message: string,
    readonly until: number
  ) {
    super(message)
    this.name = 'GitHubRateLimitError'
  }
}

interface CachedRelease {
  schema: 1
  source: string
  etag: string
  fetchedAt: number
  release: {
    version: string
    notes: string[]
    publishedAt: number | null
    size: number
    sha256: string
    urls: string[]
    pageUrl: string | null
  }
}

let state: LauncherUpdateState = createInitialState()
let availableRelease: ReleaseFile | null = null
let listener: ((next: LauncherUpdateState) => void) | null = null
let downloadController: AbortController | null = null
let progressTimer: ReturnType<typeof setInterval> | null = null
let checkSequence = 0
let downloading = false
let lastProgressEmit = 0

function createInitialState(): LauncherUpdateState {
  return {
    phase: 'idle',
    currentVersion: app.getVersion(),
    info: null,
    progress: { received: 0, total: 0, speed: 0, percent: null },
    error: null,
    checkedAt: null,
    source: null,
    rateLimitedUntil: null,
    silent: false
  }
}

function cloneInfo(info: LauncherUpdateInfo | null): LauncherUpdateInfo | null {
  return info ? { ...info, notes: [...info.notes] } : null
}

function snapshot(): LauncherUpdateState {
  return {
    ...state,
    info: cloneInfo(state.info),
    progress: { ...state.progress }
  }
}

function publish(): void {
  listener?.(snapshot())
}

function update(patch: Partial<LauncherUpdateState>, emit = true): void {
  state = { ...state, ...patch }
  if (emit) publish()
}

export function getLauncherUpdateState(): LauncherUpdateState {
  return snapshot()
}

export function setUpdaterListener(
  next: ((payload: LauncherUpdateState) => void) | null
): void {
  listener = next
}

function busy(): boolean {
  return (
    state.phase === 'checking' ||
    state.phase === 'downloading' ||
    state.phase === 'verifying' ||
    state.phase === 'installing' ||
    downloading
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.endsWith('.localhost')
  )
}

/** 只允许 HTTPS；本机测试额外允许 localhost 的 HTTP。 */
function assertRemoteUrl(raw: string, label: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`${label}不是有效的网址`)
  }
  if (url.username || url.password) throw new Error(`${label}不能包含账号或密码`)
  if (url.protocol === 'https:') return url
  if (url.protocol === 'http:' && isLoopback(url.hostname)) return url
  throw new Error(`${label}必须使用 HTTPS（本机测试可使用 localhost）`)
}

/**
 * GitHub Release 页面或 latest.json 地址可自动改用官方 API：
 * 当前网络里 github.com 可能超时，但 api.github.com 与资产域名通常仍可访问。
 */
function githubReleaseSource(feedUrl: URL): GitHubReleaseSource | null {
  const host = feedUrl.hostname.toLowerCase()
  const validName = (value: string): boolean => /^[A-Za-z0-9_.-]{1,100}$/.test(value)
  if (host === 'api.github.com') {
    const match = /^\/repos\/([^/]+)\/([^/]+)\/releases\/latest\/?$/.exec(feedUrl.pathname)
    if (!match || !validName(match[1]) || !validName(match[2])) return null
    const owner = match[1]
    const repo = match[2]
    return {
      apiUrl: new URL(`https://api.github.com/repos/${owner}/${repo}/releases/latest`),
      fallbackUrl: new URL(
        `https://github.com/${owner}/${repo}/releases/latest/download/latest.json`
      )
    }
  }
  if (host !== 'github.com' && host !== 'www.github.com') return null
  const match =
    /^\/([^/]+)\/([^/]+)\/releases(?:\/latest(?:\/download\/[^/]+)?)?\/?$/.exec(
      feedUrl.pathname
    )
  if (!match || !validName(match[1]) || !validName(match[2])) return null
  const owner = match[1]
  const repo = match[2]
  return {
    apiUrl: new URL(`https://api.github.com/repos/${owner}/${repo}/releases/latest`),
    fallbackUrl: /\.json$/i.test(feedUrl.pathname)
      ? new URL(feedUrl.toString())
      : new URL(
          `https://github.com/${owner}/${repo}/releases/latest/download/latest.json`
        )
  }
}

function resolveFeedUrl(raw: string): URL {
  const value = raw.trim()
  if (!value) throw new Error('尚未配置更新源，请先填写 latest.json 地址或所在目录')
  let url = assertRemoteUrl(value, '更新源地址')
  if (githubReleaseSource(url)) {
    url.hash = ''
    return url
  }
  if (!/\.json$/i.test(url.pathname)) {
    if (!url.pathname.endsWith('/')) url.pathname = `${url.pathname}/`
    url = new URL('latest.json', url)
  }
  url.hash = ''
  return url
}

function parseVersion(value: string): { numbers: number[]; pre: string[] | null } | null {
  const match = /^v?(\d{1,5})(?:\.(\d{1,5}))?(?:\.(\d{1,5}))?(?:-([0-9A-Za-z.-]{1,64}))?$/.exec(
    value.trim()
  )
  if (!match) return null
  return {
    numbers: [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)],
    pre: match[4] ? match[4].split('.') : null
  }
}

export function compareLauncherVersions(left: string, right: string): number {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (!a || !b) return 0
  for (let index = 0; index < 3; index += 1) {
    if (a.numbers[index] !== b.numbers[index]) {
      return a.numbers[index] > b.numbers[index] ? 1 : -1
    }
  }
  if (!a.pre && !b.pre) return 0
  if (!a.pre) return 1
  if (!b.pre) return -1
  const length = Math.max(a.pre.length, b.pre.length)
  for (let index = 0; index < length; index += 1) {
    const partA = a.pre[index]
    const partB = b.pre[index]
    if (partA == null) return -1
    if (partB == null) return 1
    const numberA = /^\d+$/.test(partA) ? Number(partA) : null
    const numberB = /^\d+$/.test(partB) ? Number(partB) : null
    if (numberA != null && numberB != null) {
      if (numberA !== numberB) return numberA > numberB ? 1 : -1
    } else if (numberA != null) {
      return -1
    } else if (numberB != null) {
      return 1
    } else if (partA !== partB) {
      return partA > partB ? 1 : -1
    }
  }
  return 0
}

function parseNotes(raw: unknown): string[] {
  const list = typeof raw === 'string' ? raw.split(/\r?\n/) : Array.isArray(raw) ? raw : []
  const notes: string[] = []
  for (const item of list) {
    if (typeof item !== 'string') continue
    const text = item.trim().replace(/^[-*]\s+/, '').replace(/^#{1,6}\s+/, '')
    if (!text) continue
    notes.push(text.slice(0, 600))
    if (notes.length >= 20) break
  }
  return notes
}

function parseManifest(raw: unknown, manifestUrl: URL): ReleaseFile {
  if (!isRecord(raw)) throw new Error('更新源返回的清单格式不正确')
  if (raw.schema !== 1) throw new Error('更新清单版本不受支持（需要 schema: 1）')
  if (String(raw.app ?? '').toLowerCase() !== 'windletter') {
    throw new Error('更新清单不属于风信启动器')
  }
  const version =
    typeof raw.version === 'string' ? raw.version.trim().slice(0, 64) : ''
  if (!version || !parseVersion(version)) throw new Error('更新清单的版本号无效')
  const sha256 = typeof raw.sha256 === 'string' ? raw.sha256.trim().toLowerCase() : ''
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error('更新清单缺少有效的 SHA-256 校验值')
  const size = Number(raw.size)
  if (
    !Number.isInteger(size) ||
    size < INSTALLER_MIN_BYTES ||
    size > INSTALLER_MAX_BYTES
  ) {
    throw new Error('更新清单的安装包大小无效')
  }
  if (typeof raw.url !== 'string' || !raw.url.trim()) {
    throw new Error('更新清单缺少安装包下载地址')
  }
  const rawUrls = [raw.url]
  if (Array.isArray(raw.mirrors)) {
    for (const mirror of raw.mirrors.slice(0, 5)) {
      if (typeof mirror === 'string') rawUrls.push(mirror)
    }
  }
  const urls: string[] = []
  for (const candidate of rawUrls) {
    let url: URL
    try {
      url = new URL(candidate.trim(), manifestUrl)
    } catch {
      throw new Error('更新清单的安装包地址无效')
    }
    const checked = assertRemoteUrl(url.toString(), '安装包地址')
    if (!urls.includes(checked.toString())) urls.push(checked.toString())
  }
  if (urls.length === 0) throw new Error('更新清单缺少安装包下载地址')

  let pageUrl: string | null = null
  if (typeof raw.pageUrl === 'string' && raw.pageUrl.trim()) {
    try {
      pageUrl = assertRemoteUrl(raw.pageUrl.trim(), '发布页地址').toString()
    } catch {
      pageUrl = null
    }
  }
  const publishedAtRaw = typeof raw.publishedAt === 'string' ? Date.parse(raw.publishedAt) : NaN
  const publishedAt = Number.isFinite(publishedAtRaw) ? publishedAtRaw : null
  const notes = parseNotes(raw.notes)
  return {
    version,
    urls,
    size,
    sha256,
    source: 'manifest',
    fetchedAt: Date.now(),
    rateLimitedUntil: null,
    info: {
      version,
      notes,
      publishedAt,
      size,
      mandatory: raw.mandatory === true,
      pageUrl
    }
  }
}

function githubApiError(status: number, remaining: string | null): Error {
  if (status === 403 && remaining === '0') {
    return new Error('GitHub API 请求次数已达上限（每小时 60 次），请稍后再试')
  }
  if (status === 429) return new Error('GitHub API 请求过于频繁，请稍后再试')
  if (status === 404) return new Error('GitHub Release 不存在，或仓库不是公开仓库')
  return new Error(`GitHub API 返回 HTTP ${status}`)
}

/**
 * 用 GitHub Release 元数据直接生成更新信息，避免请求 github.com。
 * Release body 作为更新说明，安装包大小与 SHA-256 来自官方 asset digest。
 */
async function fetchGitHubRelease(
  source: GitHubReleaseSource,
  cache: CachedRelease | null
): Promise<ReleaseFile> {
  const headers: Record<string, string> = {
    'User-Agent': `WindletterLauncher/${app.getVersion()}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  }
  if (cache?.etag) headers['If-None-Match'] = cache.etag
  const response = await fetch(source.apiUrl, {
    headers,
    redirect: 'follow',
    signal: AbortSignal.timeout(GITHUB_API_TIMEOUT_MS)
  })
  if (response.status === 304) {
    if (!cache) throw new Error('GitHub API 返回 304，但没有可用缓存')
    // 304 表示 Release 没有变化，可直接复用已验证的缓存，节省清单传输。
    const refreshed = { ...cache, fetchedAt: Date.now() }
    const release = cachedToRelease(refreshed, 'api', refreshed.fetchedAt)
    await clearRateLimit(source.apiUrl.toString())
    await writeReleaseCache(source.apiUrl.toString(), cache.etag, release)
    return release
  }
  if (!response.ok) {
    const remaining = response.headers.get('x-ratelimit-remaining')
    if (response.status === 429 || (response.status === 403 && remaining === '0')) {
      const parsed = parseRateLimitUntil(response.headers)
      const until = parsed && parsed > Date.now() ? parsed : Date.now() + 60 * 60_000
      await writeRateLimit(source.apiUrl.toString(), until)
      throw new GitHubRateLimitError(
        `GitHub API 限额，${formatRateLimitTime(until)} 后恢复`,
        until
      )
    }
    throw githubApiError(response.status, remaining)
  }
  const etag = response.headers.get('etag') ?? ''
  const declared = Number(response.headers.get('content-length') ?? 0)
  if (declared > GITHUB_API_MAX_BYTES) throw new Error('GitHub Release 信息过大，已拒绝读取')
  const text = await response.text()
  if (Buffer.byteLength(text, 'utf8') > GITHUB_API_MAX_BYTES) {
    throw new Error('GitHub Release 信息过大，已拒绝读取')
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('GitHub API 返回的不是有效 JSON')
  }
  if (!isRecord(raw)) throw new Error('GitHub Release 数据格式不正确')

  const version = String(raw.tag_name ?? '')
    .trim()
    .replace(/^v/i, '')
    .slice(0, 64)
  if (!version || !parseVersion(version)) throw new Error('GitHub Release 的版本号无效')

  const assets = Array.isArray(raw.assets) ? raw.assets.filter(isRecord) : []
  const exeAssets = assets.filter(
    (asset) => typeof asset.name === 'string' && /\.exe$/i.test(asset.name)
  )
  const installer =
    exeAssets.find((asset) =>
      /^Windletter-Launcher-.*-setup\.exe$/i.test(String(asset.name))
    ) ?? exeAssets[0]
  if (!installer) throw new Error('GitHub Release 中没有 Windows 安装包')

  const size = Number(installer.size)
  if (
    !Number.isInteger(size) ||
    size < INSTALLER_MIN_BYTES ||
    size > INSTALLER_MAX_BYTES
  ) {
    throw new Error('GitHub Release 的安装包大小无效')
  }
  const digest = typeof installer.digest === 'string' ? installer.digest.trim().toLowerCase() : ''
  const digestMatch = /^sha256:([0-9a-f]{64})$/.exec(digest)
  if (!digestMatch) {
    throw new Error('GitHub Release 未提供安装包 SHA-256，无法校验')
  }
  const sha256 = digestMatch[1]

  const urls: string[] = []
  if (typeof installer.url === 'string' && installer.url.trim()) {
    const assetUrl = assertRemoteUrl(installer.url.trim(), 'GitHub 安装包地址')
    if (assetUrl.hostname.toLowerCase() !== 'api.github.com') {
      throw new Error('GitHub 安装包地址不在官方 API 域名')
    }
    urls.push(assetUrl.toString())
  }
  if (
    typeof installer.browser_download_url === 'string' &&
    installer.browser_download_url.trim()
  ) {
    try {
      const browserUrl = assertRemoteUrl(
        installer.browser_download_url.trim(),
        'GitHub 安装包地址'
      )
      const browser = browserUrl.toString()
      // 官方 API 资产在部分网络很慢；镜像只负责搬运，完整性仍由上面的官方 digest 校验。
      for (const prefix of ['https://ghfast.top/', 'https://gh-proxy.com/']) {
        try {
          const mirror = assertRemoteUrl(`${prefix}${browser}`, 'GitHub 安装包镜像')
          if (!urls.includes(mirror.toString())) urls.push(mirror.toString())
        } catch {
          /* 忽略不可用的镜像地址 */
        }
      }
      if (!urls.includes(browser)) urls.push(browser)
    } catch {
      /* 浏览地址只作为备用，不合法时忽略 */
    }
  }
  if (urls.length === 0) throw new Error('GitHub Release 缺少安装包下载地址')

  let pageUrl: string | null = null
  if (typeof raw.html_url === 'string' && raw.html_url.trim()) {
    try {
      pageUrl = assertRemoteUrl(raw.html_url.trim(), '发布页地址').toString()
    } catch {
      pageUrl = null
    }
  }
  const publishedAtRaw =
    typeof raw.published_at === 'string' ? Date.parse(raw.published_at) : NaN
  const release: ReleaseFile = {
    version,
    urls,
    size,
    sha256,
    source: 'api',
    fetchedAt: Date.now(),
    rateLimitedUntil: null,
    info: {
      version,
      notes: parseNotes(raw.body),
      publishedAt: Number.isFinite(publishedAtRaw) ? publishedAtRaw : null,
      size,
      mandatory: false,
      pageUrl
    }
  }
  await clearRateLimit(source.apiUrl.toString())
  await writeReleaseCache(source.apiUrl.toString(), etag, release)
  return release
}

function rateLimitPath(): string {
  return join(getCacheDir(), 'updater-rate-limit.json')
}

function formatRateLimitTime(until: number): string {
  return new Date(until).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function parseRateLimitUntil(headers: { get(name: string): string | null }): number | null {
  const now = Date.now()
  const retryAfter = Number(headers.get('retry-after'))
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return now + retryAfter * 1000
  }
  const reset = Number(headers.get('x-ratelimit-reset'))
  if (Number.isFinite(reset) && reset > 0) {
    return reset * 1000
  }
  return null
}

async function readRateLimit(sourceUrl: string): Promise<number | null> {
  try {
    const rawText = await fs.readFile(rateLimitPath(), 'utf8')
    if (Buffer.byteLength(rawText, 'utf8') > RATE_LIMIT_MAX_BYTES) return null
    const raw: unknown = JSON.parse(rawText)
    if (!isRecord(raw) || raw.schema !== 1 || raw.source !== sourceUrl) return null
    const until = Number(raw.until)
    if (!Number.isFinite(until) || until <= Date.now()) {
      await clearRateLimit(sourceUrl)
      return null
    }
    return Math.min(until, Date.now() + RATE_LIMIT_MAX_AHEAD_MS)
  } catch {
    return null
  }
}

async function writeRateLimit(sourceUrl: string, until: number): Promise<void> {
  const now = Date.now()
  const safeUntil = Math.max(
    now + 60_000,
    Math.min(until, now + RATE_LIMIT_MAX_AHEAD_MS)
  )
  const payload: RateLimitFile = { schema: 1, source: sourceUrl, until: safeUntil }
  try {
    const target = rateLimitPath()
    await fs.mkdir(dirname(target), { recursive: true })
    const temp = `${target}.tmp`
    await fs.writeFile(temp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    await fs.rename(temp, target)
  } catch {
    /* 退避写入失败时仍按本次响应处理 */
  }
}

async function clearRateLimit(sourceUrl: string): Promise<void> {
  try {
    const rawText = await fs.readFile(rateLimitPath(), 'utf8')
    const raw: unknown = JSON.parse(rawText)
    if (!isRecord(raw) || raw.source !== sourceUrl) return
    await fs.rm(rateLimitPath(), { force: true })
  } catch {
    /* no file */
  }
}

function releaseCachePath(): string {
  return join(getCacheDir(), 'updater-release-cache.json')
}

function cachedToRelease(
  cache: CachedRelease,
  source: LauncherUpdateSource,
  fetchedAt: number,
  rateLimitedUntil: number | null = null
): ReleaseFile {
  return {
    version: cache.release.version,
    urls: [...cache.release.urls],
    size: cache.release.size,
    sha256: cache.release.sha256,
    source,
    fetchedAt,
    rateLimitedUntil,
    info: {
      version: cache.release.version,
      notes: [...cache.release.notes],
      publishedAt: cache.release.publishedAt,
      size: cache.release.size,
      mandatory: false,
      pageUrl: cache.release.pageUrl
    }
  }
}

async function readReleaseCache(apiUrl: string): Promise<CachedRelease | null> {
  try {
    const target = releaseCachePath()
    const rawText = await fs.readFile(target, 'utf8')
    if (Buffer.byteLength(rawText, 'utf8') > RELEASE_CACHE_MAX_BYTES) return null
    const raw: unknown = JSON.parse(rawText)
    if (!isRecord(raw) || raw.schema !== 1 || raw.source !== apiUrl) return null
    if (!isRecord(raw.release)) return null
    const value = raw.release
    const version =
      typeof value.version === 'string' ? value.version.trim().slice(0, 64) : ''
    if (!version || !parseVersion(version)) return null
    const sha256 =
      typeof value.sha256 === 'string' ? value.sha256.trim().toLowerCase() : ''
    if (!/^[0-9a-f]{64}$/.test(sha256)) return null
    const size = Number(value.size)
    if (
      !Number.isInteger(size) ||
      size < INSTALLER_MIN_BYTES ||
      size > INSTALLER_MAX_BYTES
    ) {
      return null
    }
    const fetchedAt = Number(raw.fetchedAt)
    if (!Number.isFinite(fetchedAt) || fetchedAt <= 0) return null
    const etag = typeof raw.etag === 'string' ? raw.etag.slice(0, 300) : ''
    const urls: string[] = []
    if (Array.isArray(value.urls)) {
      for (const item of value.urls.slice(0, 5)) {
        if (typeof item !== 'string') continue
        try {
          const checked = assertRemoteUrl(item, '缓存安装包地址')
          if (!urls.includes(checked.toString())) urls.push(checked.toString())
        } catch {
          /* ignore invalid cached URL */
        }
      }
    }
    if (urls.length === 0) return null
    let pageUrl: string | null = null
    if (typeof value.pageUrl === 'string' && value.pageUrl.trim()) {
      try {
        pageUrl = assertRemoteUrl(value.pageUrl.trim(), '发布页地址').toString()
      } catch {
        pageUrl = null
      }
    }
    const publishedAt =
      typeof value.publishedAt === 'number' && Number.isFinite(value.publishedAt)
        ? value.publishedAt
        : null
    return {
      schema: 1,
      source: apiUrl,
      etag,
      fetchedAt,
      release: {
        version,
        notes: parseNotes(value.notes),
        publishedAt,
        size,
        sha256,
        urls,
        pageUrl
      }
    }
  } catch {
    return null
  }
}

async function writeReleaseCache(
  apiUrl: string,
  etag: string,
  release: ReleaseFile
): Promise<void> {
  const target = releaseCachePath()
  const payload: CachedRelease = {
    schema: 1,
    source: apiUrl,
    etag: etag.slice(0, 300),
    fetchedAt: release.fetchedAt,
    release: {
      version: release.version,
      notes: [...release.info.notes],
      publishedAt: release.info.publishedAt,
      size: release.size,
      sha256: release.sha256,
      urls: [...release.urls],
      pageUrl: release.info.pageUrl
    }
  }
  try {
    await fs.mkdir(dirname(target), { recursive: true })
    const temp = `${target}.tmp`
    await fs.writeFile(temp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    await fs.rename(temp, target)
  } catch {
    /* 缓存失败不影响本次检查 */
  }
}

async function fetchLatestManifest(
  feedUrl: URL,
  timeoutMs = MANIFEST_TIMEOUT_MS
): Promise<ReleaseFile> {
  const response = await fetch(feedUrl, {
    headers: {
      'User-Agent': `WindletterLauncher/${app.getVersion()}`,
      Accept: 'application/json'
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs)
  })
  if (!response.ok) throw new Error(`更新源返回 HTTP ${response.status}`)
  const finalUrl = response.url ? assertRemoteUrl(response.url, '更新源地址') : feedUrl
  const declared = Number(response.headers.get('content-length') ?? 0)
  if (declared > MANIFEST_MAX_BYTES) throw new Error('更新清单过大，已拒绝读取')
  const text = await response.text()
  if (Buffer.byteLength(text, 'utf8') > MANIFEST_MAX_BYTES) {
    throw new Error('更新清单过大，已拒绝读取')
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('更新源返回的不是有效的 JSON 清单')
  }
  return parseManifest(raw, finalUrl)
}

async function fetchManifest(
  feedUrl: URL,
  allowFreshCache = false
): Promise<ReleaseFile> {
  const github = githubReleaseSource(feedUrl)
  if (!github) return fetchLatestManifest(feedUrl)
  const apiUrl = github.apiUrl.toString()
  const cache = await readReleaseCache(apiUrl)
  const rateLimitUntil = await readRateLimit(apiUrl)
  const now = Date.now()
  if (rateLimitUntil && rateLimitUntil > now) {
    if (cache) {
      return cachedToRelease(cache, 'cache', cache.fetchedAt, rateLimitUntil)
    }
    throw new GitHubRateLimitError(
      `GitHub API 限额，${formatRateLimitTime(rateLimitUntil)} 后恢复`,
      rateLimitUntil
    )
  }
  if (allowFreshCache && cache && now - cache.fetchedAt < AUTO_CHECK_CACHE_MS) {
    return cachedToRelease(cache, 'cache', cache.fetchedAt)
  }
  try {
    return await fetchGitHubRelease(github, cache)
  } catch (error) {
    const apiMessage = error instanceof Error ? error.message : 'GitHub API 请求失败'
    const until = error instanceof GitHubRateLimitError ? error.until : null
    if (!github.fallbackUrl && !cache) throw error
    if (github.fallbackUrl) {
      console.warn(`[updater] GitHub API 不可用，尝试 latest.json：${apiMessage}`)
      try {
        const manifest = await fetchLatestManifest(github.fallbackUrl, 8_000)
        // 清单通常比旧缓存新；写回缓存，避免下一次静默检查又用旧版本。
        await writeReleaseCache(apiUrl, '', manifest)
        return manifest
      } catch (fallbackError) {
        const fallbackMessage =
          fallbackError instanceof Error ? fallbackError.message : '清单请求失败'
        if (cache) {
          console.warn(
            `[updater] 清单也不可用，使用 ${new Date(cache.fetchedAt).toISOString()} 的缓存：${fallbackMessage}`
          )
          return cachedToRelease(cache, 'cache', cache.fetchedAt, until)
        }
        throw new Error(
          `GitHub API 不可用（${apiMessage}），备用清单也无法访问（${fallbackMessage}）`
        )
      }
    }
    if (cache) return cachedToRelease(cache, 'cache', cache.fetchedAt, until)
    throw error
  }
}

function friendlyUpdateError(error: unknown): string {
  if (error instanceof CancellationError) return '操作已取消'
  let message =
    error instanceof NetworkError
      ? error.message
      : error instanceof Error
        ? error.message
        : '更新操作失败'
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    message = '连接更新源超时，请检查网络后重试'
  }
  const cause = (error as { cause?: { code?: string; message?: string } } | null)?.cause
  const code = cause?.code ?? ''
  if (error instanceof TypeError || /fetch failed/i.test(message)) {
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
      message = '无法解析更新源域名，请检查网络或更新源地址'
    } else if (code === 'ECONNREFUSED' || code === 'ECONNRESET') {
      message = '无法连接更新源，请检查地址是否可访问'
    } else if (code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ETIMEDOUT') {
      message = '连接更新源超时，请检查网络后重试'
    } else if (/CERT|TLS|SSL/i.test(code)) {
      message = '更新源 HTTPS 证书校验失败'
    } else {
      message = '无法连接更新源，请检查网络或更新源地址'
    }
  }
  message = message.replace(/https?:\/\/\S+/gi, '[更新源]').replace(/\s+/g, ' ').trim()
  return message.slice(0, 300) || '更新操作失败'
}

function updateDir(): string {
  return join(getCacheDir(), UPDATE_DIR)
}

function safeVersionName(version: string): string {
  return version.replace(/[^0-9A-Za-z._-]/g, '_').slice(0, 64) || 'latest'
}

function installerPath(version: string): string {
  const dir = updateDir()
  const target = resolve(dir, `Windletter-Launcher-${safeVersionName(version)}-setup.exe`)
  if (!target.startsWith(`${resolve(dir)}\\`) && !target.startsWith(`${resolve(dir)}/`)) {
    throw new Error('更新文件路径无效')
  }
  return target
}

async function removeDownloadArtifacts(target: string): Promise<void> {
  const prefix = basename(target)
  const dir = dirname(target)
  let entries: string[] = []
  try {
    entries = await fs.readdir(dir)
  } catch {
    return
  }
  await Promise.all(
    entries
      .filter((entry) => entry === prefix || entry.startsWith(`${prefix}.`))
      .map((entry) => fs.rm(join(dir, entry), { recursive: true, force: true }).catch(() => undefined))
  )
}

async function cleanupUpdateFiles(keep?: string): Promise<void> {
  const dir = updateDir()
  let entries: string[] = []
  try {
    entries = await fs.readdir(dir)
  } catch {
    return
  }
  const keepName = keep ? basename(keep) : ''
  await Promise.all(
    entries
      .filter((entry) => {
        if (!keepName) return true
        return entry !== keepName && !entry.startsWith(`${keepName}.`)
      })
      .map((entry) => fs.rm(join(dir, entry), { recursive: true, force: true }).catch(() => undefined))
  )
}

async function fileSize(path: string): Promise<number> {
  try {
    return (await fs.stat(path)).size
  } catch {
    return 0
  }
}

/** 单连接 `.part` 或分片 `.part.segN` 已落盘字节，用于续传时的真实进度。 */
async function partialBytes(target: string, total: number): Promise<number> {
  const part = `${target}.part`
  const single = await fileSize(part)
  if (single > 0) return Math.min(total, single)
  try {
    const meta = JSON.parse(await fs.readFile(`${part}.segments.json`, 'utf8')) as {
      count?: unknown
    }
    const count = Number(meta.count)
    if (!Number.isInteger(count) || count < 1 || count > 64) return 0
    let sum = 0
    for (let index = 0; index < count; index += 1) {
      sum += await fileSize(`${part}.seg${index}`)
    }
    return Math.min(total, sum)
  } catch {
    return 0
  }
}

async function sha256File(path: string): Promise<string> {
  return await new Promise((resolveHash, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolveHash(hash.digest('hex')))
  })
}

function percentOf(received: number, total: number): number | null {
  if (!total) return null
  return Math.max(0, Math.min(100, Math.round((received / total) * 1000) / 10))
}

function emitProgressTimed(force = false): void {
  const now = Date.now()
  if (!force && now - lastProgressEmit < 350) return
  lastProgressEmit = now
  publish()
}

export async function checkForLauncherUpdate(silent = false): Promise<LauncherUpdateState> {
  if (busy()) return snapshot()
  const sequence = ++checkSequence
  update({
    phase: 'checking',
    silent,
    error: null,
    source: null,
    rateLimitedUntil: null,
    progress: { ...state.progress, speed: 0 }
  })
  try {
    const feed = resolveFeedUrl(getSettings().updateFeed)
    const release = await fetchManifest(feed, silent)
    if (sequence !== checkSequence) return snapshot()
    const comparison = compareLauncherVersions(release.version, app.getVersion())
    if (comparison > 0) {
      const sameRelease = availableRelease?.version === release.version
      availableRelease = release
      const keepReady = sameRelease && state.phase === 'ready'
      const keepCancelled = sameRelease && state.phase === 'cancelled'
      update({
        phase: keepReady ? 'ready' : keepCancelled ? 'cancelled' : 'available',
        info: release.info,
        error: null,
        checkedAt: release.fetchedAt,
        source: release.source,
        rateLimitedUntil: release.rateLimitedUntil,
        silent,
        progress: keepReady || keepCancelled
          ? state.progress
          : {
              received: 0,
              total: release.size,
              speed: 0,
              percent: 0
            }
      })
    } else {
      availableRelease = null
      update({
        phase: 'up-to-date',
        info: release.info,
        error: null,
        checkedAt: release.fetchedAt,
        source: release.source,
        rateLimitedUntil: release.rateLimitedUntil,
        silent,
        progress: { received: 0, total: release.size, speed: 0, percent: 0 }
      })
      void cleanupUpdateFiles()
    }
  } catch (error) {
    if (sequence !== checkSequence) return snapshot()
    availableRelease = null
    update({
      phase: 'error',
      info: null,
      error: friendlyUpdateError(error),
      checkedAt: Date.now(),
      source: null,
      rateLimitedUntil: error instanceof GitHubRateLimitError ? error.until : null,
      silent,
      progress: { received: 0, total: 0, speed: 0, percent: null }
    })
  }
  return snapshot()
}

export async function downloadLauncherUpdate(): Promise<LauncherUpdateState> {
  if (downloading || state.phase === 'verifying' || state.phase === 'installing') {
    return snapshot()
  }
  const release = availableRelease
  if (!release || !state.info) {
    update({ phase: 'error', error: '没有可下载的更新，请先检查更新' })
    return snapshot()
  }
  if (state.phase === 'ready') return snapshot()
  const target = installerPath(release.version)
  await fs.mkdir(dirname(target), { recursive: true })
  await cleanupUpdateFiles(target)
  downloading = true
  const controller = new AbortController()
  downloadController = controller
  const base = await partialBytes(target, release.size)
  let transferred = 0
  let speedWindowStart = Date.now()
  let speedWindowBytes = 0
  let lastByteAt = Date.now()
  let completed = false
  let artifactsRemoved = false
  lastProgressEmit = 0
  update({
    phase: 'downloading',
    info: release.info,
    error: null,
    silent: false,
    progress: {
      received: base,
      total: release.size,
      speed: 0,
      percent: percentOf(base, release.size)
    }
  })
  if (progressTimer) clearInterval(progressTimer)
  progressTimer = setInterval(() => {
    if (!downloading) return
    if (Date.now() - lastByteAt > 1500 && state.progress.speed !== 0) {
      state = { ...state, progress: { ...state.progress, speed: 0 } }
      publish()
    }
  }, 900)

  try {
    await downloadFile([...release.urls], target, {
      size: release.size,
      signal: controller.signal,
      probeSources: release.urls.length > 1,
      probeBytes: release.size >= 32 * 1024 * 1024 ? 256 * 1024 : 0,
      onBytes: (bytes) => {
        transferred += bytes
        lastByteAt = Date.now()
        const now = Date.now()
        if (now - speedWindowStart >= 400) {
          const elapsed = (now - speedWindowStart) / 1000
          const speed = elapsed > 0 ? (transferred - speedWindowBytes) / elapsed : 0
          speedWindowStart = now
          speedWindowBytes = transferred
          const received = Math.min(release.size, base + transferred)
          state = {
            ...state,
            progress: {
              received,
              total: release.size,
              speed: Math.max(0, speed),
              percent: percentOf(received, release.size)
            }
          }
          emitProgressTimed()
        }
      }
    })
    completed = true
    update({
      phase: 'verifying',
      progress: {
        received: release.size,
        total: release.size,
        speed: 0,
        percent: 100
      }
    })
    const actualSize = await fileSize(target)
    if (actualSize !== release.size) {
      await removeDownloadArtifacts(target)
      artifactsRemoved = true
      throw new Error('安装包大小与清单不一致，已删除下载文件')
    }
    const digest = await sha256File(target)
    if (digest.toLowerCase() !== release.sha256) {
      await removeDownloadArtifacts(target)
      artifactsRemoved = true
      throw new Error('安装包 SHA-256 校验失败，已删除下载文件')
    }
    update({
      phase: 'ready',
      info: release.info,
      error: null,
      checkedAt: Date.now(),
      progress: {
        received: release.size,
        total: release.size,
        speed: 0,
        percent: 100
      }
    })
  } catch (error) {
    if (error instanceof CancellationError || controller.signal.aborted) {
      const partial = await partialBytes(target, release.size)
      update({
        phase: 'cancelled',
        info: release.info,
        error: null,
        progress: {
          received: partial,
          total: release.size,
          speed: 0,
          percent: percentOf(partial, release.size)
        }
      })
    } else {
      const partial = artifactsRemoved
        ? 0
        : completed
          ? release.size
          : await partialBytes(target, release.size)
      update({
        phase: 'error',
        info: release.info,
        error: friendlyUpdateError(error),
        progress: {
          received: partial,
          total: release.size,
          speed: 0,
          percent: percentOf(partial, release.size)
        }
      })
    }
  } finally {
    downloading = false
    if (downloadController === controller) downloadController = null
    if (progressTimer) {
      clearInterval(progressTimer)
      progressTimer = null
    }
  }
  return snapshot()
}

export function cancelLauncherUpdate(): LauncherUpdateState {
  if (state.phase === 'downloading') downloadController?.abort()
  return snapshot()
}

export async function installLauncherUpdate(): Promise<LauncherUpdateState> {
  if (process.platform !== 'win32') {
    update({ phase: 'error', error: '当前系统暂不支持自动安装更新' })
    return snapshot()
  }
  if (state.phase === 'installing' || state.phase === 'verifying') return snapshot()
  const release = availableRelease
  if (!release || !state.info) {
    update({ phase: 'error', error: '没有可安装的更新，请先检查并下载更新' })
    return snapshot()
  }
  if (state.phase !== 'ready') {
    update({ phase: 'error', error: '安装包尚未下载完成，请先下载更新' })
    return snapshot()
  }
  const target = installerPath(release.version)
  update({
    phase: 'verifying',
    error: null,
    progress: { received: release.size, total: release.size, speed: 0, percent: 100 }
  })
  try {
    const actualSize = await fileSize(target)
    if (actualSize !== release.size) throw new Error('安装包不存在或大小异常，请重新下载')
    const digest = await sha256File(target)
    if (digest.toLowerCase() !== release.sha256) {
      await removeDownloadArtifacts(target)
      throw new Error('安装包校验失败，已删除损坏文件，请重新下载')
    }
    update({ phase: 'installing', error: null })
    await new Promise<void>((resolveSpawn, rejectSpawn) => {
      const child = spawn(target, ['--updated', '/S', '--force-run'], {
        cwd: dirname(target),
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      })
      child.once('error', (error) => rejectSpawn(error))
      child.once('spawn', () => {
        child.unref()
        resolveSpawn()
      })
    })
    setTimeout(() => app.quit(), 700)
  } catch (error) {
    update({
      phase: 'error',
      error: friendlyUpdateError(error),
      progress: { received: 0, total: release.size, speed: 0, percent: 0 }
    })
  }
  return snapshot()
}
