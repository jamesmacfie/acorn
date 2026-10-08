import { Hono } from 'hono'
import { z } from 'zod'
import { BridgeError, requireDevice, type AppEnv, type CoreServices, type NodePlugin } from '@acorn/plugin-api/node'
import { applyStash, createStash, dropStash, stashRoster } from '../stashes'

const objectId = z.string().regex(/^[0-9a-f]{40,64}$/)
const selection = z.object({ objectId, selector: z.string().regex(/^stash@\{\d+\}$/), fingerprint: z.string().regex(/^[0-9a-f]{64}$/) }).strict()
const create = z.object({ taskId: z.string().min(1), expectedPath: z.string().min(1), message: z.string().trim().min(1).max(512), includeUntracked: z.boolean(), keepIndex: z.boolean() }).strict()
const apply = z.object({ taskId: z.string().min(1), expectedPath: z.string().min(1), selection, restoreIndex: z.boolean() }).strict()
const drop = z.object({ selection, confirm: z.literal(true) }).strict()
async function body<T extends z.ZodTypeAny>(read: () => Promise<unknown>, schema: T): Promise<z.infer<T>> {
  const parsed = schema.safeParse(await read().catch(() => null))
  if (!parsed.success) throw new BridgeError(400, 'bad_request', 'Invalid stash request.')
  return parsed.data
}
export function stashRoutes(core: Pick<CoreServices, 'git' | 'projects' | 'tasks' | 'checkoutAdmission'>, events: Pick<Parameters<NonNullable<NodePlugin['init']>>[0]['events'], 'worktreeStatus'>) {
  const attempted = async <T extends { changed: boolean }>(taskId: string, action: () => Promise<T>) => {
    try { return await action() }
    finally { events.worktreeStatus(taskId) }
  }
  return new Hono<AppEnv>()
    .use('/projects/:projectId/stashes', requireDevice)
    .use('/projects/:projectId/stashes/*', requireDevice)
    .get('/projects/:projectId/stashes', async (c) => c.json(await stashRoster(core, c.req.param('projectId'), c.req.raw.signal)))
    .post('/projects/:projectId/stashes', async (c) => { const input = await body(() => c.req.json(), create); return c.json(await attempted(input.taskId, () => createStash(core, c.req.param('projectId'), input))) })
    .post('/projects/:projectId/stashes/apply', async (c) => { const input = await body(() => c.req.json(), apply); return c.json(await attempted(input.taskId, () => applyStash(core, c.req.param('projectId'), input, false))) })
    .post('/projects/:projectId/stashes/pop', async (c) => { const input = await body(() => c.req.json(), apply); return c.json(await attempted(input.taskId, () => applyStash(core, c.req.param('projectId'), input, true))) })
    .post('/projects/:projectId/stashes/drop', async (c) => {
      const input = await body(() => c.req.json(), drop)
      try { return c.json(await dropStash(core, c.req.param('projectId'), input)) }
      finally { events.worktreeStatus(null) }
    })
}
