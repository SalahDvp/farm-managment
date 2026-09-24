'use client'

// One entry point for every data call in the UI: `apiFetch('/api/…', init)`.
//
//   • Firebase configured → the request is answered right here in the browser
//     by the signed-in user's FirestoreStore (same paths, bodies, status codes
//     and JSON shapes as the API routes), so the UI doesn't care which is used.
//   • Demo mode → it's a normal fetch to the Next.js API routes (memory store).

import { ConflictError, NotFoundError } from '@/lib/farm-store'
import { ITEM_TYPES, type ItemType } from '@/lib/farm-types'
import { getFirebase } from '@/lib/firebase-client'
import { FirestoreStore } from '@/lib/firestore-store'
import {
  parseCreateField,
  parseCreateItem,
  parseCreateLog,
  parseCreateTask,
  parseUpdateField,
  parseUpdateItem,
  parseUpdateTask,
  ValidationError,
} from '@/lib/validate'

const stores = new Map<string, FirestoreStore>()

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function readBody(init?: RequestInit): unknown {
  if (typeof init?.body !== 'string' || !init.body) return {}
  return JSON.parse(init.body)
}

async function route(store: FirestoreStore, method: string, url: URL, init?: RequestInit): Promise<Response> {
  const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
  const params = url.searchParams
  const [resource, id, sub] = parts
  const backend = 'firestore'

  if (resource === 'farm-items') {
    if (!id && method === 'GET') {
      const typeParam = params.get('type')
      const type = typeParam && ITEM_TYPES.includes(typeParam as ItemType) ? (typeParam as ItemType) : undefined
      const items = await store.listItems({ type, query: params.get('q') ?? undefined, fieldId: params.get('field') ?? undefined })
      return json({ items, backend })
    }
    if (!id && method === 'POST') return json(await store.createItem(parseCreateItem(readBody(init))), 201)
    if (id && sub === 'logs') {
      if (method === 'GET') return json({ logs: await store.listLogs(id) })
      if (method === 'POST') return json(await store.addLog(id, parseCreateLog(readBody(init))), 201)
    }
    if (id && !sub) {
      if (method === 'GET') {
        const item = await store.getItem(id)
        if (!item) throw new NotFoundError(`Item ${id} not found`)
        return json({ item, logs: await store.listLogs(id) })
      }
      if (method === 'PATCH') return json(await store.updateItem(id, parseUpdateItem(readBody(init))))
      if (method === 'DELETE') {
        await store.deleteItem(id)
        return json({ ok: true, id })
      }
    }
  }

  if (resource === 'fields') {
    if (!id && method === 'GET') return json({ fields: await store.listFields(), backend })
    if (!id && method === 'POST') return json(await store.createField(parseCreateField(readBody(init))), 201)
    if (id && method === 'PATCH') return json(await store.updateField(id, parseUpdateField(readBody(init))))
    if (id && method === 'DELETE') {
      await store.deleteField(id)
      return json({ ok: true, id })
    }
  }

  if (resource === 'stats' && method === 'GET') {
    return json({ ...(await store.getStats(params.get('field') ?? undefined)), backend })
  }

  if (resource === 'tasks') {
    if (!id && method === 'GET') {
      const status = params.get('status')
      const tasks = await store.listTasks({
        status: status === 'open' || status === 'done' ? status : 'all',
        fieldId: params.get('field') ?? undefined,
        itemId: params.get('item') ?? undefined,
      })
      return json({ tasks })
    }
    if (!id && method === 'POST') return json(await store.createTask(parseCreateTask(readBody(init))), 201)
    if (id && sub === 'complete' && method === 'POST') return json(await store.completeTask(id))
    if (id && !sub && method === 'PATCH') return json(await store.updateTask(id, parseUpdateTask(readBody(init))))
    if (id && !sub && method === 'DELETE') {
      await store.deleteTask(id)
      return json({ ok: true, id })
    }
  }

  // POST /api/demo-data → fill an empty farm with the sample data.
  if (resource === 'demo-data' && method === 'POST') {
    if (!(await store.isEmpty())) throw new ConflictError('Your farm already has items.')
    await store.seedDemo()
    return json({ ok: true }, 201)
  }

  return json({ error: `No route for ${method} ${url.pathname}` }, 404)
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const firebase = getFirebase()
  if (!firebase) return fetch(path, init)

  await firebase.auth.authStateReady()
  const user = firebase.auth.currentUser
  if (!user) return json({ error: 'Please sign in to continue.' }, 401)

  let store = stores.get(user.uid)
  if (!store) {
    store = new FirestoreStore(firebase.db, user.uid)
    stores.set(user.uid, store)
  }

  const method = (init?.method ?? 'GET').toUpperCase()
  try {
    return await route(store, method, new URL(path, window.location.origin), init)
  } catch (error) {
    if (error instanceof ValidationError) return json({ error: error.message }, 400)
    if (error instanceof NotFoundError) return json({ error: error.message }, 404)
    if (error instanceof ConflictError) return json({ error: error.message }, 409)
    if (error instanceof SyntaxError) return json({ error: 'Request body is not valid JSON.' }, 400)
    const code = (error as { code?: string }).code
    if (code === 'permission-denied') {
      console.error('[firestore] Permission denied — deploy firestore.rules (see README).', error)
      return json({ error: 'Firestore denied access. Deploy firestore.rules for this project.' }, 403)
    }
    console.error('[firestore] Request failed:', error)
    return json({ error: error instanceof Error ? error.message : 'Something went wrong.' }, 500)
  }
}
