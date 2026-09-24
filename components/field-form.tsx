'use client'

// Create, rename, resize or remove a field (plot).

import { useState } from 'react'
import { Check, Layers, Loader2, Trash2, X } from 'lucide-react'
import type { Field } from '@/lib/farm-types'
import { useI18n } from '@/components/language-provider'
import { useToast } from '@/components/toast-provider'
import { useConfirm } from '@/components/confirm-provider'
import { useRefresh } from '@/components/data-hooks'
import { apiFetch } from '@/lib/client-api'

export function FieldFormModal({ mode, field, onClose, onSaved, onDeleted }: {
  mode: 'create' | 'edit'
  field?: Field
  onClose: () => void
  onSaved?: (field: Field) => void
  onDeleted?: (id: string) => void
}) {
  const { t } = useI18n()
  const { toast } = useToast()
  const confirm = useConfirm()
  const refresh = useRefresh()
  const [name, setName] = useState(field?.name ?? '')
  const [area, setArea] = useState(field?.area !== undefined ? String(field.area) : '')
  const [unit, setUnit] = useState(field?.unit ?? 'ha')
  const [note, setNote] = useState(field?.note ?? '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!name.trim()) {
      setError(t('err.nameRequired'))
      return
    }
    setSaving(true)
    setError('')
    try {
      const res = await apiFetch(mode === 'create' ? '/api/fields' : `/api/fields/${field!.id}`, {
        method: mode === 'create' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, area: area ? Number(area) : undefined, unit, note }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || t('err.saveFailed'))
        return
      }
      toast(mode === 'create' ? t('toast.fieldAdded') : t('toast.fieldUpdated'))
      refresh()
      onSaved?.(data)
      onClose()
    } catch {
      setError(t('err.network'))
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!field) return
    const ok = await confirm({
      title: t('fld.delete.title', { name: field.name }),
      message: t('fld.delete.body'),
      confirmLabel: t('action.delete'),
      tone: 'danger',
    })
    if (!ok) return
    setSaving(true)
    try {
      const res = await apiFetch(`/api/fields/${field.id}`, { method: 'DELETE' })
      if (res.status === 409) {
        toast(t('fld.inUse'), 'error')
        return
      }
      if (!res.ok) throw new Error('delete failed')
      toast(t('toast.fieldDeleted'))
      refresh()
      onDeleted?.(field.id)
      onClose()
    } catch {
      toast(t('toast.error'), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="field-form-title" onClick={(e) => e.stopPropagation()}>
        <header className="form-head">
          <div className="modal-icon"><Layers /></div>
          <div className="form-head-text">
            <h2 id="field-form-title">{mode === 'create' ? t('fld.addTitle') : t('fld.editTitle')}</h2>
            <p>{mode === 'create' ? t('fld.addSub') : t('fld.editSub')}</p>
          </div>
          <button className="form-close" onClick={onClose} aria-label={t('action.cancel')}><X /></button>
        </header>
        <div className="modal-options">
          <label>{t('fld.name')}<input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('ph.fld.name')} autoFocus /></label>
          <div className="form-row">
            <label>{t('fld.area')} <em>{t('field.optional')}</em><input type="number" min="0" step="any" value={area} onChange={(e) => setArea(e.target.value)} placeholder="24" /></label>
            <label>{t('fld.unit')}<input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="ha" /></label>
          </div>
          <label>{t('fld.note')} <em>{t('field.optional')}</em><input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('ph.fld.note')} /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
        </div>
        <div className="modal-actions">
          {mode === 'edit' && <button className="ghost-button danger" onClick={remove} disabled={saving}><Trash2 />{t('fld.delete')}</button>}
          <button className="cancel-button" onClick={onClose} disabled={saving}>{t('action.cancel')}</button>
          <button className="primary-button" onClick={submit} disabled={saving || !name.trim()}>
            {saving ? <><Loader2 className="spin" data-icon="inline-start" />{t('action.saving')}</> : <><Check data-icon="inline-start" />{mode === 'create' ? t('fld.create') : t('fld.save')}</>}
          </button>
        </div>
      </section>
    </div>
  )
}
