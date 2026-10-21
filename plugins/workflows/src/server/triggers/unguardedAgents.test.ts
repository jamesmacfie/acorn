import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import * as schema from '../../node/schema'
import type { WorkflowTriggerDraftInput } from '../../shared/workflowTriggers'
import { allowsUnguardedAgents } from './occurrences'
import { clock, graph, task, useTriggerHarness } from './test/triggerHarness'

describe('agent steps behind a trigger', () => {
  const t = useTriggerHarness()

  const records: WorkflowTriggerDraftInput['when'] = {
    kind: 'records',
    query: { kind: 'saved', queryId: 'q-1', bindings: {} },
    change: { on: 'new' },
  }
  /** Starts one run of a trigger and returns its root run ID. */
  const startRun = async (when: WorkflowTriggerDraftInput['when'], limits?: WorkflowTriggerDraftInput['limits']) => {
    const base = graph()
    const root = { ...base.root, inputs: [{ name: 'issue' }] }
    t.currentGraph = { ...base, root, nodes: [{ ...base.nodes[0]!, definition: root, defaultInputs: {} }] }
    const saved = t.service.save({ projectId: 'project-1', workflowId: 'workflow-1', when, limits })
    const trigger = await t.service.approve(saved.id, 'process-current')
    t.source.records = [task('t-1', 'Fix it')]
    await t.service.dispatch(trigger.id, { reason: 'due', dueAt: Date.now() })
    return { trigger, runId: t.occurrence().runId }
  }

  it("refuses a record trigger's agents unless the approval allowed it", async () => {
    expect(allowsUnguardedAgents(t.database.db, (await startRun(records)).runId)).toBe(false)
  })

  it('allows them once the owner approved the trigger with the box ticked', async () => {
    const { runId } = await startRun(records, { allowUnguardedAgents: true })
    expect(allowsUnguardedAgents(t.database.db, runId)).toBe(true)
  })

  it("leaves a clock trigger's run, and a run no trigger started, alone", async () => {
    expect(allowsUnguardedAgents(t.database.db, (await startRun(clock())).runId)).toBe(true)
    expect(allowsUnguardedAgents(t.database.db, 'manual-run')).toBe(true)
  })

  it('moves the trigger to Needs review when a run stopped on an unguarded agent', async () => {
    const { trigger, runId } = await startRun(records)
    t.database.db
      .update(schema.workflowRuns)
      .set({
        status: 'failed',
        error: "Step 'Review': The agent would run in bypassPermissions",
        errorCause: 'unguarded-agent',
      })
      .where(eq(schema.workflowRuns.id, runId))
      .run()
    await t.service.settleRun(runId)
    expect(t.service.get(trigger.id)).toMatchObject({
      state: 'needs-review',
      error: "Step 'Review': The agent would run in bypassPermissions",
      errorReason: 'unguarded-agent',
    })
  })

  describe('on the approval sheet', () => {
    const prepare = (when: WorkflowTriggerDraftInput['when']) =>
      t.service.prepare({ projectId: 'project-1', workflowId: 'workflow-1', when })

    it('says where the records come from when the source can say', async () => {
      t.reader.describe.mockResolvedValueOnce({
        ...(await t.reader.describe()),
        recordsFrom: 'issues in acme/billing-api',
      } as never)
      expect(await prepare(records)).toMatchObject({ recordAgents: { from: 'issues in acme/billing-api' } })
    })

    it('still flags the agents when the source cannot say', async () => {
      expect((await prepare(records)).recordAgents).toEqual({})
    })

    it('says nothing for a clock trigger', async () => {
      expect((await prepare(clock('UTC'))).recordAgents).toBeUndefined()
    })
  })
})
