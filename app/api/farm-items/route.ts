import { getStore } from '@/lib/farm-store'
import { handle, readJson } from '@/lib/api'
import { parseCreateItem } from '@/lib/validate'
import { ITEM_TYPES, type ItemType } from '@/lib/farm-types'

// Always run on the Node runtime (firebase-admin is not edge-compatible) and
// never cache — inventory changes constantly.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/farm-items?type=animal&q=ewe&field=FD-0001  → list registered items.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const typeParam = searchParams.get('type')
  const type = typeParam && ITEM_TYPES.includes(typeParam as ItemType) ? (typeParam as ItemType) : undefined
  const query = searchParams.get('q') ?? undefined
  const fieldId = searchParams.get('field') ?? undefined
  return handle(async () => {
    const items = await getStore().listItems({ type, query, fieldId })
    return { items, backend: 'memory' }
  })
}

// POST /api/farm-items  → register a new tree, animal, or resource (id generated).
export async function POST(request: Request) {
  return handle(async () => {
    const input = parseCreateItem(await readJson(request))
    return getStore().createItem(input)
  }, 201)
}
