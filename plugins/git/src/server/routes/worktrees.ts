import { Hono } from 'hono'
import type { CoreServices, AppEnv } from '@acorn/plugin-api/node'
import { requireDevice, respondError } from '@acorn/plugin-api/node'
import { inventory } from '../worktreeRoster'
import { cleanup } from '../cleanup'

export function worktreeRoutes(core: Pick<CoreServices, 'git' | 'projects' | 'tasks'>) {
  return new Hono<AppEnv>()
    .use('/projects/:projectId/worktrees', requireDevice)
    .use('/projects/:projectId/worktrees/*', requireDevice)
    .get('/projects/:projectId/worktrees', async (c) => c.json(await inventory(core, c.req.param('projectId'))))
    .post('/projects/:projectId/worktrees/:observation/remove', async (c) => {
      const observation = c.req.param('observation')
      if (!/^[0-9a-f]{64}$/.test(observation)) return respondError(c, 400, 'bad_request')
      return c.json(await cleanup(core, c.req.param('projectId'), observation))
    })
}
