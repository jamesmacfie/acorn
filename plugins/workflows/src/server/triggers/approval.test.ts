import { describe, expect, it } from 'vitest'
import { clock, graph, useTriggerHarness } from './test/triggerHarness'

describe('trigger approval', () => {
  const t = useTriggerHarness()

  it('blocks before task creation when the approved dependency graph changes', async () => {
    const trigger = await t.approved()
    t.currentGraph = graph('Changed prompt')
    await expect(t.service.dispatch(trigger.id, { reason: 'due', dueAt: 1_800_000_000_000 })).rejects.toThrow(
      'approval changed',
    )
    expect(t.tasks.createRoot).not.toHaveBeenCalled()
    expect(t.service.get(trigger.id)).toMatchObject({ state: 'needs-review' })
  })

  it('retains processing history on review by default and starts fresh only when explicitly chosen', async () => {
    const approvedTrigger = await t.approved()
    const originalEpoch = approvedTrigger.epoch
    const originalApproval = approvedTrigger.approvedGraphJson

    const edited = t.service.save({
      id: approvedTrigger.id,
      projectId: 'project-1',
      workflowId: 'workflow-1',
      when: clock('UTC'),
      inputs: { count: 3 },
    })
    expect(edited).toMatchObject({ state: 'needs-review', epoch: originalEpoch, approvedGraphJson: originalApproval })

    const retained = await t.service.approve(edited.id, 'process-current')
    expect(retained.epoch).toBe(originalEpoch)
    t.service.save({
      id: retained.id,
      projectId: 'project-1',
      workflowId: 'workflow-1',
      when: clock('UTC'),
      inputs: { count: 4 },
    })
    const fresh = await t.service.approve(retained.id, 'process-current', true)
    expect(fresh.epoch).not.toBe(originalEpoch)
  })
})
