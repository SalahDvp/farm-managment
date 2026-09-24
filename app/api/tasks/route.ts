import { getStore, type TaskFilter } from '@/lib/farm-store'
import { handle, readJson } from '@/lib/api'
import { parseCreateTask } from '@/lib/validate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/tasks?status=open|done|all&field=FD-0001&item=AN-0001
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const status = params.get('status')
  const filter: TaskFilter = {
    status: status === 'open' || status === 'done' ? status : 'all',
    fieldId: params.get('field') ?? undefined,
    itemId: params.get('item') ?? undefined,
  }
  return handle(async () => ({ tasks: await getStore().listTasks(filter) }))
}

// POST /api/tasks  → schedule a new task / reminder.
export async function POST(request: Request) {
  return handle(async () => {
    const input = parseCreateTask(await readJson(request))
    return getStore().createTask(input)
  }, 201)
}
