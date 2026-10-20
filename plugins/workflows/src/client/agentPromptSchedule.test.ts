import { describe, expect, it, vi } from 'vitest'
import { scheduleAgentPrompt } from './agentPromptSchedule'

const input = {
  workspaceId: 'ws',
  projectId: 'project',
  name: 'Refresh Forecast',
  prompt: 'Refresh it.',
  cadence: { daily: '09:00' },
}

const api = (overrides: Record<string, unknown> = {}) => ({
  createDef: vi.fn(async () => ({ id: 'def', revision: 1 })),
  deleteDef: vi.fn(async () => ({ ok: true })),
  preparePublication: vi.fn(async () => ({ id: 'op' })),
  publish: vi.fn(async () => ({ state: 'complete', error: null })),
  triggerDefaults: vi.fn(async () => ({ timezone: 'Pacific/Auckland' })),
  saveTrigger: vi.fn(async () => ({ id: 'trigger' })),
  approveTrigger: vi.fn(async () => ({ id: 'trigger' })),
  deleteTrigger: vi.fn(async () => ({ deleted: true })),
  ...overrides,
})

describe('scheduleAgentPrompt', () => {
  it('publishes a one-step agent workflow and approves its trigger', async () => {
    const calls = api()
    const scheduled = await scheduleAgentPrompt(input, calls as never)
    expect(calls.createDef).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project',
        def: expect.objectContaining({ steps: [{ name: 'refresh', kind: 'agent', prompt: 'Refresh it.' }] }),
      }),
    )
    expect(calls.publish).toHaveBeenCalledWith('op')
    expect(calls.saveTrigger).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'def',
        when: { kind: 'clock', timezone: 'Pacific/Auckland' },
        cadence: { daily: '09:00' },
      }),
    )
    expect(calls.approveTrigger).toHaveBeenCalledWith('trigger', 'process-current', false)
    await scheduled.undo()
    expect(calls.deleteTrigger).toHaveBeenCalledWith('trigger')
    expect(calls.deleteDef).toHaveBeenCalledWith('def')
  })

  it('takes back the workflow and trigger when approval fails', async () => {
    const calls = api({ approveTrigger: vi.fn(async () => Promise.reject(new Error('refused'))) })
    await expect(scheduleAgentPrompt(input, calls as never)).rejects.toThrow('refused')
    expect(calls.deleteTrigger).toHaveBeenCalledWith('trigger')
    expect(calls.deleteDef).toHaveBeenCalledWith('def')
  })
})
