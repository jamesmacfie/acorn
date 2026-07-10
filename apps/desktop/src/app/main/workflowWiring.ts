// Workflow wiring (docs/workflows.md), split out of terminal.ts: constructs the main-process
// WorkflowRunner over the fake-able headless runner with its real deps — handoff notes, the
// loopback context assembler, a re-derived checks-green policy, gate/run-done notices — and wires
// the WorkflowBridge behind the HTTP routes (server/routes/workflow.ts). Gate/run-done notices,
// status invalidations, and live parsed step events share the authenticated WebSocket.
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { and, eq, max } from 'drizzle-orm'
import { dedupeBranch, slugifyBranch } from '../../core/shared/branch'
import { formatContextBlock } from '../../core/shared/contextBlock'
import type { AppDatabase } from '../../core/server/db'
import { schema } from '../../core/server/db'
import { setWorkflowBridge } from '../../plugins/workflows/server/routes/workflow'
import { DEFAULT_PROFILE_ID } from '../../core/main/agentProfiles'
import { buildHeadlessArgv, runHeadless } from '../../core/main/headless'
import type { NotesStore } from '../../plugins/notes/main/notes'
import { broadcastStatus, broadcastWorkflowNotice, broadcastWorkflowStepEvent } from '../../core/main/notify'
import { getProfile, requireProfile, resolveCommand } from '../../core/main/profiles'
import { getRepoPath } from '../../core/main/repoPaths'
import type { RuntimeService } from '../../plugins/terminal/main/runtime'
import { isDir, loadTask, resolveTaskCwd } from '../../core/main/taskWorktree'
import { buildSessionEnv } from '../../plugins/terminal/main/terminalUtils'
import { loadWorkflowFiles } from '../../plugins/workflows/main/workflowFiles'
import { WorkflowRunner, type WorkflowDef } from '../../plugins/workflows/main/workflowRunner'
import { encodeToolCeiling } from '../../plugins/workflows/main/workflowTools'
import { WorkflowValidationError } from '../../plugins/workflows/main/workflowValidation'
import { assertRepoConfigTrusted, isRepoConfigTrustError } from '../../core/main/repoConfigTrust'
import { broadcastRepoConfigTrustNotice } from '../../core/main/notify'

export type WorkflowWiringDeps = {
  runtime: RuntimeService
  notesStore: NotesStore
  // Loopback API access for the context assembler (docs/mcp.md): ACORN_API_URL/ACORN_API_TOKEN.
  internalApiEnv: Record<string, string>
  // Resolves when the composition root's post-window reconcile pass is done (always resolves, even
  // on failure). workflow:start/gate await it: reconcile() sweeps EVERY 'running' step to
  // 'pending', so a run started before the sweep would have its live step re-queued.
  reconciled: Promise<void>
  memoryReviewTrigger?: (taskId: string, transcriptTail: string) => Promise<void>
}

export async function registerWorkflowIpc(
  db: AppDatabase,
  { runtime, notesStore, internalApiEnv, reconciled, memoryReviewTrigger }: WorkflowWiringDeps,
): Promise<WorkflowRunner> {
  const failingChecksFor = async (taskId: string): Promise<string | null> => {
    const t = await loadTask(db, taskId)
    if (!t || t.pullNumber == null) return null
    const [repoRow] = await db.select().from(schema.repos).where(and(eq(schema.repos.owner, t.repoOwner), eq(schema.repos.name, t.repoName)))
    if (!repoRow) return null
    const rows = await db
      .select()
      .from(schema.checks)
      .where(and(eq(schema.checks.repoId, repoRow.id), eq(schema.checks.number, t.pullNumber)))
    if (!rows.length) return null
    const bad = rows.filter((r) => r.status && !['success', 'neutral', 'skipped'].includes(r.status.toLowerCase()))
    return bad.length ? bad.map((r) => `- ${r.name}: ${r.status}${r.url ? ` (${r.url})` : ''}`).join('\n') : ''
  }

  const workflowRunner = new WorkflowRunner(db, {
    runStep: async (taskId, def, opts) => {
      const t = await loadTask(db, taskId)
      const mapped = t ? await getRepoPath(db, t.repoOwner, t.repoName) : null
      const baseCheckout = mapped?.path && isDir(mapped.path) ? mapped.path : undefined
      const { cwd } = t ? await resolveTaskCwd(db, t, baseCheckout) : { cwd: homedir() }
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
        task: t ? { repoOwner: t.repoOwner, repoName: t.repoName, branch: t.branch, title: t.title } : null,
        env: { ...internalApiEnv, ACORN_TOOL_CEILING: encodeToolCeiling(opts.tools ?? {}) },
      })
      return runHeadless(argv, { cwd, env, signal: opts.signal, onEvent: opts.onEvent, adapter: profile.streamJson })
    },
    writeHandoff: async (taskId, runId, stepName, body) => {
      await notesStore.append({ scope: 'task', taskId }, `workflow-handoffs-${runId}`, `## ${stepName}\n${body}\n`, { author: 'workflow', originTaskId: taskId })
    },
    finishHandoffs: (taskId, runId) => notesStore.setIncluded({ scope: 'task', taskId }, `workflow-handoffs-${runId}`, false),
    assembleContext: async (taskId, runId) => {
      try {
        const res = await fetch(`${internalApiEnv.ACORN_API_URL}/api/tasks/${taskId}/context?workflowRunId=${encodeURIComponent(runId)}`, {
          headers: { 'x-acorn-internal': internalApiEnv.ACORN_API_TOKEN ?? '' },
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
        const failing = await failingChecksFor(taskId)
        if (failing === '') return { pass: true }
        return { pass: false, detail: failing == null ? 'No PR/checks to verify.' : `Failing checks:\n${failing}` }
      }
      return { pass: false, detail: `Unknown policy '${policy}' — failing closed.` }
    },
    failingChecks: failingChecksFor,
    notify: broadcastWorkflowNotice,
    statusChanged: broadcastStatus,
    emitStepEvent: broadcastWorkflowStepEvent,
    onRunTerminal: async (taskId, runId) => {
      if (!memoryReviewTrigger) return
      const handoff = await notesStore.read({ scope: 'task', taskId }, `workflow-handoffs-${runId}`).catch(() => null)
      await memoryReviewTrigger(taskId, handoff?.body ?? `Workflow ${runId} reached a terminal state.`)
    },
    startRunTarget: async (taskId, targetId) => {
      const started = await runtime.start(taskId, targetId)
      if (!started.ok) return { ok: false }
      const status = await runtime.status(taskId, targetId)
      return { ok: true, url: status.url }
    },
    // Fan-out (14 P4): materialise a child task on its own (de-duped, slugged) branch; the child's
    // worktree is created lazily by resolveTaskCwd the moment its step runs.
    createChildTask: async (parentTaskId, seed) => {
      const parent = await loadTask(db, parentTaskId)
      if (!parent) throw new Error('Parent task not found.')
      const existing = (await db.select({ branch: schema.tasks.branch }).from(schema.tasks)).map((r) => r.branch)
      const branch = dedupeBranch(slugifyBranch(seed.branch || seed.title) || `child-${parentTaskId.slice(0, 8)}`, existing)
      const [{ value }] = await db.select({ value: max(schema.tasks.sort) }).from(schema.tasks)
      const id = randomUUID()
      const at = Date.now()
      await db.insert(schema.tasks).values({
        id,
        title: seed.title,
        origin: 'local',
        repoOwner: parent.repoOwner,
        repoName: parent.repoName,
        branch,
        pullNumber: null,
        worktreePath: null,
        status: 'active',
        parentId: parentTaskId,
        sort: (value ?? -1) + 1,
        createdAt: at,
        updatedAt: at,
        archivedAt: null,
      })
      broadcastStatus()
      return id
    },
    cancelChildTask: async (taskId) => {
      await db.update(schema.tasks).set({ status: 'cancelled', updatedAt: Date.now() }).where(eq(schema.tasks.id, taskId))
      broadcastStatus()
    },
    authorizeRepoConfig: (taskId) => assertRepoConfigTrusted(db, taskId),
  })

  setWorkflowBridge({
    // Declared workflows for a task (docs/workflows.md): `.acorn/workflows/*.toml` from the
    // worktree/checkout + ~/.acorn, parse/cycle errors surfaced as palette rows (13 §B).
    defs: async (taskId) => {
      const t = await loadTask(db, taskId)
      if (!t) return { workflows: [], errors: [] }
      const mapped = await getRepoPath(db, t.repoOwner, t.repoName)
      const repoDir = t.worktreePath && isDir(t.worktreePath) ? t.worktreePath : mapped?.path && isDir(mapped.path) ? mapped.path : null
      return loadWorkflowFiles(repoDir, homedir(), workflowRunner.validationCatalog())
    },
    start: async (taskId, def) => {
      await reconciled // don't start a run the restart sweep would immediately re-queue
      try {
        return { runId: await workflowRunner.start(taskId, def as WorkflowDef) }
      } catch (error) {
        if (isRepoConfigTrustError(error)) {
          broadcastRepoConfigTrustNotice(taskId)
          return { error: 'needs-trust' }
        }
        return { error: error instanceof WorkflowValidationError ? error.message : 'Failed to start workflow.' }
      }
    },
    runs: async (taskId) => {
      const rows = await db.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.taskId, taskId))
      return rows.sort((a, b) => b.createdAt - a.createdAt)
    },
    steps: async (runId) =>
      (await workflowRunner.steps(runId)).map((step) => {
        if (!step.sessionId || !step.profileId || /[^A-Za-z0-9_-]/.test(step.sessionId)) return step
        const profile = getProfile(step.profileId)
        if (profile.id !== step.profileId) return { ...step, resumeCommand: null }
        const resume = profile.resumeArgv?.(resolveCommand(profile), step.sessionId)
        return { ...step, resumeCommand: resume ? [resume.file, ...resume.args].join(' ') : null }
      }),
    gate: async (runId, stepId, approved) => {
      await reconciled // an approval resumes a step the restart sweep could otherwise clobber
      await workflowRunner.resolveGate(runId, stepId, approved)
      return { ok: true }
    },
    cancel: async (runId) => {
      await reconciled
      await workflowRunner.cancelRun(runId)
      return { ok: true }
    },
    kill: async (runId, stepId) => {
      await reconciled
      await workflowRunner.killStep(runId, stepId)
      return { ok: true }
    },
    pollTriggers: () => workflowRunner.pollTriggers(),
  })

  // Note: workflowRunner.reconcile() (resume/fail-cleanly across app restarts, 14 §checkpoint) is
  // NOT run here — the composition root drives it in its coordinated reconcile() step, off the
  // paint-critical path (composition-root ownership, docs/electron.md §11).
  return workflowRunner
}
