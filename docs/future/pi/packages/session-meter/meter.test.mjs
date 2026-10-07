// Run with `node --test` from this folder.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { effortOf, nextEffort, taskActivity } from './meter.js'

const effort = (currentValue) => [
  { id: 'model', label: 'Model', category: 'model', currentValue: 'opus', values: [{ value: 'opus', label: 'Opus' }, { value: 'haiku', label: 'Haiku' }] },
  { id: 'effort', label: 'Effort', category: 'reasoning', currentValue, values: [{ value: 'low', label: 'Low' }, { value: 'high', label: 'High' }, { value: 'max', label: 'Max' }] },
]

test('cycles to the next advertised effort and wraps', () => {
  assert.deepEqual(nextEffort(effort('low')), { optionId: 'effort', value: 'high', valueLabel: 'High' })
  assert.deepEqual(nextEffort(effort('max')), { optionId: 'effort', value: 'low', valueLabel: 'Low' })
  assert.deepEqual(effortOf(effort('high')), { optionId: 'effort', label: 'Effort', value: 'high', valueLabel: 'High' })
})

test('offers no cycle when the harness advertises no effort choice', () => {
  assert.equal(nextEffort([]), null)
  assert.equal(nextEffort(undefined), null)
  assert.equal(nextEffort([{ id: 'effort', category: 'reasoning', currentValue: 'x', values: [{ value: 'x', label: 'X' }] }]), null)
})

test('reads the newest live sessions with their rebuilt activity', async () => {
  const roster = [
    { sessionId: 'old', present: true, archived: false, updatedAt: 1, title: 'Old', providerId: 'codex', runtimeState: 'ready', configOptions: [] },
    { sessionId: 'gone', present: true, archived: true, updatedAt: 9, title: 'Gone', providerId: 'codex', runtimeState: 'ready', configOptions: [] },
    { sessionId: 'new', present: true, archived: false, updatedAt: 5, title: 'New', providerId: 'claude-code', runtimeState: 'working', configOptions: effort('low') },
  ]
  const read = []
  const result = await taskActivity({
    sessions: { list: async (taskId) => (assert.equal(taskId, 't'), roster) },
    activity: { read: async (ref) => (read.push(ref.sessionId), { ...ref, tools: [], subagents: [], usage: { contextUsed: null, contextSize: null } }) },
  }, 't')
  assert.deepEqual(result.sessions.map((session) => session.sessionId), ['new', 'old'])
  assert.deepEqual(read.toSorted(), ['new', 'old'])
  assert.equal(result.sessions[0].effort.valueLabel, 'Low')
})
