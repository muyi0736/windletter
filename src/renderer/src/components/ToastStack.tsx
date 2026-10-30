import { AlertTriangle, Check, Info, X } from 'lucide-react'
import { useLauncher } from '../store'

export function ToastStack() {
  const toasts = useLauncher((state) => state.toasts)
  const dismiss = useLauncher((state) => state.dismissToast)

  return (
    <div className="toast-stack" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.kind}`} role="status">
          <div className="toast-icon">
            {toast.kind === 'success' && <Check size={16} strokeWidth={2.6} />}
            {toast.kind === 'error' && <AlertTriangle size={16} />}
            {toast.kind === 'info' && <Info size={16} />}
          </div>
          <div className="toast-copy">
            <strong>{toast.title}</strong>
            {toast.message && <p>{toast.message}</p>}
          </div>
          <button
            type="button"
            className="toast-close"
            aria-label="关闭提示"
            onClick={() => dismiss(toast.id)}
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}
