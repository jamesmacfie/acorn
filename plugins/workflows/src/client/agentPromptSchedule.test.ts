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
  scheduleDefaults: vi.fn(async () => ({ timezone: 'Pacific/Auckland' })),
  saveSchedule: vi.fn(async () => ({ id: 'schedule' })),
  approveSchedule: vi.fn(async () => ({ id: 'schedule' })),
  deleteSchedule: vi.fn(async () => ({ deleted: true })),
  ...overrides,
})

describe('scheduleAgentPrompt', () => {
  it('publishes a one-step agent workflow and approves its schedule', async () => {
    const calls = api()
    const scheduled = await scheduleAgentPrompt(input, calls as never)
    expect(calls.createDef).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project',
        def: expect.objectContaining({ steps: [{ name: 'refresh', kind: 'agent', prompt: 'Refresh it.' }] }),
      }),
    )
    expect(calls.publish).toHaveBeenCalledWith('op')
    expect(calls.saveSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: 'def', timezone: 'Pacific/Auckland', cadence: { daily: '09:00' } }),
    )
    expect(calls.approveSchedule).toHaveBeenCalledWith('schedule', 'process-current', false)
    await scheduled.undo()
    expect(calls.deleteSchedule).toHaveBeenCalledWith('schedule')
    expect(calls.deleteDef).toHaveBeenCalledWith('def')
  })

  it('takes back the workflow and schedule when approval fails', async () => {
    const calls = api({ approveSchedule: vi.fn(async () => Promise.reject(new Error('refused'))) })
    await expect(scheduleAgentPrompt(input, calls as never)).rejects.toThrow('refused')
    expect(calls.deleteSchedule).toHaveBeenCalledWith('schedule')
    expect(calls.deleteDef).toHaveBeenCalledWith('def')
  })
})
