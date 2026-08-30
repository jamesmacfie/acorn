import { pluginChannel } from '@acorn/protocol/pluginState.ts'
import { homedir } from 'node:os'
import { formatContextBlock } from '@acorn/plugin-context/contract/contextBlock.ts'
import { AGENTS_SESSION_EXECUTE } from '@acorn/plugin-agents/contract/sessionExecute.ts'
import { NOTES_STORE } from '@acorn/plugin-notes/contract/store.ts'
import { TERMINAL_RUN_TARGETS } from '@acorn/plugin-terminal/contract/runTargets.ts'
import { buildHeadlessArgv, buildSessionEnv, DEFAULT_PROFILE_ID, getProfile, type InternalEnvFactory, isDir, isRepoConfigTrustError, type NodePlugin, requireProfile, resolveCommand, runHeadless } from '@acorn/plugin-api/node'
import { desc, eq, inArray, sum } from 'drizzle-orm'
import { loadWorkflowFiles } from '../server/workflowFiles'
import { WorkflowRunner, type WorkflowDef } from '../server/workflowRunner'
import { WORKFLOWS_NOTICES, type WorkflowNotices } from '../contract/notices'
import { WORKFLOWS_RUNNER } from '../contract/runner'
import { WORKFLOW_POLICY, WORKFLOW_STEP_KIND, WORKFLOW_TRIGGER } from '../contract/extensions'
import { encodeToolCeiling } from '../server/workflowTools'
import { WorkflowValidationError } from '../server/workflowValidation'
import { WORKFLOW_ROUTE, workflow } from '../server/routes/workflow'
import { RUN_LIST_LIMIT, TERMINAL_WORKFLOW_STATUSES, toRunStatus } from '../shared/runStatus'
import { workflowRuns, workflowSteps } from './schema'

export type WorkflowsPluginDeps = {
  internalEnv: InternalEnvFactory
  // Resolves when the composition root's post-window reconcile pass finishes, even on failure.
  // workflow:start, gate, cancel, and kill all await it: reconcile() sweeps every 'running' step to
  // 'pending', so a run started before the sweep has its live step re-queued underneath it.
  reconciled: Promise<void>
  // plugins/memory's auto-generation trigger, as a thunk. Optional, so a node with memory disabled
  // still runs workflows and the run produces no memory proposals.
  memoryReviewTrigger?: (taskId: string, transcriptTail: string) => Promise<void>
  // '' when every check passed, a rendered list when some failed, null when there is nothing to check
  // (no PR, no identity, no mirrored repo). The three-valued answer is load-bearing: the ci-loop step
  // treats null as a hard failure and '' as done.
  failingChecks: (taskId: string) => Promise<string | null>
}

export const workflowsPlugin = (deps: WorkflowsPluginDeps): NodePlugin => {
  // Held so dispose can abort in-flight steps before the database closes (see dispose below).
  let live: WorkflowRunner | null = null
  let routeCapability: { dispose(): void } | null = null
  // The bell and the step stream, this plugin's own vocabulary rather than a member of the broadcast
  // surface every plugin receives (../contract/notices.ts). Both go out on core's `workflow:` channels,
  // which is why they are written as frames here rather than reaching for a core helper: `ctx.events`
  // is the seam, and a plugin does not deep-import server/notify.ts.
  const buildNotices = (ctx: Parameters<NonNullable<NodePlugin['init']>>[0]): WorkflowNotices => ({
    notice: (taskId, kind, title) => {
      ctx.events.send({ channel: 'workflow:notice', notice: { taskId, kind, title } })
      ctx.events.status()
    },
    stepEvent: (runId, stepId, event) => ctx.events.send({ channel: 'workflow:step:event', runId, stepId, event }),
  })
  return {
    name: 'workflows',
    // This module's own URL: the chain sits at plugins/workflows/migrations beside it, and the host
    // owns open, migrate, and close from there (@acorn/node-core/server/plugins/storage.ts).
    migrationsModule: import.meta.url,
    init: (ctx) => {
      // Opened and migrated by the host before init returns. The runner and the bridge below both
      // close over the handle, so no request can reach an unmigrated database.
      const store = ctx.storage.open()
      const core = ctx.core
      const notices = buildNotices(ctx)

      // The three seams another plugin adds work through (../contract/extensions.ts). Opened before the
      // runner is built so a contribution filed during someone else's init is visible on the first
      // sweep; `entries` is resolved per call, so init order still does not matter.
      ctx.extensionPoints.open(WORKFLOW_STEP_KIND, 'Workflow step kinds')
      ctx.extensionPoints.open(WORKFLOW_POLICY, 'Workflow gate policies')
      ctx.extensionPoints.open(WORKFLOW_TRIGGER, 'Workflow triggers')

      // The one decision this plugin opens to other plugins (docs/plugins.md § Hooks). A veto here is a
      // safety-rail, not a failure, which is why the point allows nothing else: a plugin that could
      // rewrite a step would be rewriting the workflow the owner read before running it.
      ctx.hooks.declare({
        id: 'before-step',
        label: 'run a workflow step',
        payload: { taskId: 'string', runId: 'string', stepId: 'string', step: 'string', kind: 'string' },
        allows: ['observe', 'veto'],
      })
      const runner = new WorkflowRunner(store, {
        hooks: ctx.hooks,
        runStep: async (taskId, def, opts) => {
          // Resolved per call, not at init (docs/plugins.md § Collaboration rules): plugin init
          // order is not defined.
          const managed = await ctx.capabilities.get(AGENTS_SESSION_EXECUTE)?.({
            taskId,
            profileId: def.profileId,
            title: `Workflow: ${def.name}`,
            prompt: opts.prompt,
            schema: opts.schema,
            model: opts.model,
            tools: opts.tools,
            timeoutMs: opts.timeoutMs,
            managedSessionId: opts.managedSessionId,
            runId: opts.workflowRunId,
            stepId: opts.workflowStepId,
            onEvent: opts.onEvent,
            signal: opts.signal,
          })
          if (managed) return managed
          // The headless fallback: a profile with no managed driver, or a node with agents disabled.
          const task = await core.tasks.load(taskId)
          // The identity is passed through because creating the worktree consults the owner's per-repo
          // base_ref preference; dropping it would silently fall back to git's origin/main.
          const { cwd } = task ? await core.tasks.resolveCwd(task, undefined, core.identity.active()) : { cwd: homedir() }
          const project = task?.projectId ? await core.projects.byId(task.projectId) : null
          const profile = requireProfile(def.profileId ?? DEFAULT_PROFILE_ID)
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
            env: { ...deps.internalEnv({ scope: 'task', taskId }), ACORN_TOOL_CEILING: encodeToolCeiling(opts.tools ?? {}) },
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
            const res = await fetch(`${loopback.ACORN_API_URL}/v2/core/tasks/${taskId}/context?workflowRunId=${encodeURIComponent(runId)}`, {
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
            const failing = await deps.failingChecks(taskId)
            if (failing === '') return { pass: true }
            return { pass: false, detail: failing == null ? 'No PR/checks to verify.' : `Failing checks:\n${failing}` }
          }
          return { pass: false, detail: `Unknown policy '${policy}' — failing closed.` }
        },
        failingChecks: deps.failingChecks,
        notify: notices.notice,
        statusChanged: ctx.events.status,
        // `plugin:workflows:run-changed` (docs/plugins.md § Hearing another plugin).
        runChanged: (runId, status) => ctx.events.send({ channel: pluginChannel('workflows', 'run-changed'), runId, status }),
        emitStepEvent: notices.stepEvent,
        onRunTerminal: async (taskId, runId) => {
          if (!deps.memoryReviewTrigger) return
          const handoff = await ctx.capabilities
            .require(NOTES_STORE)
            .read({ scope: 'task', taskId }, `workflow-handoffs-${runId}`)
            .catch(() => null)
          await deps.memoryReviewTrigger(taskId, handoff?.body ?? `Workflow ${runId} reached a terminal state.`)
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
        // Materialises a child task (docs/workflows.md covers fan-out, branch dedup, and lazy worktree
        // creation). Core owns `tasks`, so the insert is core's.
        createChildTask: (parentTaskId, seed) => core.tasks.createChild(parentTaskId, seed),
        cancelChildTask: (taskId) => core.tasks.cancel(taskId),
        authorizeRepoConfig: (taskId) => core.projects.assertConfigTrusted(taskId),
      }, ctx.extensionPoints)
      // Kept so dispose can abort in-flight steps before the database closes.
      live = runner

      routeCapability = ctx.capabilities.provide(WORKFLOW_ROUTE, {
        // One column off this plugin's own runs table. See WorkflowBridge for why the router needs it.
        taskIdForRun: async (runId) => {
          const [row] = await store.select({ taskId: workflowRuns.taskId }).from(workflowRuns).where(eq(workflowRuns.id, runId)).limit(1)
          return row?.taskId ?? null
        },
        // Declared workflows for a task (docs/workflows.md): `.acorn/workflows/*.toml` from the
        // worktree/checkout plus ~/.acorn, with parse/cycle errors surfaced as palette rows.
        defs: async (taskId) => {
          const task = await core.tasks.load(taskId)
          if (!task) return { workflows: [], errors: [] }
          const project = await core.projects.byId(task.projectId)
          const repoDir = task.worktreePath && isDir(task.worktreePath) ? task.worktreePath : project?.path && isDir(project.path) ? project.path : null
          return loadWorkflowFiles(repoDir, homedir(), runner.validationCatalog())
        },
        start: async (taskId, def) => {
          await deps.reconciled // don't start a run the restart sweep would immediately re-queue
          try {
            return { runId: await runner.start(taskId, def as WorkflowDef) }
          } catch (error) {
            if (isRepoConfigTrustError(error)) {
              ctx.events.repoConfigTrustNotice(taskId)
              return { error: 'needs-trust' }
            }
            return { error: error instanceof WorkflowValidationError ? error.message : 'Failed to start workflow.' }
          }
        },
        runs: async (taskId) => {
          const rows = await store.select().from(workflowRuns).where(eq(workflowRuns.taskId, taskId))
          return rows.sort((a, b) => b.createdAt - a.createdAt)
        },
        // This plugin's contribution to the merged run list (@acorn/protocol/runs.ts). A projection,
        // not the rows: the merged list is display-shaped and deliberately narrow, and a caller that
        // wants a run's steps comes back to this plugin addressing it by id.
        allRuns: async () => {
          const rows = await store.select().from(workflowRuns).orderBy(desc(workflowRuns.createdAt)).limit(RUN_LIST_LIMIT)
          // One grouped read rather than a join per row: cost lives on the steps and the merged list
          // shows it per run, which is the only reason this plugin has to add anything up here.
          const costRows = rows.length
            ? await store
              .select({ runId: workflowSteps.runId, costUsd: sum(workflowSteps.costUsd) })
              .from(workflowSteps)
              .where(inArray(workflowSteps.runId, rows.map((row) => row.id)))
              .groupBy(workflowSteps.runId)
            : []
          const costs = new Map(costRows.map((row) => [row.runId, Number(row.costUsd ?? 0)]))
          return {
            runs: rows.map((row) => ({
              id: row.id,
              title: row.name,
              status: toRunStatus(row.status),
              startedAt: row.createdAt,
              endedAt: TERMINAL_WORKFLOW_STATUSES.has(row.status) ? row.updatedAt : null,
              taskId: row.taskId,
              costUsd: costs.get(row.id) ?? null,
              ...(row.error ? { detail: row.error.slice(0, 200) } : {}),
            })),
          }
        },
        steps: async (runId) =>
          (await runner.steps(runId)).map((step) => {
            if (!step.sessionId || !step.profileId || /[^A-Za-z0-9_-]/.test(step.sessionId)) return step
            const profile = getProfile(step.profileId)
            if (profile.id !== step.profileId) return { ...step, resumeCommand: null }
            const resume = profile.resumeArgv?.(resolveCommand(profile), step.sessionId)
            return { ...step, resumeCommand: resume ? [resume.file, ...resume.args].join(' ') : null }
          }),
        gate: async (runId, stepId, approved) => {
          await deps.reconciled // an approval resumes a step the restart sweep could otherwise clobber
          await runner.resolveGate(runId, stepId, approved)
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
      })

      // Namespace-root router: it owns both task-scoped (/tasks/:id/workflows) and run-scoped
      // (/workflows/runs/:runId/...) paths. The internal paths are registered as declared, so the
      // client route builders and the server surface share one contract.
      ctx.routes.register(workflow, { prefix: '', note: 'workflow control' })

      // This plugin's runs, for the merged list core assembles (@acorn/protocol/runs.ts). A pointer at
      // the route above, so nothing here knows what else is on that list.
      ctx.runs.register({ runs: '/v2/p/workflows/runs' })

      // reconcile() is not called here. It has to run after the listener binds and before the
      // composition root resolves `deps.reconciled`, so the root drives it through this capability
      // (server/workflowRunner.ts explains the ordering).
      ctx.capabilities.provide(WORKFLOWS_RUNNER, { reconcile: () => runner.reconcile() })
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
        void runner.pollTriggers().catch((error) => console.warn('[workflows] trigger sweep after checks-changed failed:', error))
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
    },
  }
}
