import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { makeTestPluginDb, type TestPluginDb } from '@acorn/plugin-api/testkit'
import * as schema from '../../node/schema'
import type { ResolvedWorkflowGraph } from '../../shared/workflowContracts'
import { workflowContentFingerprint } from '../definitions/resolution'
import { WorkflowScheduleService } from './service'
import type { WorkflowStartService } from '../runs/admission'
import type { CompiledCoreServices } from '@acorn/plugin-api/node'

const graph = (prompt = 'Review it'): ResolvedWorkflowGraph => {
  const definition = { baseline: 'acorn-1' as const,
    formatVersion: 1 as const,
    name: 'Scheduled review',
    inputs: [{ name: 'count', schema: { type: 'number' as const }, required: true }],
    steps: [{ id: 'review', name: 'Review', prompt }],
  }
  const nodes = [{ path: ['$'], depth: 0, definition, provenance: { source: 'database' as const, id: 'workflow-1', revision: 1 }, defaultInputs: { count: 2 }, fingerprint: 'node' }]
  return { root: definition, nodes, fingerprint: workflowContentFingerprint(nodes.map(({ path, definition: def, provenance, defaultInputs }) => ({ path, definition: def, provenance, defaultInputs }))), requiresRepoTrust: false }
}

describe('approved workflow schedule occurrences', () => {
  let database: TestPluginDb
  let currentGraph: ResolvedWorkflowGraph
  let service: WorkflowScheduleService
  const starts = {
    prepareScheduled: vi.fn(async () => ({ graph: currentGraph, scope: { workspaceId: 'workspace-1', projectId: 'project-1', repoDir: null, userDir: null } })),
    startScheduled: vi.fn(async (request: Parameters<WorkflowStartService['startScheduled']>[0]) => {
      database.db.insert(schema.workflowRuns).values({
        id: request.intendedRunId, taskId: request.taskId, name: request.graph.root.name,
        status: 'running', trigger: 'schedule', defJson: JSON.stringify(request.graph.root),
        resolvedGraphJson: JSON.stringify(request.graph), rootRunId: request.intendedRunId,
        invocationKey: request.callerKey, payloadFingerprint: request.payloadFingerprint,
        createdAt: Date.now(), updatedAt: Date.now(),
      }).onConflictDoNothing().run()
      return request.intendedRunId
    }),
  }
  const tasks = { createRoot: vi.fn(async (_project: string, _seed: unknown, intended: string) => intended) }

  beforeEach(() => {
    database = makeTestPluginDb('workflows')
    currentGraph = graph()
    vi.clearAllMocks()
    service = new WorkflowScheduleService(
      database.db,
      starts as unknown as WorkflowStartService,
      { tasks, projects: {} } as unknown as Pick<CompiledCoreServices, 'tasks' | 'projects'>,
      Promise.resolve(),
    )
  })
  afterEach(() => database.cleanup())

  const approved = async (firstCheck: 'process-current' | 'track-now' = 'process-current') => {
    const saved = service.save({ projectId: 'project-1', workflowId: 'workflow-1', timezone: 'Pacific/Auckland', inputs: { count: 2 } })
    return service.approve(saved.id, firstCheck)
  }

  it('replays one due occurrence with the same intended task and run IDs', async () => {
    const schedule = await approved()
    await service.dispatch(schedule.id, { reason: 'due', dueAt: 1_800_000_000_000 })
    await service.dispatch(schedule.id, { reason: 'catch-up', dueAt: 1_800_000_000_000 })

    const occurrences = database.db.select().from(schema.workflowScheduleOccurrences).all()
    expect(occurrences).toHaveLength(1)
    expect(tasks.createRoot).toHaveBeenCalledTimes(1)
    expect(starts.startScheduled).toHaveBeenCalledTimes(1)
    expect(occurrences[0]).toMatchObject({ state: 'run-started', taskId: expect.any(String), runId: expect.any(String) })
  })

  it('atomically skips manual and timer overlap for the whole active tree', async () => {
    const schedule = await approved()
    await service.dispatch(schedule.id, { reason: 'manual', requestKey: 'manual-one' })
    await expect(service.dispatch(schedule.id, { reason: 'due', dueAt: 1_800_000_000_000 })).rejects.toThrow('previous run still active')

    const rows = database.db.select().from(schema.workflowScheduleOccurrences).all()
    expect(rows.map(row => row.state).sort()).toEqual(['run-started', 'skipped'])
    expect(rows.find(row => row.state === 'skipped')?.detail).toContain(rows.find(row => row.state === 'run-started')!.runId)
  })

  it('serializes competing reservations from independent database connections', async () => {
    const schedule = await approved()
    const connection = database.openConnection()
    try {
      const other = new WorkflowScheduleService(
        connection,
        starts as unknown as WorkflowStartService,
        { tasks, projects: {} } as unknown as Pick<CompiledCoreServices, 'tasks' | 'projects'>,
        Promise.resolve(),
      )
      const results = await Promise.allSettled([
        service.dispatch(schedule.id, { reason: 'manual', requestKey: 'first' }),
        other.dispatch(schedule.id, { reason: 'due', dueAt: 1_800_000_000_000 }),
      ])
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
      expect(database.db.select().from(schema.workflowScheduleOccurrences).all().map(row => row.state).sort())
        .toEqual(['run-started', 'skipped'])
    } finally { connection.close() }
  })

  it('recovers a claimed occurrence after an ambiguous root-task failure without replacing IDs', async () => {
    const schedule = await approved()
    tasks.createRoot.mockRejectedValueOnce(new Error('core unavailable'))
    await expect(service.dispatch(schedule.id, { reason: 'due', dueAt: 1_800_000_000_000 })).rejects.toThrow('core unavailable')
    const claimed = database.db.select().from(schema.workflowScheduleOccurrences).get()!

    await service.dispatch(schedule.id, { reason: 'catch-up', dueAt: 1_800_000_000_000 })
    const recovered = database.db.select().from(schema.workflowScheduleOccurrences).get()!
    expect(recovered).toMatchObject({ id: claimed.id, taskId: claimed.taskId, runId: claimed.runId, state: 'run-started' })
  })

  it('recovers a task-created occurrence without creating a replacement root', async () => {
    const schedule = await approved()
    starts.startScheduled.mockRejectedValueOnce(new Error('workflow store unavailable'))
    await expect(service.dispatch(schedule.id, { reason: 'due', dueAt: 1_800_000_000_000 })).rejects.toThrow('workflow store unavailable')
    const reserved = database.db.select().from(schema.workflowScheduleOccurrences).get()!
    expect(reserved.state).toBe('task-created')

    await service.dispatch(schedule.id, { reason: 'catch-up', dueAt: 1_800_000_000_000 })
    expect(tasks.createRoot).toHaveBeenCalledTimes(1)
    expect(database.db.select().from(schema.workflowScheduleOccurrences).get()).toMatchObject({
      taskId: reserved.taskId, runId: reserved.runId, state: 'run-started',
    })
  })

  it('blocks a task-created occurrence when authority changes before workflow start', async () => {
    const schedule = await approved()
    starts.startScheduled.mockRejectedValueOnce(new Error('connection-required'))
    await expect(service.dispatch(schedule.id, { reason: 'due', dueAt: 1_800_000_000_000 }))
      .rejects.toThrow('connection-required')

    expect(tasks.createRoot).toHaveBeenCalledTimes(1)
    expect(starts.startScheduled).toHaveBeenCalledTimes(1)
    expect(service.get(schedule.id)).toMatchObject({ state: 'needs-review', error: 'connection-required' })
    expect(database.db.select().from(schema.workflowScheduleOccurrences).get()?.state).toBe('blocked')
    await service.reconcile(schedule.id)
    expect(starts.startScheduled).toHaveBeenCalledTimes(1)
  })

  it('blocks before task creation when the approved dependency graph changes', async () => {
    const schedule = await approved()
    currentGraph = graph('Changed prompt')
    await expect(service.dispatch(schedule.id, { reason: 'due', dueAt: 1_800_000_000_000 })).rejects.toThrow('approval changed')
    expect(tasks.createRoot).not.toHaveBeenCalled()
    expect(service.get(schedule.id)).toMatchObject({ state: 'needs-review' })
  })

  it('retains transient source admission failures for infrastructure retry', async () => {
    const schedule = await approved()
    starts.prepareScheduled.mockRejectedValueOnce(new Error('provider-failure'))
    await expect(service.dispatch(schedule.id, { reason: 'due', dueAt: 1_800_000_000_000 })).rejects.toThrow('provider-failure')
    const claimed = database.db.select().from(schema.workflowScheduleOccurrences).get()!
    expect(claimed.state).toBe('claimed')

    await service.dispatch(schedule.id, { reason: 'catch-up', dueAt: 1_800_000_000_000 })
    expect(database.db.select().from(schema.workflowScheduleOccurrences).get()).toMatchObject({
      id: claimed.id, taskId: claimed.taskId, runId: claimed.runId, state: 'run-started',
    })
  })

  it('fails closed before task creation when source authority is revoked', async () => {
    const schedule = await approved()
    starts.prepareScheduled.mockRejectedValueOnce(new Error('connection-required'))
    await expect(service.dispatch(schedule.id, { reason: 'due', dueAt: 1_800_000_000_000 })).rejects.toThrow('connection-required')
    expect(tasks.createRoot).not.toHaveBeenCalled()
    expect(service.get(schedule.id)).toMatchObject({ state: 'needs-review', error: 'connection-required' })
    expect(database.db.select().from(schema.workflowScheduleOccurrences).get()?.state).toBe('blocked')
  })

  it('keeps activation inactive until a baseline run settles and records baseline intent', async () => {
    const schedule = await approved('track-now')
    expect(schedule.state).toBe('baselining')
    expect(starts.startScheduled).toHaveBeenCalledWith(expect.objectContaining({ baseline: true, processingScope: { scopeId: schedule.id, epoch: schedule.epoch } }))
    const occurrence = database.db.select().from(schema.workflowScheduleOccurrences).get()!
    database.db.update(schema.workflowRuns).set({ status: 'done' }).where(eq(schema.workflowRuns.id, occurrence.runId)).run()
    await service.settleRun(occurrence.runId)
    expect(service.get(schedule.id)).toMatchObject({ state: 'active', error: null })
  })

  it('keeps a failed baseline start inactive and recoverable with the original intent', async () => {
    tasks.createRoot.mockRejectedValueOnce(new Error('source unavailable'))
    const saved = service.save({ projectId: 'project-1', workflowId: 'workflow-1', timezone: 'UTC', inputs: { count: 2 } })
    await expect(service.approve(saved.id, 'track-now')).rejects.toThrow('source unavailable')
    expect(service.get(saved.id)).toMatchObject({ state: 'baseline-failed', error: 'source unavailable' })
    const claimed = database.db.select().from(schema.workflowScheduleOccurrences).get()!
    await service.reconcile(saved.id)
    expect(database.db.select().from(schema.workflowScheduleOccurrences).get()).toMatchObject({
      taskId: claimed.taskId, runId: claimed.runId, state: 'run-started',
    })
  })

  it('keeps a terminal baseline failure inactive', async () => {
    const schedule = await approved('track-now')
    const occurrence = database.db.select().from(schema.workflowScheduleOccurrences).get()!
    database.db.update(schema.workflowRuns).set({ status: 'failed', error: 'incomplete source result' })
      .where(eq(schema.workflowRuns.id, occurrence.runId)).run()
    await service.settleRun(occurrence.runId)
    expect(service.get(schedule.id)).toMatchObject({ state: 'baseline-failed', error: 'incomplete source result' })
  })

  it('does not infrastructure-retry ordinary failed workflow work', async () => {
    const schedule = await approved()
    await service.dispatch(schedule.id, { reason: 'due', dueAt: 1_800_000_000_000 })
    const occurrence = database.db.select().from(schema.workflowScheduleOccurrences).get()!
    database.db.update(schema.workflowRuns).set({ status: 'failed', error: 'child review failed' })
      .where(eq(schema.workflowRuns.id, occurrence.runId)).run()
    await service.reconcile(schedule.id)
    await service.reconcile(schedule.id)
    expect(starts.startScheduled).toHaveBeenCalledTimes(1)
    expect(database.db.select().from(schema.workflowScheduleOccurrences).get()?.state).toBe('terminal')
  })

  it('pauses for review when an incremental continuation fails', async () => {
    const schedule = await approved()
    await service.dispatch(schedule.id, { reason: 'due', dueAt: 1_800_000_000_000 })
    const occurrence = database.db.select().from(schema.workflowScheduleOccurrences).get()!
    database.db.update(schema.workflowRuns).set({ status: 'failed', error: 'Incremental continuation token expired' })
      .where(eq(schema.workflowRuns.id, occurrence.runId)).run()
    await service.settleRun(occurrence.runId)
    expect(service.get(schedule.id)).toMatchObject({ state: 'needs-review', error: 'Incremental continuation token expired' })
  })

  it('keeps overlap ownership until every descendant in the run tree settles', async () => {
    const schedule = await approved()
    await service.dispatch(schedule.id, { reason: 'manual', requestKey: 'tree' })
    const occurrence = database.db.select().from(schema.workflowScheduleOccurrences).get()!
    database.db.update(schema.workflowRuns).set({ status: 'done' }).where(eq(schema.workflowRuns.id, occurrence.runId)).run()
    database.db.insert(schema.workflowRuns).values({
      id: 'child-run', taskId: 'child-task', name: 'Child', status: 'gated', trigger: 'schedule',
      defJson: '{}', rootRunId: occurrence.runId, parentRunId: occurrence.runId, parentStepId: 'step',
      createdAt: Date.now(), updatedAt: Date.now(),
    }).run()

    await service.settleRun(occurrence.runId)
    expect(database.db.select().from(schema.workflowScheduleOccurrences).get()?.state).toBe('run-started')
    database.db.update(schema.workflowRuns).set({ status: 'failed' }).where(eq(schema.workflowRuns.id, 'child-run')).run()
    await service.settleRun(occurrence.runId)
    expect(database.db.select().from(schema.workflowScheduleOccurrences).get()?.state).toBe('terminal')
  })

  it('retains a deletion tombstone and leaves active workflow work untouched', async () => {
    const schedule = await approved()
    await service.dispatch(schedule.id, { reason: 'manual', requestKey: 'manual-one' })
    await service.remove(schedule.id)
    expect(service.get(schedule.id)).toMatchObject({ state: 'deleted' })
    expect(database.db.select().from(schema.workflowScheduleOccurrences).get()?.state).toBe('run-started')
    expect(database.db.select().from(schema.workflowRuns).get()?.status).toBe('running')
    expect(() => service.save({ id: schedule.id, projectId: 'project-1', workflowId: 'workflow-1', timezone: 'UTC' }))
      .toThrow('cannot be reused')
  })

  it('keeps core cadence paused until device approval and lets Run now use a paused approval', async () => {
    let coreRow = {
      key: 'user:schedule', owner: 'user' as const, name: 'Scheduled review', kind: 'workflow',
      cadence: { daily: '09:00' as const }, enabled: true, registered: true, nextRunAt: Date.now() + 60_000,
    }
    const scheduler = {
      list: vi.fn(async () => [coreRow]),
      create: vi.fn(async () => coreRow),
      patch: vi.fn(async (_key: string, patch: { enabled?: boolean; cadence?: typeof coreRow.cadence; name?: string }) => {
        coreRow = { ...coreRow, ...patch }
        return coreRow
      }),
      runNow: vi.fn(async () => ({})),
      remove: vi.fn(async () => {}),
    }
    const managed = new WorkflowScheduleService(
      database.db,
      starts as unknown as WorkflowStartService,
      { tasks, projects: {} } as unknown as Pick<CompiledCoreServices, 'tasks' | 'projects'>,
      Promise.resolve(),
      { scheduler: () => scheduler },
    )
    const saved = await managed.saveManaged({ projectId: 'project-1', workflowId: 'workflow-1', timezone: 'Pacific/Auckland', cadence: { daily: '09:00' }, inputs: { count: 7 } })
    expect(saved.state).toBe('draft')
    expect(scheduler.patch).toHaveBeenLastCalledWith(coreRow.key, expect.objectContaining({ enabled: false }))

    await managed.approve(saved.id, 'process-current')
    expect(scheduler.patch).toHaveBeenLastCalledWith(coreRow.key, { enabled: true })
    expect(managed.get(saved.id)?.inputsJson).toBe('{"count":7}')

    expect((await managed.pause(saved.id, true)).state).toBe('paused')
    await managed.runNow(saved.id)
    expect(scheduler.runNow).toHaveBeenCalledWith(coreRow.key)
    coreRow = { ...coreRow, registered: false }
    expect((await managed.view(saved.id)).state).toBe('unavailable')
  })

  it('returns a device read model without approval hashes, epochs, tokens, or occurrence request keys', async () => {
    const schedule = await approved()
    await service.dispatch(schedule.id, { reason: 'manual', requestKey: 'private-request' })
    const encoded = JSON.stringify(await service.view(schedule.id))
    expect(encoded).not.toContain(schedule.epoch)
    expect(encoded).not.toContain(schedule.approvedGraphDigest!)
    expect(encoded).not.toContain('private-request')
    expect(encoded).toContain('"state":"active"')
  })

  it('retains processing history on review by default and starts fresh only when explicitly chosen', async () => {
    const approvedSchedule = await approved()
    const originalEpoch = approvedSchedule.epoch
    const originalApproval = approvedSchedule.approvedGraphJson

    const edited = service.save({
      id: approvedSchedule.id,
      projectId: 'project-1',
      workflowId: 'workflow-1',
      timezone: 'UTC',
      inputs: { count: 3 },
    })
    expect(edited).toMatchObject({ state: 'needs-review', epoch: originalEpoch, approvedGraphJson: originalApproval })

    const retained = await service.approve(edited.id, 'process-current')
    expect(retained.epoch).toBe(originalEpoch)
    service.save({ id: retained.id, projectId: 'project-1', workflowId: 'workflow-1', timezone: 'UTC', inputs: { count: 4 } })
    const fresh = await service.approve(retained.id, 'process-current', true)
    expect(fresh.epoch).not.toBe(originalEpoch)
  })
})
