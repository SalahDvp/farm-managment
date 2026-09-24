import { getStore } from '@/lib/farm-store'
import { handle } from '@/lib/api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

// POST /api/tasks/:id/complete  → mark done; schedules the next occurrence for
// repeating tasks and records the matching input on a linked item.
export async function POST(_request: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params
    return getStore().completeTask(id)
  })
}
