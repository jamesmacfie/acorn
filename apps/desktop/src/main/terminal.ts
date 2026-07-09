import { dialog, ipcMain, webContents, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { bindBrowserContents } from './browserService'
import { spawn, type IPty } from 'node-pty'
import { execFile, execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { homedir } from 'node:os'
import { eq } from 'drizzle-orm'
import type { AppDatabase } from '../server/db'
import { schema } from '../server/db'
import type { ArchiveOpts, ArchiveResult, CreateOpts, ServerMsg, TerminalSession } from '../shared/terminal'
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
import { getProfile, listProfiles, resolveCommand, tmuxAvailable } from './profiles'
import { getRepoPath, setRepoPath, setRunTargets } from './repoPaths'
import { fileURLToPath } from 'node:url'
import { inspectMcpConfig, MCP_CANDIDATES, STARTER_MCP_JSON, type McpServerSummary } from '../shared/mcp'
import { launcherSpec, registerAcornMcp, resolveMcpEntry, serverName, type AgentFlavour } from './mcpRegister'
import { broadcastStatus } from './notify'
import type { RunSessionGlue } from './runIpc'
import {
  baseRefPref,
  computeTaskStatuses,
  copyConfiguredFiles,
  isDir,
  loadTask,
  resolveTaskCwd,
  taskContext,
  taskRoot,
  workspaceSetup,
  type TaskRow,
} from './taskWorktree'
import { currentBranch, ensureWorktree } from './worktrees'

// vNext Phase 2: PTYs live in the main process. Sessions run on one of two backends —
//  - node-pty: spawn the command directly. Survives a window reload (PTY is in main), not an app
//    restart. In-memory only.
//  - tmux: a detached `tmux` session drives the command; a PTY attaches to it. Survives an app
//    restart (the tmux daemon is separate) and can be attached from a real terminal. Persisted to
//    SQLite so startup can reconcile rows against `tmux list-sessions` and re-attach survivors.
// Terminal output is never persisted (vNext §8).
//
// This module is the SESSION ENGINE + the `term:*`/`mcp:*` IPC surfaces; the other surfaces live
// in their own modules (localGitIpc / runIpc / knowledgeIpc / workflowWiring / harnessWiring,
// docs/terminal-and-agents.md) and registerTerminalIpc at the bottom composes them.

type Session = {
  meta: TerminalSession
  pty: IPty
  ring: string
  subscribers: Set<WebContents>
  lastActivityAt: number
}

const sessions = new Map<string, Session>()

// sendToAgent (docs/panes.md): bracketed-paste delivery into agent PTYs, with 'after-ready'
// queued on the idle edge below. One instance over the live session map.
const agentSender = new AgentSender((id) => {
  const s = sessions.get(id)
  if (!s) return null
  return { write: (data: string) => s.pty.write(data), running: () => s.meta.status === 'running', idle: () => s.meta.idle }
})

// Queue a text block into an agent session on its idle edge (knowledgeIpc's memory injector calls
// this). Exported so the composition root can hand it to knowledge without knowledge importing the
// terminal engine — the dependency points one way (review §2).
export function sendToAgent(sessionId: string, text: string, submit: SendSubmit): void {
  void agentSender.send(sessionId, text, submit)
}

// The cross-domain hooks the composition root injects at boot (review §2: setter-injection stays,
// installation moves to one place). Held as nullable module state only because the handlers close
// over module scope — TerminalIpcDeps requires all of them, so registerTerminalIpc sets every one
// before any session can spawn.
// - memoryInjector: push the repo-memory block into a fresh agent session (docs/next 12 P2).
// - memoryReviewTrigger: fire the auto-generation pass when an agent session exits (docs/next 12 P3).
// - seedNotes: snapshot PR/ticket context into curatable notes on task creation (docs/notes-and-memory.md).
// - internalApiEnv: loopback API access (ACORN_API_URL/ACORN_API_TOKEN) inherited by session env.
// - bootReconciled: the composition root's reconcile pass — archive awaits it (see the handler).
let memoryInjector: ((taskId: string, sessionId: string) => Promise<void>) | null = null
let memoryReviewTrigger: ((taskId: string, transcriptTail: string) => Promise<void>) | null = null
let seedNotes: ((task: TaskRow) => Promise<void>) | null = null
let internalApiEnv: Record<string, string> = {}
let bootReconciled: Promise<void> = Promise.resolve()

const channel = (id: string) => `term:out:${id}`

// PTY-tier AgentState (docs/terminal-and-agents.md): shells stay 'unknown'; agents flip working/idle with the
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

// --- tmux process plumbing (execFileSync with arg arrays — no shell, command is a fixed profile
// binary, cwd is validated, name is acorn-<uuid>) ---

function ensureTmuxSession(name: string, cwd: string, command: string, env: Record<string, string>) {
  // tmux runs the command argument through the user's shell, so a full "pnpm dev" line works; env
  // (e.g. PORT) is inherited by that shell (docs/workspaces P5).
  execFileSync('tmux', tmuxNewSessionArgs(name, cwd, command), { env, stdio: 'ignore' })
  // ponytail: hide tmux's own status bar — we render our own tab strip, so it's just noise
  execFileSync('tmux', ['set-option', '-t', name, 'status', 'off'], { env, stdio: 'ignore' })
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

async function markExited(db: AppDatabase, id: string, exitCode: number | null) {
  await db
    .update(schema.terminalSessions)
    .set({ status: 'exited', exitCode, exitedAt: Date.now() })
    .where(eq(schema.terminalSessions.id, id))
}

const deleteRow = (db: AppDatabase, id: string) => db.delete(schema.terminalSessions).where(eq(schema.terminalSessions.id, id))

function rowToMeta(row: typeof schema.terminalSessions.$inferSelect, ctx: Pick<TerminalSession, 'repo' | 'pull'>, isWorktree: boolean): TerminalSession {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind as TerminalSession['kind'],
    profileId: row.profileId,
    backend: row.backend as TerminalSession['backend'],
    status: 'running', // only called for sessions whose tmux is alive
    idle: false,
    agentState: ptyState(row.kind as TerminalSession['kind'], 'running', false),
    isWorktree, // recomputed from the task join (cwd === tasks.worktreePath) — never persisted
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
    // Task-completion trigger (docs/next 12 P3): an agent session ending is the extraction moment.
    if (s.meta.kind === 'agent' && s.meta.title !== 'Teardown') void memoryReviewTrigger?.(s.meta.taskId, s.ring.slice(-10_000))
    broadcastStatus()
  })
  return s
}

// One timer flips running agents to idle after enough output silence, notifying once per transition
// (vNext §3). The busy→idle edge lives here; the idle→busy edge lives in onData above. The handle is
// held so the composition root can clear it on quit (review §2 — it used to leak).
let idleWatch: ReturnType<typeof setInterval> | null = null
function startIdleWatch() {
  if (idleWatch) return // registered once; a second boot must not stack a second timer
  idleWatch = setInterval(() => {
    const now = Date.now()
    for (const s of sessions.values()) {
      if (computeIdle(s.meta.kind, s.meta.status, s.lastActivityAt, now) && !s.meta.idle) {
        s.meta.idle = true
        // An idle session showing an input prompt in its tail is BLOCKED, not done (05 P3).
        s.meta.agentState = matchBlockedPrompt(s.ring.slice(-4000)) ? 'blocked' : 'idle'
        agentSender.onIdle(s.meta.id) // flush 'after-ready' sends on the busy→idle edge (04 §D)
        // The OS toast moved to the renderer (docs/terminal-and-agents.md): focus-gated + cooldown/dedup there.
        broadcastStatus()
      }
    }
  }, 3000)
}

// Run the workspace setup script as a "Setup" session in the freshly-created worktree, unless it's
// blank or disabled ('off'). Called whenever a worktree is first created (create() on first
// terminal, or onCreated at task creation). Ordered before the requested session so it's tab #1.
async function maybeRunSetup(db: AppDatabase, t: TaskRow, cwd: string, ctx: Pick<TerminalSession, 'repo' | 'pull'>): Promise<void> {
  const { script, trigger } = await workspaceSetup(db, t.repoOwner, t.repoName)
  if (trigger === 'off' || !script?.trim()) return
  await spawnOne(db, { taskId: t.id, command: script, title: 'Setup' }, cwd, true, ctx, t)
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
  task?: TaskRow,
): Promise<TerminalSession> {
  const profile = getProfile(opts.profileId)
  // Dev-server pane (docs/workspaces P5): a command override runs via the user's shell with env
  // merged in; otherwise the profile's binary. resolveCommand stays the path for shells/agents.
  const command = opts.command?.trim() || resolveCommand(profile)
  const id = randomUUID()
  // Every task-scoped session carries the ACORN_* identity vars (docs/terminal-and-agents.md, docs/next 11) plus its own
  // session id — MCP notes/memory writes use it for `author: agent` provenance (docs/notes-and-memory.md).
  const env = buildSessionEnv({
    taskId: opts.taskId,
    cwd,
    task: task ? { repoOwner: task.repoOwner, repoName: task.repoName, branch: task.branch, title: task.title } : null,
    env: { ...internalApiEnv, ACORN_SESSION_ID: id, ...(opts.env ?? {}) },
  })
  const backend = resolveBackend(profile.backendPreference, tmuxAvailable())
  const cols = clampDim(opts.cols, 80)
  const rows = clampDim(opts.rows, 24)

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

  // Auto-register the acorn MCP server with this agent's CLI before it launches, so the current
  // task's tools are always available — no manual "Register" click. Idempotent (remove-then-add),
  // failures (CLI missing) are swallowed. Awaited so the agent sees it at startup.
  const mcpFlavour = PROFILE_MCP_FLAVOUR[profile.id]
  if (mcpFlavour) await registerAcornMcp(mcpFlavour, mcpName(), mcpLauncher()).catch(() => undefined)

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
  // A fresh AGENT session gets the repo-memory block queued for its idle edge (docs/next 12 P2).
  if (profile.kind === 'agent') void memoryInjector?.(opts.taskId, id)
  return meta
}

// acorn MCP server: the launcher + build-flavored name (dev vs prod), and which agent profiles get
// it auto-registered when their terminal spawns (docs/mcp.md). Module-level so both spawnOne and
// the ipc handlers share them.
const mcpName = () => serverName(!process.defaultApp && !process.env.ELECTRON_IS_DEV)
const mcpLauncher = () => launcherSpec(process.execPath, resolveMcpEntry(dirname(fileURLToPath(import.meta.url))), mcpName())
const PROFILE_MCP_FLAVOUR: Record<string, AgentFlavour> = { 'claude-code': 'claude', codex: 'codex' }

// Killing a tmux session's attach PTY only *detaches* it — the session keeps running. To actually
// stop a tmux agent we must kill the tmux session itself (which then EOFs the PTY → onExit).
function killSession(s: Session) {
  if (s.meta.backend === 'tmux' && s.meta.tmuxSession) killTmuxSession(s.meta.tmuxSession)
  s.pty.kill()
}

// On startup, re-attach tmux sessions that are still alive and drop DB rows whose tmux is gone
// (vNext §12: app restart rediscovers tmux sessions). Run by the composition root's coordinated
// reconcile() step, off the paint-critical path (review §2, performance §3.6).
export async function reconcileTmux(db: AppDatabase) {
  let rows: (typeof schema.terminalSessions.$inferSelect)[]
  try {
    rows = await db.select().from(schema.terminalSessions)
  } catch {
    return
  }
  if (!rows.length) return
  const alive = tmuxAvailable() ? listTmuxSessions() : new Set<string>()
  let reattached = 0
  for (const row of rows) {
    // Per-row guard: one corrupt row / failed attach must not abort the remaining rows (or, via
    // the composition root, the rest of the reconcile pass).
    try {
      if (row.backend === 'tmux' && row.tmuxSession && alive.has(row.tmuxSession)) {
        const task = await loadTask(db, row.taskId)
        // isWorktree is derived, not persisted (docs/workspaces 03): tasks.worktreePath is the truth,
        // so recompute it here so a session that survives an app restart keeps its worktree affordance.
        const isWorktree = !!task?.worktreePath && resolve(row.cwd) === resolve(task.worktreePath)
        wireSession(db, rowToMeta(row, taskContext(task), isWorktree), attachTmuxPty(row.tmuxSession, row.cols, row.rows))
        reattached++
      } else {
        await deleteRow(db, row.id)
      }
    } catch (e) {
      console.warn('[terminal] tmux reconcile failed for session', row.id, e)
    }
  }
  // This now runs after the window (composition root step 6), so the renderer's initial term:list
  // has already fired — ping it to re-list, or resurrected sessions stay invisible until some
  // unrelated broadcast (shell sessions never hit the idle-edge broadcasts).
  if (reattached) broadcastStatus()
}

// The session-engine glue the run-target service (runIpc) needs: spawn a target's command as a
// terminal session in the task worktree, and observe/kill it. Exported so the composition root can
// build the RuntimeService without this engine importing the run domain (review §2 — the run
// service depends on the engine, not the reverse).
export function terminalRunGlue(db: AppDatabase): RunSessionGlue {
  return {
    startSession: async (taskId: string, target: { id: string; command: string }, cwd: string) => {
      const t = await loadTask(db, taskId)
      const meta = await spawnOne(db, { taskId, command: target.command, title: `▶ ${target.id}` }, cwd, true, taskContext(t), t)
      broadcastStatus()
      return meta.id
    },
    isRunning: (sessionId: string) => sessions.get(sessionId)?.meta.status === 'running',
    exitCode: (sessionId: string) => sessions.get(sessionId)?.meta.exitCode,
    killSession: (sessionId: string) => {
      const s = sessions.get(sessionId)
      if (s) killSession(s)
    },
  }
}

// The cross-domain hooks the composition root injects when it registers this engine. They break the
// knowledge↔terminal cycle: knowledge is built with the engine's exported sendToAgent, and its
// memory/notes closures come back in here — so the engine never imports knowledge (review §2).
export type TerminalIpcDeps = {
  internalApiEnv: Record<string, string>
  memoryInjector: (taskId: string, sessionId: string) => Promise<void>
  memoryReviewTrigger: (taskId: string, transcriptTail: string) => Promise<void>
  seedTaskNotes: (task: TaskRow) => Promise<void>
  // Resolves when the composition root's post-window reconcile pass is done (always resolves,
  // even on reconcile failure). Mutating surfaces that read the sessions map await it.
  reconciled: Promise<void>
}

// Clear the engine's own background work on quit (review §2). Idempotent — safe to call after a
// partial boot that never started the idle-watch.
export function disposeTerminal(): void {
  if (idleWatch) {
    clearInterval(idleWatch)
    idleWatch = null
  }
}

// Registered once at app start by the composition root (main/bootstrap.ts). Every payload is
// validated here — the renderer is the less-trusted side (vNext §5, §11). Exited sessions linger
// until explicitly removed (term:remove). This is the PTY engine + its own term:*/mcp:*/browser:*
// surfaces only; the other domains are wired by the composition root.
export function registerTerminalIpc(db: AppDatabase, worktreesDir: string, deps: TerminalIpcDeps): void {
  internalApiEnv = deps.internalApiEnv
  memoryInjector = deps.memoryInjector
  memoryReviewTrigger = deps.memoryReviewTrigger
  seedNotes = deps.seedTaskNotes
  bootReconciled = deps.reconciled

  // MCP config inspector (docs/mcp.md): read ONLY the known candidate files (worktree
  // .mcp.json / .cursor/mcp.json, ~/.claude.json), parse + MASK IN MAIN — raw secrets never cross
  // to the renderer. Read-only; acorn never launches these servers.
  ipcMain.handle('mcp:inspect', async (_e: IpcMainInvokeEvent, taskId: string): Promise<{ file: string; servers: McpServerSummary[] }[]> => {
    const root = typeof taskId === 'string' && taskId ? await taskRoot(db, taskId) : null
    const out: { file: string; servers: McpServerSummary[] }[] = []
    for (const candidate of MCP_CANDIDATES) {
      const base = candidate.root === 'home' ? homedir() : root
      if (!base) continue
      const file = resolve(base, candidate.rel)
      try {
        const text = await readFile(file, 'utf8')
        out.push({ file, servers: inspectMcpConfig(text) })
      } catch {
        // absent file → not listed
      }
    }
    return out
  })

  ipcMain.handle('mcp:createStarter', async (_e: IpcMainInvokeEvent, taskId: string): Promise<{ ok: boolean; reason?: string }> => {
    const root = await taskRoot(db, taskId)
    if (!root) return { ok: false, reason: 'No worktree yet — open a terminal first.' }
    const file = resolve(root, '.mcp.json')
    if (existsSync(file)) return { ok: false, reason: '.mcp.json already exists.' }
    await writeFile(file, STARTER_MCP_JSON, 'utf8')
    return { ok: true }
  })

  // The renderer binds each task's preview webview after creation (dom-ready) so main can drive it.
  ipcMain.handle('browser:bind', (_e: IpcMainInvokeEvent, p: { taskId: string; webContentsId: number }) => {
    if (typeof p?.taskId !== 'string' || typeof p?.webContentsId !== 'number') return false
    const contents = webContents.fromId(p.webContentsId)
    if (!contents) return false
    bindBrowserContents(p.taskId, contents)
    return true
  })

  ipcMain.handle('term:repoPath:runTargets', (_e: IpcMainInvokeEvent, p: { owner: string; repo: string; runTargets: string }) =>
    setRunTargets(db, p.owner, p.repo, typeof p.runTargets === 'string' ? p.runTargets : ''),
  )

  ipcMain.handle('term:list', () => [...sessions.values()].map((s) => s.meta))

  ipcMain.handle('term:profiles', () => listProfiles())

  ipcMain.handle('term:create', (_e: IpcMainInvokeEvent, opts: CreateOpts) => create(db, opts ?? {}))

  // sendToAgent (docs/panes.md): bracketed paste into an agent session's PTY with a submit mode.
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

  // Close a session in one shot: kill it if still running, then drop it.
  ipcMain.handle('term:remove', async (_e: IpcMainInvokeEvent, id: string) => {
    const s = sessions.get(id)
    if (!s) return false
    if (s.meta.status === 'running') killSession(s)
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

  // Live worktree statuses (dirty / missing) for the rail + footer markers (docs/workspaces 02/05).
  ipcMain.handle('term:task:statuses', () => computeTaskStatuses(db))

  // Notified by the client right after a task is created. If its workspace runs the setup script on
  // task creation (trigger 'created') and the repo checkout is mapped, eagerly create the worktree
  // and run the script now (as a background "Setup" tab). Other triggers ('terminal'/'off') no-op
  // here and are handled lazily by create(). Best-effort: a missing checkout defers to first terminal.
  ipcMain.handle('term:task:onCreated', async (_e: IpcMainInvokeEvent, id: string): Promise<void> => {
    if (typeof id !== 'string' || !id) return
    const t = await loadTask(db, id)
    if (!t) return
    // Snapshot PR/ticket context into curatable notes (docs/notes-and-memory.md). Best-effort and
    // independent of worktree setup — runs even when there's no setup script / the worktree exists.
    await seedNotes?.(t).catch((e) => console.warn('[notes] seed failed:', e))
    if (t.worktreePath && isDir(t.worktreePath)) return
    const { script, trigger } = await workspaceSetup(db, t.repoOwner, t.repoName)
    if (trigger !== 'created' || !script?.trim()) return
    const mapped = await getRepoPath(db, t.repoOwner, t.repoName)
    if (!mapped || !isDir(mapped.path)) return
    const wt = await ensureWorktree(worktreesDir, mapped.path, t.repoOwner, t.repoName, t.branch, t.pullNumber, await baseRefPref(db, t.repoOwner, t.repoName))
    if (!wt.ok || !wt.created) return
    await db.update(schema.tasks).set({ worktreePath: wt.path, updatedAt: Date.now() }).where(eq(schema.tasks.id, t.id))
    await copyConfiguredFiles(db, t, mapped.path, wt.path)
    await maybeRunSetup(db, t, wt.path, taskContext(t))
    broadcastStatus() // rail/footer pick up the new worktree; panel re-lists to show the Setup tab
  })

  // "New task here": point a task at the mapped checkout itself instead of an isolated worktree, and
  // adopt the checkout's current branch. worktreePath === checkout is the marker every guard keys off
  // (resolveTaskCwd reuses it as-is; archive skips removeWorktree for it). taskId is the capability —
  // the path is re-derived from the DB here, never renderer-supplied. Returns the corrected fields so
  // the renderer can patch its Task; null if no checkout is mapped (caller falls back to a worktree).
  ipcMain.handle('term:task:useCheckout', async (_e: IpcMainInvokeEvent, id: string): Promise<{ worktreePath: string; branch: string } | null> => {
    if (typeof id !== 'string' || !id) return null
    const t = await loadTask(db, id)
    if (!t) return null
    const mapped = await getRepoPath(db, t.repoOwner, t.repoName)
    if (!mapped || !isDir(mapped.path)) return null
    const branch = (await currentBranch(mapped.path)) || t.branch // detached HEAD → keep the seed branch
    await db.update(schema.tasks).set({ worktreePath: mapped.path, branch, updatedAt: Date.now() }).where(eq(schema.tasks.id, t.id))
    broadcastStatus() // rail/footer pick up the borrowed checkout
    return { worktreePath: mapped.path, branch }
  })

  // Archive orchestration lives in archive.ts (guard → teardown → stop sessions → remove worktree →
  // mark archived, docs/terminal-and-agents.md); this handler just injects the live-session + drawer glue. The ONLY
  // path allowed to tear a worktree down, and never automatic.
  ipcMain.handle('term:task:archive', async (_e: IpcMainInvokeEvent, id: string, opts?: ArchiveOpts): Promise<ArchiveResult> => {
    if (typeof id !== 'string' || !id) return { ok: false, reason: 'Invalid task.' }
    // Archive right after relaunch must wait for tmux reconcile: before it, the sessions map is
    // empty, so the running-session guard passes vacuously, killRunning kills nothing, and the
    // task's live tmux session would survive (and be re-attached) past its deleted worktree.
    await bootReconciled
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
    // The ring is a raw byte window, not a screen: for a cursor-addressed TUI (Claude/Codex) the
    // replay is lossy and corrupts. Nudge the app to repaint from live state over it with Ctrl-L.
    // ponytail: Ctrl-L repaint; the proper fix is a headless-emulator serialize (docs note), add
    // when a non-repainting TUI still garbles.
    if (s.ring && s.meta.kind === 'agent' && s.meta.status === 'running') s.pty.write('\x0c')
    e.sender.once('destroyed', () => s.subscribers.delete(e.sender))
  })

  ipcMain.on('term:detach', (e, id: string) => {
    sessions.get(id)?.subscribers.delete(e.sender)
  })

  // Durable-state reconciliation (reconcileTmux) is driven by the composition root's reconcile()
  // step, off the paint-critical path. The idle-watch is engine-owned and starts here.
  startIdleWatch()
}
