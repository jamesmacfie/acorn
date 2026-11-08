import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { BridgeError, requireDevice, respondError, type AppEnv } from '@acorn/plugin-api/node'
import { cloneLaunchState, cloneLaunchWorkflows, startCloneLaunch, type CloneLaunchDeps } from '../runs/cloneLaunch'
import { boundedValues } from './workflow'

// Clone a URL, then run a workflow on it (docs/workflows/starting-runs.md § After a clone). Device
// only, like core's clone routes: an agent with a task token must not fetch code onto the Node.

const startBody = z
  .object({
    clone: z
      .object({
        url: z.string().min(1).max(2048),
        parentDir: z.string().min(1).max(4096),
        name: z.string().min(1).max(255).optional(),
        workspaceId: z.string().min(1).max(256).optional(),
      })
      .strict(),
    defId: z.string().min(1).max(256),
    inputs: boundedValues.optional(),
    launchId: z.uuid(),
  })
  .strict()

const answer = async (c: Context<AppEnv>, work: () => Promise<unknown>, status: 200 | 202 = 200): Promise<Response> => {
  try {
    return c.json(await work(), status)
  } catch (error) {
    if (error instanceof BridgeError) return respondError(c, error.status, error.code, [error.message])
    throw error
  }
}

export const cloneLaunchRoutes = (deps: CloneLaunchDeps) =>
  new Hono<AppEnv>()
    .use(requireDevice)
    // The workflows the clone form may offer. Declared before `/:launchId`, or the parameter takes it.
    .get('/workflows', (c) =>
      answer(c, async () => ({ workflows: await cloneLaunchWorkflows(deps, c.req.query('workspaceId') || undefined) })),
    )
    .post('/', async (c) => {
      const parsed = startBody.safeParse(await c.req.json().catch(() => null))
      if (!parsed.success) return respondError(c, 400, 'bad_request')
      return answer(c, () => startCloneLaunch(deps, parsed.data), 202)
    })
    .get('/:launchId', async (c) => {
      const waitMs = Number(c.req.query('waitMs') ?? 0)
      const state = await cloneLaunchState(c.req.param('launchId'), Number.isFinite(waitMs) ? waitMs : 0)
      return state ? c.json(state) : respondError(c, 404, 'not_found')
    })
