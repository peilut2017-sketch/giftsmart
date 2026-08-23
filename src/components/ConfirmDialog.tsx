import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { useT } from '../lib/i18n'

interface Props {
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
  children?: ReactNode
}

export default function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger = false,
  onConfirm,
  onCancel,
  children,
}: Props) {
  const { t } = useT()
  const cancelRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  // Focus the cancel button on mount
  useEffect(() => {
    cancelRef.current?.focus()
  }, [])

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  // Basic focus trap: keep Tab inside the dialog
  useEffect(() => {
    const el = dialogRef.current
    if (!el) return
    const focusable = el.querySelectorAll<HTMLElement>('button, [tabindex]:not([tabindex="-1"])')
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const onTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last?.focus() }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first?.focus() }
      }
    }
    el.addEventListener('keydown', onTab)
    return () => el.removeEventListener('keydown', onTab)
  }, [])

  return (
    <div
      // Topmost layer: a confirmation must never render UNDER the sheet (z-100) or
      // vault modals (z-110) that opened it
      className="fixed inset-0 bg-black/50 z-[120] flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby={message ? 'confirm-desc' : undefined}
        className="bg-surface rounded-3xl w-full max-w-sm p-6 shadow-2xl animate-slide-up"
        onClick={e => e.stopPropagation()}
      >
        <h2 id="confirm-title" className="text-lg font-bold text-text mb-1">{title}</h2>
        {message && <p id="confirm-desc" className="text-sm text-text2 mb-3">{message}</p>}
        {children && <div className="mb-4">{children}</div>}
        {!message && !children && <div className="mb-4" />}
        <div className="flex gap-3">
          <button
            ref={cancelRef}
            onClick={onCancel}
            className="flex-1 py-3 bg-bg text-text2 rounded-2xl font-medium text-sm hover:bg-border/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            {cancelLabel ?? t('app.cancel')}
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 py-3 rounded-2xl font-medium text-sm text-white transition-colors focus-visible:outline-none focus-visible:ring-2 ${
              danger
                ? 'bg-error hover:brightness-110 focus-visible:ring-error/50'
                : 'bg-primary hover:brightness-110 focus-visible:ring-primary/50'
            }`}
          >
            {confirmLabel ?? t('app.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
