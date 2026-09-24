import { Hono } from 'hono'
import { z } from 'zod'
import { type AppEnv, requireDevice, respondError, routeCapability, setRouteTestCapability, viaBridge } from '@acorn/plugin-api/node'

// Memory's route surface. Notes owns its own routes.

export type KnowledgeBridge = {
  memoryList(projectId?: string): Promise<unknown>
  memorySearch(query: string, projectId?: string, type?: string): Promise<unknown>
  memoryAdd(taskId: string, p: { scope: 'project' | 'private'; name: string; description: string; type: string; body: string }): Promise<unknown>
  memoryApproveFinding?(id: string, input: { revision: number; payloadHash: string; idempotencyKey: string; deviceId: string }): Promise<unknown>
}

export const KNOWLEDGE = routeCapability<KnowledgeBridge>('memory.knowledgeRoute')
/** @internal test compatibility; production providers use CapabilityRegistry.provide. */
export const setKnowledgeBridge = (bridge: KnowledgeBridge | null): void => setRouteTestCapability(KNOWLEDGE, bridge)

// Everything that writes a memory file gets a validated body.
const addBody = z.object({ scope: z.enum(['project', 'private']), name: z.string(), description: z.string(), type: z.string(), body: z.string() })
const approveFindingBody = z.strictObject({ revision: z.number().int().min(1), payloadHash: z.string().min(1), idempotencyKey: z.string().min(1).max(300) })

export const knowledge = new Hono<AppEnv>()
  .get('/memory', (c) => viaBridge(c, KNOWLEDGE, (b) => b.memoryList(c.req.query('projectId') ?? undefined)))
  .get('/memory/search', (c) => {
    const q = c.req.query('q')
    if (!q) return respondError(c, 400, 'bad_request')
    return viaBridge(c, KNOWLEDGE, (b) => b.memorySearch(q, c.req.query('projectId') ?? undefined, c.req.query('type') ?? undefined))
  })
  .post('/memory/findings/:id/approve', requireDevice, async (c) => {
    const parsed = approveFindingBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, KNOWLEDGE, (bridge) => bridge.memoryApproveFinding ? bridge.memoryApproveFinding(c.req.param('id'), { ...parsed.data, deviceId: c.get('principal')!.deviceId! }) : Promise.resolve({ ok: false, reason: 'Findings review is unavailable.' }))
  })
  .post('/tasks/:id/memory', async (c) => {
    const p = addBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, KNOWLEDGE, (b) => b.memoryAdd(c.req.param('id'), p.data))
  })
