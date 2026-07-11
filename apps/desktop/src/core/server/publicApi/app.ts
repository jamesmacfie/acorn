import { Hono } from 'hono'
import type { Context } from 'hono'
import { PublicApiError } from '../../shared/publicApi/errors'
import { IdempotencyKeySchema } from '../../shared/publicApi/primitives'
import { bearerAuth, hostGuard, requestIdMiddleware } from './auth'
import type { PublicAppEnv } from './context'
import { NO_CONTENT, type AnyEndpoint, type EventPublisher, type PublicOperationContext } from './defineEndpoint'
import { IdempotencyStore, requestHash } from './idempotency'
import { generateOpenApi } from './openapi'
import type { RegistrySnapshot } from './registry'
import { dataResponse, errorResponse, noContentResponse, toPublicApiError } from './respond'
import type { TokenService } from './tokenService'
import { validateRequest, validateResponse } from './validate'

// createAutomationApp — the public /api/v1 Hono app (docs/public-api.md). It has no
// static files, OAuth, cookies, SPA fallback, or internal-token access: bearer → scope → validated
// route table → standard error backstop. The registry snapshot is already frozen.

const noopPublisher: EventPublisher = { publish: () => {} }

export type AutomationAppDeps = {
  snapshot: RegistrySnapshot
  tokens: TokenService
  idempotency: IdempotencyStore
  allowedHost: string
  publisher?: EventPublisher
  version?: string
}

const V1 = '/api/v1'

function fullPath(endpoint: AnyEndpoint): string {
  const rel = endpoint.pluginId === 'core' ? endpoint.path : `/plugins/${endpoint.pluginId}${endpoint.path}`
  return `${V1}${rel}`
}

function insufficientScope(): PublicApiError {
  return new PublicApiError('insufficient_scope', 'This operation requires the write scope', {
    headers: { 'WWW-Authenticate': 'Bearer realm="acorn", error="insufficient_scope", scope="write"' },
  })
}

function dispatch(endpoint: AnyEndpoint, deps: AutomationAppDeps) {
  return async (c: Context<PublicAppEnv>): Promise<Response> => {
    const principal = c.get('principal')
    const canWrite = (principal.scopes as readonly string[]).includes('write')
    if (endpoint.scope === 'write' && !canWrite) throw insufficientScope()

    // Idempotency (protocol.md §7). 'required' demands the header; 'optional' honors it if present.
    const supportsIdem = endpoint.idempotency === 'required' || endpoint.idempotency === 'optional'
    const rawKey = c.req.header('idempotency-key')
    if (endpoint.idempotency === 'required' && !rawKey) {
      throw new PublicApiError('bad_request', 'This operation requires an Idempotency-Key header')
    }
    let idemKey: string | undefined
    let hash = ''
    if (supportsIdem && rawKey) {
      const parsed = IdempotencyKeySchema.safeParse(rawKey)
      if (!parsed.success) throw new PublicApiError('bad_request', 'Invalid Idempotency-Key')
      idemKey = parsed.data
      const body = await c.req.text()
      hash = requestHash(endpoint.method, new URL(c.req.url).pathname, body)
      const existing = await deps.idempotency.lookup(principal.tokenId, endpoint.operationId, idemKey)
      if (existing) {
        if (existing.requestHash !== hash) {
          throw new PublicApiError('idempotency_conflict', 'Idempotency-Key was reused with a different request')
        }
        return c.body(existing.responseBody, existing.responseStatus as 200, { 'content-type': 'application/json' })
      }
    }

    const input = await validateRequest(c, endpoint)
    const ctx: PublicOperationContext = {
      actor: {
        principalId: principal.userId,
        principalKind: 'api-token',
        tokenId: principal.tokenId,
        scopes: principal.scopes,
      },
      principal,
      signal: c.req.raw.signal,
      requestId: c.get('requestId'),
      publish: deps.publisher ?? noopPublisher,
      idempotencyKey: idemKey,
    }

    const result = await endpoint.handler(ctx, input)

    let response: Response
    if (result === NO_CONTENT || endpoint.status === 204) {
      response = noContentResponse(c)
    } else {
      const validated = validateResponse(endpoint, result)
      const status = (endpoint.status ?? 200) as 200 | 201 | 202
      const headers: Record<string, string> = {}
      if (status === 201 && validated && typeof validated === 'object' && 'id' in validated) {
        headers.Location = `${fullPath(endpoint)}/${(validated as { id: string }).id}`
      }
      response = dataResponse(c, validated, { status, headers })
    }

    // Persist the response for replay (non-5xx only).
    if (idemKey && response.status < 500) {
      const body = await response.clone().text()
      await deps.idempotency.save(principal.tokenId, endpoint.operationId, idemKey, hash, response.status, body)
    }
    return response
  }
}

export function createAutomationApp(deps: AutomationAppDeps): Hono<PublicAppEnv> {
  const app = new Hono<PublicAppEnv>()

  app.use('*', requestIdMiddleware)
  app.use('*', hostGuard(deps.allowedHost))
  app.use(`${V1}/*`, bearerAuth(deps.tokens))

  // OpenAPI is served raw (tools expect the bare document, not the data envelope). Still bearer-gated.
  app.get(`${V1}/openapi.json`, (c) => c.json(generateOpenApi(deps.snapshot, deps.version)))

  for (const endpoint of deps.snapshot.endpoints) {
    app.on(endpoint.method, fullPath(endpoint), dispatch(endpoint, deps))
  }

  app.notFound((c) => errorResponse(c, new PublicApiError('endpoint_not_found', 'No such endpoint')))
  app.onError((err, c) => errorResponse(c, toPublicApiError(err)))
  return app
}

export { IdempotencyStore }
