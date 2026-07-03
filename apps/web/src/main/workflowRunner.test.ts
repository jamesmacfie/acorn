import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTestDb, type TestDb } from '../server/routes/testDb'
import { buildHeadlessArgv, runHeadless } from './headless'
import { NotesStore } from './notes'
import { WorkflowRunner, type RunnerDeps, type WorkflowDef } from './workflowRunner'

const FAKE_AGENT = resolve(dirname(fileURLToPath(import.meta.url)), '../../test/fixtures/fake-agent.sh')

// Real fake-agent steps over a real DB + a real NotesStore: the handoff substrate is exercised,
// not stubbed. Only policy/checks/notify are test doubles.
describe('WorkflowRunner (docs/next 14 P2)', () => {
  let t: TestDb
  let dir: string
  let notes: NotesStore
  const stepInputs: Record<string, string> = {}
  let structuredByStep: Record<string, string>

  const deps = (): RunnerDeps => ({
    runStep: async (_taskId, def, opts) => {
      stepInputs[def.name] = opts.prompt
      const argv = buildHeadlessArgv('claude-code', FAKE_AGENT, opts)!
      return runHeadless(argv, {
        cwd: dir,
        env: {
          PATH: process.env.PATH ?? '',
          FAKE_AGENT_MODE: structuredByStep[def.name] === 'FAIL' ? 'fail' : 'ok',
          ...(structuredByStep[def.name] && structuredByStep[def.name] !== 'FAIL' ? { FAKE_AGENT_STRUCTURED: structuredByStep[def.name] } : {}),
        },
      })
    },
    writeHandoff: async (_taskId, stepName, body) => notes.append('ws1', 'workflow-handoffs', `## ${stepName}\n${body}\n`, { author: 'workflow' }),
    assembleContext: async () => {
      const note = await notes.read('ws1', 'workflow-handoffs').catch(() => null)
      return note ? `# Context\n\n## Notes\n${note.body}` : ''
    },
    evaluatePolicy: vi.fn(async () => ({ pass: true })),
    failingChecks: vi.fn(async () => ''),
    notify: vi.fn(),
  })

  beforeEach(() => {
    t = makeTestDb()
    dir = mkdtempSync(join(tmpdir(), 'acorn-wf-'))
    notes = new NotesStore(join(dir, 'notes'))
    structuredByStep = {}
    for (const k of Object.keys(stepInputs)) delete stepInputs[k]
  })

  afterEach(() => {
    t.cleanup()
    rmSync(dir, { recursive: true, force: true })
  })

  const DEF: WorkflowDef = {
    name: 'build-review',
    steps: [
      { name: 'build', prompt: 'Build the feature.', schema: { type: 'object' } },
      { name: 'review', prompt: 'Review what build did.', schema: { type: 'object' } },
    ],
  }

  const waitDone = async (runner: WorkflowRunner, runId: string, until: string[] = ['done', 'failed', 'gated', 'safety-rail']) => {
    const deadline = Date.now() + 15_000
    for (;;) {
      const run = await runner.run(runId)
      if (run && until.includes(run.status)) return run
      if (Date.now() > deadline) throw new Error(`run stuck in ${run?.status}`)
      await new Promise((r) => setTimeout(r, 25))
    }
  }

  it('2-step sequential run: every transition persisted, handoff rides into step B', async () => {
    structuredByStep = { build: '{"summary":"guarded the null token","files":["src/auth/login.ts"]}' }
    const runner = new WorkflowRunner(t.db, deps())
    const runId = await runner.start('task1', DEF)
    const run = await waitDone(runner, runId)
    expect(run.status).toBe('done')

    const steps = await runner.steps(runId)
    expect(steps.map((s) => [s.name, s.status])).toEqual([
      ['build', 'done'],
      ['review', 'done'],
    ])
    // Transitions persisted with the captured result + structured output + session id.
    expect(JSON.parse(steps[0].structuredJson!)).toEqual({ summary: 'guarded the null token', files: ['src/auth/login.ts'] })
    expect(steps[0].sessionId).toBe('fake-sess-1')
    expect(steps[0].costUsd).toBeCloseTo(0.0123)

    // The handoff note exists (author: workflow) and appeared in review's assembled input.
    const handoff = await notes.read('ws1', 'workflow-handoffs')
    expect(handoff.author).toBe('workflow')
    expect(handoff.body).toContain('guarded the null token')
    expect(stepInputs.review).toContain('guarded the null token')
    expect(stepInputs.review).toContain('Review what build did.')
  })

  it('a failing step fails the run cleanly and stops the sequence', async () => {
    structuredByStep = { build: 'FAIL' }
    const runner = new WorkflowRunner(t.db, deps())
    const runId = await runner.start('task1', DEF)
    const run = await waitDone(runner, runId)
    expect(run.status).toBe('failed')
    const steps = await runner.steps(runId)
    expect(steps[0].status).toBe('failed')
    expect(steps[1].status).toBe('pending') // never started
  })

  it('kill-and-reconstruct over the same DB mid-run → resumes from the persisted step', async () => {
    const runner = new WorkflowRunner(t.db, deps())
    const runId = await runner.start('task1', DEF)
    await waitDone(runner, runId)

    // Simulate a crash mid-run: force step B back to 'running' with the run 'running', as if the
    // app died while it executed, then reconstruct a FRESH runner over the same DB.
    const steps = await runner.steps(runId)
    await t.db.update((await import('../server/db')).schema.workflowSteps).set({ status: 'running' }).where(
      (await import('drizzle-orm')).eq((await import('../server/db')).schema.workflowSteps.id, steps[1].id),
    )
    await t.db.update((await import('../server/db')).schema.workflowRuns).set({ status: 'running' }).where(
      (await import('drizzle-orm')).eq((await import('../server/db')).schema.workflowRuns.id, runId),
    )

    const revived = new WorkflowRunner(t.db, deps())
    await revived.reconcile()
    const run = await waitDone(revived, runId)
    expect(run.status).toBe('done')
    const after = await revived.steps(runId)
    expect(after[1].status).toBe('done')
    expect(after[1].error).toContain('re-queued after app restart')
  })
})
