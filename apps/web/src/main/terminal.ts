import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { spawn, type IPty } from 'node-pty'
import { execFile, execFileSync, spawn as spawnProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { existsSync, realpathSync, statSync } from 'node:fs'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { and, eq } from 'drizzle-orm'
import type { AppDatabase } from '../server/db'
import { schema } from '../server/db'
import type { ArchiveOpts, ArchiveResult, CreateOpts, ServerMsg, TerminalSession, TaskStatus } from '../shared/terminal'
import { AgentSender, type SendSubmit } from './agentSend'
import { archiveTask, TEARDOWN_TIMEOUT_MS } from './archive'
import {
  buildSessionEnv,
  childEnv,
  clampDim,
  computeIdle,
  matchBlockedPrompt,
  parseTmuxSessions,
  resolveBackend,
  tmuxAttachArgs,
  tmuxName,
  tmuxNewSessionArgs,
  trimRing,
} from './terminalUtils'
import { buildEditorArgv } from './editorLaunch'
import { commitStaged, discardFile, localChanges, localDiff, localFileBlob, stageFile, unstageFile, type LocalScope } from './localDiff'
import { getProfile, listProfiles, resolveCommand, tmuxAvailable } from './profiles'
import { loadRepoConfig } from './repoConfig'
import { getRepoPath, setEditorCommand, setRepoPath, setRunConfig, setRunTargets } from './repoPaths'
import { RuntimeService } from './runtime'
import { setContextNotesSource } from '../server/routes/taskContext'
import { NotesStore, type NoteKind } from './notes'
import { copyWorktreeFiles, ensureWorktree, worktreePorcelain } from './worktrees'

// vNext Phase 2: PTYs live in the main process. Sessions run on one of two backends —
//  - node-pty: spawn the command directly. Survives a window reload (PTY is in main), not an app
//    restart. In-memory only.
//  - tmux: a detached `tmux` session drives the command; a PTY attaches to it. Survives an app
//    restart (the tmux daemon is separate) and can be attached from a real terminal. Persisted to
//    SQLite so startup can reconcile rows against `tmux list-sessions` and re-attach survivors.
// Terminal output is never persisted (vNext §8).

type Session = {
  meta: TerminalSession
  pty: IPty
  ring: string
  subscribers: Set<WebContents>
  lastActivityAt: number
}

const sessions = new Map<string, Session>()

// sendToAgent (docs/next 04 §D): bracketed-paste delivery into agent PTYs, with 'after-ready'
// queued on the idle edge below. One instance over the live session map.
const agentSender = new AgentSender((id) => {
  const s = sessions.get(id)
  if (!s) return null
  return { write: (data: string) => s.pty.write(data), running: () => s.meta.status === 'running', idle: () => s.meta.idle }
})

// Set once by registerTerminalIpc — where workspace worktrees are created (docs/workspaces 05).
let worktreesRoot = ''

const channel = (id: string) => `term:out:${id}`

// Per-tab status (idle/exited) is shown for sessions the renderer isn't attached to, so changes
// are broadcast as a content-free ping; the panel re-pulls term:list to get fresh meta.
function broadcastStatus() {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('term:status')
}

// PTY-tier AgentState (docs/next 05): shells stay 'unknown'; agents flip working/idle with the
// silence detector ('blocked' lands with the prompt-pattern scan).
const ptyState = (kind: 'shell' | 'agent', status: 'running' | 'exited', idle: boolean): TerminalSession['agentState'] =>
  kind !== 'agent' ? 'unknown' : status !== 'running' ? 'done' : idle ? 'idle' : 'working'

function emit(s: Session, msg: ServerMsg) {
  for (const wc of s.subscribers) {
    if (wc.isDestroyed()) s.subscribers.delete(wc)
    else wc.send(channel(s.meta.id), msg)
  }
}

function appendRing(s: Session, data: string) {
  s.ring = trimRing(s.ring + data)
}

const isDir = (p: string): boolean => {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

// --- tmux process plumbing (execFileSync with arg arrays — no shell, command is a fixed profile
// binary, cwd is validated, name is acorn-<uuid>) ---

function ensureTmuxSession(name: string, cwd: string, command: string, env: Record<string, string>) {
  // tmux runs the command argument through the user's shell, so a full "pnpm dev" line works; env
  // (e.g. PORT) is inherited by that shell (docs/workspaces P5).
  execFileSync('tmux', tmuxNewSessionArgs(name, cwd, command), { env, stdio: 'ignore' })
}

function attachTmuxPty(name: string, cols: number, rows: number): IPty {
  return spawn('tmux', tmuxAttachArgs(name), { name: 'xterm-256color', cols, rows, cwd: homedir(), env: childEnv() })
}

function killTmuxSession(name: string) {
  try {
    execFileSync('tmux', ['kill-session', '-t', name], { stdio: 'ignore' })
  } catch {
    // already gone — fine
  }
}

function listTmuxSessions(): Set<string> {
  try {
    const out = execFileSync('tmux', ['list-sessions', '-F', '#{session_name}'], { encoding: 'utf8', env: childEnv() })
    return parseTmuxSessions(out)
  } catch {
    return new Set() // no tmux server running → no sessions
  }
}

// --- SQLite persistence (tmux-backed sessions only) ---

async function persistSession(db: AppDatabase, m: TerminalSession) {
  await db.insert(schema.terminalSessions).values({
    id: m.id,
    title: m.title,
    kind: m.kind,
    profileId: m.profileId,
    backend: m.backend,
    status: m.status,
    cwd: m.cwd,
    taskId: m.taskId,
    command: m.command,
    argvJson: '[]',
    tmuxSession: m.tmuxSession ?? null,
    cols: m.cols,
    rows: m.rows,
    createdAt: m.createdAt,
    exitedAt: null,
    exitCode: null,
  })
}

const loadTask = async (db: AppDatabase, id: string): Promise<typeof schema.tasks.$inferSelect | undefined> => {
  const [t] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, id))
  return t
}

// Per-repo preferred base ref for NEW branches (docs/next 02 P2): the prefs key
// `base_ref:<owner>/<repo>`. Read by key alone — machine-local single-user app.
const baseRefPref = async (db: AppDatabase, owner: string, repo: string): Promise<string | null> => {
  const [row] = await db.select().from(schema.prefs).where(eq(schema.prefs.key, `base_ref:${owner}/${repo}`)).limit(1)
  return row?.value ?? null
}

// Live worktree status for every active task that has a worktree (docs/workspaces 02/05):
// dirty + changed-file count via git, and `missing` when the dir vanished (removed outside acorn).
async function computeTaskStatuses(db: AppDatabase): Promise<TaskStatus[]> {
  const rows = (await db.select().from(schema.tasks).where(eq(schema.tasks.status, 'active'))).filter((w) => w.worktreePath)
  return Promise.all(
    rows.map(async (w) => {
      const path = w.worktreePath!
      if (!isDir(path)) return { taskId: w.id, worktreePath: path, dirty: false, dirtyCount: 0, missing: true }
      const { dirty, count } = await worktreePorcelain(path)
      return { taskId: w.id, worktreePath: path, dirty, dirtyCount: count, missing: false }
    }),
  )
}

// Startup reconciliation (docs/workspaces 05): flag any persisted worktree whose directory is gone
// (manual rm) as needing repair. The rail/footer surface `missing` live; this just logs at boot.
async function reconcileWorktrees(db: AppDatabase) {
  try {
    const missing = (await computeTaskStatuses(db)).filter((s) => s.missing)
    if (missing.length) console.warn(`[worktrees] ${missing.length} task worktree(s) missing on disk (needs repair): ${missing.map((m) => m.worktreePath).join(', ')}`)
  } catch {
    // best-effort — never block startup on status
  }
}

// Repo / branch / PR context for a session, derived through the taskId → tasks join
// (docs/workspaces 03). The session row no longer denormalizes repo/pull; this is the single read.
function taskContext(t: typeof schema.tasks.$inferSelect | undefined): Pick<TerminalSession, 'repo' | 'pull'> {
  if (!t) return {}
  return {
    repo: { owner: t.repoOwner, name: t.repoName },
    pull: t.pullNumber != null ? { number: t.pullNumber } : undefined,
  }
}

// Lazy worktree on first terminal (Flow C, docs/workspaces 05). Reuse the task's worktree if
// it's set and still on disk; otherwise create one from the base checkout, keyed by branch, and
// persist worktreePath on the task. Returns the cwd + whether it's an isolated worktree. On
// any failure (no checkout mapped, git error) it degrades to the base checkout so the terminal
// still opens — the task just doesn't gain isolation until the next try.
// ponytail: graceful fallback over a hard error; the dirty/teardown guards still key off worktreePath.
async function resolveTaskCwd(
  db: AppDatabase,
  t: typeof schema.tasks.$inferSelect | undefined,
  baseCheckout: string | undefined,
): Promise<{ cwd: string; isWorktree: boolean; created: boolean }> {
  if (t?.worktreePath && isDir(t.worktreePath)) return { cwd: t.worktreePath, isWorktree: true, created: false }
  if (!t || !baseCheckout || !isDir(baseCheckout)) return { cwd: baseCheckout && isDir(baseCheckout) ? baseCheckout : homedir(), isWorktree: false, created: false }
  const wt = await ensureWorktree(worktreesRoot, baseCheckout, t.repoOwner, t.repoName, t.branch, t.pullNumber, await baseRefPref(db, t.repoOwner, t.repoName))
  if (!wt.ok) return { cwd: baseCheckout, isWorktree: false, created: false }
  await db.update(schema.tasks).set({ worktreePath: wt.path, updatedAt: Date.now() }).where(eq(schema.tasks.id, t.id))
  if (wt.created) await copyConfiguredFiles(db, t, baseCheckout, wt.path)
  return { cwd: wt.path, isWorktree: true, created: wt.created }
}

// The on-disk root the editor pane operates on: the task's worktree (created lazily, like the
// terminal), or null if the repo has no mapped checkout yet. Re-derived per IPC call so the taskId
// — not a renderer-supplied absolute path — is the capability.
async function taskRoot(db: AppDatabase, taskId: string): Promise<string | null> {
  const t = await loadTask(db, taskId)
  if (!t) return null
  const mapped = await getRepoPath(db, t.repoOwner, t.repoName)
  const baseCheckout = mapped?.path && isDir(mapped.path) ? mapped.path : undefined
  if (!baseCheckout) return null
  const { cwd } = await resolveTaskCwd(db, t, baseCheckout)
  return resolve(cwd)
}

// Confine a renderer-supplied relative path to within `root`; null on any escape. Two gates: a
// lexical one (rejects `..`/absolute paths) and a symlink one — resolve the real path of the nearest
// existing ancestor (the target itself may not exist yet on a new-file write) and require it to stay
// within root's real path, so a symlink inside the worktree can't point the read/write outside it
// (worktrees can hold arbitrary checked-out content, including hostile symlinks).
function resolveInRoot(root: string, relPath: string): string | null {
  const abs = resolve(root, relPath)
  if (abs !== root && !abs.startsWith(root + sep)) return null
  try {
    const realRoot = realpathSync(root)
    let probe = abs
    while (probe !== root && !existsSync(probe)) probe = dirname(probe)
    const real = realpathSync(probe)
    return real === realRoot || real.startsWith(realRoot + sep) ? abs : null
  } catch {
    return null
  }
}

// The setup script + when-to-run configured on the workspace that owns this repo (docs/workspaces
// P5). trigger: 'off' never runs, 'created' pre-creates the worktree at task creation, 'terminal'
// (the default; null coalesces to it) runs lazily on first terminal. The script itself runs once,
// whenever the worktree is first created — see maybeRunSetup.
type SetupTrigger = 'off' | 'created' | 'terminal'
async function workspaceSetup(db: AppDatabase, owner: string, repo: string): Promise<{ script: string | null; trigger: SetupTrigger }> {
  const [wr] = await db
    .select({ workspaceId: schema.workspaceRepos.workspaceId })
    .from(schema.workspaceRepos)
    .where(and(eq(schema.workspaceRepos.repoOwner, owner), eq(schema.workspaceRepos.repoName, repo)))
  if (!wr) return { script: null, trigger: 'terminal' }
  const [ws] = await db
    .select({ setupScript: schema.workspaces.setupScript, trigger: schema.workspaces.setupScriptTrigger })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, wr.workspaceId))
  return { script: ws?.setupScript ?? null, trigger: (ws?.trigger as SetupTrigger) || 'terminal' }
}

// Run the workspace setup script as a "Setup" session in the freshly-created worktree, unless it's
// blank or disabled ('off'). Called whenever a worktree is first created (create() on first
// terminal, or onCreated at task creation). Ordered before the requested session so it's tab #1.
async function maybeRunSetup(db: AppDatabase, t: typeof schema.tasks.$inferSelect, cwd: string, ctx: Pick<TerminalSession, 'repo' | 'pull'>): Promise<void> {
  const { script, trigger } = await workspaceSetup(db, t.repoOwner, t.repoName)
  if (trigger === 'off' || !script?.trim()) return
  await spawnOne(db, { taskId: t.id, command: script, title: 'Setup' }, cwd, true, ctx, t)
}

// Files-to-copy on a fresh worktree (docs/next 13 §A `copy`): read the config from the SOURCE
// checkout (the entries are usually gitignored, so only it has them) and copy each into the new
// worktree. Best-effort — warnings are logged, never thrown.
async function copyConfiguredFiles(db: AppDatabase, t: typeof schema.tasks.$inferSelect, checkout: string, worktreePath: string): Promise<void> {
  try {
    const ws = await workspaceConfigRow(db, t.repoOwner, t.repoName)
    const cfg = loadRepoConfig(checkout, homedir(), { setupScript: ws?.setupScript, teardownScript: ws?.teardownScript })
    if (!cfg.copy.length) return
    const res = copyWorktreeFiles(checkout, worktreePath, cfg.copy)
    for (const w of res.warnings) console.warn(`[worktrees] ${w}`)
  } catch (e) {
    console.warn('[worktrees] copy failed:', e)
  }
}

// Workspace-level config columns for a repo (preview + scripts) — the DB fallback layer that
// loadRepoConfig merges below any committed .acorn/config.toml (docs/next 13 §B).
async function workspaceConfigRow(db: AppDatabase, owner: string, repo: string) {
  const [wr] = await db
    .select({ workspaceId: schema.workspaceRepos.workspaceId })
    .from(schema.workspaceRepos)
    .where(and(eq(schema.workspaceRepos.repoOwner, owner), eq(schema.workspaceRepos.repoName, repo)))
  if (!wr) return null
  const [ws] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, wr.workspaceId))
  return ws ?? null
}

// Merged run-target config + the cwd to run in (the task worktree, created lazily like a terminal).
async function taskRunConfig(
  db: AppDatabase,
  taskId: string,
): Promise<
  | { targets: import('./repoConfig').RunTarget[]; cwd: string; errors: { source: string; message: string }[]; layouts: import('./repoConfig').LayoutRecipe[] }
  | { error: string }
> {
  const t = await loadTask(db, taskId)
  if (!t) return { error: 'Task not found.' }
  const mapped = await getRepoPath(db, t.repoOwner, t.repoName)
  const baseCheckout = mapped?.path && isDir(mapped.path) ? mapped.path : undefined
  if (!baseCheckout) return { error: 'No checkout mapped for this repo yet.' }
  const { cwd } = await resolveTaskCwd(db, t, baseCheckout)
  const ws = await workspaceConfigRow(db, t.repoOwner, t.repoName)
  const cfg = loadRepoConfig(cwd, homedir(), {
    setupScript: ws?.setupScript,
    teardownScript: ws?.teardownScript,
    previewMode: ws?.previewMode,
    previewValue: ws?.previewValue,
    runCommand: mapped?.runCommand,
    devPort: mapped?.devPort,
    runTargetsJson: mapped?.runTargets,
  })
  return { targets: cfg.runTargets, cwd, errors: cfg.errors, layouts: cfg.layouts }
}

async function markExited(db: AppDatabase, id: string, exitCode: number | null) {
  await db
    .update(schema.terminalSessions)
    .set({ status: 'exited', exitCode, exitedAt: Date.now() })
    .where(eq(schema.terminalSessions.id, id))
}

const deleteRow = (db: AppDatabase, id: string) => db.delete(schema.terminalSessions).where(eq(schema.terminalSessions.id, id))

function rowToMeta(row: typeof schema.terminalSessions.$inferSelect, ctx: Pick<TerminalSession, 'repo' | 'pull'>): TerminalSession {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind as TerminalSession['kind'],
    profileId: row.profileId,
    backend: row.backend as TerminalSession['backend'],
    status: 'running', // only called for sessions whose tmux is alive
    idle: false,
    agentState: ptyState(row.kind as TerminalSession['kind'], 'running', false),
    isWorktree: false, // not persisted; a reconciled session loses its worktree-cleanup affordance
    taskId: row.taskId,
    cwd: row.cwd,
    command: row.command,
    tmuxSession: row.tmuxSession ?? undefined,
    repo: ctx.repo,
    pull: ctx.pull,
    cols: row.cols,
    rows: row.rows,
    createdAt: row.createdAt,
    exitCode: null,
  }
}

// --- session lifecycle ---

function wireSession(db: AppDatabase, meta: TerminalSession, pty: IPty): Session {
  const s: Session = { meta, pty, ring: '', subscribers: new Set(), lastActivityAt: Date.now() }
  sessions.set(meta.id, s)
  pty.onData((data) => {
    s.lastActivityAt = Date.now()
    if (s.meta.idle) {
      s.meta.idle = false // output resumed → no longer waiting
      s.meta.agentState = ptyState(s.meta.kind, s.meta.status, false)
      broadcastStatus()
    }
    appendRing(s, data)
    emit(s, { type: 'output', data })
  })
  pty.onExit(({ exitCode, signal }) => {
    s.meta.status = 'exited'
    s.meta.idle = false
    s.meta.agentState = ptyState(s.meta.kind, 'exited', false)
    s.meta.exitCode = exitCode
    agentSender.clear(s.meta.id) // queued sends can never fire now
    emit(s, { type: 'exit', exitCode, signal: signal != null ? String(signal) : null })
    if (s.meta.backend === 'tmux') void markExited(db, s.meta.id, exitCode)
    broadcastStatus()
  })
  return s
}

// One timer flips running agents to idle after enough output silence, notifying once per transition
// (vNext §3). The busy→idle edge lives here; the idle→busy edge lives in onData above.
function startIdleWatch() {
  setInterval(() => {
    const now = Date.now()
    for (const s of sessions.values()) {
      if (computeIdle(s.meta.kind, s.meta.status, s.lastActivityAt, now) && !s.meta.idle) {
        s.meta.idle = true
        // An idle session showing an input prompt in its tail is BLOCKED, not done (05 P3).
        s.meta.agentState = matchBlockedPrompt(s.ring.slice(-4000)) ? 'blocked' : 'idle'
        agentSender.onIdle(s.meta.id) // flush 'after-ready' sends on the busy→idle edge (04 §D)
        // The OS toast moved to the renderer (docs/next 05): focus-gated + cooldown/dedup there.
        broadcastStatus()
      }
    }
  }, 3000)
}

async function create(db: AppDatabase, opts: CreateOpts): Promise<TerminalSession> {
  // The renderer passes the base checkout as opts.cwd (validated at the boundary); the worktree is
  // derived from it. Lazy worktree on first terminal, reused after (docs/workspaces Flow C).
  const baseCheckout = opts.cwd && isAbsolute(opts.cwd) && isDir(opts.cwd) ? opts.cwd : undefined
  const t = await loadTask(db, opts.taskId)
  const ctx = taskContext(t)
  const { cwd, isWorktree, created } = await resolveTaskCwd(db, t, baseCheckout)
  // First-ever worktree for this task → run the setup script (unless 'off') as tab #1 before the
  // requested session (which stays focused). Runs once because `created` is only true on the single
  // worktree add; if it already ran at task creation ('created' trigger), created is false here.
  if (created && t) await maybeRunSetup(db, t, cwd, ctx)
  return spawnOne(db, opts, cwd, isWorktree, ctx, t)
}

// Build the session meta, spawn the PTY (tmux or node-pty) in the already-resolved cwd, and wire it.
async function spawnOne(
  db: AppDatabase,
  opts: CreateOpts,
  cwd: string,
  isWorktree: boolean,
  ctx: Pick<TerminalSession, 'repo' | 'pull'>,
  task?: typeof schema.tasks.$inferSelect,
): Promise<TerminalSession> {
  const profile = getProfile(opts.profileId)
  // Dev-server pane (docs/workspaces P5): a command override runs via the user's shell with env
  // merged in; otherwise the profile's binary. resolveCommand stays the path for shells/agents.
  const command = opts.command?.trim() || resolveCommand(profile)
  // Every task-scoped session carries the ACORN_* identity vars (docs/next 02/11).
  const env = buildSessionEnv({
    taskId: opts.taskId,
    cwd,
    task: task ? { repoOwner: task.repoOwner, repoName: task.repoName, branch: task.branch, title: task.title } : null,
    env: opts.env,
  })
  const backend = resolveBackend(profile.backendPreference, tmuxAvailable())
  const cols = clampDim(opts.cols, 80)
  const rows = clampDim(opts.rows, 24)
  const id = randomUUID()

  const meta: TerminalSession = {
    id,
    title: opts.title?.trim() || profile.label,
    kind: profile.kind,
    profileId: profile.id,
    backend,
    status: 'running',
    idle: false,
    agentState: ptyState(profile.kind, 'running', false),
    isWorktree,
    taskId: opts.taskId,
    cwd,
    command,
    tmuxSession: backend === 'tmux' ? tmuxName(id) : undefined,
    repo: ctx.repo,
    pull: ctx.pull,
    cols,
    rows,
    createdAt: Date.now(),
    exitCode: null,
  }

  let pty: IPty
  if (backend === 'tmux') {
    ensureTmuxSession(meta.tmuxSession!, cwd, command, env)
    pty = attachTmuxPty(meta.tmuxSession!, cols, rows)
    await persistSession(db, meta)
  } else if (opts.command) {
    // No tmux: run the command line through a login shell so PATH/nvm resolve "pnpm" etc.
    pty = spawn(env.SHELL || '/bin/sh', ['-lc', command], { name: 'xterm-256color', cols, rows, cwd, env })
  } else {
    pty = spawn(command, [], { name: 'xterm-256color', cols, rows, cwd, env })
  }
  wireSession(db, meta, pty)
  return meta
}

// Killing a tmux session's attach PTY only *detaches* it — the session keeps running. To actually
// stop a tmux agent we must kill the tmux session itself (which then EOFs the PTY → onExit).
function killSession(s: Session) {
  if (s.meta.backend === 'tmux' && s.meta.tmuxSession) killTmuxSession(s.meta.tmuxSession)
  s.pty.kill()
}

// On startup, re-attach tmux sessions that are still alive and drop DB rows whose tmux is gone
// (vNext §12: app restart rediscovers tmux sessions). Runs once before the window opens.
async function reconcileTmux(db: AppDatabase) {
  let rows: (typeof schema.terminalSessions.$inferSelect)[]
  try {
    rows = await db.select().from(schema.terminalSessions)
  } catch {
    return
  }
  if (!rows.length) return
  const alive = tmuxAvailable() ? listTmuxSessions() : new Set<string>()
  for (const row of rows) {
    if (row.backend === 'tmux' && row.tmuxSession && alive.has(row.tmuxSession)) {
      const meta = rowToMeta(row, taskContext(await loadTask(db, row.taskId)))
      wireSession(db, meta, attachTmuxPty(row.tmuxSession, row.cols, row.rows))
    } else {
      await deleteRow(db, row.id)
    }
  }
}

// Registered once at app start. Every payload is validated here — the renderer is the less-trusted
// side (vNext §5, §11). Exited sessions linger until explicitly removed (term:remove).
export async function registerTerminalIpc(db: AppDatabase, worktreesDir: string) {
  worktreesRoot = worktreesDir

  // Workspace notes (docs/next 09 P1): files under <dataDir>/notes/<workspaceId>/, beside the
  // worktrees dir. ONE store — the UI reads it here; the MCP notes_* tools reuse it.
  const notesStore = new NotesStore(join(dirname(worktreesDir), 'notes'))

  // Fill the context assembler's notes seam (docs/next 09 P2 / 11 §C): the task's workspace notes
  // ride TaskContext.notes. Newest first, capped — the push block stays compact.
  setContextNotesSource(async (taskId) => {
    const t = await loadTask(db, taskId)
    if (!t) return []
    const ws = await workspaceConfigRow(db, t.repoOwner, t.repoName)
    if (!ws) return []
    const list = await notesStore.list(ws.id)
    const out: { title: string; body: string }[] = []
    for (const summary of list.slice(0, 10)) {
      const note = await notesStore.read(ws.id, summary.slug).catch(() => null)
      if (note) out.push({ title: `${note.title} (${note.kind})`, body: note.body.slice(0, 2000) })
    }
    return out
  })
  const guard = async <T>(fn: () => Promise<T>): Promise<T | { error: string }> => {
    try {
      return await fn()
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'notes failed' }
    }
  }
  ipcMain.handle('notes:list', (_e: IpcMainInvokeEvent, workspaceId: string) => guard(() => notesStore.list(String(workspaceId))))
  ipcMain.handle('notes:read', (_e: IpcMainInvokeEvent, p: { workspaceId: string; slug: string }) => guard(() => notesStore.read(p.workspaceId, p.slug)))
  ipcMain.handle('notes:create', (_e: IpcMainInvokeEvent, p: { workspaceId: string; title: string; kind?: NoteKind }) =>
    guard(() => notesStore.create(p.workspaceId, String(p.title ?? ''), { kind: p.kind })),
  )
  ipcMain.handle('notes:write', (_e: IpcMainInvokeEvent, p: { workspaceId: string; slug: string; body: string }) =>
    guard(async () => {
      await notesStore.write(p.workspaceId, p.slug, String(p.body ?? ''))
      return { ok: true }
    }),
  )
  ipcMain.handle('notes:remove', (_e: IpcMainInvokeEvent, p: { workspaceId: string; slug: string }) =>
    guard(async () => {
      await notesStore.remove(p.workspaceId, p.slug)
      return { ok: true }
    }),
  )

  // Runtime service (docs/next 13 §A): run targets as terminal sessions in the task worktree.
  // Short-lived scripts (stop / url_command) run out-of-band with the same ACORN_* env.
  const runScript = async (taskId: string, script: string, cwd: string): Promise<{ ok: boolean; output?: string; reason?: string }> => {
    const t = await loadTask(db, taskId)
    const env = buildSessionEnv({
      taskId,
      cwd,
      task: t ? { repoOwner: t.repoOwner, repoName: t.repoName, branch: t.branch, title: t.title } : null,
    })
    try {
      const { stdout } = await promisify(execFile)('/bin/sh', ['-c', script], { cwd, env, timeout: 15_000 })
      return { ok: true, output: stdout }
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : 'script failed' }
    }
  }
  const runtime = new RuntimeService({
    loadTargets: (taskId) => taskRunConfig(db, taskId),
    startSession: async (taskId, target, cwd) => {
      const t = await loadTask(db, taskId)
      const meta = await spawnOne(db, { taskId, command: target.command, title: `▶ ${target.id}` }, cwd, true, taskContext(t), t)
      broadcastStatus()
      return meta.id
    },
    isRunning: (sessionId) => sessions.get(sessionId)?.meta.status === 'running',
    exitCode: (sessionId) => sessions.get(sessionId)?.meta.exitCode,
    killSession: (sessionId) => {
      const s = sessions.get(sessionId)
      if (s) killSession(s)
    },
    runScript,
  })

  ipcMain.handle('run:targets', (_e: IpcMainInvokeEvent, taskId: string) => runtime.targets(String(taskId)))
  ipcMain.handle('run:start', (_e: IpcMainInvokeEvent, p: { taskId: string; targetId: string }) => runtime.start(String(p?.taskId), String(p?.targetId)))
  ipcMain.handle('run:stop', (_e: IpcMainInvokeEvent, p: { taskId: string; targetId: string }) => runtime.stop(String(p?.taskId), String(p?.targetId)))
  ipcMain.handle('run:status', (_e: IpcMainInvokeEvent, p: { taskId: string; targetId: string }) => runtime.status(String(p?.taskId), String(p?.targetId)))
  ipcMain.handle('run:defaultUrl', (_e: IpcMainInvokeEvent, taskId: string) => runtime.defaultUrl(String(taskId)))

  ipcMain.handle('term:repoPath:runTargets', (_e: IpcMainInvokeEvent, p: { owner: string; repo: string; runTargets: string }) =>
    setRunTargets(db, p.owner, p.repo, typeof p.runTargets === 'string' ? p.runTargets : ''),
  )

  ipcMain.handle('term:list', () => [...sessions.values()].map((s) => s.meta))

  ipcMain.handle('term:profiles', () => listProfiles())

  ipcMain.handle('term:create', (_e: IpcMainInvokeEvent, opts: CreateOpts) => create(db, opts ?? {}))

  // sendToAgent (docs/next 04 §D): bracketed paste into an agent session's PTY with a submit mode.
  ipcMain.handle('term:sendToAgent', (_e: IpcMainInvokeEvent, p: { sessionId: string; text: string; submit: SendSubmit }) => {
    if (typeof p?.sessionId !== 'string' || typeof p?.text !== 'string' || !p.text) return { ok: false, reason: 'Invalid payload.' }
    const submit: SendSubmit = p.submit === 'now' || p.submit === 'after-ready' || p.submit === 'draft' ? p.submit : 'draft'
    return agentSender.send(p.sessionId, p.text, submit)
  })

  ipcMain.handle('term:kill', (_e: IpcMainInvokeEvent, id: string) => {
    const s = sessions.get(id)
    if (!s) return false
    killSession(s)
    return true
  })

  ipcMain.handle('term:interrupt', (_e: IpcMainInvokeEvent, id: string) => {
    const s = sessions.get(id)
    if (!s || s.meta.status !== 'running') return false
    s.pty.write('\x03') // Ctrl-C to the foreground process
    return true
  })

  // Dismiss an exited session. Refuse a running one — kill it first.
  ipcMain.handle('term:remove', async (_e: IpcMainInvokeEvent, id: string) => {
    const s = sessions.get(id)
    if (!s || s.meta.status === 'running') return false
    sessions.delete(id)
    if (s.meta.backend === 'tmux') await deleteRow(db, id)
    return true
  })

  ipcMain.handle('term:repoPath:get', (_e: IpcMainInvokeEvent, p: { owner: string; repo: string }) =>
    getRepoPath(db, p.owner, p.repo),
  )

  ipcMain.handle('term:repoPath:set', (_e: IpcMainInvokeEvent, p: { owner: string; repo: string; path: string }) =>
    setRepoPath(db, p.owner, p.repo, p.path),
  )

  ipcMain.handle('term:repoPath:runConfig', (_e: IpcMainInvokeEvent, p: { owner: string; repo: string; runCommand: string; devPort: number }) =>
    setRunConfig(db, p.owner, p.repo, p.runCommand, p.devPort),
  )

  ipcMain.handle('term:repoPath:editorCommand', (_e: IpcMainInvokeEvent, p: { owner: string; repo: string; editorCommand: string }) =>
    setEditorCommand(db, p.owner, p.repo, typeof p.editorCommand === 'string' ? p.editorCommand : ''),
  )

  // Open the task's worktree (or the base checkout while no worktree exists) in the user's real
  // editor (docs/next 01 P2). Command precedence: repo_paths.editorCommand → prefs
  // 'editor_command_default' → 'code'; resolution failures come back as { ok:false, reason }.
  ipcMain.handle('term:openInEditor', async (_e: IpcMainInvokeEvent, taskId: string): Promise<{ ok: boolean; reason?: string }> => {
    if (typeof taskId !== 'string' || !taskId) return { ok: false, reason: 'Invalid task.' }
    const t = await loadTask(db, taskId)
    if (!t) return { ok: false, reason: 'Task not found.' }
    const mapped = await getRepoPath(db, t.repoOwner, t.repoName)
    const target = t.worktreePath && isDir(t.worktreePath) ? t.worktreePath : mapped?.path && isDir(mapped.path) ? mapped.path : null
    if (!target) return { ok: false, reason: 'No checkout mapped for this repo yet.' }
    // Machine-local single-user app: the prefs row is read by key alone (same reasoning as the
    // machine-scoped app-state tables having no user_id).
    const [pref] = await db.select().from(schema.prefs).where(eq(schema.prefs.key, 'editor_command_default')).limit(1)
    const launch = buildEditorArgv(mapped?.editorCommand ?? null, pref?.value ?? null, target, { pathVar: process.env.PATH ?? '', exists: existsSync })
    if (!launch.ok) return launch
    try {
      spawnProcess(launch.file, launch.args, { detached: true, stdio: 'ignore' }).unref()
      return { ok: true }
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) }
    }
  })

  // Browser-preview 'script' mode (WorkspaceSettings): run the configured shell command in the
  // task's worktree and use its stdout (last non-empty line, trimmed) as the preview URL. Keyed by
  // taskId so the renderer never supplies a path; a short timeout guards a hung script.
  ipcMain.handle('term:previewUrl', async (_e: IpcMainInvokeEvent, p: { taskId: string; script: string }): Promise<{ ok: boolean; url?: string; reason?: string }> => {
    const script = p.script?.trim()
    if (!script) return { ok: false, reason: 'no script configured' }
    const cwd = await taskRoot(db, p.taskId)
    if (!cwd) return { ok: false, reason: 'no worktree yet — open a terminal first' }
    try {
      const { stdout } = await promisify(execFile)('/bin/sh', ['-c', script], { cwd, timeout: 10_000 })
      const url = stdout.split('\n').map((l) => l.trim()).filter(Boolean).pop()
      return url ? { ok: true, url } : { ok: false, reason: 'script produced no output' }
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : 'script failed' }
    }
  })

  // Native folder picker for the onboarding repo-mapping flow. Returns the chosen path or null.
  ipcMain.handle('term:repoPath:pick', async (): Promise<string | null> => {
    const res = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return res.canceled || !res.filePaths[0] ? null : res.filePaths[0]
  })

  // Local-changes review (docs/next 04 §A): parsed status / per-file unified patch / blob read
  // against the task's worktree. Same boundary discipline as the editor IPC — taskId is the
  // capability, paths are validated repo-relative inside localDiff.ts.
  ipcMain.handle('local:changes', async (_e: IpcMainInvokeEvent, taskId: string) => {
    const root = await taskRoot(db, taskId)
    if (!root) return []
    try {
      return await localChanges(root)
    } catch {
      return []
    }
  })

  ipcMain.handle('local:diff', async (_e: IpcMainInvokeEvent, p: { taskId: string; path: string; scope: LocalScope }): Promise<{ patch: string } | { error: string }> => {
    const root = await taskRoot(db, p?.taskId)
    if (!root) return { error: 'No worktree yet.' }
    try {
      return await localDiff(root, p.path, p.scope === 'staged' ? 'staged' : 'unstaged')
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'diff failed' }
    }
  })

  ipcMain.handle('local:blob', async (_e: IpcMainInvokeEvent, p: { taskId: string; path: string; ref?: string }): Promise<{ text: string } | { error: string }> => {
    const root = await taskRoot(db, p?.taskId)
    if (!root) return { error: 'No worktree yet.' }
    try {
      return await localFileBlob(root, p.path, p.ref ?? 'HEAD')
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'read failed' }
    }
  })

  // Stage/commit actions (docs/next 04 P4). Discard is destructive — the renderer confirms before
  // calling; main still keeps the path validation.
  const withRoot = async (taskId: string, fn: (root: string) => Promise<{ ok: boolean; reason?: string }>) => {
    const root = await taskRoot(db, taskId)
    if (!root) return { ok: false, reason: 'No worktree yet.' }
    const res = await fn(root)
    broadcastStatus() // dirty markers move immediately
    return res
  }
  ipcMain.handle('local:stage', (_e: IpcMainInvokeEvent, p: { taskId: string; path: string }) => withRoot(p?.taskId, (root) => stageFile(root, p.path)))
  ipcMain.handle('local:unstage', (_e: IpcMainInvokeEvent, p: { taskId: string; path: string }) => withRoot(p?.taskId, (root) => unstageFile(root, p.path)))
  ipcMain.handle('local:discard', (_e: IpcMainInvokeEvent, p: { taskId: string; path: string; untracked?: boolean }) =>
    withRoot(p?.taskId, (root) => discardFile(root, p.path, !!p.untracked)),
  )
  ipcMain.handle('local:commit', (_e: IpcMainInvokeEvent, p: { taskId: string; message: string }) =>
    withRoot(p?.taskId, (root) => commitStaged(root, typeof p.message === 'string' ? p.message : '')),
  )

  // Monaco editor pane (docs/workspaces): read/write files on the task's worktree. Local-only, so
  // IPC not HTTP. All calls are keyed by taskId + a relative path confined to the worktree root by
  // resolveInRoot — the renderer never hands us an absolute path.
  ipcMain.handle('editor:root', (_e: IpcMainInvokeEvent, taskId: string): Promise<string | null> => taskRoot(db, taskId))

  ipcMain.handle('editor:list', async (_e: IpcMainInvokeEvent, p: { taskId: string; relPath: string }): Promise<{ name: string; dir: boolean }[]> => {
    const root = await taskRoot(db, p.taskId)
    const abs = root && resolveInRoot(root, p.relPath)
    if (!abs) return []
    const ents = await readdir(abs, { withFileTypes: true })
    return ents
      .filter((e) => e.name !== '.git' && e.name !== 'node_modules')
      .map((e) => ({ name: e.name, dir: e.isDirectory() }))
      .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1))
  })

  ipcMain.handle('editor:read', async (_e: IpcMainInvokeEvent, p: { taskId: string; relPath: string }): Promise<string> => {
    const root = await taskRoot(db, p.taskId)
    const abs = root && resolveInRoot(root, p.relPath)
    if (!abs) throw new Error('Path outside worktree.')
    return readFile(abs, 'utf8')
  })

  ipcMain.handle('editor:write', async (_e: IpcMainInvokeEvent, p: { taskId: string; relPath: string; content: string }): Promise<{ ok: boolean; reason?: string }> => {
    const root = await taskRoot(db, p.taskId)
    const abs = root && resolveInRoot(root, p.relPath)
    if (!abs) return { ok: false, reason: 'Path outside worktree.' }
    try {
      await writeFile(abs, p.content, 'utf8')
      return { ok: true }
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) }
    }
  })

  // Archive a task with the lifecycle guard (docs/workspaces 05): the ONLY path allowed to
  // tear a worktree down, and never automatic. Refuse while sessions run or the worktree is dirty;
  // otherwise remove the worktree and mark the row archived (kept for history). Worktree removal +
  // the running-session check both need main (git + the in-memory session map), so this is IPC, not
  // an HTTP route.
  ipcMain.handle('term:task:statuses', () => computeTaskStatuses(db))

  // Notified by the client right after a task is created. If its workspace runs the setup script on
  // task creation (trigger 'created') and the repo checkout is mapped, eagerly create the worktree
  // and run the script now (as a background "Setup" tab). Other triggers ('terminal'/'off') no-op
  // here and are handled lazily by create(). Best-effort: a missing checkout defers to first terminal.
  ipcMain.handle('term:task:onCreated', async (_e: IpcMainInvokeEvent, id: string): Promise<void> => {
    if (typeof id !== 'string' || !id) return
    const t = await loadTask(db, id)
    if (!t || (t.worktreePath && isDir(t.worktreePath))) return
    const { script, trigger } = await workspaceSetup(db, t.repoOwner, t.repoName)
    if (trigger !== 'created' || !script?.trim()) return
    const mapped = await getRepoPath(db, t.repoOwner, t.repoName)
    if (!mapped || !isDir(mapped.path)) return
    const wt = await ensureWorktree(worktreesRoot, mapped.path, t.repoOwner, t.repoName, t.branch, t.pullNumber, await baseRefPref(db, t.repoOwner, t.repoName))
    if (!wt.ok || !wt.created) return
    await db.update(schema.tasks).set({ worktreePath: wt.path, updatedAt: Date.now() }).where(eq(schema.tasks.id, t.id))
    await copyConfiguredFiles(db, t, mapped.path, wt.path)
    await maybeRunSetup(db, t, wt.path, taskContext(t))
    broadcastStatus() // rail/footer pick up the new worktree; panel re-lists to show the Setup tab
  })

  // Archive orchestration lives in archive.ts (guard → teardown → stop sessions → remove worktree →
  // mark archived, docs/next 02); this handler just injects the live-session + drawer glue.
  ipcMain.handle('term:task:archive', async (_e: IpcMainInvokeEvent, id: string, opts?: ArchiveOpts): Promise<ArchiveResult> => {
    if (typeof id !== 'string' || !id) return { ok: false, reason: 'Invalid task.' }
    return archiveTask(db, id, opts ?? {}, {
      isDir,
      runningCount: (taskId) => [...sessions.values()].filter((s) => s.meta.taskId === taskId && s.meta.status === 'running').length,
      killRunning: (taskId) => {
        for (const s of sessions.values()) if (s.meta.taskId === taskId && s.meta.status === 'running') killSession(s)
      },
      // Drop any lingering exited sessions for this task so their rows don't outlive it.
      dropTaskSessions: async (taskId) => {
        for (const [sid, s] of sessions) {
          if (s.meta.taskId === taskId) {
            sessions.delete(sid)
            if (s.meta.backend === 'tmux') await deleteRow(db, sid)
          }
        }
      },
      // Teardown streams to the task drawer as a "Teardown" tab; its exit code + ring buffer are
      // the result. A ~2 min timeout kills it (exitCode null → surfaced as timeout).
      runTeardown: async (script, cwd, env, taskId) => {
        const t = await loadTask(db, taskId)
        const meta = await spawnOne(db, { taskId, command: script, title: 'Teardown', env }, cwd, true, taskContext(t), t)
        const s = sessions.get(meta.id)
        if (!s) return { exitCode: 1, output: 'Could not start the teardown session.' }
        broadcastStatus()
        return new Promise((resolveTeardown) => {
          const timer = setTimeout(() => killSession(s), TEARDOWN_TIMEOUT_MS)
          s.pty.onExit(({ exitCode }) => {
            clearTimeout(timer)
            resolveTeardown({ exitCode, output: s.ring })
          })
        })
      },
    })
  })

  ipcMain.handle('term:resize', (_e: IpcMainInvokeEvent, p: { id: string; cols: number; rows: number }) => {
    const s = sessions.get(p?.id)
    if (!s) return false
    const cols = clampDim(p.cols, s.meta.cols)
    const rows = clampDim(p.rows, s.meta.rows)
    s.meta.cols = cols
    s.meta.rows = rows
    if (s.meta.status === 'running') s.pty.resize(cols, rows)
    return true
  })

  ipcMain.on('term:input', (_e, p: { id: string; data: string }) => {
    const s = sessions.get(p?.id)
    if (s && s.meta.status === 'running' && typeof p.data === 'string') s.pty.write(p.data)
  })

  // attach = subscribe + replay. The renderer's subscription is an attachment, not the session
  // itself: detaching / reloading never kills the PTY or the tmux session (vNext §5).
  ipcMain.on('term:attach', (e, id: string) => {
    const s = sessions.get(id)
    if (!s) return
    s.subscribers.add(e.sender)
    e.sender.send(channel(id), { type: 'ready', session: s.meta, replayed: s.ring.length > 0 } satisfies ServerMsg)
    if (s.ring) e.sender.send(channel(id), { type: 'output', data: s.ring } satisfies ServerMsg)
    e.sender.once('destroyed', () => s.subscribers.delete(e.sender))
  })

  ipcMain.on('term:detach', (e, id: string) => {
    sessions.get(id)?.subscribers.delete(e.sender)
  })

  await reconcileTmux(db)
  await reconcileWorktrees(db)
  startIdleWatch()
}
