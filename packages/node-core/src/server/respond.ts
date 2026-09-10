import { randomUUID } from 'node:crypto'
import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { HTTPException } from 'hono/http-exception'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { codeForStatus, requestIdSchema, statusIsRetryable, type ApiError, type ErrorCodeOrDomain } from '@acorn/protocol/errors.ts'
import { parseTraceparent } from '@acorn/protocol/telemetry.ts'
import { emitError, emitSpan, newSpanId, newTraceId, runWithTelemetry, telemetryEnabled, PERF } from './telemetry/collector'
import { createLogger, perfLine } from './telemetry/logger'
import type { AppEnv } from './middleware/auth'

// Assign or echo the request id, before anything else in createApp(). A caller-supplied
// X-Request-Id is honoured only when it matches the grammar (so a hostile header cannot inject into
// logs or response headers); otherwise we mint one. Echoed in the header and every error envelope,
// which is what makes a user-reported failure findable in the server log.
//
// It is also where a request becomes a span. Here rather than in a middleware of its own because
// this is the outermost one and the id is minted here: a duration nobody can tie back to a request
// correlates with nothing. The span's name is `http.request` for every route, and the matched route
// pattern rides as an attribute, so a hundred task ids read as one row rather than a hundred
// (docs/telemetry.md § The admission rule for a span).
//
// The owner comes from the path and never from a header. `/v2/p/<id>` is a plugin's namespace, so a
// request under one is that plugin's; anything else is core's. Reading it from the path is what lets
// a plugin route that 404s before it matches still be attributed, and a header would be attacker
// input.
//
// The response size rides along because the desktop's helper wire base64-encodes every body, and
// `apps/desktop/src/shell/wire.ts` puts the ceiling on that at tens of megabytes. Nothing could say
// whether a real body ever reaches it, because nothing measured a body. `-1` means the response is a
// stream and did not declare a length, which is what terminal output and file downloads look like.
export const requestIdMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const provided = c.req.header('x-request-id')
  const requestId = provided && requestIdSchema.safeParse(provided).success ? provided : randomUUID()
  c.set('requestId', requestId)
  c.header('x-request-id', requestId)
  if (!PERF && !telemetryEnabled()) return await next()
  // A caller that already has a trace open says so; anything malformed starts a fresh one. The raw
  // header is never echoed anywhere.
  const parent = parseTraceparent(c.req.header('traceparent'))
  const traceId = parent?.traceId ?? newTraceId()
  const spanId = newSpanId()
  c.set('trace', { traceId, spanId })
  const owner = ownerForPath(c.req.path)
  const started = Date.now()
  const hrStart = process.hrtime.bigint()
  try {
    // The whole request runs inside the ambient context, so a git spawn or a SQL statement anywhere
    // under this handler reports the trace and the owner without the frames in between passing
    // either one (telemetry/context.ts, docs/telemetry.md § Ambient attribution).
    await runWithTelemetry({ traceId, spanId, owner }, next)
  } finally {
    const ms = Number(process.hrtime.bigint() - hrStart) / 1e6
    const bytes = c.res.headers.get('content-length') ?? '-1'
    // `routePath` is only reliable in `finally`, once Hono has matched.
    const route = c.req.routePath || c.req.path
    perfLine(`[perf:request] ${c.req.method} ${route} ${c.res.status} ${ms.toFixed(1)}ms ${bytes}B ${requestId}`)
    emitSpan(owner, {
      traceId,
      spanId,
      ...(parent ? { parentSpanId: parent.parentSpanId } : {}),
      name: 'http.request',
      start: started,
      durationMs: ms,
      status: c.res.status >= 500 ? 'error' : 'ok',
      attrs: {
        seam: 'http.request',
        method: c.req.method,
        route,
        status: c.res.status,
        bytes: Number(bytes),
        'request.id': requestId,
      },
    })
  }
})

/** `core`, or the plugin whose namespace this path is in. Ids are `[a-z0-9-]`-shaped by the manifest
 *  parser, and anything else here is a request for a plugin that does not exist, so it reads as
 *  core's own 404 rather than minting an owner out of the URL. */
function ownerForPath(path: string): string {
  const match = /^\/v2\/p\/([a-z0-9][a-z0-9-]{0,63})(?:\/|$)/.exec(path)
  return match ? match[1] : 'core'
}

// Absent only when a test builds a bare Context without the middleware; real requests always carry
// one. Not minted here: an id that never reached a response header or a log line
// would correlate with nothing, so saying so is more honest than inventing one.
const requestIdOf = (c: Context<AppEnv>): string => c.get('requestId') ?? 'unknown'

const log = createLogger('server')

// The single error-construction path. Every error body is built here, so it always conforms to
// ApiError (docs/api-reference.md: the error envelope shape). One shape, no per-route idiom.
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
// envelope, or clients parsing it hit Hono's default text/plain 500. That is the second error shape
// this module exists to eliminate. HTTPExceptions (e.g. csrf's 403) keep their own response, exactly
// as Hono's default handler would.
export const onServerError = (err: Error, c: Context<AppEnv>) => {
  if (err instanceof HTTPException) return err.getResponse()
  const value = err as Error & { code?: unknown }
  // Drizzle/better-sqlite3 can embed bound values in err.message. Neither the browser nor logs get
  // the message/stack at this generic backstop; domain paths that intentionally expose safe detail
  // must do so before throwing. Name + a short machine code retain useful classification, and the
  // requestId is what ties this log line to the envelope the user saw.
  //
  // The error record carries exactly what the log line carries and no more. A boundary that already
  // withholds a message keeps withholding it once there is somewhere to send it to
  // (docs/telemetry.md § What never leaves the machine).
  const code = typeof value.code === 'string' && /^[A-Z0-9_:-]{1,80}$/i.test(value.code) ? value.code : undefined
  log.error('unhandled error', {
    name: err.name,
    ...(code ? { code } : {}),
    method: c.req.method,
    path: c.req.path,
    requestId: requestIdOf(c),
  })
  const trace = c.get('trace')
  emitError(ownerForPath(c.req.path), {
    name: err.name,
    message: '',
    handled: true,
    attrs: {
      seam: 'http.request',
      'error.name': err.name,
      ...(code ? { 'error.code': code } : {}),
      method: c.req.method,
      'request.id': requestIdOf(c),
    },
    ...(trace ? { traceId: trace.traceId, spanId: trace.spanId } : {}),
  })
  return respondError(c, 500, 'internal')
}
