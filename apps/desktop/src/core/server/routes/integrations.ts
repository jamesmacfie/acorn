import { Hono } from 'hono'
import type { ConnectIntegrationRequest, IntegrationsResponse, RotateIntegrationRequest } from '../../shared/api'
import { getDb } from '../db'
import {
  connectProvider,
  connectionSummary,
  credentialsFromBody,
  disconnectConnection,
  githubConnectionSummary,
  listConnections,
  rotateConnection,
  setConnectionDisabled,
  testConnection,
} from '../integrations/connections'
import { connectionProviderRegistry } from '../integrations/connectionRegistry'
import { ProviderOperationError } from '../integrations/types'
import type { AppEnv } from '../middleware/auth'
import { getUser } from '../middleware/requireUser'
import { respondError } from '../respond'

const providerError = (c: Parameters<typeof respondError>[0], error: unknown) => {
  if (error instanceof ProviderOperationError) return respondError(c, error.status, error.code)
  return respondError(c, 502, 'provider_unavailable')
}

// Core-owned provider connection lifecycle. Provider descriptors validate and normalize credentials;
// this route alone encrypts, stores, rotates, tests, disables, and disconnects connection rows.
export const integrations = new Hono<AppEnv>()
  .get('/', async (c) => {
    const user = getUser(c)
    const rows = await listConnections(getDb(c.env), user.login)
    return c.json({
      providers: connectionProviderRegistry.list().map((provider) => provider.toPublic()),
      integrations: [githubConnectionSummary(user.login), ...rows.map(connectionSummary)],
    } satisfies IntegrationsResponse)
  })
  .post('/', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
    const providerId = typeof body.providerId === 'string' ? body.providerId : typeof body.provider === 'string' ? body.provider : ''
    if (!providerId) return respondError(c, 400, 'provider_bad_config')
    const request: ConnectIntegrationRequest = { providerId, credentials: credentialsFromBody(body) }
    try {
      const integration = await connectProvider(getDb(c.env), getUser(c).login, request, c.env.SESSION_ENC_KEY)
      return c.json({ integration })
    } catch (error) {
      return providerError(c, error)
    }
  })
  .put('/:id', async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const request: RotateIntegrationRequest = { credentials: credentialsFromBody(body) }
    try {
      const integration = await rotateConnection(getDb(c.env), getUser(c).login, c.req.param('id'), request, c.env.SESSION_ENC_KEY)
      return c.json({ integration })
    } catch (error) {
      return providerError(c, error)
    }
  })
  .post('/:id/test', async (c) => {
    try {
      const integration = await testConnection(getDb(c.env), getUser(c).login, c.req.param('id'), c.env.SESSION_ENC_KEY)
      return c.json({ integration })
    } catch (error) {
      return providerError(c, error)
    }
  })
  .patch('/:id', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { disabled?: boolean }
    if (typeof body.disabled !== 'boolean') return respondError(c, 400, 'provider_bad_config')
    try {
      const integration = await setConnectionDisabled(getDb(c.env), getUser(c).login, c.req.param('id'), body.disabled)
      return c.json({ integration })
    } catch (error) {
      return providerError(c, error)
    }
  })
  .delete('/:id', async (c) => {
    if (c.req.param('id') === 'github') return respondError(c, 400, 'provider_bad_config')
    try {
      await disconnectConnection(getDb(c.env), getUser(c).login, c.req.param('id'))
      return c.body(null, 204)
    } catch (error) {
      return providerError(c, error)
    }
  })
