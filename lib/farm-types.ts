import type { FieldShape } from '@/lib/field-shape'

// Shared domain types for the farm management system.
// Every physical thing on the farm — a tree, a sheep, a goat, a water tank —
// is an `Item` with its own unique id. Every input applied to that item
// (water, manure, feed, medicine, a health check) is a `LogEntry` stored
// against the item, so each record accumulates a full history of what went
// into it. Items carry a type-specific `profile` plus free-form custom fields,
// fields (plots) carry a zoned map, and `Task`s schedule upcoming work.

export type ItemType = 'tree' | 'animal' | 'resource'

export type ItemStatus = 'healthy' | 'attention'

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

/** Kinds of things that get logged against an item. */
export type LogKind =
  | 'water'
  | 'manure'
  | 'feed'
  | 'fertilizer'
  | 'medicine'
  | 'vaccination'
  | 'health-check'
  | 'harvest'
  | 'weight'
  | 'spray'
  | 'pruning'
  | 'note'

export const LOG_KINDS: LogKind[] = [
  'water',
  'manure',
  'feed',
  'fertilizer',
  'medicine',
  'vaccination',
  'health-check',
  'harvest',
  'weight',
  'spray',
  'pruning',
  'note',
]

/** Which inputs make sense for each kind of item (keeps the log form focused). */
export const KINDS_BY_TYPE: Record<ItemType, LogKind[]> = {
  animal: ['feed', 'water', 'weight', 'medicine', 'vaccination', 'health-check', 'harvest', 'note'],
  tree: ['water', 'fertilizer', 'manure', 'spray', 'pruning', 'harvest', 'health-check', 'note'],
  resource: ['water', 'feed', 'manure', 'fertilizer', 'note'],
}

export const ITEM_TYPES: ItemType[] = ['tree', 'animal', 'resource']

/** A single input/event recorded against one item. */
export interface LogEntry {
  id: string
  itemId: string
  kind: LogKind
  /** Numeric amount applied, when the kind is measurable (water litres, feed kg…). */
  amount: number
  /** Unit for `amount` (L, kg, mL, dose, item…). */
  unit: string
  note?: string
  performedBy?: string
  /** When the input was actually applied (ISO string). */
  appliedAt: string
  /** When the record was created (ISO string). */
  createdAt: string
}

/** Running total of one kind of input across an item's whole history. */
export interface InputTotal {
  /** Sum of all amounts — except `weight`, where this is the latest reading. */
  amount: number
  unit: string
  /** Number of times this kind was logged. */
  count: number
  /** ISO timestamp of the most recent entry of this kind. */
  lastAppliedAt: string
}

/** Default unit suggestions per log kind, used by the UI and validation. */
export const DEFAULT_UNIT: Record<LogKind, string> = {
  water: 'L',
  manure: 'kg',
  feed: 'kg',
  fertilizer: 'kg',
  medicine: 'mL',
  vaccination: 'dose',
  'health-check': 'check',
  harvest: 'kg',
  weight: 'kg',
  spray: 'L',
  pruning: '',
  note: '',
}

/** Whether a log kind carries a meaningful numeric amount. */
export function isMeasured(kind: LogKind): boolean {
  return kind !== 'note' && kind !== 'health-check' && kind !== 'pruning'
}

// ---------------------------------------------------------------------------
// Item profiles & custom fields
// ---------------------------------------------------------------------------

export const SEXES = ['female', 'male', 'unknown'] as const
export type Sex = (typeof SEXES)[number]

export const PURPOSES = ['meat', 'milk', 'wool', 'breeding', 'work', 'other'] as const
export type Purpose = (typeof PURPOSES)[number]

export const REPRO_STATUSES = ['open', 'pregnant', 'lactating', 'dry'] as const
export type ReproStatus = (typeof REPRO_STATUSES)[number]

export const IRRIGATIONS = ['drip', 'sprinkler', 'flood', 'rainfed', 'none'] as const
export type Irrigation = (typeof IRRIGATIONS)[number]

export const SOILS = ['loam', 'clay', 'sandy', 'silt', 'peat', 'chalk'] as const
export type Soil = (typeof SOILS)[number]

/**
 * Type-specific details. One flat, all-optional shape: the UI shows the
 * animal, tree, or resource subset depending on the item's type.
 */
export interface ItemProfile {
  // Animals
  sex?: Sex
  color?: string
  motherId?: string
  fatherId?: string
  purpose?: Purpose
  reproStatus?: ReproStatus
  /** Expected birth date when pregnant (YYYY-MM-DD). */
  dueDate?: string
  /** Where the animal came from, e.g. "Bred on farm" or a seller. */
  source?: string
  purchasePrice?: number
  // Trees & crops
  rootstock?: string
  spacing?: string
  irrigation?: Irrigation
  pollinator?: string
  /** Expected harvest per season, in kg. */
  expectedYield?: number
  organic?: boolean
  // Resources & stock
  capacity?: number
  currentLevel?: number
  reorderAt?: number
  supplier?: string
  unitCost?: number
}

/** Which profile keys belong to each item type. */
export const PROFILE_KEYS: Record<ItemType, (keyof ItemProfile)[]> = {
  animal: ['sex', 'color', 'motherId', 'fatherId', 'purpose', 'reproStatus', 'dueDate', 'source', 'purchasePrice'],
  tree: ['rootstock', 'spacing', 'irrigation', 'pollinator', 'expectedYield', 'organic'],
  resource: ['capacity', 'currentLevel', 'reorderAt', 'supplier', 'unitCost'],
}

export const NUMERIC_PROFILE_KEYS: (keyof ItemProfile)[] = ['purchasePrice', 'expectedYield', 'capacity', 'currentLevel', 'reorderAt', 'unitCost']

/** A user-defined label/value pair attached to an item. */
export interface CustomField {
  key: string
  value: string
}

export const CUSTOM_FIELD_LIMITS = { maxFields: 30, maxKey: 40, maxValue: 300 }

// ---------------------------------------------------------------------------
// Fields (plots) & maps
// ---------------------------------------------------------------------------

/** Kinds of zones a field's map can be painted with. */
export const ZONE_KINDS = [
  'orchard',
  'cropland',
  'vegetable',
  'pasture',
  'water',
  'shelter',
  'compost',
  'path',
] as const
export type ZoneKind = (typeof ZONE_KINDS)[number]

/** A named area on a field map, with its own details and linked items. */
export interface MapZone {
  /** Unique within its map, e.g. "z3". */
  id: string
  name: string
  kind: ZoneKind
  crop?: string
  variety?: string
  /** YYYY-MM-DD */
  plantedAt?: string
  soil?: Soil
  irrigation?: Irrigation
  notes?: string
  /** Items (animals, trees, resources) located in this zone. */
  itemIds?: string[]
}

/** A grid layout of a field: dimensions, its outline, and which zone each cell belongs to. */
export interface FieldMap {
  /** Physical size of the field. */
  width: number
  height: number
  /** Unit for width/height, e.g. "m". */
  unit: string
  /** Grid resolution. */
  cols: number
  rows: number
  /** cols*rows entries, each an empty string or a zone id. */
  cells: string[]
  zones: MapZone[]
  /** Real outline of the field; width/height are its bounding box. Absent means a plain rectangle. */
  shape?: FieldShape
  updatedAt: string
}

/** Bounds for a field map grid (keeps documents small and the UI usable). */
export const MAP_LIMITS = { minCells: 1, maxCols: 32, maxRows: 32, maxDim: 100000, maxZones: 60, maxZoneItems: 200 }

/** A named plot on the farm that items belong to and the dashboard can scope to. */
export interface Field {
  id: string
  name: string
  /** Area of the plot, e.g. 24. */
  area?: number
  /** Unit for the area, e.g. "ha". */
  unit?: string
  note?: string
  /** Optional visual grid layout of the field. */
  map?: FieldMap
  /** Number of items in this field (populated when listing). */
  itemCount?: number
  createdAt: string
  updatedAt: string
}

export interface CreateFieldInput {
  name: string
  area?: number
  unit?: string
  note?: string
}

export interface UpdateFieldInput {
  name?: string
  area?: number
  unit?: string
  note?: string
  map?: FieldMap
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

/** A uniquely identified thing on the farm. */
export interface Item {
  id: string
  name: string
  itemType: ItemType
  /** The field (plot) this item belongs to. */
  fieldId: string
  /** Species / breed / material, e.g. "Apple", "Sheep", "Manure". */
  species: string
  /** Optional finer classification, e.g. breed or variety. */
  breed?: string
  zone: string
  status: ItemStatus
  /** How many physical units this record represents (1 animal, 120 trees, 500 L). */
  quantity: number
  unit: string
  /** Physical ear tag / label number, if any. */
  tagNumber?: string
  /** Planting date for trees/crops, birth date for animals, acquired date for resources (ISO). */
  originDate?: string
  notes?: string
  /** Type-specific details (sex, rootstock, capacity…). */
  profile?: ItemProfile
  /** Anything else the farmer wants to record. */
  customFields?: CustomField[]
  /** Per-kind running totals of everything logged against this item. */
  totals: Partial<Record<LogKind, InputTotal>>
  logCount: number
  createdAt: string
  updatedAt: string
}

/** Payload accepted when creating an item. The id is generated server-side. */
export interface CreateItemInput {
  name: string
  itemType: ItemType
  fieldId?: string
  species: string
  breed?: string
  zone: string
  quantity?: number
  unit?: string
  tagNumber?: string
  originDate?: string
  notes?: string
  status?: ItemStatus
  profile?: ItemProfile
  customFields?: CustomField[]
}

/** Fields that may be patched on an existing item (profile/customFields are replaced whole). */
export interface UpdateItemInput {
  name?: string
  species?: string
  breed?: string
  zone?: string
  fieldId?: string
  status?: ItemStatus
  quantity?: number
  unit?: string
  tagNumber?: string
  originDate?: string
  notes?: string
  profile?: ItemProfile
  customFields?: CustomField[]
}

/** Payload accepted when adding a log entry to an item. */
export interface CreateLogInput {
  kind: LogKind
  amount?: number
  unit?: string
  note?: string
  performedBy?: string
  appliedAt?: string
}

// ---------------------------------------------------------------------------
// Tasks & reminders
// ---------------------------------------------------------------------------

export const TASK_TYPES = [
  'vaccination',
  'feeding',
  'watering',
  'spraying',
  'fertilizing',
  'harvest',
  'health-check',
  'pruning',
  'shearing',
  'maintenance',
  'other',
] as const
export type TaskType = (typeof TASK_TYPES)[number]

export const REPEATS = ['none', 'daily', 'weekly', 'monthly', 'yearly'] as const
export type Repeat = (typeof REPEATS)[number]

export const PRIORITIES = ['low', 'normal', 'high'] as const
export type Priority = (typeof PRIORITIES)[number]

/** Completing a task of these types also records the matching input on its item. */
export const TASK_LOG_KIND: Partial<Record<TaskType, LogKind>> = {
  vaccination: 'vaccination',
  'health-check': 'health-check',
  pruning: 'pruning',
}

export interface Task {
  id: string
  title: string
  type: TaskType
  /** YYYY-MM-DD */
  dueDate: string
  repeat: Repeat
  priority: Priority
  itemId?: string
  fieldId?: string
  notes?: string
  done: boolean
  doneAt?: string
  createdAt: string
  updatedAt: string
}

export interface CreateTaskInput {
  title: string
  type: TaskType
  dueDate: string
  repeat?: Repeat
  priority?: Priority
  itemId?: string
  fieldId?: string
  notes?: string
}

export interface UpdateTaskInput {
  title?: string
  type?: TaskType
  dueDate?: string
  repeat?: Repeat
  priority?: Priority
  /** Empty string unlinks. */
  itemId?: string
  fieldId?: string
  notes?: string
  done?: boolean
}

export interface CompleteTaskResult {
  task: Task
  /** The next occurrence, when the task repeats. */
  next?: Task
  /** Whether a matching log entry was recorded on the linked item. */
  logged: boolean
}

// ---------------------------------------------------------------------------
// Dashboard stats & ids
// ---------------------------------------------------------------------------

export interface FarmStats {
  totalItems: number
  counts: Record<ItemType, number>
  animalsHealthy: number
  animalsAttention: number
  waterThisWeek: { amount: number; unit: string }
  manureThisWeek: { amount: number; unit: string }
  feedThisWeek: { amount: number; unit: string }
  openAttention: number
  logsThisWeek: number
  recentLogs: (LogEntry & { itemName: string })[]
}

export const ID_PREFIX: Record<ItemType, string> = {
  tree: 'TR',
  animal: 'AN',
  resource: 'RS',
}

export const FIELD_PREFIX = 'FD'
export const TASK_PREFIX = 'TK'

/** Today's date as YYYY-MM-DD in local time. */
export function todayISO(date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Shift a YYYY-MM-DD date by one repeat interval. */
export function nextDueDate(date: string, repeat: Repeat): string {
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(y, (m || 1) - 1, d || 1)
  if (repeat === 'daily') dt.setDate(dt.getDate() + 1)
  else if (repeat === 'weekly') dt.setDate(dt.getDate() + 7)
  else if (repeat === 'monthly') dt.setMonth(dt.getMonth() + 1)
  else if (repeat === 'yearly') dt.setFullYear(dt.getFullYear() + 1)
  return todayISO(dt)
}
