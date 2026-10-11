import { z } from 'zod'
import { BridgeError, requireDevice, type CompiledCoreServices, type NodePlugin } from '@acorn/plugin-api/node'
import { gitRouter } from './router'
import { controlOperation, operationState, startOperation } from '../operations'

const operation = z.enum(['merge', 'rebase', 'cherry-pick', 'revert'])
const objectId = z.string().regex(/^[0-9a-f]{40,64}$/)
const start = z.object({ expectedPath: z.string().min(1), expectedHead: objectId, operation, source: objectId }).strict()
const control = z.object({ expectedPath: z.string().min(1), operation }).strict()
const action = z.enum(['continue', 'skip', 'abort'])
async function body<T extends z.ZodTypeAny>(read: () => Promise<unknown>, schema: T): Promise<z.infer<T>> {
  const parsed = schema.safeParse(await read().catch(() => null))
  if (!parsed.success) throw new BridgeError(400, 'bad_request', 'Invalid Git operation request.')
  return parsed.data
}

export function operationRoutes(core: Pick<CompiledCoreServices, 'git' | 'projects' | 'tasks' | 'checkoutAdmission'>, events: Pick<Parameters<NonNullable<NodePlugin['init']>>[0]['events'], 'worktreeStatus'>) {
  // A refused or failed command can still have changed files, so Changes refreshes after every attempt.
  const attempted = async <T>(taskId: string, write: () => Promise<T>) => {
    try { return await write() }
    finally { events.worktreeStatus(taskId) }
  }
  return gitRouter()
    .use('/tasks/:taskId/operation', requireDevice)
    .use('/tasks/:taskId/operation/*', requireDevice)
    .get('/tasks/:taskId/operation', async (c) => c.json(await operationState(core, c.req.param('taskId'))))
    .post('/tasks/:taskId/operation', async (c) => {
      const input = await body(() => c.req.json(), start)
      return c.json(await attempted(c.req.param('taskId'), () => startOperation(core, c.req.param('taskId'), input)))
    })
    .post('/tasks/:taskId/operation/:action', async (c) => {
      const verb = action.safeParse(c.req.param('action'))
      if (!verb.success) throw new BridgeError(404, 'not_found', 'Unknown Git operation action.')
      const input = await body(() => c.req.json(), control)
      return c.json(await attempted(c.req.param('taskId'), () => controlOperation(core, c.req.param('taskId'), verb.data, input)))
    })
}
