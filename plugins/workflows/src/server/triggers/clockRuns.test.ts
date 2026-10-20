import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import * as schema from '../../node/schema'
import { clock, useTriggerHarness } from './test/triggerHarness'

describe('clock trigger baselines and settlement', () => {
  const t = useTriggerHarness()

  it('keeps activation inactive until a baseline run settles and records baseline intent', async () => {
    const trigger = await t.approved('track-now')
    expect(trigger.state).toBe('baselining')
    expect(t.starts.startTriggered).toHaveBeenCalledWith(
      expect.objectContaining({ baseline: true, processingScope: { scopeId: trigger.id, epoch: trigger.epoch } }),
    )
    const occurrence = t.database.db.select().from(schema.workflowTriggerOccurrences).get()!
    t.database.db
      .update(schema.workflowRuns)
      .set({ status: 'done' })
      .where(eq(schema.workflowRuns.id, occurrence.runId))
      .run()
    await t.service.settleRun(occurrence.runId)
    expect(t.service.get(trigger.id)).toMatchObject({ state: 'active', error: null })
  })

  it('keeps a failed baseline start inactive and recoverable with the original intent', async () => {
    t.tasks.createRoot.mockRejectedValueOnce(new Error('source unavailable'))
    const saved = t.service.save({
      projectId: 'project-1',
      workflowId: 'workflow-1',
      when: clock('UTC'),
      inputs: { count: 2 },
    })
    await expect(t.service.approve(saved.id, 'track-now')).rejects.toThrow('source unavailable')
    expect(t.service.get(saved.id)).toMatchObject({ state: 'baseline-failed', error: 'source unavailable' })
    const claimed = t.database.db.select().from(schema.workflowTriggerOccurrences).get()!
    await t.service.reconcile(saved.id)
    expect(t.database.db.select().from(schema.workflowTriggerOccurrences).get()).toMatchObject({
      taskId: claimed.taskId,
      runId: claimed.runId,
      state: 'run-started',
    })
  })

  it('keeps a terminal baseline failure inactive', async () => {
    const trigger = await t.approved('track-now')
    const occurrence = t.database.db.select().from(schema.workflowTriggerOccurrences).get()!
    t.database.db
      .update(schema.workflowRuns)
      .set({ status: 'failed', error: 'incomplete source result' })
      .where(eq(schema.workflowRuns.id, occurrence.runId))
      .run()
    await t.service.settleRun(occurrence.runId)
    expect(t.service.get(trigger.id)).toMatchObject({ state: 'baseline-failed', error: 'incomplete source result' })
  })

  it('pauses for review when an incremental continuation fails', async () => {
    const trigger = await t.approved()
    await t.service.dispatch(trigger.id, { reason: 'due', dueAt: 1_800_000_000_000 })
    const occurrence = t.database.db.select().from(schema.workflowTriggerOccurrences).get()!
    t.database.db
      .update(schema.workflowRuns)
      .set({ status: 'failed', error: 'Incremental continuation token expired', errorCause: 'checkpoint-expired' })
      .where(eq(schema.workflowRuns.id, occurrence.runId))
      .run()
    await t.service.settleRun(occurrence.runId)
    expect(t.service.get(trigger.id)).toMatchObject({
      state: 'needs-review',
      error: 'Incremental continuation token expired',
    })
  })
})
