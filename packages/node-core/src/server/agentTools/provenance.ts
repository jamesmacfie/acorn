import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const key = randomBytes(32)

export type AgentToolProvenance = { taskId: string; sessionId: string; tool: string; proof: string }

export function issueAgentToolProvenance(taskId: string, sessionId: string, tool: string): string {
  return createHmac('sha256', key).update(JSON.stringify([taskId, sessionId, tool])).digest('hex')
}

export function verifyAgentToolProvenance(input: AgentToolProvenance): boolean {
  if (!/^[a-f0-9]{64}$/.test(input.proof)) return false
  const expected = Buffer.from(issueAgentToolProvenance(input.taskId, input.sessionId, input.tool), 'hex')
  return timingSafeEqual(expected, Buffer.from(input.proof, 'hex'))
}
