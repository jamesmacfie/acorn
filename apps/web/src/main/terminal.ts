import { BrowserWindow, ipcMain, Notification, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { spawn, type IPty } from 'node-pty'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { homedir } from 'node:os'
import { eq } from 'drizzle-orm'
import type { AppDatabase } from '../server/db'
import { schema } from '../server/db'
import type { ArchiveResult, CreateOpts, ServerMsg, TerminalSession, WorkspaceStatus } from '../shared/terminal'
import {
  childEnv,
  clampDim,
  computeIdle,
  parseTmuxSessions,
  resolveBackend,
  tmuxAttachArgs,
  tmuxName,
  tmuxNewSessionArgs,
  trimRing,
} from './terminalUtils'
import { getProfile, listProfiles, resolveCommand, tmuxAvailable } from './profiles'
import { getRepoPath, setRepoPath, setRunConfig } from './repoPaths'
import { ensureWorktree, removeWorktree, worktreePorcelain } from './worktrees'

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

// Set once by registerTerminalIpc — where workspace worktrees are created (docs/workspaces 05).
let worktreesRoot = ''

const channel = (id: string) => `term:out:${id}`

// Per-tab status (idle/exited) is shown for sessions the renderer isn't attached to, so changes
// are broadcast as a content-free ping; the panel re-pulls term:list to get fresh meta.
function broadcastStatus() {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('term:status')
}

function notifyIdle(m: TerminalSession) {
  if (!Notification.isSupported()) return
  new Notification({ title: `${m.title} is waiting`, body: 'The agent has been idle — it may need input.' }).show()
}

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
    workspaceId: m.workspaceId,
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

const loadWorkspace = async (db: AppDatabase, id: string): Promise<typeof schema.workspaces.$inferSelect | undefined> => {
  const [ws] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, id))
  return ws
}

// Live worktree status for every active workspace that has a worktree (docs/workspaces 02/05):
// dirty + changed-file count via git, and `missing` when the dir vanished (removed outside acorn).
async function computeWorkspaceStatuses(db: AppDatabase): Promise<WorkspaceStatus[]> {
  const rows = (await db.select().from(schema.workspaces).where(eq(schema.workspaces.status, 'active'))).filter((w) => w.worktreePath)
  return Promise.all(
    rows.map(async (w) => {
      const path = w.worktreePath!
      if (!isDir(path)) return { workspaceId: w.id, worktreePath: path, dirty: false, dirtyCount: 0, missing: true }
      const { dirty, count } = await worktreePorcelain(path)
      return { workspaceId: w.id, worktreePath: path, dirty, dirtyCount: count, missing: false }
    }),
  )
}

// Startup reconciliation (docs/workspaces 05): flag any persisted worktree whose directory is gone
// (manual rm) as needing repair. The rail/footer surface `missing` live; this just logs at boot.
async function reconcileWorktrees(db: AppDatabase) {
  try {
    const missing = (await computeWorkspaceStatuses(db)).filter((s) => s.missing)
    if (missing.length) console.warn(`[worktrees] ${missing.length} workspace worktree(s) missing on disk (needs repair): ${missing.map((m) => m.worktreePath).join(', ')}`)
  } catch {
    // best-effort — never block startup on status
  }
}

// Repo / branch / PR context for a session, derived through the workspaceId → workspaces join
// (docs/workspaces 03). The session row no longer denormalizes repo/pull; this is the single read.
function workspaceContext(ws: typeof schema.workspaces.$inferSelect | undefined): Pick<TerminalSession, 'repo' | 'pull'> {
  if (!ws) return {}
  return {
    repo: { owner: ws.repoOwner, name: ws.repoName },
    pull: ws.pullNumber != null ? { number: ws.pullNumber } : undefined,
  }
}

// Lazy worktree on first terminal (Flow C, docs/workspaces 05). Reuse the workspace's worktree if
// it's set and still on disk; otherwise create one from the base checkout, keyed by branch, and
// persist worktreePath on the workspace. Returns the cwd + whether it's an isolated worktree. On
// any failure (no checkout mapped, git error) it degrades to the base checkout so the terminal
// still opens — the workspace just doesn't gain isolation until the next try.
// ponytail: graceful fallback over a hard error; the dirty/teardown guards still key off worktreePath.
async function resolveWorkspaceCwd(
  db: AppDatabase,
  ws: typeof schema.workspaces.$inferSelect | undefined,
  baseCheckout: string | undefined,
): Promise<{ cwd: string; isWorktree: boolean }> {
  if (ws?.worktreePath && isDir(ws.worktreePath)) return { cwd: ws.worktreePath, isWorktree: true }
  if (!ws || !baseCheckout || !isDir(baseCheckout)) return { cwd: baseCheckout && isDir(baseCheckout) ? baseCheckout : homedir(), isWorktree: false }
  const wt = await ensureWorktree(worktreesRoot, baseCheckout, ws.repoOwner, ws.repoName, ws.branch, ws.pullNumber)
  if (!wt.ok) return { cwd: baseCheckout, isWorktree: false }
  await db.update(schema.workspaces).set({ worktreePath: wt.path, updatedAt: Date.now() }).where(eq(schema.workspaces.id, ws.id))
  return { cwd: wt.path, isWorktree: true }
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
    isWorktree: false, // not persisted; a reconciled session loses its worktree-cleanup affordance
    workspaceId: row.workspaceId,
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
      broadcastStatus()
    }
    appendRing(s, data)
    emit(s, { type: 'output', data })
  })
  pty.onExit(({ exitCode, signal }) => {
    s.meta.status = 'exited'
    s.meta.idle = false
    s.meta.exitCode = exitCode
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
        notifyIdle(s.meta)
        broadcastStatus()
      }
    }
  }, 3000)
}

async function create(db: AppDatabase, opts: CreateOpts): Promise<TerminalSession> {
  const profile = getProfile(opts.profileId)
  // Dev-server pane (docs/workspaces P5): a command override runs via the user's shell with env
  // (PORT) merged in; otherwise the profile's binary. resolveCommand stays the path for shells/agents.
  const command = opts.command?.trim() || resolveCommand(profile)
  const env = opts.env ? { ...childEnv(), ...opts.env } : childEnv()
  const backend = resolveBackend(profile.backendPreference, tmuxAvailable())
  // The renderer passes the base checkout as opts.cwd (validated at the boundary); the worktree is
  // derived from it. Lazy worktree on first terminal, reused after (docs/workspaces Flow C).
  const baseCheckout = opts.cwd && isAbsolute(opts.cwd) && isDir(opts.cwd) ? opts.cwd : undefined
  const ws = await loadWorkspace(db, opts.workspaceId)
  const ctx = workspaceContext(ws)
  const { cwd, isWorktree } = await resolveWorkspaceCwd(db, ws, baseCheckout)
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
    isWorktree,
    workspaceId: opts.workspaceId,
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
      const meta = rowToMeta(row, workspaceContext(await loadWorkspace(db, row.workspaceId)))
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
  ipcMain.handle('term:list', () => [...sessions.values()].map((s) => s.meta))

  ipcMain.handle('term:profiles', () => listProfiles())

  ipcMain.handle('term:create', (_e: IpcMainInvokeEvent, opts: CreateOpts) => create(db, opts ?? {}))

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

  // Archive a workspace with the lifecycle guard (docs/workspaces 05): the ONLY path allowed to
  // tear a worktree down, and never automatic. Refuse while sessions run or the worktree is dirty;
  // otherwise remove the worktree and mark the row archived (kept for history). Worktree removal +
  // the running-session check both need main (git + the in-memory session map), so this is IPC, not
  // an HTTP route.
  ipcMain.handle('term:workspace:statuses', () => computeWorkspaceStatuses(db))

  ipcMain.handle('term:workspace:archive', async (_e: IpcMainInvokeEvent, id: string): Promise<ArchiveResult> => {
    if (typeof id !== 'string' || !id) return { ok: false, reason: 'Invalid workspace.' }
    const running = [...sessions.values()].filter((s) => s.meta.workspaceId === id && s.meta.status === 'running')
    if (running.length) return { ok: false, reason: `Stop ${running.length} running session${running.length > 1 ? 's' : ''} first.` }
    const ws = await loadWorkspace(db, id)
    if (!ws) return { ok: false, reason: 'Workspace not found.' }
    if (ws.worktreePath) {
      const mapped = await getRepoPath(db, ws.repoOwner, ws.repoName)
      if (mapped) {
        const res = await removeWorktree(mapped.path, ws.worktreePath, false) // refuses a dirty tree
        if (!res.ok) return res
      }
      // No mapped checkout → can't git-remove; we still archive and drop the (now-orphaned) reference.
    }
    // Drop any lingering exited sessions for this workspace so their rows don't outlive it.
    for (const [sid, s] of sessions) {
      if (s.meta.workspaceId === id) {
        sessions.delete(sid)
        if (s.meta.backend === 'tmux') await deleteRow(db, sid)
      }
    }
    await db
      .update(schema.workspaces)
      .set({ status: 'archived', archivedAt: Date.now(), worktreePath: null, updatedAt: Date.now() })
      .where(eq(schema.workspaces.id, id))
    return { ok: true }
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
