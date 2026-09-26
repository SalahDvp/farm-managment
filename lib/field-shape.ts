// Field outlines built from real-world measurements. Farmers rarely have
// perfect rectangles: they know side lengths (and sometimes a diagonal or the
// direction each boundary runs). Each shape kind turns those numbers into a
// polygon in metres, with x running east and y running south, shifted so the
// bounding box starts at (0, 0). The map grid is laid over that bounding box
// and cells outside the outline are masked off.

import { MAP_LIMITS } from '@/lib/farm-types'

export const SHAPE_KINDS = ['rectangle', 'triangle', 'quad', 'trapezoid', 'l-shape', 'custom'] as const
export type ShapeKind = (typeof SHAPE_KINDS)[number]

/** One boundary side when walking the field: its length and compass bearing (0° = north, 90° = east). */
export interface ShapeSide {
  length: number
  bearing: number
}

/** How a field's outline was described. Only the inputs are stored; the polygon is derived. */
export interface FieldShape {
  kind: ShapeKind
  /** Named measurements for the preset kinds (see SHAPE_DIMS). */
  dims?: Record<string, number>
  /** Boundary walk for the custom kind; the last corner joins back to the first. */
  sides?: ShapeSide[]
}

export interface Point {
  x: number
  y: number
}

/** Measurements each preset kind needs, in display order, with sensible defaults. */
export const SHAPE_DIMS: Record<Exclude<ShapeKind, 'custom'>, { key: string; initial: number }[]> = {
  rectangle: [{ key: 'width', initial: 100 }, { key: 'length', initial: 60 }],
  triangle: [{ key: 'a', initial: 120 }, { key: 'b', initial: 90 }, { key: 'c', initial: 100 }],
  // Four sides walked A→B→C→D plus the A–C diagonal (the classic tape-and-diagonal survey).
  quad: [{ key: 'ab', initial: 120 }, { key: 'bc', initial: 70 }, { key: 'cd', initial: 100 }, { key: 'da', initial: 80 }, { key: 'ac', initial: 135 }],
  trapezoid: [{ key: 'bottom', initial: 120 }, { key: 'top', initial: 70 }, { key: 'height', initial: 60 }, { key: 'offset', initial: 25 }],
  'l-shape': [{ key: 'width', initial: 120 }, { key: 'length', initial: 90 }, { key: 'cutWidth', initial: 50 }, { key: 'cutLength', initial: 40 }],
}

export const DEFAULT_SIDES: ShapeSide[] = [
  { length: 110, bearing: 90 },
  { length: 60, bearing: 160 },
  { length: 80, bearing: 250 },
]

export const SHAPE_LIMITS = { maxSides: 24 }

export function isShapeKind(value: unknown): value is ShapeKind {
  return typeof value === 'string' && (SHAPE_KINDS as readonly string[]).includes(value)
}

export function defaultShape(kind: ShapeKind, width = 100, height = 60): FieldShape {
  if (kind === 'custom') return { kind, sides: DEFAULT_SIDES.map((s) => ({ ...s })) }
  const dims = Object.fromEntries(SHAPE_DIMS[kind].map((d) => [d.key, d.initial]))
  if (kind === 'rectangle') Object.assign(dims, { width, length: height })
  return { kind, dims }
}

export type OutlineError = 'invalid' | 'triangle' | 'diagonal' | 'cut'

export interface Outline {
  points: Point[]
  width: number
  height: number
  /** Enclosed area in m². */
  area: number
  /** Length of every edge, in the same order as `points` (edge i runs from point i to i+1). */
  edges: number[]
}

const pos = (n: number | undefined) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0)
const dist = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y)

/** Third corner of a triangle standing on base p→q, on the given side (-1 = left/north of the travel). */
function apex(p: Point, q: Point, fromP: number, fromQ: number, side: 1 | -1): Point | null {
  const base = dist(p, q)
  if (!(fromP + fromQ > base && fromP + base > fromQ && fromQ + base > fromP)) return null
  const along = (fromP * fromP - fromQ * fromQ + base * base) / (2 * base)
  const off = Math.sqrt(Math.max(0, fromP * fromP - along * along))
  const ux = (q.x - p.x) / base
  const uy = (q.y - p.y) / base
  return { x: p.x + ux * along - uy * off * side, y: p.y + uy * along + ux * off * side }
}

function rawPoints(shape: FieldShape): Point[] | OutlineError {
  const d = shape.dims ?? {}
  switch (shape.kind) {
    case 'rectangle': {
      const w = pos(d.width)
      const l = pos(d.length)
      if (!w || !l) return 'invalid'
      return [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: l }, { x: 0, y: l }]
    }
    case 'triangle': {
      // a is the south (bottom) side; b runs up from its east end, c from its west end.
      const a = pos(d.a)
      const b = pos(d.b)
      const c = pos(d.c)
      if (!a || !b || !c) return 'invalid'
      const p = { x: 0, y: 0 }
      const q = { x: a, y: 0 }
      const top = apex(p, q, c, b, -1)
      return top ? [p, q, top] : 'triangle'
    }
    case 'quad': {
      const ab = pos(d.ab)
      const bc = pos(d.bc)
      const cd = pos(d.cd)
      const da = pos(d.da)
      const ac = pos(d.ac)
      if (!ab || !bc || !cd || !da || !ac) return 'invalid'
      // A at the south-west corner, C along the diagonal; B and D on opposite sides of it.
      const A = { x: 0, y: 0 }
      const C = { x: ac, y: 0 }
      const B = apex(A, C, ab, bc, -1)
      const D = apex(A, C, da, cd, 1)
      return B && D ? [A, B, C, D] : 'diagonal'
    }
    case 'trapezoid': {
      const bottom = pos(d.bottom)
      const top = pos(d.top)
      const h = pos(d.height)
      if (!bottom || !top || !h) return 'invalid'
      const off = Number.isFinite(d.offset) ? d.offset : (bottom - top) / 2
      return [{ x: 0, y: h }, { x: bottom, y: h }, { x: off + top, y: 0 }, { x: off, y: 0 }]
    }
    case 'l-shape': {
      const w = pos(d.width)
      const l = pos(d.length)
      const cw = pos(d.cutWidth)
      const cl = pos(d.cutLength)
      if (!w || !l || !cw || !cl) return 'invalid'
      if (cw >= w || cl >= l) return 'cut'
      // The notch is taken out of the north-east corner.
      return [{ x: 0, y: 0 }, { x: w - cw, y: 0 }, { x: w - cw, y: cl }, { x: w, y: cl }, { x: w, y: l }, { x: 0, y: l }]
    }
    case 'custom': {
      const sides = (shape.sides ?? []).filter((s) => pos(s.length))
      if (sides.length < 2) return 'invalid'
      const pts: Point[] = [{ x: 0, y: 0 }]
      for (const s of sides.slice(0, SHAPE_LIMITS.maxSides)) {
        const last = pts[pts.length - 1]
        const rad = (s.bearing * Math.PI) / 180
        pts.push({ x: last.x + s.length * Math.sin(rad), y: last.y - s.length * Math.cos(rad) })
      }
      // Drop the final corner when the walk already returns to the start.
      if (dist(pts[0], pts[pts.length - 1]) < 1e-6) pts.pop()
      return pts.length >= 3 ? pts : 'invalid'
    }
  }
}

export function polygonArea(points: Point[]): number {
  let s = 0
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    s += a.x * b.y - b.x * a.y
  }
  return Math.abs(s) / 2
}

/** Resolve a shape into a polygon anchored at (0, 0), or the reason it cannot close. */
export function buildOutline(shape: FieldShape): Outline | OutlineError {
  const raw = rawPoints(shape)
  if (typeof raw === 'string') return raw
  const minX = Math.min(...raw.map((p) => p.x))
  const minY = Math.min(...raw.map((p) => p.y))
  const points = raw.map((p) => ({ x: p.x - minX, y: p.y - minY }))
  const width = Math.max(...points.map((p) => p.x))
  const height = Math.max(...points.map((p) => p.y))
  const area = polygonArea(points)
  if (width < 0.5 || height < 0.5 || area < 0.5) return 'invalid'
  if (width > MAP_LIMITS.maxDim || height > MAP_LIMITS.maxDim) return 'invalid'
  const edges = points.map((p, i) => dist(p, points[(i + 1) % points.length]))
  return { points, width, height, area, edges }
}

function inside(points: Point[], x: number, y: number): boolean {
  let hit = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[i]
    const b = points[j]
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit
  }
  return hit
}

/**
 * Fraction (0–1) of each grid cell that lies inside the outline, sampled on a
 * 4×4 lattice per cell. Row-major, cols*rows entries.
 */
export function cellCoverage(points: Point[], width: number, height: number, cols: number, rows: number): number[] {
  const n = 4
  const cw = width / cols
  const ch = height / rows
  const out = new Array<number>(cols * rows)
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      let hits = 0
      for (let i = 0; i < n; i += 1) {
        for (let j = 0; j < n; j += 1) {
          if (inside(points, (c + (i + 0.5) / n) * cw, (r + (j + 0.5) / n) * ch)) hits += 1
        }
      }
      out[r * cols + c] = hits / (n * n)
    }
  }
  return out
}

/** Cells with less coverage than this are treated as outside the field. */
export const MIN_COVERAGE = 0.2

/** Validate a shape from untrusted input; returns undefined when unusable. */
export function sanitizeShape(raw: unknown): FieldShape | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const s = raw as Record<string, unknown>
  if (!isShapeKind(s.kind)) return undefined
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(Math.abs(v), MAP_LIMITS.maxDim) : undefined)
  let shape: FieldShape
  if (s.kind === 'custom') {
    const sides = (Array.isArray(s.sides) ? s.sides : [])
      .slice(0, SHAPE_LIMITS.maxSides)
      .map((side) => {
        const o = (side ?? {}) as Record<string, unknown>
        const length = num(o.length)
        const bearing = typeof o.bearing === 'number' && Number.isFinite(o.bearing) ? ((o.bearing % 360) + 360) % 360 : undefined
        return length && bearing !== undefined ? { length, bearing } : null
      })
      .filter((x): x is ShapeSide => x !== null)
    shape = { kind: 'custom', sides }
  } else {
    const src = (s.dims ?? {}) as Record<string, unknown>
    const dims: Record<string, number> = {}
    for (const { key } of SHAPE_DIMS[s.kind]) {
      const v = key === 'offset' && typeof src[key] === 'number' && Number.isFinite(src[key]) ? (src[key] as number) : num(src[key])
      if (v !== undefined) dims[key] = v
    }
    shape = { kind: s.kind, dims }
  }
  return typeof buildOutline(shape) === 'string' ? undefined : shape
}
