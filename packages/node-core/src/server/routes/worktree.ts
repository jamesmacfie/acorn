import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { Hono } from 'hono'
import { z } from 'zod'
import { inspectMcpConfig, MCP_CANDIDATES, STARTER_MCP_JSON, type McpServerSummary } from '@acorn/protocol/mcp.ts'
import type { ArchiveOpts, ArchiveResult } from '@acorn/protocol/terminal.ts'
import { archiveTask, TEARDOWN_TIMEOUT_MS } from '../../main/archive'
import { runProcess } from '../../main/core/proc'
import { broadcastStatus } from '../../main/notify'
import { buildSessionEnv } from '../../main/taskEnv'
import { computeTaskStatuses, isDir, loadTask, projectForTask, projectSetup, resolveTaskCwd, taskRoot, toTaskRef } from '../../main/taskWorktree'
import { applyTaskChecks, collectTaskConcerns } from '../plugin/taskChecks'
import { routeCapability, routeCapabilityFor, setRouteTestCapability, viaBridge } from '../bridge'
import { getDb } from '../db'
import type { AppEnv } from '../middleware/auth'
import { respondError } from '../respond'

// The PTY-coupled half of archive, and nothing else. Deliberately the exact dep bundle
// main/archive.ts's archiveTask already takes, so filling this slot is a pass-through in the plugin
// rather than a new adapter.
export type TaskSessionsBridge = {
  // Archive waits for startup reconciliation before checking or stopping live sessions.
  ready(): Promise<void>
  runningCount(taskId: string): number
  killRunning(taskId: string): void
  dropTaskSessions(taskId: string): Promise<void>
  runTeardown(script: string, cwd: string, env: Record<string, string>, taskId: string): Promise<{ exitCode: number | null; output: string }>
}

export const TASK_SESSIONS = routeCapability<TaskSessionsBridge>('terminal.taskSessionsRoute')
/** @internal test compatibility; production providers use CapabilityRegistry.provide. */
export const setTaskSessionsBridge = (bridge: TaskSessionsBridge | null): void => setRouteTestCapability(TASK_SESSIONS, bridge)

// Fired after a task's worktree is first created — the terminal plugin registers the hook that runs
// the repo's setup script as a background tab. Set by the runtime capability registry so `on-created`
// can seed PR notes without core importing the notes plugin.
export type TaskCreatedHook = (taskId: string) => Promise<void>
export const TASK_CREATED = routeCapability<TaskCreatedHook>('terminal.taskCreatedHook')

const previewBody = z.object({ script: z.string() })
const archiveBody = z.object({
  deleteWorktree: z.boolean().optional(),
  force: z.boolean().optional(),
  skipTeardown: z.boolean().optional(),
  // Qualified concern ids, matched against the task-check registry before anything runs. Bounded so a
  // client cannot make the node walk an arbitrarily long list; four checks per plugin is the manifest
  // ceiling and no dialog has ever drawn thirty-two rows.
  applyChecks: z.array(z.string().min(1).max(200)).max(32).optional(),
})

async function capturePreviewUrl(
  db: ReturnType<typeof getDb>,
  taskId: string,
  rawScript: string,
  capabilities: AppEnv['Bindings']['CAPABILITIES'],
): Promise<{ ok: boolean; url?: string; reason?: string }> {
  const script = rawScript?.trim()
  if (!script) return { ok: false, reason: 'no script configured' }
  const cwd = await taskRoot(db, taskId, null, capabilities)
  if (!cwd) return { ok: false, reason: 'no worktree yet — open a terminal first' }
  const task = await loadTask(db, taskId)
  const project = task ? await projectForTask(db, task) : null
  const result = await runProcess({
    file: '/bin/sh',
    args: ['-c', script],
    cwd,
    env: buildSessionEnv({
      taskId,
      cwd,
      task: task && project
        ? { projectId: project.id, projectName: project.name, github: project.githubOwner && project.githubName ? { owner: project.githubOwner, name: project.githubName } : null, branch: task.branch, title: task.title }
        : null,
    }),
    timeoutMs: 10_000,
  })
  if (result.spawnError) return { ok: false, reason: result.spawnError }
  if (result.timedOut) return { ok: false, reason: 'script timed out' }
  if (result.code !== 0) return { ok: false, reason: result.stderr.trim().slice(0, 200) || 'script failed' }
  const url = result.stdout.split('\n').map((line) => line.trim()).filter(Boolean).pop()
  return url ? { ok: true, url } : { ok: false, reason: 'script produced no output' }
}

// MCP config inspector (docs/mcp.md): read ONLY the known candidate files and mask secrets HERE, so
// raw values never cross to the renderer. Read-only — acorn never launches these servers.
async function inspectTaskMcp(db: ReturnType<typeof getDb>, taskId: string, capabilities: AppEnv['Bindings']['CAPABILITIES']): Promise<{ file: string; servers: McpServerSummary[] }[]> {
  const root = taskId ? await taskRoot(db, taskId, null, capabilities) : null
  const out: { file: string; servers: McpServerSummary[] }[] = []
  for (const candidate of MCP_CANDIDATES) {
    const base = candidate.root === 'home' ? homedir() : root
    if (!base) continue
    const file = resolve(base, candidate.rel)
    try {
      out.push({ file, servers: inspectMcpConfig(await readFile(file, 'utf8')) })
    } catch {
      // absent file → not listed
    }
  }
  return out
}

// Archive is the ONLY path allowed to tear a worktree down, and never automatic. The guard →
// teardown → stop sessions → remove worktree → mark archived orchestration is main/archive.ts's; the
// live-session half comes from the slot.
async function archive(db: ReturnType<typeof getDb>, taskId: string, opts: ArchiveOpts, sessions: TaskSessionsBridge): Promise<ArchiveResult> {
  if (!taskId) return { ok: false, reason: 'Invalid task.' }
  await sessions.ready()
  return archiveTask(db, taskId, opts, {
    isDir,
    runningCount: sessions.runningCount,
    killRunning: sessions.killRunning,
    dropTaskSessions: sessions.dropTaskSessions,
    runTeardown: sessions.runTeardown,
    // Injected here rather than imported by main/archive.ts: the registry is a server-layer thing and
    // the lifecycle module deliberately does not reach into it (main/archive.ts § ArchiveDeps).
    applyTaskChecks: async (task, ids) => {
      const row = await loadTask(db, task.id)
      return row ? applyTaskChecks(toTaskRef(row), ids) : []
    },
  })
}

// Mounted at /v2/core (server/index.ts): /task-statuses and /tasks/:id/* lifecycle.
export const worktree = new Hono<AppEnv>()
  // Live dirty/changed-file status for every active task with a worktree — polled by the rail/footer.
  .get('/task-statuses', async (c) => c.json(await computeTaskStatuses(getDb(c.env))))
  // --- task lifecycle ---
  .post('/tasks/:id/preview-url', async (c) => {
    const parsed = previewBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return c.json(await capturePreviewUrl(getDb(c.env), c.req.param('id'), parsed.data.script, c.env.CAPABILITIES))
  })
  // Notified right after a task is created. Branchless tasks already run in the project folder, so
  // only a Git branch task can have a newly-created worktree to eagerly prepare.
  .post('/tasks/:id/on-created', async (c) => {
    const db = getDb(c.env)
    const taskId = c.req.param('id')
    if (!taskId) return c.json({ ok: true })
    let task = await loadTask(db, taskId)
    if (!task) return c.json({ ok: true })
    // Best-effort and independent of worktree setup: seeds PR/ticket context into curatable notes.
    await routeCapabilityFor(c, TASK_CREATED)?.(taskId).catch((error) => console.warn('[worktree] task-created hook failed:', error))
    const project = await projectForTask(db, task)
    if (!project || !task.branch || !project.path) return c.json({ ok: true })
    const { script, trigger } = await projectSetup(db, project.id)
    if (trigger !== 'created' || !script?.trim()) return c.json({ ok: true })
    // Re-read after the hook's await — a pane may have created the worktree meanwhile.
    task = await loadTask(db, taskId)
    if (!task || (task.worktreePath && isDir(task.worktreePath))) return c.json({ ok: true })
    if (!isDir(project.path)) return c.json({ ok: true })
    // Eager pre-create is best-effort: a stale/unavailable worktree throws now, and this route's job
    // is only to get the setup script in early. The surface that actually needs the cwd will say so.
    await resolveTaskCwd(db, task, project.path, null, c.env.CAPABILITIES).catch((e) => console.warn('[worktree] pre-create skipped:', e instanceof Error ? e.message : e))
    broadcastStatus() // rail/footer pick up the new worktree
    return c.json({ ok: true })
  })
  // What every plugin has to say about archiving this task, asked once when the dialog opens. Each
  // check is bounded and contained on the way through, so this answers even when a plugin does not
  // (server/plugin/taskChecks.ts).
  .get('/tasks/:id/archive-concerns', async (c) => {
    const task = await loadTask(getDb(c.env), c.req.param('id'))
    if (!task) return c.json({ concerns: [] })
    return c.json({ concerns: await collectTaskConcerns(toTaskRef(task)) })
  })
  .post('/tasks/:id/archive', async (c) => {
    const parsed = archiveBody.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, TASK_SESSIONS, (sessions) => archive(getDb(c.env), c.req.param('id'), parsed.data, sessions))
  })
  .get('/tasks/:id/mcp', async (c) => c.json(await inspectTaskMcp(getDb(c.env), c.req.param('id'), c.env.CAPABILITIES)))
  .post('/tasks/:id/mcp/starter', async (c) => {
    const root = await taskRoot(getDb(c.env), c.req.param('id'), null, c.env.CAPABILITIES)
    if (!root) return c.json({ ok: false, reason: 'No worktree yet — open a terminal first.' })
    const file = resolve(root, '.mcp.json')
    if (existsSync(file)) return c.json({ ok: false, reason: '.mcp.json already exists.' })
    await writeFile(file, STARTER_MCP_JSON, 'utf8')
    return c.json({ ok: true })
  })

export { TEARDOWN_TIMEOUT_MS }
