// Durable workflow engine. Rows remain the checkpoint; registered handlers own work while this
// class alone owns validation, ordering, persistence, branching, cancellation, and reconciliation.
import { asc, eq, inArray } from 'drizzle-orm'
import { slugifyBranch } from '@acorn/protocol/branch.ts'
import { agentProfileRegistry, DEFAULT_PROFILE_ID, type Extension, type ExtensionPointId, type HeadlessOpts, type HeadlessResult, type PluginDatabase, type PluginHookRegistry, type PluginTelemetry, type SpanHandle, type StreamEvent } from '@acorn/plugin-api/node'
import * as schema from '../node/schema'
import type {
  StepHandlerContext,
  StepHandlerOutcome,
  ToolCeiling,
  WorkflowDef,
  WorkflowRunRow,
  WorkflowStepDef,
  WorkflowStepRow,
} from '../shared/workflowContracts'
import type { PolicyEvaluator, StepKindContribution, WorkflowCatalog } from '../shared/workflowContracts'
import { BUILTIN_STEP_DESCRIPTIONS } from '../shared/stepFields'
import { managedProviderForProfile } from '@acorn/plugin-agents/contract/sessionExecute.ts'
import { WORKFLOW_POLICY, WORKFLOW_STEP_KIND, WORKFLOW_TRIGGER } from '../contract/extensions'
import type { WorkflowChildChangedEvent, WorkflowGateStatus, WorkflowRunStatus } from '../contract/events'
import { MAX_FAN_OUT_TASKS, MAX_STEP_TURNS, buildBuiltinWorkflowContributions } from './workflowBuiltins'
import { Semaphore } from './workflowSemaphore'
import { intersectToolCeilings } from './workflowTools'
import {
  intersectWorkflowBudgets,
  parseEffectiveBudget,
  parseEffectiveTools,
  WorkflowSafetyRailError,
  WorkflowTreeSafety,
} from './workflowTreeSafety'
import {
  assertValidWorkflow,
  frozenWorkflowInputs,
  normalizePersistedWorkflow,
  renderWith,
  renderWorkflowPrompt,
  stepOutput,
  workflowEdges,
  type WorkflowValidationCatalog,
} from './workflowValidation'
import { assertRuntimeWorkflowDispatchUnavailable } from './workflowResolution'
import { WorkflowChildLifecycle } from './workflowChildLifecycle'
import type { WorkflowDispatchRequest, WorkflowDispatchResult } from './workflowDispatch'
import { persistWorkflowStart, type WorkflowStartOptions } from './workflowRunStart'
import { WorkflowRunTermination } from './workflowRunTermination'

export type { ToolCeiling, WorkflowDef, WorkflowStepDef } from '../shared/workflowContracts'
export type { WorkflowInvocationIdentity, WorkflowStartOptions } from './workflowRunStart'

export type FanOutTaskSeed = { title: string; branch: string; prompt?: string }
export type RunStepOptions = HeadlessOpts & {
  /** Which harness runs this step, with "the workflow default" already resolved. The runner answers
   *  it once, here, because a step that names none still has one and every reader has to agree which:
   *  the row `start` writes, validation, the managed session, and the headless fallback. They did not,
   *  and the one that saw `undefined` quietly ran the step as a bare process with no session. */
  profileId: string
  mode?: 'headless' | 'ai'
  signal?: AbortSignal
  onEvent?: (event: StreamEvent) => void
  // Fires once a concurrency slot is acquired, just before the process spawns. This is the seam
  // fan-out children use to flip 'pending' to 'running' only when they actually start.
  onStart?: () => void | Promise<void>
  tools?: ToolCeiling
  workflowRunId?: string
  workflowStepId?: string
  managedSessionId?: string
  timeoutMs?: number
}

/** What a step handler asks for. The harness is the runner's answer, not the handler's, so it is the
 *  one field a handler never fills in. */
export type StepRunRequest = Omit<RunStepOptions, 'profileId'>

export type RunnerDeps = {
  runStep(taskId: string, def: WorkflowStepDef, opts: RunStepOptions): Promise<HeadlessResult>
  writeHandoff(taskId: string, runId: string, stepName: string, body: string): Promise<void>
  finishHandoffs?(taskId: string, runId: string): Promise<void>
  assembleContext(taskId: string, runId: string): Promise<string>
  evaluatePolicy(taskId: string, policy: string): Promise<{ pass: boolean; detail?: string }>
  failingChecks(taskId: string): Promise<string | null>
  // Every bell row a run raises names the run and, where there is one, the node it is about, because
  // a row the owner cannot follow to the thing it happened to has no reason to exist.
  notify(taskId: string, kind: 'gate' | 'run-done' | 'run-failed', title: string, ref?: { runId: string; stepId?: string }): void
  /** One step changed status. Per step, unlike `runChanged`: the run pane moves a node's glyph from
   *  this instead of re-reading every step on every stream event. */
  stepChanged?(runId: string, stepId: string, status: string): void
  statusChanged?(): void
  /** A durable run-status edge. Per run, never per ordinary step. */
  runChanged?(taskId: string, runId: string, status: WorkflowRunStatus): void
  /** The human-approval reduction of step state. */
  gateChanged?(taskId: string, runId: string, stepId: string, status: WorkflowGateStatus): void
  emitStepEvent?(runId: string, stepId: string, event: StreamEvent): void
  onRunTerminal?(taskId: string, runId: string): Promise<void>
  startRunTarget?(taskId: string, targetId: string): Promise<{ ok: boolean; url?: string }>
  /** The owner's half of `workflows:before-step` (docs/plugins.md § Hooks). Absent means nobody
   *  objects, which is also what an empty chain means. */
  hooks?: Pick<PluginHookRegistry, 'run'>
  createChildTask?(parentTaskId: string, seed: FanOutTaskSeed, intendedTaskId?: string): Promise<string>
  cancelChildTask?(taskId: string): Promise<void>
  cancelAgentSession?(taskId: string, sessionId: string): Promise<void>
  dispatchChildWorkflow?(request: WorkflowDispatchRequest, signal?: AbortSignal): Promise<WorkflowDispatchResult>
  dispatchChildWorkflows?(requests: readonly WorkflowDispatchRequest[], signal?: AbortSignal): Promise<WorkflowDispatchResult[]>
  childChanged?(event: WorkflowChildChangedEvent): void
  // The Node enables runtime dispatch after constructing tree safety. Tests can disable it to
  // verify that another composition cannot expose the lifecycle without the admission boundary.
  runtimeWorkflowDispatchEnabled?: boolean
  authorizeRepoConfig?(taskId: string): Promise<void>
  /** `ctx.telemetry`, so a run and its steps are spans owned by this plugin
   *  (docs/workflows.md § What a run reports). Optional, because a test builds a runner with no
   *  host around it, and absent means the spans are not raised. */
  telemetry?: PluginTelemetry
}

const TERMINAL_RUN = new Set(['done', 'failed', 'safety-rail', 'cancelled'])
const TERMINAL_STEP = new Set(['done', 'failed', 'skipped', 'safety-rail', 'cancelled'])
export const MAX_CONCURRENT_HEADLESS = 4
export { MAX_FAN_OUT_TASKS, MAX_STEP_TURNS }

const now = () => Date.now()

const minDefined = (...values: Array<number | undefined>): number | undefined => {
  const defined = values.filter((value): value is number => value != null)
  return defined.length ? Math.min(...defined) : undefined
}

// The half of `ctx.extensionPoints` the runner needs: what other plugins have delivered into this
// plugin's three points. Structural rather than the context member itself, so a test can hand the
// runner a literal and so nothing here reaches for a registry a loaded bundle would inline a copy of.
export type WorkflowExtensions = {
  entries<T>(point: ExtensionPointId<T>): readonly Extension<T>[]
}

const NO_EXTENSIONS: WorkflowExtensions = { entries: () => [] }

/**
 * The steps whose every path back to a root passes through one of `blocked`. Used twice: to skip
 * what a decision's untaken branch was the only way to reach, and to work out which of those skips a
 * retry brings back. A step a live branch also reaches is not in the answer.
 *
 * `roots` names steps to treat as reachable whatever their edges say. A decision's chosen target is
 * one: taking the branch is itself an edge, and in a plain list the target's only declared
 * predecessor is the branch that was not taken.
 */
/** What a retry wrote onto the step, so re-running it does not wipe the record of what it was
 *  originally asked to do. */
function retryRecord(step: WorkflowStepRow): Record<string, unknown> {
  if (!step.inputsJson) return {}
  try {
    const { originalPrompt, retryPrompt, mapRoster } = JSON.parse(step.inputsJson) as {
      originalPrompt?: string
      retryPrompt?: string
      mapRoster?: unknown
    }
    return {
      ...(typeof originalPrompt === 'string' ? { originalPrompt } : {}),
      ...(typeof retryPrompt === 'string' ? { retryPrompt } : {}),
      ...(mapRoster && typeof mapRoster === 'object' ? { mapRoster } : {}),
    }
  } catch {
    return {}
  }
}

function unreachableSteps(def: WorkflowDef, blocked: ReadonlySet<string>, roots: ReadonlySet<string> = new Set()): Set<string> {
  const edges = workflowEdges(def.steps)
  const alive = new Set<string>()
  for (let changed = true; changed;) {
    changed = false
    for (const step of def.steps) {
      if (alive.has(step.name) || blocked.has(step.name)) continue
      const after = edges.get(step.name) ?? []
      if (roots.has(step.name) || !after.length || after.some((name) => alive.has(name))) {
        alive.add(step.name)
        changed = true
      }
    }
  }
  return new Set(def.steps.map((step) => step.name).filter((name) => !alive.has(name) && !blocked.has(name)))
}

export class WorkflowRunner {
  // This plugin's own kinds and policies, addressed as bare words. Everything another plugin adds is
  // qualified and comes from the extension points (../contract/extensions.ts).
  readonly #builtins: { stepKinds: Map<string, StepKindContribution>; policies: Map<string, PolicyEvaluator> }
  readonly #extensions: WorkflowExtensions
  readonly #activeRuns = new Set<string>()
  // Runs whose tick was asked for while one was already computing. Without this a step that settles
  // mid-tick loses its wake-up: the tick that swallowed the call had already read the rows, so it
  // saw the step as running and returned without starting its successors.
  readonly #pendingTicks = new Set<string>()
  // Steps this process has dispatched and not yet settled. In memory because a run only ever ticks
  // inside the node that owns it, and a row is not marked 'running' until `execute` gets that far.
  readonly #startingSteps = new Set<string>()
  readonly #activeHandlers = new Map<string, Map<string, AbortController>>()
  readonly #childLifecycle: WorkflowChildLifecycle
  readonly #treeSafety: WorkflowTreeSafety
  readonly #termination: WorkflowRunTermination
  readonly #deadlineTimers = new Map<string, ReturnType<typeof setTimeout>>()
  // Handoff notes, one write at a time. Two steps finishing together both append to the run's note,
  // and the note store's write-then-rename is not safe against itself: the loser's temporary file is
  // gone by the time it renames. A chain rather than a lock because a handoff write is tiny.
  #handoffs: Promise<unknown> = Promise.resolve()
  // Open spans, by run id and by step id. In memory, like `#activeRuns` and for the same reason: a
  // run only ever ticks inside the node that owns it. A run still going when the process exits
  // reports no span, which is the honest answer, since nothing measured how long it took.
  readonly #runSpans = new Map<string, SpanHandle>()
  readonly #stepSpans = new Map<string, SpanHandle>()
  #stopping = false

  // Abort every in-flight step, for teardown. This is not cancel: cancelling a run is a user action
  // that writes 'cancelled' and stays visible on the next launch, while this is the process going
  // away mid-run. The rows stay 'running' and reconcile() sweeps them back to 'pending' on the next
  // boot.
  //
  // Without it, dispose() closes the plugin's SQLite handle while headless children keep running, and
  // their persistOutcome and setStep writes land on a closed database as unhandled rejections.
  stop(): void {
    this.#stopping = true
    for (const handlers of this.#activeHandlers.values()) {
      for (const controller of handlers.values()) controller.abort()
    }
    this.#activeHandlers.clear()
    this.#activeRuns.clear()
    this.#pendingTicks.clear()
    this.#startingSteps.clear()
    this.#runSpans.clear()
    this.#stepSpans.clear()
    for (const timer of this.#deadlineTimers.values()) clearTimeout(timer)
    this.#deadlineTimers.clear()
  }
  readonly #headless = new Semaphore(MAX_CONCURRENT_HEADLESS)

  constructor(
    private readonly db: PluginDatabase,
    private readonly deps: RunnerDeps,
    extensions: WorkflowExtensions = NO_EXTENSIONS,
  ) {
    this.#extensions = extensions
    this.#treeSafety = new WorkflowTreeSafety(this.db)
    this.#childLifecycle = new WorkflowChildLifecycle(this.db, {
      dispatch: (request, signal) => {
        if (!this.deps.dispatchChildWorkflow) throw new Error('Child workflow dispatch is unavailable.')
        return this.deps.dispatchChildWorkflow(request, signal)
      },
      dispatchMany: (requests, signal) => {
        if (!this.deps.dispatchChildWorkflows) throw new Error('Workflow map dispatch is unavailable.')
        return this.deps.dispatchChildWorkflows(requests, signal)
      },
      steps: (runId) => this.steps(runId),
      setStep: (stepId, patch) => this.setStep(stepId, patch),
      setParentStatus: (runId, status) => this.setWaitingParentStatus(runId, status),
      childChanged: this.deps.childChanged,
    })
    this.#termination = new WorkflowRunTermination(this.db, {
      run: (runId) => this.run(runId),
      steps: (runId) => this.steps(runId),
      setRun: (runId, patch) => this.setRun(runId, patch),
      setStep: (stepId, patch) => this.setStep(stepId, patch),
      finishRun: (run, status, reason) => this.finishRun(run, status, reason),
      abortRun: (runId) => {
        for (const controller of this.#activeHandlers.get(runId)?.values() ?? []) controller.abort()
      },
      cancelAgentSession: this.deps.cancelAgentSession,
      cancelChildTask: this.deps.cancelChildTask,
    })
    this.#builtins = buildBuiltinWorkflowContributions({
      db: this.db,
      deps: this.deps,
      runHeadless: (taskId, def, opts, ctx) => this.runHeadless(taskId, def, opts, ctx),
      setStep: (stepId, patch) => this.setStep(stepId, patch),
      steps: (runId) => this.steps(runId),
      childSteps: (stepId) => this.childSteps(stepId),
      registerActive: (runId, stepId, controller) => this.registerActive(runId, stepId, controller),
      unregisterActive: (runId, stepId) => this.unregisterActive(runId, stepId),
      changed: () => this.changed(),
      policy: (id) => this.#policy(id),
    })
  }

  /** A step kind or policy by the name a workflow file writes: a bare word for a built-in, the
   *  host-minted `<pluginId>:<entryId>` for anything contributed. Resolved per call, never cached,
   *  because the plugin that fills the point may init after this one does. */
  #stepKind(kind: string): StepKindContribution | undefined {
    if (kind === 'workflow') return { handler: this.#childLifecycle.handler() }
    if (kind === 'workflow-map') return { handler: this.#childLifecycle.mapHandler() }
    return this.#builtins.stepKinds.get(kind)
      ?? this.#extensions.entries(WORKFLOW_STEP_KIND).find((entry) => entry.id === kind)?.value
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
      ...this.#extensions.entries(WORKFLOW_STEP_KIND).map((entry) => ({ id: entry.id, pluginId: entry.pluginId, contribution: entry.value })),
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

  /** What the editor and the palette offer (docs/api-reference.md § Workflows). */
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
    // The composition root keeps this switch off until the programme's final release gate. Tests
    // turn it on only after supplying the same tree-safety dependencies as production.
    if ((hasRuntimeDispatch || hasRuntimeMap) && !this.deps.runtimeWorkflowDispatchEnabled) {
      assertRuntimeWorkflowDispatchUnavailable(def)
    }
    if ((hasRuntimeDispatch || hasRuntimeMap) && !opts?.resolvedGraph) {
      throw new Error('Runtime workflow dispatch requires a frozen resolved definition graph.')
    }
    if (opts?.resolvedGraph && JSON.stringify(opts.resolvedGraph.root) !== JSON.stringify(def)) {
      throw new Error('The frozen resolved definition graph does not match the workflow being started.')
    }
    const { runId, created, deadlineAt, invocationParent } = await persistWorkflowStart(this.db, taskId, def, opts)
    if (!created) return runId
    // Unattended work with its own trace: nobody is waiting on the HTTP request that started this,
    // and every step and every agent turn under it hangs off this span.
    const span = this.deps.telemetry?.startSpan('workflow.run', {
      attrs: { seam: 'workflow.run', 'run.id': runId, trigger: opts?.trigger ?? def.trigger ?? 'manual', steps: def.steps.length },
    })
    if (span) this.#runSpans.set(runId, span)
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
    const [row] = await this.db.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.id, runId))
    return row
  }

  async steps(runId: string): Promise<WorkflowStepRow[]> {
    return this.db.select().from(schema.workflowSteps).where(eq(schema.workflowSteps.runId, runId)).orderBy(asc(schema.workflowSteps.idx))
  }

  async childSteps(fanOutStepId: string): Promise<WorkflowStepRow[]> {
    return this.db.select().from(schema.workflowSteps).where(eq(schema.workflowSteps.parentStepId, fanOutStepId)).orderBy(asc(schema.workflowSteps.createdAt))
  }

  async childRuns(parentStepId: string) {
    return this.#childLifecycle.summariesForStep(parentStepId)
  }

  async resolveGate(runId: string, stepId: string, approved: boolean): Promise<void> {
    const run = await this.run(runId)
    if (run?.deadlineAt != null && run.deadlineAt <= now()) {
      await this.safetyRailRun(run.rootRunId ?? run.id, 'Safety rail: workflow deadline exhausted while waiting at a gate.')
      return
    }
    const [step] = await this.db.select().from(schema.workflowSteps).where(eq(schema.workflowSteps.id, stepId))
    if (!step || step.runId !== runId || step.status !== 'waiting-gate') return
    if (approved) {
      await this.setStep(stepId, { status: 'done', resultJson: JSON.stringify({ approved: true }) })
      await this.setWaitingParentStatus(runId, 'running')
      void this.tick(runId)
      return
    }
    await this.setStep(stepId, { status: 'failed', error: 'Rejected at the human gate.' })
    const currentRun = await this.run(runId)
    if (currentRun) await this.finishRun(currentRun, 'failed', `Gate '${step.name}' rejected.`, step.id)
  }

  async cancelRun(runId: string, reason = 'Run cancelled.'): Promise<void> {
    await this.#termination.cancel(runId, reason)
  }

  async killStep(runId: string, stepId: string): Promise<void> {
    const run = await this.run(runId)
    const [step] = await this.db.select().from(schema.workflowSteps).where(eq(schema.workflowSteps.id, stepId))
    if (!run || !step || step.runId !== runId || TERMINAL_RUN.has(run.status) || TERMINAL_STEP.has(step.status)) return
    if (step.parentStepId == null && ['fan-out', 'workflow', 'workflow-map'].includes(step.kind)) return this.cancelRun(runId)
    this.#activeHandlers.get(runId)?.get(stepId)?.abort()
    await this.setStep(stepId, { status: 'cancelled', error: 'Step killed by user.' })
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
            await this.setStep(step.id, { status: 'pending', error: 'restarted: step re-queued after app restart' })
          }
        }
        void this.tick(run.id)
      } else {
        const waiting = (await this.steps(run.id)).filter((step) => step.status === 'waiting-children')
        if (!waiting.length) continue
        for (const step of waiting) {
          await this.setStep(step.id, { status: 'pending', error: 'restarted: child workflow wait restored after app restart' })
        }
        await this.setRun(run.id, { status: 'running' })
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
      if (!run || run.status !== 'running') return
      const def = normalizePersistedWorkflow(JSON.parse(run.defJson) as WorkflowDef) // defJson is frozen at start
      const steps = (await this.steps(runId)).filter((step) => step.parentStepId == null)
      // A persisted failed/safety-rail step with the run still 'running' means the app died
      // between the step write and finishRun. Complete the halt instead of advancing past it.
      const halted = steps.find((step) => step.status === 'failed' || step.status === 'safety-rail')
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
      const settled = new Set(steps.filter((step) => step.status === 'done' || step.status === 'skipped').map((step) => step.name))
      const ready = steps.filter((step) =>
        step.status === 'pending'
        && !this.#startingSteps.has(step.id)
        && (edges.get(step.name) ?? []).every((name) => settled.has(name)))
      if (!ready.length) {
        const busy = steps.some((step) => ['running', 'waiting-gate', 'waiting-children'].includes(step.status) || this.#startingSteps.has(step.id))
        if (!busy) await this.finishRun(run, 'done')
        return
      }
      const byName = new Map(def.steps.map((step) => [step.name, step]))
      for (const step of ready) {
        const stepDef = byName.get(step.name) ?? def.steps[step.idx]
        if (!stepDef) {
          await this.finishRun(run, 'failed', `Step '${step.name}' is not in this run's definition.`, step.id)
          return
        }
        // Claimed here rather than by the row's status, so a tick that lands while `execute` is still
        // rendering its prompt does not start the same step twice.
        this.#startingSteps.add(step.id)
        const execution = this.execute(run, step, stepDef, def, steps, edges)
          .catch(async (error) => {
            await this.setStep(step.id, { status: 'failed', error: error instanceof Error ? error.message : 'Step failed.' })
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

  private async execute(
    run: WorkflowRunRow,
    step: WorkflowStepRow,
    def: WorkflowStepDef,
    workflow: WorkflowDef,
    rows: WorkflowStepRow[],
    edges: ReadonlyMap<string, string[]>,
  ): Promise<void> {
    const kind = def.kind ?? 'agent'
    const handler = this.#stepKind(kind)?.handler
    if (!handler) {
      await this.finishRun(run, 'failed', `Step '${def.name}' has unknown kind '${kind}'.`, step.id)
      return
    }
    const inputs = frozenWorkflowInputs(workflow)
    let renderedPrompt: string
    let renderedWith: Record<string, unknown> | undefined
    try {
      renderedPrompt = renderWorkflowPrompt(def.prompt, rows, inputs)
      // A contributed handler never sees a template: it gets the substituted command, URL or SQL.
      renderedWith = renderWith(def.with, rows, inputs)
    } catch (error) {
      await this.setStep(step.id, { status: 'failed', error: error instanceof Error ? error.message : 'Template rendering failed.' })
      await this.finishRun(run, 'failed', `Step '${def.name}' has an invalid template reference.`, step.id)
      return
    }
    const upstream = (edges.get(def.name) ?? []).flatMap((name) => {
      const row = rows.find((candidate) => candidate.name === name)
      return row?.status === 'done' ? [{ name, output: stepOutput(row) }] : []
    })
    // The step is about to run. This is the last moment another plugin can say not now — an incident
    // tool refusing a deploy, a change-freeze calendar (docs/plugins.md § Hooks). A refusal is a
    // safety-rail rather than a failure: nothing broke, something declined, and the two read differently
    // in the run list.
    const verdict = await this.deps.hooks?.run('before-step', {
      taskId: run.taskId,
      runId: run.id,
      stepId: step.id,
      step: def.name,
      kind: def.kind ?? 'agent',
    })
    if (verdict && !verdict.ok) {
      await this.setStep(step.id, { status: 'safety-rail', error: `${verdict.by}: ${verdict.reason}` })
      await this.safetyRailRun(
        run.rootRunId ?? run.id,
        `Step '${def.name}' was stopped by ${verdict.by}.`,
        { runId: run.id, stepId: step.id },
      )
      return
    }
    const controller = new AbortController()
    const tools = intersectToolCeilings(parseEffectiveTools(run), def.tools)
    const budget = intersectWorkflowBudgets(parseEffectiveBudget(run), def.budget)
    const runRemainingMs = run.deadlineAt == null ? undefined : run.deadlineAt - now()
    const timeoutMs = minDefined(budget.maxWallTimeMs, runRemainingMs)
    if (timeoutMs != null && timeoutMs <= 0) {
      await this.setStep(step.id, { status: 'safety-rail', error: 'Workflow wall-time budget exhausted.' })
      await this.safetyRailRun(
        run.rootRunId ?? run.id,
        'Workflow wall-time budget exhausted.',
        { runId: run.id, stepId: step.id },
      )
      return
    }
    this.registerActive(run.id, step.id, controller)
    // `isolation = "worktree"` puts the step on a child task with a checkout of its own, through the
    // same factory fan-out uses. `cancelRun` already reads `childTaskId` back out of `inputsJson`.
    let childTaskId: string | undefined
    if (def.isolation === 'worktree' && (this.#stepKind(kind)?.describe?.runsAgent ?? false)) {
      if (!this.deps.createChildTask) {
        this.unregisterActive(run.id, step.id)
        await this.setStep(step.id, { status: 'failed', error: 'Worktree isolation is unavailable (no child-task factory).' })
        await this.finishRun(run, 'failed', `Step '${def.name}' asked for its own worktree and there is no child-task factory.`, step.id)
        return
      }
      try {
        childTaskId = await this.deps.createChildTask(run.taskId, {
          title: `${run.name}: ${def.name}`,
          branch: slugifyBranch(`${run.name}-${def.name}`),
        })
      } catch (error) {
        this.unregisterActive(run.id, step.id)
        const detail = error instanceof Error ? error.message : 'Could not create the step\'s child task.'
        await this.setStep(step.id, { status: 'failed', error: detail })
        await this.finishRun(run, 'failed', `Step '${def.name}': ${detail}`, step.id)
        return
      }
    }
    let budgetTimedOut = false
    const budgetTimer = timeoutMs == null ? null : setTimeout(() => {
      budgetTimedOut = true
      controller.abort()
    }, timeoutMs)
    const context: StepHandlerContext = {
      // The handler runs on the child task when the step asked for one; the run, its notices and its
      // handoffs stay on the run's own task.
      run: childTaskId ? { ...run, taskId: childTaskId } : run,
      step,
      def: renderedWith ? { ...def, with: renderedWith } : def,
      renderedPrompt,
      tools,
      budget,
      signal: controller.signal,
      inputs,
      upstream,
      emit: ({ event }) => {
        this.deps.emitStepEvent?.(run.id, step.id, event)
      },
    }
    // What survives the handler's own `inputsJson`: the child task cancelRun reads back, and the
    // record a retry left of what was originally asked.
    const carried = { ...retryRecord(step), ...(childTaskId ? { childTaskId } : {}) }
    await this.setStep(step.id, {
      status: 'running',
      inputsJson: JSON.stringify({ prompt: renderedPrompt, tools, budget, ...carried }),
    })
    let outcome: StepHandlerOutcome
    try {
      outcome = await handler(context)
    } catch (error) {
      outcome = error instanceof WorkflowSafetyRailError
        ? { status: 'safety-rail', error: error.message }
        : controller.signal.aborted
        ? { status: 'cancelled', error: 'Step cancelled.' }
        : { status: 'failed', error: error instanceof Error ? error.message : 'Step handler failed.' }
    } finally {
      if (budgetTimer) clearTimeout(budgetTimer)
      this.unregisterActive(run.id, step.id)
    }
    if (this.#stopping) return
    if (budgetTimedOut) {
      outcome = {
        status: 'safety-rail',
        error: `Wall-time budget exhausted after ${timeoutMs}ms.`,
      }
    }
    if (outcome.status === 'safety-rail') {
      await this.safetyRailRun(run.rootRunId ?? run.id, outcome.error, { runId: run.id, stepId: step.id })
      return
    }
    await this.persistOutcome(run, step, def, outcome, carried)
  }

  private async persistOutcome(
    run: WorkflowRunRow,
    step: WorkflowStepRow,
    def: WorkflowStepDef,
    outcome: StepHandlerOutcome,
    carried: Record<string, unknown> = {},
  ): Promise<void> {
    const currentRun = await this.run(run.id)
    const [currentStep] = await this.db.select().from(schema.workflowSteps).where(eq(schema.workflowSteps.id, step.id))
    if (!currentRun || currentRun.status === 'cancelling' || currentRun.status === 'cancelled' || currentStep?.status === 'cancelled') return
    if (outcome.status === 'waiting-gate') {
      await this.setStep(step.id, { status: 'waiting-gate' })
      // The run is gated while any step waits, and it goes back to 'running' when the gate resolves.
      await this.setRun(run.id, { status: 'gated' })
      this.deps.notify(run.taskId, 'gate', `Workflow '${run.name}' needs you: ${def.name}`, { runId: run.id, stepId: step.id })
      return
    }
    if (outcome.status === 'waiting-children') {
      await this.setStep(step.id, { status: 'waiting-children' })
      return
    }
    if (outcome.status === 'cancelled') {
      await this.setStep(step.id, { status: 'cancelled', error: outcome.error ?? 'Step cancelled.' })
      await this.finishRun(run, 'cancelled', outcome.error ?? `Step '${def.name}' cancelled.`, step.id)
      return
    }
    const inputsJson = outcome.inputs !== undefined
      ? JSON.stringify(outcome.inputs && typeof outcome.inputs === 'object' && !Array.isArray(outcome.inputs)
        ? { ...(outcome.inputs as Record<string, unknown>), ...carried }
        : outcome.inputs)
      : undefined
    const patch = {
      ...(inputsJson !== undefined ? { inputsJson } : {}),
      ...(outcome.result !== undefined ? { resultJson: JSON.stringify(outcome.result) } : {}),
      ...(outcome.structured !== undefined ? { structuredJson: JSON.stringify(outcome.structured) } : {}),
      ...(outcome.sessionId !== undefined ? { sessionId: outcome.sessionId } : {}),
      ...(outcome.agentSessionId !== undefined ? { agentSessionId: outcome.agentSessionId } : {}),
      ...(outcome.costUsd !== undefined ? { costUsd: outcome.costUsd } : {}),
      ...(outcome.usage !== undefined
        ? {
            resultJson: JSON.stringify({
              ...(outcome.result && typeof outcome.result === 'object' ? outcome.result : { result: outcome.result }),
              usage: outcome.usage,
            }),
          }
        : {}),
    }
    if (outcome.status === 'failed' || outcome.status === 'safety-rail') {
      await this.setStep(step.id, { ...patch, status: outcome.status, error: outcome.error })
      await this.finishRun(run, outcome.status, `Step '${def.name}': ${outcome.error}`, step.id)
      return
    }
    await this.setStep(step.id, { ...patch, status: 'done' })
    if (outcome.handoff) await this.queueHandoff(() => this.deps.writeHandoff(run.taskId, run.id, def.name, outcome.handoff!))
    if (def.branches) await this.applyBranch(run, step, def, outcome)
  }

  private async applyBranch(
    run: WorkflowRunRow,
    step: WorkflowStepRow,
    def: WorkflowStepDef,
    outcome: Extract<StepHandlerOutcome, { status: 'done' }>,
  ): Promise<void> {
    const structured = outcome.structured as { verdict?: unknown } | undefined
    const verdict = structured?.verdict
    const targetName = typeof verdict === 'string' ? (def.branches?.[verdict] ?? def.branches?.default) : def.branches?.default
    if (!targetName) {
      const detail = `Decision '${def.name}' produced unmatched verdict '${String(verdict)}' and has no default branch.`
      await this.setStep(step.id, { status: 'failed', error: detail })
      await this.finishRun(run, 'failed', detail, step.id)
      return
    }
    const current = await this.run(run.id)
    const workflow = normalizePersistedWorkflow(JSON.parse((current ?? run).defJson) as WorkflowDef)
    const rows = (await this.steps(run.id)).filter((row) => row.parentStepId == null)
    if (!rows.some((row) => row.name === targetName)) {
      await this.finishRun(run, 'failed', `Decision '${def.name}' has invalid target '${targetName}'.`, step.id)
      return
    }
    // The branches not taken, and then everything that can only be reached through one of them. A
    // step a taken branch also reaches stays pending and runs when that predecessor finishes.
    const skipped = new Set(rows.filter((row) => row.status === 'skipped').map((row) => row.name))
    for (const name of Object.values(def.branches ?? {})) {
      if (name !== targetName && rows.find((row) => row.name === name)?.status === 'pending') skipped.add(name)
    }
    for (const name of unreachableSteps(workflow, skipped, new Set([targetName]))) skipped.add(name)
    for (const row of rows) {
      if (row.status === 'pending' && skipped.has(row.name)) await this.setStep(row.id, { status: 'skipped' })
    }
  }

  /** Put a failed node back to pending and let the run carry on from there
   *  (docs/workflows.md § Execution model). A device action: an agent may not retry its own run. */
  async retryStep(runId: string, stepId: string, prompt?: string): Promise<{ ok: boolean; error?: string }> {
    const run = await this.run(runId)
    if (!run) return { ok: false, error: 'No such run.' }
    if (run.status !== 'failed' && run.status !== 'safety-rail') return { ok: false, error: `A ${run.status} run cannot be retried.` }
    const rows = (await this.steps(runId)).filter((row) => row.parentStepId == null)
    const step = rows.find((row) => row.id === stepId)
    if (!step) return { ok: false, error: 'No such step in this run.' }
    if (step.status !== 'failed' && step.status !== 'safety-rail') return { ok: false, error: `A ${step.status} step cannot be retried.` }

    const workflow = normalizePersistedWorkflow(JSON.parse(run.defJson) as WorkflowDef)
    const def = workflow.steps.find((candidate) => candidate.name === step.name)
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
        steps: workflow.steps.map((candidate) => candidate.name === step.name ? { ...candidate, prompt } : candidate),
      }
      await this.setRun(runId, { defJson: JSON.stringify(patched) })
    }
    await this.setStep(stepId, { status: 'pending', error: null, inputsJson })
    // Everything the skip only reached through this step comes back with it. A done step stays done.
    const stillSkipped = new Set(rows.filter((row) => row.status === 'skipped' && row.id !== stepId).map((row) => row.name))
    const revived = unreachableSteps(workflow, new Set([step.name]))
    for (const row of rows) {
      if (row.status === 'skipped' && revived.has(row.name) && stillSkipped.has(row.name)) {
        await this.setStep(row.id, { status: 'pending', error: null })
      }
    }
    await this.setRun(runId, { status: 'running', error: null })
    void this.tick(runId)
    return { ok: true }
  }

  private async runHeadless(taskId: string, def: WorkflowStepDef, opts: StepRunRequest, ctx: StepHandlerContext): Promise<HeadlessResult> {
    // The managed session this step is running in, the first time an event names it. The outcome
    // carries it too, but that lands in the completion patch, which left `runForSession` answering
    // nothing for the whole time a reader might want to look — so the Agent pane's "Workflow:" chip
    // only appeared once the step was over. A bare write: `setStep` announces nothing when the patch
    // leaves the status alone.
    let noted = ctx.step.agentSessionId ?? ''
    return this.#headless.use(opts.signal ?? ctx.signal, async () => {
      const turnBudget = intersectWorkflowBudgets(ctx.budget, def.budget)
      const admissionId = this.#treeSafety.reserveTurn(ctx.run, ctx.step, turnBudget)
      await opts.onStart?.()
      let result: HeadlessResult | undefined
      try {
        result = await this.deps.runStep(taskId, def, {
          ...opts,
        // The def's own, not the step row's: a fan-out child runs on a rebound row that carries its
        // parent's profile, so the row would name the wrong harness for the child.
        profileId: def.profileId ?? DEFAULT_PROFILE_ID,
        workflowRunId: ctx.run.id,
        workflowStepId: ctx.step.id,
        managedSessionId: ctx.step.agentSessionId ?? undefined,
        onEvent: (event) => {
          opts.onEvent?.(event)
          ctx.emit({ at: now(), event })
          const sessionId = event.sessionId
          if (typeof sessionId !== 'string' || !sessionId || sessionId === noted) return
          noted = sessionId
          void this.setStep(ctx.step.id, { agentSessionId: sessionId })
        },
          timeoutMs: opts.timeoutMs ?? ctx.budget.maxWallTimeMs,
        })
        const violation = await this.#treeSafety.settleTurn(admissionId, {
          costUsd: result.capture.costUsd ?? 0,
          inputTokens: result.capture.usage?.inputTokens ?? 0,
          outputTokens: result.capture.usage?.outputTokens ?? 0,
        }, result.status === 'ok' ? undefined : result.stderrTail, turnBudget)
        if (violation) throw new WorkflowSafetyRailError(`Safety rail: ${violation}.`)
        return result
      } catch (error) {
        if (!result) await this.#treeSafety.settleTurn(admissionId, {}, error instanceof Error ? error.message : 'Provider turn failed.')
        throw error
      }
    })
  }

  private async finishRun(
    run: WorkflowRunRow,
    status: 'done' | 'failed' | 'safety-rail' | 'cancelled',
    error?: string,
    stepId?: string,
  ): Promise<void> {
    const current = await this.run(run.id)
    if (!current || TERMINAL_RUN.has(current.status)) return
    if (status === 'failed') await this.#termination.cleanupAfterFailure(current, error ?? 'Workflow run failed.')
    const timer = this.#deadlineTimers.get(run.id)
    if (timer) clearTimeout(timer)
    this.#deadlineTimers.delete(run.id)
    await this.setRun(run.id, { status, error: error ?? null })
    const span = this.#runSpans.get(run.id)
    this.#runSpans.delete(run.id)
    span?.end(status === 'done' ? 'ok' : 'error', { status })
    await this.queueHandoff(() => this.deps.finishHandoffs?.(run.taskId, run.id) ?? Promise.resolve()).catch(() => undefined)
    await this.deps.onRunTerminal?.(run.taskId, run.id).catch(() => undefined)
    const ref = { runId: run.id, ...(stepId ? { stepId } : {}) }
    if (status === 'done') this.deps.notify(run.taskId, 'run-done', `Workflow '${run.name}' finished`, ref)
    if (status === 'failed') this.deps.notify(run.taskId, 'run-failed', `Workflow '${run.name}' failed`, ref)
    if (status === 'safety-rail') this.deps.notify(run.taskId, 'run-failed', `Workflow '${run.name}' stopped at a safety rail.`, ref)
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

  /** Run one handoff write after the last one settled. The caller still sees its own failure. */
  private queueHandoff<T>(write: () => Promise<T>): Promise<T> {
    const next = this.#handoffs.then(write)
    this.#handoffs = next.catch(() => undefined)
    return next
  }

  private registerActive(runId: string, stepId: string, controller: AbortController): void {
    let run = this.#activeHandlers.get(runId)
    if (!run) {
      run = new Map()
      this.#activeHandlers.set(runId, run)
    }
    run.set(stepId, controller)
  }

  private unregisterActive(runId: string, stepId: string): void {
    const run = this.#activeHandlers.get(runId)
    run?.delete(stepId)
    if (!run?.size) this.#activeHandlers.delete(runId)
  }

  private async setWaitingParentStatus(runId: string, status: 'running' | 'gated'): Promise<void> {
    const run = await this.run(runId)
    if (!run || !['running', 'gated'].includes(run.status)) return
    const ownGate = (await this.steps(runId)).some((step) => step.status === 'waiting-gate')
    const dispatches = await this.db.select({ runId: schema.workflowDispatches.runId })
      .from(schema.workflowDispatches)
      .where(eq(schema.workflowDispatches.parentRunId, runId))
    const children = dispatches.length
      ? await this.db.select({ status: schema.workflowRuns.status })
        .from(schema.workflowRuns)
        .where(inArray(schema.workflowRuns.id, dispatches.map((dispatch) => dispatch.runId)))
      : []
    // Each child waiter sees only its own roster. Derive the run status from every gate so one
    // child finishing cannot clear attention required by another child or by this run's own gate.
    const next = ownGate || children.some((child) => child.status === 'gated') ? 'gated' : status
    if (run.status !== next) await this.setRun(runId, { status: next })
  }

  private async setRun(runId: string, patch: Partial<WorkflowRunRow>): Promise<void> {
    const before = patch.status == null ? undefined : await this.run(runId)
    await this.db.update(schema.workflowRuns).set({ ...patch, updatedAt: now() }).where(eq(schema.workflowRuns.id, runId))
    if (before && before.status !== patch.status) {
      this.deps.runChanged?.(before.taskId, runId, patch.status as WorkflowRunStatus)
      if (before.parentRunId) await this.#childLifecycle.publish(runId)
    }
    this.changed()
  }

  private async setStep(stepId: string, patch: Partial<WorkflowStepRow>): Promise<void> {
    // Read first only when the status is in the patch: the frame below is a status change, and a
    // write that leaves the status alone has nothing to announce.
    const [before] = patch.status == null
      ? []
      : await this.db.select({ runId: schema.workflowSteps.runId, status: schema.workflowSteps.status })
        .from(schema.workflowSteps).where(eq(schema.workflowSteps.id, stepId))
    await this.db.update(schema.workflowSteps).set({ ...patch, updatedAt: now() }).where(eq(schema.workflowSteps.id, stepId))
    if (before && before.status !== patch.status) {
      this.#markStepSpan(before.runId, stepId, patch.status!)
      this.deps.stepChanged?.(before.runId, stepId, patch.status!)
      if (before.status === 'waiting-gate' || patch.status === 'waiting-gate') {
        const run = await this.run(before.runId)
        if (run) this.deps.gateChanged?.(run.taskId, before.runId, stepId, patch.status as WorkflowGateStatus)
      }
    }
    this.changed()
  }

  /** Open a step's span when it starts running and close it when it settles.
   *
   *  Here rather than in `execute`, because `execute` returns at a dozen places and two of those
   *  settle a step without running it. Every status a step ever takes is written through `setStep`,
   *  so this sees the whole life of one and nothing else has to remember. A step that waits at a
   *  gate keeps its span open, which is right: waiting for a person is part of how long the step
   *  took. */
  #markStepSpan(runId: string, stepId: string, status: string): void {
    if (status === 'running') {
      const span = this.deps.telemetry?.startSpan('workflow.step', {
        traceId: this.#runSpans.get(runId)?.traceId,
        parentSpanId: this.#runSpans.get(runId)?.spanId,
        attrs: { seam: 'workflow.step', 'run.id': runId, 'step.id': stepId },
      })
      if (span) this.#stepSpans.set(stepId, span)
      return
    }
    if (!TERMINAL_STEP.has(status)) return
    const span = this.#stepSpans.get(stepId)
    this.#stepSpans.delete(stepId)
    span?.end(status === 'done' || status === 'skipped' ? 'ok' : 'error', { status })
  }

  private changed(): void {
    this.deps.statusChanged?.()
  }
}
