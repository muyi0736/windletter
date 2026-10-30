import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, Check, Loader2, X } from 'lucide-react'
import { clamp } from '../lib/format'

export function Spinner({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <span className={`spinner ${className}`} style={{ width: size, height: size }} aria-hidden="true">
      <Loader2 size={size} strokeWidth={2.4} />
    </span>
  )
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  tone?: 'ghost' | 'soft' | 'danger'
}

export function IconButton({ label, tone = 'ghost', className = '', children, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      className={`icon-button icon-button--${tone} ${className}`}
      aria-label={label}
      title={label}
      {...rest}
    >
      {children}
    </button>
  )
}

export function Switch({
  checked,
  onChange,
  disabled = false,
  label
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  label?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`switch ${checked ? 'is-on' : ''}`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-thumb" />
    </button>
  )
}

export interface SegmentOption<T extends string> {
  value: T
  label: ReactNode
  hint?: string
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = 'md',
  className = ''
}: {
  value: T
  options: SegmentOption<T>[]
  onChange: (value: T) => void
  size?: 'sm' | 'md'
  className?: string
}) {
  return (
    <div className={`segmented segmented--${size} ${className}`} role="group">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`segmented-item ${option.value === value ? 'is-active' : ''}`}
          onClick={() => onChange(option.value)}
          title={option.hint}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function SettingSlider({
  value,
  min,
  max,
  step,
  onCommit,
  format,
  disabled = false,
  ariaLabel
}: {
  value: number
  min: number
  max: number
  step: number
  onCommit: (value: number) => void
  format?: (value: number) => ReactNode
  disabled?: boolean
  ariaLabel: string
}) {
  const [local, setLocal] = useState(value)
  const committed = useRef(value)
  useEffect(() => {
    setLocal(value)
    committed.current = value
  }, [value])

  const commit = (next: number) => {
    if (next === committed.current) return
    committed.current = next
    onCommit(next)
  }

  const percent = max > min ? ((local - min) / (max - min)) * 100 : 0
  return (
    <div className={`slider-control ${disabled ? 'is-disabled' : ''}`}>
      <input
        type="range"
        aria-label={ariaLabel}
        min={min}
        max={max}
        step={step}
        value={local}
        disabled={disabled}
        style={{ '--slider-fill': `${percent}%` } as React.CSSProperties}
        onChange={(event) => setLocal(Number(event.target.value))}
        onPointerUp={() => commit(local)}
        onKeyUp={() => commit(local)}
        onBlur={() => commit(local)}
      />
      {format && <span className="slider-value">{format(local)}</span>}
    </div>
  )
}

export function NumberField({
  value,
  min,
  max,
  onCommit,
  suffix,
  disabled = false,
  ariaLabel
}: {
  value: number
  min: number
  max: number
  onCommit: (value: number) => void
  suffix?: string
  disabled?: boolean
  ariaLabel: string
}) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])

  const commit = () => {
    const parsed = Number(text)
    if (!Number.isFinite(parsed)) {
      setText(String(value))
      return
    }
    const next = clamp(Math.round(parsed), min, max)
    setText(String(next))
    if (next !== value) onCommit(next)
  }

  return (
    <label className={`number-field ${disabled ? 'is-disabled' : ''}`}>
      <input
        aria-label={ariaLabel}
        inputMode="numeric"
        value={text}
        disabled={disabled}
        onChange={(event) => setText(event.target.value.replace(/[^0-9]/g, ''))}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur()
          }
        }}
      />
      {suffix && <span>{suffix}</span>}
    </label>
  )
}

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

export function Badge({
  children,
  tone = 'neutral',
  className = ''
}: {
  children: ReactNode
  tone?: BadgeTone
  className?: string
}) {
  return <span className={`badge badge--${tone} ${className}`}>{children}</span>
}

export function ProgressBar({
  percent,
  tone = 'accent',
  size = 'md'
}: {
  percent: number
  tone?: 'accent' | 'success' | 'danger'
  size?: 'sm' | 'md'
}) {
  return (
    <div className={`progress progress--${size}`} role="progressbar" aria-valuenow={Math.round(percent)}>
      <div
        className={`progress-fill progress-fill--${tone}`}
        style={{ width: `${clamp(percent, 0, 100)}%` }}
      />
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action
}: {
  icon: ReactNode
  title: string
  description?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">{icon}</div>
      <strong>{title}</strong>
      {description && <p>{description}</p>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  )
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  icon,
  children,
  footer,
  size = 'md',
  closeOnOverlay = true,
  closeOnEscape = true
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  subtitle?: ReactNode
  icon?: ReactNode
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'
  closeOnOverlay?: boolean
  closeOnEscape?: boolean
}) {
  useEffect(() => {
    if (!open || !closeOnEscape) return
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose, closeOnEscape])

  if (!open) return null
  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (closeOnOverlay && event.target === event.currentTarget) onClose()
      }}
    >
      <div className={`modal modal--${size}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <header className="modal-header">
          {icon && <div className="modal-icon">{icon}</div>}
          <div className="modal-heading">
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <IconButton label="关闭" onClick={onClose} className="modal-close">
            <X size={16} />
          </IconButton>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>,
    document.body
  )
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = '确认',
  cancelLabel = '取消',
  danger = false,
  busy = false,
  onConfirm,
  onCancel
}: {
  open: boolean
  title: string
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      icon={<AlertTriangle size={20} />}
      footer={
        <>
          <button type="button" className="button button--ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`button ${danger ? 'button--danger' : 'button--primary'}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy && <Spinner size={14} />}
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="confirm-message">{message}</div>
    </Modal>
  )
}

export function CheckPill({ children }: { children: ReactNode }) {
  return (
    <Badge tone="success" className="check-pill">
      <Check size={12} strokeWidth={3} />
      {children}
    </Badge>
  )
}

export function FieldHint({ children }: { children: ReactNode }) {
  return <p className="field-hint">{children}</p>
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <span className="section-label">{children}</span>
}

export function Separator() {
  return <div className="separator" role="separator" />
}

export function useAutoId(prefix: string): string {
  const id = useId().replace(/:/g, '')
  return `${prefix}-${id}`
}
