'use client'

// Field map designer. A field is laid out as a grid scaled to its real size;
// the farmer creates named zones (e.g. "North orchard"), paints where each one
// is, and records what it holds — crop, variety, soil, irrigation, notes, and
// the animals or trees located there.

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Check,
  Eraser,
  Loader2,
  Maximize2,
  MousePointer2,
  Paintbrush,
  Pencil,
  Plus,
  Recycle,
  Route,
  Ruler,
  Save,
  Sparkles,
  Sprout,
  Trash2,
  TreePine,
  Trees,
  Warehouse,
  Waves,
  Wheat,
  X,
} from 'lucide-react'
import {
  IRRIGATIONS,
  MAP_LIMITS,
  SOILS,
  ZONE_KINDS,
  type Field,
  type Irrigation,
  type Item,
  type MapZone,
  type Soil,
  type ZoneKind,
} from '@/lib/farm-types'
import { nextZoneId, upgradeMap } from '@/lib/map-utils'
import { TYPE_META, type Icon } from '@/lib/ui'
import { useI18n } from '@/components/language-provider'
import { useToast } from '@/components/toast-provider'
import { useConfirm } from '@/components/confirm-provider'
import { MetaLine } from '@/components/meta-line'
import { apiFetch } from '@/lib/client-api'

export const ZONE_META: Record<ZoneKind, { color: string; icon: Icon }> = {
  orchard: { color: '#6d7a37', icon: TreePine },
  cropland: { color: '#cf9836', icon: Wheat },
  vegetable: { color: '#7fa653', icon: Sprout },
  pasture: { color: '#aac07d', icon: Trees },
  water: { color: '#5aa0b0', icon: Waves },
  shelter: { color: '#a07a4e', icon: Warehouse },
  compost: { color: '#8a6b4f', icon: Recycle },
  path: { color: '#cdb488', icon: Route },
}

type Tool = 'paint' | 'erase' | 'inspect'

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

function mix(hex: string, target: string, amount: number): string {
  const parse = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
  const a = parse(hex)
  const b = parse(target)
  return `#${a.map((v, i) => Math.round(v + (b[i] - v) * amount).toString(16).padStart(2, '0')).join('')}`
}

/** Distinct shades for zones that share a kind, so neighbours stay readable. */
function zoneColors(zones: MapZone[]): Map<string, string> {
  const seen = new Map<ZoneKind, number>()
  const out = new Map<string, string>()
  for (const zone of zones) {
    const n = seen.get(zone.kind) ?? 0
    seen.set(zone.kind, n + 1)
    const base = ZONE_META[zone.kind].color
    out.set(zone.id, n === 0 ? base : mix(base, n % 2 ? '#ffffff' : '#000000', Math.min(0.14 * Math.ceil(n / 2), 0.42)))
  }
  return out
}

export function FieldMapEditor({ field, items, onSaved, onDirtyChange }: {
  field: Field
  /** Items in this field, for linking to zones. */
  items: Item[]
  onSaved: () => void
  onDirtyChange?: (dirty: boolean) => void
}) {
  const { t, locale } = useI18n()
  const { toast } = useToast()
  const confirm = useConfirm()
  const numLocale = locale === 'ar' ? 'ar-u-nu-latn' : locale
  const num = (n: number, digits = 0) => n.toLocaleString(numLocale, { maximumFractionDigits: digits })

  // The editor is keyed by field id, so this only runs when a field opens.
  const [initial] = useState(() => {
    const m = field.map
    if (!m) return { width: 100, height: 60, cols: 10, rows: 6, cells: new Array<string>(60).fill(''), zones: [] as MapZone[] }
    const upgraded = upgradeMap(m)
    return { width: m.width, height: m.height, cols: m.cols, rows: m.rows, cells: upgraded.cells, zones: upgraded.zones }
  })

  const [width, setWidth] = useState(initial.width)
  const [height, setHeight] = useState(initial.height)
  const [cellSize, setCellSize] = useState(Math.max(1, Math.round(initial.width / initial.cols)))
  const [cols, setCols] = useState(initial.cols)
  const [rows, setRows] = useState(initial.rows)
  const [cells, setCells] = useState<string[]>(initial.cells)
  const [zones, setZones] = useState<MapZone[]>(initial.zones)
  const [tool, setTool] = useState<Tool>('paint')
  const [activeZoneId, setActiveZoneId] = useState<string | null>(initial.zones[0]?.id ?? null)
  const [openZoneId, setOpenZoneId] = useState<string | null>(null)
  const [creating, setCreating] = useState(initial.zones.length === 0)
  const [newName, setNewName] = useState('')
  const [newKind, setNewKind] = useState<ZoneKind>('orchard')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  const painting = useRef(false)
  const warned = useRef(false)
  const gridRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  // Guard against losing unsaved work when the tab closes.
  useEffect(() => {
    if (!dirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  const colors = useMemo(() => zoneColors(zones), [zones])
  const zoneById = useMemo(() => new Map(zones.map((z) => [z.id, z])), [zones])
  const cellStats = useMemo(() => {
    const s = new Map<string, { count: number; sx: number; sy: number }>()
    cells.forEach((id, i) => {
      if (!id) return
      const entry = s.get(id) ?? { count: 0, sx: 0, sy: 0 }
      entry.count += 1
      entry.sx += (i % cols) + 0.5
      entry.sy += Math.floor(i / cols) + 0.5
      s.set(id, entry)
    })
    return s
  }, [cells, cols])

  const total = cols * rows
  const painted = cells.reduce((n, c) => (c ? n + 1 : n), 0)
  const cellArea = (width / cols) * (height / rows)
  const areaLabel = (count: number) => {
    const m2 = count * cellArea
    return m2 >= 10000 ? `${num(m2 / 10000, 2)} ha` : `${num(m2)} m²`
  }
  const markDirty = () => setDirty(true)

  const applyDims = () => {
    const nc = clamp(Math.round(width / cellSize) || 1, 1, MAP_LIMITS.maxCols)
    const nr = clamp(Math.round(height / cellSize) || 1, 1, MAP_LIMITS.maxRows)
    const next = new Array<string>(nc * nr).fill('')
    for (let r = 0; r < Math.min(nr, rows); r += 1) {
      for (let c = 0; c < Math.min(nc, cols); c += 1) next[r * nc + c] = cells[r * cols + c] || ''
    }
    setCols(nc)
    setRows(nr)
    setCells(next)
    markDirty()
  }

  const cellAt = (clientX: number, clientY: number): number | null => {
    const el = gridRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    const c = Math.floor((clientX - rect.left) / (rect.width / cols))
    const r = Math.floor((clientY - rect.top) / (rect.height / rows))
    if (c < 0 || c >= cols || r < 0 || r >= rows) return null
    return r * cols + c
  }

  const handlePointer = (clientX: number, clientY: number, isStart: boolean) => {
    const idx = cellAt(clientX, clientY)
    if (idx === null) return
    if (tool === 'inspect') {
      if (isStart && cells[idx]) {
        setOpenZoneId(cells[idx])
        setCreating(false)
      }
      return
    }
    if (tool === 'paint' && !activeZoneId) {
      if (!warned.current) toast(t('map.pickZoneFirst'), 'info')
      warned.current = true
      return
    }
    const value = tool === 'erase' ? '' : activeZoneId!
    setCells((prev) => {
      if (prev[idx] === value) return prev
      const next = prev.slice()
      next[idx] = value
      return next
    })
    markDirty()
  }

  const createZone = () => {
    const id = nextZoneId(zones)
    const sameKind = zones.filter((z) => z.kind === newKind).length
    const name = newName.trim() || `${t(`zone.${newKind}`)}${sameKind ? ` ${sameKind + 1}` : ''}`
    setZones((zs) => [...zs, { id, name, kind: newKind }])
    setActiveZoneId(id)
    setTool('paint')
    setCreating(false)
    setNewName('')
    markDirty()
    toast(t('toast.zoneCreated', { name }), 'info')
  }

  const updateZone = (id: string, patch: Partial<MapZone>) => {
    setZones((zs) => zs.map((z) => (z.id === id ? { ...z, ...patch } : z)))
    markDirty()
  }

  const deleteZone = async (id: string) => {
    const ok = await confirm({
      title: t('zone.delete.title'),
      message: t('zone.delete.body'),
      confirmLabel: t('action.delete'),
      tone: 'danger',
    })
    if (!ok) return
    setZones((zs) => zs.filter((z) => z.id !== id))
    setCells((cs) => cs.map((c) => (c === id ? '' : c)))
    if (activeZoneId === id) setActiveZoneId(null)
    setOpenZoneId(null)
    markDirty()
  }

  const clearAll = async () => {
    const ok = await confirm({
      title: t('map.clearConfirm'),
      message: t('map.clear.body'),
      confirmLabel: t('map.clear.confirm'),
      tone: 'danger',
    })
    if (!ok) return
    setCells(new Array<string>(cols * rows).fill(''))
    markDirty()
  }

  const save = async () => {
    setSaving(true)
    try {
      const res = await apiFetch(`/api/fields/${field.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ map: { width, height, unit: 'm', cols, rows, cells, zones } }),
      })
      if (!res.ok) throw new Error('save failed')
      setDirty(false)
      onSaved()
      toast(t('toast.mapSaved'))
    } catch {
      toast(t('toast.error'), 'error')
    } finally {
      setSaving(false)
    }
  }

  const stepDone = [true, zones.length > 0, painted > 0]
  const currentStep = stepDone.indexOf(false) + 1 // 0 when everything is done
  const openZone = openZoneId ? zoneById.get(openZoneId) : undefined
  const activeZone = activeZoneId ? zoneById.get(activeZoneId) : undefined
  const tools: { id: Tool; icon: Icon; label: string }[] = [
    { id: 'paint', icon: Paintbrush, label: t('map.tool.paint') },
    { id: 'erase', icon: Eraser, label: t('map.tool.erase') },
    { id: 'inspect', icon: MousePointer2, label: t('map.tool.inspect') },
  ]

  return (
    <div className="map-editor">
      <ol className="map-steps">
        {[1, 2, 3].map((n) => (
          <li key={n} className={`${stepDone[n - 1] ? 'done' : ''}${currentStep === n ? ' current' : ''}`}>
            <span className="step-num">{stepDone[n - 1] ? <Check /> : n}</span>
            <span className="step-text"><strong>{t(`map.steps.${n}`)}</strong><small>{t(`map.steps.${n}.hint`)}</small></span>
          </li>
        ))}
      </ol>

      <div className="map-controls">
        <div className="map-dims">
          <span className="map-dims-title"><Ruler />{t('map.dimensions')}</span>
          <div className="map-dim-fields">
            <label>{t('map.width')}<span className="unit-input"><input type="number" min={1} value={width} onChange={(e) => setWidth(Number(e.target.value) || 0)} /><em>m</em></span></label>
            <span className="dim-x">×</span>
            <label>{t('map.height')}<span className="unit-input"><input type="number" min={1} value={height} onChange={(e) => setHeight(Number(e.target.value) || 0)} /><em>m</em></span></label>
            <label>{t('map.cellSize')}<span className="unit-input"><input type="number" min={1} value={cellSize} onChange={(e) => setCellSize(Math.max(1, Number(e.target.value) || 1))} /><em>m</em></span></label>
            <button className="ghost-button" onClick={applyDims}><Maximize2 />{t('map.resize')}</button>
          </div>
        </div>
        <div className="map-actions">
          {dirty && <span className="map-unsaved">{t('map.unsaved')}</span>}
          <button className="ghost-button danger" onClick={clearAll}><Trash2 />{t('map.clear')}</button>
          <button className="primary-button" onClick={save} disabled={saving || !dirty}>
            {saving ? <><Loader2 className="spin" data-icon="inline-start" />{t('map.saving')}</> : <><Save data-icon="inline-start" />{t('map.save')}</>}
          </button>
        </div>
      </div>

      <div className="map-body">
        <div className="map-stage">
          <div className="map-toolbar">
            <div className="tool-group" role="radiogroup" aria-label={t('map.tools')}>
              {tools.map((tl) => {
                const ToolIcon = tl.icon
                return (
                  <button key={tl.id} role="radio" aria-checked={tool === tl.id} className={tool === tl.id ? 'tool selected' : 'tool'} onClick={() => setTool(tl.id)}>
                    <ToolIcon />{tl.label}
                  </button>
                )
              })}
            </div>
            <div className="tool-status">
              {tool === 'paint' && activeZone ? (
                <><span className="zone-dot" style={{ background: colors.get(activeZone.id) }} />{t('map.activeZone', { name: activeZone.name })}</>
              ) : (
                <span>{tool === 'paint' ? t('map.pickZoneFirst') : tool === 'erase' ? t('map.eraseHint') : t('map.inspectHint')}</span>
              )}
            </div>
          </div>

          <div className="map-ruler top"><span>{num(width)} m</span></div>
          <div className="map-stage-row">
            <div className="map-ruler side"><span>{num(height)} m</span></div>
            <div className="map-canvas" style={{ aspectRatio: `${width} / ${height}`, maxWidth: `calc(60vh * ${width / height})` }}>
              <div
                ref={gridRef}
                className={`map-grid tool-${tool}`}
                dir="ltr"
                style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}
                onPointerDown={(e) => {
                  painting.current = true
                  warned.current = false
                  e.currentTarget.setPointerCapture(e.pointerId)
                  handlePointer(e.clientX, e.clientY, true)
                }}
                onPointerMove={(e) => {
                  if (painting.current) handlePointer(e.clientX, e.clientY, false)
                }}
                onPointerUp={() => { painting.current = false }}
                onPointerCancel={() => { painting.current = false }}
              >
                {cells.map((id, i) => (
                  <div
                    key={i}
                    className={id ? 'map-cell filled' : 'map-cell'}
                    style={id ? { background: colors.get(id) } : undefined}
                    title={id ? zoneById.get(id)?.name : ''}
                  />
                ))}
              </div>
              <div className="zone-labels" dir="ltr" aria-hidden="true">
                {zones.map((z) => {
                  const s = cellStats.get(z.id)
                  if (!s || s.count < 2) return null
                  return (
                    <span key={z.id} className="zone-label" style={{ left: `${(s.sx / s.count / cols) * 100}%`, top: `${(s.sy / s.count / rows) * 100}%` }}>
                      {z.name}
                    </span>
                  )
                })}
              </div>
            </div>
          </div>
          <p className="map-grid-info">
            <MetaLine parts={[
              t('map.gridInfo', { cols, rows, cell: `${num(width / cols)}×${num(height / rows)}`, unit: 'm' }),
              `${num(painted)}/${num(total)}`,
              `${num((painted / total) * 100)}%`,
            ]} />
          </p>
        </div>

        <aside className="map-side">
          {openZone ? (
            <ZoneDetails
              zone={openZone}
              color={colors.get(openZone.id)!}
              area={areaLabel(cellStats.get(openZone.id)?.count ?? 0)}
              pct={num(((cellStats.get(openZone.id)?.count ?? 0) / total) * 100)}
              items={items}
              onBack={() => setOpenZoneId(null)}
              onChange={(patch) => updateZone(openZone.id, patch)}
              onPaint={() => { setActiveZoneId(openZone.id); setTool('paint'); setOpenZoneId(null) }}
              onDelete={() => deleteZone(openZone.id)}
            />
          ) : (
            <div className="zone-panel">
              <div className="zone-panel-head">
                <span className="map-section-title">{t('map.zones')}</span>
                {!creating && <button className="text-button" onClick={() => setCreating(true)}><Plus />{t('map.newZone')}</button>}
              </div>

              {creating && (
                <div className="zone-create">
                  <label>{t('map.zoneName')}<input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t('ph.zoneName')} autoFocus /></label>
                  <span className="form-label">{t('map.zoneKind')}</span>
                  <div className="map-palette">
                    {ZONE_KINDS.map((k) => {
                      const KindIcon = ZONE_META[k].icon
                      return (
                        <button key={k} type="button" className={newKind === k ? 'zone-chip selected' : 'zone-chip'} onClick={() => setNewKind(k)} style={{ '--zone': ZONE_META[k].color } as React.CSSProperties}>
                          <span className="zone-swatch" style={{ background: ZONE_META[k].color }}><KindIcon /></span>
                          <span className="zone-name">{t(`zone.${k}`)}</span>
                        </button>
                      )
                    })}
                  </div>
                  <div className="zone-create-actions">
                    {zones.length > 0 && <button className="cancel-button" onClick={() => setCreating(false)}>{t('action.cancel')}</button>}
                    <button className="primary-button" onClick={createZone}><Check data-icon="inline-start" />{t('map.createZone')}</button>
                  </div>
                </div>
              )}

              {zones.length === 0 && !creating ? (
                <div className="zone-empty">
                  <Sparkles />
                  <strong>{t('map.noZones')}</strong>
                  <p>{t('map.noZonesHint')}</p>
                </div>
              ) : (
                <div className="zone-list">
                  {zones.map((z) => {
                    const count = cellStats.get(z.id)?.count ?? 0
                    const KindIcon = ZONE_META[z.kind].icon
                    const linked = z.itemIds?.length ?? 0
                    return (
                      <div key={z.id} className={`zone-row${activeZoneId === z.id && tool === 'paint' ? ' active' : ''}`}>
                        <button className="zone-row-main" onClick={() => { setActiveZoneId(z.id); setTool('paint') }} title={t('map.zone.paint')}>
                          <span className="zone-swatch" style={{ background: colors.get(z.id) }}><KindIcon /></span>
                          <span className="zone-row-text">
                            <strong>{z.name}</strong>
                            <small>
                              <MetaLine parts={[
                                t(`zone.${z.kind}`),
                                count ? areaLabel(count) : t('map.notPainted'),
                                count > 0 && `${num((count / total) * 100)}%`,
                                linked > 0 && t('map.linkedCount', { n: linked }),
                              ]} />
                            </small>
                          </span>
                        </button>
                        <button className="icon-ghost" onClick={() => { setOpenZoneId(z.id); setCreating(false) }} aria-label={t('map.details')} title={t('map.details')}><Pencil /></button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

function ZoneDetails({ zone, color, area, pct, items, onBack, onChange, onPaint, onDelete }: {
  zone: MapZone
  color: string
  area: string
  pct: string
  items: Item[]
  onBack: () => void
  onChange: (patch: Partial<MapZone>) => void
  onPaint: () => void
  onDelete: () => void
}) {
  const { t } = useI18n()
  const KindIcon = ZONE_META[zone.kind].icon
  const linkedIds = zone.itemIds ?? []
  const itemById = new Map(items.map((i) => [i.id, i]))
  const linked = linkedIds.map((id) => itemById.get(id)).filter((i): i is Item => Boolean(i))
  const available = items.filter((i) => !linkedIds.includes(i.id))

  return (
    <div className="zone-details">
      <button className="text-button back" onClick={onBack}><ArrowLeft className="rtl-flip" />{t('map.zones')}</button>
      <div className="zone-details-head">
        <span className="zone-swatch lg" style={{ background: color }}><KindIcon /></span>
        <div>
          <strong>{zone.name}</strong>
          <small><MetaLine parts={[area, `${pct}%`]} /></small>
        </div>
      </div>

      <div className="zone-form">
        <label>{t('map.zoneName')}<input value={zone.name} onChange={(e) => onChange({ name: e.target.value })} /></label>
        <label>
          {t('map.zoneKind')}
          <select value={zone.kind} onChange={(e) => onChange({ kind: e.target.value as ZoneKind })}>
            {ZONE_KINDS.map((k) => <option key={k} value={k}>{t(`zone.${k}`)}</option>)}
          </select>
        </label>
        <div className="form-row">
          <label>{t('map.zone.crop')}<input value={zone.crop ?? ''} onChange={(e) => onChange({ crop: e.target.value })} placeholder={t('ph.zone.crop')} /></label>
          <label>{t('map.zone.variety')}<input value={zone.variety ?? ''} onChange={(e) => onChange({ variety: e.target.value })} placeholder={t('ph.zone.variety')} /></label>
        </div>
        <div className="form-row">
          <label>{t('map.zone.planted')}<input type="date" value={zone.plantedAt ?? ''} onChange={(e) => onChange({ plantedAt: e.target.value })} /></label>
          <label>
            {t('map.zone.soil')}
            <select value={zone.soil ?? ''} onChange={(e) => onChange({ soil: (e.target.value || undefined) as Soil | undefined })}>
              <option value="">—</option>
              {SOILS.map((s) => <option key={s} value={s}>{t(`soil.${s}`)}</option>)}
            </select>
          </label>
        </div>
        <label>
          {t('map.zone.irrigation')}
          <select value={zone.irrigation ?? ''} onChange={(e) => onChange({ irrigation: (e.target.value || undefined) as Irrigation | undefined })}>
            <option value="">—</option>
            {IRRIGATIONS.map((i) => <option key={i} value={i}>{t(`irr.${i}`)}</option>)}
          </select>
        </label>
        <label>{t('map.zone.notes')}<textarea rows={2} value={zone.notes ?? ''} onChange={(e) => onChange({ notes: e.target.value })} placeholder={t('ph.zone.notes')} /></label>

        <div className="zone-items">
          <span className="form-label">{t('map.zone.items')}</span>
          <div className="chip-row">
            {linked.length === 0 && <span className="muted-line">{t('map.zone.noItems')}</span>}
            {linked.map((i) => {
              const TypeIcon = TYPE_META[i.itemType].icon
              return (
                <span className="chip small linked" key={i.id}>
                  <TypeIcon />{i.name}
                  <button onClick={() => onChange({ itemIds: linkedIds.filter((x) => x !== i.id) })} aria-label={t('map.zone.unlink')}><X /></button>
                </span>
              )
            })}
          </div>
          {available.length > 0 && (
            <select value="" onChange={(e) => e.target.value && onChange({ itemIds: [...linkedIds, e.target.value] })}>
              <option value="">{t('map.zone.linkItem')}</option>
              {available.map((i) => <option key={i.id} value={i.id}>{i.name} · {i.id}</option>)}
            </select>
          )}
        </div>
      </div>

      <div className="zone-details-actions">
        <button className="ghost-button" onClick={onPaint}><Paintbrush />{t('map.zone.paint')}</button>
        <button className="ghost-button danger" onClick={onDelete}><Trash2 />{t('map.zone.delete')}</button>
      </div>
    </div>
  )
}
