// Workflow wiring (docs/next 14 P2–P5), split out of terminal.ts: constructs the main-process
// WorkflowRunner over the fake-able headless runner with its real deps — handoff notes, the
// loopback context assembler, a re-derived checks-green policy, gate/run-done notices — and wires
// the WorkflowBridge behind the HTTP routes (server/routes/workflow.ts). The gate/run-done notice
// PUSH still rides IPC (notify.ts) until the WebSocket lands (Phase 3 slice 6).
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { and, eq, max } from 'drizzle-orm'
import { dedupeBranch, slugifyBranch } from '../shared/branch'
import { formatContextBlock } from '../shared/contextBlock'
import type { AppDatabase } from '../server/db'
import { schema } from '../server/db'
import { setWorkflowBridge } from '../server/routes/workflow'
import { buildHeadlessArgv, runHeadless } from './headless'
import type { NotesStore } from './notes'
import { broadcastStatus, broadcastWorkflowNotice } from './notify'
import { getProfile, resolveCommand } from './profiles'
import { getRepoPath } from './repoPaths'
import type { RuntimeService } from './runtime'
import { isDir, loadTask, resolveTaskCwd, workspaceIdFor } from './taskWorktree'
import { buildSessionEnv } from './terminalUtils'
import { loadWorkflowFiles } from './workflowFiles'
import { WorkflowRunner, type WorkflowDef } from './workflowRunner'

export type WorkflowWiringDeps = {
  runtime: RuntimeService
  notesStore: NotesStore
  // Loopback API access for the context assembler (docs/mcp.md): ACORN_API_URL/ACORN_API_TOKEN.
  internalApiEnv: Record<string, string>
  // Resolves when the composition root's post-window reconcile pass is done (always resolves, even
  // on failure). workflow:start/gate await it: reconcile() sweeps EVERY 'running' step to
  // 'pending', so a run started before the sweep would have its live step re-queued.
  reconciled: Promise<void>
}

export async function registerWorkflowIpc(db: AppDatabase, { runtime, notesStore, internalApiEnv, reconciled }: WorkflowWiringDeps): Promise<WorkflowRunner> {
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
      const profile = getProfile(def.profileId)
      const argv = buildHeadlessArgv(profile.id, resolveCommand(profile), opts)
      if (!argv) return { status: 'error', exitCode: null, capture: { result: null, structuredOutput: null, sessionId: null, costUsd: null, events: [] }, stderrTail: `Profile '${profile.id}' has no headless mode.` }
      const env = buildSessionEnv({
        taskId,
        cwd,
        task: t ? { repoOwner: t.repoOwner, repoName: t.repoName, branch: t.branch, title: t.title } : null,
        env: internalApiEnv,
      })
      return runHeadless(argv, { cwd, env })
    },
    writeHandoff: async (taskId, stepName, body) => {
      const ws = await workspaceIdFor(db, taskId).catch(() => null)
      if (ws) await notesStore.append(ws, 'workflow-handoffs', `## ${stepName}\n${body}\n`, { author: 'workflow' })
    },
    assembleContext: async (taskId) => {
      try {
        const res = await fetch(`${internalApiEnv.ACORN_API_URL}/api/tasks/${taskId}/context`, { headers: { 'x-acorn-internal': internalApiEnv.ACORN_API_TOKEN ?? '' } })
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
  })

  setWorkflowBridge({
    // Declared workflows for a task (docs/next 14 P5): `.acorn/workflows/*.toml` from the
    // worktree/checkout + ~/.acorn, parse/cycle errors surfaced as palette rows (13 §B).
    defs: async (taskId) => {
      const t = await loadTask(db, taskId)
      if (!t) return { workflows: [], errors: [] }
      const mapped = await getRepoPath(db, t.repoOwner, t.repoName)
      const repoDir = t.worktreePath && isDir(t.worktreePath) ? t.worktreePath : mapped?.path && isDir(mapped.path) ? mapped.path : null
      return loadWorkflowFiles(repoDir, homedir())
    },
    start: async (taskId, def) => {
      await reconciled // don't start a run the restart sweep would immediately re-queue
      return { runId: await workflowRunner.start(taskId, def as WorkflowDef) }
    },
    runs: async (taskId) => {
      const rows = await db.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.taskId, taskId))
      return rows.sort((a, b) => b.createdAt - a.createdAt)
    },
    steps: (runId) => workflowRunner.steps(runId),
    gate: async (runId, stepId, approved) => {
      await reconciled // an approval resumes a step the restart sweep could otherwise clobber
      await workflowRunner.resolveGate(runId, stepId, approved)
      return { ok: true }
    },
  })

  // Note: workflowRunner.reconcile() (resume/fail-cleanly across app restarts, 14 §checkpoint) is
  // NOT run here — the composition root drives it in its coordinated reconcile() step, off the
  // paint-critical path (review §2, performance §3.6).
  return workflowRunner
}
