import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { type AppEnv, BridgeError, requireDevice, respondError, routeCapability, setRouteTestCapability, viaBridge } from '@acorn/plugin-api/node'

import type { LibraryRequest } from '../library'

// Memory's route surface. Notes owns its own routes.

export type KnowledgeBridge = {
  taskMemoryScope(taskId: string): Promise<{ projectId: string | null } | null>
  memoryList(projectId?: string): Promise<unknown>
  memorySearch(query: string, projectId?: string, type?: string): Promise<unknown>
  memoryAdd(taskId: string, p: { scope: 'project' | 'private'; name: string; description: string; type: string; body: string }): Promise<unknown>
  memoryProjectAdd?(projectId: string, p: { scope: 'project' | 'private'; name: string; description: string; type: string; body: string }): Promise<unknown>
  memoryUndo?(changeId: string): Promise<unknown>
  memoryLibrary?(action: string, projectId: string | undefined, request: LibraryRequest): Promise<unknown>
}

export const KNOWLEDGE = routeCapability<KnowledgeBridge>('memory.knowledgeRoute')
/** @internal test compatibility; production providers use CapabilityRegistry.provide. */
export const setKnowledgeBridge = (bridge: KnowledgeBridge | null): void => setRouteTestCapability(KNOWLEDGE, bridge)

// Everything that writes a memory file gets a validated body.
const addBody = z.object({ scope: z.enum(['project', 'private']), name: z.string(), description: z.string(), type: z.string(), body: z.string() })

const libraryBody = z.object({
  address: z.object({ scope: z.enum(['private', 'project']), projectId: z.string().nullable(), name: z.string() }).optional(),
  input: z.object({ name: z.string(), description: z.string(), type: z.enum(['user', 'feedback', 'project', 'reference']), body: z.string(), hash: z.string() }).optional(),
  scope: z.enum(['private', 'project']).optional(), hash: z.string().optional(), version: z.string().optional(),
  caps: z.object({ private: z.number().int().min(200).max(32000), project: z.number().int().min(200).max(32000) }).optional(),
  sourceId: z.enum(['claude', 'checkout']).optional(),
  files: z.array(z.object({ name: z.string(), sourceHash: z.string(), destinationHash: z.string().nullable(), overwrite: z.boolean() })).max(1000).optional(),
})

// A project query must stay inside the signed task's project. Omitted scope reads only the shared
// private library, but still requires an existing task. Resolve before reading files.
async function mayReadMemory(c: Context<AppEnv>, bridge: KnowledgeBridge, projectId: string | undefined): Promise<boolean> {
  const principal = c.get('principal')
  if (!principal) return false
  if (principal.kind === 'device' || principal.scope === 'service') return true
  if (!principal.taskId) return false
  try {
    const scope = await bridge.taskMemoryScope(principal.taskId)
    return !!scope && (projectId === undefined || projectId === scope.projectId)
  } catch {
    // Missing state and failed scope resolution return the same denial without internal detail.
  }
  return false
}

async function readMemory(c: Context<AppEnv>, read: (bridge: KnowledgeBridge, projectId: string | undefined) => Promise<unknown>): Promise<Response> {
  const projectId = c.req.query('projectId') ?? undefined
  if (!c.get('principal')) return respondError(c, 401, 'unauthenticated')
  return viaBridge(c, KNOWLEDGE, async (bridge) => {
    if (!await mayReadMemory(c, bridge, projectId)) throw new BridgeError(404, 'not_found')
    return read(bridge, projectId)
  })
}

export const knowledge = new Hono<AppEnv>()
  .post('/library/:action', requireDevice, async (c) => {
    const parsed = libraryBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, KNOWLEDGE, (bridge) => {
      if (!bridge.memoryLibrary) throw new BridgeError(404, 'not_found')
      return bridge.memoryLibrary(c.req.param('action'), c.req.query('projectId'), parsed.data)
    })
  })
  .get('/memory', (c) => readMemory(c, (b, projectId) => b.memoryList(projectId)))
  .get('/memory/search', (c) => {
    const q = c.req.query('q')
    if (!q) return respondError(c, 400, 'bad_request')
    return readMemory(c, (b, projectId) => b.memorySearch(q, projectId, c.req.query('type') ?? undefined))
  })
  .post('/memory/changes/:id/undo', requireDevice, (c) => viaBridge(c, KNOWLEDGE, (bridge) => {
    if (!bridge.memoryUndo) throw new BridgeError(404, 'not_found')
    return bridge.memoryUndo(c.req.param('id'))
  }))
  .post('/projects/:id/memory', requireDevice, async (c) => {
    const parsed = addBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, KNOWLEDGE, (bridge) => {
      if (!bridge.memoryProjectAdd) throw new BridgeError(404, 'not_found')
      return bridge.memoryProjectAdd(c.req.param('id'), parsed.data)
    })
  })
  .post('/tasks/:id/memory', requireDevice, async (c) => {
    const p = addBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, KNOWLEDGE, (b) => b.memoryAdd(c.req.param('id'), p.data))
  })
