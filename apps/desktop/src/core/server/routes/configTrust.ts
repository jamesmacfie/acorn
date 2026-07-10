import { Hono } from 'hono'
import { z } from 'zod'
import type { RepoConfigTrustReview } from '../../shared/api'
import { bridgeSlot, viaBridge } from '../bridge'
import type { AppEnv } from '../middleware/auth'
import { respondError } from '../respond'

export type ConfigTrustBridge = {
  review(taskId: string): Promise<RepoConfigTrustReview>
  acknowledge(taskId: string, hash: string): Promise<RepoConfigTrustReview>
}

export const configTrustBridgeSlot = bridgeSlot<ConfigTrustBridge>()
export const setConfigTrustBridge = configTrustBridgeSlot.set

const ackBody = z.object({ hash: z.string().regex(/^[a-f0-9]{64}$/) })

export const configTrust = new Hono<AppEnv>()
  .get('/:id/config-trust', (c) => viaBridge(c, configTrustBridgeSlot, (bridge) => bridge.review(c.req.param('id'))))
  .post('/:id/config-trust', async (c) => {
    const parsed = ackBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, configTrustBridgeSlot, (bridge) => bridge.acknowledge(c.req.param('id'), parsed.data.hash))
  })
