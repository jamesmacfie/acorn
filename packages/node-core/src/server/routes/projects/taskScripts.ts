import { Hono } from 'hono'
import { BridgeError } from '../../bridge'
import { z } from 'zod'
import { taskScriptLogsInputSchema, taskScriptWaitInputSchema } from '@acorn/protocol/taskScripts.ts'
import { getDb } from '../../db'
import type { AppEnv } from '../../middleware/auth'
import { requireTaskScope } from '../../middleware/requireUser'
import { respondError } from '../../respond'
import { taskScripts } from '../../taskScripts/service'

const queryNumber = z.coerce.number().int()
const waitQuery = taskScriptWaitInputSchema.extend({ timeoutMs: queryNumber.min(0).max(30_000).default(30_000) })
const logsQuery = taskScriptLogsInputSchema.extend({ tailLines: queryNumber.min(1).max(1000).default(100), maxBytes: queryNumber.min(1).max(32 * 1024).default(32 * 1024) })
export const scripts = new Hono<AppEnv>()
  .onError((error, c) => {
    if (error instanceof BridgeError) return respondError(c, error.status, error.code, [error.message])
    throw error
  })
  .use('/tasks/:id/scripts', requireTaskScope)
  .use('/tasks/:id/scripts/*', requireTaskScope)
  .get('/tasks/:id/scripts', (c) => c.json(taskScripts(getDb(c.env)).status(c.req.param('id'))))
  .get('/tasks/:id/scripts/wait', async (c) => {
    const parsed = waitQuery.safeParse(c.req.query())
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return c.json(await taskScripts(getDb(c.env)).wait(c.req.param('id'), parsed.data, c.req.raw.signal))
  })
  .get('/tasks/:id/scripts/logs', (c) => {
    const parsed = logsQuery.safeParse(c.req.query())
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return c.json(taskScripts(getDb(c.env)).logs(c.req.param('id'), parsed.data))
  })
