import { describe, expect, it } from 'vitest'
import type { AgentContextSnapshot } from '../../../core/shared/agentContext'
import type { AgentTurn } from '../../../core/shared/managedAgents'
import {
  AUTOMATIC_TASK_CONTEXT_SOURCE,
  automaticTaskContextFor,
  automaticTaskContextPayload,
  latestAutomaticTaskContext,
} from './automaticTaskContext'

const captured = (content = 'task context'): AgentContextSnapshot => ({
  type: 'context',
  contextId: 'context-1',
  label: 'Task context',
  content,
  source: 'context.task',
  capturedAt: 1,
})

const turn = (ordinal: number, context?: AgentContextSnapshot): AgentTurn => ({
  id: `turn-${ordinal}`,
  sessionId: 'session-1',
  ordinal,
  source: 'interactive',
  status: 'completed',
  input: context ? [context] : [],
  effectivePolicy: {},
  providerTurnRef: null,
  stopReason: null,
  usage: null,
  error: null,
  attempt: 1,
  createdAt: ordinal,
  startedAt: ordinal,
  completedAt: ordinal,
})

describe('automatic task context', () => {
  it('labels the first snapshot and explains why Acorn attached it', () => {
    const result = automaticTaskContextFor(captured(), undefined)

    expect(result).toMatchObject({
      label: 'Task context · attached',
      source: AUTOMATIC_TASK_CONTEXT_SOURCE,
    })
    expect(result?.content).toContain('because this managed chat was started from the task')
    expect(result && automaticTaskContextPayload(result)).toBe('task context')
  })

  it('does not attach an unchanged snapshot again', () => {
    const previous = automaticTaskContextFor(captured(), undefined)
    expect(previous).not.toBeNull()
    expect(automaticTaskContextFor(captured(), previous ?? undefined)).toBeNull()
  })

  it('marks changed context as an update and finds the latest sent copy', () => {
    const previous = automaticTaskContextFor(captured(), undefined)
    const updated = automaticTaskContextFor(captured('new task context'), previous ?? undefined)

    expect(updated?.label).toBe('Task context · updated')
    expect(updated?.content).toContain('may contain new or modified information')
    expect(latestAutomaticTaskContext([
      turn(1, previous ?? undefined),
      turn(2),
      turn(3, updated ?? undefined),
    ])).toEqual(updated)
  })
})
