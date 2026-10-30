import { randomUUID } from 'node:crypto'
import type {
  AccountsPayload,
  AuthCheckStage,
  AuthCheckStep,
  AuthDiagnosticView,
  AuthVerdict,
  MsDeviceCode,
  MsPollResult,
  StoredAccount
} from '../../shared/types'
import {
  accountsPayload,
  getSettings,
  listStoredAccounts,
  offlineUuid,
  removeAccount as removeStoredAccount,
  saveAccount,
  setActiveAccount,
  updateSettings
} from './config'
import { USER_AGENT } from './net'

const DEVICE_CODE_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode'
const TOKEN_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token'
const XBL_AUTH_URL = 'https://user.auth.xboxlive.com/user/authenticate'
const XSTS_URL = 'https://xsts.auth.xboxlive.com/xsts/authorize'
const MC_LOGIN_URL = 'https://api.minecraftservices.com/authentication/login_with_xbox'
const MC_PROFILE_URL = 'https://api.minecraftservices.com/minecraft/profile'
const SCOPE = 'XboxLive.signin offline_access'

interface DeviceSession {
  id: string
  clientId: string
  deviceCode: string
  interval: number
  expiresAt: number
  lastPoll: number
}

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  error?: string
  error_description?: string
  user_code?: string
  device_code?: string
  verification_uri?: string
  message?: string
  interval?: number
}

const STAGE_LABELS: Record<AuthCheckStage, string> = {
  oauth: 'Microsoft OAuth 设备代码',
  xbox: 'Xbox Live 用户认证',
  xsts: 'XSTS 授权',
  minecraft: 'Minecraft Services 登录',
  profile: 'Minecraft 档案'
}

interface AuthTrace {
  clientId: string
  steps: AuthCheckStep[]
}

class AuthError extends Error {
  readonly diagnostic: AuthDiagnosticView

  constructor(message: string, diagnostic: AuthDiagnosticView) {
    super(message)
    this.name = 'AuthError'
    this.diagnostic = diagnostic
  }
}

const sessions = new Map<string, DeviceSession>()
let accountNotifier: ((payload: AccountsPayload) => void) | null = null

function shorten(value: unknown, max = 220): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const text = String(value).replace(/\s+/g, ' ').trim()
  if (!text) return undefined
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function readApiError(body: Record<string, unknown>): { code?: string; detail?: string } {
  return {
    code: shorten(body.errorMessage ?? body.error ?? body.XErr, 80),
    detail: shorten(
      body.error_description ?? body.errorMessage ?? body.message ?? body.path
    )
  }
}

function traceStep(
  trace: AuthTrace,
  stage: AuthCheckStage,
  status: AuthCheckStep['status'],
  httpStatus?: number,
  code?: string,
  detail?: string
): void {
  trace.steps.push({
    stage,
    label: STAGE_LABELS[stage],
    status,
    httpStatus,
    code: shorten(code, 80),
    detail: shorten(detail)
  })
}

function buildDiagnostic(trace: AuthTrace): AuthDiagnosticView {
  const failed = trace.steps.find((step) => step.status === 'fail')
  const profilePassed = trace.steps.some(
    (step) => step.stage === 'profile' && step.status === 'ok'
  )
  let verdict: AuthVerdict = 'passed'
  let summary = '认证链全部通过，这个 Client ID 已获准访问 Minecraft Services。'

  if (!profilePassed) {
    if (failed?.stage === 'minecraft' && failed.httpStatus === 403) {
      verdict = 'not-allowlisted'
      summary =
        'Minecraft Services 返回 403：这个 Client ID 尚未通过 allowlist，或审批结果还没有生效。'
    } else if (failed?.stage === 'profile' && failed.httpStatus === 404) {
      verdict = 'no-ownership'
      summary = '微软登录本身已通过，但该账户没有 Minecraft Java 版所有权。'
    } else if (failed) {
      verdict = 'failed'
      summary = `认证链在「${failed.label}」失败，请查看下方状态码。`
    } else {
      verdict = 'failed'
      summary = '认证链没有走完，请检查网络后重新自检。'
    }
  }

  return {
    at: Date.now(),
    clientId: trace.clientId,
    steps: trace.steps.slice(),
    verdict,
    summary
  }
}

export function setAccountNotifier(notifier: (payload: AccountsPayload) => void): void {
  accountNotifier = notifier
}

function broadcast(): AccountsPayload {
  const payload = accountsPayload()
  accountNotifier?.(payload)
  return payload
}

async function requestJson(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string }
): Promise<{ status: number; body: TokenResponse }> {
  let response: Response
  try {
    response = await fetch(url, {
      method: init.method ?? 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
        ...(init.headers ?? {})
      },
      body: init.body,
      signal: AbortSignal.timeout(30_000)
    })
  } catch {
    throw new Error('无法连接微软登录服务器，请检查网络连接')
  }
  let body: TokenResponse = {}
  try {
    body = (await response.json()) as TokenResponse
  } catch {
    /* ignore */
  }
  return { status: response.status, body }
}

async function postForm(url: string, values: Record<string, string>): Promise<{ status: number; body: TokenResponse }> {
  return requestJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(values).toString()
  })
}

async function postJson(url: string, payload: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const result = await requestJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  return { status: result.status, body: result.body as Record<string, unknown> }
}

function mapXstsError(xerr: unknown): string {
  const code = Number(xerr)
  switch (code) {
    case 2148916233:
      return '该微软账户还没有 Xbox 档案，请先登录 xbox.com 创建档案后重试'
    case 2148916235:
      return '该账户所在的国家或地区不支持 Xbox Live'
    case 2148916236:
    case 2148916237:
      return 'Microsoft 要求该账户完成成人验证后才能登录 Minecraft'
    case 2148916238:
      return '儿童账户需要由家庭组中的成年人先完成设置'
    default:
      return 'Xbox Live 验证失败，请稍后重试'
  }
}

async function exchangeMinecraft(
  msAccessToken: string,
  trace: AuthTrace
): Promise<{ accessToken: string; expiresIn: number; uuid: string; name: string }> {
  const xbl = await postJson(XBL_AUTH_URL, {
    Properties: {
      AuthMethod: 'RPS',
      SiteName: 'user.auth.xboxlive.com',
      RpsTicket: `d=${msAccessToken}`
    },
    RelyingParty: 'http://auth.xboxlive.com',
    TokenType: 'JWT'
  })
  if (xbl.status !== 200) {
    const api = readApiError(xbl.body)
    traceStep(trace, 'xbox', 'fail', xbl.status, api.code, api.detail)
    throw new AuthError('Xbox Live 账户验证失败，请确认该微软账户可用', buildDiagnostic(trace))
  }
  const xblToken = xbl.body.Token as string | undefined
  const xui = (xbl.body.DisplayClaims as { xui?: { uhs: string }[] } | undefined)?.xui
  const uhs = xui?.[0]?.uhs
  if (!xblToken || !uhs) {
    traceStep(trace, 'xbox', 'fail', xbl.status, 'INVALID_RESPONSE', '响应缺少 Token 或用户哈希')
    throw new AuthError('Xbox Live 返回了异常的数据', buildDiagnostic(trace))
  }
  traceStep(trace, 'xbox', 'ok', xbl.status)

  const xsts = await postJson(XSTS_URL, {
    Properties: {
      SandboxId: 'RETAIL',
      UserTokens: [xblToken]
    },
    RelyingParty: 'rp://api.minecraftservices.com/',
    TokenType: 'JWT'
  })
  if (xsts.status !== 200) {
    const xerr = (xsts.body.XErr as number | undefined) ?? undefined
    const message = mapXstsError(xerr)
    traceStep(
      trace,
      'xsts',
      'fail',
      xsts.status,
      xerr ? `XErr ${xerr}` : readApiError(xsts.body).code,
      message
    )
    throw new AuthError(message, buildDiagnostic(trace))
  }
  const xstsToken = xsts.body.Token as string | undefined
  if (!xstsToken) {
    traceStep(trace, 'xsts', 'fail', xsts.status, 'INVALID_RESPONSE', '响应缺少安全令牌')
    throw new AuthError('Xbox Live 安全令牌获取失败', buildDiagnostic(trace))
  }
  traceStep(trace, 'xsts', 'ok', xsts.status)

  const login = await postJson(MC_LOGIN_URL, {
    identityToken: `XBL3.0 x=${uhs};${xstsToken}`
  })
  if (login.status !== 200) {
    const api = readApiError(login.body)
    traceStep(
      trace,
      'minecraft',
      'fail',
      login.status,
      api.code ?? (login.status === 403 ? 'Invalid app registration' : undefined),
      api.detail
    )
    const message =
      login.status === 403
        ? 'Minecraft Services 拒绝了这个 Client ID（403 Invalid app registration）。Allowlist 尚未通过，或审批结果还没有生效。'
        : login.status === 401
          ? 'Minecraft Services 拒绝了 Xbox 令牌（401），请重新登录后再试。'
          : `Minecraft 登录失败（HTTP ${login.status}），请稍后重试。`
    throw new AuthError(message, buildDiagnostic(trace))
  }
  traceStep(trace, 'minecraft', 'ok', login.status)
  const accessToken = login.body.access_token as string | undefined
  const expiresIn = Number(login.body.expires_in ?? 0)
  if (!accessToken) {
    traceStep(trace, 'minecraft', 'fail', login.status, 'INVALID_TOKEN', '响应缺少 access_token')
    throw new AuthError('Minecraft 返回了异常的访问令牌', buildDiagnostic(trace))
  }

  const profile = await requestJson(MC_PROFILE_URL, {
    headers: { Authorization: `Bearer ${accessToken}` }
  })
  if (profile.status === 404) {
    traceStep(
      trace,
      'profile',
      'fail',
      profile.status,
      'NO_ENTITLEMENT',
      '该账户没有 Minecraft Java 版所有权'
    )
    throw new AuthError(
      '该账户未拥有 Minecraft Java 版，请先在官网购买后再登录',
      buildDiagnostic(trace)
    )
  }
  if (profile.status !== 200) {
    const api = readApiError(profile.body as unknown as Record<string, unknown>)
    traceStep(trace, 'profile', 'fail', profile.status, api.code, api.detail)
    throw new AuthError(`无法获取 Minecraft 档案（HTTP ${profile.status}），请稍后重试`, buildDiagnostic(trace))
  }
  const profileBody = profile.body as unknown as { id?: string; name?: string }
  if (!profileBody.id || !profileBody.name) {
    traceStep(trace, 'profile', 'fail', profile.status, 'INVALID_PROFILE', '响应缺少 UUID 或玩家名')
    throw new AuthError('无法读取 Minecraft 档案信息', buildDiagnostic(trace))
  }
  traceStep(trace, 'profile', 'ok', profile.status)

  return {
    accessToken,
    expiresIn: expiresIn > 0 ? expiresIn : 86_400,
    uuid: profileBody.id.replace(/-/g, ''),
    name: profileBody.name
  }
}

export async function startMicrosoftLogin(clientIdOverride?: string): Promise<MsDeviceCode> {
  const settings = getSettings()
  const clientId = (clientIdOverride || settings.msClientId).trim()
  if (!clientId) {
    throw new Error('请先在设置中填写 Azure 应用的 Client ID')
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId)) {
    throw new Error('Client ID 格式不正确，它应当是 Azure 应用的应用程序(客户端) ID')
  }
  if (settings.msClientId !== clientId) await updateSettings({ msClientId: clientId })

  const result = await postForm(DEVICE_CODE_URL, {
    client_id: clientId,
    scope: SCOPE
  })
  if (result.status !== 200 || !result.body.device_code || !result.body.user_code) {
    throw new Error(
      result.body.error_description || '无法获取微软登录代码，请检查 Client ID 与 Azure 应用配置'
    )
  }
  const sessionId = randomUUID()
  const interval = Math.max(3, Number(result.body.interval ?? 5))
  const expiresIn = Number(result.body.expires_in ?? 900)
  sessions.set(sessionId, {
    id: sessionId,
    clientId,
    deviceCode: result.body.device_code,
    interval,
    expiresAt: Date.now() + expiresIn * 1000,
    lastPoll: 0
  })

  return {
    sessionId,
    userCode: result.body.user_code,
    verificationUri: result.body.verification_uri || 'https://microsoft.com/devicelogin',
    expiresIn,
    interval,
    message: result.body.message || ''
  }
}

export async function pollMicrosoftLogin(sessionId: string): Promise<MsPollResult> {
  const session = sessions.get(sessionId)
  if (!session) return { status: 'error', message: '登录会话已失效，请重新获取登录代码' }
  if (Date.now() > session.expiresAt) {
    sessions.delete(sessionId)
    return { status: 'expired', message: '登录代码已过期，请重新获取' }
  }
  if (Date.now() - session.lastPoll < session.interval * 1000) return { status: 'pending' }
  session.lastPoll = Date.now()

  const trace: AuthTrace = { clientId: session.clientId, steps: [] }
  let result
  try {
    result = await postForm(TOKEN_URL, {
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      client_id: session.clientId,
      device_code: session.deviceCode
    })
  } catch (err) {
    traceStep(trace, 'oauth', 'fail', undefined, 'NETWORK', (err as Error).message)
    return {
      status: 'error',
      message: (err as Error).message,
      diagnostic: buildDiagnostic(trace)
    }
  }

  if (result.status === 200 && result.body.access_token) {
    sessions.delete(sessionId)
    traceStep(trace, 'oauth', 'ok', result.status)
    try {
      const minecraft = await exchangeMinecraft(result.body.access_token, trace)
      const previous = listStoredAccounts().find((a) => a.uuid === minecraft.uuid)
      const account: StoredAccount = {
        id: previous?.id ?? `ms-${minecraft.uuid}`,
        type: 'microsoft',
        name: minecraft.name,
        uuid: minecraft.uuid,
        accessToken: minecraft.accessToken,
        refreshToken: result.body.refresh_token,
        clientId: session.clientId,
        expiresAt: Date.now() + minecraft.expiresIn * 1000,
        addedAt: previous?.addedAt ?? Date.now()
      }
      saveAccount(account)
      return { status: 'success', accounts: broadcast(), diagnostic: buildDiagnostic(trace) }
    } catch (err) {
      return {
        status: 'error',
        message: (err as Error).message,
        diagnostic: err instanceof AuthError ? err.diagnostic : buildDiagnostic(trace)
      }
    }
  }

  const error = result.body.error
  if (error === 'authorization_pending') return { status: 'pending' }
  if (error === 'slow_down') {
    session.interval += 5
    return { status: 'slow_down' }
  }
  if (error === 'expired_token') {
    sessions.delete(sessionId)
    return { status: 'expired', message: '登录代码已过期，请重新获取' }
  }
  if (error === 'authorization_declined' || error === 'access_denied') {
    sessions.delete(sessionId)
    return { status: 'error', message: '登录已被取消' }
  }
  sessions.delete(sessionId)
  traceStep(
    trace,
    'oauth',
    'fail',
    result.status,
    result.body.error,
    result.body.error_description
  )
  return {
    status: 'error',
    message: result.body.error_description || '微软登录失败，请检查 Client ID 和网络连接',
    diagnostic: buildDiagnostic(trace)
  }
}

export function cancelMicrosoftLogin(sessionId: string): void {
  sessions.delete(sessionId)
}

export function addOfflineAccount(name: string): AccountsPayload {
  const clean = name.trim()
  if (!/^[A-Za-z0-9_]{3,16}$/.test(clean)) {
    throw new Error('离线用户名需为 3-16 位字母、数字或下划线')
  }
  const uuid = offlineUuid(clean)
  const accounts = accountsPayload().accounts
  const existing = accounts.find((a) => a.type === 'offline' && a.name.toLowerCase() === clean.toLowerCase())
  if (existing) {
    setActiveAccount(existing.id)
    return broadcast()
  }
  const account: StoredAccount = {
    id: `offline-${uuid}`,
    type: 'offline',
    name: clean,
    uuid,
    accessToken: '0',
    addedAt: Date.now()
  }
  saveAccount(account)
  return broadcast()
}

export function activateAccount(id: string): AccountsPayload {
  setActiveAccount(id)
  return broadcast()
}

export function deleteAccount(id: string): AccountsPayload {
  removeStoredAccount(id)
  return broadcast()
}

export async function ensureFreshAccount(account: StoredAccount): Promise<StoredAccount> {
  if (account.type === 'offline') return account
  const expiresAt = account.expiresAt ?? 0
  if (expiresAt - Date.now() > 2 * 60_000) return account
  if (!account.refreshToken) throw new Error('微软登录状态已过期，请在账户管理中重新登录')

  const clientId = account.clientId || getSettings().msClientId
  if (!clientId) throw new Error('缺少微软登录的 Client ID，请在设置中填写后重新登录')

  const trace: AuthTrace = { clientId, steps: [] }
  const token = await postForm(TOKEN_URL, {
    grant_type: 'refresh_token',
    client_id: clientId,
    refresh_token: account.refreshToken,
    scope: SCOPE
  })
  if (token.status !== 200 || !token.body.access_token) {
    traceStep(trace, 'oauth', 'fail', token.status, token.body.error, token.body.error_description)
    if (token.body.error === 'invalid_grant') {
      throw new Error('微软登录已过期，请在账户管理中重新登录')
    }
    throw new Error(token.body.error_description || '刷新微软登录失败，请重新登录')
  }
  traceStep(trace, 'oauth', 'ok', token.status)

  const minecraft = await exchangeMinecraft(token.body.access_token, trace)
  const updated: StoredAccount = {
    ...account,
    name: minecraft.name,
    uuid: minecraft.uuid,
    accessToken: minecraft.accessToken,
    refreshToken: token.body.refresh_token ?? account.refreshToken,
    clientId,
    expiresAt: Date.now() + minecraft.expiresIn * 1000
  }
  saveAccount(updated)
  broadcast()
  return updated
}
