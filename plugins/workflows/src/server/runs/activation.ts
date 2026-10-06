import { pluginChannel } from '@acorn/protocol/plugin/state.ts'
import { homedir } from 'node:os'
import { formatContextBlock } from '@acorn/plugin-context/contract/contextBlock.ts'
import { AGENTS_SESSION_CONTROL, AGENTS_SESSION_EXECUTE } from '@acorn/plugin-agents/contract/sessionExecute.ts'
import { NOTES_STORE } from '@acorn/plugin-notes/contract/store.ts'
import { GITHUB_MIRROR } from '@acorn/plugin-github/contract/mirror.ts'
import { TERMINAL_RUN_TARGETS } from '@acorn/plugin-terminal/contract/runTargets.ts'
import { buildHeadlessArgv, buildSessionEnv, describeError, type InternalEnvFactory, type NodePlugin, requireProfile, resolveCommand, runHeadless, type PluginDatabase } from '@acorn/plugin-api/node'
import { eq } from 'drizzle-orm'
import { WorkflowDispatcher } from '../dispatch/dispatcher'
import { inlinePrompt } from './deps'
import { WorkflowProcessingStore } from '../processing/store'
import { WorkflowRunner, type RunnerDeps } from './runner'
import { destinationQuery } from '../validation/destination'
import { assertWorkflowDataScope } from '../steps/data'
import { encodeToolCeiling } from '../steps/tools'
import { workflowRuns } from '../../node/schema'
import type { WorkflowNotices } from '../../contract/notices'

type PluginContext = Parameters<NonNullable<NodePlugin['init']>>[0]
type RunnerContext = Pick<PluginContext, 'core' | 'capabilities' | 'dataSources' | 'datasets' | 'hooks' | 'telemetry' | 'events' | 'extensionPoints' | 'log'>

/** Builds the runner and its child dispatcher as one fully connected pair. */
export const createWorkflowExecution = (
  store: PluginDatabase,
  ctx: RunnerContext,
  internalEnv: InternalEnvFactory,
  notices: WorkflowNotices,
  settleSchedule: (runId: string) => Promise<void>,
): { runner: WorkflowRunner; dispatcher: WorkflowDispatcher } => {
  const core = ctx.core
  const failingChecks = async (taskId: string): Promise<string | null> =>
    (await ctx.capabilities.get(GITHUB_MIRROR)?.failingChecks(core.identity.active(), taskId)) ?? null
  const notify: RunnerDeps['notify'] = (taskId, kind, title, ref) => ctx.events.notice({
    taskId, kind, title,
    ...(ref ? { target: { kind: 'workflow-run', resourceId: ref.runId, ...(ref.stepId ? { subresourceId: ref.stepId } : {}) } } : {}),
  })
  let connectedDispatcher: WorkflowDispatcher | null = null
  const dispatch = (): WorkflowDispatcher => {
    if (!connectedDispatcher) throw new Error('Workflow dispatch is not ready')
    return connectedDispatcher
  }
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
        writeDataset: input => ctx.datasets.writeForTask(taskId, input),
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
      // Resolved per call, not at init (docs/plugins/collaboration.md § Collaboration rules): plugin init
      // order is not defined.
      const managed = await ctx.capabilities.get(AGENTS_SESSION_EXECUTE)?.({
        taskId,
        profileId: opts.profileId,
        title: opts.sessionTitle ?? `Workflow: ${def.name}`,
        prompt: opts.prompt,
        context: opts.context,
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
      if (opts.requireManagedSession) throw new Error('Agent sessions are unavailable. Enable the Agents plugin to run this loop.')
      // The headless fallback, which now means what it says: a profile with no managed driver, or
      // a node with agents disabled. It used to catch a blank harness as well.
      const task = await core.tasks.load(taskId)
      const { cwd } = task ? await core.tasks.resolveCwd(task, undefined) : { cwd: homedir() }
      const project = task?.projectId ? await core.projects.byId(task.projectId) : null
      const profile = requireProfile(opts.profileId)
      // A command line takes one prompt, so the context goes into it as headed sections.
      const oneShot = { ...opts, prompt: inlinePrompt(opts.prompt, opts.context) }
      const argv = opts.mode === 'ai' ? profile.aiArgv?.(resolveCommand(profile), oneShot) : buildHeadlessArgv(profile.id, resolveCommand(profile), oneShot)
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
          ...internalEnv({ scope: 'task', taskId, toolCeiling: opts.tools ?? {} }),
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
        const loopback = internalEnv({ scope: 'service' })
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
    notify,
    // Per step, unlike run-changed: the run pane moves one node's glyph without re-reading the run.
    stepChanged: (runId, stepId, status) => ctx.events.send({ channel: 'workflow:step-changed', runId, stepId, status }),
    statusChanged: ctx.events.status,
    // `plugin:workflows:run-changed` (docs/plugins/events.md § Hearing another plugin).
    runChanged: (taskId, runId, status) => ctx.events.send({ channel: pluginChannel('workflows', 'run-changed'), taskId, runId, status }),
    gateChanged: (taskId, runId, stepId, status) => ctx.events.send({ channel: pluginChannel('workflows', 'gate-changed'), taskId, runId, stepId, status }),
    emitStepEvent: notices.stepEvent,
    onRunTerminal: async (taskId, runId) => {
      await settleSchedule(runId).catch(error => ctx.log.warn(`workflow schedule settlement failed: ${describeError(error).message}`))
      const [run] = await store.select({ status: workflowRuns.status, completedAt: workflowRuns.updatedAt }).from(workflowRuns).where(eq(workflowRuns.id, runId)).limit(1)
      // `setRun` announces the terminal status before this callback. Repeat it after schedule
      // settlement so clients that refresh both read models cannot race the schedule write.
      if (run) ctx.events.send({ channel: pluginChannel('workflows', 'run-changed'), taskId, runId, status: run.status })
      if (run) ctx.events.send({
        channel: pluginChannel('workflows', 'completed'),
        taskId, runId, status: run.status, completedAt: run.completedAt
      })
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
    dispatchChildWorkflow: (request, signal) => dispatch().dispatch(request, signal),
    dispatchChildWorkflows: (requests, signal) => dispatch().dispatchMany(requests, signal),
    selectWorkflowRecords: (request, signal) => new WorkflowProcessingStore(store, dispatch()).dispatch(request, signal),
    childChanged: (event) => ctx.events.send({ channel: pluginChannel('workflows', 'child-changed'), ...event }),
    authorizeRepoConfig: (taskId) => core.projects.assertConfigTrusted(taskId),
  }, ctx.extensionPoints)
  connectedDispatcher = new WorkflowDispatcher(store, runner, core.tasks, {
    authorizeRepoConfig: (taskId) => core.projects.assertConfigTrusted(taskId),
  })
  return { runner, dispatcher: dispatch() }
}
