import { Hono } from 'hono'
import type { ConnectIntegrationRequest, IntegrationsResponse, RotateIntegrationRequest } from '@acorn/protocol/api.ts'
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
import { providerError } from '../integrations/respondProvider'
import type { AppEnv } from '../middleware/auth'
import { ownerId } from '../middleware/requireUser'
import { respondError } from '../respond'

// Core-owned provider connection lifecycle. Provider descriptors validate and normalize credentials;
// this route alone encrypts, stores, rotates, tests, disables, and disconnects connection rows.
export const integrations = new Hono<AppEnv>()
  .get('/', async (c) => {
    const uid = ownerId(c)
    const rows = await listConnections(getDb(c.env), uid)
    return c.json({
      providers: connectionProviderRegistry.list().map((provider) => provider.toPublic()),
      // GitHub is an ordinary stored connection now. It used to be synthesized here because its
      // token WAS the session cookie and there was no row to list; leaving the synthesizer in place
      // alongside the real row would list GitHub twice.
      integrations: rows.map(connectionSummary),
    } satisfies IntegrationsResponse)
  })
  .post('/', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
    const providerId = typeof body.providerId === 'string' ? body.providerId : typeof body.provider === 'string' ? body.provider : ''
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
  .post('/:id/test', async (c) => {
    try {
      const integration = await testConnection(getDb(c.env), ownerId(c), c.req.param('id'), c.env.SECRETS)
      return c.json({ integration })
    } catch (error) {
      return providerError(c, error)
    }
  })
  .patch('/:id', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { disabled?: boolean }
    if (typeof body.disabled !== 'boolean') return respondError(c, 400, 'provider_bad_config')
    try {
      const integration = await setConnectionDisabled(getDb(c.env), ownerId(c), c.req.param('id'), body.disabled)
      return c.json({ integration })
    } catch (error) {
      return providerError(c, error)
    }
  })
  .delete('/:id', async (c) => {
    if (c.req.param('id') === 'github') return respondError(c, 400, 'provider_bad_config')
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
