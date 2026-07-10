import { Hono } from 'hono'
import type { RollbarItem, RollbarItemsResponse } from '../../../../core/shared/api'
import { getDb } from '../../../../core/server/db'
import { listProviderConnections } from '../../../../core/server/integrations/connections'
import { runProviderResource } from '../../../../core/server/integrations/resourceRuntime'
import type { RollbarResourceInput, RollbarResourceOutput } from '../provider'
import type { AppEnv } from '../../../../core/server/middleware/auth'
import { getUser } from '../../../../core/server/middleware/requireUser'
import { respondError } from '../../../../core/server/respond'

const PROVIDER = 'rollbar'
const RESOURCE = 'rollbar.items'

const respondResult = <T>(
  c: Parameters<typeof respondError>[0],
  result: Awaited<ReturnType<typeof runProviderResource<RollbarResourceInput, T>>>,
) => (result.ok ? c.json(result.value) : respondError(c, result.failure.status, result.failure.error, result.failure.detail))

// Provider-owned HTTP surface. Core mounts this router through the integration-provider registry;
// reads execute the descriptor's mirrored-resource callbacks through the Phase-2 sync runtime.
export const rollbar = new Hono<AppEnv>()
  .get('/items', async (c) => {
    const user = getUser(c)
    const db = getDb(c.env)
    const connections = await listProviderConnections(db, user.login, PROVIDER)
    if (!connections.length) return respondError(c, 403, 'provider_not_connected')

    const items: RollbarItem[] = []
    let hadSuccess = false
    let firstFailure: { status: 401 | 403 | 404 | 429 | 502; error: string; detail?: string[] } | null = null
    for (const connection of connections) {
      const result = await runProviderResource<RollbarResourceInput, RollbarResourceOutput>({
        db,
        userId: user.login,
        encryptionKey: c.env.SESSION_ENC_KEY,
        providerId: PROVIDER,
        connectionId: connection.id,
        resourceId: RESOURCE,
        input: { kind: 'list' },
      })
      if (result.ok) {
        hadSuccess = true
        items.push(...(result.value as RollbarItem[]))
      }
      else firstFailure ??= result.failure
    }
    if (!hadSuccess && firstFailure) return respondError(c, firstFailure.status, firstFailure.error, firstFailure.detail)
    items.sort((a, b) => (b.lastOccurrenceAt ?? 0) - (a.lastOccurrenceAt ?? 0))
    return c.json({ items } satisfies RollbarItemsResponse)
  })
  .get('/items/:identifier', async (c) => {
    const connectionId = c.req.query('integration')
    if (!connectionId) return respondError(c, 400, 'bad_request')
    const user = getUser(c)
    const result = await runProviderResource<RollbarResourceInput, RollbarItem>({
      db: getDb(c.env),
      userId: user.login,
      encryptionKey: c.env.SESSION_ENC_KEY,
      providerId: PROVIDER,
      connectionId,
      resourceId: RESOURCE,
      input: { kind: 'detail', identifier: c.req.param('identifier') },
    })
    return respondResult(c, result)
  })
