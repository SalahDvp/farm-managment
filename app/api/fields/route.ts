import { getStore } from '@/lib/farm-store'
import { handle, readJson } from '@/lib/api'
import { parseCreateField } from '@/lib/validate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/fields  → every field (plot) with its item count.
export async function GET() {
  return handle(async () => {
    const fields = await getStore().listFields()
    return { fields, backend: 'memory' }
  })
}

// POST /api/fields  → create a new field.
export async function POST(request: Request) {
  return handle(async () => {
    const input = parseCreateField(await readJson(request))
    return getStore().createField(input)
  }, 201)
}
