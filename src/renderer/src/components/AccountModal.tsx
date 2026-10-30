import { useEffect, useRef, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  Check,
  Clipboard,
  ExternalLink,
  ShieldCheck,
  Trash2,
  UserRound,
  Users
} from 'lucide-react'
import type { AccountView, AuthDiagnosticView, MsDeviceCode } from '@shared/types'
import { useLauncher } from '../store'
import { cleanError } from '../lib/format'
import { copyText } from '../lib/clipboard'
import { AuthDiagnosticPanel } from './AuthDiagnosticPanel'
import {
  Badge,
  ConfirmDialog,
  IconButton,
  Modal,
  Segmented,
  Spinner
} from './ui'
import { Avatar } from './visuals'

type LoginMode = 'offline' | 'microsoft'
type MsStage = 'idle' | 'starting' | 'waiting' | 'success' | 'error'

export function AccountModal() {
  const open = useLauncher((state) => state.accountModalOpen)
  const setOpen = useLauncher((state) => state.setAccountModalOpen)
  const accounts = useLauncher((state) => state.accounts)
  const toast = useLauncher((state) => state.toast)

  const [mode, setMode] = useState<LoginMode>('offline')
  const [offlineName, setOfflineName] = useState('')
  const [offlineError, setOfflineError] = useState('')
  const [busy, setBusy] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<AccountView | null>(null)
  const [deleting, setDeleting] = useState(false)

  const [device, setDevice] = useState<MsDeviceCode | null>(null)
  const [msStage, setMsStage] = useState<MsStage>('idle')
  const [msMessage, setMsMessage] = useState('')
  const [diagnostic, setDiagnostic] = useState<AuthDiagnosticView | null>(null)
  const [selfCheck, setSelfCheck] = useState(false)
  const [codeCopied, setCodeCopied] = useState(false)
  const pollTimer = useRef<number | null>(null)
  const sessionRef = useRef<string | null>(null)
  const openRef = useRef(open)

  useEffect(() => {
    openRef.current = open
  }, [open])

  useEffect(() => {
    if (open) return
    if (pollTimer.current) {
      window.clearTimeout(pollTimer.current)
      pollTimer.current = null
    }
    if (sessionRef.current) {
      void window.ccl.auth.cancelMicrosoft(sessionRef.current)
      sessionRef.current = null
    }
    setDevice(null)
    setMsStage('idle')
    setMsMessage('')
    setDiagnostic(null)
    setSelfCheck(false)
    setOfflineError('')
  }, [open])

  const stopPolling = () => {
    if (pollTimer.current) {
      window.clearTimeout(pollTimer.current)
      pollTimer.current = null
    }
  }

  const cancelLogin = () => {
    stopPolling()
    if (sessionRef.current) {
      void window.ccl.auth.cancelMicrosoft(sessionRef.current)
      sessionRef.current = null
    }
    setDevice(null)
    setMsStage('idle')
    setMsMessage('')
    setDiagnostic(null)
    setSelfCheck(false)
  }

  const handleClose = () => {
    if (msStage === 'waiting') cancelLogin()
    setOpen(false)
  }

  const handleModeChange = (next: LoginMode) => {
    if (next === mode) return
    if (mode === 'microsoft' && msStage === 'waiting') cancelLogin()
    setMode(next)
  }

  const beginPolling = (session: MsDeviceCode, checkMode = false) => {
    stopPolling()
    const tick = async () => {
      if (sessionRef.current !== session.sessionId) return
      try {
        const result = await window.ccl.auth.pollMicrosoft(session.sessionId)
        if (sessionRef.current !== session.sessionId) return
        if (result.status === 'pending' || result.status === 'slow_down') {
          const delay = (session.interval + (result.status === 'slow_down' ? 4 : 0)) * 1000
          pollTimer.current = window.setTimeout(tick, Math.max(delay, 3000))
          return
        }
        if (result.status === 'success') {
          sessionRef.current = null
          setDevice(null)
          setMsStage('success')
          setDiagnostic(result.diagnostic ?? null)
          setMsMessage(
            checkMode
              ? '登录自检通过，认证链已全部走通，账户也已添加。'
              : '微软账户已验证，已自动切换为当前账户'
          )
          const active = result.accounts?.accounts.find((account) => account.id === result.accounts?.activeId)
          toast(
            'success',
            checkMode ? '登录自检通过' : '微软登录成功',
            active ? `欢迎回来，${active.name}` : undefined
          )
          return
        }
        sessionRef.current = null
        setMsStage('error')
        setDevice(null)
        setDiagnostic(result.diagnostic ?? null)
        setMsMessage(result.message ?? '登录失败，请重试')
      } catch (error) {
        sessionRef.current = null
        setMsStage('error')
        setDiagnostic(null)
        setMsMessage(cleanError(error))
      }
    }
    pollTimer.current = window.setTimeout(tick, Math.max(session.interval, 3) * 1000)
  }

  const startMicrosoftLogin = async (checkMode = false) => {
    if (msStage === 'starting' || msStage === 'waiting') return
    setSelfCheck(checkMode)
    setDiagnostic(null)
    setMsStage('starting')
    setMsMessage('')
    try {
      const code = await window.ccl.auth.startMicrosoft()
      if (!openRef.current) {
        void window.ccl.auth.cancelMicrosoft(code.sessionId)
        return
      }
      sessionRef.current = code.sessionId
      setDevice(code)
      setMsStage('waiting')
      beginPolling(code, checkMode)
    } catch (error) {
      setMsStage('error')
      setMsMessage(cleanError(error))
    }
  }

  const addOffline = async () => {
    const name = offlineName.trim()
    if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) {
      setOfflineError('用户名需为 3-16 位字母、数字或下划线')
      return
    }
    setOfflineError('')
    setBusy(true)
    try {
      await window.ccl.auth.addOffline(name)
      setOfflineName('')
      toast('success', '离线账户已添加', `将以 ${name} 的身份启动游戏`)
    } catch (error) {
      setOfflineError(cleanError(error))
    } finally {
      setBusy(false)
    }
  }

  const activate = async (account: AccountView) => {
    if (account.id === accounts.activeId) return
    try {
      await window.ccl.auth.setActive(account.id)
      toast('success', '已切换账户', `当前账户：${account.name}`)
    } catch (error) {
      toast('error', '无法切换账户', cleanError(error))
    }
  }

  const confirmDelete = async () => {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await window.ccl.auth.remove(pendingDelete.id)
      toast('success', '账户已移除', pendingDelete.name)
      setPendingDelete(null)
    } catch (error) {
      toast('error', '无法移除账户', cleanError(error))
    } finally {
      setDeleting(false)
    }
  }

  const copyCode = async () => {
    if (!device) return
    if (await copyText(device.userCode)) {
      setCodeCopied(true)
      window.setTimeout(() => setCodeCopied(false), 1600)
    } else {
      toast('error', '复制失败', '请手动选择登录代码')
    }
  }

  const openVerification = () => {
    if (!device) return
    void window.ccl.app.openExternal(device.verificationUri).catch((error) => {
      toast('error', '无法打开浏览器', cleanError(error))
    })
  }

  const msWaiting = msStage === 'waiting' && device
  const msStarting = msStage === 'starting'

  return (
    <>
      <Modal
        open={open}
        onClose={handleClose}
        title="账户"
        subtitle="选择启动游戏时使用的玩家身份"
        icon={<Users size={20} />}
        size="lg"
        footer={
          <div className="account-privacy">
            <ShieldCheck size={14} />
            <span>账户凭据只保存在本机配置文件中，不会上传到任何第三方服务器。</span>
          </div>
        }
      >
        <section className="account-list-section">
          <div className="account-list-head">
            <span>我的账户</span>
            <Badge tone={accounts.accounts.length ? 'neutral' : 'warning'}>
              {accounts.accounts.length ? `${accounts.accounts.length} 个账户` : '尚未添加'}
            </Badge>
          </div>
          {accounts.accounts.length === 0 ? (
            <div className="account-empty">
              <UserRound size={18} />
              <span>还没有账户。添加一个离线账户，或使用微软账户登录。</span>
            </div>
          ) : (
            <div className="account-list">
              {accounts.accounts.map((account) => {
                const active = account.id === accounts.activeId
                return (
                  <div key={account.id} className={`account-row ${active ? 'is-active' : ''}`}>
                    <Avatar name={account.name} seed={account.uuid} uuid={account.uuid} type={account.type} size={38} />
                    <div className="account-row-copy">
                      <strong>
                        {account.name}
                        {active && (
                          <Badge tone="success" className="account-active-badge">
                            <Check size={10} strokeWidth={3} />
                            当前
                          </Badge>
                        )}
                      </strong>
                      <span>
                        {account.type === 'microsoft' ? '微软账户' : '离线账户'} · {account.uuid.slice(0, 8)}
                      </span>
                    </div>
                    {!active && (
                      <button type="button" className="button button--soft button--xs" onClick={() => void activate(account)}>
                        使用
                      </button>
                    )}
                    <IconButton
                      label={`移除 ${account.name}`}
                      tone="danger"
                      onClick={() => setPendingDelete(account)}
                    >
                      <Trash2 size={15} />
                    </IconButton>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        <div className="account-divider">
          <span>添加账户</span>
        </div>

        <Segmented
          value={mode}
          onChange={handleModeChange}
          className="account-mode-tabs"
          options={[
            {
              value: 'offline',
              label: (
                <span className="segmented-with-icon">
                  <UserRound size={14} />
                  离线登录
                </span>
              )
            },
            {
              value: 'microsoft',
              label: (
                <span className="segmented-with-icon">
                  <ShieldCheck size={14} />
                  微软正版
                </span>
              )
            }
          ]}
        />

        {mode === 'offline' && (
          <div className="account-form">
            <label className="form-field">
              <span className="form-label">游戏内用户名</span>
              <div className={`text-input ${offlineError ? 'has-error' : ''}`}>
                <input
                  value={offlineName}
                  placeholder="3-16 位字母、数字或下划线"
                  maxLength={16}
                  spellCheck={false}
                  onChange={(event) => {
                    setOfflineName(event.target.value)
                    if (offlineError) setOfflineError('')
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void addOffline()
                  }}
                />
              </div>
              {offlineError ? (
                <span className="form-error">
                  <AlertTriangle size={12} />
                  {offlineError}
                </span>
              ) : (
                <span className="form-hint">离线账户无需网络验证，适合本地游戏与测试。</span>
              )}
            </label>
            <button type="button" className="button button--primary account-submit" onClick={() => void addOffline()} disabled={busy}>
              {busy ? <Spinner size={15} /> : <UserRound size={15} />}
              添加离线账户
            </button>
          </div>
        )}

        {mode === 'microsoft' && (
          <div className="account-form">
            {msStage === 'success' ? (
              <>
                <div className="ms-success">
                  <span className="ms-success-icon">
                    <Check size={22} strokeWidth={2.6} />
                  </span>
                  <div>
                    <strong>{selfCheck ? '登录自检通过' : '登录成功'}</strong>
                    <p>{msMessage}</p>
                  </div>
                  <button type="button" className="button button--soft" onClick={handleClose}>
                    完成
                  </button>
                </div>
                {diagnostic && (
                  <AuthDiagnosticPanel diagnostic={diagnostic} defaultOpen={false} />
                )}
              </>
            ) : msWaiting ? (
              <div className="device-flow">
                <div className="device-flow-head">
                  <div>
                    <strong>{selfCheck ? '登录后自动完成认证自检' : '在浏览器中完成验证'}</strong>
                    <p>
                      {selfCheck
                        ? '登录完成后会依次检查 OAuth、Xbox Live、XSTS、Minecraft Services 登录和档案，并显示每一步的状态码。'
                        : '打开微软设备登录页面，输入下方代码并登录你的微软账户。'}
                    </p>
                  </div>
                  <Badge tone="accent">
                    <Spinner size={11} />
                    {selfCheck ? '自检中' : '等待授权'}
                  </Badge>
                </div>
                <button type="button" className="device-code" onClick={() => void copyCode()} title="点击复制">
                  <code>{device.userCode}</code>
                  <span className="device-code-copy">
                    {codeCopied ? <Check size={15} /> : <Clipboard size={15} />}
                    {codeCopied ? '已复制' : '复制代码'}
                  </span>
                </button>
                <div className="device-flow-actions">
                  <button type="button" className="button button--primary" onClick={openVerification}>
                    <ExternalLink size={15} />
                    打开微软登录页面
                  </button>
                  <button type="button" className="button button--ghost" onClick={cancelLogin}>
                    取消登录
                  </button>
                </div>
                <p className="device-flow-note">
                  <ShieldCheck size={13} />
                  页面会自动刷新登录状态，请不要关闭此窗口。登录代码将在{' '}
                  {Math.max(1, Math.round(device.expiresIn / 60))} 分钟后过期。
                </p>
              </div>
            ) : (
              <>
                <div className="ms-intro">
                  <span className="ms-intro-icon">
                    <ShieldCheck size={22} />
                  </span>
                  <div>
                    <strong>使用微软账户登录</strong>
                    <p>采用微软设备代码授权，启动器不会接触你的密码或令牌。</p>
                  </div>
                </div>
                {msStage === 'error' && msMessage && (
                  <div className="ms-error">
                    <AlertTriangle size={15} />
                    <span>{msMessage}</span>
                  </div>
                )}
                {msStage === 'error' && diagnostic && (
                  <AuthDiagnosticPanel diagnostic={diagnostic} defaultOpen />
                )}
                <div className="ms-actions">
                  <button
                    type="button"
                    className="button button--primary account-submit"
                    onClick={() => void startMicrosoftLogin(false)}
                    disabled={msStarting}
                  >
                    {msStarting ? <Spinner size={15} /> : <ShieldCheck size={15} />}
                    {msStarting ? '正在获取登录代码…' : '获取微软登录代码'}
                  </button>
                  <button
                    type="button"
                    className="button button--ghost"
                    onClick={() => void startMicrosoftLogin(true)}
                    disabled={msStarting}
                  >
                    <Activity size={15} />
                    登录自检
                  </button>
                </div>
                <span className="ms-actions-hint">
                  自检会完整走一遍认证链，只显示每一步的 HTTP 状态与错误码，不包含任何令牌。
                </span>
              </>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="移除账户"
        message={
          <>
            确定要移除账户 <strong>{pendingDelete?.name}</strong> 吗？
            {pendingDelete?.type === 'microsoft' ? '已保存的微软登录凭据也会一并删除。' : ''}
          </>
        }
        confirmLabel="移除"
        danger
        busy={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  )
}
