import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  makeTestCoreServices,
  makeTestDb,
  makeTestPluginDb,
  schema as coreSchema,
  type TestDb,
  type TestPluginDb,
} from '@acorn/plugin-api/testkit'
import * as schema from '../node/schema'
import type { WorkflowDef } from '../shared/workflowContracts'
import { WorkflowDispatcher, type WorkflowDispatchRequest } from './workflowDispatch'
import { WorkflowRunner, type RunnerDeps } from './workflowRunner'

const at = Date.now()
const CHILD: WorkflowDef = {
  name: 'Child review',
  steps: [{ name: 'approval', kind: 'gate-human' }],
}

const deps = (): RunnerDeps => ({
  runStep: vi.fn(async () => { throw new Error('The gate-only fixture must not run an agent.') }),
  writeHandoff: vi.fn(async () => undefined),
  assembleContext: vi.fn(async () => ''),
  evaluatePolicy: vi.fn(async () => ({ pass: true })),
  failingChecks: vi.fn(async () => ''),
  notify: vi.fn(),
})

describe('durable workflow dispatch', () => {
  let core: TestDb
  let workflows: TestPluginDb
  let runner: WorkflowRunner
  let tasks: ReturnType<typeof makeTestCoreServices>['tasks']

  beforeEach(async () => {
    core = makeTestDb()
    workflows = makeTestPluginDb('workflows')
    runner = new WorkflowRunner(workflows.db, deps())
    tasks = makeTestCoreServices(core).tasks
    await core.db.insert(coreSchema.workspaces).values({
      id: 'workspace-one', name: 'Workspace', isDefault: true, sort: 0, createdAt: at, updatedAt: at,
    })
    await core.db.insert(coreSchema.projects).values({
      id: 'project-one', name: 'Project', path: null, workspaceId: 'workspace-one', sort: 0,
      hidden: false, vcs: 'git', defaultBranch: 'main', remoteUrl: null, githubOwner: null,
      githubName: null, githubRepoId: null, createdAt: at, updatedAt: at,
    })
    await core.db.insert(coreSchema.tasks).values({
      id: 'parent-task', title: 'Parent', origin: 'local', projectId: 'project-one', branch: 'parent',
      worktreePath: null, pullNumber: null, status: 'active', parentId: null, sort: 0,
      createdAt: at, updatedAt: at,
    })
    await workflows.db.insert(schema.workflowRuns).values({
      id: 'parent-run', taskId: 'parent-task', name: 'Parent workflow', status: 'gated',
      posture: 'gated', trigger: 'manual', defJson: JSON.stringify({
        name: 'Parent workflow',
        steps: [{ name: 'dispatch', kind: 'workflow' }],
      }),
      rootRunId: 'parent-run', parentRunId: null, parentStepId: null, depth: 0,
      invocationKey: null, payloadFingerprint: null, createdAt: at, updatedAt: at,
    })
    await workflows.db.insert(schema.workflowSteps).values({
      id: 'dispatch-step', runId: 'parent-run', idx: 0, name: 'dispatch', kind: 'workflow',
      mode: 'headless', status: 'running', createdAt: at, updatedAt: at,
    })
  })

  afterEach(async () => {
    const deadline = Date.now() + 2_000
    while ((await workflows.db.select().from(schema.workflowRuns)).some((row) => row.status === 'running')) {
      if (Date.now() > deadline) throw new Error('A workflow fixture did not settle before cleanup.')
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    runner.stop()
    await new Promise((resolve) => setTimeout(resolve, 10))
    workflows.cleanup()
    core.cleanup()
  })

  const request = (overrides: Partial<WorkflowDispatchRequest> = {}): WorkflowDispatchRequest => ({
    callerKey: 'parent-run:dispatch-step:item-1',
    parentRunId: 'parent-run',
    parentStepId: 'dispatch-step',
    itemKey: 'item-1',
    task: { title: 'Review item 1', branch: 'review-item-1' },
    workflow: CHILD,
    ...overrides,
  })

  it('converges concurrent requests and a replay after a lost acknowledgement', async () => {
    const dispatcher = new WorkflowDispatcher(workflows.db, runner, tasks)
    const [left, right] = await Promise.all([dispatcher.dispatch(request()), dispatcher.dispatch(request())])

    expect(left).toEqual(right)
    expect(left.state).toBe('run-started')
    expect((await core.db.select().from(coreSchema.tasks).where(eq(coreSchema.tasks.parentId, 'parent-task')))).toHaveLength(1)
    expect((await workflows.db.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.id, left.runId)))).toHaveLength(1)
    expect(await runner.steps(left.runId)).toHaveLength(1)
    expect(await dispatcher.dispatch(request())).toEqual(left)

    await expect(dispatcher.dispatch(request({ task: { title: 'A different task', branch: 'different' } })))
      .rejects.toThrow(/reused with a different payload/)
  })

  it('starts an intended run and its roster atomically, then verifies replays', async () => {
    const workflow = { ...CHILD, budget: { maxWallTimeMs: 10_000 } }
    const options = {
      intendedRunId: 'reserved-run',
      invocation: {
        callerKey: 'reserved-caller',
        payloadFingerprint: 'fingerprint-one',
        rootRunId: 'reserved-run',
        parentRunId: null,
        parentStepId: null,
        depth: 0,
      },
    }
    expect(await runner.start('parent-task', workflow, options)).toBe('reserved-run')
    const firstDeadline = (await runner.run('reserved-run'))?.deadlineAt
    expect(await runner.start('parent-task', workflow, options)).toBe('reserved-run')

    const [run] = await workflows.db.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.id, 'reserved-run'))
    expect(run).toMatchObject({
      rootRunId: 'reserved-run',
      depth: 0,
      invocationKey: 'reserved-caller',
      deadlineAt: firstDeadline,
    })
    expect(await runner.steps('reserved-run')).toHaveLength(1)
    await expect(runner.start('parent-task', workflow, {
      ...options,
      invocation: { ...options.invocation, payloadFingerprint: 'fingerprint-two' },
    })).rejects.toThrow(/conflicts with an existing run/)
  })

  it('recovers an ambiguous task-creation response with the reserved task ID', async () => {
    let first = true
    const ambiguousTasks = {
      createChild: async (...args: Parameters<typeof tasks.createChild>) => {
        const id = await tasks.createChild(...args)
        if (first) {
          first = false
          throw new Error('connection closed after task commit')
        }
        return id
      },
    }
    const crashed = new WorkflowDispatcher(workflows.db, runner, ambiguousTasks)
    await expect(crashed.dispatch(request())).rejects.toThrow(/connection closed/)
    const [reserved] = await workflows.db.select().from(schema.workflowDispatches)
    expect(reserved.state).toBe('reserved')
    expect(reserved.error).toContain('connection closed')

    const restarted = new WorkflowDispatcher(workflows.db, runner, tasks)
    expect(await restarted.reconcile()).toEqual({ reconciled: 1, errors: [] })
    expect((await core.db.select().from(coreSchema.tasks).where(eq(coreSchema.tasks.id, reserved.taskId)))).toHaveLength(1)
    expect((await workflows.db.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.id, reserved.runId)))).toHaveLength(1)
    expect(await runner.steps(reserved.runId)).toHaveLength(1)
  })

  it('recovers an ambiguous run-creation response across two restarts', async () => {
    let first = true
    const ambiguousRunner = {
      start: async (...args: Parameters<typeof runner.start>) => {
        const id = await runner.start(...args)
        if (first) {
          first = false
          throw new Error('connection closed after run commit')
        }
        return id
      },
    }
    const crashed = new WorkflowDispatcher(workflows.db, ambiguousRunner, tasks)
    await expect(crashed.dispatch(request())).rejects.toThrow(/connection closed/)
    const [partial] = await workflows.db.select().from(schema.workflowDispatches)
    expect(partial.state).toBe('task-created')

    const firstRestart = new WorkflowDispatcher(workflows.db, runner, tasks)
    expect(await firstRestart.reconcile()).toEqual({ reconciled: 1, errors: [] })
    const secondRestart = new WorkflowDispatcher(workflows.db, runner, tasks)
    expect(await secondRestart.reconcile()).toEqual({ reconciled: 0, errors: [] })
    expect((await core.db.select().from(coreSchema.tasks).where(eq(coreSchema.tasks.id, partial.taskId)))).toHaveLength(1)
    expect((await workflows.db.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.id, partial.runId)))).toHaveLength(1)
    expect(await runner.steps(partial.runId)).toHaveLength(1)
  })

  it('keeps a reservation after a failure before task creation', async () => {
    const unavailableTasks = { createChild: vi.fn(async () => { throw new Error('core unavailable') }) }
    const crashed = new WorkflowDispatcher(workflows.db, runner, unavailableTasks)
    await expect(crashed.dispatch(request())).rejects.toThrow(/core unavailable/)

    const [reserved] = await workflows.db.select().from(schema.workflowDispatches)
    expect(reserved).toMatchObject({ state: 'reserved', error: 'core unavailable' })
    expect(await core.db.select().from(coreSchema.tasks).where(eq(coreSchema.tasks.parentId, 'parent-task'))).toEqual([])
  })

  it('atomically reserves only the final descendant task across dispatch steps', async () => {
    await workflows.db.update(schema.workflowRuns).set({
      defJson: JSON.stringify({
        name: 'Parent workflow',
        steps: [
          { name: 'dispatch', kind: 'workflow' },
          { name: 'dispatch-two', kind: 'workflow', after: [] },
        ],
      }),
    }).where(eq(schema.workflowRuns.id, 'parent-run'))
    await workflows.db.insert(schema.workflowSteps).values({
      id: 'dispatch-step-two', runId: 'parent-run', idx: 1, name: 'dispatch-two', kind: 'workflow',
      mode: 'headless', status: 'running', createdAt: at, updatedAt: at,
    })
    for (let index = 0; index < 11; index += 1) {
      await workflows.db.insert(schema.workflowDispatches).values({
        id: `prior-${index}`,
        callerKey: `prior-${index}`,
        payloadFingerprint: `prior-${index}`,
        payloadJson: '{}',
        parentTaskId: 'parent-task',
        taskId: `prior-task-${index}`,
        runId: `prior-run-${index}`,
        rootRunId: 'parent-run',
        parentRunId: 'parent-run',
        parentStepId: 'dispatch-step',
        state: 'terminal',
        createdAt: at - 100 + index,
        updatedAt: at - 100 + index,
      })
    }
    const dispatcher = new WorkflowDispatcher(workflows.db, runner, tasks)
    const outcomes = await Promise.allSettled([
      dispatcher.dispatch(request({ callerKey: 'final-left', itemKey: 'left' })),
      dispatcher.dispatch(request({
        callerKey: 'final-right',
        parentStepId: 'dispatch-step-two',
        itemKey: 'right',
        task: { title: 'Review right', branch: 'review-right' },
      })),
    ])

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1)
    expect(await workflows.db.select().from(schema.workflowDispatches)).toHaveLength(12)
  })

  it('fails closed when repository trust is revoked before child task creation', async () => {
    await workflows.db.update(schema.workflowRuns).set({ requiresRepoTrust: true })
      .where(eq(schema.workflowRuns.id, 'parent-run'))
    const createChild = vi.fn(async () => 'child-task')
    const dispatcher = new WorkflowDispatcher(workflows.db, runner, { createChild }, {
      authorizeRepoConfig: async () => { throw new Error('repository trust revoked') },
    })

    await expect(dispatcher.dispatch(request())).rejects.toThrow('repository trust revoked')
    expect(createChild).not.toHaveBeenCalled()
    expect((await workflows.db.select().from(schema.workflowDispatches))[0]).toMatchObject({
      state: 'reserved',
      error: 'repository trust revoked',
    })
  })

  it('rejects a child attempt to dispatch a grandchild', async () => {
    await workflows.db.update(schema.workflowRuns).set({
      rootRunId: 'root-run',
      parentRunId: 'root-run',
      parentStepId: 'root-step',
      depth: 1,
    }).where(eq(schema.workflowRuns.id, 'parent-run'))
    const dispatcher = new WorkflowDispatcher(workflows.db, runner, tasks)

    await expect(dispatcher.dispatch(request())).rejects.toThrow('cannot dispatch another workflow')
    expect(await workflows.db.select().from(schema.workflowDispatches)).toEqual([])
  })
})

describe('workflow dispatch migration', () => {
  it('backfills legacy runs as roots without inventing parent lineage', () => {
    const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../migrations')
    const db = new DatabaseSync(':memory:')
    const apply = (tag: string) => {
      const sql = readFileSync(resolve(migrationsDir, `${tag}.sql`), 'utf8')
      for (const statement of sql.split('--> statement-breakpoint')) if (statement.trim()) db.exec(statement)
    }
    apply('0000_funny_prism')
    apply('0001_lying_overlord')
    db.prepare(`
      INSERT INTO workflow_runs
        (id, task_id, name, status, posture, trigger, def_json, error, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'legacy-run',
      'legacy-task',
      'Legacy',
      'done',
      'gated',
      'manual',
      '{"name":"Legacy","tools":{"maxRisk":"read"},"budget":{"maxWallTimeMs":1000,"maxTurns":2},"steps":[]}',
      null,
      at,
      at,
    )

    apply('0002_needy_wind_dancer')
    expect(db.prepare(`
      SELECT root_run_id, parent_run_id, parent_step_id, depth, invocation_key, payload_fingerprint
      FROM workflow_runs WHERE id = ?
    `).get('legacy-run')).toEqual({
      root_run_id: 'legacy-run',
      parent_run_id: null,
      parent_step_id: null,
      depth: 0,
      invocation_key: null,
      payload_fingerprint: null,
    })
    apply('0003_thick_bill_hollister')
    apply('0004_productive_justice')
    expect(db.prepare(`
      SELECT effective_tools_json, effective_budget_json, requires_repo_trust, deadline_at
      FROM workflow_runs WHERE id = ?
    `).get('legacy-run')).toEqual({
      effective_tools_json: '{"maxRisk":"read"}',
      effective_budget_json: '{"maxWallTimeMs":1000,"maxTurns":2}',
      requires_repo_trust: 0,
      deadline_at: at + 1_000,
    })
    db.close()
  })
})
