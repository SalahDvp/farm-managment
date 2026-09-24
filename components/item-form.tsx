'use client'

// One form for registering and editing any item. It is organised into clear
// sections — Basics, a type-specific Profile, and free-form Custom fields — so
// it is obvious where each piece of information goes.

import { useMemo, useState } from 'react'
import { Check, CircleHelp, ClipboardList, Loader2, Mars, Plus, ShieldCheck, SquarePen, Tags, Trash2, TriangleAlert, Venus, X } from 'lucide-react'
import {
  IRRIGATIONS,
  NUMERIC_PROFILE_KEYS,
  PROFILE_KEYS,
  PURPOSES,
  REPRO_STATUSES,
  type CustomField,
  type Field,
  type Item,
  type ItemProfile,
  type ItemType,
  type Sex,
} from '@/lib/farm-types'
import { TYPE_META, typeLabel } from '@/lib/ui'
import { useI18n } from '@/components/language-provider'
import { useSettings } from '@/components/settings-provider'
import { useToast } from '@/components/toast-provider'
import { useAllItems } from '@/components/data-hooks'
import { FormSection, Segmented, UnitInput } from '@/components/form-kit'
import { apiFetch } from '@/lib/client-api'

type ProfileForm = Record<string, string>

const SPECIES_SUGGESTIONS: Record<ItemType, string[]> = {
  animal: ['Sheep', 'Goat', 'Cow', 'Camel', 'Horse', 'Donkey', 'Chicken', 'Duck', 'Turkey', 'Rabbit', 'Bee'],
  tree: ['Apple', 'Olive', 'Orange', 'Lemon', 'Date palm', 'Almond', 'Fig', 'Pomegranate', 'Apricot', 'Peach', 'Grape', 'Pear', 'Walnut'],
  resource: ['Water', 'Feed', 'Hay', 'Manure', 'Fertilizer', 'Fuel', 'Seed', 'Medicine'],
}

const DEFAULT_UNIT_FOR: Record<ItemType, string> = { animal: 'head', tree: 'trees', resource: 'unit' }

function profileToForm(profile?: ItemProfile): ProfileForm {
  const form: ProfileForm = {}
  for (const [key, value] of Object.entries(profile ?? {})) {
    if (value !== undefined && value !== null) form[key] = String(value)
  }
  return form
}

/** Keep only the keys that belong to this type, typed correctly. */
function formToProfile(type: ItemType, form: ProfileForm): ItemProfile {
  const out: Record<string, unknown> = {}
  for (const key of PROFILE_KEYS[type]) {
    const raw = form[key]
    if (raw === undefined || raw.trim() === '') continue
    if (key === 'organic') out[key] = raw === 'true'
    else if (NUMERIC_PROFILE_KEYS.includes(key)) {
      const n = Number(raw)
      if (Number.isFinite(n) && n >= 0) out[key] = n
    } else out[key] = raw.trim()
  }
  // A due date only means something while the animal is pregnant.
  if (type === 'animal' && out.reproStatus !== 'pregnant') delete out.dueDate
  return out as ItemProfile
}

export function ItemFormModal({ mode, item, fields, defaultFieldId, onClose, onSaved }: {
  mode: 'create' | 'edit'
  item?: Item
  fields: Field[]
  defaultFieldId?: string
  onClose: () => void
  onSaved: (item: Item) => void
}) {
  const { t } = useI18n()
  const { settings } = useSettings()
  const { toast } = useToast()
  const allItems = useAllItems()

  const [itemType, setItemType] = useState<ItemType>(item?.itemType ?? 'animal')
  const [name, setName] = useState(item?.name ?? '')
  const [species, setSpecies] = useState(item?.species ?? '')
  const [breed, setBreed] = useState(item?.breed ?? '')
  const [fieldId, setFieldId] = useState(item?.fieldId ?? defaultFieldId ?? fields[0]?.id ?? '')
  const [zone, setZone] = useState(item?.zone ?? '')
  const [quantity, setQuantity] = useState(String(item?.quantity ?? 1))
  const [unit, setUnit] = useState(item?.unit ?? DEFAULT_UNIT_FOR.animal)
  const [tagNumber, setTagNumber] = useState(item?.tagNumber ?? '')
  const [originDate, setOriginDate] = useState(item?.originDate ?? '')
  const [status, setStatus] = useState<Item['status']>(item?.status ?? 'healthy')
  const [notes, setNotes] = useState(item?.notes ?? '')
  const [profile, setProfile] = useState<ProfileForm>(() => profileToForm(item?.profile))
  const [custom, setCustom] = useState<CustomField[]>(item?.customFields ?? [])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const pv = (key: keyof ItemProfile) => profile[key] ?? ''
  const setP = (key: keyof ItemProfile, value: string) => setProfile((p) => ({ ...p, [key]: value }))

  const chooseType = (type: ItemType) => {
    setItemType(type)
    setUnit(DEFAULT_UNIT_FOR[type])
  }

  const animals = useMemo(() => allItems.filter((i) => i.itemType === 'animal' && i.id !== item?.id), [allItems, item?.id])
  const mothers = animals.filter((a) => a.profile?.sex !== 'male')
  const fathers = animals.filter((a) => a.profile?.sex !== 'female')

  const updateCustom = (index: number, patch: Partial<CustomField>) =>
    setCustom((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))

  const submit = async () => {
    if (!name.trim() || !species.trim() || !zone.trim()) {
      setError(t('err.completeFields'))
      return
    }
    const q = Number(quantity)
    if (!Number.isFinite(q) || q <= 0) {
      setError(t('err.quantityPositive'))
      return
    }
    setSaving(true)
    setError('')
    const body = {
      ...(mode === 'create' ? { itemType } : {}),
      name,
      species,
      breed,
      fieldId,
      zone,
      quantity: q,
      unit,
      tagNumber,
      originDate,
      notes,
      status,
      profile: formToProfile(itemType, profile),
      customFields: custom.filter((c) => c.key.trim()),
    }
    try {
      const res = await apiFetch(mode === 'create' ? '/api/farm-items' : `/api/farm-items/${item!.id}`, {
        method: mode === 'create' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || t('err.saveFailed'))
        return
      }
      toast(mode === 'create' ? t('toast.itemAdded') : t('toast.itemUpdated'))
      onSaved(data)
    } catch {
      setError(t('err.network'))
    } finally {
      setSaving(false)
    }
  }

  const TypeIcon = TYPE_META[itemType].icon
  const opt = <em>{t('field.optional')}</em>
  const originLabel = itemType === 'tree' ? t('field.planted') : itemType === 'animal' ? t('field.born') : t('field.acquired')

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="item-form-title" onClick={(e) => e.stopPropagation()}>
        <header className="form-head">
          <div className="modal-icon">{mode === 'edit' ? <SquarePen /> : <TypeIcon />}</div>
          <div className="form-head-text">
            <h2 id="item-form-title">{mode === 'create' ? t('modal.add.title') : t('form.editTitle', { name: item!.name })}</h2>
            <p>{mode === 'create' ? t('modal.add.sub') : t('form.editSub')}</p>
          </div>
          <button className="form-close" onClick={onClose} aria-label={t('action.cancel')}><X /></button>
        </header>

        <div className="form-body">
          {mode === 'create' && (
            <div className="type-picker">
              {(Object.keys(TYPE_META) as ItemType[]).map((type) => {
                const Icon = TYPE_META[type].icon
                return (
                  <button key={type} type="button" className={itemType === type ? 'type-option selected' : 'type-option'} onClick={() => chooseType(type)}>
                    <Icon />
                    <span>{typeLabel(t, type)}</span>
                  </button>
                )
              })}
            </div>
          )}

          <FormSection icon={ClipboardList} title={t('form.section.basics')} hint={t('form.section.basics.hint')}>
            <div className="form-grid">
              <label className="span-2">{t('field.name')}<input value={name} onChange={(e) => setName(e.target.value)} placeholder={t(`ph.name.${itemType}`)} autoFocus={mode === 'create'} /></label>
              <label>
                {itemType === 'resource' ? t('field.material') : t('field.species')}
                <input list={`species-${itemType}`} value={species} onChange={(e) => setSpecies(e.target.value)} placeholder={t(`ph.species.${itemType}`)} />
                <datalist id={`species-${itemType}`}>{SPECIES_SUGGESTIONS[itemType].map((s) => <option key={s} value={s} />)}</datalist>
              </label>
              <label>{itemType === 'animal' ? t('field.breed') : t('field.variety')} {opt}<input value={breed} onChange={(e) => setBreed(e.target.value)} placeholder={itemType === 'animal' ? t('ph.breed.animal') : t('ph.breed.tree')} /></label>
              <label>{t('fld.select')}<select value={fieldId} onChange={(e) => setFieldId(e.target.value)}>{fields.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
              <label>{t('field.location')}<input value={zone} onChange={(e) => setZone(e.target.value)} placeholder={t('ph.location')} /></label>
              <label>{t('field.quantity')}<input type="number" min="0.01" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></label>
              <label>{t('field.unit')}<input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder={t('ph.unit')} /></label>
              <label>{itemType === 'animal' ? t('field.tag') : t('field.reference')} {opt}<input value={tagNumber} onChange={(e) => setTagNumber(e.target.value)} placeholder={itemType === 'animal' ? t('ph.tag') : t('ph.reference')} /></label>
              <label>{originLabel} {opt}<input type="date" value={originDate} onChange={(e) => setOriginDate(e.target.value)} /></label>
              <div className="form-field span-2">
                <span className="form-label">{t('table.status')}</span>
                <Segmented
                  value={status}
                  onChange={setStatus}
                  options={[
                    { value: 'healthy', label: t('status.healthy'), icon: ShieldCheck, tone: 'green' },
                    { value: 'attention', label: t('status.attention'), icon: TriangleAlert, tone: 'amber' },
                  ]}
                />
              </div>
              <label className="span-2">{t('field.notes')} {opt}<textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('ph.notes')} /></label>
            </div>
          </FormSection>

          <FormSection icon={TypeIcon} title={t(`form.profile.${itemType}`)} hint={t(`form.profile.${itemType}.hint`)} optional>
            {itemType === 'animal' && (
              <div className="form-grid">
                <div className="form-field span-2">
                  <span className="form-label">{t('profile.sex')}</span>
                  <Segmented<Sex>
                    value={(pv('sex') as Sex) || ''}
                    onChange={(v) => setP('sex', v)}
                    options={[
                      { value: 'female', label: t('sex.female'), icon: Venus, tone: 'rose' },
                      { value: 'male', label: t('sex.male'), icon: Mars, tone: 'blue' },
                      { value: 'unknown', label: t('sex.unknown'), icon: CircleHelp },
                    ]}
                  />
                </div>
                <label>{t('profile.color')}<input value={pv('color')} onChange={(e) => setP('color', e.target.value)} placeholder={t('ph.color')} /></label>
                <label>
                  {t('profile.purpose')}
                  <select value={pv('purpose')} onChange={(e) => setP('purpose', e.target.value)}>
                    <option value="">—</option>
                    {PURPOSES.map((p) => <option key={p} value={p}>{t(`purpose.${p}`)}</option>)}
                  </select>
                </label>
                {pv('sex') !== 'male' && (
                  <label>
                    {t('profile.repro')}
                    <select value={pv('reproStatus')} onChange={(e) => setP('reproStatus', e.target.value)}>
                      <option value="">—</option>
                      {REPRO_STATUSES.map((r) => <option key={r} value={r}>{t(`repro.${r}`)}</option>)}
                    </select>
                  </label>
                )}
                {pv('reproStatus') === 'pregnant' && pv('sex') !== 'male' && (
                  <label>{t('profile.dueDate')}<input type="date" value={pv('dueDate')} onChange={(e) => setP('dueDate', e.target.value)} /></label>
                )}
                <label>
                  {t('profile.mother')}
                  <select value={pv('motherId')} onChange={(e) => setP('motherId', e.target.value)}>
                    <option value="">{t('profile.none')}</option>
                    {mothers.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.id}</option>)}
                  </select>
                </label>
                <label>
                  {t('profile.father')}
                  <select value={pv('fatherId')} onChange={(e) => setP('fatherId', e.target.value)}>
                    <option value="">{t('profile.none')}</option>
                    {fathers.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.id}</option>)}
                  </select>
                </label>
                <label>{t('profile.source')}<input value={pv('source')} onChange={(e) => setP('source', e.target.value)} placeholder={t('ph.source')} /></label>
                <label>{t('profile.price')}<UnitInput value={pv('purchasePrice')} onChange={(v) => setP('purchasePrice', v)} unit={settings.currency} placeholder="0" /></label>
              </div>
            )}

            {itemType === 'tree' && (
              <div className="form-grid">
                <label>{t('profile.rootstock')}<input value={pv('rootstock')} onChange={(e) => setP('rootstock', e.target.value)} placeholder={t('ph.rootstock')} /></label>
                <label>{t('profile.spacing')}<input value={pv('spacing')} onChange={(e) => setP('spacing', e.target.value)} placeholder={t('ph.spacing')} /></label>
                <label>
                  {t('profile.irrigation')}
                  <select value={pv('irrigation')} onChange={(e) => setP('irrigation', e.target.value)}>
                    <option value="">—</option>
                    {IRRIGATIONS.map((i) => <option key={i} value={i}>{t(`irr.${i}`)}</option>)}
                  </select>
                </label>
                <label>{t('profile.pollinator')}<input value={pv('pollinator')} onChange={(e) => setP('pollinator', e.target.value)} placeholder={t('ph.pollinator')} /></label>
                <label>{t('profile.expectedYield')}<UnitInput value={pv('expectedYield')} onChange={(v) => setP('expectedYield', v)} unit="kg" placeholder="0" /></label>
                <label className="check-row">
                  <input type="checkbox" checked={pv('organic') === 'true'} onChange={(e) => setP('organic', e.target.checked ? 'true' : 'false')} />
                  <span>{t('profile.organic')}</span>
                </label>
              </div>
            )}

            {itemType === 'resource' && (
              <div className="form-grid">
                <label>{t('profile.capacity')}<UnitInput value={pv('capacity')} onChange={(v) => setP('capacity', v)} unit={unit} placeholder="0" /></label>
                <label>{t('profile.currentLevel')}<UnitInput value={pv('currentLevel')} onChange={(v) => setP('currentLevel', v)} unit={unit} placeholder="0" /></label>
                <label>{t('profile.reorderAt')}<UnitInput value={pv('reorderAt')} onChange={(v) => setP('reorderAt', v)} unit={unit} placeholder="0" /></label>
                <label>{t('profile.unitCost')}<UnitInput value={pv('unitCost')} onChange={(v) => setP('unitCost', v)} unit={`${settings.currency}/${unit}`} placeholder="0" /></label>
                <label className="span-2">{t('profile.supplier')}<input value={pv('supplier')} onChange={(e) => setP('supplier', e.target.value)} placeholder={t('ph.supplier')} /></label>
              </div>
            )}
          </FormSection>

          <FormSection icon={Tags} title={t('form.section.custom')} hint={t('form.section.custom.hint')} optional>
            {custom.length > 0 && (
              <div className="custom-rows">
                {custom.map((row, index) => (
                  <div className="custom-row" key={index}>
                    <input aria-label={t('custom.key')} value={row.key} onChange={(e) => updateCustom(index, { key: e.target.value })} placeholder={t('ph.custom.key')} />
                    <input aria-label={t('custom.value')} value={row.value} onChange={(e) => updateCustom(index, { value: e.target.value })} placeholder={t('ph.custom.value')} />
                    <button type="button" className="icon-ghost" onClick={() => setCustom((rows) => rows.filter((_, i) => i !== index))} aria-label={t('custom.remove')}><Trash2 /></button>
                  </div>
                ))}
              </div>
            )}
            <button type="button" className="ghost-button" onClick={() => setCustom((rows) => [...rows, { key: '', value: '' }])}><Plus />{t('custom.add')}</button>
          </FormSection>
        </div>

        <footer className="form-foot">
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="form-foot-actions">
            <button className="cancel-button" onClick={onClose} disabled={saving}>{t('action.cancel')}</button>
            <button className="primary-button" onClick={submit} disabled={saving}>
              {saving ? <><Loader2 className="spin" data-icon="inline-start" />{t('action.saving')}</> : <><Check data-icon="inline-start" />{mode === 'create' ? t('action.createRecord') : t('action.saveChanges')}</>}
            </button>
          </div>
        </footer>
      </section>
    </div>
  )
}
