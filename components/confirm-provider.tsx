'use client'

// In-app confirmation dialog, replacing the browser's window.confirm().
//
//   const confirm = useConfirm()
//   if (!(await confirm({ title, message, confirmLabel, tone: 'danger' }))) return
//
// Resolves true on confirm, false on cancel / Escape / backdrop click.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { CircleHelp, Trash2, TriangleAlert } from 'lucide-react'
import { useI18n } from '@/components/language-provider'

export interface ConfirmOptions {
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  /** danger = destructive (red, trash icon); warning = losing work; default = neutral question. */
  tone?: 'danger' | 'warning' | 'default'
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

const ICONS = { danger: Trash2, warning: TriangleAlert, default: CircleHelp }

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const { t } = useI18n()
  const [request, setRequest] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  const confirm = useCallback<ConfirmFn>(
    (options) =>
      new Promise<boolean>((resolve) => {
        setRequest((current) => {
          current?.resolve(false) // a newer question replaces an unanswered one
          return { ...options, resolve }
        })
      }),
    [],
  )

  const close = useCallback((ok: boolean) => {
    setRequest((current) => {
      current?.resolve(ok)
      return null
    })
  }, [])

  useEffect(() => {
    if (!request) return
    // Destructive actions start on "Cancel" so Enter can't delete by accident.
    const target = request.tone === 'danger' ? cancelRef.current : confirmRef.current
    target?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        close(false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [request, close])

  const tone = request?.tone ?? 'default'
  const Icon = ICONS[tone]

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {request && (
        <div className="modal-backdrop confirm-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close(false)}>
          <div className={`modal confirm-dialog ${tone}`} role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby={request.message ? 'confirm-message' : undefined}>
            <div className="modal-icon"><Icon /></div>
            <h2 id="confirm-title">{request.title}</h2>
            {request.message && <p id="confirm-message">{request.message}</p>}
            <div className="modal-actions">
              <button ref={cancelRef} className="cancel-button" onClick={() => close(false)}>
                {request.cancelLabel ?? t('action.cancel')}
              </button>
              <button ref={confirmRef} className={tone === 'default' ? 'primary-button' : 'primary-button danger'} onClick={() => close(true)}>
                {request.confirmLabel ?? t('confirm.ok')}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used within <ConfirmProvider>')
  return ctx
}
