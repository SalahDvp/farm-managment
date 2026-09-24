import { getStore } from '@/lib/farm-store'
import { handle, readJson } from '@/lib/api'
import { parseCreateLog } from '@/lib/validate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

// GET /api/farm-items/:id/logs  → every input/event recorded against the item.
export async function GET(_request: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params
    const logs = await getStore().listLogs(id)
    return { logs }
  })
}

// POST /api/farm-items/:id/logs  → record water, manure, feed, medicine, a
// health check, etc. against the item; running totals update automatically.
export async function POST(request: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params
    const input = parseCreateLog(await readJson(request))
    return getStore().addLog(id, input)
  }, 201)
}
