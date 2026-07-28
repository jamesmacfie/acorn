import { describe, expect, it } from 'vitest'
import { emptyDraft, toSendInput } from './draft'

describe('toSendInput', () => {
  it('uses panel task context even when the saved request belongs to the repo', () => {
    const repoSavedDraft = { ...emptyDraft(null), url: '{{BASE_URL}}/health' }

    const input = toSendInput(repoSavedDraft, 'task-1')

    expect(repoSavedDraft.taskId).toBeNull()
    expect(input.executionTaskId).toBe('task-1')
    expect(input).not.toHaveProperty('taskId')
  })

  it('uses the base checkout when sent from the repo source', () => {
    expect(toSendInput(emptyDraft('filing-task'), null).executionTaskId).toBeNull()
  })
})
