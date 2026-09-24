'use client'

// The item record: everything known about one tree, animal, or resource, plus
// logging, history, and its tasks. Organised in tabs so it's obvious where to
// look and where to add information.

import { useMemo, useState } from 'react'
import useSWR from 'swr'
import {
  ArrowLeft,
  CalendarClock,
  ClipboardList,
  Gauge,
  GitBranch,
  LayoutList,
  ListChecks,
  Loader2,
  Map as MapIcon,
  Mars,
  Plus,
  Scale,
  ShieldCheck,
  SquarePen,
  StickyNote,
  Tags,
  Trash2,
  TriangleAlert,
  Venus,
} from 'lucide-react'
import {
  DEFAULT_UNIT,
  isMeasured,
  KINDS_BY_TYPE,
  type CreateTaskInput,
  type Field,
  type Item,
  type LogEntry,
  type LogKind,
  type Task,
} from '@/lib/farm-types'
import { zonesForItem } from '@/lib/map-utils'
import {
  ageLabel,
  daysUntil,
  fetcher,
  fmt,
  fmtMoney,
  formatDate,
  KIND_META,
  kindLabel,
  relativeTime,
  TYPE_META,
  unitLabel,
  type Translate,
} from '@/lib/ui'
import { useI18n } from '@/components/language-provider'
import { useSettings } from '@/components/settings-provider'
import { useToast } from '@/components/toast-provider'
import { useConfirm } from '@/components/confirm-provider'
import { useAllItems } from '@/components/data-hooks'
import { ItemTasks } from '@/components/tasks'
import { ZONE_META } from '@/components/field-map'
import { apiFetch } from '@/lib/client-api'

// ---------------------------------------------------------------------------
// Log form (type-aware)
// ---------------------------------------------------------------------------

function LogForm({ item, onLogged }: { item: Item; onLogged: () => void }) {
  const { t } = useI18n()
  const { toast } = useToast()
  const kinds = KINDS_BY_TYPE[item.itemType]
  const [kind, setKind] = useState<LogKind>(kinds[0])
  const [amount, setAmount] = useState('')
  const [unit, setUnit] = useState(DEFAULT_UNIT[kinds[0]])
  const [note, setNote] = useState('')
  const [performedBy, setPerformedBy] = useState('')
  const [appliedAt, setAppliedAt] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const measured = isMeasured(kind)

  const chooseKind = (k: LogKind) => {
    setKind(k)
    setUnit(DEFAULT_UNIT[k])
    setError('')
  }

  const submit = async () => {
    if (measured) {
      const a = Number(amount)
      if (!Number.isFinite(a) || a <= 0) {
        setError(t('err.amountPositive'))
        return
      }
    }
    setSaving(true)
    setError('')
    try {
      const res = await apiFetch(`/api/farm-items/${item.id}/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          amount: measured ? Number(amount) : undefined,
          unit,
          note,
          performedBy,
          appliedAt: appliedAt ? new Date(appliedAt).toISOString() : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || t('err.saveEntry'))
        return
      }
      setAmount('')
      setNote('')
      setAppliedAt('')
      toast(t('toast.inputRecorded', { kind: kindLabel(t, kind) }))
      onLogged()
    } catch {
      setError(t('err.network'))
      toast(t('toast.error'), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="log-form">
      <p className="log-hint">{t(`log.hint.${item.itemType}`)}</p>
      <div className="kind-grid">
        {kinds.map((k) => {
          const meta = KIND_META[k]
          const Icon = meta.icon
          return (
            <button key={k} type="button" className={kind === k ? `kind-chip ${meta.tone} selected` : `kind-chip ${meta.tone}`} onClick={() => chooseKind(k)}>
              <Icon />
              <span>{kindLabel(t, k)}</span>
            </button>
          )
        })}
      </div>
      <div className="log-fields">
        {measured && (
          <div className="form-row">
            <label>{kind === 'weight' ? t('profile.weight') : t('log.amount')}<input type="number" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" /></label>
            <label>{t('log.unit')}<input value={unit} onChange={(e) => setUnit(e.target.value)} /></label>
          </div>
        )}
        <div className="form-row">
          <label>{t('log.when')}<input type="datetime-local" value={appliedAt} onChange={(e) => setAppliedAt(e.target.value)} /></label>
          <label>{t('log.by')} <em>{t('field.optional')}</em><input value={performedBy} onChange={(e) => setPerformedBy(e.target.value)} placeholder={t('ph.by')} /></label>
        </div>
        <label>{t('log.note')} <em>{t('field.optional')}</em><input value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === 'health-check' ? t('ph.note.health') : t('ph.note.default')} /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-button full" onClick={submit} disabled={saving}>
          {saving ? <><Loader2 className="spin" data-icon="inline-start" />{t('action.recording')}</> : <><Plus data-icon="inline-start" />{t('action.record', { kind: kindLabel(t, kind).toLocaleLowerCase() })}</>}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Small visual pieces
// ---------------------------------------------------------------------------

function Sparkline({ points }: { points: { x: number; y: number }[] }) {
  if (points.length === 0) return null
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const sx = (x: number) => (maxX === minX ? 50 : 3 + ((x - minX) / (maxX - minX)) * 94)
  const sy = (y: number) => (maxY === minY ? 20 : 34 - ((y - minY) / (maxY - minY)) * 28)
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(2)},${sy(p.y).toFixed(2)}`).join(' ')
  const last = points[points.length - 1]
  const area = `${line} L${sx(last.x).toFixed(2)},40 L${sx(points[0].x).toFixed(2)},40 Z`
  return (
    <div className="sparkline">
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
        <path d={area} className="spark-area" />
        <path d={line} className="spark-line" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="spark-dot" style={{ left: `${sx(last.x)}%`, top: `${(sy(last.y) / 40) * 100}%` }} />
    </div>
  )
}

function Meter({ value, max, marker, tone }: { value: number; max: number; marker?: number; tone: 'green' | 'amber' | 'rose' }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  const markPct = marker !== undefined && max > 0 ? Math.min(100, (marker / max) * 100) : undefined
  return (
    <div className="meter">
      <span className={`meter-fill ${tone}`} style={{ width: `${pct}%` }} />
      {markPct !== undefined && <span className="meter-mark" style={{ insetInlineStart: `${markPct}%` }} />}
    </div>
  )
}

function InfoCard({ icon: CardIcon, title, action, children }: { icon: typeof Scale; title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="info-card">
      <div className="info-card-head">
        <span className="info-card-title"><CardIcon />{title}</span>
        {action}
      </div>
      {children}
    </section>
  )
}

function Rows({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="kv-rows">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

// ---------------------------------------------------------------------------
// Overview tab
// ---------------------------------------------------------------------------

function profileRows(item: Item, t: Translate, locale: Parameters<typeof fmt>[1], currency: string): [string, React.ReactNode][] {
  const p = item.profile ?? {}
  const rows: [string, React.ReactNode][] = []
  const push = (label: string, value: React.ReactNode | undefined | null | false) => {
    if (value !== undefined && value !== null && value !== false && value !== '') rows.push([label, value])
  }
  if (item.itemType === 'animal') {
    push(t('profile.sex'), p.sex && t(`sex.${p.sex}`))
    push(t('profile.age'), ageLabel(item.originDate, t))
    push(t('profile.color'), p.color)
    push(t('profile.purpose'), p.purpose && t(`purpose.${p.purpose}`))
    if (p.reproStatus) {
      const due = p.reproStatus === 'pregnant' && p.dueDate ? ` · ${t('profile.dueIn', { n: Math.max(0, daysUntil(p.dueDate)), date: formatDate(p.dueDate, locale) })}` : ''
      push(t('profile.repro'), `${t(`repro.${p.reproStatus}`)}${due}`)
    }
    push(t('profile.source'), p.source)
    push(t('profile.price'), p.purchasePrice !== undefined && fmtMoney(p.purchasePrice, currency, locale))
  } else if (item.itemType === 'tree') {
    push(t('field.variety'), item.breed)
    push(t('profile.age'), ageLabel(item.originDate, t))
    push(t('profile.rootstock'), p.rootstock)
    push(t('profile.spacing'), p.spacing)
    push(t('profile.irrigation'), p.irrigation && t(`irr.${p.irrigation}`))
    push(t('profile.pollinator'), p.pollinator)
    push(t('profile.expectedYield'), p.expectedYield !== undefined && `${fmt(p.expectedYield, locale)} kg`)
    push(t('profile.organic'), p.organic !== undefined && (p.organic ? t('common.yes') : t('common.no')))
  } else {
    push(t('profile.capacity'), p.capacity !== undefined && `${fmt(p.capacity, locale)} ${unitLabel(locale, item.unit, p.capacity)}`)
    push(t('profile.currentLevel'), p.currentLevel !== undefined && `${fmt(p.currentLevel, locale)} ${unitLabel(locale, item.unit, p.currentLevel)}`)
    push(t('profile.reorderAt'), p.reorderAt !== undefined && `${fmt(p.reorderAt, locale)} ${unitLabel(locale, item.unit, p.reorderAt)}`)
    push(t('profile.supplier'), p.supplier)
    push(t('profile.unitCost'), p.unitCost !== undefined && `${fmtMoney(p.unitCost, currency, locale)} / ${unitLabel(locale, item.unit, 1)}`)
    if (p.unitCost !== undefined && p.currentLevel !== undefined) push(t('profile.stockValue'), fmtMoney(p.unitCost * p.currentLevel, currency, locale))
  }
  return rows
}

function Overview({ item, logs, fields, onOpenItem, onEdit }: {
  item: Item
  logs: LogEntry[]
  fields: Field[]
  onOpenItem: (id: string) => void
  onEdit: () => void
}) {
  const { t, locale } = useI18n()
  const { settings } = useSettings()
  const allItems = useAllItems()
  const byId = useMemo(() => new Map(allItems.map((i) => [i.id, i])), [allItems])
  const p = item.profile ?? {}
  const rows = profileRows(item, t, locale, settings.currency)

  const weights = logs
    .filter((l) => l.kind === 'weight')
    .map((l) => ({ x: new Date(l.appliedAt).getTime(), y: l.amount }))
    .sort((a, b) => a.x - b.x)
  const latestWeight = weights.at(-1)
  const weightDelta = weights.length > 1 ? weights[weights.length - 1].y - weights[weights.length - 2].y : null

  const year = new Date().getFullYear()
  const seasonHarvest = logs.filter((l) => l.kind === 'harvest' && new Date(l.appliedAt).getFullYear() === year).reduce((s, l) => s + l.amount, 0)

  const mother = p.motherId ? byId.get(p.motherId) : undefined
  const father = p.fatherId ? byId.get(p.fatherId) : undefined
  const offspring = allItems.filter((i) => i.profile?.motherId === item.id || i.profile?.fatherId === item.id)

  const zones = zonesForItem(
    fields.map((f) => ({ fieldId: f.id, fieldName: f.name, map: f.map })),
    item.id,
  )
  const fieldName = fields.find((f) => f.id === item.fieldId)?.name ?? '—'
  const totals = Object.keys(item.totals) as LogKind[]

  const ParentLink = ({ label, parent, Icon }: { label: string; parent?: Item; Icon: typeof Venus }) => (
    <div className="family-slot">
      <span className="family-label"><Icon />{label}</span>
      {parent ? (
        <button className="family-link" onClick={() => onOpenItem(parent.id)}>{parent.name}<small>{parent.id}</small></button>
      ) : (
        <span className="family-none">{t('profile.none')}</span>
      )}
    </div>
  )

  return (
    <div className="overview-tab">
      <dl className="detail-facts">
        <div><dt>{t('fact.field')}</dt><dd>{fieldName}</dd></div>
        <div><dt>{t('fact.location')}</dt><dd>{item.zone}</dd></div>
        <div><dt>{t('fact.quantity')}</dt><dd>{fmt(item.quantity, locale)} {unitLabel(locale, item.unit, item.quantity)}</dd></div>
        {item.tagNumber && <div><dt>{t('fact.tagRef')}</dt><dd>{item.tagNumber}</dd></div>}
        <div><dt>{item.itemType === 'tree' ? t('field.planted') : item.itemType === 'animal' ? t('field.born') : t('field.acquired')}</dt><dd>{formatDate(item.originDate, locale)}</dd></div>
        <div><dt>{t('fact.entries')}</dt><dd>{fmt(item.logCount, locale)}</dd></div>
      </dl>

      <InfoCard icon={TYPE_META[item.itemType].icon} title={t(`form.profile.${item.itemType}`)} action={<button className="text-button" onClick={onEdit}><SquarePen />{t('action.edit')}</button>}>
        {rows.length > 0 ? <Rows rows={rows} /> : (
          <div className="detail-empty">
            {t('drawer.noProfile')}
            <button className="ghost-button" onClick={onEdit}><SquarePen />{t('drawer.addDetails')}</button>
          </div>
        )}
      </InfoCard>

      {item.itemType === 'animal' && (
        <InfoCard icon={Scale} title={t('drawer.weightHistory')}>
          {latestWeight ? (
            <div className="weight-card">
              <div className="weight-now">
                <strong>{fmt(latestWeight.y, locale)} kg</strong>
                {weightDelta !== null && weightDelta !== 0 && (
                  <span className={weightDelta > 0 ? 'trend up' : 'trend down'}>
                    {weightDelta > 0 ? '▲' : '▼'} {fmt(Math.abs(weightDelta), locale)} kg
                  </span>
                )}
                <small>{t('drawer.readings', { n: weights.length })}</small>
              </div>
              <Sparkline points={weights} />
            </div>
          ) : (
            <p className="muted-line">{t('drawer.noWeight')}</p>
          )}
        </InfoCard>
      )}

      {item.itemType === 'animal' && (
        <InfoCard icon={GitBranch} title={t('drawer.family')}>
          <div className="family-grid">
            <ParentLink label={t('profile.mother')} parent={mother} Icon={Venus} />
            <ParentLink label={t('profile.father')} parent={father} Icon={Mars} />
          </div>
          {offspring.length > 0 && (
            <div className="offspring">
              <span className="family-label">{t('drawer.offspring', { n: offspring.length })}</span>
              <div className="chip-row">
                {offspring.map((o) => <button key={o.id} className="chip small" onClick={() => onOpenItem(o.id)}>{o.name}</button>)}
              </div>
            </div>
          )}
        </InfoCard>
      )}

      {item.itemType === 'tree' && p.expectedYield !== undefined && p.expectedYield > 0 && (
        <InfoCard icon={Gauge} title={t('drawer.yield', { year })}>
          <div className="meter-line">
            <strong>{fmt(seasonHarvest, locale)} kg</strong>
            <span>{t('drawer.ofExpected', { n: fmt(p.expectedYield, locale) })}</span>
          </div>
          <Meter value={seasonHarvest} max={p.expectedYield} tone={seasonHarvest >= p.expectedYield ? 'green' : 'amber'} />
        </InfoCard>
      )}

      {item.itemType === 'resource' && p.capacity !== undefined && p.capacity > 0 && p.currentLevel !== undefined && (
        <InfoCard
          icon={Gauge}
          title={t('drawer.stockLevel')}
          action={p.reorderAt !== undefined && p.currentLevel <= p.reorderAt ? <span className="badge warn"><TriangleAlert />{t('stock.low')}</span> : <span className="badge ok"><ShieldCheck />{t('stock.ok')}</span>}
        >
          <div className="meter-line">
            <strong>{fmt(p.currentLevel, locale)} {unitLabel(locale, item.unit, p.currentLevel)}</strong>
            <span>{t('drawer.ofCapacity', { n: fmt(p.capacity, locale), unit: unitLabel(locale, item.unit, p.capacity), pct: fmt((p.currentLevel / p.capacity) * 100, locale, 0) })}</span>
          </div>
          <Meter
            value={p.currentLevel}
            max={p.capacity}
            marker={p.reorderAt}
            tone={p.reorderAt !== undefined && p.currentLevel <= p.reorderAt ? 'rose' : 'green'}
          />
        </InfoCard>
      )}

      {zones.length > 0 && (
        <InfoCard icon={MapIcon} title={t('drawer.onMap')}>
          <div className="chip-row">
            {zones.map(({ fieldName: fName, zone }) => (
              <span key={`${fName}-${zone.id}`} className="zone-tag">
                <span className="zone-tag-dot" style={{ background: ZONE_META[zone.kind].color }} />
                {fName} › {zone.name}
              </span>
            ))}
          </div>
        </InfoCard>
      )}

      <InfoCard icon={Tags} title={t('form.section.custom')} action={<button className="text-button" onClick={onEdit}><SquarePen />{t('action.edit')}</button>}>
        {item.customFields && item.customFields.length > 0 ? (
          <Rows rows={item.customFields.map((c) => [c.key, c.value || '—'])} />
        ) : (
          <p className="muted-line">{t('custom.empty')}</p>
        )}
      </InfoCard>

      {item.notes && <p className="detail-notes"><StickyNote />{item.notes}</p>}

      <h3 className="detail-section-title">{t('drawer.inputs')}</h3>
      {totals.length === 0 ? (
        <p className="detail-empty">{t('drawer.nothingLogged')}</p>
      ) : (
        <div className="total-grid">
          {totals.map((k) => {
            const meta = KIND_META[k]
            const Icon = meta.icon
            const total = item.totals[k]!
            const entriesWord = total.count === 1 ? t('entries.entry') : t('entries.entries')
            return (
              <div className={`total-card ${meta.tone}`} key={k}>
                <div className="total-head"><Icon /><span>{kindLabel(t, k)}</span></div>
                <strong>{isMeasured(k) ? `${fmt(total.amount, locale)} ${unitLabel(locale, total.unit, total.amount)}` : `${fmt(total.count, locale)}×`}</strong>
                <small>
                  {k === 'weight' ? `${t('drawer.latest')} · ` : ''}
                  {fmt(total.count, locale)} {entriesWord} · {t('drawer.lastPrefix')} {relativeTime(total.lastAppliedAt, t)}
                </small>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Drawer
// ---------------------------------------------------------------------------

type DrawerTab = 'overview' | 'log' | 'history' | 'tasks'

export function ItemDrawer({ itemId, fields, onClose, onChanged, onOpenItem, onEdit, onNewTask, onEditTask }: {
  itemId: string
  fields: Field[]
  onClose: () => void
  onChanged: () => void
  onOpenItem: (id: string) => void
  onEdit: (item: Item) => void
  onNewTask: (prefill: Partial<CreateTaskInput>) => void
  onEditTask: (task: Task) => void
}) {
  const { t, locale } = useI18n()
  const confirm = useConfirm()
  const { toast } = useToast()
  const { data, isLoading, mutate } = useSWR<{ item: Item; logs: LogEntry[] }>(`/api/farm-items/${itemId}`, fetcher)
  const [tab, setTab] = useState<DrawerTab>('overview')
  const [busy, setBusy] = useState(false)

  const item = data?.item
  const logs = data?.logs ?? []

  const refresh = () => {
    void mutate()
    onChanged()
  }

  const toggleStatus = async () => {
    if (!item) return
    setBusy(true)
    try {
      const res = await apiFetch(`/api/farm-items/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: item.status === 'healthy' ? 'attention' : 'healthy' }),
      })
      if (!res.ok) throw new Error('failed')
      refresh()
      toast(t('toast.itemUpdated'))
    } catch {
      toast(t('toast.error'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!item) return
    const ok = await confirm({
      title: t('item.delete.title', { name: item.name }),
      message: t('item.delete.body', { id: item.id }),
      confirmLabel: t('action.delete'),
      tone: 'danger',
    })
    if (!ok) return
    setBusy(true)
    try {
      const res = await apiFetch(`/api/farm-items/${item.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('failed')
      onChanged()
      onClose()
      toast(t('toast.itemDeleted'))
    } catch {
      toast(t('toast.error'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const tabs: { id: DrawerTab; label: string; icon: typeof Scale }[] = [
    { id: 'overview', label: t('drawer.tab.overview'), icon: LayoutList },
    { id: 'log', label: t('drawer.logInput'), icon: Plus },
    { id: 'history', label: `${t('drawer.history')} (${fmt(logs.length, locale)})`, icon: ClipboardList },
    { id: 'tasks', label: t('drawer.tab.tasks'), icon: ListChecks },
  ]

  const p = item?.profile
  const heroChips: string[] = []
  if (item?.itemType === 'animal') {
    if (p?.sex) heroChips.push(t(`sex.${p.sex}`))
    const age = ageLabel(item.originDate, t)
    if (age) heroChips.push(age)
    if (item.totals.weight) heroChips.push(`${fmt(item.totals.weight.amount, locale)} kg`)
    if (p?.reproStatus === 'pregnant') heroChips.push(t('repro.pregnant'))
  } else if (item?.itemType === 'tree') {
    heroChips.push(`${fmt(item.quantity, locale)} ${unitLabel(locale, item.unit, item.quantity)}`)
    const age = ageLabel(item.originDate, t)
    if (age) heroChips.push(age)
    if (p?.irrigation) heroChips.push(t(`irr.${p.irrigation}`))
  } else if (item && p?.capacity && p.currentLevel !== undefined) {
    heroChips.push(`${fmt((p.currentLevel / p.capacity) * 100, locale, 0)}%`)
  }

  return (
    <div className="drawer-backdrop" role="presentation" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={t('drawer.title')} onClick={(e) => e.stopPropagation()}>
        <header className="drawer-header">
          <button className="drawer-close" onClick={onClose} aria-label={t('action.cancel')}><ArrowLeft className="rtl-flip" /></button>
          <span className="drawer-title">{t('drawer.title')}</span>
          <div className="drawer-header-actions">
            <button className="drawer-edit" onClick={() => item && onEdit(item)} disabled={!item} aria-label={t('action.edit')} title={t('action.edit')}><SquarePen /></button>
            <button className="drawer-delete" onClick={remove} disabled={busy || !item} aria-label={t('task.delete')} title={t('action.delete')}><Trash2 /></button>
          </div>
        </header>

        {isLoading || !item ? (
          <div className="drawer-loading"><Loader2 className="spin" /> {t('drawer.loading')}</div>
        ) : (
          <div className="drawer-body">
            <div className="detail-hero">
              <div className={`asset-icon lg ${TYPE_META[item.itemType].tone}`}>
                {(() => { const Icon = TYPE_META[item.itemType].icon; return <Icon /> })()}
              </div>
              <div className="detail-hero-text">
                <h2>{item.name}</h2>
                <p>{item.id} · {item.species}{item.breed ? ` · ${item.breed}` : ''}</p>
              </div>
              <button className={`status-toggle ${item.status}`} onClick={toggleStatus} disabled={busy}>
                {item.status === 'healthy' ? <ShieldCheck /> : <TriangleAlert />}
                {item.status === 'healthy' ? t('status.healthy') : t('status.attention')}
              </button>
            </div>
            {heroChips.length > 0 && <div className="hero-chips">{heroChips.map((c) => <span key={c}>{c}</span>)}</div>}

            <div className="quick-actions">
              <button onClick={() => setTab('log')}><Plus />{t('drawer.logInput')}</button>
              <button onClick={() => onNewTask({ itemId: item.id })}><CalendarClock />{t('drawer.addTask')}</button>
              <button onClick={() => onEdit(item)}><SquarePen />{t('drawer.editDetails')}</button>
            </div>

            <div className="drawer-tabs" role="tablist">
              {tabs.map((tb) => {
                const Icon = tb.icon
                return (
                  <button key={tb.id} role="tab" aria-selected={tab === tb.id} className={tab === tb.id ? 'active' : ''} onClick={() => setTab(tb.id)}>
                    <Icon />{tb.label}
                  </button>
                )
              })}
            </div>

            {tab === 'overview' && <Overview item={item} logs={logs} fields={fields} onOpenItem={onOpenItem} onEdit={() => onEdit(item)} />}
            {tab === 'log' && <LogForm key={item.id} item={item} onLogged={refresh} />}
            {tab === 'history' && (
              <div className="log-list">
                {logs.length === 0 && <p className="detail-empty">{t('empty.noEntries')}</p>}
                {logs.map((log) => {
                  const meta = KIND_META[log.kind]
                  const Icon = meta.icon
                  return (
                    <div className="log-row" key={log.id}>
                      <div className={`log-icon ${meta.tone}`}><Icon /></div>
                      <div className="log-main">
                        <strong>{kindLabel(t, log.kind)}{isMeasured(log.kind) && log.amount > 0 ? ` · ${fmt(log.amount, locale)} ${unitLabel(locale, log.unit, log.amount)}` : ''}</strong>
                        {log.note && <span>{log.note}</span>}
                        {log.performedBy && <em>{t('log.by.prefix', { name: log.performedBy })}</em>}
                      </div>
                      <time>{formatDate(log.appliedAt, locale)}</time>
                    </div>
                  )
                })}
              </div>
            )}
            {tab === 'tasks' && <ItemTasks itemId={item.id} onEdit={onEditTask} onNew={() => onNewTask({ itemId: item.id })} />}
          </div>
        )}
      </aside>
    </div>
  )
}
