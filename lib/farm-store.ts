// Data-access layer for the farm.
//
// Exposes a single `FarmStore` interface with two implementations:
//   • FirestoreStore (lib/firestore-store.ts) — runs in the browser with the
//     Firebase client SDK when NEXT_PUBLIC_FIREBASE_* is configured. Each
//     signed-in user gets their own farm under `farms/{uid}`.
//   • MemoryStore (below) — an in-process, seeded fallback served by the API
//     routes so the app runs with no setup (data resets on server restart).
//
// Both share the pure helpers in this file, so they behave identically. The
// UI talks to either through lib/client-api.ts.

import { sanitizeZone, upgradeMap } from '@/lib/map-utils'
import { buildOutline, sanitizeShape } from '@/lib/field-shape'
import { sanitizeCustomFields, sanitizeProfile } from '@/lib/validate'
import {
  DEFAULT_UNIT,
  FIELD_PREFIX,
  ID_PREFIX,
  isMeasured,
  MAP_LIMITS,
  nextDueDate,
  TASK_LOG_KIND,
  TASK_PREFIX,
  todayISO,
  type CompleteTaskResult,
  type CreateFieldInput,
  type CreateItemInput,
  type CreateLogInput,
  type CreateTaskInput,
  type FarmStats,
  type Field,
  type FieldMap,
  type InputTotal,
  type Item,
  type ItemType,
  type LogEntry,
  type LogKind,
  type MapZone,
  type Repeat,
  type Task,
  type UpdateFieldInput,
  type UpdateItemInput,
  type UpdateTaskInput,
} from '@/lib/farm-types'

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export class NotFoundError extends Error {
  constructor(message = 'Not found') {
    super(message)
    this.name = 'NotFoundError'
  }
}

export class ConflictError extends Error {
  constructor(message = 'Conflict') {
    super(message)
    this.name = 'ConflictError'
  }
}

export interface TaskFilter {
  status?: 'open' | 'done' | 'all'
  fieldId?: string
  itemId?: string
}

export interface FarmStore {
  listItems(filter?: { type?: ItemType; query?: string; fieldId?: string }): Promise<Item[]>
  getItem(id: string): Promise<Item | null>
  createItem(input: CreateItemInput): Promise<Item>
  updateItem(id: string, patch: UpdateItemInput): Promise<Item>
  deleteItem(id: string): Promise<void>
  listLogs(itemId: string): Promise<LogEntry[]>
  addLog(itemId: string, input: CreateLogInput): Promise<{ item: Item; log: LogEntry }>
  getStats(fieldId?: string): Promise<FarmStats>
  listFields(): Promise<Field[]>
  createField(input: CreateFieldInput): Promise<Field>
  updateField(id: string, patch: UpdateFieldInput): Promise<Field>
  deleteField(id: string): Promise<void>
  listTasks(filter?: TaskFilter): Promise<Task[]>
  createTask(input: CreateTaskInput): Promise<Task>
  updateTask(id: string, patch: UpdateTaskInput): Promise<Task>
  completeTask(id: string): Promise<CompleteTaskResult>
  deleteTask(id: string): Promise<void>
}

// --------------------------------------------------------------------------
// Shared helpers
// --------------------------------------------------------------------------

export function now(): string {
  return new Date().toISOString()
}

export function toId(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(4, '0')}`
}

/**
 * Fold a new log entry into an item's running totals (returns a fresh object).
 * Most kinds accumulate; `weight` keeps the most recent reading instead.
 */
export function foldTotal(totals: Partial<Record<LogKind, InputTotal>>, log: LogEntry): Partial<Record<LogKind, InputTotal>> {
  const next = { ...totals }
  const existing = next[log.kind]
  const isLatest = !existing || log.appliedAt >= existing.lastAppliedAt
  const amount =
    log.kind === 'weight'
      ? isLatest
        ? log.amount
        : existing!.amount
      : Number(((existing?.amount ?? 0) + (isMeasured(log.kind) ? log.amount : 0)).toFixed(3))
  next[log.kind] = {
    amount,
    unit: log.unit || existing?.unit || DEFAULT_UNIT[log.kind],
    count: (existing?.count ?? 0) + 1,
    lastAppliedAt: isLatest ? log.appliedAt : existing!.lastAppliedAt,
  }
  return next
}

export function normalizeCreate(input: CreateItemInput, id: string, fieldId: string): Item {
  const timestamp = now()
  const quantity = Number.isFinite(input.quantity) && (input.quantity as number) > 0 ? (input.quantity as number) : 1
  const customFields = sanitizeCustomFields(input.customFields)
  return {
    id,
    name: input.name.trim(),
    itemType: input.itemType,
    fieldId,
    species: input.species.trim(),
    breed: input.breed?.trim() || undefined,
    zone: input.zone.trim(),
    status: input.status === 'attention' ? 'attention' : 'healthy',
    quantity,
    unit: input.unit?.trim() || (input.itemType === 'animal' ? 'head' : input.itemType === 'tree' ? 'trees' : 'unit'),
    tagNumber: input.tagNumber?.trim() || undefined,
    originDate: input.originDate || undefined,
    notes: input.notes?.trim() || undefined,
    profile: sanitizeProfile(input.profile),
    customFields: customFields && customFields.length > 0 ? customFields : undefined,
    totals: {},
    logCount: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

export function normalizeLog(itemId: string, input: CreateLogInput, id: string): LogEntry {
  const kind = input.kind
  const measured = isMeasured(kind)
  const amount = measured && Number.isFinite(input.amount) ? Number(input.amount) : 0
  const timestamp = now()
  return {
    id,
    itemId,
    kind,
    amount: amount > 0 ? amount : 0,
    unit: measured ? input.unit?.trim() || DEFAULT_UNIT[kind] : DEFAULT_UNIT[kind],
    note: input.note?.trim() || undefined,
    performedBy: input.performedBy?.trim() || undefined,
    appliedAt: input.appliedAt ? new Date(input.appliedAt).toISOString() : timestamp,
    createdAt: timestamp,
  }
}

export function applyPatch(item: Item, patch: UpdateItemInput): Item {
  const next: Item = { ...item }
  if (patch.name !== undefined) next.name = patch.name.trim() || item.name
  if (patch.species !== undefined) next.species = patch.species.trim() || item.species
  if (patch.breed !== undefined) next.breed = patch.breed.trim() || undefined
  if (patch.zone !== undefined) next.zone = patch.zone.trim() || item.zone
  if (patch.fieldId !== undefined && patch.fieldId.trim()) next.fieldId = patch.fieldId.trim()
  if (patch.status !== undefined) next.status = patch.status === 'attention' ? 'attention' : 'healthy'
  if (patch.quantity !== undefined && Number.isFinite(patch.quantity) && patch.quantity > 0) next.quantity = patch.quantity
  if (patch.unit !== undefined) next.unit = patch.unit.trim() || item.unit
  if (patch.tagNumber !== undefined) next.tagNumber = patch.tagNumber.trim() || undefined
  if (patch.originDate !== undefined) next.originDate = patch.originDate || undefined
  if (patch.notes !== undefined) next.notes = patch.notes.trim() || undefined
  if (patch.profile !== undefined) next.profile = sanitizeProfile(patch.profile)
  if (patch.customFields !== undefined) {
    const fields = sanitizeCustomFields(patch.customFields)
    next.customFields = fields && fields.length > 0 ? fields : undefined
  }
  next.updatedAt = now()
  return next
}

export function normalizeField(input: CreateFieldInput, id: string): Field {
  const timestamp = now()
  const area = Number.isFinite(input.area) && (input.area as number) > 0 ? (input.area as number) : undefined
  return {
    id,
    name: input.name.trim(),
    area,
    unit: area !== undefined ? input.unit?.trim() || 'ha' : undefined,
    note: input.note?.trim() || undefined,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

/** Clamp and sanitize a map so stored grids stay small and self-consistent. */
function normalizeMap(map: FieldMap): FieldMap {
  const cols = Math.max(1, Math.min(MAP_LIMITS.maxCols, Math.round(map.cols || 1)))
  const rows = Math.max(1, Math.min(MAP_LIMITS.maxRows, Math.round(map.rows || 1)))
  // Upgrade legacy kind-per-cell maps, then validate every zone.
  const upgraded = upgradeMap(map)
  const zones: MapZone[] = []
  const seen = new Set<string>()
  for (const raw of upgraded.zones) {
    const zone = sanitizeZone(raw)
    if (!zone || seen.has(zone.id)) continue
    seen.add(zone.id)
    zones.push(zone)
    if (zones.length >= MAP_LIMITS.maxZones) break
  }
  const total = cols * rows
  const cells: string[] = []
  for (let i = 0; i < total; i += 1) {
    const v = upgraded.cells[i]
    cells.push(typeof v === 'string' && seen.has(v) ? v : '')
  }
  // A valid outline dictates the map's bounding box; otherwise it's a plain rectangle.
  const shape = sanitizeShape(map.shape)
  const outline = shape ? buildOutline(shape) : undefined
  const box = outline && typeof outline !== 'string' ? outline : { width: Number(map.width), height: Number(map.height) }
  const width = Math.max(1, Math.min(MAP_LIMITS.maxDim, box.width || 1))
  const height = Math.max(1, Math.min(MAP_LIMITS.maxDim, box.height || 1))
  const base = { width, height, unit: (map.unit || 'm').trim(), cols, rows, cells, zones, updatedAt: now() }
  return shape ? { ...base, shape } : base
}

/** Present stored maps in the current shape without rewriting them. */
export function withUpgradedMap(field: Field): Field {
  if (!field.map) return field
  const { cells, zones } = upgradeMap(field.map)
  return { ...field, map: { ...field.map, cells, zones } }
}

export function applyFieldPatch(field: Field, patch: UpdateFieldInput): Field {
  const next: Field = { ...field }
  if (patch.name !== undefined) next.name = patch.name.trim() || field.name
  if (patch.note !== undefined) next.note = patch.note.trim() || undefined
  if (patch.area !== undefined) {
    next.area = Number.isFinite(patch.area) && patch.area > 0 ? patch.area : undefined
    if (next.area !== undefined && !next.unit) next.unit = 'ha'
  }
  if (patch.unit !== undefined) next.unit = patch.unit.trim() || next.unit
  if (patch.map !== undefined) next.map = normalizeMap(patch.map)
  next.updatedAt = now()
  return next
}

export function normalizeTask(input: CreateTaskInput, id: string): Task {
  const timestamp = now()
  return {
    id,
    title: input.title.trim(),
    type: input.type,
    dueDate: input.dueDate,
    repeat: input.repeat ?? 'none',
    priority: input.priority ?? 'normal',
    itemId: input.itemId || undefined,
    fieldId: input.fieldId || undefined,
    notes: input.notes?.trim() || undefined,
    done: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

export function applyTaskPatch(task: Task, patch: UpdateTaskInput): Task {
  const next: Task = { ...task }
  if (patch.title !== undefined) next.title = patch.title.trim() || task.title
  if (patch.type !== undefined) next.type = patch.type
  if (patch.dueDate !== undefined) next.dueDate = patch.dueDate
  if (patch.repeat !== undefined) next.repeat = patch.repeat
  if (patch.priority !== undefined) next.priority = patch.priority
  if (patch.itemId !== undefined) next.itemId = patch.itemId || undefined
  if (patch.fieldId !== undefined) next.fieldId = patch.fieldId || undefined
  if (patch.notes !== undefined) next.notes = patch.notes.trim() || undefined
  if (patch.done !== undefined) {
    next.done = patch.done
    next.doneAt = patch.done ? task.doneAt ?? now() : undefined
  }
  next.updatedAt = now()
  return next
}

export function filterTasks(tasks: Task[], filter?: TaskFilter): Task[] {
  let out = tasks
  if (filter?.status === 'open') out = out.filter((t) => !t.done)
  else if (filter?.status === 'done') out = out.filter((t) => t.done)
  if (filter?.itemId) out = out.filter((t) => t.itemId === filter.itemId)
  if (filter?.fieldId) out = out.filter((t) => t.fieldId === filter.fieldId)
  return [...out].sort((a, b) => (a.done !== b.done ? (a.done ? 1 : -1) : a.dueDate.localeCompare(b.dueDate)))
}

/** The next occurrence of a repeating task that falls today or later. */
function upcomingDue(date: string, repeat: Repeat): string {
  const today = todayISO()
  let next = nextDueDate(date, repeat)
  for (let guard = 0; next < today && guard < 2000; guard += 1) next = nextDueDate(next, repeat)
  return next
}

export function nextOccurrence(task: Task): CreateTaskInput {
  return {
    title: task.title,
    type: task.type,
    dueDate: upcomingDue(task.dueDate, task.repeat),
    repeat: task.repeat,
    priority: task.priority,
    itemId: task.itemId,
    fieldId: task.fieldId,
    notes: task.notes,
  }
}

/** The log entry recorded when a task is completed, if its type maps to one. */
export function completionLog(task: Task): CreateLogInput | null {
  const kind = TASK_LOG_KIND[task.type]
  if (!kind || !task.itemId) return null
  return { kind, amount: kind === 'vaccination' ? 1 : undefined, note: task.title }
}

export function matchesQuery(item: Item, query?: string): boolean {
  if (!query) return true
  const haystack = `${item.id} ${item.name} ${item.species} ${item.breed ?? ''} ${item.zone} ${item.tagNumber ?? ''}`.toLowerCase()
  return haystack.includes(query.toLowerCase())
}

export function computeStats(items: Item[], logs: LogEntry[]): FarmStats {
  const counts: Record<ItemType, number> = { tree: 0, animal: 0, resource: 0 }
  let animalsHealthy = 0
  let animalsAttention = 0
  let openAttention = 0
  for (const item of items) {
    counts[item.itemType] += 1
    if (item.status === 'attention') openAttention += 1
    if (item.itemType === 'animal') {
      if (item.status === 'attention') animalsAttention += 1
      else animalsHealthy += 1
    }
  }

  const weekAgo = new Date(Date.now() - WEEK_MS).toISOString()
  const weekly = logs.filter((log) => log.appliedAt >= weekAgo)
  const sumKind = (kind: LogKind, unit: string) => ({
    amount: Number(weekly.filter((l) => l.kind === kind).reduce((sum, l) => sum + l.amount, 0).toFixed(2)),
    unit,
  })

  const itemNames = new Map(items.map((item) => [item.id, item.name]))
  const recentLogs = [...logs]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 8)
    .map((log) => ({ ...log, itemName: itemNames.get(log.itemId) ?? log.itemId }))

  return {
    totalItems: items.length,
    counts,
    animalsHealthy,
    animalsAttention,
    waterThisWeek: sumKind('water', 'L'),
    manureThisWeek: sumKind('manure', 'kg'),
    feedThisWeek: sumKind('feed', 'kg'),
    openAttention,
    logsThisWeek: weekly.length,
    recentLogs,
  }
}

// --------------------------------------------------------------------------
// Seed data — used to populate the demo store and, on first run, Firestore.
// --------------------------------------------------------------------------

interface SeedItemSpec {
  /** Name of the seed field this item belongs to. */
  field: string
  item: CreateItemInput
  /** Parents by item name, resolved to ids after every item exists. */
  parents?: { mother?: string; father?: string }
  logs: CreateLogInput[]
}

type SeedTask = CreateTaskInput & { done?: boolean }
type Resolve = (name: string) => string | undefined

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString()
}

function dateIn(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return todayISO(d)
}

export const SEED_FIELDS: CreateFieldInput[] = [
  { name: 'West field', area: 24, unit: 'ha', note: 'Orchard, grain block and the main sheep pasture' },
  { name: 'East field', area: 16, unit: 'ha', note: 'Citrus rows and young stock' },
]

export const SEED_DATA: SeedItemSpec[] = [
  {
    field: 'West field',
    item: {
      name: 'North Orchard row 1', itemType: 'tree', species: 'Apple', breed: 'Gala', zone: 'Block A', quantity: 120, unit: 'trees', originDate: '2019-03-10',
      profile: { rootstock: 'M9', spacing: '4 × 1.5 m', irrigation: 'drip', pollinator: 'Granny Smith', expectedYield: 3600, organic: false },
      customFields: [{ key: 'Block manager', value: 'Sam' }, { key: 'Trellis', value: '3-wire vertical' }],
    },
    logs: [
      { kind: 'water', amount: 2400, unit: 'L', appliedAt: daysAgo(1), note: 'Drip irrigation cycle', performedBy: 'Jordan' },
      { kind: 'manure', amount: 86, unit: 'kg', appliedAt: daysAgo(4), note: 'Composted, side-dressed' },
      { kind: 'spray', amount: 180, unit: 'L', appliedAt: daysAgo(9), note: 'Fungicide — scab prevention' },
      { kind: 'pruning', appliedAt: daysAgo(40), note: 'Winter pruning, central leader' },
      { kind: 'harvest', amount: 1250, unit: 'kg', appliedAt: daysAgo(15), note: 'First pick' },
      { kind: 'health-check', appliedAt: daysAgo(2), note: 'Canopy healthy, no pests' },
    ],
  },
  {
    field: 'East field',
    item: {
      name: 'Citrus row 4', itemType: 'tree', species: 'Orange', breed: 'Valencia', zone: 'Block C', quantity: 84, unit: 'trees', originDate: '2020-11-02',
      profile: { rootstock: 'Carrizo', spacing: '6 × 4 m', irrigation: 'drip', expectedYield: 2500 },
    },
    logs: [
      { kind: 'water', amount: 1600, unit: 'L', appliedAt: daysAgo(2) },
      { kind: 'fertilizer', amount: 40, unit: 'kg', appliedAt: daysAgo(6), note: 'Citrus NPK blend' },
    ],
  },
  {
    field: 'West field',
    item: {
      name: 'Ewe 0088', itemType: 'animal', species: 'Sheep', breed: 'Merino', zone: 'Pasture 2', quantity: 1, unit: 'head', tagNumber: '0088', originDate: '2022-02-14',
      profile: { sex: 'female', color: 'White', purpose: 'wool', reproStatus: 'pregnant', dueDate: dateIn(48), source: 'Bred on farm' },
      customFields: [{ key: 'Microchip', value: '982000123456789' }, { key: 'Wool grade', value: 'Fine (19 µm)' }],
    },
    logs: [
      { kind: 'weight', amount: 58, unit: 'kg', appliedAt: daysAgo(62) },
      { kind: 'weight', amount: 60, unit: 'kg', appliedAt: daysAgo(31) },
      { kind: 'weight', amount: 62.5, unit: 'kg', appliedAt: daysAgo(2) },
      { kind: 'feed', amount: 3.2, unit: 'kg', appliedAt: daysAgo(1), note: 'Morning ration' },
      { kind: 'vaccination', amount: 1, unit: 'dose', appliedAt: daysAgo(20), note: 'Clostridial 5-in-1' },
      { kind: 'health-check', appliedAt: daysAgo(1), note: 'Good body condition' },
    ],
  },
  {
    field: 'West field',
    item: {
      name: 'Ewe 0093', itemType: 'animal', species: 'Sheep', breed: 'Merino', zone: 'Pasture 2', quantity: 1, unit: 'head', tagNumber: '0093', originDate: '2023-03-01',
      profile: { sex: 'female', color: 'White', purpose: 'wool', reproStatus: 'open', source: 'Bred on farm' },
    },
    parents: { mother: 'Ewe 0088', father: 'Ram 0007' },
    logs: [
      { kind: 'weight', amount: 44, unit: 'kg', appliedAt: daysAgo(30) },
      { kind: 'weight', amount: 47, unit: 'kg', appliedAt: daysAgo(3) },
      { kind: 'feed', amount: 3.2, unit: 'kg', appliedAt: daysAgo(1) },
    ],
  },
  {
    field: 'East field',
    item: {
      name: 'Goat 0017', itemType: 'animal', species: 'Goat', breed: 'Boer', zone: 'Pasture 1', quantity: 1, unit: 'head', tagNumber: '0017', originDate: '2021-09-09', status: 'attention', notes: 'Slight limp on left hind — monitoring.',
      profile: { sex: 'male', color: 'Brown & white', purpose: 'meat', source: 'Hill Farm', purchasePrice: 220 },
    },
    logs: [
      { kind: 'weight', amount: 71, unit: 'kg', appliedAt: daysAgo(45) },
      { kind: 'weight', amount: 74, unit: 'kg', appliedAt: daysAgo(5) },
      { kind: 'medicine', amount: 5, unit: 'mL', appliedAt: daysAgo(1), note: 'Anti-inflammatory' },
      { kind: 'health-check', appliedAt: daysAgo(1), note: 'Attention: favouring left hind leg' },
      { kind: 'feed', amount: 2.5, unit: 'kg', appliedAt: daysAgo(1) },
    ],
  },
  {
    field: 'West field',
    item: {
      name: 'Ram 0007', itemType: 'animal', species: 'Sheep', breed: 'Merino', zone: 'Pasture 2', quantity: 1, unit: 'head', tagNumber: '0007', originDate: '2020-04-18',
      profile: { sex: 'male', color: 'White', purpose: 'breeding', source: 'Riverbend Merino stud', purchasePrice: 650 },
    },
    logs: [
      { kind: 'weight', amount: 96, unit: 'kg', appliedAt: daysAgo(20) },
      { kind: 'feed', amount: 3.8, unit: 'kg', appliedAt: daysAgo(1) },
    ],
  },
  {
    field: 'West field',
    item: {
      name: 'Main water tank', itemType: 'resource', species: 'Water', zone: 'Utility yard', quantity: 5000, unit: 'L',
      profile: { capacity: 5000, currentLevel: 3600, reorderAt: 1500, supplier: 'Municipal supply', unitCost: 0.002 },
    },
    logs: [{ kind: 'note', appliedAt: daysAgo(3), note: 'Refilled to 3,600 L after irrigation' }],
  },
  {
    field: 'West field',
    item: {
      name: 'Compost bay', itemType: 'resource', species: 'Manure', zone: 'Utility yard', quantity: 500, unit: 'kg',
      profile: { capacity: 500, currentLevel: 120, reorderAt: 150, supplier: 'On-farm (Pasture 2)' },
    },
    logs: [{ kind: 'manure', amount: 120, unit: 'kg', appliedAt: daysAgo(5), note: 'Collected from Pasture 2' }],
  },
]

/** The West field layout: named zones with details and the items inside them. */
export function buildDemoMap(itemId: Resolve): FieldMap {
  const cols = 12
  const rows = 8
  const cells = new Array<string>(cols * rows).fill('')
  const set = (c: number, r: number, z: string) => {
    if (c >= 0 && c < cols && r >= 0 && r < rows) cells[r * cols + c] = z
  }
  const ids = (...names: string[]) => names.map(itemId).filter((x): x is string => Boolean(x))
  const zones: MapZone[] = [
    { id: 'z1', name: 'North orchard', kind: 'orchard', crop: 'Apple', variety: 'Gala on M9', plantedAt: '2019-03-10', soil: 'loam', irrigation: 'drip', notes: 'Drip line on every row; bird netting in autumn.', itemIds: ids('North Orchard row 1') },
    { id: 'z2', name: 'Grain block', kind: 'cropland', crop: 'Wheat', variety: 'Durum', plantedAt: '2025-11-05', soil: 'clay', irrigation: 'rainfed' },
    { id: 'z3', name: 'Farm pond', kind: 'water', notes: 'Spring-fed; livestock drinking point.' },
    { id: 'z4', name: 'Main track', kind: 'path' },
    { id: 'z5', name: 'Sheep pasture', kind: 'pasture', crop: 'Ryegrass & clover', soil: 'loam', irrigation: 'rainfed', itemIds: ids('Ewe 0088', 'Ewe 0093', 'Ram 0007') },
    { id: 'z6', name: 'Barn', kind: 'shelter', notes: 'Lambing pens and feed store.', itemIds: ids('Main water tank') },
    { id: 'z7', name: 'Compost', kind: 'compost', itemIds: ids('Compost bay') },
  ]
  for (let r = 0; r < 4; r += 1) for (let c = 0; c < 5; c += 1) set(c, r, 'z1')
  for (let r = 0; r < 3; r += 1) for (let c = 7; c < 12; c += 1) set(c, r, 'z2')
  set(5, 1, 'z3'); set(6, 1, 'z3'); set(5, 2, 'z3'); set(6, 2, 'z3')
  for (let c = 0; c < 12; c += 1) set(c, 4, 'z4')
  for (let r = 5; r < 8; r += 1) for (let c = 0; c < 12; c += 1) set(c, r, 'z5')
  set(10, 6, 'z6'); set(11, 6, 'z6'); set(10, 7, 'z6'); set(11, 7, 'z6')
  set(0, 7, 'z7')
  return { width: 120, height: 80, unit: 'm', cols, rows, cells, zones, updatedAt: now() }
}

export function buildSeedTasks(itemId: Resolve, fieldId: Resolve): SeedTask[] {
  return [
    { title: 'Booster vaccination', type: 'vaccination', dueDate: dateIn(3), repeat: 'yearly', priority: 'high', itemId: itemId('Ewe 0088'), notes: 'Clostridial booster before lambing.' },
    { title: 'Trim hooves', type: 'maintenance', dueDate: dateIn(-2), repeat: 'none', priority: 'normal', itemId: itemId('Goat 0017') },
    { title: 'Water the north orchard', type: 'watering', dueDate: dateIn(0), repeat: 'weekly', priority: 'normal', itemId: itemId('North Orchard row 1') },
    { title: 'Fungicide spray — apples', type: 'spraying', dueDate: dateIn(6), repeat: 'none', priority: 'normal', itemId: itemId('North Orchard row 1') },
    { title: 'Check water tank level', type: 'maintenance', dueDate: dateIn(1), repeat: 'weekly', priority: 'low', itemId: itemId('Main water tank') },
    { title: 'Shear the flock', type: 'shearing', dueDate: dateIn(24), repeat: 'yearly', priority: 'normal', fieldId: fieldId('West field') },
    { title: 'Prepare lambing pen', type: 'maintenance', dueDate: dateIn(40), repeat: 'none', priority: 'high', itemId: itemId('Ewe 0088') },
    { title: 'Deworm goats', type: 'health-check', dueDate: dateIn(-4), repeat: 'none', priority: 'normal', itemId: itemId('Goat 0017'), done: true },
  ]
}

// --------------------------------------------------------------------------
// In-memory store (fallback / demo mode)
// --------------------------------------------------------------------------

class MemoryStore implements FarmStore {
  private items = new Map<string, Item>()
  private logs = new Map<string, LogEntry[]>()
  private fields = new Map<string, Field>()
  private tasks = new Map<string, Task>()
  private counters: Record<string, number> = { TR: 0, AN: 0, RS: 0, FD: 0, TK: 0 }

  constructor() {
    const fieldIds = new Map<string, string>()
    for (const seed of SEED_FIELDS) fieldIds.set(seed.name, this.insertField(seed).id)

    const itemIds = new Map<string, string>()
    for (const spec of SEED_DATA) {
      const item = this.insert({ ...spec.item, fieldId: fieldIds.get(spec.field) })
      itemIds.set(item.name, item.id)
      for (const log of spec.logs) this.pushLog(item.id, log)
    }
    for (const spec of SEED_DATA) {
      if (!spec.parents) continue
      const item = this.items.get(itemIds.get(spec.item.name)!)!
      item.profile = sanitizeProfile({
        ...item.profile,
        motherId: spec.parents.mother ? itemIds.get(spec.parents.mother) : undefined,
        fatherId: spec.parents.father ? itemIds.get(spec.parents.father) : undefined,
      })
    }

    const westId = fieldIds.get('West field')
    if (westId) this.fields.get(westId)!.map = normalizeMap(buildDemoMap((n) => itemIds.get(n)))

    for (const seed of buildSeedTasks((n) => itemIds.get(n), (n) => fieldIds.get(n))) {
      const task = this.insertTask(seed)
      if (seed.done) this.tasks.set(task.id, applyTaskPatch(task, { done: true }))
    }
  }

  private nextId(prefix: string): string {
    this.counters[prefix] = (this.counters[prefix] ?? 0) + 1
    return toId(prefix, this.counters[prefix])
  }

  private insertField(input: CreateFieldInput): Field {
    const field = normalizeField(input, this.nextId(FIELD_PREFIX))
    this.fields.set(field.id, field)
    return field
  }

  /** Pick a valid field id: the requested one, else the first field. */
  private resolveFieldId(requested?: string): string {
    if (requested && this.fields.has(requested)) return requested
    const first = this.fields.keys().next().value
    if (first) return first
    return this.insertField({ name: 'Field 1' }).id
  }

  private insert(input: CreateItemInput): Item {
    const item = normalizeCreate(input, this.nextId(ID_PREFIX[input.itemType]), this.resolveFieldId(input.fieldId))
    this.items.set(item.id, item)
    this.logs.set(item.id, [])
    return item
  }

  private pushLog(itemId: string, input: CreateLogInput): LogEntry {
    const item = this.items.get(itemId)
    if (!item) throw new NotFoundError(`Item ${itemId} not found`)
    const log = normalizeLog(itemId, input, `LG-${Math.random().toString(36).slice(2, 10)}`)
    this.logs.get(itemId)!.push(log)
    item.totals = foldTotal(item.totals, log)
    item.logCount += 1
    item.updatedAt = now()
    return log
  }

  private insertTask(input: CreateTaskInput): Task {
    if (input.itemId && !this.items.has(input.itemId)) throw new NotFoundError(`Item ${input.itemId} not found`)
    if (input.fieldId && !this.fields.has(input.fieldId)) throw new NotFoundError(`Field ${input.fieldId} not found`)
    const fieldId = input.fieldId || (input.itemId ? this.items.get(input.itemId)?.fieldId : undefined)
    const task = normalizeTask({ ...input, fieldId }, this.nextId(TASK_PREFIX))
    this.tasks.set(task.id, task)
    return task
  }

  async listItems(filter?: { type?: ItemType; query?: string; fieldId?: string }): Promise<Item[]> {
    let items = [...this.items.values()]
    if (filter?.fieldId) items = items.filter((i) => i.fieldId === filter.fieldId)
    if (filter?.type) items = items.filter((i) => i.itemType === filter.type)
    if (filter?.query) items = items.filter((i) => matchesQuery(i, filter.query))
    return structuredClone(items.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)))
  }

  async getItem(id: string): Promise<Item | null> {
    const item = this.items.get(id)
    return item ? structuredClone(item) : null
  }

  async createItem(input: CreateItemInput): Promise<Item> {
    return structuredClone(this.insert(input))
  }

  async updateItem(id: string, patch: UpdateItemInput): Promise<Item> {
    const item = this.items.get(id)
    if (!item) throw new NotFoundError(`Item ${id} not found`)
    if (patch.fieldId && !this.fields.has(patch.fieldId)) throw new NotFoundError(`Field ${patch.fieldId} not found`)
    const updated = applyPatch(item, patch)
    this.items.set(id, updated)
    return structuredClone(updated)
  }

  async deleteItem(id: string): Promise<void> {
    if (!this.items.has(id)) throw new NotFoundError(`Item ${id} not found`)
    this.items.delete(id)
    this.logs.delete(id)
    for (const [taskId, task] of this.tasks) if (task.itemId === id) this.tasks.delete(taskId)
    for (const field of this.fields.values()) {
      for (const zone of field.map?.zones ?? []) {
        if (zone.itemIds?.includes(id)) zone.itemIds = zone.itemIds.filter((x) => x !== id)
      }
    }
  }

  async listLogs(itemId: string): Promise<LogEntry[]> {
    if (!this.items.has(itemId)) throw new NotFoundError(`Item ${itemId} not found`)
    return structuredClone([...(this.logs.get(itemId) ?? [])].sort((a, b) => (a.appliedAt < b.appliedAt ? 1 : -1)))
  }

  async addLog(itemId: string, input: CreateLogInput): Promise<{ item: Item; log: LogEntry }> {
    const log = this.pushLog(itemId, input)
    return { item: structuredClone(this.items.get(itemId)!), log: structuredClone(log) }
  }

  async getStats(fieldId?: string): Promise<FarmStats> {
    const items = [...this.items.values()].filter((i) => !fieldId || i.fieldId === fieldId)
    const ids = new Set(items.map((i) => i.id))
    const logs = [...this.logs.values()].flat().filter((l) => ids.has(l.itemId))
    return computeStats(items, logs)
  }

  async listFields(): Promise<Field[]> {
    const counts = new Map<string, number>()
    for (const item of this.items.values()) counts.set(item.fieldId, (counts.get(item.fieldId) ?? 0) + 1)
    return structuredClone(
      [...this.fields.values()]
        .map((f) => withUpgradedMap({ ...f, itemCount: counts.get(f.id) ?? 0 }))
        .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)),
    )
  }

  async createField(input: CreateFieldInput): Promise<Field> {
    return structuredClone(this.insertField(input))
  }

  async updateField(id: string, patch: UpdateFieldInput): Promise<Field> {
    const field = this.fields.get(id)
    if (!field) throw new NotFoundError(`Field ${id} not found`)
    const updated = applyFieldPatch(field, patch)
    this.fields.set(id, updated)
    return structuredClone(updated)
  }

  async deleteField(id: string): Promise<void> {
    if (!this.fields.has(id)) throw new NotFoundError(`Field ${id} not found`)
    for (const item of this.items.values()) {
      if (item.fieldId === id) throw new ConflictError('Field still has items')
    }
    this.fields.delete(id)
    for (const [taskId, task] of this.tasks) if (task.fieldId === id) this.tasks.delete(taskId)
  }

  async listTasks(filter?: TaskFilter): Promise<Task[]> {
    return structuredClone(filterTasks([...this.tasks.values()], filter))
  }

  async createTask(input: CreateTaskInput): Promise<Task> {
    return structuredClone(this.insertTask(input))
  }

  async updateTask(id: string, patch: UpdateTaskInput): Promise<Task> {
    const task = this.tasks.get(id)
    if (!task) throw new NotFoundError(`Task ${id} not found`)
    if (patch.itemId && !this.items.has(patch.itemId)) throw new NotFoundError(`Item ${patch.itemId} not found`)
    if (patch.fieldId && !this.fields.has(patch.fieldId)) throw new NotFoundError(`Field ${patch.fieldId} not found`)
    const updated = applyTaskPatch(task, patch)
    this.tasks.set(id, updated)
    return structuredClone(updated)
  }

  async completeTask(id: string): Promise<CompleteTaskResult> {
    const task = this.tasks.get(id)
    if (!task) throw new NotFoundError(`Task ${id} not found`)
    if (task.done) return { task: structuredClone(task), logged: false }
    const done = applyTaskPatch(task, { done: true })
    this.tasks.set(id, done)
    const next = task.repeat !== 'none' ? this.insertTask(nextOccurrence(task)) : undefined
    const log = completionLog(task)
    let logged = false
    if (log && this.items.has(task.itemId!)) {
      this.pushLog(task.itemId!, log)
      logged = true
    }
    return { task: structuredClone(done), next: next && structuredClone(next), logged }
  }

  async deleteTask(id: string): Promise<void> {
    if (!this.tasks.has(id)) throw new NotFoundError(`Task ${id} not found`)
    this.tasks.delete(id)
  }
}

// --------------------------------------------------------------------------
// Store selection
// --------------------------------------------------------------------------

let memoryStore: MemoryStore | null = null

/** The in-memory demo store used by the API routes when Firebase isn't configured. */
export function getStore(): FarmStore {
  if (!memoryStore) memoryStore = new MemoryStore()
  return memoryStore
}
