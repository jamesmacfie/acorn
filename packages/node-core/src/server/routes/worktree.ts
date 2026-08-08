import { eq } from 'drizzle-orm'
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
import { getRepoPath, setRepoConfig, setRepoPath, setRunTargets } from '../../main/repoPaths'
import { buildSessionEnv } from '../../main/taskEnv'
import { computeTaskStatuses, isDir, loadTask, resolveTaskCwd, repoSetup, taskRoot } from '../../main/taskWorktree'
import { currentBranch } from '../../main/worktrees'
import { routeCapability, routeCapabilityFor, setRouteTestCapability, viaBridge } from '../bridge'
import { getDb, schema } from '../db'
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

const repoPathSetBody = z.object({ owner: z.string(), repo: z.string(), path: z.string() })
const runTargetsBody = z.object({ owner: z.string(), repo: z.string(), runTargets: z.string() })
const browserRuleSchema = z.object({
  id: z.string(),
  enabled: z.boolean(),
  urlPattern: z.string(),
  trigger: z.literal('load'),
  action: z.object({ type: z.literal('fill'), selector: z.string(), value: z.string() }),
})
// The executable half of repo config — setup/teardown/dev/db-url scripts and the preview command.
// This is the AUTHORING surface for exactly the content config-trust hash-gates, which is why it
// belongs beside the trust route in core rather than in the plugin that happens to run the scripts.
const repoConfigBody = z.object({
  owner: z.string(),
  repo: z.string(),
  patch: z.object({
    setupScript: z.string().optional(),
    setupScriptTrigger: z.enum(['off', 'created', 'terminal']).optional(),
    teardownScript: z.string().optional(),
    devScript: z.string().optional(),
    devRestartScript: z.string().optional(),
    dbUrlScript: z.string().optional(),
    dbSchemaMode: z.enum(['auto', 'script', 'file']).or(z.literal('')).optional(),
    dbSchemaValue: z.string().optional(),
    dbSchemaNotes: z.string().max(8000).optional(),
    previewMode: z.enum(['url', 'port', 'script']).or(z.literal('')).optional(),
    previewValue: z.string().optional(),
    browserRules: z.array(browserRuleSchema).optional(),
    branchPrefix: z.string().max(60).optional(),
  }),
})
const previewBody = z.object({ script: z.string() })
const archiveBody = z.object({ deleteWorktree: z.boolean().optional(), force: z.boolean().optional(), skipTeardown: z.boolean().optional() })

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
  const result = await runProcess({
    file: '/bin/sh',
    args: ['-c', script],
    cwd,
    env: buildSessionEnv({
      taskId,
      cwd,
      task: task ? { repoOwner: task.repoOwner, repoName: task.repoName, branch: task.branch, title: task.title } : null,
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

// "New task here": point the task at the mapped checkout itself instead of an isolated worktree, and
// adopt the checkout's current branch. worktreePath === checkout is the marker every guard keys off.
async function useCheckout(db: ReturnType<typeof getDb>, taskId: string): Promise<{ worktreePath: string; branch: string } | null> {
  const task = await loadTask(db, taskId)
  if (!task) return null
  const mapped = await getRepoPath(db, task.repoOwner, task.repoName)
  if (!mapped || !isDir(mapped.path)) return null
  const branch = (await currentBranch(mapped.path)) || task.branch // detached HEAD → keep the seed branch
  await db.update(schema.tasks).set({ worktreePath: mapped.path, branch, updatedAt: Date.now() }).where(eq(schema.tasks.id, task.id))
  broadcastStatus() // rail/footer pick up the borrowed checkout
  return { worktreePath: mapped.path, branch }
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
  })
}

// Mounted at /v2/core (server/index.ts): /task-statuses, /repos/path*, and /tasks/:id/* lifecycle.
export const worktree = new Hono<AppEnv>()
  // Live dirty/changed-file status for every active task with a worktree — polled by the rail/footer.
  .get('/task-statuses', async (c) => c.json(await computeTaskStatuses(getDb(c.env))))
  // --- repo → checkout mapping and repo-level config (owner/repo-scoped) ---
  .get('/repos/path', async (c) => {
    const owner = c.req.query('owner')
    const repo = c.req.query('repo')
    if (!owner || !repo) return respondError(c, 400, 'bad_request')
    return c.json(await getRepoPath(getDb(c.env), owner, repo))
  })
  .put('/repos/path', async (c) => {
    const parsed = repoPathSetBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return c.json(await setRepoPath(getDb(c.env), parsed.data.owner, parsed.data.repo, parsed.data.path))
  })
  .put('/repos/path/run-targets', async (c) => {
    const parsed = runTargetsBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return c.json(await setRunTargets(getDb(c.env), parsed.data.owner, parsed.data.repo, parsed.data.runTargets))
  })
  .put('/repos/path/config', async (c) => {
    const parsed = repoConfigBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return c.json(await setRepoConfig(getDb(c.env), parsed.data.owner, parsed.data.repo, parsed.data.patch))
  })
  // --- task lifecycle ---
  .post('/tasks/:id/preview-url', async (c) => {
    const parsed = previewBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return c.json(await capturePreviewUrl(getDb(c.env), c.req.param('id'), parsed.data.script, c.env.CAPABILITIES))
  })
  // Notified right after a task is created. If the repo runs its setup script on creation and the
  // checkout is mapped, eagerly create the worktree — resolveTaskCwd's onWorktreeCreated hook is what
  // actually runs the script, so this stays core logic even though the script lands in a PTY tab.
  .post('/tasks/:id/on-created', async (c) => {
    const db = getDb(c.env)
    const taskId = c.req.param('id')
    if (!taskId) return c.json({ ok: true })
    let task = await loadTask(db, taskId)
    if (!task) return c.json({ ok: true })
    // Best-effort and independent of worktree setup: seeds PR/ticket context into curatable notes.
    await routeCapabilityFor(c, TASK_CREATED)?.(taskId).catch((error) => console.warn('[worktree] task-created hook failed:', error))
    const { script, trigger } = await repoSetup(db, task.repoOwner, task.repoName)
    if (trigger !== 'created' || !script?.trim()) return c.json({ ok: true })
    // Re-read after the hook's await — a pane may have created the worktree meanwhile.
    task = await loadTask(db, taskId)
    if (!task || (task.worktreePath && isDir(task.worktreePath))) return c.json({ ok: true })
    const mapped = await getRepoPath(db, task.repoOwner, task.repoName)
    if (!mapped || !isDir(mapped.path)) return c.json({ ok: true })
    await resolveTaskCwd(db, task, mapped.path, null, c.env.CAPABILITIES)
    broadcastStatus() // rail/footer pick up the new worktree
    return c.json({ ok: true })
  })
  .post('/tasks/:id/use-checkout', async (c) => c.json({ result: await useCheckout(getDb(c.env), c.req.param('id')) }))
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
