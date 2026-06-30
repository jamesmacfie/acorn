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
import type { CreateOpts, ServerMsg, TerminalSession } from '../shared/terminal'
import {
  childEnv,
  clampDim,
  computeIdle,
  isContainedPath,
  isValidRepoIdent,
  parseTmuxSessions,
  resolveBackend,
  tmuxAttachArgs,
  tmuxName,
  tmuxNewSessionArgs,
  trimRing,
} from './terminalUtils'
import { getProfile, listProfiles, resolveCommand, tmuxAvailable } from './profiles'
import { getRepoPath, setRepoPath } from './repoPaths'
import { ensureWorktree, removeWorktree } from './worktrees'

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

function ensureTmuxSession(name: string, cwd: string, command: string) {
  execFileSync('tmux', tmuxNewSessionArgs(name, cwd, command), { env: childEnv(), stdio: 'ignore' })
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
    repoOwner: m.repo?.owner ?? null,
    repoName: m.repo?.name ?? null,
    pullNumber: m.pull?.number ?? null,
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

function rowToMeta(row: typeof schema.terminalSessions.$inferSelect): TerminalSession {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind as TerminalSession['kind'],
    profileId: row.profileId,
    backend: row.backend as TerminalSession['backend'],
    status: 'running', // only called for sessions whose tmux is alive
    idle: false,
    isWorktree: false, // not persisted; a reconciled session loses its worktree-cleanup affordance
    cwd: row.cwd,
    command: row.command,
    tmuxSession: row.tmuxSession ?? undefined,
    repo: row.repoOwner && row.repoName ? { owner: row.repoOwner, name: row.repoName } : undefined,
    pull: row.pullNumber != null ? { number: row.pullNumber } : undefined,
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
  const command = resolveCommand(profile)
  const backend = resolveBackend(profile.backendPreference, tmuxAvailable())
  // Validate at the boundary: cwd must be an existing absolute dir, else fall back to $HOME.
  const cwd = opts.cwd && isAbsolute(opts.cwd) && isDir(opts.cwd) ? opts.cwd : homedir()
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
    isWorktree: !!opts.isWorktree,
    cwd,
    command,
    tmuxSession: backend === 'tmux' ? tmuxName(id) : undefined,
    repo: opts.repo,
    pull: opts.pull,
    cols,
    rows,
    createdAt: Date.now(),
    exitCode: null,
  }

  let pty: IPty
  if (backend === 'tmux') {
    ensureTmuxSession(meta.tmuxSession!, cwd, command)
    pty = attachTmuxPty(meta.tmuxSession!, cols, rows)
    await persistSession(db, meta)
  } else {
    pty = spawn(command, [], { name: 'xterm-256color', cols, rows, cwd, env: childEnv() })
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
      const meta = rowToMeta(row)
      wireSession(db, meta, attachTmuxPty(row.tmuxSession, row.cols, row.rows))
    } else {
      await deleteRow(db, row.id)
    }
  }
}

// Registered once at app start. Every payload is validated here — the renderer is the less-trusted
// side (vNext §5, §11). Exited sessions linger until explicitly removed (term:remove).
export async function registerTerminalIpc(db: AppDatabase, worktreesDir: string) {
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

  // Worktrees resolve the checkout from repo_paths in main — the renderer only names the PR.
  // Validate identifiers before they touch the filesystem (path-traversal guard, vNext §11).
  ipcMain.handle('term:worktree:ensure', async (_e: IpcMainInvokeEvent, p: { owner: string; repo: string; number: number }) => {
    if (!isValidRepoIdent(p?.owner) || !isValidRepoIdent(p?.repo) || !Number.isInteger(p?.number) || p.number <= 0) {
      return { ok: false, reason: 'Invalid repo identifiers.' }
    }
    const mapped = await getRepoPath(db, p.owner, p.repo)
    if (!mapped) return { ok: false, reason: 'No local checkout mapped for this repo.' }
    return ensureWorktree(worktreesDir, mapped.path, p.owner, p.repo, p.number)
  })

  ipcMain.handle('term:worktree:remove', async (_e: IpcMainInvokeEvent, p: { owner: string; repo: string; path: string; force?: boolean }) => {
    if (!isValidRepoIdent(p?.owner) || !isValidRepoIdent(p?.repo)) return { ok: false, reason: 'Invalid repo identifiers.' }
    // The path is renderer-supplied: only ever remove something inside our worktrees dir.
    if (typeof p.path !== 'string' || !isContainedPath(worktreesDir, p.path)) {
      return { ok: false, reason: 'Refusing to remove a path outside the worktrees directory.' }
    }
    const mapped = await getRepoPath(db, p.owner, p.repo)
    if (!mapped) return { ok: false, reason: 'No local checkout mapped for this repo.' }
    return removeWorktree(mapped.path, p.path, !!p.force)
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
  startIdleWatch()
}
