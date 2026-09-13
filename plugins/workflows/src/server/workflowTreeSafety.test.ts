import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { makeTestPluginDb, type TestPluginDb } from '@acorn/plugin-api/testkit'
import * as schema from '../node/schema'
import type { WorkflowRunRow } from '../shared/workflowContracts'
import {
  childSafetyEnvelope,
  parseEffectiveTools,
  WorkflowSafetyRailError,
  WorkflowTreeSafety,
} from './workflowTreeSafety'

const at = Date.now()

describe('workflow tree safety', () => {
  let store: TestPluginDb

  beforeEach(() => {
    store = makeTestPluginDb('workflows')
  })

  afterEach(() => store.cleanup())

  const insertRun = async (
    id: string,
    options: { rootRunId?: string; parentRunId?: string; depth?: number; budget?: object; tools?: object; deadlineAt?: number } = {},
  ): Promise<WorkflowRunRow> => {
    await store.db.insert(schema.workflowRuns).values({
      id,
      taskId: `${id}-task`,
      name: id,
      status: 'running',
      posture: 'gated',
      trigger: 'manual',
      defJson: JSON.stringify({ name: id, steps: [{ name: 'work' }] }),
      rootRunId: options.rootRunId ?? id,
      parentRunId: options.parentRunId ?? null,
      parentStepId: options.parentRunId ? 'parent-step' : null,
      depth: options.depth ?? 0,
      effectiveToolsJson: JSON.stringify(options.tools ?? {}),
      effectiveBudgetJson: JSON.stringify(options.budget ?? {}),
      deadlineAt: options.deadlineAt ?? null,
      createdAt: at,
      updatedAt: at,
    })
    const [run] = await store.db.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.id, id))
    return run!
  }

  const insertStep = async (runId: string, id: string) => {
    await store.db.insert(schema.workflowSteps).values({
      id,
      runId,
      idx: 0,
      name: 'work',
      kind: 'agent',
      mode: 'headless',
      status: 'running',
      createdAt: at,
      updatedAt: at,
    })
    const [step] = await store.db.select().from(schema.workflowSteps).where(eq(schema.workflowSteps.id, id))
    return step!
  }

  it('intersects root, dispatch, and child authority without extending the ancestor deadline', async () => {
    const parent = await insertRun('root', {
      tools: { allow: ['read', 'write'], maxRisk: 'write' },
      budget: { maxTurns: 8, maxCostUsd: 5 },
      deadlineAt: at + 10_000,
    })
    const envelope = childSafetyEnvelope(
      parent,
      { tools: { allow: ['read'], maxRisk: 'read' }, budget: { maxTurns: 4 } },
      { tools: { allow: ['read', 'execute'] }, budget: { maxCostUsd: 2, maxWallTimeMs: 20_000 } },
      at,
    )

    expect(envelope).toEqual({
      tools: { allow: ['read'], maxRisk: 'read' },
      budget: { maxWallTimeMs: 20_000, maxCostUsd: 2, maxInputTokens: undefined, maxOutputTokens: undefined, maxTurns: 4 },
      deadlineAt: at + 10_000,
    })
  })

  it('fails closed when persisted tool authority cannot be enforced', async () => {
    const run = await insertRun('root')
    const malformed = { ...run, effectiveToolsJson: '{"allow":"notes_list"}' }

    expect(parseEffectiveTools(malformed)).toEqual({ allow: [] })
    expect(childSafetyEnvelope(malformed, {}, {}, at).tools).toEqual({ allow: [] })
  })

  it('atomically admits only the final available turn across concurrent steps', async () => {
    const safety = new WorkflowTreeSafety(store.db, (() => {
      let id = 0
      return () => `turn-${++id}`
    })())
    const run = await insertRun('root', { budget: { maxTurns: 1 } })
    const left = await insertStep(run.id, 'left')
    const right = await insertStep(run.id, 'right')

    const results = await Promise.allSettled([
      Promise.resolve().then(() => safety.reserveTurn(run, left, {})),
      Promise.resolve().then(() => safety.reserveTurn(run, right, {})),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: expect.any(WorkflowSafetyRailError),
    })
    expect(await store.db.select().from(schema.workflowTurnAdmissions)).toHaveLength(1)
  })

  it('admits an active sibling turn while another branch keeps the run gated', async () => {
    const safety = new WorkflowTreeSafety(store.db, () => 'turn')
    const run = await insertRun('root', { budget: { maxTurns: 2 } })
    await store.db.update(schema.workflowRuns).set({ status: 'gated' })
      .where(eq(schema.workflowRuns.id, run.id))
    const step = await insertStep(run.id, 'active-step')
    const [gatedRun] = await store.db.select().from(schema.workflowRuns)
      .where(eq(schema.workflowRuns.id, run.id))

    expect(safety.reserveTurn(gatedRun!, step, {})).toBe('turn')
  })

  it('counts failed child usage once and ignores a duplicate terminal usage update', async () => {
    const safety = new WorkflowTreeSafety(store.db, () => 'turn')
    await insertRun('root', { budget: { maxCostUsd: 3 } })
    const child = await insertRun('child', { rootRunId: 'root', parentRunId: 'root', depth: 1 })
    const step = await insertStep(child.id, 'child-step')
    const admission = safety.reserveTurn(child, step, {})

    expect(await safety.settleTurn(
      admission,
      { costUsd: 1.25, inputTokens: 10, outputTokens: 5 },
      'provider failed after reporting usage',
    )).toBeNull()
    expect(await safety.settleTurn(admission, { costUsd: 99, inputTokens: 99, outputTokens: 99 })).toBeNull()
    expect(await safety.usage('root')).toEqual({ costUsd: 1.25, inputTokens: 10, outputTokens: 5 })
  })

  it('settles crash-time reservations without restoring the spent turn allowance', async () => {
    const safety = new WorkflowTreeSafety(store.db, () => 'turn')
    const run = await insertRun('root', { budget: { maxTurns: 1 } })
    const step = await insertStep(run.id, 'step')
    safety.reserveTurn(run, step, {})

    expect(await safety.recover()).toBe(1)
    await expect(Promise.resolve().then(() => safety.reserveTurn(run, step, {})))
      .rejects.toThrow('turn budget exhausted')
    const [admission] = await store.db.select().from(schema.workflowTurnAdmissions)
    expect(admission).toMatchObject({
      state: 'settled',
      error: 'Provider usage was unavailable after restart; the admitted turn remains counted.',
    })
  })
})
