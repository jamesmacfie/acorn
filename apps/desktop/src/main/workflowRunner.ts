// Workflow state machine (docs/next 14 P2–P3): sequential steps run by MAIN, every transition
// persisted to workflow_runs/workflow_steps (the rows ARE the checkpoint — a run resumes after an
// app restart via reconcile(), mirroring the tmux pattern). Handoff is the shared substrate,
// never scrollback: a step's structured result is written as a `handoff` note (09) and the next
// step's input bundle (11) includes it. Gates are transitions THIS runtime refuses — never a
// prompt (roboco's enforcement lesson): a human gate pauses the run until the approve IPC; a
// policy gate re-derives its verdict in main and ignores whatever the step claimed. Safety rails
// are first-class terminal states, not failures. Deps-injected → tests run over fake agents.
import { randomUUID } from 'node:crypto'
import { asc, eq } from 'drizzle-orm'
import type { AppDatabase } from '../server/db'
import { schema } from '../server/db'
import type { HeadlessOpts, HeadlessResult } from './headless'

export type WorkflowStepDef = {
  name: string
  kind?: 'agent' | 'gate-human' | 'gate-policy' | 'ci-loop' | 'fan-out' | 'join'
  profileId?: string
  model?: string
  prompt?: string
  schema?: object
  // gate-policy: which check the RUNTIME re-derives (never trusts step output).
  policy?: string
  // ci-loop bound (14 §loop): a thrashing loop is the only real failure — hitting the bound is a
  // safety-rail terminal state.
  maxIterations?: number
  requiresRun?: string // run target the runner starts + hands the URL to the step (13)
  // fan-out (14 P4): this step's structured output must carry a task list ({tasks: [...]}); each
  // becomes a CHILD task (tasks.parentId) with its own branch/worktree, running childStep in
  // parallel. The next `join` step aggregates the children's results.
  childStep?: { name?: string; profileId?: string; model?: string; prompt?: string; schema?: object }
}

export type FanOutTaskSeed = { title: string; branch: string; prompt?: string }

export type WorkflowDef = {
  name: string
  posture?: 'gated' | 'autonomous'
  steps: WorkflowStepDef[]
}

export type StepOutcome = { status: 'done' | 'failed'; result?: HeadlessResult; error?: string }

export type RunnerDeps = {
  // Execute one headless agent step in the task's worktree; the runner persists the outcome.
  runStep(taskId: string, def: WorkflowStepDef, opts: HeadlessOpts): Promise<HeadlessResult>
  // Handoff half (09): the step's result → a handoff note the next bundle includes.
  writeHandoff(taskId: string, stepName: string, body: string): Promise<void>
  // Input half (11): the assembled context bundle (includes notes → includes prior handoffs).
  assembleContext(taskId: string): Promise<string>
  // Policy gates re-derive verdicts HERE (e.g. 'checks-green' polls the checks mirror).
  evaluatePolicy(taskId: string, policy: string): Promise<{ pass: boolean; detail?: string }>
  // CI loop support: current failing-checks summary, '' when green; null when unknown/no PR.
  failingChecks(taskId: string): Promise<string | null>
  // Notifications (05): gate raised, run finished.
  notify(taskId: string, kind: 'gate' | 'run-done', title: string): void
  // requires_run (13): start the target, resolve its URL for the step prompt.
  startRunTarget?(taskId: string, targetId: string): Promise<{ ok: boolean; url?: string }>
  // fan-out (14 P4): materialise a child task (tasks.parentId) with its own branch worktree.
  createChildTask?(parentTaskId: string, seed: FanOutTaskSeed): Promise<string>
}

type RunRow = typeof schema.workflowRuns.$inferSelect
type StepRow = typeof schema.workflowSteps.$inferSelect

const now = () => Date.now()

export class WorkflowRunner {
  // Live runs being ticked (the session-map pattern); the DB rows are the durable truth.
  private active = new Set<string>()

  constructor(
    private db: AppDatabase,
    private deps: RunnerDeps,
  ) {}

  async start(taskId: string, def: WorkflowDef): Promise<string> {
    const runId = randomUUID()
    const at = now()
    await this.db.insert(schema.workflowRuns).values({
      id: runId,
      taskId,
      name: def.name,
      status: 'running',
      posture: def.posture ?? 'gated',
      trigger: 'manual',
      defJson: JSON.stringify(def),
      createdAt: at,
      updatedAt: at,
    })
    for (const [idx, step] of def.steps.entries()) {
      await this.db.insert(schema.workflowSteps).values({
        id: randomUUID(),
        runId,
        idx,
        name: step.name,
        kind: step.kind ?? 'agent',
        mode: 'headless',
        profileId: step.profileId ?? 'claude-code',
        model: step.model ?? null,
        status: 'pending',
        createdAt: at,
        updatedAt: at,
      })
    }
    void this.tick(runId)
    return runId
  }

  async run(runId: string): Promise<RunRow | undefined> {
    const [row] = await this.db.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.id, runId))
    return row
  }

  async steps(runId: string): Promise<StepRow[]> {
    return this.db.select().from(schema.workflowSteps).where(eq(schema.workflowSteps.runId, runId)).orderBy(asc(schema.workflowSteps.idx))
  }

  // The sequential flow — fan-out child rows (parentStepId set) live outside it.
  private async sequentialSteps(runId: string): Promise<StepRow[]> {
    return (await this.steps(runId)).filter((s) => s.parentStepId == null)
  }

  async childSteps(fanOutStepId: string): Promise<StepRow[]> {
    return this.db.select().from(schema.workflowSteps).where(eq(schema.workflowSteps.parentStepId, fanOutStepId)).orderBy(asc(schema.workflowSteps.createdAt))
  }

  private async setRun(runId: string, patch: Partial<RunRow>): Promise<void> {
    await this.db.update(schema.workflowRuns).set({ ...patch, updatedAt: now() }).where(eq(schema.workflowRuns.id, runId))
  }

  private async setStep(stepId: string, patch: Partial<StepRow>): Promise<void> {
    await this.db.update(schema.workflowSteps).set({ ...patch, updatedAt: now() }).where(eq(schema.workflowSteps.id, stepId))
  }

  // The gate verdict IPC (6.3 / 15 P2). Reject → the run fails cleanly; approve → resume.
  async resolveGate(runId: string, stepId: string, approved: boolean): Promise<void> {
    const [step] = await this.db.select().from(schema.workflowSteps).where(eq(schema.workflowSteps.id, stepId))
    if (!step || step.runId !== runId || step.status !== 'waiting-gate') return
    if (approved) {
      await this.setStep(stepId, { status: 'done', resultJson: JSON.stringify({ approved: true }) })
      await this.setRun(runId, { status: 'running' })
      void this.tick(runId)
    } else {
      await this.setStep(stepId, { status: 'failed', error: 'Rejected at the human gate.' })
      await this.setRun(runId, { status: 'failed', error: `Gate '${step.name}' rejected.` })
    }
  }

  // Startup reconciliation: headless children died with the app, so any 'running' step resets to
  // 'pending' and the run resumes from it. Gated runs just keep waiting.
  async reconcile(): Promise<void> {
    const runs = await this.db.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.status, 'running'))
    for (const run of runs) {
      const steps = await this.steps(run.id)
      for (const step of steps) {
        if (step.status === 'running') await this.setStep(step.id, { status: 'pending', error: 'restarted: step re-queued after app restart' })
      }
      void this.tick(run.id)
    }
  }

  // Sequential tick: run the next pending step; stop on gate/terminal. Re-entrant-safe per run.
  async tick(runId: string): Promise<void> {
    if (this.active.has(runId)) return
    this.active.add(runId)
    try {
      for (;;) {
        const run = await this.run(runId)
        if (!run || run.status !== 'running') return
        const def = JSON.parse(run.defJson) as WorkflowDef
        const steps = await this.sequentialSteps(runId)
        if (steps.some((s) => s.status === 'failed')) return // terminal already recorded
        const next = steps.find((s) => s.status === 'pending')
        if (!next) {
          await this.setRun(runId, { status: 'done' })
          this.deps.notify(run.taskId, 'run-done', `Workflow '${run.name}' finished`)
          return
        }
        const stepDef = def.steps[next.idx]
        const proceed = await this.executeStep(run, next, stepDef)
        if (!proceed) return // gated / failed / safety rail — transition already persisted
      }
    } finally {
      this.active.delete(runId)
    }
  }

  private async executeStep(run: RunRow, step: StepRow, def: WorkflowStepDef): Promise<boolean> {
    const kind = def.kind ?? 'agent'
    if (kind === 'gate-human') {
      // Autonomous posture skips human gates (policy gates still apply — 14 §posture).
      if (run.posture === 'autonomous') {
        await this.setStep(step.id, { status: 'done', resultJson: JSON.stringify({ approved: 'autonomous' }) })
        return true
      }
      await this.setStep(step.id, { status: 'waiting-gate' })
      await this.setRun(run.id, { status: 'gated' })
      this.deps.notify(run.taskId, 'gate', `Workflow '${run.name}' needs you: ${def.name}`)
      return false
    }
    if (kind === 'gate-policy') {
      // Re-derive in the runtime; NEVER trust step output (roboco/bargain-bull).
      const verdict = await this.deps.evaluatePolicy(run.taskId, def.policy ?? '')
      if (verdict.pass) {
        await this.setStep(step.id, { status: 'done', resultJson: JSON.stringify(verdict) })
        return true
      }
      await this.setStep(step.id, { status: 'failed', error: verdict.detail ?? `Policy '${def.policy}' failed.` })
      await this.setRun(run.id, { status: 'failed', error: `Policy gate '${def.name}' refused.` })
      return false
    }
    if (kind === 'ci-loop') return this.runCiLoop(run, step, def)
    if (kind === 'fan-out') return this.runFanOut(run, step, def)
    if (kind === 'join') return this.runJoin(run, step, def)

    // agent step
    await this.setStep(step.id, { status: 'running' })
    let prompt = def.prompt ?? ''
    if (def.requiresRun && this.deps.startRunTarget) {
      const target = await this.deps.startRunTarget(run.taskId, def.requiresRun)
      if (!target.ok) {
        await this.setStep(step.id, { status: 'failed', error: `Could not start run target '${def.requiresRun}'.` })
        await this.setRun(run.id, { status: 'failed', error: `Step '${def.name}' could not start its run target.` })
        return false
      }
      if (target.url) prompt = `${prompt}\n\nThe app is running at: ${target.url}`
    }
    const context = await this.deps.assembleContext(run.taskId)
    const inputs = context ? `${prompt}\n\n${context}` : prompt
    await this.setStep(step.id, { inputsJson: JSON.stringify({ prompt: inputs }) })
    const result = await this.deps.runStep(run.taskId, def, { prompt: inputs, model: def.model, schema: def.schema })
    const patch: Partial<StepRow> = {
      // events (capped) feed the Agents-panel activity view (15 P1).
      resultJson: JSON.stringify({ status: result.status, exitCode: result.exitCode, result: result.capture.result, stderrTail: result.stderrTail, events: result.capture.events.slice(-100) }),
      structuredJson: result.capture.structuredOutput != null ? JSON.stringify(result.capture.structuredOutput) : null,
      sessionId: result.capture.sessionId,
      costUsd: result.capture.costUsd,
    }
    if (result.status !== 'ok') {
      await this.setStep(step.id, { ...patch, status: 'failed', error: `${result.status}${result.stderrTail ? `: ${result.stderrTail.slice(0, 300)}` : ''}` })
      await this.setRun(run.id, { status: 'failed', error: `Step '${def.name}' ${result.status}.` })
      return false
    }
    await this.setStep(step.id, { ...patch, status: 'done' })
    // Handoff (09/14): the structured result is durable shared state for the next step's bundle.
    const handoff = result.capture.structuredOutput != null ? JSON.stringify(result.capture.structuredOutput, null, 2) : (result.capture.result ?? '')
    if (handoff) await this.deps.writeHandoff(run.taskId, def.name, handoff)
    return true
  }

  // Fan-out (14 P4): a plan agent emits {tasks: [{title, branch, prompt?}]} → N child tasks in
  // their own branch worktrees, childStep run per child IN PARALLEL, results persisted as child
  // step rows (parentStepId = this step) for the join to aggregate.
  private async runFanOut(run: RunRow, step: StepRow, def: WorkflowStepDef): Promise<boolean> {
    if (!this.deps.createChildTask) {
      await this.setStep(step.id, { status: 'failed', error: 'Fan-out unavailable (no child-task factory).' })
      await this.setRun(run.id, { status: 'failed', error: `Step '${def.name}' cannot fan out.` })
      return false
    }
    await this.setStep(step.id, { status: 'running' })
    const plan = await this.deps.runStep(run.taskId, def, { prompt: def.prompt ?? '', model: def.model, schema: def.schema })
    const structured = plan.capture.structuredOutput as { tasks?: FanOutTaskSeed[] } | FanOutTaskSeed[] | null
    const seeds = Array.isArray(structured) ? structured : (structured?.tasks ?? null)
    if (plan.status !== 'ok' || !Array.isArray(seeds) || !seeds.length) {
      await this.setStep(step.id, { status: 'failed', error: plan.status !== 'ok' ? `plan ${plan.status}` : 'Plan emitted no task list.' })
      await this.setRun(run.id, { status: 'failed', error: `Fan-out '${def.name}' produced no tasks.` })
      return false
    }
    await this.setStep(step.id, { structuredJson: JSON.stringify(seeds), sessionId: plan.capture.sessionId, costUsd: plan.capture.costUsd })

    const childDef: WorkflowStepDef = { name: def.childStep?.name ?? 'child', ...def.childStep }
    const at = now()
    const children = await Promise.all(
      seeds.map(async (seed, i) => {
        const childTaskId = await this.deps.createChildTask!(run.taskId, seed)
        const rowId = randomUUID()
        await this.db.insert(schema.workflowSteps).values({
          id: rowId,
          runId: run.id,
          idx: step.idx,
          name: `${childDef.name}:${i + 1} ${seed.title}`.slice(0, 120),
          kind: 'agent',
          mode: 'headless',
          profileId: childDef.profileId ?? 'claude-code',
          model: childDef.model ?? null,
          status: 'pending',
          parentStepId: step.id,
          inputsJson: JSON.stringify({ childTaskId, seed }),
          createdAt: at + i,
          updatedAt: at + i,
        })
        return { childTaskId, rowId, seed }
      }),
    )

    // Parallel execution — each child in its OWN worktree (per-branch isolation is the substrate).
    const outcomes = await Promise.all(
      children.map(async ({ childTaskId, rowId, seed }) => {
        await this.setStep(rowId, { status: 'running' })
        const prompt = [childDef.prompt ?? '', seed.prompt ?? '', `Task: ${seed.title}`].filter(Boolean).join('\n\n')
        const result = await this.deps.runStep(childTaskId, childDef, { prompt, model: childDef.model, schema: childDef.schema })
        const ok = result.status === 'ok'
        await this.setStep(rowId, {
          status: ok ? 'done' : 'failed',
          resultJson: JSON.stringify({ status: result.status, result: result.capture.result, events: result.capture.events.slice(-100) }),
          structuredJson: result.capture.structuredOutput != null ? JSON.stringify(result.capture.structuredOutput) : null,
          sessionId: result.capture.sessionId,
          costUsd: result.capture.costUsd,
          error: ok ? null : `${result.status}`,
        })
        return ok
      }),
    )
    // The fan-out itself is done once all children settled — partial failure is the JOIN's verdict.
    await this.setStep(step.id, { status: 'done', resultJson: JSON.stringify({ children: children.length, failed: outcomes.filter((o) => !o).length }) })
    return true
  }

  // Join (14 P4): aggregate the nearest previous fan-out's child results. Partial failure marks
  // the join failed (and the run), with every child's outcome recorded for the human.
  private async runJoin(run: RunRow, step: StepRow, def: WorkflowStepDef): Promise<boolean> {
    const sequential = await this.sequentialSteps(run.id)
    const fanOut = [...sequential].reverse().find((s) => s.idx < step.idx && s.kind === 'fan-out')
    if (!fanOut) {
      await this.setStep(step.id, { status: 'failed', error: 'No preceding fan-out to join.' })
      await this.setRun(run.id, { status: 'failed', error: `Join '${def.name}' had nothing to join.` })
      return false
    }
    const children = await this.childSteps(fanOut.id)
    const results = children.map((c) => ({
      name: c.name,
      status: c.status,
      structured: c.structuredJson ? (JSON.parse(c.structuredJson) as unknown) : null,
      childTaskId: c.inputsJson ? (JSON.parse(c.inputsJson) as { childTaskId?: string }).childTaskId : undefined,
    }))
    const failures = results.filter((r) => r.status !== 'done')
    await this.setStep(step.id, { structuredJson: JSON.stringify({ results, failures: failures.length }) })
    if (failures.length) {
      await this.setStep(step.id, { status: 'failed', error: `${failures.length}/${results.length} children failed.` })
      await this.setRun(run.id, { status: 'failed', error: `Join '${def.name}': partial failure (${failures.length}/${results.length}).` })
      return false
    }
    await this.setStep(step.id, { status: 'done' })
    await this.deps.writeHandoff(run.taskId, def.name, JSON.stringify(results, null, 2))
    return true
  }

  // The CI-fix loop (14 §loop): poll the checks mirror → failing output → a headless fix step in
  // the same worktree → re-poll; bounded. Bound reached = 'safety-rail', NOT 'failed'.
  private async runCiLoop(run: RunRow, step: StepRow, def: WorkflowStepDef): Promise<boolean> {
    const max = def.maxIterations ?? 3
    let iteration = step.iteration
    for (;;) {
      const failing = await this.deps.failingChecks(run.taskId)
      if (failing === '') {
        await this.setStep(step.id, { status: 'done', iteration, resultJson: JSON.stringify({ green: true, iterations: iteration }) })
        return true
      }
      if (failing === null) {
        await this.setStep(step.id, { status: 'failed', iteration, error: 'No checks to poll (no PR?).' })
        await this.setRun(run.id, { status: 'failed', error: `CI loop '${def.name}' had nothing to poll.` })
        return false
      }
      if (iteration >= max) {
        await this.setStep(step.id, { status: 'failed', iteration, error: `Safety rail: ${max} fix iterations exhausted.` })
        await this.setRun(run.id, { status: 'safety-rail', error: `CI loop '${def.name}' hit its iteration bound (${max}).` })
        this.deps.notify(run.taskId, 'gate', `Workflow '${run.name}' stopped at a safety rail (CI still failing).`)
        return false
      }
      iteration += 1
      await this.setStep(step.id, { status: 'running', iteration })
      const result = await this.deps.runStep(run.taskId, def, {
        prompt: `${def.prompt ?? 'Fix the failing CI checks, then commit and push.'}\n\nFailing checks:\n${failing}`,
        model: def.model,
        schema: def.schema,
      })
      await this.setStep(step.id, {
        resultJson: JSON.stringify({ status: result.status, iteration }),
        sessionId: result.capture.sessionId,
        costUsd: result.capture.costUsd,
      })
      if (result.status !== 'ok') {
        await this.setStep(step.id, { status: 'failed', iteration, error: `fix step ${result.status}` })
        await this.setRun(run.id, { status: 'failed', error: `CI fix step ${result.status}.` })
        return false
      }
    }
  }
}
