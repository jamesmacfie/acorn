import { z } from 'zod'
import { BridgeError, requireDevice, type CoreServices } from '@acorn/plugin-api/node'
import { gitRouter } from './router'
import { pinComparison } from '../comparison'

const request = z
  .object({
    source: z.string().min(1).max(256),
    destination: z.string().min(1).max(256),
    mode: z.enum(['direct', 'merge-base']),
  })
  .strict()
export function comparisonRoutes(core: Pick<CoreServices, 'git' | 'projects' | 'tasks'>) {
  return gitRouter()
    .use('/projects/:projectId/comparison', requireDevice)
    .post('/projects/:projectId/comparison', async (c) => {
      const parsed = request.safeParse(await c.req.json().catch(() => null))
      if (!parsed.success) throw new BridgeError(400, 'bad_request', 'Invalid comparison selection.')
      return c.json(
        await pinComparison(
          core,
          c.req.param('projectId'),
          parsed.data.source,
          parsed.data.destination,
          parsed.data.mode,
        ),
      )
    })
}
