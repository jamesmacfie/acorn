import { describe, expect, it } from 'vitest'
import type { DataPredicate } from '@acorn/protocol/dataBindings.ts'
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

  describe('a record trigger on core Tasks', () => {
    const records = (predicate?: DataPredicate) => {
      t.reader.resolve.mockResolvedValueOnce({
        query: {
          source: { pluginId: 'core', sourceId: 'tasks' },
          scope: { workspaceId: 'workspace-1', projectId: 'project-1', parameters: {} },
          ...(predicate ? { predicate } : {}),
          sort: [],
        },
        parameters: {},
        published: { revision: 3 } as never,
      })
      return t.service.prepare({
        projectId: 'project-1',
        workflowId: 'workflow-1',
        when: { kind: 'records', query: { kind: 'saved', queryId: 'q-1', bindings: {} }, change: { on: 'new' } },
      })
    }
    const createdByTask = (operator: 'missing' | 'present'): DataPredicate => ({
      kind: 'comparison',
      left: { address: { from: 'item', pointer: '/createdByTask' } },
      operator,
    })

    it('warns that agents can create tasks it would match unless the query leaves them out', async () => {
      expect(await records()).toMatchObject({ agentTasks: true })
      expect(await records(createdByTask('present'))).toMatchObject({ agentTasks: true })
      expect(await records({ kind: 'all', predicates: [createdByTask('missing')] })).toMatchObject({
        agentTasks: false,
      })
    })

    it('says nothing about a clock trigger or another source', async () => {
      const draft = { projectId: 'project-1', workflowId: 'workflow-1' }
      expect(await t.service.prepare({ ...draft, when: clock('UTC') })).toMatchObject({ agentTasks: false })
      t.reader.resolve.mockResolvedValueOnce({
        query: { source: { pluginId: 'github', sourceId: 'issues' }, scope: {}, sort: [] },
        parameters: {},
      } as never)
      const when = { kind: 'records' as const, query: { kind: 'saved' as const, queryId: 'q-1', bindings: {} } }
      expect(await t.service.prepare({ ...draft, when: { ...when, change: { on: 'new' } } })).toMatchObject({
        agentTasks: false,
      })
    })
  })
})
