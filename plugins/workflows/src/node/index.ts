import { pluginChannel } from '@acorn/protocol/plugin/state.ts'
import { homedir } from 'node:os'
import { formatContextBlock } from '@acorn/plugin-context/contract/contextBlock.ts'
import { AGENTS_SESSION_EXECUTE } from '@acorn/plugin-agents/contract/sessionExecute.ts'
import { NOTES_STORE } from '@acorn/plugin-notes/contract/store.ts'
import { TERMINAL_RUN_TARGETS } from '@acorn/plugin-terminal/contract/runTargets.ts'
import { buildHeadlessArgv, buildSessionEnv, DEFAULT_PROFILE_ID, getProfile, type InternalEnvFactory, isDir, isRepoConfigTrustError, type NodePlugin, requireProfile, resolveCommand, runHeadless } from '@acorn/plugin-api/node'
import { desc, eq, inArray, sum } from 'drizzle-orm'
import { loadWorkflowFiles } from '../server/workflowFiles'
import { createDef, defsForProject, getDef, listDefs, mergedList, removeDef, saveDefToRepo, updateDef } from '../server/workflowDefs'
import { generateWorkflowRequest } from '../server/generateWorkflowRequest'
import { WorkflowRunner, type WorkflowDef } from '../server/workflowRunner'
import { WORKFLOWS_NOTICES, type WorkflowNotices } from '../contract/notices'
import { WORKFLOWS_RUNNER } from '../contract/runner'
import { WORKFLOW_POLICY, WORKFLOW_STEP_KIND, WORKFLOW_TRIGGER } from '../contract/extensions'
import { encodeToolCeiling } from '../server/workflowTools'
import { validateWorkflow, WorkflowValidationError } from '../server/workflowValidation'
import { WORKFLOW_ROUTE, workflow } from '../server/routes/workflow'
import { WORKFLOW_DEFS_ROUTE, workflowDefsRoutes } from '../server/routes/defs'
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
  let defsCapability: { dispose(): void } | null = null
  // The bell and the step stream, this plugin's own vocabulary rather than a member of the broadcast
  // surface every plugin receives (../contract/notices.ts). Both go out on core's `workflow:` channels,
  // which is why they are written as frames here rather than reaching for a core helper: `ctx.events`
  // is the seam, and a plugin does not deep-import server/notify.ts.
  const buildNotices = (ctx: Parameters<NonNullable<NodePlugin['init']>>[0]): WorkflowNotices => ({
    notice: (taskId, kind, title, ref) => {
      ctx.events.send({ channel: 'workflow:notice', notice: { taskId, kind, title, ...ref } })
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
        // Per step, unlike run-changed: the run pane moves one node's glyph without re-reading the run.
        stepChanged: (runId, stepId, status) => ctx.events.send({ channel: 'workflow:step-changed', runId, stepId, status }),
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

      // A task's project and the checkout its workflow files load from. `null` once the task is gone.
      const taskScope = async (taskId: string) => {
        const task = await core.tasks.load(taskId)
        if (!task) return null
        const project = await core.projects.byId(task.projectId)
        const repoDir = task.worktreePath && isDir(task.worktreePath) ? task.worktreePath : project?.path && isDir(project.path) ? project.path : null
        return { task, project, repoDir }
      }

      const startDef = async (taskId: string, def: WorkflowDef, inputs?: Record<string, string>) => {
        await deps.reconciled // don't start a run the restart sweep would immediately re-queue
        try {
          return { runId: await runner.start(taskId, def, { inputs }) }
        } catch (error) {
          if (isRepoConfigTrustError(error)) {
            ctx.events.repoConfigTrustNotice(taskId)
            return { error: 'needs-trust' }
          }
          return { error: error instanceof WorkflowValidationError ? error.message : 'Failed to start workflow.' }
        }
      }

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
          const rows = await defsForProject(store, scope.project.workspaceId, scope.project.id)
          return {
            ...files,
            // A file wins an id collision, the rule the merged rail list applies as well.
            workflows: [...files.workflows, ...rows.filter((row) => !ids.has(row.id)).map((row) => ({ ...row.def, id: row.id, source: 'database' as const }))],
          }
        },
        catalog: async () => runner.catalog(),
        start: (taskId, def, inputs) => startDef(taskId, def as WorkflowDef, inputs),
        startById: async (taskId, defId, inputs) => {
          const scope = await taskScope(taskId)
          if (!scope) return { error: 'That task no longer exists.' }
          const file = /^(repo|user):(.+)$/.exec(defId)
          if (file) {
            const loaded = loadWorkflowFiles(scope.repoDir, homedir(), runner.validationCatalog())
            const found = loaded.workflows.find((workflow) => workflow.id === file[2] && workflow.source === file[1])
            if (!found) return { error: `'${file[2]}' is not a workflow this task can run.` }
            // `found.source` is what makes runner.start assert the repo trust snapshot for a committed
            // file. Resolving here rather than trusting a definition in the request body is the point.
            return startDef(taskId, found, inputs)
          }
          const row = await getDef(store, defId)
          if (!row || !scope.project || row.workspaceId !== scope.project.workspaceId || (row.projectId && row.projectId !== scope.project.id)) {
            return { error: 'That workflow is not one this task can run.' }
          }
          // No trust check: a row was typed by the owner behind the device gate and has no committed
          // bytes to hash (docs/security.md § Process, path, and configuration controls).
          return startDef(taskId, row.def, inputs)
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
      defsCapability = ctx.capabilities.provide(WORKFLOW_DEFS_ROUTE, {
        list: async (workspaceId) =>
          mergedList(store, workspaceId, await core.projects.byWorkspace(workspaceId), { userDir: homedir(), catalog: runner.validationCatalog() }),
        // A row, or a committed file the editor opens read-only. The merged list carries a summary of
        // each definition and the editor needs the whole thing, so a file id resolves here rather than
        // fattening every list read (docs/workflows.md § Authoring).
        get: async (id, projectId) => {
          const file = /^(repo|user):(.+)$/.exec(id)
          if (!file) return getDef(store, id)
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
          const row = await createDef(store, { workspaceId, projectId, def: def as WorkflowDef })
          defsChanged(workspaceId)
          return { row }
        },
        update: async (id, def, revision) => {
          const answer = await updateDef(store, id, def as WorkflowDef, revision)
          if (answer && 'row' in answer) defsChanged(answer.row.workspaceId)
          return answer
        },
        remove: async (id) => {
          const row = await getDef(store, id)
          if (!row) return { ok: true }
          await removeDef(store, id)
          defsChanged(row.workspaceId)
          return { ok: true }
        },
        // `projectId` is accepted and unused, as the catalog route's is. What a step may name inside a
        // project — a run target, a saved query — is checked when the step runs, because the node
        // validating a definition may not have the repository at all.
        validate: async (def) => ({ problems: validateWorkflow(def as WorkflowDef, runner.validationCatalog()) }),
        // Wiring only; the two calls and the repair pass are in ../server/generateWorkflowRequest.ts.
        // The runner's validation catalog rather than the pure one built from the kinds alone: it
        // carries each contributed kind's own `validate`, without which a workspace definition with a
        // broken step passes the example filter and teaches the model the mistake.
        generate: async ({ userId, ...request }) =>
          generateWorkflowRequest({
            request,
            catalog: runner.catalog(),
            validation: runner.validationCatalog(),
            // Rows, which carry the whole definition. The merged list summarises, and a summary is
            // not a worked example.
            examples: (await listDefs(store, request.workspaceId)).map((row) => ({ id: row.id, def: row.def })),
            generateText: (args) => core.models.generateText({ userId, ...args }),
          }),
        saveToRepo: async (id, { taskId, keepRow }) => {
          const row = await getDef(store, id)
          if (!row) return { notFound: true }
          const scope = taskId ? await taskScope(taskId) : null
          if (taskId && !scope) return { error: 'That task no longer exists.' }
          if (scope?.project && scope.project.workspaceId !== row.workspaceId) return { error: 'That task is in another workspace.' }
          // The task's checkout when one is named, and its worktree is created here if the task has
          // not needed one yet: the file has to land on the branch the person is working on. Otherwise
          // the project folder, which is why an unbound row cannot be saved without a task.
          const checkoutDir = scope
            ? (await core.tasks.resolveCwd(scope.task, undefined, core.identity.active())).cwd
            : row.projectId ? (await core.projects.byId(row.projectId))?.path ?? null : null
          if (!checkoutDir) return { error: 'This workflow has no repository to save into. Open it from a task, or bind it to a project.' }
          const saved = await saveDefToRepo(store, id, { checkoutDir, keepRow, resolveInRoot: core.fs.resolveInRoot })
          if ('error' in saved) return saved.error === 'not_found' ? { notFound: true } : { error: 'That file would land outside the checkout.' }
          defsChanged(row.workspaceId)
          return { path: saved.path }
        },
      })

      // Namespace-root router: it owns both task-scoped (/tasks/:id/workflows) and run-scoped
      // (/workflows/runs/:runId/...) paths. The internal paths are registered as declared, so the
      // client route builders and the server surface share one contract.
      ctx.routes.register(workflow, { prefix: '', note: 'workflow control' })
      ctx.routes.register(workflowDefsRoutes, { prefix: '', note: '/defs — definitions stored as rows, device only' })

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
      defsCapability?.dispose()
    },
  }
}
