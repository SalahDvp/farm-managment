// Request-body validation for the API routes. Each parser returns a typed,
// trimmed value or throws ValidationError (mapped to HTTP 400 by the routes).
// The sanitizers are also used by the store, so every write path agrees on
// what a clean profile / custom-field list looks like.

import {
  CUSTOM_FIELD_LIMITS,
  IRRIGATIONS,
  isMeasured,
  ITEM_TYPES,
  LOG_KINDS,
  PRIORITIES,
  PURPOSES,
  REPEATS,
  REPRO_STATUSES,
  SEXES,
  TASK_TYPES,
  type CreateFieldInput,
  type CreateItemInput,
  type CreateLogInput,
  type CreateTaskInput,
  type CustomField,
  type FieldMap,
  type ItemProfile,
  type ItemType,
  type LogKind,
  type MapZone,
  type Priority,
  type Repeat,
  type TaskType,
  type UpdateFieldInput,
  type UpdateItemInput,
  type UpdateTaskInput,
} from '@/lib/farm-types'

export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function optionalStr(value: unknown, max = 500): string | undefined {
  const s = str(value)
  return s.length > 0 ? s.slice(0, max) : undefined
}

function num(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

function nonNegative(value: unknown): number | undefined {
  const n = num(value)
  return n !== undefined && n >= 0 ? n : undefined
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : undefined
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function isoDate(value: unknown): string | undefined {
  return typeof value === 'string' && DATE_RE.test(value) ? value : undefined
}

// ---------------------------------------------------------------------------
// Sanitizers (lenient: unknown or invalid values are dropped, not rejected)
// ---------------------------------------------------------------------------

export function sanitizeProfile(raw: unknown): ItemProfile | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const p = raw as Record<string, unknown>
  const out: ItemProfile = {
    sex: oneOf(p.sex, SEXES),
    color: optionalStr(p.color, 120),
    motherId: optionalStr(p.motherId, 20),
    fatherId: optionalStr(p.fatherId, 20),
    purpose: oneOf(p.purpose, PURPOSES),
    reproStatus: oneOf(p.reproStatus, REPRO_STATUSES),
    dueDate: isoDate(p.dueDate),
    source: optionalStr(p.source, 120),
    purchasePrice: nonNegative(p.purchasePrice),
    rootstock: optionalStr(p.rootstock, 120),
    spacing: optionalStr(p.spacing, 40),
    irrigation: oneOf(p.irrigation, IRRIGATIONS),
    pollinator: optionalStr(p.pollinator, 120),
    expectedYield: nonNegative(p.expectedYield),
    organic: typeof p.organic === 'boolean' ? p.organic : undefined,
    capacity: nonNegative(p.capacity),
    currentLevel: nonNegative(p.currentLevel),
    reorderAt: nonNegative(p.reorderAt),
    supplier: optionalStr(p.supplier, 120),
    unitCost: nonNegative(p.unitCost),
  }
  for (const key of Object.keys(out) as (keyof ItemProfile)[]) {
    if (out[key] === undefined) delete out[key]
  }
  return Object.keys(out).length > 0 ? out : undefined
}

export function sanitizeCustomFields(raw: unknown): CustomField[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: CustomField[] = []
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const key = optionalStr(r.key, CUSTOM_FIELD_LIMITS.maxKey)
    if (!key) continue
    const value = typeof r.value === 'string' ? r.value.trim().slice(0, CUSTOM_FIELD_LIMITS.maxValue) : ''
    out.push({ key, value })
    if (out.length >= CUSTOM_FIELD_LIMITS.maxFields) break
  }
  return out
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export function parseCreateItem(body: unknown): CreateItemInput {
  const b = (body ?? {}) as Record<string, unknown>
  const name = str(b.name)
  const species = str(b.species)
  const zone = str(b.zone)
  const itemType = b.itemType as ItemType
  if (!ITEM_TYPES.includes(itemType)) {
    throw new ValidationError(`itemType must be one of: ${ITEM_TYPES.join(', ')}`)
  }
  if (!name) throw new ValidationError('name is required')
  if (!species) throw new ValidationError('species is required')
  if (!zone) throw new ValidationError('zone (location) is required')
  const quantity = num(b.quantity)
  if (quantity !== undefined && quantity <= 0) throw new ValidationError('quantity must be greater than zero')
  return {
    name: name.slice(0, 120),
    species: species.slice(0, 120),
    zone: zone.slice(0, 120),
    itemType,
    fieldId: optionalStr(b.fieldId, 20),
    breed: optionalStr(b.breed, 120),
    quantity,
    unit: optionalStr(b.unit, 20),
    tagNumber: optionalStr(b.tagNumber, 40),
    originDate: isoDate(b.originDate),
    notes: optionalStr(b.notes, 2000),
    status: b.status === 'attention' ? 'attention' : b.status === 'healthy' ? 'healthy' : undefined,
    profile: sanitizeProfile(b.profile),
    customFields: sanitizeCustomFields(b.customFields),
  }
}

export function parseUpdateItem(body: unknown): UpdateItemInput {
  const b = (body ?? {}) as Record<string, unknown>
  const patch: UpdateItemInput = {}
  if ('name' in b) patch.name = str(b.name).slice(0, 120)
  if ('species' in b) patch.species = str(b.species).slice(0, 120)
  if ('breed' in b) patch.breed = str(b.breed).slice(0, 120)
  if ('zone' in b) patch.zone = str(b.zone).slice(0, 120)
  if ('fieldId' in b) patch.fieldId = str(b.fieldId).slice(0, 20)
  if ('unit' in b) patch.unit = str(b.unit).slice(0, 20)
  if ('tagNumber' in b) patch.tagNumber = str(b.tagNumber).slice(0, 40)
  if ('originDate' in b) patch.originDate = isoDate(b.originDate) ?? ''
  if ('notes' in b) patch.notes = str(b.notes).slice(0, 2000)
  if ('status' in b) {
    if (b.status !== 'healthy' && b.status !== 'attention') throw new ValidationError('status must be "healthy" or "attention"')
    patch.status = b.status
  }
  if ('quantity' in b) {
    const q = num(b.quantity)
    if (q === undefined || q <= 0) throw new ValidationError('quantity must be a number greater than zero')
    patch.quantity = q
  }
  // Present-but-empty means "clear it".
  if ('profile' in b) patch.profile = sanitizeProfile(b.profile) ?? {}
  if ('customFields' in b) patch.customFields = sanitizeCustomFields(b.customFields) ?? []
  if (Object.keys(patch).length === 0) throw new ValidationError('no updatable fields provided')
  return patch
}

// ---------------------------------------------------------------------------
// Fields & maps
// ---------------------------------------------------------------------------

export function parseCreateField(body: unknown): CreateFieldInput {
  const b = (body ?? {}) as Record<string, unknown>
  const name = str(b.name)
  if (!name) throw new ValidationError('name is required')
  const area = num(b.area)
  if (area !== undefined && area <= 0) throw new ValidationError('area must be greater than zero')
  return {
    name: name.slice(0, 80),
    area,
    unit: optionalStr(b.unit, 20),
    note: optionalStr(b.note, 500),
  }
}

export function parseUpdateField(body: unknown): UpdateFieldInput {
  const b = (body ?? {}) as Record<string, unknown>
  const patch: UpdateFieldInput = {}
  if ('name' in b) patch.name = str(b.name).slice(0, 80)
  if ('note' in b) patch.note = str(b.note).slice(0, 500)
  if ('unit' in b) patch.unit = str(b.unit).slice(0, 20)
  if ('area' in b) {
    const a = num(b.area)
    if (a !== undefined && a <= 0) throw new ValidationError('area must be greater than zero')
    patch.area = a
  }
  if ('map' in b && b.map && typeof b.map === 'object') {
    const m = b.map as Record<string, unknown>
    if (!Array.isArray(m.cells)) throw new ValidationError('map.cells must be an array')
    if (m.zones !== undefined && !Array.isArray(m.zones)) throw new ValidationError('map.zones must be an array')
    // The store clamps sizes and validates zones; here we just shape the object.
    patch.map = {
      width: num(m.width) ?? 1,
      height: num(m.height) ?? 1,
      unit: str(m.unit) || 'm',
      cols: num(m.cols) ?? 1,
      rows: num(m.rows) ?? 1,
      cells: (m.cells as unknown[]).map((c) => (typeof c === 'string' ? c : '')),
      zones: (Array.isArray(m.zones) ? m.zones : []) as MapZone[],
      updatedAt: new Date().toISOString(),
    } satisfies FieldMap
  }
  if (Object.keys(patch).length === 0) throw new ValidationError('no updatable fields provided')
  return patch
}

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

export function parseCreateLog(body: unknown): CreateLogInput {
  const b = (body ?? {}) as Record<string, unknown>
  const kind = b.kind as LogKind
  if (!LOG_KINDS.includes(kind)) {
    throw new ValidationError(`kind must be one of: ${LOG_KINDS.join(', ')}`)
  }
  const amount = num(b.amount)
  if (isMeasured(kind) && (amount === undefined || amount <= 0)) {
    throw new ValidationError(`a positive amount is required for "${kind}"`)
  }
  return {
    kind,
    amount,
    unit: optionalStr(b.unit, 20),
    note: optionalStr(b.note, 1000),
    performedBy: optionalStr(b.performedBy, 80),
    appliedAt: optionalStr(b.appliedAt, 40),
  }
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export function parseCreateTask(body: unknown): CreateTaskInput {
  const b = (body ?? {}) as Record<string, unknown>
  const title = str(b.title)
  if (!title) throw new ValidationError('title is required')
  const type = oneOf<TaskType>(b.type, TASK_TYPES)
  if (!type) throw new ValidationError(`type must be one of: ${TASK_TYPES.join(', ')}`)
  const dueDate = isoDate(b.dueDate)
  if (!dueDate) throw new ValidationError('dueDate must be a date (YYYY-MM-DD)')
  return {
    title: title.slice(0, 120),
    type,
    dueDate,
    repeat: oneOf<Repeat>(b.repeat, REPEATS) ?? 'none',
    priority: oneOf<Priority>(b.priority, PRIORITIES) ?? 'normal',
    itemId: optionalStr(b.itemId, 20),
    fieldId: optionalStr(b.fieldId, 20),
    notes: optionalStr(b.notes, 1000),
  }
}

export function parseUpdateTask(body: unknown): UpdateTaskInput {
  const b = (body ?? {}) as Record<string, unknown>
  const patch: UpdateTaskInput = {}
  if ('title' in b) {
    const title = str(b.title)
    if (!title) throw new ValidationError('title cannot be empty')
    patch.title = title.slice(0, 120)
  }
  if ('type' in b) {
    const type = oneOf<TaskType>(b.type, TASK_TYPES)
    if (!type) throw new ValidationError(`type must be one of: ${TASK_TYPES.join(', ')}`)
    patch.type = type
  }
  if ('dueDate' in b) {
    const due = isoDate(b.dueDate)
    if (!due) throw new ValidationError('dueDate must be a date (YYYY-MM-DD)')
    patch.dueDate = due
  }
  if ('repeat' in b) {
    const repeat = oneOf<Repeat>(b.repeat, REPEATS)
    if (!repeat) throw new ValidationError(`repeat must be one of: ${REPEATS.join(', ')}`)
    patch.repeat = repeat
  }
  if ('priority' in b) {
    const priority = oneOf<Priority>(b.priority, PRIORITIES)
    if (!priority) throw new ValidationError(`priority must be one of: ${PRIORITIES.join(', ')}`)
    patch.priority = priority
  }
  if ('itemId' in b) patch.itemId = str(b.itemId).slice(0, 20)
  if ('fieldId' in b) patch.fieldId = str(b.fieldId).slice(0, 20)
  if ('notes' in b) patch.notes = str(b.notes).slice(0, 1000)
  if ('done' in b) {
    if (typeof b.done !== 'boolean') throw new ValidationError('done must be true or false')
    patch.done = b.done
  }
  if (Object.keys(patch).length === 0) throw new ValidationError('no updatable fields provided')
  return patch
}
