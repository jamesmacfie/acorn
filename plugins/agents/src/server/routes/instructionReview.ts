import { Hono } from 'hono'
import { z } from 'zod'
import {
  BridgeError,
  type AppEnv,
  requireDevice,
  respondError,
  routeCapability,
  setRouteTestCapability,
  viaBridge,
} from '@acorn/plugin-api/node'
import type { InstructionAdmission } from '../sessions/instructionAdmission'
import type { InstructionReviewProject } from '../../shared/instructionReview'

export type AgentInstructionReviewBridge = {
  projects(): Promise<InstructionReviewProject[]>
  admission(): Promise<InstructionAdmission>
}
export const AGENT_INSTRUCTION_REVIEW = routeCapability<AgentInstructionReviewBridge>('agents.instructionReviewRoute')
export const setAgentInstructionReviewBridge = (bridge: AgentInstructionReviewBridge | null) =>
  setRouteTestCapability(AGENT_INSTRUCTION_REVIEW, bridge)

const validId = (id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length < 200
const approvalBody = z.object({ projectId: z.string().min(1).max(199) }).strict()

export const agentInstructionReview = new Hono<AppEnv>()
  .get('/instruction-review/projects', requireDevice, (c) =>
    viaBridge(c, AGENT_INSTRUCTION_REVIEW, (bridge) => bridge.projects()),
  )
  .get('/instruction-review', requireDevice, (c) => {
    const projectId = c.req.query('projectId')
    if (!validId(projectId)) return respondError(c, 400, 'bad_request', ['projectId is required.'])
    return viaBridge(c, AGENT_INSTRUCTION_REVIEW, async (bridge) => {
      try {
        return await (await bridge.admission()).review(projectId, c.req.raw.signal)
      } catch (error) {
        throw new BridgeError(
          422,
          'incomplete',
          `Instruction scan incomplete: ${error instanceof Error ? error.message : 'unknown error'}. Retry or change the check in Settings > Security and backup.`,
        )
      }
    })
  })
  .post('/instruction-review/:id/approve', requireDevice, async (c) => {
    const body = approvalBody.safeParse(await c.req.json().catch(() => null))
    const id = c.req.param('id')
    if (!body.success || !validId(id))
      return respondError(c, 400, 'bad_request', ['Review id and projectId are required.'])
    const projectId = body.data.projectId
    return viaBridge(c, AGENT_INSTRUCTION_REVIEW, async (bridge) => {
      try {
        await (await bridge.admission()).approve(projectId, id, c.req.raw.signal)
      } catch (error) {
        throw new BridgeError(409, 'conflict', error instanceof Error ? error.message : 'Review changed.')
      }
      return { ok: true }
    })
  })
