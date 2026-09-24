import { getStore } from '@/lib/farm-store'
import { handle, readJson } from '@/lib/api'
import { parseUpdateTask } from '@/lib/validate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

// PATCH /api/tasks/:id  → edit a task, or reopen it with { done: false }.
export async function PATCH(request: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params
    const patch = parseUpdateTask(await readJson(request))
    return getStore().updateTask(id, patch)
  })
}

// DELETE /api/tasks/:id
export async function DELETE(_request: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params
    await getStore().deleteTask(id)
    return { ok: true, id }
  })
}
