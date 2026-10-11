import { z } from 'zod'
import { BridgeError, requireDevice, type CompiledCoreServices, type NodePlugin } from '@acorn/plugin-api/node'
import { gitRouter } from './router'
import { conflictDetail, resolveConflict } from '../conflicts'

const resolve = z
  .object({
    expectedPath: z.string().min(1),
    path: z.string().min(1),
    fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    resolution: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('text'), text: z.string() }).strict(),
      z.object({ kind: z.literal('delete') }).strict(),
    ]),
  })
  .strict()

export function conflictRoutes(
  core: Pick<CompiledCoreServices, 'git' | 'projects' | 'tasks' | 'fs' | 'checkoutAdmission'>,
  events: Pick<Parameters<NonNullable<NodePlugin['init']>>[0]['events'], 'worktreeStatus'>,
) {
  return gitRouter()
    .use('/tasks/:taskId/conflict', requireDevice)
    .get('/tasks/:taskId/conflict', async (c) => {
      const path = c.req.query('path')
      if (!path) throw new BridgeError(400, 'bad_request', 'A conflicted path is required.')
      return c.json(await conflictDetail(core, c.req.param('taskId'), path, c.req.raw.signal))
    })
    .post('/tasks/:taskId/conflict', async (c) => {
      const parsed = resolve.safeParse(await c.req.json().catch(() => null))
      if (!parsed.success) throw new BridgeError(400, 'bad_request', 'Invalid conflict resolution request.')
      // A refusal can follow a save, so Changes and Editor refresh after every attempt.
      try {
        return c.json(await resolveConflict(core, c.req.param('taskId'), parsed.data))
      } finally {
        events.worktreeStatus(c.req.param('taskId'))
      }
    })
}
