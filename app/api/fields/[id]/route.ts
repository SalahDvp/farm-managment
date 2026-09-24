import { getStore } from '@/lib/farm-store'
import { handle, readJson } from '@/lib/api'
import { parseUpdateField } from '@/lib/validate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

// PATCH /api/fields/:id  → update name/area/note or save the field's map.
export async function PATCH(request: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params
    const patch = parseUpdateField(await readJson(request))
    return getStore().updateField(id, patch)
  })
}

// DELETE /api/fields/:id  → remove a field (only when it has no items → 409).
export async function DELETE(_request: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params
    await getStore().deleteField(id)
    return { ok: true, id }
  })
}
