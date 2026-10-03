// Durable workflow coordinator. Rows remain the checkpoint; the runner schedules graph work and
// coordinates step execution, child runs, and termination.
import { eq, inArray } from 'drizzle-orm'
import { claimWorkflowRecordRetry } from '../processing/retry'
import { agentProfileRegistry, type Extension, type ExtensionPointId, type PluginDatabase } from '@acorn/plugin-api/node'
import * as schema from '../../node/schema'
import type {
  WorkflowDef,
  WorkflowRunRow,
  WorkflowStepRow,
} from '../../shared/workflowContracts'
import type { PolicyEvaluator, StepKindContribution, WorkflowCatalog } from '../../shared/workflowContracts'
import { stepKindContributionProblems } from '../../shared/stepKindAvailability'
import { gateFormEdited, gateFormProblems, type GateFormOutput, type GateFormProposal } from '../../shared/gateForm'
import type { DataValue } from '@acorn/protocol/dataValues.ts'
import { BUILTIN_STEP_DESCRIPTIONS } from '../../shared/stepFields'
import { managedProviderForProfile } from '@acorn/plugin-agents/contract/sessionExecute.ts'
import { WORKFLOW_POLICY, WORKFLOW_STEP_KIND, WORKFLOW_TRIGGER } from '../../contract/extensions'
import { MAX_STEP_TURNS, buildBuiltinWorkflowContributions } from '../steps/builtins'
import { WorkflowTreeSafety } from '../validation/treeSafety'
import {
  assertValidWorkflow,
  workflowEdges,
  type WorkflowValidationCatalog,
} from '../validation/definition'
import { WorkflowChildLifecycle } from '../dispatch/childLifecycle'
import { persistWorkflowStart, type WorkflowStartOptions } from './start'
import { WorkflowRunTermination } from './termination'
import { stepIdentity, rowIdentity } from '../../shared/workflowIdentity'
import { workflowOutputs } from '../validation/values'
import { unreachableSteps } from './graph'
import { WorkflowStepExecution } from '../steps/execution'
import { WorkflowRunState } from './state'
import type { RunnerDeps } from './deps'
export { MAX_CONCURRENT_HEADLESS } from '../steps/execution'
export type { RunnerDeps, RunStepOptions, StepRunRequest, WorkflowChildTaskSeed } from './deps'

export type { ToolCeiling, WorkflowDef, WorkflowStepDef } from '../../shared/workflowContracts'
export type { WorkflowInvocationIdentity, WorkflowStartOptions } from './start'

/** The outcome of answering a human gate. Invalid answers leave it waiting. */
export type WorkflowGateResolution =
  | { outcome: 'resolved' | 'already-resolved' | 'not-found' }
  | { outcome: 'invalid'; problems: Record<string, string> }

const TERMINAL_RUN = new Set(['done', 'completed-with-failures', 'failed', 'safety-rail', 'cancelled'])
const TERMINAL_STEP = new Set(['done', 'completed-with-failures', 'failed', 'skipped', 'safety-rail', 'cancelled'])
export { MAX_STEP_TURNS }

const now = () => Date.now()

// Keep extension lookup structural so tests can provide a literal and loaded plugins do not copy a
// host registry into their bundle.
export type WorkflowExtensions = {
  entries<T>(point: ExtensionPointId<T>): readonly Extension<T>[]
}

const NO_EXTENSIONS: WorkflowExtensions = { entries: () => [] }

export class WorkflowRunner {
  // This plugin's own kinds and policies, addressed as bare words. Everything another plugin adds is
  // qualified and comes from the extension points (../../contract/extensions.ts).
  readonly #builtins: { stepKinds: Map<string, StepKindContribution>; policies: Map<string, PolicyEvaluator> }
  readonly #extensions: WorkflowExtensions
  readonly #reportedInvalidKinds = new Map<string, string>()
  readonly #activeRuns = new Set<string>()
  // Queue a second tick when a step settles during an active graph read.
  readonly #pendingTicks = new Set<string>()
  // Claim a step before prompt rendering, while its persisted row remains pending.
  readonly #startingSteps = new Set<string>()
  readonly #childLifecycle: WorkflowChildLifecycle
  readonly #treeSafety: WorkflowTreeSafety
  readonly #termination: WorkflowRunTermination
  readonly #execution: WorkflowStepExecution
  readonly #state: WorkflowRunState
  readonly #deadlineTimers = new Map<string, ReturnType<typeof setTimeout>>()
  #stopping = false

  // Teardown aborts handlers before the database closes. It leaves rows for restart reconciliation;
  // user cancellation instead persists a terminal state.
  stop(): void {
    this.#stopping = true
    this.#execution.stop()
    this.#activeRuns.clear()
    this.#pendingTicks.clear()
    this.#startingSteps.clear()
    this.#state.stop()
    for (const timer of this.#deadlineTimers.values()) clearTimeout(timer)
    this.#deadlineTimers.clear()
  }
  constructor(
    private readonly db: PluginDatabase,
    private readonly deps: RunnerDeps,
    extensions: WorkflowExtensions = NO_EXTENSIONS,
  ) {
    this.#extensions = extensions
    this.#state = new WorkflowRunState(this.db, this.deps, (runId) => this.#childLifecycle.publish(runId))
    this.#treeSafety = new WorkflowTreeSafety(this.db)
    this.#execution = new WorkflowStepExecution({
      db: this.db,
      deps: this.deps,
      treeSafety: this.#treeSafety,
      state: this.#state,
      kind: (kind) => this.#stepKind(kind),
      finishRun: (run, status, error, stepId) => this.finishRun(run, status, error, stepId),
      safetyRailRun: (runId, reason, trigger) => this.safetyRailRun(runId, reason, trigger),
    })
    this.#childLifecycle = new WorkflowChildLifecycle(this.db, {
      select: this.deps.selectWorkflowRecords,
      dispatch: (request, signal) => {
        if (!this.deps.dispatchChildWorkflow) throw new Error('Child workflow dispatch is unavailable.')
        return this.deps.dispatchChildWorkflow(request, signal)
      },
      dispatchMany: (requests, signal) => {
        if (!this.deps.dispatchChildWorkflows) throw new Error('Workflow map dispatch is unavailable.')
        return this.deps.dispatchChildWorkflows(requests, signal)
      },
      steps: (runId) => this.steps(runId),
      setStep: (stepId, patch) => this.#state.setStep(stepId, patch),
      setParentStatus: (runId, status) => this.#state.setWaitingParentStatus(runId, status),
      childChanged: this.deps.childChanged,
    })
    this.#termination = new WorkflowRunTermination(this.db, {
      run: (runId) => this.run(runId),
      steps: (runId) => this.steps(runId),
      setRun: (runId, patch) => this.#state.setRun(runId, patch),
      setStep: (stepId, patch) => this.#state.setStep(stepId, patch),
      finishRun: (run, status, reason) => this.finishRun(run, status, reason),
      abortRun: (runId) => this.#execution.abortRun(runId),
      cancelAgentSession: this.deps.cancelAgentSession,
      cancelChildTask: this.deps.cancelChildTask,
    })
    this.#builtins = buildBuiltinWorkflowContributions({
      db: this.db,
      deps: this.deps,
      runHeadless: (taskId, def, opts, ctx) => this.#execution.runHeadless(taskId, def, opts, ctx),
      setStep: (stepId, patch) => this.#state.setStep(stepId, patch),
      steps: (runId) => this.steps(runId),
      childSteps: (stepId) => this.childSteps(stepId),
      registerActive: (runId, stepId, controller) => this.#execution.registerActive(runId, stepId, controller),
      unregisterActive: (runId, stepId) => this.#execution.unregisterActive(runId, stepId),
      changed: () => this.changed(),
      policy: (id) => this.#policy(id),
    })
  }

  /** A step kind or policy by the name a workflow file writes: a bare word for a built-in, the
   *  host-minted `<pluginId>:<entryId>` for anything contributed. Resolved per call, never cached,
   *  because the plugin that fills the point may init after this one does. */
  #stepKind(kind: string): StepKindContribution | undefined {
    if (kind === 'workflow') return { handler: this.#childLifecycle.handler(), describe: BUILTIN_STEP_DESCRIPTIONS.workflow }
    if (kind === 'workflow-map') return { handler: this.#childLifecycle.mapHandler(), describe: BUILTIN_STEP_DESCRIPTIONS['workflow-map'] }
    return this.#builtins.stepKinds.get(kind)
      ?? this.#validContributedKinds().find((entry) => entry.id === kind)?.value
  }

  #validContributedKinds() {
    const entries = this.#extensions.entries(WORKFLOW_STEP_KIND)
    const live = new Set(entries.map((entry) => entry.id))
    for (const id of this.#reportedInvalidKinds.keys()) if (!live.has(id)) this.#reportedInvalidKinds.delete(id)
    return entries.filter((entry) => {
      const problems = stepKindContributionProblems(entry.value)
      if (!problems.length) {
        this.#reportedInvalidKinds.delete(entry.id)
        return true
      }
      const message = problems.join('; ')
      if (this.#reportedInvalidKinds.get(entry.id) !== message) {
        this.#reportedInvalidKinds.set(entry.id, message)
        this.deps.invalidStepKind?.(entry.id, problems)
      }
      return false
    })
  }

  #policy(policy: string): PolicyEvaluator | undefined {
    return this.#builtins.policies.get(policy)
      ?? this.#extensions.entries(WORKFLOW_POLICY).find((entry) => entry.id === policy)?.value
  }

  /** Every kind this node can run, with the description the editor draws from. Resolved per call for
   *  the same reason `validationCatalog` is: the plugin that fills the point may init after this one. */
  #kindEntries(): { id: string; pluginId: string | null; contribution: StepKindContribution }[] {
    return [
      ...[...this.#builtins.stepKinds].map(([id, contribution]) => ({ id, pluginId: null, contribution })),
      ...(['workflow', 'workflow-map'] as const).map((id) => ({
        id,
        pluginId: null,
        contribution: {
          handler: id === 'workflow' ? this.#childLifecycle.handler() : this.#childLifecycle.mapHandler(),
          describe: BUILTIN_STEP_DESCRIPTIONS[id],
        },
      })),
      ...this.#validContributedKinds().map((entry) => ({ id: entry.id, pluginId: entry.pluginId, contribution: entry.value })),
    ]
  }

  validationCatalog(): WorkflowValidationCatalog {
    const kinds = this.#kindEntries()
    return {
      stepKinds: new Set(kinds.map((kind) => kind.id)),
      policies: new Set([...this.#builtins.policies.keys(), ...this.#extensions.entries(WORKFLOW_POLICY).map((entry) => entry.id)]),
      profiles: new Set(agentProfileRegistry.list().map((profile) => profile.id)),
      structuredProfiles: new Set(agentProfileRegistry.list().filter((profile) => profile.aiArgv).map((profile) => profile.id)),
      // A contributed kind joins the agent kinds by saying so in its description, which is the only
      // place `isolation`, `inputs` and `configOptions` are ever allowed from.
      agentStepKinds: new Set(kinds.filter((kind) => kind.contribution.describe?.runsAgent).map((kind) => kind.id)),
      describeStepKind: (kind) => this.#stepKind(kind)?.describe,
      validateStepKind: (kind, step, context) => this.#stepKind(kind)?.validate?.(step, context) ?? [],
    }
  }

  /** What the editor and the palette offer (docs/api-reference/workflow-routes.md § Runs). */
  catalog(): WorkflowCatalog {
    return {
      kinds: this.#kindEntries().map(({ id, pluginId, contribution }) => ({ id, pluginId, describe: contribution.describe ?? null })),
      policies: [
        ...[...this.#builtins.policies.keys()].map((id) => ({ id, pluginId: null })),
        ...this.#extensions.entries(WORKFLOW_POLICY).map((entry) => ({ id: entry.id, pluginId: entry.pluginId })),
      ],
      profiles: agentProfileRegistry.list().map((profile) => ({
        id: profile.id,
        label: profile.label,
        managed: managedProviderForProfile(profile.id) !== null,
        structured: !!profile.aiArgv,
      })),
    }
  }

  validate(def: WorkflowDef): void {
    assertValidWorkflow(def, this.validationCatalog())
  }

  /** One sweep of every registered trigger. Clocked by the node's scheduler, not by a client
   *  (plugins/workflows/src/node/index.ts), so a due trigger fires on a node nobody is looking at. */
  async pollTriggers(): Promise<{ started: number; errors: string[] }> {
    let started = 0
    const errors: string[] = []
    for (const trigger of this.#extensions.entries(WORKFLOW_TRIGGER)) {
      try {
        for (const match of await trigger.value.evaluate()) {
          await this.start(match.taskId, match.workflow, { trigger: trigger.id })
          started += 1
        }
      } catch (error) {
        errors.push(`${trigger.id}: ${error instanceof Error ? error.message : 'trigger failed'}`)
      }
    }
    return { started, errors }
  }

  async start(taskId: string, def: WorkflowDef, opts?: WorkflowStartOptions): Promise<string> {
    if ((def as WorkflowDef & { source?: string }).source === 'repo') await this.deps.authorizeRepoConfig?.(taskId)
    if (opts?.resolvedGraph?.requiresRepoTrust || opts?.requiresRepoTrust) {
      if (!this.deps.authorizeRepoConfig) {
        throw new Error('Repository workflow trust cannot be checked, so this run cannot start.')
      }
      await this.deps.authorizeRepoConfig(taskId)
    }
    this.validate(def)
    const hasRuntimeDispatch = def.steps.some((step) => step.kind === 'workflow')
    const hasRuntimeMap = def.steps.some((step) => step.kind === 'workflow-map')
    if ((hasRuntimeDispatch || hasRuntimeMap) && !opts?.resolvedGraph) {
      throw new Error('Runtime workflow dispatch requires a frozen resolved definition graph.')
    }
    if (opts?.resolvedGraph && JSON.stringify(opts.resolvedGraph.root) !== JSON.stringify(def)) {
      throw new Error('The frozen resolved definition graph does not match the workflow being started.')
    }
    const { runId, created, deadlineAt, invocationParent } = await persistWorkflowStart(this.db, taskId, def, opts)
    if (!created) return runId
    this.#state.startRunSpan(runId, opts?.trigger ?? def.trigger ?? 'manual', def.steps.length)
    if (!invocationParent || (deadlineAt != null && deadlineAt < (invocationParent.deadlineAt ?? Number.POSITIVE_INFINITY))) {
      this.armDeadline({ id: runId, deadlineAt })
    }
    // Announce only once the run and its complete step roster are readable.
    this.deps.runChanged?.(taskId, runId, 'running')
    if (opts?.invocation?.parentRunId) void this.#childLifecycle.publish(runId)
    this.changed()
    void this.tick(runId)
    return runId
  }

  async run(runId: string): Promise<WorkflowRunRow | undefined> {
    return this.#state.run(runId)
  }

  async steps(runId: string): Promise<WorkflowStepRow[]> {
    return this.#state.steps(runId)
  }

  async childSteps(parentStepId: string): Promise<WorkflowStepRow[]> {
    return this.#state.childSteps(parentStepId)
  }

  async childRuns(parentStepId: string) {
    return this.#childLifecycle.summariesForStep(parentStepId)
  }

  async resolveGate(runId: string, stepId: string, approved: boolean, values?: Record<string, DataValue>): Promise<WorkflowGateResolution> {
    const run = await this.run(runId)
    if (run?.deadlineAt != null && run.deadlineAt <= now()) {
      await this.safetyRailRun(run.rootRunId ?? run.id, 'Safety rail: workflow deadline exhausted while waiting at a gate.')
      return { outcome: 'resolved' }
    }
    const [step] = await this.db.select().from(schema.workflowSteps).where(eq(schema.workflowSteps.id, stepId))
    if (!run || !step || step.runId !== runId) return { outcome: 'not-found' }
    if (step.status !== 'waiting-gate') return { outcome: 'already-resolved' }
    const workflow = JSON.parse(run.defJson) as WorkflowDef
    const form = workflow.steps.find((candidate) => stepIdentity(candidate) === rowIdentity(workflow, step))?.form
    if (values !== undefined && (!approved || !form)) {
      return { outcome: 'invalid', problems: { values: approved ? 'This gate has no form.' : 'A rejection carries no values.' } }
    }
    if (!approved) {
      if (!await this.#state.setStepIf(stepId, 'waiting-gate', { status: 'failed', error: 'Rejected at the human gate.' })) return { outcome: 'already-resolved' }
      const currentRun = await this.run(runId)
      if (currentRun) await this.finishRun(currentRun, 'failed', `Gate '${step.name}' rejected.`, step.id)
      return { outcome: 'resolved' }
    }
    let structuredJson: string | undefined
    if (form) {
      const proposal = (step.inputsJson ? (JSON.parse(step.inputsJson) as Partial<GateFormProposal>).form?.values : undefined) ?? {}
      const answer = values ?? proposal
      const problems = gateFormProblems(form, answer)
      if (Object.keys(problems).length) return { outcome: 'invalid', problems }
      const output: GateFormOutput = { approved: true, values: answer, edited: gateFormEdited(form, proposal, answer) }
      structuredJson = JSON.stringify(output)
    }
    const done = { status: 'done' as const, resultJson: JSON.stringify({ approved: true }), ...(structuredJson ? { structuredJson } : {}) }
    if (!await this.#state.setStepIf(stepId, 'waiting-gate', done)) return { outcome: 'already-resolved' }
    await this.#state.setWaitingParentStatus(runId, 'running')
    void this.tick(runId)
    return { outcome: 'resolved' }
  }

  async cancelRun(runId: string, reason = 'Run cancelled.'): Promise<void> {
    await this.#termination.cancel(runId, reason)
  }

  async killStep(runId: string, stepId: string): Promise<void> {
    const run = await this.run(runId)
    const [step] = await this.db.select().from(schema.workflowSteps).where(eq(schema.workflowSteps.id, stepId))
    if (!run || !step || step.runId !== runId || TERMINAL_RUN.has(run.status) || TERMINAL_STEP.has(step.status)) return
    if (step.parentStepId == null && ['workflow', 'workflow-map'].includes(step.kind)) return this.cancelRun(runId)
    this.#execution.abortStep(runId, stepId)
    await this.#state.setStep(stepId, { status: 'cancelled', error: 'Step killed by user.' })
    if (step.parentStepId == null) await this.finishRun(run, 'cancelled', `Step '${step.name}' was killed.`)
  }

  async reconcile(): Promise<void> {
    await this.#treeSafety.recover()
    const runs = await this.db.select().from(schema.workflowRuns).where(inArray(schema.workflowRuns.status, ['running', 'gated', 'cancelling']))
    const byId = new Map(runs.map((run) => [run.id, run]))
    for (const run of runs) {
      if (run.deadlineAt != null && run.deadlineAt <= now()) {
        await this.safetyRailRun(run.rootRunId ?? run.id, 'Safety rail: workflow deadline exhausted before restart recovery.')
        continue
      }
      const parent = run.parentRunId ? byId.get(run.parentRunId) : undefined
      if (!parent || (run.deadlineAt != null && run.deadlineAt < (parent.deadlineAt ?? Number.POSITIVE_INFINITY))) {
        this.armDeadline(run)
      }
      if (run.status === 'cancelling') {
        await this.cancelRun(run.id, run.error ?? 'Cancellation completed after restart.')
      } else if (run.status === 'running') {
        for (const step of await this.steps(run.id)) {
          if (step.status === 'running' || step.status === 'waiting-children') {
            await this.#state.setStep(step.id, { status: 'pending', error: 'restarted: step re-queued after app restart' })
          }
        }
        void this.tick(run.id)
      } else {
        const waiting = (await this.steps(run.id)).filter((step) => step.status === 'waiting-children')
        if (!waiting.length) continue
        for (const step of waiting) {
          await this.#state.setStep(step.id, { status: 'pending', error: 'restarted: child workflow wait restored after app restart' })
        }
        await this.#state.setRun(run.id, { status: 'running' })
        void this.tick(run.id)
      }
    }
  }

  /** One pass over the graph: start everything whose predecessors are done, then return. Each step
   *  ticks the run again when it settles, so the run advances without anything holding a loop open.
   *  The re-entrancy guard means "a tick is computing", never "a step is executing". */
  async tick(runId: string): Promise<void> {
    if (this.#stopping) return
    if (this.#activeRuns.has(runId)) {
      this.#pendingTicks.add(runId)
      return
    }
    this.#activeRuns.add(runId)
    try {
      const run = await this.run(runId)
      if (!run || !['running', 'gated'].includes(run.status)) return
      const def = JSON.parse(run.defJson) as WorkflowDef // defJson is frozen at start
      const steps = (await this.steps(runId)).filter((step) => step.parentStepId == null)
      // A persisted failed/safety-rail step with the run still 'running' means the app died
      // between the step write and finishRun. Complete the halt instead of advancing past it.
      const admissionRails = steps.filter(step => step.status === 'safety-rail' && step.resultJson === '{"admissionStopped":true}')
      const halted = steps.find((step) => step.status === 'failed' || (step.status === 'safety-rail' && !admissionRails.includes(step)))
      if (halted) {
        const reason = halted.error ?? `Step '${halted.name}' failed.`
        if (halted.status === 'safety-rail') {
          await this.safetyRailRun(run.rootRunId ?? run.id, reason, { runId: run.id, stepId: halted.id })
        } else await this.finishRun(run, 'failed', reason, halted.id)
        return
      }
      // A skipped predecessor counts as done: that is how a branch is not taken, and the step after
      // the decision still has to run.
      const edges = workflowEdges(def.steps)
      const blocked = unreachableSteps(def, new Set(admissionRails.map(step => rowIdentity(def, step))))
      for (const step of steps) {
        if (step.status === 'pending' && blocked.has(rowIdentity(def, step))) {
          await this.#state.setStep(step.id, { status: 'skipped' })
          step.status = 'skipped'
        }
      }
      const settled = new Set(steps.filter((step) => ['done', 'completed-with-failures', 'skipped'].includes(step.status)).map((step) => rowIdentity(def, step)))
      const ready = steps.filter((step) =>
        step.status === 'pending'
        && !this.#startingSteps.has(step.id)
        && (edges.get(rowIdentity(def, step)) ?? []).every((name) => settled.has(name)))
      if (!ready.length) {
        const busy = steps.some((step) => ['running', 'waiting-gate', 'waiting-children'].includes(step.status) || this.#startingSteps.has(step.id))
        if (!busy) {
          if (admissionRails.length) {
            await this.finishRun(run, 'safety-rail', admissionRails[0]!.error ?? 'Child admission stopped at the descendant limit.')
            return
          }
          try {
            workflowOutputs(def, steps)
            const failures = steps.filter(step => step.status === 'completed-with-failures')
            await this.finishRun(run, failures.length ? 'completed-with-failures' : 'done', failures.length ? 'Independent work completed with child failures.' : undefined)
          } catch (error) { await this.finishRun(run, 'failed', String(error)) }
        }
        return
      }
      const byName = new Map(def.steps.map((step) => [stepIdentity(step), step]))
      for (const step of ready) {
        const stepDef = byName.get(rowIdentity(def, step))
        if (!stepDef) {
          await this.finishRun(run, 'failed', `Step '${step.name}' is not in this run's definition.`, step.id)
          return
        }
        // Claimed here rather than by the row's status, so a tick that lands while `execute` is still
        // rendering its prompt does not start the same step twice.
        this.#startingSteps.add(step.id)
        const execution = this.#execution.execute(run, step, stepDef, def, steps, edges)
          .catch(async (error) => {
            await this.#state.setStep(step.id, { status: 'failed', error: error instanceof Error ? error.message : 'Step failed.' })
          })
          .finally(() => {
            this.#startingSteps.delete(step.id)
            void this.tick(runId)
          })
        void execution
      }
    } finally {
      this.#activeRuns.delete(runId)
      if (this.#pendingTicks.delete(runId) && !this.#stopping) void this.tick(runId)
    }
  }

  /** Put a failed node back to pending and let the run carry on from there
   *  (docs/workflows.md § Execution model). A device action: an agent may not retry its own run. */
  async retryStep(runId: string, stepId: string, prompt?: string): Promise<{ ok: boolean; error?: string }> {
    const run = await this.run(runId)
    if (!run) return { ok: false, error: 'No such run.' }
    if (!['failed', 'safety-rail', 'completed-with-failures'].includes(run.status)) return { ok: false, error: `A ${run.status} run cannot be retried.` }
    const rows = (await this.steps(runId)).filter((row) => row.parentStepId == null)
    const step = rows.find((row) => row.id === stepId)
    if (!step) return { ok: false, error: 'No such step in this run.' }
    if (step.status !== 'failed' && step.status !== 'safety-rail') return { ok: false, error: `Select a failed child step to retry; this step is ${step.status}.` }

    const ancestors: WorkflowRunRow[] = []
    let parent = run.parentRunId ? await this.run(run.parentRunId) : undefined
    while (parent) {
      if (!['failed', 'safety-rail', 'completed-with-failures', 'running', 'gated'].includes(parent.status)) {
        return { ok: false, error: `Ancestor run is ${parent.status} and cannot admit a retry.` }
      }
      ancestors.push(parent)
      parent = parent.parentRunId ? await this.run(parent.parentRunId) : undefined
    }
    if ([run, ...ancestors].some(owner => owner.deadlineAt != null && owner.deadlineAt <= now())) {
      return { ok: false, error: 'The original workflow deadline has expired. Start a fresh run.' }
    }

    const workflow = JSON.parse(run.defJson) as WorkflowDef
    const def = workflow.steps.find((candidate) => stepIdentity(candidate) === rowIdentity(workflow, step))
    try { claimWorkflowRecordRetry(this.db, runId) }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'Record retry is unavailable' } }
    let inputsJson = step.inputsJson
    if (prompt && def && (this.#stepKind(def.kind ?? 'agent')?.describe?.runsAgent ?? false)) {
      // The frozen definition is patched for this step alone, so the run still shows what was asked.
      const previous = (() => {
        try {
          return step.inputsJson ? JSON.parse(step.inputsJson) as Record<string, unknown> : {}
        } catch {
          return {}
        }
      })()
      inputsJson = JSON.stringify({
        ...previous,
        originalPrompt: previous.originalPrompt ?? def.prompt ?? '',
        retryPrompt: prompt,
      })
      const patched: WorkflowDef = {
        ...workflow,
        steps: workflow.steps.map((candidate) => stepIdentity(candidate) === rowIdentity(workflow, step) ? { ...candidate, prompt } : candidate),
      }
      await this.#state.setRun(runId, { defJson: JSON.stringify(patched) })
    }
    await this.#state.setStep(stepId, { status: 'pending', error: null, inputsJson })
    // Everything the skip only reached through this step comes back with it. A done step stays done.
    const stillSkipped = new Set(rows.filter((row) => row.status === 'skipped' && row.id !== stepId).map((row) => rowIdentity(workflow, row)))
    const revived = unreachableSteps(workflow, new Set([rowIdentity(workflow, step)]))
    for (const row of rows) {
      if (row.status === 'skipped' && revived.has(rowIdentity(workflow, row)) && stillSkipped.has(rowIdentity(workflow, row))) {
        await this.#state.setStep(row.id, { status: 'pending', error: null })
      }
    }
    await this.#state.setRun(runId, { status: 'running', error: null })
    // Reopen only the waiting dispatch path. Successful siblings retain their original attempts.
    let child = run
    for (const ancestor of ancestors) {
      if (child.parentStepId) await this.#state.setStep(child.parentStepId, { status: 'pending', error: null })
      await this.#state.setRun(ancestor.id, { status: 'running', error: null })
      this.armDeadline(ancestor)
      child = ancestor
    }
    for (const ancestor of ancestors.reverse()) void this.tick(ancestor.id)
    this.armDeadline(run)
    void this.tick(runId)
    return { ok: true }
  }

  private async finishRun(
    run: WorkflowRunRow,
    status: 'done' | 'completed-with-failures' | 'failed' | 'safety-rail' | 'cancelled',
    error?: string,
    stepId?: string,
  ): Promise<void> {
    const current = await this.run(run.id)
    if (!current || TERMINAL_RUN.has(current.status)) return
    if (status === 'failed') await this.#termination.cleanupAfterFailure(current, error ?? 'Workflow run failed.')
    const timer = this.#deadlineTimers.get(run.id)
    if (timer) clearTimeout(timer)
    this.#deadlineTimers.delete(run.id)
    await this.#state.setRun(run.id, { status, error: error ?? null })
    this.#state.finishRunSpan(run.id, status)
    await this.#execution.queueHandoff(() => this.deps.finishHandoffs?.(run.taskId, run.id) ?? Promise.resolve()).catch(() => undefined)
    await this.deps.onRunTerminal?.(run.taskId, run.id).catch(() => undefined)
    const ref = { runId: run.id, ...(stepId ? { stepId } : {}) }
    if (status === 'done') this.deps.notify(run.taskId, 'run-done', `${run.name} finished`, ref)
    if (status === 'failed') this.deps.notify(run.taskId, 'run-failed', `${run.name} failed`, ref)
    if (status === 'completed-with-failures') this.deps.notify(run.taskId, 'run-failed', `${run.name} finished with failures`, ref)
    if (status === 'safety-rail') this.deps.notify(run.taskId, 'run-failed', `${run.name} stopped at a limit`, ref)
  }

  private armDeadline(run: Pick<WorkflowRunRow, 'id' | 'deadlineAt'>): void {
    const previous = this.#deadlineTimers.get(run.id)
    if (previous) clearTimeout(previous)
    if (run.deadlineAt == null || this.#stopping) return
    const timer = setTimeout(() => {
      this.#deadlineTimers.delete(run.id)
      void this.safetyRailRun(run.id, 'Safety rail: workflow deadline exhausted.')
    }, Math.max(0, run.deadlineAt - now()))
    this.#deadlineTimers.set(run.id, timer)
  }

  private async safetyRailRun(
    runId: string,
    reason: string,
    trigger?: { runId: string; stepId: string },
  ): Promise<void> {
    await this.#termination.safetyRail(runId, reason, trigger)
  }

  private changed(): void {
    this.deps.statusChanged?.()
  }
}
