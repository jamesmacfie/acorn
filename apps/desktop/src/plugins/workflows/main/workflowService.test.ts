import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { schema } from '../../../core/server/db'
import { makeTestDb, type TestDb } from '../../../core/server/routes/testDb'
import { WorkflowService, type WorkflowRunnerLike } from './workflowService'
import type { WorkflowDef } from './workflowContracts'

let repoDir: string | null = null
vi.mock('../../../core/main/taskWorktree', () => ({ taskRoot: async () => repoDir }))

const TASK = '55555555-5555-4555-8555-555555555555'
const TOML = `name = "Basic"
posture = "gated"

[[steps]]
name = "plan"
kind = "agent"
prompt = "Do the thing."
`

describe('WorkflowService', () => {
  let t: TestDb
  let dir: string
  let svc: WorkflowService

  const runner: WorkflowRunnerLike = {
    start: async (taskId, def: WorkflowDef) => {
      const id = randomUUID()
      await t.db.insert(schema.workflowRuns).values({
        id, taskId, name: def.name, status: 'running', posture: def.posture ?? 'gated', trigger: 'manual',
        defJson: JSON.stringify(def), createdAt: 1, updatedAt: 1,
      })
      return id
    },
    resolveGate: async () => {},
    cancelRun: async (runId) => {
      await t.db.update(schema.workflowRuns).set({ status: 'cancelled' }).where(eq(schema.workflowRuns.id, runId))
    },
    killStep: async () => {},
    pollTriggers: async () => ({ started: 0, errors: [] }),
  }

  beforeEach(() => {
    t = makeTestDb()
    dir = mkdtempSync(join(tmpdir(), 'acorn-wf-'))
    mkdirSync(join(dir, '.acorn', 'workflows'), { recursive: true })
    writeFileSync(join(dir, '.acorn', 'workflows', 'basic.toml'), TOML)
    repoDir = dir
    svc = new WorkflowService(t.db, runner)
  })
  afterEach(() => {
    repoDir = null
    t.cleanup()
    rmSync(dir, { recursive: true, force: true })
  })

  it('lists validated definitions from .acorn/workflows', async () => {
    const defs = await svc.definitions(TASK)
    expect(defs.items.map((d) => d.id)).toContain('basic')
    expect(defs.items[0]).toMatchObject({ name: 'Basic', source: 'repo', posture: 'gated' })
  })

  it('starts a run by definitionId and reads it back with parsed def JSON', async () => {
    const run = await svc.startRun(TASK, 'basic', 'autonomous')
    expect(run.status).toBe('running')
    expect(run.posture).toBe('autonomous')
    expect((run.def as { name: string }).name).toBe('Basic')

    const runs = await svc.listRuns(TASK)
    expect(runs).toHaveLength(1)
    expect(await svc.getRun(run.id)).toMatchObject({ id: run.id })
  })

  it('404s an unknown definition id and an unknown run', async () => {
    await expect(svc.startRun(TASK, 'ghost', undefined)).rejects.toMatchObject({ code: 'not_found' })
    await expect(svc.getRun('66666666-6666-4666-8666-666666666666')).rejects.toMatchObject({ code: 'not_found' })
  })

  it('cancels a run and projects steps with parsed structured JSON', async () => {
    const run = await svc.startRun(TASK, 'basic', undefined)
    await t.db.insert(schema.workflowSteps).values({
      id: randomUUID(), runId: run.id, idx: 0, name: 'plan', kind: 'agent', mode: 'ai', status: 'done',
      structuredJson: JSON.stringify({ slices: 3 }), resultJson: null, iteration: 0, createdAt: 1, updatedAt: 1,
    })
    const steps = await svc.getSteps(run.id)
    expect(steps[0]).toMatchObject({ name: 'plan', status: 'done', structured: { slices: 3 } })

    const cancelled = await svc.cancel(run.id)
    expect(cancelled.status).toBe('cancelled')
  })
})
