import { Hono } from 'hono'
import type { ConnectIntegrationRequest, IntegrationsResponse, RotateIntegrationRequest } from '@acorn/protocol/api.ts'
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
      const integration = await connectProvider(getDb(c.env), ownerId(c), request, c.env.SESSION_ENC_KEY)
      return c.json({ integration })
    } catch (error) {
      return providerError(c, error)
    }
  })
  .put('/:id', async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const request: RotateIntegrationRequest = { credentials: credentialsFromBody(body) }
    try {
      const integration = await rotateConnection(getDb(c.env), ownerId(c), c.req.param('id'), request, c.env.SESSION_ENC_KEY)
      return c.json({ integration })
    } catch (error) {
      return providerError(c, error)
    }
  })
  .post('/:id/test', async (c) => {
    try {
      const integration = await testConnection(getDb(c.env), ownerId(c), c.req.param('id'), c.env.SESSION_ENC_KEY)
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
      return c.body(null, 204)
    } catch (error) {
      return providerError(c, error)
    }
  })
