'use client'

import useSWR from 'swr'
import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  ArrowRight,
  Boxes,
  Building2,
  CalendarClock,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ClipboardList,
  Database,
  Droplets,
  Filter,
  Globe,
  Layers,
  Leaf,
  Loader2,
  LogOut,
  Map as MapIcon,
  MapPin,
  MoreHorizontal,
  Palette,
  PawPrint,
  Pencil,
  Plus,
  Recycle,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  TreePine,
  TriangleAlert,
  UserRound,
  Wheat,
} from 'lucide-react'
import {
  isMeasured,
  todayISO,
  type CreateTaskInput,
  type FarmStats,
  type Field,
  type Item,
  type ItemType,
  type LogKind,
  type Task,
} from '@/lib/farm-types'
import { LOCALES } from '@/lib/i18n'
import { fetcher, fmt, intlLocale, KIND_META, kindLabel, relativeTime, TYPE_META, typeLabel, unitLabel, type Icon, type Translate } from '@/lib/ui'
import { useI18n } from '@/components/language-provider'
import { ACCENTS, CURRENCIES, useSettings, type Accent } from '@/components/settings-provider'
import { useToast } from '@/components/toast-provider'
import { useConfirm } from '@/components/confirm-provider'
import { signOut, useAuth } from '@/components/auth-provider'
import { apiFetch } from '@/lib/client-api'
import { useAllItems, useFields, useRefresh, useTasks } from '@/components/data-hooks'
import { FieldMapEditor } from '@/components/field-map'
import { ItemFormModal } from '@/components/item-form'
import { ItemDrawer } from '@/components/item-drawer'
import { FieldFormModal } from '@/components/field-form'
import { MetaLine } from '@/components/meta-line'
import { BellMenu, TaskFormModal, TasksView, tasksInScope, UpcomingTasksPanel } from '@/components/tasks'

const FIELD_STORAGE_KEY = 'fieldwise.field'
const SIDEBAR_STORAGE_KEY = 'fieldwise.sidebar'

const NAV_ITEMS = [
  { id: 'overview', icon: Activity, key: 'nav.overview' },
  { id: 'assets', icon: TreePine, key: 'nav.assets' },
  { id: 'map', icon: MapIcon, key: 'nav.map' },
  { id: 'tasks', icon: CalendarDays, key: 'nav.tasks' },
  { id: 'reports', icon: Wheat, key: 'nav.reports' },
] as const
type NavId = 'overview' | 'assets' | 'map' | 'tasks' | 'reports' | 'settings'
const navLabelKey = (id: NavId) => (id === 'settings' ? 'nav.settings' : NAV_ITEMS.find((n) => n.id === id)!.key)

// --------------------------------------------------------------------------
// Small building blocks
// --------------------------------------------------------------------------

function MetricCard({ label, value, detail, icon: MetricIcon, tone }: { label: string; value: string; detail: string; icon: Icon; tone: string }) {
  return (
    <div className="metric-card">
      <div className={`metric-icon ${tone}`}><MetricIcon aria-hidden="true" /></div>
      <div>
        <p className="eyebrow">{label}</p>
        <p className="metric-value">{value}</p>
        <p className="metric-detail">{detail}</p>
      </div>
    </div>
  )
}

function StatusPill({ status, t }: { status: Item['status']; t: Translate }) {
  return (
    <span className={`status ${status === 'healthy' ? 'healthy' : 'attention'}`}>
      <i />
      {status === 'healthy' ? t('status.healthy') : t('status.attention')}
    </span>
  )
}

function InventoryTable({ items, onSelect }: { items: Item[]; onSelect: (item: Item) => void }) {
  const { t } = useI18n()
  return (
    <div className="asset-table">
      <div className="table-head">
        <span>{t('table.item')}</span>
        <span>{t('table.type')}</span>
        <span>{t('table.location')}</span>
        <span>{t('table.status')}</span>
        <span>{t('table.updated')}</span>
      </div>
      {items.map((item) => {
        const meta = TYPE_META[item.itemType]
        const TypeIcon = meta.icon
        return (
          <button className="table-row" key={item.id} onClick={() => onSelect(item)}>
            <div className="asset-name">
              <div className={`asset-icon ${meta.tone}`}><TypeIcon /></div>
              <div>
                <strong>{item.name}</strong>
                <span>{item.id}</span>
              </div>
            </div>
            <span>{item.species}{item.breed ? ` · ${item.breed}` : ''}</span>
            <span className="location"><MapPin />{item.zone}</span>
            <StatusPill status={item.status} t={t} />
            <span className="updated">{relativeTime(item.updatedAt, t)}</span>
          </button>
        )
      })}
    </div>
  )
}

function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n()
  const [open, setOpen] = useState(false)
  const current = LOCALES.find((l) => l.code === locale)!
  return (
    <div className="lang-switch">
      <button className="lang-button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label={t('lang.label')}>
        <Globe />
        <span>{current.short}</span>
        <ChevronDown className="lang-caret" />
      </button>
      {open && (
        <>
          <div className="lang-backdrop" onClick={() => setOpen(false)} />
          <div className="lang-menu" role="menu">
            {LOCALES.map((l) => (
              <button
                key={l.code}
                role="menuitemradio"
                aria-checked={l.code === locale}
                className={l.code === locale ? 'lang-item active' : 'lang-item'}
                onClick={() => { setLocale(l.code); setOpen(false) }}
              >
                <span>{l.native}</span>
                {l.code === locale && <Check />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function FieldSwitcher({ fields, activeFieldId, onSelect, onAdd, variant }: { fields: Field[]; activeFieldId: string; onSelect: (id: string) => void; onAdd: () => void; variant: 'sidebar' | 'top' }) {
  const { t, locale } = useI18n()
  const [open, setOpen] = useState(false)
  const active = fields.find((f) => f.id === activeFieldId)
  const totalItems = fields.reduce((sum, f) => sum + (f.itemCount ?? 0), 0)
  const title = active ? active.name : t('fld.all')
  const subtitle = active
    ? <MetaLine parts={[active.area ? `${fmt(active.area, locale)} ${active.unit ?? 'ha'}` : null, t('fld.items', { n: active.itemCount ?? 0 })]} />
    : t('fld.items', { n: totalItems })
  const pick = (id: string) => { onSelect(id); setOpen(false) }
  return (
    <div className={`field-switch field-switch-${variant}`}>
      <button className="field-switch-trigger" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label={t('fld.switch')}>
        <div className="field-avatar"><Layers /></div>
        <div className="field-switch-text"><strong>{title}</strong><span>{subtitle}</span></div>
        <ChevronDown className="field-caret" />
      </button>
      {open && (
        <>
          <div className="lang-backdrop" onClick={() => setOpen(false)} />
          <div className="field-menu" role="menu">
            <button className={activeFieldId === 'all' ? 'field-item active' : 'field-item'} onClick={() => pick('all')} role="menuitemradio" aria-checked={activeFieldId === 'all'}>
              <div className="field-item-main"><Layers /><span>{t('fld.all')}</span></div>
              <small>{t('fld.items', { n: totalItems })}</small>
            </button>
            {fields.map((f) => (
              <button key={f.id} className={activeFieldId === f.id ? 'field-item active' : 'field-item'} onClick={() => pick(f.id)} role="menuitemradio" aria-checked={activeFieldId === f.id}>
                <div className="field-item-main"><MapPin /><span>{f.name}</span></div>
                <small>{f.area ? `${fmt(f.area, locale)} ${f.unit ?? 'ha'}` : t('fld.items', { n: f.itemCount ?? 0 })}</small>
              </button>
            ))}
            <button className="field-add" onClick={() => { setOpen(false); onAdd() }}><Plus />{t('fld.add')}</button>
          </div>
        </>
      )}
    </div>
  )
}

function RecentActivity({ stats, onSelectId }: { stats?: FarmStats; onSelectId: (id: string) => void }) {
  const { t, locale } = useI18n()
  const logs = stats?.recentLogs ?? []
  if (logs.length === 0) return <p className="detail-empty" style={{ marginTop: 18 }}>{t('empty.noActivity')}</p>
  return (
    <div className="activity-list">
      {logs.map((log) => {
        const meta = KIND_META[log.kind]
        const KindIcon = meta.icon
        return (
          <button className="activity-item as-button" key={`${log.itemId}-${log.id}`} onClick={() => onSelectId(log.itemId)}>
            <div className={`activity-icon ${meta.tone}`}><KindIcon /></div>
            <div>
              <strong>{kindLabel(t, log.kind)}{isMeasured(log.kind) && log.amount > 0 ? ` · ${fmt(log.amount, locale)} ${unitLabel(locale, log.unit, log.amount)}` : ''}</strong>
              <span>{log.itemName}{log.note ? ` · ${log.note}` : ''}</span>
            </div>
            <time>{relativeTime(log.createdAt, t)}</time>
          </button>
        )
      })}
    </div>
  )
}

function SectionHeading({ section, title, subtitle, action }: { section: string; title: string; subtitle: string; action?: React.ReactNode }) {
  const { settings } = useSettings()
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow green-text">{settings.farmName.toUpperCase()} · {section.toUpperCase()}</p>
        <h1>{title}</h1>
        <p className="subtitle">{subtitle}</p>
      </div>
      {action}
    </div>
  )
}

// --------------------------------------------------------------------------
// Section views
// --------------------------------------------------------------------------

function AssetsView({ items, stats, onSelect, onAdd }: { items: Item[]; stats?: FarmStats; onSelect: (i: Item) => void; onAdd: () => void }) {
  const { t, locale } = useI18n()
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<ItemType | 'all'>('all')
  const filtered = useMemo(
    () =>
      items.filter(
        (i) =>
          (typeFilter === 'all' || i.itemType === typeFilter) &&
          `${i.id} ${i.name} ${i.species} ${i.breed ?? ''} ${i.zone} ${i.tagNumber ?? ''}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [items, query, typeFilter],
  )
  return (
    <div className="section-view">
      <SectionHeading section={t('assets.title')} title={t('assets.title')} subtitle={t('assets.subtitle')}
        action={<button className="primary-button" onClick={onAdd}><Plus data-icon="inline-start" />{t('action.registerAsset')}</button>} />
      <div className="metrics-grid three">
        <MetricCard label={t('assets.trees')} value={fmt(stats?.counts.tree ?? 0, locale)} detail={t('assets.trees.detail')} icon={TreePine} tone="green" />
        <MetricCard label={t('metric.animals')} value={fmt(stats?.counts.animal ?? 0, locale)} detail={t('metric.animals.detail', { healthy: stats?.animalsHealthy ?? 0, attention: stats?.animalsAttention ?? 0 })} icon={PawPrint} tone="amber" />
        <MetricCard label={t('assets.resources')} value={fmt(stats?.counts.resource ?? 0, locale)} detail={t('assets.resources.detail')} icon={Boxes} tone="blue" />
      </div>
      <section className="panel section-list">
        <div className="panel-heading">
          <div><h2>{t('assets.registered')}</h2><p>{t('assets.shown', { n: filtered.length, m: items.length })}</p></div>
        </div>
        <div className="toolbar">
          <div className="search-wrap">
            <Search aria-hidden="true" />
            <input aria-label={t('search.placeholder')} placeholder={t('search.placeholder')} value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="chip-filter">
            {(['all', 'tree', 'animal', 'resource'] as const).map((f) => (
              <button key={f} className={typeFilter === f ? 'chip active' : 'chip'} onClick={() => setTypeFilter(f)}>
                {f === 'all' ? t('filter.all') : typeLabel(t, f)}
              </button>
            ))}
          </div>
        </div>
        <InventoryTable items={filtered} onSelect={onSelect} />
        {filtered.length === 0 && <div className="empty-state">{t('empty.noAssets')}</div>}
      </section>
    </div>
  )
}

function ReportsView({ stats }: { stats?: FarmStats }) {
  const { t, locale } = useI18n()
  const rows: { kind: LogKind; value: number; unit: string }[] = [
    { kind: 'water', value: stats?.waterThisWeek.amount ?? 0, unit: 'L' },
    { kind: 'manure', value: stats?.manureThisWeek.amount ?? 0, unit: 'kg' },
    { kind: 'feed', value: stats?.feedThisWeek.amount ?? 0, unit: 'kg' },
  ]
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <div className="section-view">
      <SectionHeading section={t('reports.title')} title={t('reports.title')} subtitle={t('reports.subtitle')} />
      <div className="metrics-grid">
        <MetricCard label={t('metric.trackedItems')} value={fmt(stats?.totalItems ?? 0, locale)} detail={t('metric.trackedItems.detail2')} icon={Leaf} tone="green" />
        <MetricCard label={t('metric.waterUsed')} value={`${fmt(stats?.waterThisWeek.amount ?? 0, locale)} L`} detail={t('metric.waterUsed.detail')} icon={Droplets} tone="blue" />
        <MetricCard label={t('metric.manure')} value={`${fmt(stats?.manureThisWeek.amount ?? 0, locale)} kg`} detail={t('metric.manure.detail')} icon={Recycle} tone="amber" />
        <MetricCard label={t('metric.logsWeek')} value={fmt(stats?.logsThisWeek ?? 0, locale)} detail={t('metric.logsWeek.detail2')} icon={ClipboardList} tone="violet" />
      </div>
      <section className="panel">
        <div className="panel-heading"><div><h2>{t('reports.inputsWeek')}</h2><p>{t('reports.inputsWeek.sub')}</p></div></div>
        <div className="report-bars">
          {rows.map((r) => {
            const meta = KIND_META[r.kind]
            const KindIcon = meta.icon
            return (
              <div className="report-bar" key={r.kind}>
                <div className="report-bar-label"><span className={`log-icon sm ${meta.tone}`}><KindIcon /></span>{kindLabel(t, r.kind)}<strong>{fmt(r.value, locale)} {unitLabel(locale, r.unit, r.value)}</strong></div>
                <div className="progress"><span className={meta.tone} style={{ width: `${(r.value / max) * 100}%` }} /></div>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function MapView({ fields, items, activeFieldId, onSelectField, onAdd, onEditField, onSaved, onDirtyChange }: {
  fields: Field[]
  items: Item[]
  activeFieldId: string
  onSelectField: (id: string) => void
  onAdd: () => void
  onEditField: (field: Field) => void
  onSaved: () => void
  onDirtyChange: (dirty: boolean) => void
}) {
  const { t } = useI18n()
  const field = fields.find((f) => f.id === activeFieldId)
  const actions = (
    <div className="map-head-actions">
      <div className="map-field-select">
        <MapPin />
        <select value={field ? field.id : ''} onChange={(e) => (e.target.value === '__add' ? onAdd() : onSelectField(e.target.value))}>
          {!field && <option value="" disabled>{t('map.pickField')}</option>}
          {fields.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          <option value="__add">＋ {t('fld.add')}</option>
        </select>
      </div>
      {field && <button className="ghost-button" onClick={() => onEditField(field)}><Pencil />{t('fld.editTitle')}</button>}
    </div>
  )
  return (
    <div className="section-view">
      <SectionHeading section={t('map.title')} title={field ? field.name : t('map.title')} subtitle={t('map.subtitle')} action={actions} />
      {field ? (
        <FieldMapEditor key={field.id} field={field} items={items} onSaved={onSaved} onDirtyChange={onDirtyChange} />
      ) : (
        <div className="panel map-empty">
          <div className="map-empty-icon"><MapIcon /></div>
          <h3>{t('map.pickField')}</h3>
          <p>{t('map.pickFieldHint')}</p>
          <div className="map-empty-fields">
            {fields.map((f) => <button key={f.id} className="chip" onClick={() => onSelectField(f.id)}>{f.name}</button>)}
            <button className="chip add" onClick={onAdd}><Plus />{t('fld.add')}</button>
          </div>
        </div>
      )}
    </div>
  )
}

function SettingsView({ backend, fields, onAddField, onEditField }: { backend?: string; fields: Field[]; onAddField: () => void; onEditField: (field: Field) => void }) {
  const { t, locale, setLocale } = useI18n()
  const { settings, update, reset } = useSettings()
  const { user } = useAuth()
  const refresh = useRefresh()
  const [loadingDemo, setLoadingDemo] = useState(false)

  const loadDemo = async () => {
    setLoadingDemo(true)
    try {
      const res = await apiFetch('/api/demo-data', { method: 'POST' })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error)
      refresh()
      toast(t('toast.demoLoaded'))
    } catch (error) {
      toast(error instanceof Error && error.message ? error.message : t('toast.error'), 'error')
    } finally {
      setLoadingDemo(false)
    }
  }
  const { toast } = useToast()
  return (
    <div className="section-view">
      <SectionHeading section={t('settings.title')} title={t('settings.title')} subtitle={t('settings.subtitle')} />
      <div className="settings-grid">
        <section className="panel settings-card">
          <div className="settings-card-head"><span className="settings-ic green"><Building2 /></span><h2>{t('settings.farmSection')}</h2></div>
          <label className="settings-field">{t('settings.farmName')}<input value={settings.farmName} onChange={(e) => update({ farmName: e.target.value })} placeholder={t('ph.farmName')} /></label>
          <div className="form-row">
            <label className="settings-field">{t('settings.managerName')}<input value={settings.managerName} onChange={(e) => update({ managerName: e.target.value })} placeholder={t('ph.managerName')} /></label>
            <label className="settings-field">{t('settings.role')}<input value={settings.role} onChange={(e) => update({ role: e.target.value })} placeholder={t('ph.role')} /></label>
          </div>
          <label className="settings-field">
            {t('settings.currency')}
            <select value={settings.currency} onChange={(e) => update({ currency: e.target.value })}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        </section>

        <section className="panel settings-card">
          <div className="settings-card-head"><span className="settings-ic rose"><Palette /></span><h2>{t('settings.appearance')}</h2></div>
          <div className="settings-field">
            <span className="settings-label">{t('settings.accent')}</span>
            <div className="accent-row">
              {(Object.keys(ACCENTS) as Accent[]).map((a) => (
                <button key={a} className={settings.accent === a ? 'accent-swatch selected' : 'accent-swatch'} style={{ background: ACCENTS[a].clay }} onClick={() => update({ accent: a })} title={t(`accent.${a}`)} aria-label={t(`accent.${a}`)}>
                  {settings.accent === a && <Check />}
                </button>
              ))}
            </div>
          </div>
          <div className="settings-field">
            <span className="settings-label">{t('settings.language')}</span>
            <div className="lang-row">
              {LOCALES.map((l) => <button key={l.code} className={locale === l.code ? 'lang-pill selected' : 'lang-pill'} onClick={() => setLocale(l.code)}>{l.native}</button>)}
            </div>
          </div>
        </section>

        <section className="panel settings-card">
          <div className="settings-card-head">
            <span className="settings-ic amber"><Layers /></span>
            <div><h2>{t('settings.fields')}</h2><p className="settings-sub">{t('settings.fields.sub')}</p></div>
          </div>
          <div className="settings-fields">
            {fields.map((f) => (
              <button key={f.id} className="settings-field-row" onClick={() => onEditField(f)}>
                <span className="field-avatar"><MapPin /></span>
                <span className="settings-field-text">
                  <strong>{f.name}</strong>
                  <small>
                    <MetaLine parts={[
                      f.area ? `${fmt(f.area, locale)} ${f.unit ?? 'ha'}` : null,
                      t('fld.items', { n: f.itemCount ?? 0 }),
                      f.map?.zones?.length ? t('map.linkedZones', { n: f.map.zones.length }) : null,
                    ]} />
                  </small>
                </span>
                <Pencil />
              </button>
            ))}
          </div>
          <button className="ghost-button" onClick={onAddField}><Plus />{t('fld.add')}</button>
        </section>

        {user && (
          <section className="panel settings-card">
            <div className="settings-card-head"><span className="settings-ic green"><UserRound /></span><h2>{t('auth.account')}</h2></div>
            <p className="settings-note">{t('auth.signedInAs', { email: user.email ?? user.displayName ?? user.uid })}</p>
            <button className="ghost-button danger" onClick={() => void signOut()}><LogOut />{t('auth.signOut')}</button>
          </section>
        )}

        <section className="panel settings-card">
          <div className="settings-card-head"><span className="settings-ic blue"><Database /></span><h2>{t('settings.data')}</h2></div>
          <p className="settings-note">{backend === 'firestore' ? t('settings.backendFirestore') : t('settings.backendMemory')}</p>
          {backend === 'firestore' && fields.every((f) => !f.itemCount) && (
            <>
              <p className="settings-note">{t('settings.demoData.sub')}</p>
              <button className="ghost-button" disabled={loadingDemo} onClick={loadDemo}>{loadingDemo ? <Loader2 className="spin" /> : <Wheat />}{t('settings.demoData')}</button>
            </>
          )}
          <button className="ghost-button" onClick={() => { reset(); toast(t('toast.settingsReset')) }}><RotateCcw />{t('settings.reset')}</button>
        </section>
      </div>
    </div>
  )
}

function MoreSheet({ items, active, onPick, onClose }: { items: { id: NavId; icon: Icon; key: string }[]; active: NavId; onPick: (id: NavId) => void; onClose: () => void }) {
  const { t } = useI18n()
  return (
    <div className="sheet-backdrop" role="presentation" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        {items.map((it) => {
          const ItemIcon = it.icon
          return (
            <button key={it.id} className={active === it.id ? 'sheet-item active' : 'sheet-item'} onClick={() => onPick(it.id)}>
              <ItemIcon /><span>{t(it.key)}</span>{active === it.id && <Check className="sheet-check" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// --------------------------------------------------------------------------
// Page
// --------------------------------------------------------------------------

type ItemFormState = { mode: 'create' | 'edit'; item?: Item }
type FieldFormState = { mode: 'create' | 'edit'; field?: Field }
type TaskFormState = { mode: 'create' | 'edit'; task?: Task; prefill?: Partial<CreateTaskInput> }

export default function Page() {
  const { status } = useAuth()
  // Signed out → sign in. ('disabled' = demo mode, no accounts.)
  useEffect(() => {
    if (status === 'signed-out') window.location.replace('/login')
  }, [status])
  if (status === 'loading' || status === 'signed-out') {
    return <div className="auth-splash" aria-busy="true"><div className="brand-mark"><Leaf /></div><Loader2 className="spin" /></div>
  }
  return <FarmApp />
}

function FarmApp() {
  const { t, locale } = useI18n()
  const { settings, initials } = useSettings()
  const { user } = useAuth()
  const refresh = useRefresh()
  const [activeNav, setActiveNav] = useState<NavId>('overview')
  const [query, setQuery] = useState('')
  const [itemForm, setItemForm] = useState<ItemFormState | null>(null)
  const [fieldForm, setFieldForm] = useState<FieldFormState | null>(null)
  const [taskForm, setTaskForm] = useState<TaskFormState | null>(null)
  const [showMore, setShowMore] = useState(false)
  const [openItemId, setOpenItemId] = useState<string | null>(null)
  const [activeFieldId, setActiveFieldId] = useState<string>('all')
  const [collapsed, setCollapsed] = useState(false)
  const [mapDirty, setMapDirty] = useState(false)

  // Restore the previously selected field + sidebar state after mount.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(FIELD_STORAGE_KEY)
      if (saved) setActiveFieldId(saved)
      setCollapsed(localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1')
    } catch { /* ignore */ }
  }, [])

  const { fields, backend: fieldsBackend } = useFields()
  const allItems = useAllItems()
  const { tasks } = useTasks()

  // Only scope by a field that actually exists; otherwise show everything.
  const effectiveFieldId = activeFieldId !== 'all' && fields.some((f) => f.id === activeFieldId) ? activeFieldId : 'all'
  const scope = effectiveFieldId === 'all' ? '' : `?field=${effectiveFieldId}`

  const { data: itemsData } = useSWR<{ items: Item[]; backend: string }>(`/api/farm-items${scope}`, fetcher)
  const { data: stats } = useSWR<FarmStats>(`/api/stats${scope}`, fetcher)

  const items = itemsData?.items ?? []
  const backend = itemsData?.backend ?? fieldsBackend
  const filtered = useMemo(
    () => items.filter((i) => `${i.id} ${i.name} ${i.species} ${i.zone}`.toLowerCase().includes(query.toLowerCase())),
    [items, query],
  )

  const confirm = useConfirm()
  /** True when the user wants to stay on the map with unsaved changes. */
  const leavingDirtyMap = async () =>
    activeNav === 'map' &&
    mapDirty &&
    !(await confirm({
      title: t('map.leave.title'),
      message: t('map.leave.body'),
      confirmLabel: t('map.leave.confirm'),
      cancelLabel: t('map.leave.stay'),
      tone: 'warning',
    }))

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c
      try { localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }

  const goTo = async (id: NavId) => {
    if (id !== activeNav && (await leavingDirtyMap())) return
    if (id !== 'map') setMapDirty(false)
    setActiveNav(id)
    setShowMore(false)
  }

  const selectField = async (id: string) => {
    if (id !== effectiveFieldId && (await leavingDirtyMap())) return
    setActiveFieldId(id)
    try { localStorage.setItem(FIELD_STORAGE_KEY, id) } catch { /* ignore */ }
  }

  const openItem = (item: Item) => setOpenItemId(item.id)
  const activeLabel = t(navLabelKey(activeNav))
  const defaultFieldId = effectiveFieldId === 'all' ? fields[0]?.id : effectiveFieldId
  const firstName = settings.managerName.trim().split(/\s+/)[0] || settings.managerName
  const moreItems = [
    { id: 'tasks' as NavId, icon: CalendarDays, key: 'nav.tasks' },
    { id: 'reports' as NavId, icon: Wheat, key: 'nav.reports' },
    { id: 'settings' as NavId, icon: Settings2, key: 'nav.settings' },
  ]
  const moreActive = moreItems.some((m) => m.id === activeNav)

  const scopedTasks = tasksInScope(tasks, allItems, effectiveFieldId).filter((task) => !task.done)
  const today = todayISO()
  const overdueCount = scopedTasks.filter((task) => task.dueDate < today).length
  const todayCount = scopedTasks.filter((task) => task.dueDate === today).length

  const weekly = [
    { kind: 'water' as LogKind, value: stats?.waterThisWeek.amount ?? 0, unit: 'L' },
    { kind: 'manure' as LogKind, value: stats?.manureThisWeek.amount ?? 0, unit: 'kg' },
    { kind: 'feed' as LogKind, value: stats?.feedThisWeek.amount ?? 0, unit: 'kg' },
  ]
  const weeklyMax = Math.max(1, ...weekly.map((w) => w.value))

  const newTask = (prefill?: Partial<CreateTaskInput>) => setTaskForm({ mode: 'create', prefill })
  const editTask = (task: Task) => setTaskForm({ mode: 'edit', task })
  const attention = items.filter((i) => i.status === 'attention')

  return (
    <main className={`farm-shell${collapsed ? ' is-collapsed' : ''}`}>
      <aside className={collapsed ? 'sidebar collapsed' : 'sidebar'}>
        <div className="brand">
          <div className="brand-mark"><Leaf aria-hidden="true" /></div>
          <div className="brand-text"><strong>Fieldwise</strong><span>{t('app.tagline')}</span></div>
          <button className="sidebar-toggle" onClick={toggleCollapsed} aria-label={collapsed ? t('sidebar.expand') : t('sidebar.collapse')} title={collapsed ? t('sidebar.expand') : t('sidebar.collapse')}>
            {collapsed ? <ChevronsRight /> : <ChevronsLeft />}
          </button>
        </div>
        <FieldSwitcher fields={fields} activeFieldId={effectiveFieldId} onSelect={selectField} onAdd={() => setFieldForm({ mode: 'create' })} variant="sidebar" />
        <nav className="nav-list" aria-label={t('nav.label')}>
          {NAV_ITEMS.map((item) => {
            const NavIcon = item.icon
            const badge = item.id === 'tasks' && overdueCount + todayCount > 0 ? overdueCount + todayCount : 0
            return (
              <button key={item.id} className={activeNav === item.id ? 'nav-item active' : 'nav-item'} onClick={() => goTo(item.id)} title={t(item.key)}>
                <NavIcon /><span className="nav-label">{t(item.key)}</span>
                {badge > 0 && <span className={overdueCount > 0 ? 'nav-badge urgent' : 'nav-badge'}>{badge}</span>}
              </button>
            )
          })}
        </nav>
        <div className="sidebar-bottom">
          <button className={activeNav === 'settings' ? 'nav-item active' : 'nav-item'} onClick={() => goTo('settings')} title={t('nav.settings')}><Settings2 /><span className="nav-label">{t('nav.settings')}</span></button>
          <div className="help-card">
            <div className="help-icon"><ShieldCheck /></div>
            <strong>{t('side.help.title')}</strong>
            <span>{t('side.help.body')}</span>
          </div>
          <div className="user-row"><div className="user-avatar">{initials}</div><div className="user-text"><strong>{settings.managerName}</strong><span>{user?.email ?? settings.role}</span></div>
            {user
              ? <button className="signout-button" onClick={() => void signOut()} title={t('auth.signOut')} aria-label={t('auth.signOut')}><LogOut /></button>
              : <MoreHorizontal aria-hidden="true" />}
          </div>
        </div>
      </aside>

      <section className="content">
        <header className="topbar">
          <div className="topbar-brand"><div className="brand-mark sm"><Leaf aria-hidden="true" /></div><strong>Fieldwise</strong></div>
          <div className="breadcrumb"><span>{settings.farmName}</span><span>/</span><strong>{activeLabel}</strong></div>
          <div className="topbar-field"><FieldSwitcher fields={fields} activeFieldId={effectiveFieldId} onSelect={selectField} onAdd={() => setFieldForm({ mode: 'create' })} variant="top" /></div>
          <div className="top-actions">
            {backend && <span className={`backend-pill ${backend}`}>{backend === 'firestore' ? <><Check />{t('backend.firestore')}</> : <><Loader2 />{t('backend.memory')}</>}</span>}
            <LanguageSwitcher />
            <BellMenu activeFieldId={effectiveFieldId} onOpenTasks={() => goTo('tasks')} onEditTask={editTask} />
            <button className="profile-button" onClick={() => goTo('settings')}><span className="user-avatar small">{initials}</span><span className="profile-name">{firstName}</span><ChevronDown /></button>
          </div>
        </header>

        {activeNav === 'overview' ? (
          <>
            <div className="page-heading">
              <div>
                <p className="eyebrow green-text">{new Date().toLocaleDateString(intlLocale(locale), { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase()}</p>
                <h1>{t('ov.greeting', { name: firstName })}</h1>
                <p className="subtitle">{t('ov.subtitle')}</p>
              </div>
              <button className="primary-button" onClick={() => setItemForm({ mode: 'create' })}><Plus data-icon="inline-start" />{t('action.addItem')}</button>
            </div>

            <div className="metrics-grid">
              <MetricCard label={t('metric.trackedItems')} value={fmt(stats?.totalItems ?? 0, locale)} detail={t('metric.trackedItems.detail', { tree: stats?.counts.tree ?? 0, animal: stats?.counts.animal ?? 0 })} icon={Leaf} tone="green" />
              <MetricCard label={t('metric.animals')} value={fmt(stats?.counts.animal ?? 0, locale)} detail={t('metric.animals.detail', { healthy: stats?.animalsHealthy ?? 0, attention: stats?.animalsAttention ?? 0 })} icon={PawPrint} tone="amber" />
              <MetricCard label={t('metric.waterWeek')} value={`${fmt(stats?.waterThisWeek.amount ?? 0, locale)} L`} detail={t('metric.waterWeek.detail')} icon={Droplets} tone="blue" />
              <MetricCard label={t('metric.tasksDue')} value={fmt(overdueCount + todayCount, locale)} detail={t('metric.tasksDue.detail', { overdue: overdueCount, today: todayCount })} icon={CalendarClock} tone={overdueCount > 0 ? 'rose' : 'violet'} />
            </div>

            <div className="main-grid">
              <section className="panel asset-panel">
                <div className="panel-heading">
                  <div><h2>{t('panel.inventory')}</h2><p>{t('panel.inventory.sub')}</p></div>
                  <button className="text-button" onClick={() => goTo('assets')}>{t('action.viewAll')} <ArrowRight className="rtl-flip" /></button>
                </div>
                <div className="toolbar">
                  <div className="search-wrap">
                    <Search aria-hidden="true" />
                    <input aria-label={t('search.placeholder')} placeholder={t('search.placeholder')} value={query} onChange={(e) => setQuery(e.target.value)} />
                  </div>
                  <button className="filter-button" onClick={() => goTo('assets')}><Filter />{t('action.filter')}</button>
                </div>
                <InventoryTable items={filtered.slice(0, 6)} onSelect={openItem} />
                {items.length === 0 && <div className="empty-state">{t('empty.noItems')}</div>}
                {items.length > 0 && filtered.length === 0 && <div className="empty-state">{t('empty.noSearch')}</div>}
              </section>

              <aside className="right-column">
                <UpcomingTasksPanel activeFieldId={effectiveFieldId} onOpenTasks={() => goTo('tasks')} onEditTask={editTask} onNewTask={() => newTask()} />
                <section className="panel health-panel">
                  <div className="panel-heading"><div><h2>{t('panel.inputsWeek')}</h2><p>{t('panel.inputsWeek.sub')}</p></div><MoreHorizontal /></div>
                  <div className="health-list">
                    {weekly.map((w) => {
                      const meta = KIND_META[w.kind]
                      return (
                        <div className="health-item" key={w.kind}>
                          <div className="health-label"><span className={`health-dot ${meta.tone}`} /><span>{kindLabel(t, w.kind)}</span><strong>{fmt(w.value, locale)} {unitLabel(locale, w.unit, w.value)}</strong></div>
                          <div className="progress"><span className={meta.tone} style={{ width: `${(w.value / weeklyMax) * 100}%` }} /></div>
                        </div>
                      )
                    })}
                  </div>
                </section>
                <section className="panel activity-panel">
                  <div className="panel-heading"><div><h2>{t('panel.recent')}</h2><p>{t('panel.recent.sub')}</p></div><button className="text-button" onClick={() => goTo('tasks')}>{t('action.seeLog')}</button></div>
                  <RecentActivity stats={stats} onSelectId={(id) => setOpenItemId(id)} />
                </section>
              </aside>
            </div>
            <footer className="footer-note"><ShieldCheck /> {backend === 'firestore' ? t('footer.firestore') : t('footer.memory')}</footer>
          </>
        ) : activeNav === 'assets' ? (
          <AssetsView items={items} stats={stats} onSelect={openItem} onAdd={() => setItemForm({ mode: 'create' })} />
        ) : activeNav === 'map' ? (
          <MapView
            fields={fields}
            items={items}
            activeFieldId={effectiveFieldId}
            onSelectField={selectField}
            onAdd={() => setFieldForm({ mode: 'create' })}
            onEditField={(field) => setFieldForm({ mode: 'edit', field })}
            onSaved={refresh}
            onDirtyChange={setMapDirty}
          />
        ) : activeNav === 'tasks' ? (
          <TasksView
            activeFieldId={effectiveFieldId}
            farmName={settings.farmName}
            onNewTask={() => newTask(effectiveFieldId !== 'all' ? { fieldId: effectiveFieldId } : undefined)}
            onEditTask={editTask}
            side={
              <>
                <section className="panel">
                  <div className="panel-heading"><div><h2>{t('tasks.attention')}</h2><p>{t('tasks.attention.count', { n: attention.length })}</p></div></div>
                  <div className="attention-list">
                    {attention.length === 0 && <p className="detail-empty">{t('empty.allHealthy')}</p>}
                    {attention.map((i) => {
                      const TypeIcon = TYPE_META[i.itemType].icon
                      return (
                        <button key={i.id} className="attention-row" onClick={() => openItem(i)}>
                          <div className={`asset-icon ${TYPE_META[i.itemType].tone}`}><TypeIcon /></div>
                          <div><strong>{i.name}</strong><span>{i.id} · {i.zone}</span></div>
                          <ChevronRight className="chevron-end" />
                        </button>
                      )
                    })}
                  </div>
                </section>
                <section className="panel">
                  <div className="panel-heading"><div><h2>{t('panel.recent')}</h2><p>{t('tasks.recent.sub')}</p></div></div>
                  <RecentActivity stats={stats} onSelectId={(id) => setOpenItemId(id)} />
                </section>
              </>
            }
          />
        ) : activeNav === 'settings' ? (
          <SettingsView backend={backend} fields={fields} onAddField={() => setFieldForm({ mode: 'create' })} onEditField={(field) => setFieldForm({ mode: 'edit', field })} />
        ) : (
          <ReportsView stats={stats} />
        )}
      </section>

      {/* Mobile bottom navigation */}
      <nav className="bottom-nav" aria-label={t('nav.label')}>
        {(['overview', 'assets'] as NavId[]).map((id) => {
          const item = NAV_ITEMS.find((n) => n.id === id)!
          const NavIcon = item.icon
          return (
            <button key={id} className={activeNav === id ? 'bottom-nav-item active' : 'bottom-nav-item'} onClick={() => goTo(id)}>
              <NavIcon /><span>{t(item.key)}</span>
            </button>
          )
        })}
        <button className="bottom-nav-add" onClick={() => setItemForm({ mode: 'create' })} aria-label={t('action.addItem')}><Plus /></button>
        <button className={activeNav === 'map' ? 'bottom-nav-item active' : 'bottom-nav-item'} onClick={() => goTo('map')}>
          <MapIcon /><span>{t('nav.map')}</span>
        </button>
        <button className={moreActive || showMore ? 'bottom-nav-item active' : 'bottom-nav-item'} onClick={() => setShowMore(true)}>
          <MoreHorizontal /><span>{t('nav.more')}</span>
          {overdueCount + todayCount > 0 && <span className="nav-dot" />}
        </button>
      </nav>
      {showMore && <MoreSheet items={moreItems} active={activeNav} onPick={goTo} onClose={() => setShowMore(false)} />}

      {openItemId && (
        <ItemDrawer
          itemId={openItemId}
          fields={fields}
          onClose={() => setOpenItemId(null)}
          onChanged={refresh}
          onOpenItem={setOpenItemId}
          onEdit={(item) => setItemForm({ mode: 'edit', item })}
          onNewTask={newTask}
          onEditTask={editTask}
        />
      )}
      {itemForm && (
        <ItemFormModal
          mode={itemForm.mode}
          item={itemForm.item}
          fields={fields}
          defaultFieldId={defaultFieldId}
          onClose={() => setItemForm(null)}
          onSaved={() => {
            setItemForm(null)
            refresh()
          }}
        />
      )}
      {fieldForm && (
        <FieldFormModal
          mode={fieldForm.mode}
          field={fieldForm.field}
          onClose={() => setFieldForm(null)}
          onSaved={(field) => { if (fieldForm.mode === 'create') selectField(field.id) }}
          onDeleted={(id) => { if (id === effectiveFieldId) selectField('all') }}
        />
      )}
      {taskForm && <TaskFormModal mode={taskForm.mode} task={taskForm.task} prefill={taskForm.prefill} onClose={() => setTaskForm(null)} />}
    </main>
  )
}
