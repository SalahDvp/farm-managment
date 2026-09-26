'use client'

// Shape & size panel of the field map. The farmer picks the outline that best
// matches the field, types in the measurements they took on the ground, and a
// live preview draws the resulting shape before it's applied to the grid.

import { Maximize2, Plus, Ruler, X } from 'lucide-react'
import {
  SHAPE_DIMS,
  SHAPE_KINDS,
  SHAPE_LIMITS,
  buildOutline,
  defaultShape,
  type FieldShape,
  type Outline,
  type ShapeKind,
  type ShapeSide,
} from '@/lib/field-shape'
import { useI18n } from '@/components/language-provider'

const SHAPE_ICON: Record<ShapeKind, string> = {
  rectangle: 'M3 6h18v12H3z',
  triangle: 'M3 19h18L10 5z',
  quad: 'M3 18L6 5l14 3-2 11z',
  trapezoid: 'M2 18h20l-5-12H7z',
  'l-shape': 'M3 4h9v7h9v9H3z',
  custom: 'M4 16L3 7l8-4 9 5-3 11z',
}

const COMPASS = [0, 45, 90, 135, 180, 225, 270, 315]
const COMPASS_KEYS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']

/** Compass bearing (0° = north) of the step from a to b, in screen coordinates. */
export function bearingOf(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return (((Math.atan2(b.x - a.x, a.y - b.y) * 180) / Math.PI) + 360) % 360
}

export function ShapeEditor({ draft, onChange, cellSize, onCellSize, onApply, pending }: {
  draft: FieldShape
  onChange: (shape: FieldShape) => void
  cellSize: number
  onCellSize: (n: number) => void
  onApply: () => void
  /** The draft differs from what the grid currently shows. */
  pending: boolean
}) {
  const { t, locale } = useI18n()
  const numLocale = locale === 'ar' ? 'ar-u-nu-latn' : locale
  const num = (n: number, digits = 0) => n.toLocaleString(numLocale, { maximumFractionDigits: digits })
  const outline = buildOutline(draft)
  const ok = typeof outline !== 'string'

  const pickKind = (kind: ShapeKind) => {
    if (kind === draft.kind) return
    // Carry the bounding size over when switching to a rectangle so nothing jumps.
    onChange(ok && kind === 'rectangle' ? defaultShape(kind, Math.round(outline.width), Math.round(outline.height)) : defaultShape(kind))
  }
  const setDim = (key: string, value: string) => {
    const dims = { ...(draft.dims ?? {}) }
    if (value === '') delete dims[key]
    else dims[key] = Number(value)
    onChange({ ...draft, dims })
  }
  const sides = draft.sides ?? []
  const setSide = (i: number, patch: Partial<ShapeSide>) => onChange({ ...draft, sides: sides.map((s, j) => (j === i ? { ...s, ...patch } : s)) })
  const addSide = () => {
    // Suggest a quarter turn clockwise from the previous side as a starting point.
    const prev = sides[sides.length - 1]
    onChange({ ...draft, sides: [...sides, { length: prev?.length ?? 50, bearing: prev ? (prev.bearing + 90) % 360 : 90 }] })
  }
  const removeSide = (i: number) => onChange({ ...draft, sides: sides.filter((_, j) => j !== i) })

  const areaText = (m2: number) => (m2 >= 10000 ? `${num(m2 / 10000, 2)} ha` : `${num(m2)} m²`)

  return (
    <div className="shape-editor">
      <span className="map-dims-title"><Ruler />{t('map.shape')}</span>

      <div className="shape-kinds" role="radiogroup" aria-label={t('map.shape')}>
        {SHAPE_KINDS.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={draft.kind === k} className={draft.kind === k ? 'shape-kind selected' : 'shape-kind'} onClick={() => pickKind(k)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d={SHAPE_ICON[k]} /></svg>
            {t(`shape.${k}`)}
          </button>
        ))}
      </div>

      <div className="shape-body">
        <div className="shape-inputs">
          <p className="shape-hint">{t(`shape.hint.${draft.kind}`)}</p>

          {draft.kind === 'custom' ? (
            <div className="shape-sides">
              {sides.map((s, i) => {
                const preset = COMPASS.indexOf(Math.round(s.bearing) % 360)
                return (
                  <div className="shape-side" key={i}>
                    <span className="shape-side-num">{num(i + 1)}</span>
                    <span className="unit-input"><input type="number" min={0} step="any" aria-label={t('shape.side', { n: i + 1 })} value={s.length || ''} onChange={(e) => setSide(i, { length: Number(e.target.value) || 0 })} /><em>m</em></span>
                    <select aria-label={t('shape.direction')} value={preset >= 0 ? String(COMPASS[preset]) : 'other'} onChange={(e) => e.target.value !== 'other' && setSide(i, { bearing: Number(e.target.value) })}>
                      {COMPASS.map((deg, j) => <option key={deg} value={deg}>{t(`dir.${COMPASS_KEYS[j]}`)}</option>)}
                      <option value="other">{t('dir.other')}</option>
                    </select>
                    <span className="unit-input deg"><input type="number" step="any" aria-label={t('shape.bearing')} value={Math.round(s.bearing * 10) / 10} onChange={(e) => setSide(i, { bearing: (((Number(e.target.value) || 0) % 360) + 360) % 360 })} /><em>°</em></span>
                    <svg className="shape-arrow" viewBox="0 0 24 24" aria-hidden="true" style={{ transform: `rotate(${s.bearing}deg)` }}><path d="M12 3l5 8h-3.5v10h-3V11H7z" /></svg>
                    {sides.length > 2 && <button type="button" className="icon-ghost" onClick={() => removeSide(i)} aria-label={t('shape.removeSide')} title={t('shape.removeSide')}><X /></button>}
                  </div>
                )
              })}
              {sides.length < SHAPE_LIMITS.maxSides && <button type="button" className="text-button" onClick={addSide}><Plus />{t('shape.addSide')}</button>}
              {ok && (
                <p className="shape-closing">
                  {t('shape.closing', { len: num(outline.edges[outline.edges.length - 1], 1), dir: num(bearingOf(outline.points[outline.points.length - 1], outline.points[0])) })}
                </p>
              )}
            </div>
          ) : (
            <div className="map-dim-fields">
              {SHAPE_DIMS[draft.kind].map(({ key }) => (
                <label key={key}>
                  {t(`shape.dim.${key}`)}
                  <span className="unit-input"><input type="number" min={key === 'offset' ? undefined : 0} step="any" value={draft.dims?.[key] ?? ''} onChange={(e) => setDim(key, e.target.value)} /><em>m</em></span>
                </label>
              ))}
            </div>
          )}

          <div className="map-dim-fields shape-apply-row">
            <label>{t('map.cellSize')}<span className="unit-input"><input type="number" min={1} value={cellSize} onChange={(e) => onCellSize(Math.max(1, Number(e.target.value) || 1))} /><em>m</em></span></label>
            <button type="button" className={pending ? 'primary-button' : 'ghost-button'} onClick={onApply} disabled={!ok}><Maximize2 />{t('shape.apply')}</button>
          </div>
          {pending && ok && <p className="shape-pending">{t('shape.pending')}</p>}
        </div>

        <figure className="shape-preview">
          {ok ? <ShapePreview outline={outline} kind={draft.kind} num={num} /> : <p className="shape-error" role="alert">{t(`shape.err.${outline}`)}</p>}
          {ok && (
            <figcaption>
              <strong>{t('shape.area', { area: areaText(outline.area) })}</strong>
              <span>{t('shape.bbox', { w: num(outline.width), h: num(outline.height) })}</span>
            </figcaption>
          )}
        </figure>
      </div>
    </div>
  )
}

function ShapePreview({ outline, kind, num }: { outline: Outline; kind: ShapeKind; num: (n: number, d?: number) => string }) {
  const { points, width, height, edges } = outline
  const size = Math.max(width, height)
  const pad = size * 0.16
  const font = size * 0.055
  const cx = width / 2
  const cy = height / 2
  const path = points.map((p) => `${p.x},${p.y}`).join(' ')
  const last = points.length - 1
  return (
    <svg className="shape-svg" viewBox={`${-pad} ${-pad} ${width + pad * 2} ${height + pad * 2}`} role="img">
      <polygon points={path} className="shape-fill" />
      {kind === 'quad' && <line x1={points[0].x} y1={points[0].y} x2={points[2].x} y2={points[2].y} className="shape-guide" />}
      {kind === 'custom' && <line x1={points[last].x} y1={points[last].y} x2={points[0].x} y2={points[0].y} className="shape-closing-edge" />}
      {edges.map((len, i) => {
        const a = points[i]
        const b = points[(i + 1) % points.length]
        const mx = (a.x + b.x) / 2
        const my = (a.y + b.y) / 2
        // Nudge each label away from the centre so it sits outside the edge.
        const d = Math.hypot(mx - cx, my - cy) || 1
        const k = font * 1.1
        return (
          <text key={i} x={mx + ((mx - cx) / d) * k} y={my + ((my - cy) / d) * k} fontSize={font} className="shape-len" textAnchor="middle" dominantBaseline="middle">
            {num(len, len < 10 ? 1 : 0)} m
          </text>
        )
      })}
      {kind === 'quad' && points.map((p, i) => {
        const d = Math.hypot(p.x - cx, p.y - cy) || 1
        return (
          <text key={i} x={p.x + ((p.x - cx) / d) * font * 0.9} y={p.y + ((p.y - cy) / d) * font * 0.9} fontSize={font * 1.1} className="shape-corner" textAnchor="middle" dominantBaseline="middle">
            {'ABCD'[i]}
          </text>
        )
      })}
      {kind === 'custom' && <circle cx={points[0].x} cy={points[0].y} r={font * 0.35} className="shape-start" />}
    </svg>
  )
}
