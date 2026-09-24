import { describe, expect, it } from 'vitest'
import { issueAgentToolProvenance, verifyAgentToolProvenance } from './provenance'

describe('agent tool provenance', () => {
  it('binds a proof to the authenticated task, session, and registered tool', () => {
    const proof = issueAgentToolProvenance('task-1', 'session-1', 'memory_write')
    expect(verifyAgentToolProvenance({ taskId: 'task-1', sessionId: 'session-1', tool: 'memory_write', proof })).toBe(true)
    expect(verifyAgentToolProvenance({ taskId: 'task-2', sessionId: 'session-1', tool: 'memory_write', proof })).toBe(false)
    expect(verifyAgentToolProvenance({ taskId: 'task-1', sessionId: 'session-2', tool: 'memory_write', proof })).toBe(false)
    expect(verifyAgentToolProvenance({ taskId: 'task-1', sessionId: 'session-1', tool: 'findings_record', proof })).toBe(false)
    expect(verifyAgentToolProvenance({ taskId: 'task-1', sessionId: 'session-1', tool: 'memory_write', proof: 'a'.repeat(64) })).toBe(false)
  })
})
