import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestPluginDb, type TestPluginDb } from '@acorn/plugin-api/testkit'
import * as schema from '../node/schema'
import { workflowRunById, workflowRunsForTask, workflowStepStatuses } from './workflowRunReadModel'

const at = 100

describe('workflow run read model', () => {
  let store: TestPluginDb

  beforeEach(() => { store = makeTestPluginDb('workflows') })
  afterEach(() => store.cleanup())

  it('projects explicit parent and root tasks and counts each provider turn once', async () => {
    await store.db.insert(schema.workflowRuns).values([
      {
        id: 'root-run', taskId: 'root-task', name: 'Ticket review batch', status: 'running', posture: 'gated',
        trigger: 'manual', defJson: '{"name":"Ticket review batch","steps":[]}', rootRunId: 'root-run',
        parentRunId: null, parentStepId: null, depth: 0, createdAt: at, updatedAt: at,
      },
      {
        id: 'child-run', taskId: 'child-task', name: 'Review ticket', status: 'done', posture: 'gated',
        trigger: 'workflow', defJson: '{"name":"Review ticket","steps":[]}', rootRunId: 'root-run',
        parentRunId: 'root-run', parentStepId: 'map-step', depth: 1, createdAt: at + 1, updatedAt: at + 2,
      },
    ])
    await store.db.insert(schema.workflowTurnAdmissions).values([
      { id: 'root-turn', rootRunId: 'root-run', runId: 'root-run', stepId: 'source', state: 'settled', costUsd: 0.1, inputTokens: 10, outputTokens: 2, createdAt: at },
      { id: 'child-turn', rootRunId: 'root-run', runId: 'child-run', stepId: 'review', state: 'settled', costUsd: 0.2, inputTokens: 20, outputTokens: 4, createdAt: at },
    ])

    const [child] = await workflowRunsForTask(store.db, 'child-task')
    expect(child).toMatchObject({
      rootTaskId: 'root-task', rootRunName: 'Ticket review batch',
      parentTaskId: 'root-task', parentRunName: 'Ticket review batch',
      usage: { costUsd: 0.2, inputTokens: 20, outputTokens: 4, turns: 1 },
    })

    const [root] = await workflowRunsForTask(store.db, 'root-task')
    expect(root.usage).toMatchObject({ inputTokens: 30, outputTokens: 6, turns: 2 })
    expect(root.usage?.costUsd).toBeCloseTo(0.3)
    expect(await workflowRunById(store.db, 'child-run')).toMatchObject({ id: 'child-run', taskId: 'child-task', rootTaskId: 'root-task' })
    expect(await workflowRunById(store.db, 'missing')).toBeNull()
  })

  it('caps polling at 200 status-only rows and marks the omitted tail', async () => {
    await store.db.insert(schema.workflowSteps).values(Array.from({ length: 201 }, (_, idx) => ({
      id: `s${idx}`, runId: 'run', idx, name: `Step ${idx}`, status: idx === 200 ? 'waiting-gate' : 'done',
      resultJson: 'private result', createdAt: at, updatedAt: at,
    })))
    const result = await workflowStepStatuses(store.db, 'run')
    expect(result.truncated).toBe(true)
    expect(result.steps[0]).toEqual({ id: 's0', status: 'done' })
    expect(result.steps).toHaveLength(200)
    expect(result.steps.at(-1)).toEqual({ id: 's199', status: 'done' })
    expect(JSON.stringify(result)).not.toContain('private result')
  })
})
