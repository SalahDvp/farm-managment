import { getStore, NotFoundError } from '@/lib/farm-store'
import { handle, readJson } from '@/lib/api'
import { parseUpdateItem } from '@/lib/validate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

// GET /api/farm-items/:id  → one item together with its full log history.
export async function GET(_request: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params
    const store = getStore()
    const item = await store.getItem(id)
    if (!item) throw new NotFoundError(`Item ${id} not found`)
    const logs = await store.listLogs(id)
    return { item, logs }
  })
}

// PATCH /api/farm-items/:id  → update mutable fields (status, zone, notes…).
export async function PATCH(request: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params
    const patch = parseUpdateItem(await readJson(request))
    return getStore().updateItem(id, patch)
  })
}

// DELETE /api/farm-items/:id  → remove the item and every log under it.
export async function DELETE(_request: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params
    await getStore().deleteItem(id)
    return { ok: true, id }
  })
}
