import { Hono } from 'hono'
import { z } from 'zod'
import type { ConnectIntegrationRequest, IntegrationProjectsResponse, IntegrationsResponse, RotateIntegrationRequest } from '@acorn/protocol/api.ts'
import { auditRequest } from '../auditRequest'
import { getDb } from '../db'
import {
  connectProvider,
  connectionSummary,
  credentialsFromBody,
  disconnectConnection,
  listConnections,
  rotateConnection,
  setConnectionDisabled,
  testConnection,
} from '../integrations/connections'
import { connectionProviderRegistry } from '../integrations/connectionRegistry'
import { listConnectionProjects } from '../integrations/projectSource'
import { providerError } from '../integrations/respondProvider'
import type { AppEnv } from '../middleware/auth'
import { ownerId } from '../middleware/requireUser'
import { respondError } from '../respond'

// Zod at the mutation boundary (docs/architecture-overview.md § Wire validation).
const setDisabledBody = z.object({ disabled: z.boolean() })
const connectBody = z.looseObject({ providerId: z.string().optional(), provider: z.string().optional() })

// Core-owned provider connection lifecycle. Provider descriptors validate and normalize credentials;
// this route alone encrypts, stores, rotates, tests, disables, and disconnects connection rows.
export const integrations = new Hono<AppEnv>()
  .get('/', async (c) => {
    const uid = ownerId(c)
    const rows = await listConnections(getDb(c.env), uid)
    return c.json({
      providers: connectionProviderRegistry.list().map((provider) => provider.toPublic()),
      integrations: rows.map(connectionSummary),
    } satisfies IntegrationsResponse)
  })
  .post('/', async (c) => {
    // `provider` is the legacy field name for `providerId`, still accepted on the wire. Zod's union
    // keeps the leniency explicit and typed rather than buried in a nested ternary.
    const parsed = connectBody.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return respondError(c, 400, 'provider_bad_config')
    const body = parsed.data
    const providerId = body.providerId ?? body.provider ?? ''
    if (!providerId) return respondError(c, 400, 'provider_bad_config')
    const request: ConnectIntegrationRequest = { providerId, credentials: credentialsFromBody(body) }
    try {
      const integration = await connectProvider(getDb(c.env), ownerId(c), request, c.env.SECRETS)
      // Audited HERE rather than inside connections.ts, for two reasons: the actor only exists on a
      // request, and it is the route — not the storage helper — that decides an action succeeded. The
      // provider and the label go in; the credential never does.
      auditRequest(c, {
        action: 'secret.created',
        subject: integration.id,
        details: { provider: providerId, label: integration.label },
      })
      return c.json({ integration })
    } catch (error) {
      return providerError(c, error)
    }
  })
  .put('/:id', async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const request: RotateIntegrationRequest = { credentials: credentialsFromBody(body) }
    try {
      const integration = await rotateConnection(getDb(c.env), ownerId(c), c.req.param('id'), request, c.env.SECRETS)
      auditRequest(c, {
        action: 'secret.replaced',
        subject: integration.id,
        details: { provider: integration.providerId },
      })
      return c.json({ integration })
    } catch (error) {
      return providerError(c, error)
    }
  })
  // What this connection offers to be mapped to a workspace. A core route, because the mapping it
  // feeds (`workspace_external_projects`) is core's table and the picker that reads it is core's
  // surface — asking each provider's own `/v2/p/<id>/...` namespace by convention would put the host
  // in the position of guessing at a path a plugin defines.
  //
  // Nothing is cached: see integrations/projectSource.ts for why a picker must not serve a stale list.
  .get('/:id/projects', async (c) => {
    const result = await listConnectionProjects({
      db: getDb(c.env),
      userId: ownerId(c),
      secrets: c.env.SECRETS,
      connectionId: c.req.param('id'),
    })
    if (!result.ok) return respondError(c, result.failure.status, result.failure.error, result.failure.detail)
    return c.json({ projects: result.value } satisfies IntegrationProjectsResponse)
  })
  .post('/:id/test', async (c) => {
    try {
      const integration = await testConnection(getDb(c.env), ownerId(c), c.req.param('id'), c.env.SECRETS)
      return c.json({ integration })
    } catch (error) {
      return providerError(c, error)
    }
  })
  .patch('/:id', async (c) => {
    // Zod at the mutation boundary (docs/architecture-overview.md § Wire validation).
    const parsed = setDisabledBody.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return respondError(c, 400, 'provider_bad_config')
    const body = parsed.data
    try {
      const integration = await setConnectionDisabled(getDb(c.env), ownerId(c), c.req.param('id'), body.disabled)
      return c.json({ integration })
    } catch (error) {
      return providerError(c, error)
    }
  })
  .delete('/:id', async (c) => {
    try {
      await disconnectConnection(getDb(c.env), ownerId(c), c.req.param('id'))
      // The row is gone by now, and the audit row is what is left of it — which is exactly why the
      // subject is an opaque id rather than a foreign key.
      auditRequest(c, { action: 'secret.deleted', subject: c.req.param('id') })
      return c.body(null, 204)
    } catch (error) {
      return providerError(c, error)
    }
  })
