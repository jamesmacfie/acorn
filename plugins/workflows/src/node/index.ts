import { homedir } from 'node:os'
import { formatContextBlock } from '@acorn/plugin-context/contract/contextBlock.ts'
import { AGENTS_SESSION_EXECUTE } from '@acorn/plugin-agents/contract/sessionExecute.ts'
import { NOTES_STORE } from '@acorn/plugin-notes/contract/store.ts'
import { TERMINAL_RUN_TARGETS } from '@acorn/plugin-terminal/contract/runTargets.ts'
import { DEFAULT_PROFILE_ID } from '@acorn/node-core/main/agentProfiles/index.ts'
import { buildHeadlessArgv, runHeadless } from '@acorn/node-core/main/headless.ts'
import { openPluginDb } from '@acorn/node-core/main/pluginStorage.ts'
import { getProfile, requireProfile, resolveCommand } from '@acorn/node-core/main/profiles.ts'
import { isRepoConfigTrustError } from '@acorn/node-core/main/repoConfigTrust.ts'
import { buildSessionEnv } from '@acorn/node-core/main/taskEnv.ts'
import { isDir } from '@acorn/node-core/main/taskWorktree.ts'
import type { InternalEnvFactory } from '@acorn/node-core/server/auth/internalTokens.ts'
import type { NodePlugin } from '@acorn/node-core/server/plugin/types.ts'
import { eq } from 'drizzle-orm'
import { loadWorkflowFiles } from '../main/workflowFiles'
import { WorkflowRunner, type WorkflowDef } from '../main/workflowRunner'
import { WORKFLOWS_RUNNER } from '../contract/runner'
import { encodeToolCeiling } from '../main/workflowTools'
import { WorkflowValidationError } from '../main/workflowValidation'
import { WORKFLOW_ROUTE, workflow } from '../server/routes/workflow'
import { migrationsDir } from './migrations'
import { workflowRuns } from './schema'

export type WorkflowsPluginDeps = {
  internalEnv: InternalEnvFactory
  // Resolves when the composition root's post-window reconcile pass is done (always resolves, even on
  // failure). workflow:start/gate/cancel/kill await it: reconcile() sweeps EVERY 'running' step to
  // 'pending', so a run started before the sweep would have its live step re-queued underneath it.
  reconciled: Promise<void>
  // plugins/memory's auto-generation trigger, as a thunk (see the header). Optional so a node with
  // memory disabled still runs workflows — the run simply produces no memory proposals.
  memoryReviewTrigger?: (taskId: string, transcriptTail: string) => Promise<void>
  // '' when every check passed, a rendered list when some failed, null when there is nothing to check
  // (no PR, no identity, no mirrored repo). The three-valued answer is load-bearing: the ci-loop step
  // treats null as a hard failure and '' as done.
  failingChecks: (taskId: string) => Promise<string | null>
}

export const workflowsPlugin = (dataDir: string, deps: WorkflowsPluginDeps): NodePlugin => {
  let db: ReturnType<typeof openPluginDb> | null = null
  // Held so dispose can abort in-flight steps before the database closes (see dispose below).
  let live: WorkflowRunner | null = null
  let routeCapability: { dispose(): void } | null = null
  return {
    name: 'workflows',
    init: (ctx) => {
      // Opened and migrated before the listener binds: the runner and the bridge below both close over
      // the handle, so no request can reach an unmigrated database.
      db = openPluginDb(dataDir, 'workflows', { migrationsFolder: migrationsDir() })
      const store = db
      const core = ctx.core

      const runner = new WorkflowRunner(store, {
        runStep: async (taskId, def, opts) => {
          // Resolved per call, not at init: plugin init order is not defined, and reading the capability
          // once here would cache `undefined` whenever agents happened to initialize second.
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
          const mapped = task ? await core.repos.path(task.repoOwner, task.repoName) : null
          const baseCheckout = mapped?.path && isDir(mapped.path) ? mapped.path : undefined
          // The identity is passed through because creating the worktree consults the owner's per-repo
          // base_ref preference — dropping it would silently fall back to git's origin/main.
          const { cwd } = task ? await core.tasks.resolveCwd(task, baseCheckout, core.identity.active()) : { cwd: homedir() }
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
            task: task ? { repoOwner: task.repoOwner, repoName: task.repoName, branch: task.branch, title: task.title } : null,
            // 'task'-scoped, bound to the step's own task: a workflow step is a child process, so it is
            // denied the owner's provider credentials and confined to this task's tool surface.
            env: { ...deps.internalEnv({ scope: 'task', taskId }), ACORN_TOOL_CEILING: encodeToolCeiling(opts.tools ?? {}) },
          })
          return runHeadless(argv, { cwd, env, timeoutMs: opts.timeoutMs, signal: opts.signal, onEvent: opts.onEvent, adapter: profile.streamJson })
        },
        // Handoffs are notes, in plugins/notes' store, resolved at call time (its capability id is in a
        // contract/, so this is a sanctioned edge rather than a coupling).
        writeHandoff: async (taskId, runId, stepName, body) => {
          await ctx.capabilities
            .require(NOTES_STORE)
            .append({ scope: 'task', taskId }, `workflow-handoffs-${runId}`, `## ${stepName}\n${body}\n`, { author: 'workflow', originTaskId: taskId })
        },
        // De-included rather than deleted when the run ends: the handoff trail stays readable in the
        // pane, it just stops being injected into every later agent session for this task.
        // `async`, not a bare arrow returning the promise: the runner calls this as
        // `finishHandoffs?.(…).catch(…)`, so a SYNCHRONOUS throw from `require` would escape that catch
        // and propagate out of finishRun, leaving a terminal run un-finished.
        finishHandoffs: async (taskId, runId) => {
          await ctx.capabilities.require(NOTES_STORE).setIncluded({ scope: 'task', taskId }, `workflow-handoffs-${runId}`, false)
        },
        assembleContext: async (taskId, runId) => {
          try {
            // 'service' scope: this is the node calling its own HTTP surface to reuse core's context
            // assembler, not a child process. It keeps full reach precisely so context assembly survives
            // the task-scope restriction that applies to agents.
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
        // Policy verdicts are RE-DERIVED here — a lying step result is ignored by construction.
        evaluatePolicy: async (taskId, policy) => {
          if (policy === 'checks-green') {
            const failing = await deps.failingChecks(taskId)
            if (failing === '') return { pass: true }
            return { pass: false, detail: failing == null ? 'No PR/checks to verify.' : `Failing checks:\n${failing}` }
          }
          return { pass: false, detail: `Unknown policy '${policy}' — failing closed.` }
        },
        failingChecks: deps.failingChecks,
        notify: ctx.events.notice,
        statusChanged: ctx.events.status,
        emitStepEvent: ctx.events.stepEvent,
        onRunTerminal: async (taskId, runId) => {
          if (!deps.memoryReviewTrigger) return
          const handoff = await ctx.capabilities
            .require(NOTES_STORE)
            .read({ scope: 'task', taskId }, `workflow-handoffs-${runId}`)
            .catch(() => null)
          await deps.memoryReviewTrigger(taskId, handoff?.body ?? `Workflow ${runId} reached a terminal state.`)
        },
        startRunTarget: async (taskId, targetId) => {
          // terminal.runTargets, resolved at call time. A node with terminal disabled cannot start a run
          // target at all, and the runner turns the falsy answer into a clean step failure.
          const runTargets = ctx.capabilities.get(TERMINAL_RUN_TARGETS)
          if (!runTargets) return { ok: false }
          const started = await runTargets.start(taskId, targetId)
          if (!started.ok) return { ok: false }
          const status = await runTargets.status(taskId, targetId)
          return { ok: true, url: status.url }
        },
        // Fan-out (14 P4): materialise a child task on its own (de-duped, slugged) branch. Core owns
        // `tasks`, so the insert is core's — this plugin has no handle to that file. The child's worktree
        // is created lazily by resolveCwd the moment its step runs.
        createChildTask: (parentTaskId, seed) => core.tasks.createChild(parentTaskId, seed),
        cancelChildTask: (taskId) => core.tasks.cancel(taskId),
        authorizeRepoConfig: (taskId) => core.repos.assertConfigTrusted(taskId),
      })
      // Kept so dispose can abort in-flight steps before the database closes.
      live = runner

      routeCapability = ctx.capabilities.provide(WORKFLOW_ROUTE, {
        // One column off this plugin's own runs table — see WorkflowBridge for why the router needs it.
        taskIdForRun: async (runId) => {
          const [row] = await store.select({ taskId: workflowRuns.taskId }).from(workflowRuns).where(eq(workflowRuns.id, runId)).limit(1)
          return row?.taskId ?? null
        },
        // Declared workflows for a task (docs/workflows.md): `.acorn/workflows/*.toml` from the
        // worktree/checkout + ~/.acorn, parse/cycle errors surfaced as palette rows (13 §B).
        defs: async (taskId) => {
          const task = await core.tasks.load(taskId)
          if (!task) return { workflows: [], errors: [] }
          const mapped = await core.repos.path(task.repoOwner, task.repoName)
          const repoDir = task.worktreePath && isDir(task.worktreePath) ? task.worktreePath : mapped?.path && isDir(mapped.path) ? mapped.path : null
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
        pollTriggers: () => runner.pollTriggers(),
      })

      // Namespace-root router: it owns both task-scoped (/tasks/:id/workflows) and run-scoped
      // (/workflows/runs/:runId/...) paths. The internal paths are registered as declared so the client
      // route builders and server surface share one contract.
      ctx.routes.register(workflow, { prefix: '', note: 'workflow control' })

      // reconcile() is NOT called here. It has to run after the listener binds and before the
      // composition root resolves `deps.reconciled`, so the root drives it through this capability
      // (main/workflowRunner.ts explains the ordering).
      ctx.capabilities.provide(WORKFLOWS_RUNNER, { reconcile: () => runner.reconcile() })
    },
    // The plugin's SQLite file is in WAL mode, so it has to be closed before the data root's lock is
    // dropped — the composition root's own teardown invariant. The bridge slot is cleared explicitly
    // rather than trusting teardown order: a second startServiceRuntime in one process would otherwise
    // serve workflow requests through the first boot's closed database handle.
    // Abort in-flight steps BEFORE closing the handle. A headless child outliving its database wrote its
    // outcome onto a closed connection; the run rows stay 'running' and reconcile() sweeps them to
    // 'pending' on the next boot, which is what that sweep exists for.
    dispose: () => {
      live?.stop()
      live = null
      routeCapability?.dispose()
      db?.close()
      db = null
    },
  }
}
