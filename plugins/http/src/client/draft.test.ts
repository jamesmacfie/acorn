import { describe, expect, it } from 'vitest'
import { emptyDraft, purgeStoredHttpDrafts, toSendInput } from './draft'

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

describe('legacy HTTP draft cleanup', () => {
  it('removes every credential-bearing HTTP draft without touching other local state', () => {
    const values = new Map([
      ['http-draft:acme/web:repo', '{"auth":"secret"}'],
      ['theme', 'dark'],
      ['http-draft:acme/api:task-1', '{"body":"secret"}'],
    ])
    const storage = {
      get length() {
        return values.size
      },
      key(index: number) {
        return [...values.keys()][index] ?? null
      },
      removeItem(key: string) {
        values.delete(key)
      },
    }

    purgeStoredHttpDrafts(storage)

    expect([...values.entries()]).toEqual([['theme', 'dark']])
  })
})
