// The owner's agent invocation approvals (docs/api-reference/workflow-routes.md § Agent invocation).
// Device only: an approval grants authority, so no agent credential may reach these routes. Loaded on
// the first request (../agentTools/activation.ts). The bridge it calls is in ./invocationBridge.ts.
import { Hono } from 'hono'
import { z } from 'zod'
import { DATA_LIMITS, parseDataValue, type DataValue } from '@acorn/protocol/dataValues.ts'
import { requireDevice, respondError, viaBridge, type AppEnv } from '@acorn/plugin-api/node'
import { MAX_INVOCATION_STARTS } from '../../shared/workflowInvocation'
import { WORKFLOW_INVOCATION_ROUTE } from './invocationBridge'

const definitionKey = z
  .string()
  .regex(/^(db|repo|user):.+$/)
  .max(300)
const target = z.object({ projectId: z.string().min(1), definitionKey }).strict()
const approveBody = target
  .extend({
    graphDigest: z.string().min(1).max(200),
    callerInputs: z.array(z.string().min(1).max(200)).max(100),
    fixedInputs: z.record(z.string(), z.unknown()).transform((value, ctx) => {
      try {
        return parseDataValue(value, DATA_LIMITS.selectionBytes) as Record<string, DataValue>
      } catch {
        ctx.addIssue({ code: 'custom', message: 'Expected bounded typed values' })
        return z.NEVER
      }
    }),
    limits: z
      .object({
        maxTurns: z.number().int().positive(),
        maxWallTimeMs: z.number().int().positive(),
        maxCostUsd: z.number().positive().finite().optional(),
        maxInputTokens: z.number().int().positive().optional(),
        maxOutputTokens: z.number().int().positive().optional(),
      })
      .strict(),
    startsPerSession: z.number().int().min(1).max(MAX_INVOCATION_STARTS),
  })
  .strict()

export const workflowInvocationRoutes = new Hono<AppEnv>()
  .use('*', requireDevice)
  .get('/review', async (c) => {
    const parsed = target.safeParse({ projectId: c.req.query('projectId'), definitionKey: c.req.query('definition') })
    if (!parsed.success) return respondError(c, 400, 'bad_request', ['Name a project and a saved workflow.'])
    return viaBridge(c, WORKFLOW_INVOCATION_ROUTE, (bridge) =>
      bridge.review(parsed.data.projectId, parsed.data.definitionKey),
    )
  })
  .post('/approve', async (c) => {
    const parsed = approveBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success)
      return respondError(c, 400, 'bad_request', [
        'Set the inputs, the turn and time limits, and the starts per session.',
      ])
    return viaBridge(c, WORKFLOW_INVOCATION_ROUTE, (bridge) => bridge.approve(parsed.data))
  })
  .post('/revoke', async (c) => {
    const parsed = target.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request', ['Name a project and a saved workflow.'])
    return viaBridge(c, WORKFLOW_INVOCATION_ROUTE, (bridge) =>
      bridge.revoke(parsed.data.projectId, parsed.data.definitionKey),
    )
  })
