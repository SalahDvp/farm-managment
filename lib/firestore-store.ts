// Firestore implementation of the farm store, running in the browser with the
// Firebase client SDK. Each signed-in user owns one farm under `farms/{uid}`;
// firestore.rules make sure nobody can read or write anyone else's farm.

import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  setDoc,
  where,
  writeBatch,
  type DocumentReference,
  type Firestore,
  type Query,
  type QueryConstraint,
} from 'firebase/firestore'
import {
  applyFieldPatch,
  applyPatch,
  applyTaskPatch,
  buildDemoMap,
  buildSeedTasks,
  completionLog,
  computeStats,
  ConflictError,
  filterTasks,
  foldTotal,
  matchesQuery,
  nextOccurrence,
  normalizeCreate,
  normalizeField,
  normalizeLog,
  normalizeTask,
  NotFoundError,
  now,
  SEED_DATA,
  SEED_FIELDS,
  toId,
  WEEK_MS,
  withUpgradedMap,
  type FarmStore,
  type TaskFilter,
} from '@/lib/farm-store'
import {
  FIELD_PREFIX,
  ID_PREFIX,
  TASK_PREFIX,
  type CompleteTaskResult,
  type CreateFieldInput,
  type CreateItemInput,
  type CreateLogInput,
  type CreateTaskInput,
  type FarmStats,
  type Field,
  type Item,
  type ItemType,
  type LogEntry,
  type Task,
  type UpdateFieldInput,
  type UpdateItemInput,
  type UpdateTaskInput,
} from '@/lib/farm-types'

/** Stored on every log so collection-group queries (and rules) stay inside one farm. */
type StoredLog = LogEntry & { farmId?: string }

const stripFarmId = ({ farmId: _farmId, ...log }: StoredLog): LogEntry => log

export class FirestoreStore implements FarmStore {
  private root: DocumentReference

  constructor(
    private db: Firestore,
    private farmId: string,
  ) {
    this.root = doc(db, 'farms', farmId)
  }

  private items() {
    return collection(this.root, 'items')
  }

  private itemRef(id: string) {
    return doc(this.root, 'items', id)
  }

  private logsCol(itemId: string) {
    return collection(this.root, 'items', itemId, 'logs')
  }

  private fieldsCol() {
    return collection(this.root, 'fields')
  }

  private fieldRef(id: string) {
    return doc(this.root, 'fields', id)
  }

  private tasksCol() {
    return collection(this.root, 'tasks')
  }

  private taskRef(id: string) {
    return doc(this.root, 'tasks', id)
  }

  private counterRef() {
    return doc(this.root, 'meta', 'counters')
  }

  /**
   * This farm's logs across all items. Uses a collection-group query (needs the
   * composite indexes in firestore.indexes.json); if those aren't deployed yet
   * it falls back to reading each item's logs so the dashboard keeps working.
   */
  private async farmLogs(itemIds: string[], constraints: QueryConstraint[], filter: (log: LogEntry) => boolean): Promise<LogEntry[]> {
    try {
      const q: Query = query(collectionGroup(this.db, 'logs'), where('farmId', '==', this.farmId), ...constraints)
      const snap = await getDocs(q)
      return snap.docs.map((d) => stripFarmId(d.data() as StoredLog))
    } catch (error) {
      if ((error as { code?: string }).code !== 'failed-precondition') throw error
      console.warn('[firestore] Missing logs index — run `firebase deploy --only firestore:indexes`. Falling back to per-item reads.')
      const snaps = await Promise.all(itemIds.map((id) => getDocs(this.logsCol(id))))
      return snaps.flatMap((snap) => snap.docs.map((d) => stripFarmId(d.data() as StoredLog))).filter(filter)
    }
  }

  async isEmpty(): Promise<boolean> {
    const probe = await getDocs(query(this.items(), limit(1)))
    return probe.empty
  }

  /** Write the demo dataset using the same builders as the memory store. */
  async seedDemo(): Promise<void> {
    const fieldIds = new Map<string, string>()
    for (const seed of SEED_FIELDS) fieldIds.set(seed.name, (await this.createField(seed)).id)

    const itemIds = new Map<string, string>()
    const created = new Map<string, Item>()
    for (const spec of SEED_DATA) {
      const item = await this.createItem({ ...spec.item, fieldId: fieldIds.get(spec.field) })
      itemIds.set(item.name, item.id)
      created.set(item.id, item)
      for (const log of spec.logs) await this.addLog(item.id, log)
    }
    for (const spec of SEED_DATA) {
      if (!spec.parents) continue
      const id = itemIds.get(spec.item.name)!
      await this.updateItem(id, {
        profile: {
          ...created.get(id)!.profile,
          motherId: spec.parents.mother ? itemIds.get(spec.parents.mother) : undefined,
          fatherId: spec.parents.father ? itemIds.get(spec.parents.father) : undefined,
        },
      })
    }

    const westId = fieldIds.get('West field')
    if (westId) await this.updateField(westId, { map: buildDemoMap((n) => itemIds.get(n)) })

    for (const seed of buildSeedTasks((n) => itemIds.get(n), (n) => fieldIds.get(n))) {
      const { done, ...input } = seed
      const task = await this.createTask(input)
      if (done) await this.updateTask(task.id, { done: true })
    }
  }

  private async nextId(prefix: string): Promise<string> {
    const counterRef = this.counterRef()
    const n = await runTransaction(this.db, async (tx) => {
      const snap = await tx.get(counterRef)
      const current = (snap.exists() ? (snap.data()?.[prefix] as number | undefined) : 0) ?? 0
      const next = current + 1
      tx.set(counterRef, { [prefix]: next }, { merge: true })
      return next
    })
    return toId(prefix, n)
  }

  /** Pick a valid field id: the requested one, else the first field (create one if none). */
  private async resolveFieldId(requested?: string): Promise<string> {
    if (requested) {
      const snap = await getDoc(this.fieldRef(requested))
      if (snap.exists()) return requested
    }
    const first = await getDocs(query(this.fieldsCol(), orderBy('createdAt', 'asc'), limit(1)))
    if (!first.empty) return first.docs[0].id
    const field = await this.createField({ name: 'Field 1' })
    return field.id
  }

  async listItems(filter?: { type?: ItemType; query?: string; fieldId?: string }): Promise<Item[]> {
    const snap = await getDocs(query(this.items(), orderBy('updatedAt', 'desc')))
    let items = snap.docs.map((d) => d.data() as Item)
    if (filter?.fieldId) items = items.filter((i) => i.fieldId === filter.fieldId)
    if (filter?.type) items = items.filter((i) => i.itemType === filter.type)
    if (filter?.query) items = items.filter((i) => matchesQuery(i, filter.query))
    return items
  }

  async getItem(id: string): Promise<Item | null> {
    const snap = await getDoc(this.itemRef(id))
    return snap.exists() ? (snap.data() as Item) : null
  }

  async createItem(input: CreateItemInput): Promise<Item> {
    const fieldId = await this.resolveFieldId(input.fieldId)
    const id = await this.nextId(ID_PREFIX[input.itemType])
    const item = normalizeCreate(input, id, fieldId)
    await setDoc(this.itemRef(id), item)
    return item
  }

  async updateItem(id: string, patch: UpdateItemInput): Promise<Item> {
    if (patch.fieldId) {
      const fieldSnap = await getDoc(this.fieldRef(patch.fieldId))
      if (!fieldSnap.exists()) throw new NotFoundError(`Field ${patch.fieldId} not found`)
    }
    const ref = this.itemRef(id)
    return runTransaction(this.db, async (tx) => {
      const snap = await tx.get(ref)
      if (!snap.exists()) throw new NotFoundError(`Item ${id} not found`)
      const updated = applyPatch(snap.data() as Item, patch)
      tx.set(ref, updated)
      return updated
    })
  }

  async deleteItem(id: string): Promise<void> {
    const ref = this.itemRef(id)
    const snap = await getDoc(ref)
    if (!snap.exists()) throw new NotFoundError(`Item ${id} not found`)
    const [logs, tasks, fields] = await Promise.all([
      getDocs(this.logsCol(id)),
      getDocs(query(this.tasksCol(), where('itemId', '==', id))),
      getDocs(this.fieldsCol()),
    ])
    const batch = writeBatch(this.db)
    logs.docs.forEach((d) => batch.delete(d.ref))
    tasks.docs.forEach((d) => batch.delete(d.ref))
    for (const d of fields.docs) {
      const field = d.data() as Field
      if (!field.map?.zones?.some((z) => z.itemIds?.includes(id))) continue
      const zones = field.map.zones.map((z) => (z.itemIds?.includes(id) ? { ...z, itemIds: z.itemIds.filter((x) => x !== id) } : z))
      batch.set(d.ref, { ...field, map: { ...field.map, zones } })
    }
    batch.delete(ref)
    await batch.commit()
  }

  async listLogs(itemId: string): Promise<LogEntry[]> {
    const itemSnap = await getDoc(this.itemRef(itemId))
    if (!itemSnap.exists()) throw new NotFoundError(`Item ${itemId} not found`)
    const snap = await getDocs(query(this.logsCol(itemId), orderBy('appliedAt', 'desc')))
    return snap.docs.map((d) => stripFarmId(d.data() as StoredLog))
  }

  async addLog(itemId: string, input: CreateLogInput): Promise<{ item: Item; log: LogEntry }> {
    const itemRef = this.itemRef(itemId)
    const logRef = doc(this.logsCol(itemId))
    return runTransaction(this.db, async (tx) => {
      const snap = await tx.get(itemRef)
      if (!snap.exists()) throw new NotFoundError(`Item ${itemId} not found`)
      const item = snap.data() as Item
      const log = normalizeLog(itemId, input, logRef.id)
      const updatedItem: Item = {
        ...item,
        totals: foldTotal(item.totals ?? {}, log),
        logCount: (item.logCount ?? 0) + 1,
        updatedAt: now(),
      }
      tx.set(logRef, { ...log, farmId: this.farmId } satisfies StoredLog)
      tx.set(itemRef, updatedItem)
      return { item: updatedItem, log }
    })
  }

  async getStats(fieldId?: string): Promise<FarmStats> {
    const itemsSnap = await getDocs(this.items())
    const items = itemsSnap.docs.map((d) => d.data() as Item).filter((i) => !fieldId || i.fieldId === fieldId)
    const ids = new Set(items.map((i) => i.id))
    const allIds = itemsSnap.docs.map((d) => d.id)
    // Only the last week of logs is needed for the dashboard sums + recent feed.
    const weekAgo = new Date(Date.now() - WEEK_MS).toISOString()
    const [weeklyLogs, recentLogs] = await Promise.all([
      this.farmLogs(allIds, [where('appliedAt', '>=', weekAgo)], (l) => l.appliedAt >= weekAgo),
      // A generous slice of recent logs so field-scoping still yields enough.
      this.farmLogs(allIds, [orderBy('createdAt', 'desc'), limit(40)], () => true).then((logs) =>
        logs.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 40),
      ),
    ])
    const byId = new Map<string, LogEntry>()
    for (const log of [...weeklyLogs, ...recentLogs]) {
      if (fieldId && !ids.has(log.itemId)) continue
      byId.set(`${log.itemId}:${log.id}`, log)
    }
    return computeStats(items, [...byId.values()])
  }

  async listFields(): Promise<Field[]> {
    const [fieldsSnap, itemsSnap] = await Promise.all([getDocs(query(this.fieldsCol(), orderBy('createdAt', 'asc'))), getDocs(this.items())])
    const counts = new Map<string, number>()
    for (const d of itemsSnap.docs) {
      const fid = (d.data() as Item).fieldId
      counts.set(fid, (counts.get(fid) ?? 0) + 1)
    }
    return fieldsSnap.docs.map((d) => {
      const field = d.data() as Field
      return withUpgradedMap({ ...field, itemCount: counts.get(field.id) ?? 0 })
    })
  }

  async createField(input: CreateFieldInput): Promise<Field> {
    const id = await this.nextId(FIELD_PREFIX)
    const field = normalizeField(input, id)
    await setDoc(this.fieldRef(id), field)
    return field
  }

  async updateField(id: string, patch: UpdateFieldInput): Promise<Field> {
    const ref = this.fieldRef(id)
    return runTransaction(this.db, async (tx) => {
      const snap = await tx.get(ref)
      if (!snap.exists()) throw new NotFoundError(`Field ${id} not found`)
      const updated = applyFieldPatch(snap.data() as Field, patch)
      tx.set(ref, updated)
      return updated
    })
  }

  async deleteField(id: string): Promise<void> {
    const snap = await getDoc(this.fieldRef(id))
    if (!snap.exists()) throw new NotFoundError(`Field ${id} not found`)
    const used = await getDocs(query(this.items(), where('fieldId', '==', id), limit(1)))
    if (!used.empty) throw new ConflictError('Field still has items')
    const tasks = await getDocs(query(this.tasksCol(), where('fieldId', '==', id)))
    const batch = writeBatch(this.db)
    tasks.docs.forEach((d) => batch.delete(d.ref))
    batch.delete(this.fieldRef(id))
    await batch.commit()
  }

  async listTasks(filter?: TaskFilter): Promise<Task[]> {
    const snap = await getDocs(this.tasksCol())
    return filterTasks(
      snap.docs.map((d) => d.data() as Task),
      filter,
    )
  }

  async createTask(input: CreateTaskInput): Promise<Task> {
    let fieldId = input.fieldId
    if (input.itemId) {
      const item = await getDoc(this.itemRef(input.itemId))
      if (!item.exists()) throw new NotFoundError(`Item ${input.itemId} not found`)
      fieldId = fieldId || (item.data() as Item).fieldId
    }
    if (input.fieldId) {
      const field = await getDoc(this.fieldRef(input.fieldId))
      if (!field.exists()) throw new NotFoundError(`Field ${input.fieldId} not found`)
    }
    const task = normalizeTask({ ...input, fieldId }, await this.nextId(TASK_PREFIX))
    await setDoc(this.taskRef(task.id), task)
    return task
  }

  async updateTask(id: string, patch: UpdateTaskInput): Promise<Task> {
    if (patch.itemId) {
      const item = await getDoc(this.itemRef(patch.itemId))
      if (!item.exists()) throw new NotFoundError(`Item ${patch.itemId} not found`)
    }
    if (patch.fieldId) {
      const field = await getDoc(this.fieldRef(patch.fieldId))
      if (!field.exists()) throw new NotFoundError(`Field ${patch.fieldId} not found`)
    }
    const ref = this.taskRef(id)
    return runTransaction(this.db, async (tx) => {
      const snap = await tx.get(ref)
      if (!snap.exists()) throw new NotFoundError(`Task ${id} not found`)
      const updated = applyTaskPatch(snap.data() as Task, patch)
      tx.set(ref, updated)
      return updated
    })
  }

  async completeTask(id: string): Promise<CompleteTaskResult> {
    const ref = this.taskRef(id)
    // Flip the flag atomically; follow-up writes use their own transactions.
    const { before, done } = await runTransaction(this.db, async (tx) => {
      const snap = await tx.get(ref)
      if (!snap.exists()) throw new NotFoundError(`Task ${id} not found`)
      const task = snap.data() as Task
      if (task.done) return { before: task, done: null }
      const updated = applyTaskPatch(task, { done: true })
      tx.set(ref, updated)
      return { before: task, done: updated }
    })
    if (!done) return { task: before, logged: false }
    const next = before.repeat !== 'none' ? await this.createTask(nextOccurrence(before)).catch(() => undefined) : undefined
    const log = completionLog(before)
    let logged = false
    if (log) {
      try {
        await this.addLog(before.itemId!, log)
        logged = true
      } catch (error) {
        if (!(error instanceof NotFoundError)) throw error
      }
    }
    return { task: done, next, logged }
  }

  async deleteTask(id: string): Promise<void> {
    const ref = this.taskRef(id)
    const snap = await getDoc(ref)
    if (!snap.exists()) throw new NotFoundError(`Task ${id} not found`)
    await deleteDoc(ref)
  }
}
