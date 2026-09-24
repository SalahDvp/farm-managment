// Field-map helpers shared by the server store and the client editor.

import {
  IRRIGATIONS,
  MAP_LIMITS,
  SOILS,
  ZONE_KINDS,
  type FieldMap,
  type Irrigation,
  type MapZone,
  type Soil,
  type ZoneKind,
} from '@/lib/farm-types'

const ZONE_SET = new Set<string>(ZONE_KINDS)

export function isZoneKind(value: unknown): value is ZoneKind {
  return typeof value === 'string' && ZONE_SET.has(value)
}

/** English fallback name for a zone kind ("cropland" → "Cropland"). */
export function defaultZoneName(kind: ZoneKind): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1)
}

/** Next unused zone id, e.g. "z7". */
export function nextZoneId(zones: MapZone[]): string {
  let max = 0
  for (const z of zones) {
    const n = Number(z.id.replace(/^z/, ''))
    if (Number.isFinite(n) && n > max) max = n
  }
  return `z${max + 1}`
}

/**
 * Bring a stored map up to the current shape. Early maps stored a zone *kind*
 * in each cell and had no `zones` list; each distinct kind becomes one named
 * zone so nothing painted is lost.
 */
export function upgradeMap(map: { cells?: string[]; zones?: MapZone[] }): { cells: string[]; zones: MapZone[] } {
  const zones: MapZone[] = Array.isArray(map.zones) ? map.zones.map((z) => ({ ...z })) : []
  const ids = new Set(zones.map((z) => z.id))
  const idByKind = new Map<string, string>()
  const cells = (Array.isArray(map.cells) ? map.cells : []).map((value) => {
    if (typeof value !== 'string' || !value) return ''
    if (ids.has(value)) return value
    if (isZoneKind(value)) {
      let id = idByKind.get(value)
      if (!id) {
        id = nextZoneId(zones)
        zones.push({ id, name: defaultZoneName(value), kind: value })
        ids.add(id)
        idByKind.set(value, id)
      }
      return id
    }
    return ''
  })
  return { cells, zones }
}

function text(value: unknown, max = 120): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined
}

/** Validate one zone from untrusted input; returns null when unusable. */
export function sanitizeZone(raw: unknown): MapZone | null {
  if (!raw || typeof raw !== 'object') return null
  const z = raw as Record<string, unknown>
  const id = text(z.id, 12)
  if (!id || !isZoneKind(z.kind)) return null
  const itemIds = Array.isArray(z.itemIds)
    ? [...new Set(z.itemIds.filter((x): x is string => typeof x === 'string' && x.length > 0).map((x) => x.slice(0, 20)))].slice(
        0,
        MAP_LIMITS.maxZoneItems,
      )
    : undefined
  return {
    id,
    kind: z.kind,
    name: text(z.name, 60) ?? defaultZoneName(z.kind),
    crop: text(z.crop),
    variety: text(z.variety),
    plantedAt: text(z.plantedAt, 10),
    soil: typeof z.soil === 'string' && (SOILS as readonly string[]).includes(z.soil) ? (z.soil as Soil) : undefined,
    irrigation:
      typeof z.irrigation === 'string' && (IRRIGATIONS as readonly string[]).includes(z.irrigation)
        ? (z.irrigation as Irrigation)
        : undefined,
    notes: text(z.notes, 500),
    itemIds: itemIds && itemIds.length > 0 ? itemIds : undefined,
  }
}

/** Zones whose `itemIds` include the given item, across a set of maps. */
export function zonesForItem(maps: { fieldId: string; fieldName: string; map?: FieldMap }[], itemId: string) {
  const out: { fieldId: string; fieldName: string; zone: MapZone }[] = []
  for (const m of maps) {
    for (const zone of m.map?.zones ?? []) {
      if (zone.itemIds?.includes(itemId)) out.push({ fieldId: m.fieldId, fieldName: m.fieldName, zone })
    }
  }
  return out
}
