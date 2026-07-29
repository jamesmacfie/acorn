import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { ApiError } from '../shared/api'
import type { AppEnv } from './middleware/auth'

// The single error-construction path. Every /api error body is built here, so it always
// conforms to ApiError (docs/api-reference.md §error-codes) — one shape, no per-route idiom.
// `error` stays a stable machine code; `detail` carries human/upstream prose.
// (`detail: undefined` is dropped by JSON serialization, so it never reaches the wire.)
export const respondError = (c: Context<AppEnv>, status: ContentfulStatusCode, error: string, detail?: string[]) =>
  c.json({ error, detail } satisfies ApiError, status)

// App-level backstop (`.onError` in createApp()): uncaught throws on /api must still speak the
// ApiError envelope, or clients parsing it hit Hono's default text/plain 500 — the second error
// shape this module exists to eliminate. HTTPExceptions (e.g. csrf's 403) keep their own
// response, exactly as Hono's default handler would.
export const onServerError = (err: Error, c: Context<AppEnv>) => {
  if (err instanceof HTTPException) return err.getResponse()
  const value = err as Error & { code?: unknown }
  // Drizzle/better-sqlite3 can embed bound values in err.message. Neither the browser nor logs get
  // the message/stack at this generic backstop; domain paths that intentionally expose safe detail
  // must do so before throwing. Name + a short machine code retain useful classification.
  console.error('[server] unhandled error', {
    name: err.name,
    code: typeof value.code === 'string' && /^[A-Z0-9_:-]{1,80}$/i.test(value.code) ? value.code : undefined,
    method: c.req.method,
    path: c.req.path,
  })
  if (c.req.path.startsWith('/api/')) return respondError(c, 500, 'internal')
  return c.text('Internal Server Error', 500)
}
