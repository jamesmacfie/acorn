import { z } from 'zod'
import { BridgeError, requireDevice } from '@acorn/plugin-api/node'
import { gitRouter } from './router'
import { RemoteService } from '../remotes'

const name = z.string().min(1).max(80)
const url = z.string().min(1).max(2048)
const request = z.discriminatedUnion('action', [
  z.object({ action: z.literal('add'), name, url }).strict(),
  z.object({ action: z.literal('remove'), name, expectedUrl: url }).strict(),
  z.object({ action: z.literal('set-url'), name, expectedUrl: url, url }).strict(),
  z.object({ action: z.literal('fetch'), name, expectedUrl: url }).strict(),
])

export function remoteRoutes(service: RemoteService) {
  return gitRouter()
    .use('/projects/:projectId/remotes', requireDevice)
    .get('/projects/:projectId/remotes', async (c) => c.json(await service.roster(c.req.param('projectId'), c.req.raw.signal)))
    .post('/projects/:projectId/remotes', async (c) => {
      const parsed = request.safeParse(await c.req.json().catch(() => null))
      if (!parsed.success) throw new BridgeError(400, 'bad_request', 'Invalid remote action.')
      return c.json(await service.change(c.req.param('projectId'), parsed.data, c.req.raw.signal))
    })
}
