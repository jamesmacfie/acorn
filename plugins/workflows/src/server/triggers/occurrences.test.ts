import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import * as schema from '../../node/schema'
import { WorkflowAuthorityError } from '../runs/authority'
import { useTriggerHarness } from './test/triggerHarness'

describe('the trigger occurrence ledger', () => {
  const t = useTriggerHarness()

  it('replays one due occurrence with the same intended task and run IDs', async () => {
    const trigger = await t.approved()
    await t.service.dispatch(trigger.id, { reason: 'due', dueAt: 1_800_000_000_000 })
    await t.service.dispatch(trigger.id, { reason: 'catch-up', dueAt: 1_800_000_000_000 })

    const occurrences = t.database.db.select().from(schema.workflowTriggerOccurrences).all()
    expect(occurrences).toHaveLength(1)
    expect(t.tasks.createRoot).toHaveBeenCalledTimes(1)
    expect(t.starts.startTriggered).toHaveBeenCalledTimes(1)
    expect(occurrences[0]).toMatchObject({
      state: 'run-started',
      taskId: expect.any(String),
      runId: expect.any(String),
    })
  })

  it('atomically skips manual and timer overlap for the whole active tree', async () => {
    const trigger = await t.approved()
    await t.service.dispatch(trigger.id, { reason: 'manual', requestKey: 'manual-one' })
    await expect(t.service.dispatch(trigger.id, { reason: 'due', dueAt: 1_800_000_000_000 })).rejects.toThrow(
      'previous run still active',
    )

    const rows = t.database.db.select().from(schema.workflowTriggerOccurrences).all()
    expect(rows.map((row) => row.state).sort()).toEqual(['run-started', 'skipped'])
    expect(rows.find((row) => row.state === 'skipped')?.detail).toContain(
      rows.find((row) => row.state === 'run-started')!.runId,
    )
  })

  it('serializes competing reservations from independent database connections', async () => {
    const trigger = await t.approved()
    const connection = t.database.openConnection()
    try {
      const other = t.serviceFor(connection)
      const results = await Promise.allSettled([
        t.service.dispatch(trigger.id, { reason: 'manual', requestKey: 'first' }),
        other.dispatch(trigger.id, { reason: 'due', dueAt: 1_800_000_000_000 }),
      ])
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      expect(
        t.database.db
          .select()
          .from(schema.workflowTriggerOccurrences)
          .all()
          .map((row) => row.state)
          .sort(),
      ).toEqual(['run-started', 'skipped'])
    } finally {
      connection.close()
    }
  })

  it('recovers a claimed occurrence after an ambiguous root-task failure without replacing IDs', async () => {
    const trigger = await t.approved()
    t.tasks.createRoot.mockRejectedValueOnce(new Error('core unavailable'))
    await expect(t.service.dispatch(trigger.id, { reason: 'due', dueAt: 1_800_000_000_000 })).rejects.toThrow(
      'core unavailable',
    )
    const claimed = t.database.db.select().from(schema.workflowTriggerOccurrences).get()!

    await t.service.dispatch(trigger.id, { reason: 'catch-up', dueAt: 1_800_000_000_000 })
    const recovered = t.database.db.select().from(schema.workflowTriggerOccurrences).get()!
    expect(recovered).toMatchObject({
      id: claimed.id,
      taskId: claimed.taskId,
      runId: claimed.runId,
      state: 'run-started',
    })
  })

  it('recovers a task-created occurrence without creating a replacement root', async () => {
    const trigger = await t.approved()
    t.starts.startTriggered.mockRejectedValueOnce(new Error('workflow store unavailable'))
    await expect(t.service.dispatch(trigger.id, { reason: 'due', dueAt: 1_800_000_000_000 })).rejects.toThrow(
      'workflow store unavailable',
    )
    const reserved = t.database.db.select().from(schema.workflowTriggerOccurrences).get()!
    expect(reserved.state).toBe('task-created')

    await t.service.dispatch(trigger.id, { reason: 'catch-up', dueAt: 1_800_000_000_000 })
    expect(t.tasks.createRoot).toHaveBeenCalledTimes(1)
    expect(t.database.db.select().from(schema.workflowTriggerOccurrences).get()).toMatchObject({
      taskId: reserved.taskId,
      runId: reserved.runId,
      state: 'run-started',
    })
  })

  it('blocks a task-created occurrence when authority changes before workflow start', async () => {
    const trigger = await t.approved()
    t.starts.startTriggered.mockRejectedValueOnce(
      new WorkflowAuthorityError('connection-required', 'connection-required'),
    )
    await expect(t.service.dispatch(trigger.id, { reason: 'due', dueAt: 1_800_000_000_000 })).rejects.toThrow(
      'connection-required',
    )

    expect(t.tasks.createRoot).toHaveBeenCalledTimes(1)
    expect(t.starts.startTriggered).toHaveBeenCalledTimes(1)
    expect(t.service.get(trigger.id)).toMatchObject({
      state: 'needs-review',
      error: 'connection-required',
      errorReason: 'connection-required',
    })
    expect(t.database.db.select().from(schema.workflowTriggerOccurrences).get()?.state).toBe('blocked')
    await t.service.reconcile(trigger.id)
    expect(t.starts.startTriggered).toHaveBeenCalledTimes(1)
  })

  it('retains transient source admission failures for infrastructure retry', async () => {
    const trigger = await t.approved()
    t.starts.prepareTriggered.mockRejectedValueOnce(new Error('provider-failure'))
    await expect(t.service.dispatch(trigger.id, { reason: 'due', dueAt: 1_800_000_000_000 })).rejects.toThrow(
      'provider-failure',
    )
    const claimed = t.database.db.select().from(schema.workflowTriggerOccurrences).get()!
    expect(claimed.state).toBe('claimed')

    await t.service.dispatch(trigger.id, { reason: 'catch-up', dueAt: 1_800_000_000_000 })
    expect(t.database.db.select().from(schema.workflowTriggerOccurrences).get()).toMatchObject({
      id: claimed.id,
      taskId: claimed.taskId,
      runId: claimed.runId,
      state: 'run-started',
    })
  })

  it('fails closed before task creation when source authority is revoked', async () => {
    const trigger = await t.approved()
    t.starts.prepareTriggered.mockRejectedValueOnce(
      new WorkflowAuthorityError('connection-required', 'connection-required'),
    )
    await expect(t.service.dispatch(trigger.id, { reason: 'due', dueAt: 1_800_000_000_000 })).rejects.toThrow(
      'connection-required',
    )
    expect(t.tasks.createRoot).not.toHaveBeenCalled()
    expect(t.service.get(trigger.id)).toMatchObject({
      state: 'needs-review',
      error: 'connection-required',
      errorReason: 'connection-required',
    })
    expect(t.database.db.select().from(schema.workflowTriggerOccurrences).get()?.state).toBe('blocked')
  })

  it('does not infrastructure-retry ordinary failed workflow work', async () => {
    const trigger = await t.approved()
    await t.service.dispatch(trigger.id, { reason: 'due', dueAt: 1_800_000_000_000 })
    const occurrence = t.database.db.select().from(schema.workflowTriggerOccurrences).get()!
    t.database.db
      .update(schema.workflowRuns)
      .set({ status: 'failed', error: 'child review failed' })
      .where(eq(schema.workflowRuns.id, occurrence.runId))
      .run()
    await t.service.reconcile(trigger.id)
    await t.service.reconcile(trigger.id)
    expect(t.starts.startTriggered).toHaveBeenCalledTimes(1)
    expect(t.database.db.select().from(schema.workflowTriggerOccurrences).get()?.state).toBe('terminal')
  })

  it('keeps overlap ownership until every descendant in the run tree settles', async () => {
    const trigger = await t.approved()
    await t.service.dispatch(trigger.id, { reason: 'manual', requestKey: 'tree' })
    const occurrence = t.database.db.select().from(schema.workflowTriggerOccurrences).get()!
    t.database.db
      .update(schema.workflowRuns)
      .set({ status: 'done' })
      .where(eq(schema.workflowRuns.id, occurrence.runId))
      .run()
    t.database.db
      .insert(schema.workflowRuns)
      .values({
        id: 'child-run',
        taskId: 'child-task',
        name: 'Child',
        status: 'gated',
        startedBy: 'trigger',
        defJson: '{}',
        rootRunId: occurrence.runId,
        parentRunId: occurrence.runId,
        parentStepId: 'step',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .run()

    await t.service.settleRun(occurrence.runId)
    expect(t.database.db.select().from(schema.workflowTriggerOccurrences).get()?.state).toBe('run-started')
    t.database.db
      .update(schema.workflowRuns)
      .set({ status: 'failed' })
      .where(eq(schema.workflowRuns.id, 'child-run'))
      .run()
    await t.service.settleRun(occurrence.runId)
    expect(t.database.db.select().from(schema.workflowTriggerOccurrences).get()?.state).toBe('terminal')
  })
})
