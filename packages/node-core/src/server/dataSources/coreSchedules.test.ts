import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { panelPlanSchema } from '@acorn/protocol/dashboards.ts'
import type { DataSourceQuery } from '@acorn/protocol/dataSources.ts'
import { validatePanelPlan } from '@acorn/dashboards-core/plan.ts'
import { memoryIdentityStore } from '../activeIdentity'
import { schema } from '../db'
import { CapabilityRegistry } from '../pluginHost/capabilities'
import { SCHEDULER } from '../schedules'
import { Scheduler } from '../schedules/scheduler'
import { makeTestDb, testEnv, type TestDb } from '../../testkit/db'
import { invokeDataSource } from './runtime'
import { scheduleSourceDescription } from './coreSchedules'
import './coreSchedulesRegistration'

const now = 1_800_000_000_000
// Never fires: these tests read what the scheduler lists, and run schedules by hand.
const clock = { now: () => now, setTimeout: () => null, clearTimeout: () => {}, random: () => 0.5 }

describe('core schedules data source', () => {
  let world: TestDb
  let scheduler: Scheduler
  beforeEach(async () => {
    world = makeTestDb()
    await world.db.insert(schema.workspaces).values([
      { id: 'ws-a', name: 'A', isDefault: true, sort: 0, createdAt: now, updatedAt: now },
      { id: 'ws-b', name: 'B', isDefault: false, sort: 1, createdAt: now, updatedAt: now },
    ])
    const project = (id: string, workspaceId: string) => ({
      id,
      name: `Project ${id}`,
      path: `/tmp/${id}`,
      workspaceId,
      sort: 0,
      hidden: false,
      vcs: 'git' as const,
      defaultBranch: 'main',
      remoteUrl: null,
      githubOwner: null,
      githubName: null,
      githubRepoId: null,
      createdAt: now,
      updatedAt: now,
    })
    await world.db.insert(schema.projects).values([project('a1', 'ws-a'), project('a2', 'ws-a'), project('b1', 'ws-b')])

    scheduler = new Scheduler(world.db, { clock })
    scheduler.register({
      key: 'core:nightly',
      name: 'Nightly sweep',
      cadence: { daily: '03:20' },
      run: async () => {
        throw new Error('disk full')
      },
    })
    // The target is its own scope, so each schedule below says where it belongs.
    scheduler.registerTarget({
      kind: 'job',
      parse: (raw) => raw,
      run: async () => 'done',
      scope: (raw) => raw as { workspaceId?: string; projectId?: string },
    })
    for (const [name, target] of [
      ['In a1', { projectId: 'a1' }],
      ['Across A', { workspaceId: 'ws-a' }],
      ['In b1', { projectId: 'b1' }],
      ['Project gone', { projectId: 'deleted' }],
    ] as const)
      await scheduler.create({ name, kind: 'job', target, cadence: { every: 3600 } })
    await scheduler.start()
    await scheduler.runNow('core:nightly')
  })
  afterEach(async () => {
    await scheduler.stop()
    world.cleanup()
  })

  const query = async (
    scope: { workspaceId?: string; projectId?: string },
    predicate?: DataSourceQuery['predicate'],
  ) => {
    const capabilities = new CapabilityRegistry()
    capabilities.provide(SCHEDULER, scheduler)
    const page = await invokeDataSource(
      testEnv({ DB: world.db, ACTIVE_IDENTITY: memoryIdentityStore('owner'), CAPABILITIES: capabilities }),
      {
        operation: 'query',
        mode: 'execution',
        evaluationTime: now,
        pageSize: 25,
        query: {
          source: { pluginId: 'core', sourceId: 'schedules' },
          scope: { ...scope, parameters: {} },
          sort: [],
          ...(predicate ? { predicate } : {}),
        },
      },
      {
        principal: { kind: 'internal', scope: 'service', userId: 'owner' },
        signal: new AbortController().signal,
      },
    )
    return page.records.map((record) => ({ ...record, data: record.data as Record<string, unknown> }))
  }
  const names = async (scope: { workspaceId?: string; projectId?: string }) =>
    (await query(scope)).map((record) => record.data.name).sort()

  it("shows the Node's schedules everywhere and a scoped one only in its workspace or project", async () => {
    expect(await names({ workspaceId: 'ws-a' })).toEqual(['Across A', 'In a1', 'Nightly sweep'])
    expect(await names({ workspaceId: 'ws-a', projectId: 'a2' })).toEqual(['Across A', 'Nightly sweep'])
    expect(await names({ workspaceId: 'ws-b' })).toEqual(['In b1', 'Nightly sweep'])
    expect(await names({})).toEqual(['Across A', 'In a1', 'In b1', 'Nightly sweep', 'Project gone'])
  })

  it("carries each schedule's owner, cadence, last run, and next run, and opens it in Settings", async () => {
    const [nightly] = await query(
      { workspaceId: 'ws-a' },
      {
        kind: 'comparison',
        left: { address: { from: 'item', pointer: '/lastStatus' } },
        operator: 'eq',
        right: { address: { from: 'literal', value: 'error' } },
      },
    )
    expect(nightly).toMatchObject({
      ref: { pluginId: 'core', sourceId: 'schedules', recordId: 'core:nightly' },
      data: {
        name: 'Nightly sweep',
        owner: 'core',
        pluginId: null,
        kind: 'core',
        enabled: true,
        available: true,
        cadence: 'daily at 03:20',
        periodSeconds: 86_400,
        lastRunAt: now,
        lastStatus: 'error',
        lastError: 'disk full',
        nextRunAt: expect.any(Number),
        projectId: null,
        project: null,
      },
      target: { kind: 'core.schedule', item: 'core:nightly' },
    })
    const [inA1] = (await query({ workspaceId: 'ws-a' })).filter((record) => record.data.name === 'In a1')
    expect(inA1?.data).toMatchObject({ owner: 'user', kind: 'job', projectId: 'a1', project: 'Project a1' })
  })

  it('has no next run for a schedule that is off, or while every schedule is paused', async () => {
    await scheduler.patch('core:nightly', { enabled: false })
    const nextRuns = async () =>
      Object.fromEntries((await query({})).map((record) => [record.data.name, record.data.nextRunAt]))
    expect(await nextRuns()).toMatchObject({ 'Nightly sweep': null, 'In a1': expect.any(Number) })
    const upcoming = await query(
      {},
      {
        kind: 'comparison',
        left: { address: { from: 'item', pointer: '/nextRunAt' } },
        operator: 'ne',
        right: { address: { from: 'literal', value: null } },
      },
    )
    expect(upcoming.map((record) => record.data.name)).not.toContain('Nightly sweep')
    await scheduler.setPaused(true)
    expect(Object.values(await nextRuns()).every((next) => next === null)).toBe(true)
  })

  it('offers starter plans that fit its own description', () => {
    expect(scheduleSourceDescription.starterPlans?.length).toBeGreaterThan(0)
    for (const starter of scheduleSourceDescription.starterPlans ?? []) {
      const plan = panelPlanSchema.parse(starter)
      const sources = plan.sources.map((source) => {
        if (source.reference.kind !== 'inline') throw new Error('A starter reads its source inline.')
        return {
          instanceId: source.id,
          label: source.label,
          query: source.reference.content.query,
          description: scheduleSourceDescription,
        }
      })
      expect(validatePanelPlan(plan, sources), plan.title).toEqual([])
    }
  })
})
