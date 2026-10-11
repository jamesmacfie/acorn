import { z } from 'zod'
import {
  BridgeError,
  isProviderOperationError,
  ownerId,
  requireDevice,
  respondError,
  type CoreServices,
} from '@acorn/plugin-api/node'
import { gitRouter } from './router'
import { explain } from '../explain'

const id = /^[0-9a-f]{40,64}$/
const body = z
  .object({
    backendId: z.string().min(1).max(256),
    modelId: z.string().max(256),
    base: z.string().regex(id).nullable(),
  })
  .strict()

export function explanationRoutes(core: Pick<CoreServices, 'git' | 'projects' | 'models'>) {
  return gitRouter()
    .use('/projects/:projectId/explanations/*', requireDevice)
    .post('/projects/:projectId/explanations/:kind/:id', async (c) => {
      const kind = c.req.param('kind')
      const objectId = c.req.param('id')
      const parsed = body.safeParse(await c.req.json().catch(() => null))
      if ((kind !== 'commit' && kind !== 'stash') || !id.test(objectId) || !parsed.success)
        throw new BridgeError(400, 'bad_request', 'Invalid explanation request.')
      try {
        return c.json(
          await explain(core, ownerId(c), c.req.param('projectId'), kind, objectId, parsed.data, c.req.raw.signal),
        )
      } catch (error) {
        if (isProviderOperationError(error)) return respondError(c, error.status, error.code)
        throw error
      }
    })
}
