import { z } from 'zod'
import { BridgeError, requireDevice, type CompiledCoreServices } from '@acorn/plugin-api/node'
import { gitRouter } from './router'
import { changeRef, refRoster } from '../refs'

const id = z.string().regex(/^[0-9a-f]{40,64}$/)
const name = z.string().min(1).max(240)
const request = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create-branch'), name, startId: id }).strict(),
  z.object({ action: z.literal('rename-branch'), name, expectedId: id, nextName: name }).strict(),
  z.object({ action: z.literal('delete-branch'), name, expectedId: id }).strict(),
  z.object({ action: z.literal('set-upstream'), name, expectedId: id, upstream: name.nullable() }).strict(),
  z.object({ action: z.literal('create-tag'), name, startId: id, message: z.string().min(1).max(8192).nullable() }).strict(),
  z.object({ action: z.literal('delete-tag'), name, expectedId: id }).strict(),
])

export function refRoutes(core: Pick<CompiledCoreServices, 'git' | 'projects' | 'tasks' | 'repositoryMetadata'>, changed: () => void = () => {}) {
  return gitRouter()
    .use('/projects/:projectId/refs', requireDevice)
    .get('/projects/:projectId/refs', async (c) => c.json(await refRoster(core, c.req.param('projectId'))))
    .post('/projects/:projectId/refs', async (c) => {
      const parsed = request.safeParse(await c.req.json().catch(() => null))
      if (!parsed.success) throw new BridgeError(400, 'bad_request', 'Invalid ref action.')
      return c.json(await changeRef(core, c.req.param('projectId'), parsed.data, changed))
    })
}
