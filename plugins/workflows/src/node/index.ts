import { pluginChannel } from '@acorn/protocol/plugin/state.ts'
import { homedir } from 'node:os'
import { formatContextBlock } from '@acorn/plugin-context/contract/contextBlock.ts'
import { AGENTS_SESSION_CONTROL, AGENTS_SESSION_EXECUTE } from '@acorn/plugin-agents/contract/sessionExecute.ts'
import { NOTES_STORE } from '@acorn/plugin-notes/contract/store.ts'
import { GITHUB_MIRROR } from '@acorn/plugin-github/contract/mirror.ts'
import { TERMINAL_RUN_TARGETS } from '@acorn/plugin-terminal/contract/runTargets.ts'
import { BridgeError, buildHeadlessArgv, buildSessionEnv, describeError, type InternalEnvFactory, type NodePlugin, requireProfile, resolveCommand, runHeadless } from '@acorn/plugin-api/node'
import { eq } from 'drizzle-orm'
import { loadWorkflowFiles } from '../server/definitions/files'
import { defsForProject, getDef, listDefs, mergedList } from '../server/definitions/store'
import { workflowFileAuthoring } from '../server/files/authoring'
import { destinationQuery, validateWorkflowDestination } from '../server/validation/destination'
import { workflowDraftQueries } from '../server/publication/draftQueries'
import { workflowPublication } from '../server/publication/service'
import { publishedWorkflow } from '../server/publication/store'
import { generateWorkflowRequest } from '../server/authoring/generationRequest'
import { authorWorkflowConversation } from '../server/authoring/conversation'
import { WorkflowDispatcher } from '../server/dispatch/dispatcher'
import { WorkflowProcessingStore } from '../server/processing/store'
import { workflowSelectionPage, workflowRecordAttemptPage, workflowRecordSnapshot } from '../server/processing/readModel'
import { prepareWorkflowReprocess } from '../server/processing/reprocess'
import { WorkflowRunner, type RunnerDeps, type WorkflowDef } from '../server/runs/runner'
import { WORKFLOWS_NOTICES, type WorkflowNotices } from '../contract/notices'
import { WORKFLOWS_RUNNER } from '../contract/runner'
import { WORKFLOW_GATES } from '../contract/events'
import { WORKFLOW_REVIEW_INPUT } from '../contract/reviewInput'
import { workflowReviewInput } from '../server/runs/read/reviewInput'
import { WORKFLOW_POLICY, WORKFLOW_STEP_KIND, WORKFLOW_TRIGGER } from '../contract/extensions'
import { encodeToolCeiling } from '../server/steps/tools'
import { validateWorkflow } from '../server/validation/definition'
import { workflowRunById, workflowRunsForTask, workflowStepStatuses } from '../server/runs/read/readModel'
import { workflowTaskResolutionScope } from '../server/definitions/resolution'
import { WORKFLOW_ROUTE, workflow } from '../server/routes/workflow'
import { WORKFLOW_DEFS_ROUTE, workflowDefsRoutes } from '../server/routes/defs'
import { workflowRuns, workflowSteps } from './schema'
import { workflowRunList, workflowStepProjections, workflowTaskNavigation } from '../server/runs/read/projection'
import { WorkflowStartService } from '../server/runs/admission'
import { assertWorkflowDataScope } from '../server/steps/data'
import { parseWorkflowScheduleTarget, WorkflowScheduleService, type WorkflowScheduleScheduler } from '../server/schedules/service'
import { WORKFLOW_SCHEDULES_ROUTE, workflowScheduleRoutes } from '../server/routes/schedules'

export type WorkflowsPluginDeps = {
  internalEnv: InternalEnvFactory
  // Resolves when the composition root's post-window reconcile pass finishes, even on failure.
  // workflow:start, gate, cancel, and kill all await it: reconcile() sweeps every 'running' step to
  // 'pending', so a run started before the sweep has its live step re-queued underneath it.
  reconciled: Promise<void>
  // '' when every check passed, a rendered list when some failed, null when there is nothing to check
  // (no PR, no identity, no mirrored repo). The three-valued answer is load-bearing: the ci-loop step
  // treats null as a hard failure and '' as done.
  scheduler?: () => WorkflowScheduleScheduler
}

export const workflowsPlugin = (deps: WorkflowsPluginDeps): NodePlugin => {
  // Held so dispose can abort in-flight steps before the database closes (see dispose below).
  let live: WorkflowRunner | null = null
  let routeCapability: { dispose(): void } | null = null
  let defsCapability: { dispose(): void } | null = null
  let schedulesCapability: { dispose(): void } | null = null
  // The step stream, this plugin's own vocabulary rather than a member of the broadcast surface every
  // plugin receives (../contract/notices.ts). It goes out on core's `workflow:` channel, which is why
  // it is written as a frame here rather than reaching for a core helper: `ctx.events` is the seam, and
  // a plugin does not deep-import server/notify.ts.
  const buildNotices = (ctx: Parameters<NonNullable<NodePlugin['init']>>[0]): WorkflowNotices => ({
    stepEvent: (runId, stepId, event) => ctx.events.send({ channel: 'workflow:step:event', runId, stepId, event }),
  })

  // The bell, through core's seam now that it has one. The runner speaks in runs and steps, and this is
  // the one place that turns a `ref` into a target: `workflow-run` is this plugin's own kind, and the
  // handler that answers it opens the run pane at that node (../client/runs/attentionSource.ts).
  const buildNotify = (ctx: Parameters<NonNullable<NodePlugin['init']>>[0]): RunnerDeps['notify'] =>
    (taskId, kind, title, ref) => ctx.events.notice({
      taskId,
      kind,
      title,
      ...(ref ? { target: { kind: 'workflow-run', resourceId: ref.runId, ...(ref.stepId ? { subresourceId: ref.stepId } : {}) } } : {}),
    })
  return {
    name: 'workflows',
    emits: [
      { verb: 'run-changed', description: 'A workflow run changed durable status' },
      { verb: 'gate-changed', description: 'A workflow approval gate started or settled' },
      { verb: 'child-changed', description: 'A dispatched child workflow changed durable state' },
      { verb: 'completed', description: 'A workflow run reached a terminal status' },
    ],
    // This module's own URL: the chain sits at plugins/workflows/migrations beside it, and the host
    // owns open, migrate, and close from there (@acorn/node-core/server/plugins/storage.ts).
    migrationsModule: import.meta.url,
    init: async (ctx) => {
      // Opened and migrated by the host before init returns. The runner and the bridge below both
      // close over the handle, so no request can reach an unmigrated database.
      const store = ctx.storage.open()
      const core = ctx.core
      const notices = buildNotices(ctx)
      const failingChecks = async (taskId: string): Promise<string | null> =>
        (await ctx.capabilities.get(GITHUB_MIRROR)?.failingChecks(core.identity.active(), taskId)) ?? null
      ctx.capabilities.provide(WORKFLOW_REVIEW_INPUT, workflowReviewInput(store, () => ctx.capabilities.get(NOTES_STORE)))

      // The three seams another plugin adds work through (../contract/extensions.ts). Opened before the
      // runner is built so a contribution filed during someone else's init is visible on the first
      // sweep; `entries` is resolved per call, so init order still does not matter.
      ctx.extensionPoints.declare(WORKFLOW_STEP_KIND, 'Workflow step kinds')
      ctx.extensionPoints.declare(WORKFLOW_POLICY, 'Workflow gate policies')
      ctx.extensionPoints.declare(WORKFLOW_TRIGGER, 'Workflow triggers')

      // The one decision this plugin opens to other plugins (docs/plugins.md § Hooks). A veto here is a
      // safety-rail, not a failure, which is why the point allows nothing else: a plugin that could
      // rewrite a step would be rewriting the workflow the owner read before running it.
      ctx.hooks.declare({
        id: 'before-step',
        label: 'run a workflow step',
        payload: { taskId: 'string', runId: 'string', stepId: 'string', step: 'string', kind: 'string' },
        allows: ['observe', 'veto'],
      })
      let dispatcher: WorkflowDispatcher
      let scheduleService: WorkflowScheduleService | null = null
      const runner = new WorkflowRunner(store, {
        invalidStepKind: (id, problems) => ctx.log.warn(`Workflow step '${id}' was rejected: ${problems.join('; ')}`),
        dataAccess: async (taskId, signal) => {
          const task = await core.tasks.load(taskId)
          const project = task?.projectId ? await core.projects.byId(task.projectId) : null
          if (!project) throw new Error('Workflow data access requires a project')
          const scope = { workspaceId: project.workspaceId, projectId: project.id }
          const userId = core.identity.active()
          if (!userId) throw new Error('Workflow data access requires an active owner')
          const invocation = { principal: { kind: 'internal' as const, scope: 'service' as const, userId }, signal }
          return {
            scope,
            resolve: async (reference, values) => {
              const resolved = await ctx.dataSources.resolveQuery(scope, destinationQuery(reference, scope), values, invocation)
              assertWorkflowDataScope(scope, resolved.query.scope)
              return resolved
            },
            invoke: request => {
              assertWorkflowDataScope(scope, request.operation === 'query' ? request.query.scope : request.scope)
              return ctx.dataSources.invoke(request, invocation)
            },
          }
        },
        hooks: ctx.hooks,
        telemetry: ctx.telemetry,
        runStep: async (taskId, def, opts) => {
          // `opts.profileId`, never `def.profileId`: the runner has already resolved "the workflow
          // default" and both paths below have to name the same harness. Reading the def here is what
          // made a step with no harness named run as a bare process with no session, because
          // `managedProviderForProfile(undefined)` answers null and the managed path returns before it
          // creates anything.
          //
          // Resolved per call, not at init (docs/plugins.md § Collaboration rules): plugin init
          // order is not defined.
          const managed = await ctx.capabilities.get(AGENTS_SESSION_EXECUTE)?.({
            taskId,
            profileId: opts.profileId,
            title: `Workflow: ${def.name}`,
            prompt: opts.prompt,
            schema: opts.schema,
            model: opts.model,
            configOptions: def.configOptions,
            tools: opts.tools,
            timeoutMs: opts.timeoutMs,
            managedSessionId: opts.managedSessionId,
            runId: opts.workflowRunId,
            stepId: opts.workflowStepId,
            onEvent: opts.onEvent,
            signal: opts.signal,
          })
          if (managed) return managed
          // The headless fallback, which now means what it says: a profile with no managed driver, or
          // a node with agents disabled. It used to catch a blank harness as well.
          const task = await core.tasks.load(taskId)
          const { cwd } = task ? await core.tasks.resolveCwd(task, undefined) : { cwd: homedir() }
          const project = task?.projectId ? await core.projects.byId(task.projectId) : null
          const profile = requireProfile(opts.profileId)
          const argv = opts.mode === 'ai' ? profile.aiArgv?.(resolveCommand(profile), opts) : buildHeadlessArgv(profile.id, resolveCommand(profile), opts)
          if (!argv) {
            return {
              status: 'error',
              exitCode: null,
              capture: { result: null, structuredOutput: null, sessionId: null, costUsd: null, events: [] },
              stderrTail: `Profile '${profile.id}' has no ${opts.mode === 'ai' ? 'one-shot structured' : 'headless'} mode.`,
            }
          }
          const env = buildSessionEnv({
            taskId,
            cwd,
            task: task && project
              ? { projectId: project.id, projectName: project.name, github: project.github, branch: task.branch, title: task.title }
              : null,
            // 'task'-scoped, bound to the step's own task: a workflow step is a child process, so it
            // is denied the owner's provider credentials and confined to this task's tool surface.
            env: {
              ...deps.internalEnv({ scope: 'task', taskId, toolCeiling: opts.tools ?? {} }),
              // Transitional transport metadata for older MCP proxies. Authorization uses only the
              // signed claim above.
              ACORN_TOOL_CEILING: encodeToolCeiling(opts.tools ?? {}),
            },
          })
          return runHeadless(argv, { cwd, env, timeoutMs: opts.timeoutMs, signal: opts.signal, onEvent: opts.onEvent, adapter: profile.streamJson })
        },
        // Handoffs are notes, in plugins/notes' store, resolved at call time. Its capability id lives
        // in a contract/, so this is a sanctioned edge rather than a coupling.
        writeHandoff: async (taskId, runId, stepName, body) => {
          await ctx.capabilities
            .require(NOTES_STORE)
            .append({ scope: 'task', taskId }, `workflow-handoffs-${runId}`, `## ${stepName}\n${body}\n`, { author: 'workflow', originTaskId: taskId })
        },
        // De-included rather than deleted when the run ends, so the handoff trail stays readable in
        // the pane but stops being injected into later agent sessions for this task.
        //
        // `async`, not a bare arrow returning the promise: the runner calls it as
        // `finishHandoffs?.(…).catch(…)`, and a synchronous throw from `require` would escape that
        // catch and propagate out of finishRun, leaving a terminal run unfinished.
        finishHandoffs: async (taskId, runId) => {
          await ctx.capabilities.require(NOTES_STORE).setIncluded({ scope: 'task', taskId }, `workflow-handoffs-${runId}`, false)
        },
        assembleContext: async (taskId, runId) => {
          try {
            // 'service' scope: the node calling its own HTTP surface to reuse core's context
            // assembler, not a child process. It keeps full reach so context assembly survives the
            // task-scope restriction that applies to agents.
            const loopback = deps.internalEnv({ scope: 'service' })
            const res = await fetch(`${loopback.ACORN_API_URL}/v1/core/tasks/${taskId}/context?workflowRunId=${encodeURIComponent(runId)}`, {
              headers: { 'x-acorn-internal': loopback.ACORN_API_TOKEN ?? '' },
            })
            if (!res.ok) return ''
            return formatContextBlock((await res.json()) as Parameters<typeof formatContextBlock>[0])
          } catch {
            return ''
          }
        },
        // Policy verdicts are re-derived here: a lying step result is ignored by construction.
        evaluatePolicy: async (taskId, policy) => {
          if (policy === 'checks-green') {
            const failing = await failingChecks(taskId)
            if (failing === '') return { pass: true }
            return { pass: false, detail: failing == null ? 'No PR/checks to verify.' : `Failing checks:\n${failing}` }
          }
          return { pass: false, detail: `Unknown policy '${policy}' — failing closed.` }
        },
        failingChecks,
        notify: buildNotify(ctx),
        // Per step, unlike run-changed: the run pane moves one node's glyph without re-reading the run.
        stepChanged: (runId, stepId, status) => ctx.events.send({ channel: 'workflow:step-changed', runId, stepId, status }),
        statusChanged: ctx.events.status,
        // `plugin:workflows:run-changed` (docs/plugins.md § Hearing another plugin).
        runChanged: (taskId, runId, status) => ctx.events.send({ channel: pluginChannel('workflows', 'run-changed'), taskId, runId, status }),
        gateChanged: (taskId, runId, stepId, status) => ctx.events.send({ channel: pluginChannel('workflows', 'gate-changed'), taskId, runId, stepId, status }),
        emitStepEvent: notices.stepEvent,
        onRunTerminal: async (taskId, runId) => {
          await scheduleService?.settleRun(runId).catch(error => ctx.log.warn(`workflow schedule settlement failed: ${describeError(error).message}`))
          const [run] = await store.select({ status: workflowRuns.status, completedAt: workflowRuns.updatedAt }).from(workflowRuns).where(eq(workflowRuns.id, runId)).limit(1)
          // `setRun` announces the terminal status before this callback. Repeat it after schedule
          // settlement so clients that refresh both read models cannot race the schedule write.
          if (run) ctx.events.send({ channel: pluginChannel('workflows', 'run-changed'), taskId, runId, status: run.status })
          if (run) ctx.events.send({ channel: pluginChannel('workflows', 'completed'),
            taskId, runId, status: run.status, completedAt: run.completedAt })
        },
        startRunTarget: async (taskId, targetId) => {
          // terminal.runTargets, resolved at call time. A node with terminal disabled cannot start a
          // run target, and the runner turns the falsy answer into a clean step failure.
          const runTargets = ctx.capabilities.get(TERMINAL_RUN_TARGETS)
          if (!runTargets) return { ok: false }
          const started = await runTargets.start(taskId, targetId)
          if (!started.ok) return { ok: false }
          const status = await runTargets.status(taskId, targetId)
          return { ok: true, url: status.url }
        },
        // Materialises a child task (docs/workflows.md covers dispatch, branch dedup, and lazy worktree
        // creation). Core owns `tasks`, so the insert is core's.
        createChildTask: (parentTaskId, seed, intendedTaskId) => core.tasks.createChild(parentTaskId, seed, intendedTaskId),
        cancelChildTask: (taskId) => core.tasks.cancel(taskId),
        cancelAgentSession: async (taskId, sessionId) => {
          await ctx.capabilities.get(AGENTS_SESSION_CONTROL)?.cancel(taskId, sessionId)
        },
        dispatchChildWorkflow: (request, signal) => dispatcher.dispatch(request, signal),
        dispatchChildWorkflows: (requests, signal) => dispatcher.dispatchMany(requests, signal),
        selectWorkflowRecords: (request, signal) => new WorkflowProcessingStore(store, dispatcher).dispatch(request, signal),
        childChanged: (event) => ctx.events.send({ channel: pluginChannel('workflows', 'child-changed'), ...event }),
        authorizeRepoConfig: (taskId) => core.projects.assertConfigTrusted(taskId),
      }, ctx.extensionPoints)
      dispatcher = new WorkflowDispatcher(store, runner, core.tasks, {
        authorizeRepoConfig: (taskId) => core.projects.assertConfigTrusted(taskId),
      })
      // Kept so dispose can abort in-flight steps before the database closes.
      live = runner

      // Scope construction lives beside definition resolution, so routes, child dispatch, and the
      // later scheduler adapter cannot disagree about which workspace, project, or checkout applies.
      const taskScope = (taskId: string) => workflowTaskResolutionScope(core, taskId, homedir())
      const starts = new WorkflowStartService(store, runner, {
        reconciled: deps.reconciled,
        taskScope,
        project: (projectId) => core.projects.byId(projectId),
        authorizeRepoConfig: (taskId) => core.projects.assertConfigTrusted(taskId),
        authorizeProjectConfig: (projectId) => core.projects.assertProjectConfigTrusted(projectId),
        onTrustRequired: (taskId) => ctx.events.repoConfigTrustNotice(taskId),
        validateDestination: async (graph, scope) => {
          const userId = core.identity.active()
          if (!userId) throw new Error('Destination validation requires an active owner')
          await validateWorkflowDestination(graph, { workspaceId: scope.workspaceId, projectId: scope.projectId }, (reference, inputs) =>
            ctx.dataSources.resolveQuery({ workspaceId: scope.workspaceId, projectId: scope.projectId }, reference, { inputs },
              { principal: { kind: 'internal', scope: 'service', userId }, signal: AbortSignal.timeout(60_000) }))
        },
        queryRevision: async (queryId, scope) => {
          const userId = core.identity.active()
          if (!userId) throw new Error('Query resolution requires an active owner')
          const result = await ctx.dataSources.queryPublication({ action: 'inspect', queryId, workspaceId: scope.workspaceId, projectId: scope.projectId },
            { principal: { kind: 'internal', scope: 'service', userId }, signal: AbortSignal.timeout(60_000) })
          if (!result.published) throw new Error('Query is not published')
          return result.published.revision
        },
      }, homedir())
      scheduleService = new WorkflowScheduleService(store, starts, core, deps.reconciled, {
        scheduler: deps.scheduler,
        describeSource: async (reference, scope, inputs) => {
          const userId = core.identity.active()
          if (!userId) throw new Error('Schedule review requires an active owner')
          const invocation = { principal: { kind: 'internal' as const, scope: 'service' as const, userId }, signal: AbortSignal.timeout(60_000) }
          // Resolution scopes also carry repo and user directories for workflow loading. The query
          // and source seams deliberately accept only their public scope fields, so do not leak the
          // wider workflow object across that validation boundary.
          const queryScope = { workspaceId: scope.workspaceId, projectId: scope.projectId }
          const resolved = await ctx.dataSources.resolveQuery(queryScope, destinationQuery(reference, queryScope), { inputs }, invocation)
          const [description, catalog] = await Promise.all([
            ctx.dataSources.invoke({ operation: 'describe', source: resolved.query.source, scope: resolved.query.scope }, invocation),
            ctx.dataSources.list({ ...queryScope, parameters: {} }, invocation),
          ])
          const source = catalog.sources.find(candidate => candidate.pluginId === resolved.query.source.pluginId && candidate.sourceId === resolved.query.source.sourceId)
          return {
            label: source?.plural ?? source?.name ?? resolved.query.source.sourceId,
            schema: description.schema,
            fields: description.fields,
            incremental: description.operations.incremental,
            ...(description.incremental?.semantics ? { incrementalReason: description.incremental.semantics } : {}),
          }
        },
      })
      ctx.schedules.registerTarget({
        kind: 'workflow',
        parse: raw => {
          const parsed = parseWorkflowScheduleTarget(raw)
          return parsed && scheduleService?.get(parsed.scheduleId) ? parsed : null
        },
        risk: () => 'execute',
        timezone: target => scheduleService?.timezone((target as { scheduleId: string }).scheduleId),
        run: (target, signal, _consent, context) => scheduleService!.dispatch(
          (target as { scheduleId: string }).scheduleId,
          { reason: context.reason, dueAt: context.dueAt, requestKey: context.requestKey },
        ).then(result => signal.aborted ? Promise.reject(signal.reason) : result),
        remove: target => scheduleService!.remove((target as { scheduleId: string }).scheduleId),
      })

      // `plugin:workflows:defs-changed` (docs/plugins.md § Hearing another plugin): the rail list and
      // the editor re-read on it. The workspace, not the row, because the list is workspace-scoped.
      const defsChanged = (workspaceId: string) => ctx.events.send({ channel: pluginChannel('workflows', 'defs-changed'), workspaceId })

      routeCapability = ctx.capabilities.provide(WORKFLOW_ROUTE, {
        // One column off this plugin's own runs table. See WorkflowBridge for why the router needs it.
        taskIdForRun: async (runId) => {
          const [row] = await store.select({ taskId: workflowRuns.taskId }).from(workflowRuns).where(eq(workflowRuns.id, runId)).limit(1)
          return row?.taskId ?? null
        },
        // Declared workflows for a task (docs/workflows.md): `.acorn/workflows/*.toml` from the
        // worktree/checkout plus ~/.acorn, with parse/cycle errors surfaced as palette rows.
        defs: async (taskId, includeRows) => {
          const scope = await taskScope(taskId)
          if (!scope) return { workflows: [], errors: [] }
          const files = loadWorkflowFiles(scope.repoDir, homedir(), runner.validationCatalog())
          if (!includeRows || !scope.project) return files
          const ids = new Set(files.workflows.map((workflow) => workflow.id))
          const rows = (await Promise.all((await defsForProject(store, scope.project.workspaceId, scope.project.id)).map(row => publishedWorkflow(store, row.id).catch(() => null)))).filter(row => row !== null)
          return {
            ...files,
            // A file wins an id collision, the rule the merged rail list applies as well.
            workflows: [...files.workflows, ...rows.filter((row) => !ids.has(row.id)).map((row) => ({ ...row.def, id: row.id, source: 'database' as const, publishedRevision: row.revision }))],
          }
        },
        catalog: (projectId) => starts.catalogForProject(projectId),
        start: (taskId, def, inputs, allowDatabaseDefinitions) =>
          starts.startDefinition(taskId, def as WorkflowDef, inputs, undefined, allowDatabaseDefinitions),
        startById: (taskId, defId, inputs, allowDatabaseDefinitions) =>
          starts.startById(taskId, defId, inputs, allowDatabaseDefinitions),
        runs: (taskId) => workflowRunsForTask(store, taskId),
        run: (runId) => workflowRunById(store, runId),
        // This plugin's contribution to the merged run list (@acorn/protocol/runs.ts). A projection,
        // not the rows: the merged list is display-shaped and deliberately narrow, and a caller that
        // wants a run's steps comes back to this plugin addressing it by id.
        allRuns: () => workflowRunList(store),
        taskNavigation: () => workflowTaskNavigation(store),
        steps: (runId) => workflowStepProjections(runner, runId),
        stepStatuses: (runId) => workflowStepStatuses(store, runId),
        records: async (runId, selectionId, after, limit, stepId, filter) =>
          workflowSelectionPage(store, runId, selectionId, after, limit, stepId, filter),
        recordAttempts: async (runId, recordId, after, limit) => workflowRecordAttemptPage(store, runId, recordId, after, limit),
        recordSnapshot: async (runId, recordId) => workflowRecordSnapshot(store, runId, recordId),
        prepareReprocess: async (runId, recordId) => prepareWorkflowReprocess(store, runId, recordId),
        reprocess: async (runId, recordId, digest, requestId) => {
          await deps.reconciled
          return new WorkflowProcessingStore(store, dispatcher).reprocess({ sourceRunId: runId, recordId, digest, requestId })
        },
        gate: async (runId, stepId, approved, values) => {
          await deps.reconciled // an approval resumes a step the restart sweep could otherwise clobber
          const resolution = await runner.resolveGate(runId, stepId, approved, values)
          if (resolution.outcome === 'not-found') throw new BridgeError(404, 'not_found', 'No such gate in this run.')
          if (resolution.outcome === 'already-resolved') throw new BridgeError(409, 'gate-resolved', 'This gate was already answered.')
          // One line per field, so the message names every problem. The run pane runs the same check
          // before it sends, so it has each one under its field already.
          if (resolution.outcome === 'invalid') {
            throw new BridgeError(400, 'gate-invalid', Object.entries(resolution.problems).map(([field, problem]) => `${field}: ${problem}`).join('\n'))
          }
          return { ok: true }
        },
        cancel: async (runId) => {
          await deps.reconciled
          await runner.cancelRun(runId)
          return { ok: true }
        },
        kill: async (runId, stepId) => {
          await deps.reconciled
          await runner.killStep(runId, stepId)
          return { ok: true }
        },
        retry: async (runId, stepId, prompt) => {
          await deps.reconciled
          return runner.retryStep(runId, stepId, prompt)
        },
        // The chip the agent pane draws over a workflow session (docs/managed-agents.md § Sessions).
        // Two indexed reads rather than a join, because the session row is in another plugin's
        // database and this one only holds the id.
        runForSession: async (sessionId) => {
          const [step] = await store.select().from(workflowSteps).where(eq(workflowSteps.agentSessionId, sessionId)).limit(1)
          if (!step) return null
          const [run] = await store.select().from(workflowRuns).where(eq(workflowRuns.id, step.runId)).limit(1)
          return run ? { run, step } : null
        },
      })

      // The second store a definition can live in (docs/workflows.md § Database definitions). Every
      // route behind it is device-only, because a row is executable configuration with no committed
      // bytes for the trust snapshot to hash.
      const draftQueries = workflowDraftQueries(store, (scope, id, consumer, remove) => {
        const userId = core.identity.active()
        if (!userId) throw new Error('Draft query references require an active owner')
        return ctx.dataSources.setQueryConsumer(scope, id, consumer,
          { principal: { kind: 'internal', scope: 'service', userId }, signal: AbortSignal.timeout(60_000) }, remove)
      })
      defsCapability = ctx.capabilities.provide(WORKFLOW_DEFS_ROUTE, {
        files: async request => {
          const result = await workflowFileAuthoring(store, {
          catalog: runner.validationCatalog(),
          scope: async (projectId, source) => {
            const project = await core.projects.byId(projectId)
            if (!project || (source === 'repo' && !project.path)) throw new Error('Choose a local project for file authoring')
            return { root: source === 'repo' ? project.path! : homedir(), workspaceId: project.workspaceId, resolveInRoot: core.fs.resolveInRoot }
          },
          query: async (scope, queryId, revision) => {
            const userId = core.identity.active()
            if (!userId) throw new Error('Export requires an active owner')
            const result = await ctx.dataSources.queryPublication({ ...scope, action: 'inspect', queryId, revision },
              { principal: { kind: 'internal', scope: 'service', userId }, signal: AbortSignal.timeout(60_000) })
            if (!result.published) throw new Error('Publish the saved query before exporting')
            return result.published.content
          },
          })(request)
          const projectId = result.operation?.projectId ?? result.draft?.projectId
          const project = projectId ? await core.projects.byId(projectId) : null
          if (project && request.action !== 'open' && request.action !== 'list') defsChanged(project.workspaceId)
          return result
        },
        ...(() => {
          const invocation = () => {
            const userId = core.identity.active()
            if (!userId) throw new Error('Publication requires an active owner')
            return { principal: { kind: 'internal' as const, scope: 'service' as const, userId }, signal: AbortSignal.timeout(60_000) }
          }
          const publications = workflowPublication(store, {
            catalog: runner.validationCatalog(),
            scope: async (workspaceId, projectId) => {
              const project = projectId ? await core.projects.byId(projectId) : null
              if (projectId && (!project || project.workspaceId !== workspaceId)) throw new Error('Project is outside this workspace')
              return { workspaceId, projectId: projectId ?? '', repoDir: project?.path ?? null, userDir: homedir() }
            },
            query: request => ctx.dataSources.queryPublication(request, invocation()),
            validateQuery: async (scope, reference, context) => { await ctx.dataSources.resolveQuery(scope, reference, context, invocation()) },
            queryConsumer: (scope, id, consumer, remove) => ctx.dataSources.setQueryConsumer(scope, id, consumer, invocation(), remove),
          })
          return {
            preparePublication: publications.prepare,
            discardPublication: publications.discard,
            publications: async (workspaceId: string) => publications.list(workspaceId),
            publish: async (id: string) => {
              const result = await publications.publish(id)
              defsChanged(result.workspaceId)
              return result
            },
          }
        })(),
        list: async (workspaceId) =>
          mergedList(store, workspaceId, await core.projects.byWorkspace(workspaceId), { userDir: homedir(), catalog: runner.validationCatalog() }),
        // A row, or a committed file the editor opens read-only. The merged list carries a summary of
        // each definition and the editor needs the whole thing, so a file id resolves here rather than
        // fattening every list read (docs/workflows.md § Authoring).
        get: async (id, projectId) => {
          const file = /^(repo|user):(.+)$/.exec(id)
          if (!file) {
            const row = await getDef(store, id)
            if (!row) return null
            const published = row.publishedRevision ? await publishedWorkflow(store, id, row.publishedRevision) : null
            return { ...row, ...(published ? { publishedDef: published.def } : {}) }
          }
          const project = projectId ? await core.projects.byId(projectId) : null
          const loaded = loadWorkflowFiles(file[1] === 'repo' ? project?.path ?? null : null, homedir(), runner.validationCatalog())
          const found = loaded.workflows.find((workflow) => workflow.id === file[2] && workflow.source === file[1])
          if (!found) return null
          const { id: _id, source: _source, ...def } = found
          // `revision: 0` is the marker: a file has no row to save into, so the editor draws it
          // read-only and offers "Copy to database" instead of Save.
          return { id, workspaceId: project?.workspaceId ?? '', projectId: project?.id ?? null, name: found.name, revision: 0, createdAt: 0, updatedAt: 0, def }
        },
        // A row is a draft, so neither write validates. A workflow being built is invalid most of
        // the way: it has no steps the moment it is created, and a step has no prompt until one is
        // typed. `validate` reports and the editor draws what it says; `start` is what refuses.
        create: async ({ workspaceId, projectId, def }) => {
          const row = await draftQueries.create({ workspaceId, projectId, def: def as WorkflowDef })
          defsChanged(workspaceId)
          return { row }
        },
        update: async (id, def, revision) => {
          const answer = await draftQueries.update(id, def as WorkflowDef, revision)
          if (answer && 'row' in answer) defsChanged(answer.row.workspaceId)
          return answer
        },
        remove: async (id) => {
          const row = await getDef(store, id)
          if (!row) return { ok: true }
          await draftQueries.remove(id)
          defsChanged(row.workspaceId)
          return { ok: true }
        },
        validate: async (def, projectId) => {
          const catalog = await starts.catalogForProject(projectId)
          return {
            problems: validateWorkflow(def as WorkflowDef, {
              ...runner.validationCatalog(),
              workflowTargets: catalog.workflows,
            }),
          }
        },
        // Wiring only; the two calls and the repair pass are in ../server/authoring/generationRequest.ts.
        // The runner's validation catalog rather than the pure one built from the kinds alone: it
        // carries each contributed kind's own `validate`, without which a workspace definition with a
        // broken step passes the example filter and teaches the model the mistake.
        generate: async ({ userId, ...request }) => {
          const project = request.projectId ? await core.projects.byId(request.projectId) : null
          if (request.projectId && (!project || project.workspaceId !== request.workspaceId)) {
            return { error: 'The selected project is not in this workspace.' }
          }
          const catalog = await starts.generationCatalog(request.projectId, request.defId)
          return generateWorkflowRequest({
            request,
            catalog,
            validation: { ...runner.validationCatalog(), workflowTargets: catalog.workflows },
            // Rows, which carry the whole definition. The merged list summarises, and a summary is
            // not a worked example.
            examples: (await listDefs(store, request.workspaceId)).map((row) => ({ id: row.id, def: row.def })),
            generateText: (args) => core.models.generateText({ userId, ...args }),
          })
        },
        author: async ({ userId, principal, signal, ...request }) => {
          const projectId = request.scope.projectId
          const project = projectId ? await core.projects.byId(projectId) : null
          if (projectId && (!project || project.workspaceId !== request.scope.workspaceId)) {
            throw new Error('The selected project is not in this workspace.')
          }
          const catalog = await starts.generationCatalog(projectId, request.targetId)
          return authorWorkflowConversation({
            request,
            catalog,
            validation: { ...runner.validationCatalog(), workflowTargets: catalog.workflows },
            principal,
            signal,
            sources: ctx.dataSources,
            generate: input => core.models.generateText({
              userId, backendId: request.backendId,
              input: { ...input, ...(request.modelId ? { modelId: request.modelId } : {}) },
            }),
          })
        },
        modelBackends: (userId) => core.models.available(userId),
        saveToRepo: async () => ({ error: 'Use Export to repository to review the published dependency graph before writing files.' }),
      })
      schedulesCapability = ctx.capabilities.provide(WORKFLOW_SCHEDULES_ROUTE, {
        list: () => scheduleService!.views(),
        get: id => scheduleService!.view(id),
        defaults: () => ({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' }),
        prepare: input => scheduleService!.prepare(input),
        save: input => scheduleService!.saveManaged(input),
        approve: async (id, firstCheck, freshEpoch) => {
          await scheduleService!.approve(id, firstCheck, freshEpoch)
          return scheduleService!.view(id)
        },
        pause: (id, paused) => scheduleService!.pause(id, paused),
        runNow: id => scheduleService!.runNow(id),
        remove: id => scheduleService!.deleteManaged(id),
      })

      // Namespace-root router: it owns both task-scoped (/tasks/:id/workflows) and run-scoped
      // (/workflows/runs/:runId/...) paths. The internal paths are registered as declared, so the
      // client route builders and the server surface share one contract.
      ctx.routes.register(workflow, { prefix: '', note: 'workflow control' })
      ctx.routes.register(workflowDefsRoutes, { prefix: '', note: '/defs — definitions stored as rows, device only' })
      ctx.routes.register(workflowScheduleRoutes, { prefix: '/workflows/schedules', note: 'approved workflow schedules' })

      // This plugin's runs, for the merged list core assembles (@acorn/protocol/runs.ts). A pointer at
      // the route above, so nothing here knows what else is on that list.
      ctx.runs.register({ runs: '/v1/p/workflows/runs' })

      // reconcile() is not called here. It has to run after the listener binds and before the
      // composition root resolves `deps.reconciled`, so the root drives it through this capability
      // (server/runs/runner.ts explains the ordering).
      ctx.capabilities.provide(WORKFLOWS_RUNNER, {
        reconcile: async () => {
          const recovered = await dispatcher.reconcile()
          for (const error of recovered.errors) ctx.log.warn(`workflow dispatch recovery failed: ${error}`)
          await runner.reconcile()
        },
        start: (request) => starts.startInternal(request),
      })
      ctx.capabilities.provide(WORKFLOW_GATES, {
        list: async (taskId) => {
          const runs = await store.select().from(workflowRuns).where(eq(workflowRuns.taskId, taskId))
          const taskRuns = new Set(runs.map((run) => run.id))
          if (!taskRuns.size) return []
          const steps = await store.select().from(workflowSteps)
          return steps
            .filter((step) => taskRuns.has(step.runId) && step.status === 'waiting-gate')
            .map((step) => ({ taskId, runId: step.runId, stepId: step.id, name: step.name, status: 'waiting-gate' as const }))
        },
      })
      ctx.capabilities.provide(WORKFLOWS_NOTICES, notices)

      // The trigger clock, and the reason it is here rather than in the client half: a schedule is a
      // promise to run when nobody is looking (docs/schedules.md). The old poller was a client
      // schedule that skipped ticks while the window was hidden, so a headless node — every cloud node
      // — never fired a trigger at all. `POST .../triggers/poll` stays as the explicit "check now" for
      // a person who is looking.
      //
      // 300s because that is the plugin cadence floor the host clamps to anyway, and a trigger sweep
      // is a poll of external state, not a deadline.
      // The reactive half of the same sweep (docs/plugins.md § Hearing another plugin, the proving
      // consumer). github announces `checks-changed` only when a check row actually flipped, so a
      // green-to-red flip starts a trigger sweep within a round trip instead of at the next tick. The
      // schedule below stays as the backstop for a node whose github half is absent.
      ctx.events.on('plugin:github:checks-changed', () => {
        void runner.pollTriggers().catch((error: unknown) => ctx.log.warn(`trigger sweep after checks-changed failed: ${describeError(error).message}`))
      })
      ctx.schedules.register({
        scheduleId: 'triggers',
        name: 'Workflow triggers',
        cadence: { every: 300 },
        run: async () => {
          const { started, errors } = await runner.pollTriggers()
          if (errors.length) throw new Error(errors.join('; '))
          return started ? `started ${started}` : undefined
        },
      })
      await draftQueries.reconcile().catch(error => ctx.log.warn(`Draft query references need reconciliation: ${describeError(error).message}`))
      void deps.reconciled.then(() => scheduleService?.reconcile())
        .catch(error => ctx.log.warn(`workflow schedule recovery failed: ${describeError(error).message}`))
    },
    // The bridge slot is cleared explicitly rather than trusting teardown order: a second
    // startServiceRuntime in one process would otherwise serve workflow requests through the first
    // boot's closed database handle.
    //
    // In-flight steps are aborted here, before the handle closes, because a headless child that
    // outlives its database writes its outcome onto a closed connection. Run rows stay 'running' and
    // reconcile() sweeps them to 'pending' on the next boot.
    dispose: () => {
      live?.stop()
      live = null
      routeCapability?.dispose()
      defsCapability?.dispose()
      schedulesCapability?.dispose()
    },
  }
}
