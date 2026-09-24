import { handle } from '@/lib/api'
import { getStore } from '@/lib/farm-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/stats?field=FD-0001  → aggregate figures for the dashboard.
export async function GET(request: Request) {
  const fieldId = new URL(request.url).searchParams.get('field') ?? undefined
  return handle(async () => {
    const stats = await getStore().getStats(fieldId)
    return { ...stats, backend: 'memory' }
  })
}
