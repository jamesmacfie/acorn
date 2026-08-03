import { randomUUID } from 'node:crypto'
import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { HTTPException } from 'hono/http-exception'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { codeForStatus, requestIdSchema, statusIsRetryable, type ApiError, type ErrorCodeOrDomain } from '@acorn/protocol/errors.ts'
import type { AppEnv } from './middleware/auth'

// Assign or echo the request id, before anything else in createApp(). A caller-supplied
// X-Request-Id is honoured only when it matches the grammar (so a hostile header cannot inject into
// logs or response headers); otherwise we mint one. Echoed in the header AND every error envelope,
// which is what makes a user-reported failure findable in the server log.
export const requestIdMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const provided = c.req.header('x-request-id')
  const requestId = provided && requestIdSchema.safeParse(provided).success ? provided : randomUUID()
  c.set('requestId', requestId)
  c.header('x-request-id', requestId)
  await next()
})

// Absent only when a test builds a bare Context without the middleware; real requests always carry
// one. Deliberately not minted here — an id that never reached a response header or a log line
// would correlate with nothing, so saying so is more honest than inventing one.
const requestIdOf = (c: Context<AppEnv>): string => c.get('requestId') ?? 'unknown'

// The single error-construction path. Every error body is built here, so it always conforms to
// ApiError (docs/vNext/protocol.md § Errors) — one shape, no per-route idiom.
//
// `code` stays a stable machine code the client branches on; `detail` carries human/upstream prose
// and becomes `message`. `retryable` is derived from the status so no route maintains a table.
export function respondError(
  c: Context<AppEnv>,
  status: ContentfulStatusCode,
  code: ErrorCodeOrDomain,
  detail?: string[],
  details?: unknown,
): Response {
  const body: ApiError = {
    error: {
      code: code || codeForStatus(status),
      message: detail?.length ? detail.join('\n') : code,
      requestId: requestIdOf(c),
      retryable: statusIsRetryable(status),
      ...(details !== undefined ? { details } : {}),
    },
  }
  return c.json(body, status)
}

// App-level backstop (`.onError` in createApp()): uncaught throws must still speak the ApiError
// envelope, or clients parsing it hit Hono's default text/plain 500 — the second error shape this
// module exists to eliminate. HTTPExceptions (e.g. csrf's 403) keep their own response, exactly as
// Hono's default handler would.
export const onServerError = (err: Error, c: Context<AppEnv>) => {
  if (err instanceof HTTPException) return err.getResponse()
  const value = err as Error & { code?: unknown }
  // Drizzle/better-sqlite3 can embed bound values in err.message. Neither the browser nor logs get
  // the message/stack at this generic backstop; domain paths that intentionally expose safe detail
  // must do so before throwing. Name + a short machine code retain useful classification, and the
  // requestId is what ties this log line to the envelope the user saw.
  console.error('[server] unhandled error', {
    name: err.name,
    code: typeof value.code === 'string' && /^[A-Z0-9_:-]{1,80}$/i.test(value.code) ? value.code : undefined,
    method: c.req.method,
    path: c.req.path,
    requestId: requestIdOf(c),
  })
  // No path gate. This used to answer JSON only under /api/ and text/plain elsewhere, which would
  // have silently downgraded every 500 on the /v2 namespace to unparseable prose.
  return respondError(c, 500, 'internal')
}
