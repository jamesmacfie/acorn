import { createMiddleware } from 'hono/factory'
import { requestHash, type IdempotencyStore } from '../auth/idempotency'
import { respondError } from '../respond'
import type { AppEnv } from './auth'

const KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Statuses that MUST NOT carry a body — replaying one with an empty-string body throws in undici
// rather than producing an empty 204.
const BODILESS = new Set([204, 205, 304])

// In-flight executions, keyed exactly as the store is. docs/api-reference.md: "a duplicate arriving while the
// first is still executing waits for it and gets its response". Process-local by design — this is the
// window between "first request started" and "its response was stored", which only exists inside one
// process.
const inFlight = new Map<string, { hash: string; response: Promise<Response> }>()

const conflict = (c: Parameters<typeof respondError>[0]): Response =>
  respondError(c, 409, 'idempotency_conflict', ['This Idempotency-Key was already used with a different request.'])

// Rebuild a Response from a stored row. Content type is asserted rather than stored: every /v2 route
// answers JSON or nothing, and a column would need a migration to carry what is currently a constant.
const replay = (stored: { responseStatus: number; responseBody: string }): Response =>
  new Response(BODILESS.has(stored.responseStatus) ? null : stored.responseBody, {
    status: stored.responseStatus,
    headers: BODILESS.has(stored.responseStatus) ? {} : { 'content-type': 'application/json' },
  })

export const idempotency = createMiddleware<AppEnv>(async (c, next) => {
  const key = c.req.header('idempotency-key')
  // GET/HEAD are side-effect-free by the same document's rules, so a key on one means nothing.
  if (!key || c.req.method === 'GET' || c.req.method === 'HEAD') return next()

  // No deviceId → no key space. The internal-token principal is a child process this node spawned: it
  // has no durable device identity to scope a key to, and keying every such child together would let
  // one caller's retry replay another's response. It is also a same-machine caller that does not retry
  // across a network, which is what the header is for. It passes through untouched.
  const deviceId = c.get('principal')?.deviceId
  if (!deviceId) return next()

  if (!KEY_RE.test(key)) return respondError(c, 400, 'bad_request', ['Idempotency-Key must be a UUID.'])

  // Absent only in a bare test Context; a real node always binds it.
  const store: IdempotencyStore | undefined = c.env.IDEMPOTENCY
  if (!store) return next()

  // Reading the body here is safe because Hono memoizes c.req body reads — the route handler still
  // gets its own c.req.json(). The hash covers method + path + body, so the same key on a different
  // request is detectable rather than silently replaying the wrong response.
  const raw = await c.req.text()
  const hash = requestHash(c.req.method, new URL(c.req.url).pathname, raw)
  const scope = `${deviceId}\n${key}`

  const stored = await store.lookup(deviceId, key)
  if (stored) return stored.requestHash === hash ? replay(stored) : conflict(c)

  const executing = inFlight.get(scope)
  if (executing) {
    if (executing.hash !== hash) return conflict(c)
    // Wait for the first execution instead of running a second one. clone() so both callers own an
    // unread body.
    return (await executing.response).clone()
  }

  let settle!: (response: Response) => void
  let fail!: (error: unknown) => void
  const response = new Promise<Response>((resolve, reject) => {
    settle = resolve
    fail = reject
  })
  // A waiter is optional, so the rejection path needs a handler attached up front or a throw in the
  // first request becomes an unhandled rejection when nobody duplicated it.
  void response.catch(() => {})
  inFlight.set(scope, { hash, response })
  try {
    await next()
    // Only final outcomes are stored: a 5xx (or an uncaught throw, which the app backstop turns into
    // one) leaves nothing behind, so a genuine retry re-executes rather than replaying a failure.
    if (c.res.status < 500) {
      const body = await c.res.clone().text()
      await store.save(deviceId, key, hash, c.res.status, body)
    }
    settle(c.res.clone())
    return
  } catch (error) {
    // The app backstop turns this into a 500, and a 500 is not stored — so a duplicate that was
    // waiting must see the failure too rather than a response that never existed.
    fail(error)
    throw error
  } finally {
    inFlight.delete(scope)
  }
})
