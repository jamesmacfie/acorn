import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestPluginDb, type TestPluginDb } from '@acorn/plugin-api/testkit'
import type { NotesStoreCapability } from '@acorn/plugin-notes/contract/store.ts'
import { workflowRuns } from '../node/schema'
import { workflowReviewInput } from './workflowReviewInput'

describe('workflow completion input', () => {
  let store: TestPluginDb
  beforeEach(() => { store = makeTestPluginDb('workflows') })
  afterEach(() => store.cleanup())

  it('reads a bounded persisted handoff only for a completed run in the requested task', async () => {
    await store.db.insert(workflowRuns).values([
      { id: 'done', taskId: 'task', rootRunId: 'done', name: 'Review', status: 'done', defJson: '{}', createdAt: 1, updatedAt: 2 },
      { id: 'active', taskId: 'task', rootRunId: 'active', name: 'Active', status: 'running', defJson: '{}', createdAt: 3, updatedAt: 4 },
    ])
    const notes = { read: async () => ({ body: '€'.repeat(7_000) }) } as unknown as NotesStoreCapability
    const input = workflowReviewInput(store.db, () => notes)
    expect(await input.listCompleted('task')).toEqual([{ taskId: 'task', runId: 'done', status: 'done', completedAt: 2 }])
    const read = await input.read('task', 'done')
    expect(read.availability).toBe('available')
    expect(Buffer.byteLength(read.handoff!, 'utf8')).toBeLessThanOrEqual(16_384)
    expect(read.handoff).not.toContain('�')
    expect((await input.read('other', 'done')).availability).toBe('unavailable')
    expect((await input.read('task', 'active')).availability).toBe('unavailable')
  })
})
