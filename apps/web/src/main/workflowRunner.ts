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
  kind?: 'agent' | 'gate-human' | 'gate-policy' | 'ci-loop'
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
}

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
        const steps = await this.steps(runId)
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
      resultJson: JSON.stringify({ status: result.status, exitCode: result.exitCode, result: result.capture.result, stderrTail: result.stderrTail }),
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
