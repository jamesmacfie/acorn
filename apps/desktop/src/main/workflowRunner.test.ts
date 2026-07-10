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
    writeHandoff: async (taskId, stepName, body) => notes.append({ scope: 'task', taskId }, 'workflow-handoffs', `## ${stepName}\n${body}\n`, { author: 'workflow' }),
    assembleContext: async () => {
      const note = await notes.read({ scope: 'task', taskId: 'task1' }, 'workflow-handoffs').catch(() => null)
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
    const handoff = await notes.read({ scope: 'task', taskId: 'task1' }, 'workflow-handoffs')
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

  it('human gate pauses the run (no further transitions) until the approve IPC; reject fails cleanly', async () => {
    const d = deps()
    const runner = new WorkflowRunner(t.db, d)
    const def: WorkflowDef = {
      name: 'gated-ship',
      steps: [
        { name: 'build', prompt: 'Build.' },
        { name: 'ship?', kind: 'gate-human' },
        { name: 'ship', prompt: 'Ship it.' },
      ],
    }
    const runId = await runner.start('task1', def)
    const gated = await waitDone(runner, runId, ['gated'])
    expect(gated.status).toBe('gated')
    let steps = await runner.steps(runId)
    expect(steps.map((s) => s.status)).toEqual(['done', 'waiting-gate', 'pending'])
    expect(d.notify).toHaveBeenCalledWith('task1', 'gate', expect.stringContaining('needs you'))

    // NO further transitions while gated — the final step must not start.
    await new Promise((r) => setTimeout(r, 300))
    steps = await runner.steps(runId)
    expect(steps[2].status).toBe('pending')

    await runner.resolveGate(runId, steps[1].id, true)
    const run = await waitDone(runner, runId)
    expect(run.status).toBe('done')
    expect((await runner.steps(runId)).map((s) => s.status)).toEqual(['done', 'done', 'done'])

    // Reject path on a fresh run.
    const runId2 = await runner.start('task1', def)
    await waitDone(runner, runId2, ['gated'])
    const steps2 = await runner.steps(runId2)
    await runner.resolveGate(runId2, steps2[1].id, false)
    const run2 = await runner.run(runId2)
    expect(run2?.status).toBe('failed')
    expect((await runner.steps(runId2))[2].status).toBe('pending') // never ran
  })

  it('autonomous posture skips human gates but policy gates still bind', async () => {
    const d = deps()
    d.evaluatePolicy = vi.fn(async () => ({ pass: false, detail: 'CI red' }))
    const runner = new WorkflowRunner(t.db, d)
    const runId = await runner.start('task1', {
      name: 'auto',
      posture: 'autonomous',
      steps: [
        { name: 'gate', kind: 'gate-human' },
        { name: 'policy', kind: 'gate-policy', policy: 'checks-green' },
      ],
    })
    const run = await waitDone(runner, runId)
    expect(run.status).toBe('failed') // human gate auto-passed, policy refused
    const steps = await runner.steps(runId)
    expect(steps[0].status).toBe('done')
    expect(steps[1].status).toBe('failed')
  })

  it('policy gate ignores a lying step result — the verdict is re-derived in the runtime', async () => {
    // The agent step CLAIMS success in its structured output; the policy dep says red. Red wins.
    structuredByStep = { build: '{"ci":"green","trust_me":true}' }
    const d = deps()
    d.evaluatePolicy = vi.fn(async () => ({ pass: false, detail: 'checks mirror says failing' }))
    const runner = new WorkflowRunner(t.db, d)
    const runId = await runner.start('task1', {
      name: 'no-trust',
      steps: [
        { name: 'build', prompt: 'Build.', schema: { type: 'object' } },
        { name: 'verify', kind: 'gate-policy', policy: 'checks-green' },
      ],
    })
    const run = await waitDone(runner, runId)
    expect(run.status).toBe('failed')
    const steps = await runner.steps(runId)
    expect(JSON.parse(steps[0].structuredJson!)).toMatchObject({ ci: 'green' }) // the lie was recorded…
    expect(steps[1].status).toBe('failed') // …and ignored
    expect(d.evaluatePolicy).toHaveBeenCalledWith('task1', 'checks-green')
  })

  it('CI loop: seeded failures flip green → done; exhaustion → safety-rail, NOT failed', async () => {
    // Green after two fix iterations.
    let polls = 0
    const d = deps()
    d.failingChecks = vi.fn(async () => (++polls <= 2 ? '- test: failure' : ''))
    const runner = new WorkflowRunner(t.db, d)
    const runId = await runner.start('task1', { name: 'ci', steps: [{ name: 'ci-fix', kind: 'ci-loop', maxIterations: 3 }] })
    const run = await waitDone(runner, runId)
    expect(run.status).toBe('done')
    const [step] = await runner.steps(runId)
    expect(step.iteration).toBe(2)

    // Never green → the bound is a first-class terminal state.
    const d2 = deps()
    d2.failingChecks = vi.fn(async () => '- test: failure')
    const runner2 = new WorkflowRunner(t.db, d2)
    const runId2 = await runner2.start('task1', { name: 'ci2', steps: [{ name: 'ci-fix', kind: 'ci-loop', maxIterations: 2 }] })
    const run2 = await waitDone(runner2, runId2)
    expect(run2.status).toBe('safety-rail')
    expect(run2.status).not.toBe('failed')
    const [step2] = await runner2.steps(runId2)
    expect(step2.iteration).toBe(2)
    expect(step2.error).toContain('Safety rail')
  })

  it('fan-out → 3 child tasks with real worktrees → join aggregates all 3; partial failure marks the join', async () => {
    const { execFileSync } = await import('node:child_process')
    const { existsSync } = await import('node:fs')
    const { ensureWorktree } = await import('./worktrees')
    const { schema } = await import('../server/db')

    // Real repo + worktrees per child (never the acorn repo).
    const checkout = join(dir, 'checkout')
    execFileSync('git', ['init', '-q', '-b', 'main', checkout])
    execFileSync('git', ['-C', checkout, 'config', 'user.email', 't@t.test'])
    execFileSync('git', ['-C', checkout, 'config', 'user.name', 'T'])
    execFileSync('sh', ['-c', `echo a > ${checkout}/a.txt`])
    execFileSync('git', ['-C', checkout, 'add', '.'])
    execFileSync('git', ['-C', checkout, 'commit', '-q', '-m', 'init'])
    const wtRoot = join(dir, 'worktrees')

    const childTaskIds: string[] = []
    const cwdByTask = new Map<string, string>()
    let childCounter = 0
    let failSecondChild = false

    const d = deps()
    d.createChildTask = async (parentTaskId, seed) => {
      const id = `child-${++childCounter}`
      const wt = await ensureWorktree(wtRoot, checkout, 'acme', 'api', seed.branch, null)
      if (!wt.ok) throw new Error(wt.reason)
      await t.db.insert(schema.tasks).values({
        id,
        title: seed.title,
        origin: 'local',
        repoOwner: 'acme',
        repoName: 'api',
        branch: seed.branch,
        worktreePath: wt.path,
        pullNumber: null,
        status: 'active',
        parentId: parentTaskId,
        sort: childTaskIds.length,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        archivedAt: null,
      })
      childTaskIds.push(id)
      cwdByTask.set(id, wt.path)
      return id
    }
    const baseRunStep = d.runStep
    d.runStep = async (taskId, def, opts) => {
      if (def.kind === 'fan-out') {
        structuredByStep[def.name] = JSON.stringify({
          tasks: [
            { title: 'Fix login', branch: 'fix-login' },
            { title: 'Fix logout', branch: 'fix-logout' },
            { title: 'Fix session', branch: 'fix-session' },
          ],
        })
      } else if (failSecondChild && opts.prompt.includes('Fix logout')) {
        return baseRunStep(taskId, { ...def, name: 'FAILCHILD' }, opts)
      }
      return baseRunStep(taskId, def, opts)
    }
    structuredByStep.FAILCHILD = 'FAIL'

    const DEF_FAN: WorkflowDef = {
      name: 'parallel-review',
      steps: [
        { name: 'plan', kind: 'fan-out', prompt: 'Split the work.', schema: { type: 'object' }, childStep: { name: 'review', prompt: 'Review this slice.', schema: { type: 'object' } } },
        { name: 'aggregate', kind: 'join' },
      ],
    }

    // Happy path: all three children succeed.
    const runner = new WorkflowRunner(t.db, d)
    const runId = await runner.start('task1', DEF_FAN)
    const run = await waitDone(runner, runId)
    expect(run.status).toBe('done')

    // 3 child task rows with parentId + real worktrees on their branches.
    const taskRows = await t.db.select().from(schema.tasks)
    expect(taskRows.filter((r) => r.parentId === 'task1')).toHaveLength(3)
    for (const id of childTaskIds) expect(existsSync(cwdByTask.get(id)!)).toBe(true)

    const seq = await runner.steps(runId)
    const fanOut = seq.find((s) => s.kind === 'fan-out')!
    const children = await runner.childSteps(fanOut.id)
    expect(children).toHaveLength(3)
    expect(children.every((c) => c.status === 'done')).toBe(true)

    // The join received all 3 results.
    const joinStep = seq.find((s) => s.kind === 'join')!
    const joined = JSON.parse(joinStep.structuredJson!) as { results: { status: string }[]; failures: number }
    expect(joined.results).toHaveLength(3)
    expect(joined.failures).toBe(0)

    // Partial failure: child-2 fails → the join (and run) are marked, all outcomes recorded.
    failSecondChild = true
    childTaskIds.length = 0
    const runId2 = await runner.start('task1', DEF_FAN)
    const run2 = await waitDone(runner, runId2)
    expect(run2.status).toBe('failed')
    const seq2 = await runner.steps(runId2)
    const join2 = seq2.filter((s) => s.parentStepId == null).find((s) => s.kind === 'join')!
    expect(join2.status).toBe('failed')
    const joined2 = JSON.parse(join2.structuredJson!) as { results: { status: string }[]; failures: number }
    expect(joined2.results).toHaveLength(3)
    expect(joined2.failures).toBe(1)
  }, 30_000)

  it("requires_run: the runner starts the target and hands its URL to the step (docs/next 13/14)", async () => {
    const d = deps()
    d.startRunTarget = vi.fn(async () => ({ ok: true, url: 'http://localhost:8080' }))
    const runner = new WorkflowRunner(t.db, d)
    const runId = await runner.start('task1', {
      name: 'e2e',
      steps: [{ name: 'verify', prompt: 'Check the login page.', requiresRun: 'dev' }],
    })
    const run = await waitDone(runner, runId)
    expect(run.status).toBe('done')
    expect(d.startRunTarget).toHaveBeenCalledWith('task1', 'dev')
    expect(stepInputs.verify).toContain('The app is running at: http://localhost:8080')

    // A target that cannot start fails the step cleanly.
    const d2 = deps()
    d2.startRunTarget = vi.fn(async () => ({ ok: false }))
    const runner2 = new WorkflowRunner(t.db, d2)
    const runId2 = await runner2.start('task1', { name: 'e2e2', steps: [{ name: 'verify', prompt: 'x', requiresRun: 'dev' }] })
    expect((await waitDone(runner2, runId2)).status).toBe('failed')
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
