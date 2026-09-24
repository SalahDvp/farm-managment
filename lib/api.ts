// Shared helpers for the route handlers: consistent JSON error shapes and a
// wrapper that maps domain errors to HTTP status codes.

import { NextResponse } from 'next/server'
import { ConflictError, NotFoundError } from '@/lib/farm-store'
import { ValidationError } from '@/lib/validate'

export function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

/** Run a route handler, translating known errors into HTTP responses. */
export async function handle<T>(fn: () => Promise<T>, successStatus = 200): Promise<NextResponse> {
  try {
    const data = await fn()
    return NextResponse.json(data, { status: successStatus })
  } catch (error) {
    if (error instanceof ValidationError) return errorResponse(error.message, 400)
    if (error instanceof NotFoundError) return errorResponse(error.message, 404)
    if (error instanceof ConflictError) return errorResponse(error.message, 409)
    if (error instanceof SyntaxError) return errorResponse('Request body is not valid JSON.', 400)
    console.error('[api] Unhandled error:', error)
    return errorResponse('Something went wrong on the server.', 500)
  }
}

/** Parse a JSON request body, tolerating an empty body. */
export async function readJson(request: Request): Promise<unknown> {
  const text = await request.text()
  if (!text) return {}
  return JSON.parse(text)
}
