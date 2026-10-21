import { describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import type { DataRecord } from '@acorn/protocol/dataSources.ts'
import * as schema from '../../node/schema'
import type { WorkflowRecordsWhen, WorkflowTriggerFirstCheck } from '../../shared/workflowTriggers'
import { reviewTriggersAfterPublication } from './approval'
import { graph, task, useTriggerHarness } from './test/triggerHarness'

describe('a record trigger', () => {
  const t = useTriggerHarness()

  /** A workflow that takes the record's title as `issue`, and an optional number. */
  const issueGraph = () => {
    const base = graph()
    const inputs = [
      { name: 'issue', required: true },
      { name: 'count', schema: { type: 'number' as const } },
    ]
    const root = { ...base.root, inputs }
    return { ...base, root, nodes: [{ ...base.nodes[0]!, definition: root, defaultInputs: {} }] }
  }

  const approve = async (
    when: Partial<WorkflowRecordsWhen> = {},
    firstCheck: WorkflowTriggerFirstCheck = 'process-current',
  ) => {
    t.currentGraph = issueGraph()
    const saved = t.service.save({
      projectId: 'project-1',
      workflowId: 'workflow-1',
      when: { kind: 'records', query: { kind: 'saved', queryId: 'q-1', bindings: {} }, change: { on: 'new' }, ...when },
    })
    return t.service.approve(saved.id, firstCheck)
  }
  const check = (id: string) => t.service.dispatch(id, { reason: 'due', dueAt: Date.now() })
  const runs = () => t.database.db.select().from(schema.workflowRuns).all()
  const settleAll = async () => {
    for (const run of runs().filter((candidate) => candidate.status === 'running')) {
      t.database.db.update(schema.workflowRuns).set({ status: 'done' }).where(eq(schema.workflowRuns.id, run.id)).run()
      await t.service.settleRun(run.id)
    }
  }
  const returns = (...records: DataRecord[]) => {
    t.source.records = records
  }

  it('starts one run per new record, each in its own task with the title in issue', async () => {
    const trigger = await approve()
    returns(task('t-1', 'Triage the inbox'), task('t-2', 'Triage the backlog'))
    expect(await check(trigger.id)).toBe('started 2 workflow runs')
    expect(t.tasks.createRoot).toHaveBeenCalledWith(
      'project-1',
      expect.objectContaining({ title: 'Scheduled review · Triage the inbox', origin: 'workflows:trigger' }),
      expect.any(String),
    )
    expect(t.starts.startTriggered.mock.calls.map(([request]) => request.inputs.issue)).toEqual([
      'Triage the inbox',
      'Triage the backlog',
    ])
    await settleAll()
    expect(await check(trigger.id)).toBeUndefined()
    expect(t.occurrences()).toHaveLength(2)
  })

  it('shows the latest of its runs, the last one saved when they share a time', async () => {
    const trigger = await approve()
    returns(task('t-1', 'One'), task('t-2', 'Two'), task('t-3', 'Three'))
    await check(trigger.id)
    t.database.db.update(schema.workflowTriggerOccurrences).set({ updatedAt: 1 }).run()
    const latest = t.occurrences().at(-1)!
    expect((await t.service.view(trigger.id)).latest).toMatchObject({ taskId: latest.taskId, runId: latest.runId })
  })

  it('starts again when a record stops matching and starts again', async () => {
    const trigger = await approve({ change: { on: 'enters' } })
    returns(task('t-1', 'Failing'))
    await check(trigger.id)
    await settleAll()
    await check(trigger.id)
    expect(t.occurrences()).toHaveLength(1)
    returns()
    await check(trigger.id)
    returns(task('t-1', 'Failing'))
    expect(await check(trigger.id)).toBe('started 1 workflow run')
    expect(t.occurrences()).toHaveLength(2)
  })

  it('starts when a tracked field changes, and not when another does', async () => {
    const trigger = await approve({ change: { on: 'changes', fields: ['/data/status'] } })
    returns(task('t-1', 'Ship it', 'open'))
    await check(trigger.id)
    await settleAll()
    returns({ ...task('t-1', 'Ship it now', 'open') })
    expect(await check(trigger.id)).toBeUndefined()
    returns(task('t-1', 'Ship it now', 'done'))
    expect(await check(trigger.id)).toBe('started 1 workflow run')
  })

  it("doesn't mark records stopped after a read that returned part of the matches", async () => {
    const trigger = await approve({ change: { on: 'enters' } })
    returns(task('t-1', 'Failing'), task('t-2', 'Also failing'))
    await check(trigger.id)
    await settleAll()
    returns(task('t-2', 'Also failing'))
    t.source.completeness = { kind: 'incomplete', cause: 'upstream-cap' }
    await check(trigger.id)
    expect((await t.service.view(trigger.id)).lastCheck).toMatchObject({
      started: 0,
      partial: 'The source caps how many matches it returns.',
    })
    t.source.completeness = { kind: 'complete' }
    returns(task('t-1', 'Failing'), task('t-2', 'Also failing'))
    expect(await check(trigger.id)).toBeUndefined()
  })

  it('leaves records over the per-check cap for the next check', async () => {
    const trigger = await approve({ runsPerCheck: 2 })
    returns(...['1', '2', '3', '4', '5'].map((id) => task(id, `Triage ${id}`)))
    const started = [await check(trigger.id), await check(trigger.id), await check(trigger.id)]
    expect(started).toEqual(['started 2 workflow runs', 'started 2 workflow runs', 'started 1 workflow run'])
    expect(await check(trigger.id)).toBeUndefined()
  })

  it('resumes the same task and run after a crash between the commit and the task', async () => {
    const trigger = await approve()
    returns(task('t-1', 'Triage'))
    t.tasks.createRoot.mockRejectedValueOnce(new Error('Node stopped'))
    expect(await check(trigger.id)).toBeUndefined()
    expect(t.occurrence().state).toBe('claimed')
    await check(trigger.id)
    expect(t.occurrences()).toHaveLength(1)
    expect(t.occurrence()).toMatchObject({ state: 'run-started' })
    expect(runs().map((run) => run.id)).toEqual([t.occurrence().runId])
  })

  it('lets the Node answer a timer between the chunks of a 5,000-record check', async () => {
    returns(...Array.from({ length: 5_000 }, (_, index) => task(`t-${index}`, `Triage ${index}`)))
    let ticks = 0
    const timer = setInterval(() => ticks++, 0)
    const trigger = await approve({}, 'track-now')
    clearInterval(timer)
    expect(trigger.state).toBe('active')
    expect(t.database.db.select().from(schema.workflowTriggerRecords).all()).toHaveLength(5_000)
    // Ten chunks of 500 leave nine turns for the timer. Without them it ticks about once.
    expect(ticks).toBeGreaterThanOrEqual(5)
  })

  it('tracks from now in place: the trigger is active at once and starts nothing for current matches', async () => {
    returns(task('t-1', 'Already here'))
    const trigger = await approve({}, 'track-now')
    expect(trigger.state).toBe('active')
    expect(t.occurrences()).toHaveLength(0)
    returns(task('t-1', 'Already here'), task('t-2', 'New one'))
    expect(await check(trigger.id)).toBe('started 1 workflow run')
  })

  it('starts nothing for a record whose run is still going, and sees its change afterwards', async () => {
    const trigger = await approve({ change: { on: 'changes', fields: ['/data/status'] } })
    returns(task('t-1', 'Ship it', 'open'))
    await check(trigger.id)
    returns(task('t-1', 'Ship it', 'review'))
    expect(await check(trigger.id)).toBeUndefined()
    expect(t.occurrences()).toHaveLength(1)
    await settleAll()
    expect(await check(trigger.id)).toBe('started 1 workflow run')
  })

  it('never admits a run it started, read back through the Workflow runs source', async () => {
    const trigger = await approve({ change: { on: 'enters' } })
    returns(task('t-1', 'Failing'))
    await check(trigger.id)
    const own = runs()[0]!
    const runRecord = (id: string): DataRecord => ({
      ref: { pluginId: 'workflows', sourceId: 'runs', recordId: id },
      data: { status: 'failed' },
      display: { title: id },
    })
    returns(runRecord(own.id), runRecord('someone-elses-run'))
    expect(await check(trigger.id)).toBe('started 1 workflow run')
    expect(t.starts.startTriggered.mock.calls.at(-1)![0].inputs.issue).toBe('someone-elses-run')
  })

  it("never admits the task it made for a run, though the task's title matches", async () => {
    const trigger = await approve()
    returns(task('t-1', 'Triage the inbox'))
    await check(trigger.id)
    const made = t.occurrence().taskId
    returns(task('t-1', 'Triage the inbox'), task(made, 'Scheduled review · Triage the inbox'))
    expect(await check(trigger.id)).toBeUndefined()
    expect(t.occurrences()).toHaveLength(1)
    const when = JSON.parse(trigger.whenJson)
    const preview = await t.service.preview({ id: trigger.id, projectId: 'project-1', workflowId: 'workflow-1', when })
    expect(preview.records.map((record) => record.wouldStart)).toEqual([false, false])
  })

  it('moves to review at the daily cap, after starting what fit', async () => {
    const trigger = await approve({ runsPerDay: 3 })
    returns(...['1', '2', '3', '4'].map((id) => task(id, `Triage ${id}`)))
    expect(await check(trigger.id)).toBe('started 3 workflow runs')
    expect(t.service.get(trigger.id)).toMatchObject({
      state: 'needs-review',
      error: 'Started 3 runs today. Review the trigger before it starts more.',
    })
  })

  it('moves to review when its saved query is republished', async () => {
    const trigger = await approve()
    reviewTriggersAfterPublication(t.database.db, new Set(), new Set(['q-1']))
    expect(t.service.get(trigger.id)?.state).toBe('needs-review')
    expect(t.reader.consume).toHaveBeenCalledWith(
      'project-1',
      'q-1',
      { id: trigger.id, name: 'Scheduled review trigger', href: '/workflows/db:workflow-1' },
      false,
    )
  })

  it('blocks a record whose bound value fails its input type, and starts the rest', async () => {
    const trigger = await approve({ bindings: { count: { address: { from: 'item', pointer: '/data/title' } } } })
    returns(task('t-1', 'Not a number'), { ...task('t-2', 'Numbered'), data: { title: 7, status: 'open' } })
    expect(await check(trigger.id)).toBe('started 1 workflow run')
    const blocked = t.occurrences().find((occurrence) => occurrence.state === 'blocked')
    expect(blocked?.detail).toMatch(/^Not a number: input 'count'/)
    expect((await t.service.detail(trigger.id)).matches?.map((match) => [match.title, match.state])).toEqual(
      expect.arrayContaining([
        ['Not a number', 'blocked'],
        ['Numbered', 'active'],
      ]),
    )
  })

  it('wakes the record triggers that read a changed source', async () => {
    const scheduler = {
      list: vi.fn(async () => []),
      create: vi.fn(async () => ({ key: 'user:records' }) as never),
      patch: vi.fn(async () => ({}) as never),
      runNow: vi.fn(async () => ({})),
      wake: vi.fn(),
      remove: vi.fn(async () => {}),
    }
    const managed = t.serviceFor(t.database.db, () => scheduler)
    t.currentGraph = issueGraph()
    const saved = await managed.saveManaged({
      projectId: 'project-1',
      workflowId: 'workflow-1',
      when: { kind: 'records', query: { kind: 'saved', queryId: 'q-1', bindings: {} }, change: { on: 'new' } },
      cadence: { every: 300 },
    })
    await managed.approve(saved.id, 'process-current')
    managed.heard({ pluginId: 'github', sourceId: 'pull-requests' })
    expect(scheduler.wake).not.toHaveBeenCalled()
    managed.heard({ pluginId: 'core', sourceId: 'tasks' })
    expect(scheduler.wake).toHaveBeenCalledWith('user:records', { minGapMs: 15_000 })
  })
})
