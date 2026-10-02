import { spawn, type IPty } from 'node-pty'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { homedir } from 'node:os'
import { eq } from 'drizzle-orm'
import { acornMcp, buildSessionEnv, childEnv, type CoreServices, createLogger, describeError, getProfile, type InternalEnvFactory, interactiveProfile, invalidateWorktreeStatus, launcherSpec, listProfileDefs, listProfiles, type CompiledPluginBroadcast, type PluginDatabase, rendererBaseCheckout, resolveCommand, resolveMcpEntry, serverName, taskContext, type TaskCreatedHook, type TaskRef, type TaskSessionsBridge, TEARDOWN_TIMEOUT_MS, tmuxAvailable } from '@acorn/plugin-api/node'
import { terminalSessions } from '../node/schema'
import type { TerminalBridge } from './routes/terminal'
import type { CreateOpts, ServerMsg, TerminalSession } from '@acorn/plugin-terminal/contract/wire.ts'
import type { SendSubmit } from '../shared/send'
import { AgentSender, type SendableSession } from './agentSend'
import {
  clampDim,
  computeIdle,
  FIRST_IDLE_MS,
  IDLE_MS,
  launchCommandLine,
  matchBlockedPrompt,
  parseTmuxSessions,
  resolveBackend,
  tmuxAttachArgs,
  tmuxName,
  tmuxNewSessionArgs,
  OutputRing,
} from './terminalUtils'
import { fileURLToPath } from 'node:url'
import type { RunSessionGlue } from './runChannel'
import { TerminalDisplay } from './terminalDisplay'
import type { TerminalCompletedEvent } from '../contract/lifecycle'

// This plugin's own logger. A module-level engine with no `ctx` in reach, so the id is stated here
// rather than bound by the host (docs/plugin-authoring.md § Telemetry and logging).
const log = createLogger('terminal', 'terminal')

// PTYs live in the node utility service. Sessions run on one of two backends:
//  - node-pty: spawn the command directly. Survives a window reload, since the PTY is in the service,
//    but not an app restart. In-memory only.
//  - tmux: a detached `tmux` session drives the command and a PTY attaches to it. Survives an app
//    restart, because the tmux daemon is separate, and can be attached from a real terminal. Persisted
//    to SQLite so startup can reconcile rows against `tmux list-sessions` and re-attach survivors.
//
// Terminal output is never persisted (docs/terminal-and-agents.md).
//
// This module is the session engine. HTTP bridges and WebSocket handlers are installed at the bottom;
// plugin contributions and capabilities supply launch context and review snapshots.

type Session = {
  meta: TerminalSession
  pty: IPty
  ring: OutputRing
  display: TerminalDisplay
  lastActivityAt: number
  sawIdle: boolean // has this session ever gone idle? the first idle uses a shorter window (FIRST_IDLE_MS)
  // PTY output coalescing (docs/terminal-and-agents.md § Sessions).
  pendingOut: string
  flushTimer: ReturnType<typeof setTimeout> | null
  callbacks: { dispose(): void }[]
  settlers: Set<(exitCode: number | null) => void>
  retired: boolean
  admitted: boolean
  persisted: boolean
  discardRow: boolean
}

// About one frame at 60 fps, the coalescing target (docs/terminal-and-agents.md § Sessions).
const OUTPUT_COALESCE_MS = 16

const sessions = new Map<string, Session>()

// What this engine needs from core, now that it can't read core's tables: resolve a taskId to a row and
// to the cwd its commands run in, and read the project's setup script. `proc` and
// `projects.assertConfigTrusted` are for the run-target service built over this engine (runChannel.ts).
export type TerminalCoreServices = Pick<CoreServices, 'tasks' | 'projects' | 'proc' | 'git'>

// This engine is a process singleton by construction (one PTY table, one idle watch, one session map
// per node), so its database handle and core services live in module state rather than being threaded
// through fourteen signatures. init() installs them and dispose() removes them, so a second
// startServiceRuntime in one process replaces the first boot's handle instead of stacking a second
// engine beside it.
//
// Asynchronous work captures its boot token, database, and core services. Retirement removes PTY
// listeners and fences late callbacks. A started database operation retains the original handle,
// and its failure cannot redirect a write into a replacement boot.
let store: PluginDatabase | null = null
let core: TerminalCoreServices | null = null

// Every caller runs inside a request, a spawn or a reconcile, all strictly after init, so an absent
// value here is a programming error rather than a degraded mode. The HTTP surface's degraded mode is
// the unfilled bridge slot answering 503.
function services(): TerminalCoreServices {
  if (!core) throw new Error('The terminal engine has not been initialized.')
  return core
}

// sendToAgent (docs/terminal-and-agents.md § Sending text to an agent), with 'after-ready' queued
// on the idle edge below. One instance over the live session map.
const sendableSessions = new WeakMap<Session, SendableSession>()
const agentSender = new AgentSender((id) => {
  const s = sessions.get(id)
  if (!s?.admitted || s.retired) return null
  let facade = sendableSessions.get(s)
  if (!facade) {
    const live = () => !s.retired && s.admitted && sessions.get(id) === s && s.meta.status === 'running'
    facade = { write: data => { if (live()) s.pty.write(data) }, running: live, idle: () => s.meta.idle }
    sendableSessions.set(s, facade)
  }
  return facade
})

export function sendToAgent(sessionId: string, text: string, submit: SendSubmit): void {
  void agentSender.send(sessionId, text, submit)
}

// Spawn and enumerate, published by this plugin's init as the `terminal.sessions` capability
// (contract/sessions.ts). A two-method object rather than a reach into the TerminalBridge, because
// the bridge is the route layer's dependency: it gets nulled on dispose, and a capability consumer
// resolving it would be reading this plugin's HTTP wiring.
//
// Its one consumer is plugins/agents' terminal handoff, the only cross-plugin caller that needs to
// start a PTY. It shares the bridge's list and create implementations, and not the other six.
//
// Named `sessionControl`, not `terminalSessions`, because that name is already the Drizzle table
// this module imports, and shadowing it would silently rebind every query below.
export const sessionControl = {
  create: (opts: CreateOpts): Promise<TerminalSession> => create(opts),
  list: async (): Promise<TerminalSession[]> => [...sessions.values()].filter(s => s.admitted && !s.retired).map((s) => s.meta),
}

let launchContextText: ((taskId: string) => Promise<string | null>) | null = null
let launchContext: ((taskId: string, sessionId: string) => Promise<void>) | null = null
let completed: ((event: TerminalCompletedEvent) => void) | null = null
let seedNotes: ((task: TaskRef) => Promise<void>) | null = null
let internalEnv: InternalEnvFactory = () => ({})
let statusBroadcast: () => void = () => {}
let worktreeBroadcast: (taskId: string) => void = () => {}
const runSessionExitListeners = new Set<(sessionId: string, exitCode: number | null) => void>()

type EngineOwner = {
  token: object
  db: PluginDatabase
  core: TerminalCoreServices
  env: InternalEnvFactory
  status: () => void
  worktree: (taskId: string) => void
  launchText: ((taskId: string) => Promise<string | null>) | null
  launch: ((taskId: string, sessionId: string) => Promise<void>) | null
  complete: ((event: TerminalCompletedEvent) => void) | null
  seed: ((task: TaskRef) => Promise<void>) | null
}
let engineToken: object | null = null
function owner(): EngineOwner {
  if (!engineToken || !store) throw new Error('The terminal engine has not been initialized.')
  return { token: engineToken, db: store, core: services(), env: internalEnv,
    status: statusBroadcast, worktree: worktreeBroadcast, launch: launchContext, launchText: launchContextText, complete: completed, seed: seedNotes }
}
function assertOwner(engine: EngineOwner): void {
  if (engine.token !== engineToken) throw new Error('The terminal engine has been disposed.')
}
function drain(actions: (() => void)[]): void {
  for (const action of actions) {
    try { action() } catch (error) {
      try { log.warn(`terminal cleanup failed: ${describeError(error).message}`) } catch { /* Continue releasing owned resources. */ }
    }
  }
}
function releaseCallbacks(s: Session): void {
  if (s.flushTimer) clearTimeout(s.flushTimer)
  s.flushTimer = null
  drain(s.callbacks.splice(0).map(callback => () => callback.dispose()))
}
function settleSession(s: Session, exitCode: number | null): void {
  const settlers = [...s.settlers]
  s.settlers.clear()
  drain(settlers.map(settle => () => settle(exitCode)))
}
// Retirement closes this Node's attachment. Explicit Stop/remove separately destroys tmux state.
function retireSession(s: Session): void {
  if (s.retired) return
  s.retired = true
  releaseCallbacks(s)
  s.pendingOut = ''
  drain([() => settleSession(s, null), () => s.display.dispose(), () => agentSender.clear(s.meta.id),
    () => { if (s.meta.status === 'running') s.pty.kill() }])
}

// A session's command went quiet, exited, or finished setting up. Whatever it was doing to the files in
// its worktree, it has stopped doing it, so drop the coalesced `git status` for that directory and tell
// every client to re-read the dirty markers. This is what keeps a `git commit` typed into a terminal
// showing up immediately without a filesystem watcher
// (docs/workspaces-and-tasks.md § Worktree status reads).
function worktreeSettled(s: Session): void {
  invalidateWorktreeStatus(s.meta.cwd)
  worktreeBroadcast(s.meta.taskId)
}

// PTY-tier AgentState (docs/terminal-and-agents.md): shells stay 'unknown'; agents flip between working
// and idle with the silence detector, and 'blocked' lands with the prompt-pattern scan.
const ptyState = (kind: 'shell' | 'agent', status: 'running' | 'exited', idle: boolean): TerminalSession['agentState'] =>
  kind !== 'agent' ? 'unknown' : status !== 'running' ? 'done' : idle ? 'idle' : 'working'

// Flush any coalesced PTY output as one 'output' frame. Called on the ~16ms tick, and eagerly before any
// non-output frame or a new attachment snapshot, so ordering stays exact.
function flushOutput(s: Session) {
  if (s.flushTimer) {
    clearTimeout(s.flushTimer)
    s.flushTimer = null
  }
  if (s.retired || !s.pendingOut) return
  const data = s.pendingOut
  s.pendingOut = ''
  s.display.publish({ type: 'output', data })
}

// The PTY and the display emulator always share one size, so a snapshot and the program's own
// redraws agree on the width. The size comes from the client, so it is clamped.
function resizeSession(s: Session, cols: unknown, rows: unknown) {
  const c = clampDim(cols, s.meta.cols)
  const r = clampDim(rows, s.meta.rows)
  s.meta.cols = c
  s.meta.rows = r
  s.display.resize(c, r)
  if (s.meta.status === 'running') s.pty.resize(c, r)
}

// Non-output frames flush pending output first: exit must not overtake buffered bytes.
function emit(s: Session, msg: ServerMsg) {
  flushOutput(s)
  s.display.publish(msg)
}

// Buffer PTY output. The raw ring feeds transcript-tail analysis and, since phase 6 of the
// performance programme, rebuilds the display emulator whenever a client attaches; the live wire frame
// is coalesced onto the next tick.
function queueOutput(s: Session, data: string) {
  s.ring.push(data)
  s.display.write(data) // a no-op unless an attach is restoring: there is no emulator to feed
  s.pendingOut += data
  if (!s.flushTimer) s.flushTimer = setTimeout(() => flushOutput(s), OUTPUT_COALESCE_MS)
}

// --- tmux process plumbing. execFileSync with arg arrays, so no shell: the command is a fixed profile
// binary, the cwd is validated, and the name is acorn-<uuid>. ---

function ensureTmuxSession(name: string, cwd: string, command: string, env: Record<string, string>) {
  // tmux runs the command argument through the user's shell, so a full "pnpm dev" line works, and env
  // such as PORT is inherited by that shell (docs/workspaces-and-tasks.md).
  execFileSync('tmux', tmuxNewSessionArgs(name, cwd, command, env), { env, stdio: 'ignore' })
  execFileSync('tmux', ['set-option', '-t', name, 'status', 'off'], { env, stdio: 'ignore' })
}

function attachTmuxPty(name: string, cols: number, rows: number): IPty {
  return spawn('tmux', tmuxAttachArgs(name), { name: 'xterm-256color', cols, rows, cwd: homedir(), env: childEnv() })
}

function killTmuxSession(name: string) {
  try {
    execFileSync('tmux', ['kill-session', '-t', name], { env: childEnv(), stdio: 'ignore' })
  } catch {
    // Already gone.
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

// --- SQLite persistence, tmux-backed sessions only ---
//
// This plugin's own database (<data-root>/plugins/terminal.sqlite), not core's. Every helper tolerates
// an absent store: the write path is only reachable after init, but the exit path is driven by a live
// PTY and can fire at any moment, including after teardown has nulled the handle.

async function persistSession(m: TerminalSession, db: PluginDatabase) {
  await db.insert(terminalSessions).values({
    id: m.id,
    title: m.title,
    kind: m.kind,
    profileId: m.profileId,
    backend: m.backend,
    status: m.status,
    cwd: m.cwd,
    taskId: m.taskId,
    agentSessionId: m.agentSessionId ?? null,
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

// Called with `void` from the PTY's exit handler, so it must not be able to produce an unhandled
// rejection: a session that exits during teardown races the store being closed under it, and the row it
// wanted to update is about to be irrelevant either way.
async function markExited(id: string, exitCode: number | null, db: PluginDatabase) {
  try {
    await db
      .update(terminalSessions)
      .set({ status: 'exited', exitCode, exitedAt: Date.now() })
      .where(eq(terminalSessions.id, id))
  } catch (error) {
    drain([() => log.warn(`could not record the exit of session ${id}: ${describeError(error).message}`)])
  }
}

const deleteRow = async (id: string, db: PluginDatabase): Promise<void> => {
  await db.delete(terminalSessions).where(eq(terminalSessions.id, id))
}

function rowToMeta(row: typeof terminalSessions.$inferSelect, ctx: Pick<TerminalSession, 'repo' | 'pull'>, isWorktree: boolean): TerminalSession {
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
    agentSessionId: row.agentSessionId ?? undefined,
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

function wireSession(meta: TerminalSession, pty: IPty, engine: EngineOwner): Session {
  assertOwner(engine)
  const s: Session = {
    meta,
    pty,
    ring: new OutputRing(),
    display: new TerminalDisplay(meta.cols, meta.rows),
    lastActivityAt: Date.now(),
    sawIdle: false,
    pendingOut: '',
    flushTimer: null,
    callbacks: [], settlers: new Set(), retired: false, admitted: false, persisted: false, discardRow: false,
  }
  sessions.set(meta.id, s)
  try {
    s.callbacks.push(pty.onData((data) => {
      if (s.retired || engine.token !== engineToken || sessions.get(meta.id) !== s) return
      s.lastActivityAt = Date.now()
      if (s.meta.idle) {
        s.meta.idle = false // output resumed → no longer waiting
        s.meta.agentState = ptyState(s.meta.kind, s.meta.status, false)
        if (s.admitted) drain([() => engine.status()])
      }
      queueOutput(s, data) // append to ring now; coalesce the wire frame onto the ~16ms tick
    }))
    s.callbacks.push(pty.onExit(({ exitCode, signal }) => {
      // A PTY from a disposed engine may exit after the next boot has installed a new store.
      if (s.retired || engine.token !== engineToken || sessions.get(s.meta.id) !== s) return
      s.meta.status = 'exited'
      s.meta.idle = false
      s.meta.agentState = ptyState(s.meta.kind, 'exited', false)
      s.meta.exitCode = exitCode
      drain([
        () => agentSender.clear(s.meta.id),
        () => emit(s, { type: 'exit', exitCode, signal: signal != null ? String(signal) : null }),
        () => { if (s.persisted && s.meta.backend === 'tmux') void markExited(s.meta.id, exitCode, engine.db) },
        () => worktreeSettled(s),
        ...[...runSessionExitListeners].map(listener => () => listener(s.meta.id, exitCode)),
        () => {
          if (s.meta.kind !== 'agent' || s.meta.title === 'Teardown') return
          const event = { taskId: s.meta.taskId, sessionId: s.meta.id, exitCode, completedAt: Date.now() }
          engine.complete?.(event)
        },
        () => settleSession(s, exitCode),
        () => releaseCallbacks(s),
        () => { if (s.admitted) engine.status() },
      ])
    }))
  } catch (error) {
    if (sessions.get(meta.id) === s) sessions.delete(meta.id)
    s.retired = true
    releaseCallbacks(s)
    drain([() => s.display.dispose(), () => settleSession(s, null)])
    throw error
  }
  return s
}

let idleWatch: ReturnType<typeof setInterval> | null = null
function startIdleWatch() {
  if (idleWatch) return // registered once; a second boot must not stack a second timer
  const timer = setInterval(() => {
    const now = Date.now()
    for (const s of sessions.values()) {
      if (!s.admitted || s.retired) continue
      if (computeIdle(s.meta.kind, s.meta.status, s.lastActivityAt, now, s.sawIdle ? IDLE_MS : FIRST_IDLE_MS) && !s.meta.idle) {
        s.meta.idle = true
        s.sawIdle = true
        // An idle session showing an input prompt in its tail is blocked, not done.
        s.meta.agentState = matchBlockedPrompt(s.ring.tail(4000)) ? 'blocked' : 'idle'
        agentSender.onIdle(s.meta.id) // flush 'after-ready' sends on the busy→idle edge (04 §D)
        // The OS toast lives in the client now, focus-gated with cooldown and dedup there.
        statusBroadcast()
        worktreeSettled(s)
      }
    }
  }, 3000)
  // unref'd because nothing should be kept alive by this timer: the node is held open by its HTTPS
  // listener, and a test that initializes the plugin without tearing it down would otherwise hang vitest
  // three seconds at a time, forever.
  timer.unref?.()
  idleWatch = timer
}

// Run the workspace setup script as a "Setup" session in the freshly-created worktree, unless it's blank
// or disabled. Registered as the taskWorktree onWorktreeCreated hook, so it fires exactly once whichever
// path creates the worktree. Ordered before any requested session, so a setup spawned from create() is
// tab #1.
async function maybeRunSetup(t: TaskRef, cwd: string, engine: EngineOwner): Promise<void> {
  assertOwner(engine)
  if (!t.projectId || t.skipSetup) return
  const { script, trigger } = await engine.core.projects.setup(t.projectId)
  assertOwner(engine)
  if (trigger === 'off' || !script?.trim()) return
  await spawnOne({ taskId: t.id, command: script, title: 'Setup' }, cwd, true, taskContext(t), t, engine)
  assertOwner(engine)
  // Roster publication belongs to spawnOne.
  invalidateWorktreeStatus(cwd)
  engine.worktree(t.id) // a setup script installs dependencies, which is a dirty worktree
}

async function create(opts: CreateOpts, engine = owner()): Promise<TerminalSession> {
  assertOwner(engine)
  // The client passes the base checkout as opts.cwd, validated at the boundary, and the worktree is
  // derived from it. Lazy worktree on first terminal, reused after. A first-ever worktree fires the
  // onWorktreeCreated hook inside resolveTaskCwd, which runs maybeRunSetup.
  const baseCheckout = rendererBaseCheckout(opts.cwd)
  const t = await engine.core.tasks.load(opts.taskId)
  assertOwner(engine)
  const { cwd, isWorktree } = await engine.core.tasks.resolveCwd(t, baseCheckout)
  assertOwner(engine)
  return spawnOne(opts, cwd, isWorktree, taskContext(t), t, engine)
}

// Build the session meta, spawn the PTY (tmux or node-pty) in the already-resolved cwd, and wire it.
async function spawnOne(
  opts: CreateOpts,
  cwd: string,
  isWorktree: boolean,
  ctx: Pick<TerminalSession, 'repo' | 'pull'>,
  task?: TaskRef,
  engine = owner(),
): Promise<TerminalSession> {
  assertOwner(engine)
  const profile = getProfile(opts.profileId)
  // The profile menu never offers one of these, but the route takes an id, and a caller that names a
  // generate-only profile would get a PTY that exits on its own usage error. A command override is the
  // exception: it runs its own program through a shell, so the profile's own binary never runs.
  if (!interactiveProfile(profile) && !opts.command?.trim()) {
    throw new Error(`The ${profile.label} agent has no interactive mode.`)
  }
  // Dev-server pane: a command override runs via the user's shell with env merged in; otherwise the
  // profile's binary. resolveCommand stays the path for shells and agents.
  const command = opts.command?.trim() || resolveCommand(profile)
  const id = randomUUID()
  const project = task?.projectId ? await engine.core.projects.byId(task.projectId) : null
  assertOwner(engine)
  // Every task-scoped session carries the ACORN_* identity vars, including the session id, which MCP
  // notes and memory writes use for `author: agent` provenance (docs/notes-and-memory.md).
  const env = buildSessionEnv({
    taskId: opts.taskId,
    cwd,
    task: task && project
      ? { projectId: project.id, projectName: project.name, github: project.github, branch: task.branch, title: task.title }
      : null,
    env: { ...engine.env({ scope: 'task', taskId: opts.taskId, sessionId: id }), ACORN_SESSION_ID: id, ...opts.env },
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
    agentSessionId: opts.agentSessionId,
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

  if (profile.mcpRegistration && !mcpRegistered.has(profile.id)) {
    void profile.mcpRegistration(mcpName(), mcpLauncher()).then((res) => { if (res?.ok) mcpRegistered.add(profile.id) }).catch(() => undefined)
  }

  // Profile launchArgs apply only to the profile's own binary; a command override is a different
  // program. meta.command stays the bare line the UI shows, and the args are launch-only.
  const context = !opts.command && profile.launchContextArgs ? await engine.launchText?.(opts.taskId) ?? null : null
  assertOwner(engine)
  const launchArgs = opts.command ? [] : profile.launchContextArgs ? profile.launchContextArgs(context) : (profile.launchArgs ?? [])

  let pty: IPty | undefined
  let session: Session | undefined
  let durableAttempted = false
  let durableAdmitted = false
  let persistAttempted = false
  try {
    if (backend === 'tmux') {
      durableAttempted = true
      ensureTmuxSession(meta.tmuxSession!, cwd, launchCommandLine(command, launchArgs), env)
      pty = attachTmuxPty(meta.tmuxSession!, cols, rows)
    } else if (opts.command) {
      pty = spawn(env.SHELL || '/bin/sh', ['-lc', command], { name: 'xterm-256color', cols, rows, cwd, env })
    } else {
      pty = spawn(command, launchArgs, { name: 'xterm-256color', cols, rows, cwd, env })
    }
    assertOwner(engine)
    session = wireSession(meta, pty, engine)
    if (backend === 'tmux') {
      persistAttempted = true
      await persistSession(meta, engine.db)
      durableAdmitted = true
      session.persisted = true
      if (session.meta.status === 'exited') await markExited(meta.id, session.meta.exitCode, engine.db)
    }
    if (session.discardRow && backend === 'tmux') await deleteRow(meta.id, engine.db)
    assertOwner(engine)
    if (session.retired) throw new Error('The terminal session has been retired.')
    session.admitted = true
    drain([() => engine.status()])
  } catch (error) {
    if (session) {
      if (sessions.get(meta.id) === session) sessions.delete(meta.id)
      retireSession(session)
    } else if (pty) drain([() => pty!.kill()])
    // A failed fresh admission has no returned identity or row to reconcile. Roll back only its UUID
    // tmux session. A successful insert followed by boot retirement preserves its durable work.
    if (durableAttempted && !durableAdmitted) {
      let absent = !persistAttempted
      if (persistAttempted) {
        try {
          const rows = await engine.db.select().from(terminalSessions).where(eq(terminalSessions.id, meta.id)).limit(1)
          absent = rows.length === 0
        } catch { /* A closed database cannot establish whether the insert committed. */ }
      }
      if (absent) drain([() => killTmuxSession(meta.tmuxSession!)])
      else drain([() => log.warn(`preserved tmux session ${meta.tmuxSession} after unconfirmed metadata admission`)])
    }
    throw error
  }
  // Profiles without a system-prompt seam receive launch context on their idle edge.
  // An explicit command or profile launch instruction owns its delivery instead.
  if (profile.kind === 'agent' && !opts.command && !profile.launchContextArgs && !launchArgs.length) {
    void engine.launch?.(opts.taskId, id).catch((error: unknown) =>
      log.warn(`launch context for session ${id} failed: ${describeError(error).message}`))
  }
  return meta
}

// Profiles whose MCP registration succeeded this app run, so spawnOne can skip the CLI round trip.
const mcpRegistered = new Set<string>()

// The acorn MCP server launcher and build-flavoured name. Whether and how a CLI registers it is declared
// by that profile contribution rather than a second profile-id lookup table.
// The fallback name is the packaged one: a plain Node process has no build flavour of its own, and the
// composition root sets the real one through configureAcornMcp before any session spawns.
const mcpName = () => acornMcp()?.name ?? serverName(true)
const mcpLauncher = () => acornMcp()?.launcher ?? launcherSpec(process.execPath, resolveMcpEntry(dirname(fileURLToPath(import.meta.url))), mcpName())

// Boot-time MCP re-registration (docs/mcp.md § Configuration). Session spawn already re-registers;
// this covers restored and tmux-reattached sessions, which never respawn. Idempotent (remove then
// add), failures swallowed.
export async function refreshAcornMcpRegistrations(): Promise<void> {
  const name = mcpName()
  const launcher = mcpLauncher()
  await Promise.all(
    listProfileDefs()
      .filter((p) => p.mcpRegistration)
      .map((p) =>
        p.mcpRegistration!(name, launcher)
          .then((res) => {
            if (res.ok) mcpRegistered.add(p.id)
          })
          .catch(() => undefined),
      ),
  )
}

// Killing a tmux session's attach PTY only detaches it and the session keeps running. Stopping a tmux
// agent means killing the tmux session itself, which then EOFs the PTY and fires onExit.
function killSession(s: Session) {
  if (s.meta.backend === 'tmux' && s.meta.tmuxSession) killTmuxSession(s.meta.tmuxSession)
  s.pty.kill()
}

// On startup, re-attach tmux sessions that are still alive and drop DB rows whose tmux is gone. Run by
// the composition root's reconcile() step, off the paint-critical path.
export async function reconcileTmux() {
  if (!store) return
  const engine = owner()
  let rows: (typeof terminalSessions.$inferSelect)[]
  try {
    rows = await engine.db.select().from(terminalSessions)
    assertOwner(engine)
  } catch {
    return
  }
  if (!rows.length) return
  const alive = tmuxAvailable() ? listTmuxSessions() : new Set<string>()
  let reattached = 0
  for (const row of rows) {
    if (engine.token !== engineToken) return
    // Per-row guard: one corrupt row or failed attach must not abort the remaining rows, or the rest of
    // the reconcile pass.
    try {
      if (row.backend === 'tmux' && row.tmuxSession && alive.has(row.tmuxSession)) {
        const task = await engine.core.tasks.load(row.taskId)
        assertOwner(engine)
        // isWorktree is derived, not persisted: tasks.worktreePath is the truth, so recompute it here and
        // a session that survives an app restart keeps its worktree affordance.
        const isWorktree = !!task?.worktreePath && resolve(row.cwd) === resolve(task.worktreePath)
        const pty = attachTmuxPty(row.tmuxSession, row.cols, row.rows)
        let session: Session
        try { session = wireSession(rowToMeta(row, taskContext(task), isWorktree), pty, engine) }
        catch (error) { drain([() => pty.kill()]); throw error }
        session.admitted = true
        session.persisted = true
        reattached++
      } else {
        await deleteRow(row.id, engine.db)
      }
    } catch (e) {
      drain([() => log.warn(`tmux reconcile failed for session ${row.id}: ${describeError(e).message}`)])
    }
  }
  // This runs after the window, so the client's initial term:list has already fired. Ping it to
  // re-list, or resurrected sessions stay invisible until some unrelated broadcast.
  if (reattached && engine.token === engineToken) engine.status()
}

// The session-engine glue the run-target service (runChannel) needs: spawn a target's command as a terminal
// session in the task worktree, and observe or kill it. Exported so the plugin's init can build the
// RuntimeService without this engine importing the run domain.
export function terminalRunGlue(): RunSessionGlue {
  const engine = owner()
  return {
    startSession: async (taskId: string, target: { id: string; command: string }, cwd: string) => {
      assertOwner(engine)
      const t = await engine.core.tasks.load(taskId)
      assertOwner(engine)
      const meta = await spawnOne({ taskId, command: target.command, title: `▶ ${target.id}` }, cwd, true, taskContext(t), t, engine)
      return meta.id
    },
    isRunning: (sessionId: string) => engine.token === engineToken && sessions.get(sessionId)?.admitted === true && !sessions.get(sessionId)!.retired && sessions.get(sessionId)?.meta.status === 'running',
    onExit: (listener) => {
      assertOwner(engine)
      runSessionExitListeners.add(listener)
      return () => runSessionExitListeners.delete(listener)
    },
    retireSession: (sessionId: string) => {
      if (engine.token !== engineToken) return
      const s = sessions.get(sessionId)
      if (s) {
        sessions.delete(sessionId)
        retireSession(s)
        drain([() => engine.status()])
      }
    },
    exitCode: (sessionId: string) => engine.token === engineToken ? sessions.get(sessionId)?.meta.exitCode : undefined,
    killSession: (sessionId: string) => {
      assertOwner(engine)
      const s = sessions.get(sessionId)
      if (s) killSession(s)
    },
  }
}

export type TerminalChannelDeps = {
  internalEnv: InternalEnvFactory
  launchContextText?: (taskId: string) => Promise<string | null>
  launchContext: (taskId: string, sessionId: string) => Promise<void>
  completed: (event: TerminalCompletedEvent) => void
  seedTaskNotes: (task: TaskRef) => Promise<void>
  // Resolves when the composition root's post-window reconcile pass is done, including on failure.
  // Mutating surfaces that read the sessions map await it.
  reconciled: Promise<void>
  // "The session roster moved": created, exited, or flipped between working and idle. Machine rate on
  // the working edge, which is why it says only that (@acorn/protocol/nodeEvents.ts).
  status?: () => void
  // "Something under this task's worktree may have changed." Fired on the human-rate edges only — a
  // command going quiet, a session exiting, a setup script finishing — because those are the moments a
  // person's `git commit` in a shell is done. A working edge is not one of them.
  worktreeChanged?: (taskId: string) => void
  streams?: (handlers: Parameters<CompiledPluginBroadcast['streams']>[0]) => void
}

// Release everything registerTerminalChannel installed. Called from the plugin's dispose
// (node/index.ts), which runs before the data root's lock is dropped. Idempotent, so it's safe after
// a partial boot that never started the idle watch.
//
// Clearing the session map matters: without it, a second startServiceRuntime in one process inherits
// the previous boot's sessions, so `list()` reports PTYs owned by a torn-down engine and the WS hub's
// task-scope guard resolves stream ids against them. Retirement closes the Node-owned PTY child.
// A detached tmux session and its durable row survive for startup reconciliation.
export function disposeTerminal(): void {
  engineToken = null
  if (idleWatch) {
    clearInterval(idleWatch)
    idleWatch = null
  }
  for (const session of sessions.values()) {
    retireSession(session) // queued 'after-ready' blocks can never fire against a disposed engine
  }
  sessions.clear()
  // Back to the "never initialized" state, so nothing that survives teardown (a PTY exit callback, a late
  // bridge call) can reach the previous boot's database handle or core services.
  store = null
  core = null
  internalEnv = () => ({})
  launchContextText = null
  launchContext = null
  completed = null
  seedNotes = null
  statusBroadcast = () => {}
  worktreeBroadcast = () => {}
  runSessionExitListeners.clear()
}

export type TerminalChannelRegistrations = {
  terminal: TerminalBridge
  taskSessions: TaskSessionsBridge
  taskCreated: TaskCreatedHook
  worktreeCreated: (taskId: string, cwd: string) => Promise<void>
}

export function registerTerminalChannel(pluginDb: PluginDatabase, coreServices: TerminalCoreServices, deps: TerminalChannelDeps): TerminalChannelRegistrations {
  if (engineToken) disposeTerminal()
  engineToken = {}
  store = pluginDb
  core = coreServices
  internalEnv = deps.internalEnv
  launchContextText = deps.launchContextText ?? null
  launchContext = deps.launchContext
  completed = deps.completed
  seedNotes = deps.seedTaskNotes
  statusBroadcast = deps.status ?? (() => {})
  worktreeBroadcast = deps.worktreeChanged ?? (() => {})

  const engine = owner()

  // Every worktree creation funnels through core's resolveTaskCwd, so this handler makes the setup
  // script run whichever surface created the worktree.
  //
  // It takes the task id rather than the row, because it is reached through core's `core:worktree-created`
  // hook now and a hook payload is scalars (docs/plugins.md § Hooks). Loading the row here costs one
  // read on a path that is about to spawn a shell.
  const worktreeCreated = async (taskId: string, cwd: string): Promise<void> => {
    assertOwner(engine)
    const task = await engine.core.tasks.load(taskId)
    assertOwner(engine)
    if (task) await maybeRunSetup(task, cwd, engine)
  }

  // The request/response half of the terminal engine, exposed as the TerminalBridge behind the HTTP
  // routes (server/routes/terminal.ts). The stream half is the WebSocket hub (setStreamHandlers below).
  // The bridge closes over the engine internals.
  const terminal: TerminalBridge = {
    // Same lookup the WS hub gets as `streamTaskId` below, off the same map.
    taskIdFor: (id) => engine.token === engineToken && sessions.get(id)?.admitted && !sessions.get(id)!.retired ? sessions.get(id)!.meta.taskId : null,
    list: async () => { assertOwner(engine); return [...sessions.values()].filter(s => s.admitted && !s.retired).map((s) => s.meta) },
    profiles: async () => listProfiles(),
    create: (opts) => create(opts ?? ({} as CreateOpts), engine),
    // sendToAgent (docs/terminal-and-agents.md § Sending text to an agent).
    sendToAgent: async (sessionId, text, submit) => {
      assertOwner(engine)
      if (!sessionId || !text) return { ok: false, reason: 'Invalid payload.' }
      const session = sessions.get(sessionId)
      if (!session?.admitted || session.retired) return { ok: false, reason: 'Unknown session.' }
      return agentSender.send(sessionId, text, submit)
    },
    kill: async (id) => {
      assertOwner(engine)
      const s = sessions.get(id)
      if (!s?.admitted || s.retired) return false
      killSession(s)
      return true
    },
    interrupt: async (id) => {
      assertOwner(engine)
      const s = sessions.get(id)
      if (!s?.admitted || s.retired || s.meta.status !== 'running') return false
      s.pty.write('\x03') // Ctrl-C to the foreground process
      return true
    },
    // Close a session in one shot: kill it if still running, then drop it.
    remove: async (id) => {
      assertOwner(engine)
      const s = sessions.get(id)
      if (!s?.admitted || s.retired) return false
      sessions.delete(id)
      drain([() => { if (s.meta.backend === 'tmux' && s.meta.tmuxSession) killTmuxSession(s.meta.tmuxSession) },
        () => retireSession(s)])
      try {
        if (s.meta.backend === 'tmux') await deleteRow(id, engine.db)
      } finally { if (engine.token === engineToken) drain([() => engine.status()]) }
      return true
    },
    resize: async (id, cols, rows) => {
      assertOwner(engine)
      const s = sessions.get(id)
      if (!s?.admitted || s.retired) return false
      resizeSession(s, cols, rows)
      return true
    },
  }

  // The PTY half of archive (@acorn/node-core/server/routes/projects/worktree.ts owns the route and the
  // orchestration). These four are the only parts of tearing a task down that need a pseudo-terminal:
  // the running-session guard, killing this task's sessions, dropping their rows, and streaming teardown
  // output into a "Teardown" tab. An unfilled slot answers 503.
  const taskSessions: TaskSessionsBridge = {
    // The reconcile gate the route awaits before the running-session guard.
    ready: () => deps.reconciled,
    runningCount: (taskId) => { assertOwner(engine); return [...sessions.values()].filter((s) => s.admitted && !s.retired && s.meta.taskId === taskId && s.meta.status === 'running').length },
    killRunning: (taskId) => {
      assertOwner(engine)
      for (const s of sessions.values()) if (s.meta.taskId === taskId && s.meta.status === 'running') killSession(s)
    },
    // Drop any lingering exited sessions for this task so their rows don't outlive it.
    dropTaskSessions: async (taskId) => {
      assertOwner(engine)
      const dropped = [...sessions.values()].filter(s => s.meta.taskId === taskId)
      for (const s of dropped) {
        sessions.delete(s.meta.id)
        s.discardRow = true
        retireSession(s)
      }
      try {
        await Promise.all(dropped.filter(s => s.meta.backend === 'tmux').map(s => deleteRow(s.meta.id, engine.db)))
      } finally { if (dropped.some(s => s.admitted) && engine.token === engineToken) drain([() => engine.status()]) }
    },
    // Teardown streams to the task drawer as a "Teardown" tab, and its exit code plus ring buffer are the
    // result. A ~2 min timeout kills it, surfacing exitCode null as a timeout.
    runTeardown: async (script, cwd, env, taskId) => {
      assertOwner(engine)
      const t = await engine.core.tasks.load(taskId)
      assertOwner(engine)
      const meta = await spawnOne({ taskId, command: script, title: 'Teardown', env }, cwd, true, taskContext(t), t, engine)
      assertOwner(engine)
      const s = sessions.get(meta.id)
      if (!s) return { exitCode: null, output: 'Could not start the teardown session.' }
      if (s.meta.status === 'exited') return { exitCode: s.meta.exitCode, output: s.ring.tail() }
      return new Promise((resolveTeardown) => {
        const finish = (exitCode: number | null) => {
          clearTimeout(timer)
          s.settlers.delete(finish)
          resolveTeardown({ exitCode, output: s.ring.tail() })
        }
        const timer = setTimeout(() => {
          // Deadline is an honest timeout result, even if the PTY never emits an exit.
          s.settlers.delete(finish)
          releaseCallbacks(s)
          drain([() => killSession(s)])
          s.meta.status = 'exited'
          s.meta.exitCode = null
          s.meta.idle = false
          s.meta.agentState = ptyState(s.meta.kind, 'exited', false)
          drain([
            () => emit(s, { type: 'exit', exitCode: null, signal: null }),
            () => { if (s.persisted) void markExited(s.meta.id, null, engine.db) },
            () => worktreeSettled(s),
            () => engine.status(),
            () => finish(null),
          ])
        }, TEARDOWN_TIMEOUT_MS)
        s.settlers.add(finish)
      })
    },
  }

  // Seeding PR and ticket notes on task creation is core's route now, but the composition root injects
  // the notes store here, so this hands core the hook rather than moving the dependency.
  const taskCreated: TaskCreatedHook = async (taskId) => {
    assertOwner(engine)
    const task = await engine.core.tasks.load(taskId)
    assertOwner(engine)
    if (task) await engine.seed?.(task)
  }

  // The stream half. The terminal engine's PTY input, output, attach and detach ride the one
  // authenticated WebSocket (server/transport/wsHub.ts) instead of per-session IPC channels. The hub routes client
  // frames here and hands each attachment a sink to fan output to.
  deps.streams?.({
    // Which task owns a session, so the WS hub can refuse a task-scoped internal credential that tries to
    // attach to or type into another task's pseudo-terminal (server/transport/wsHub.ts § mayDriveStream).
    streamTaskId: (id) => engine.token === engineToken && sessions.get(id)?.admitted && !sessions.get(id)!.retired ? sessions.get(id)!.meta.taskId : null,
    input: (id, data) => {
      if (engine.token !== engineToken) return
      const s = sessions.get(id)
      if (s?.admitted && !s.retired && s.meta.status === 'running' && typeof data === 'string') s.pty.write(data)
    },
    // attach is subscribe plus restore. The subscription is an attachment, not the session itself, so
    // detaching or reloading never kills the PTY or tmux. TerminalDisplay serializes its canonical
    // framebuffer and buffers concurrent live frames, preserving snapshot-before-live ordering.
    attach: (id, sink, size) => {
      if (engine.token !== engineToken) return
      const s = sessions.get(id)
      if (!s?.admitted || s.retired) return
      // A viewer that sent its size gets a snapshot drawn at that size. It used to post a resize and
      // wait for the answer before attaching, one more round trip before a returning terminal drew.
      if (size) resizeSession(s, size.cols, size.rows)
      flushOutput(s)
      // The ring is what an attach rebuilds the screen from, and it is read only when there is no
      // emulator yet (./terminalDisplay.ts § TerminalDisplay).
      s.display.attach(sink, s.meta, () => s.ring.tail())
    },
    detach: (id, sink) => {
      if (engine.token !== engineToken) return
      sessions.get(id)?.display.detach(sink)
    },
    // Backpressure, at the producer. The hub calls this when a client's socket has buffered past its
    // mark; `pause()` stops node-pty reading the pseudo-terminal, which lets the kernel's pipe fill and
    // the program writing into it block, which is what "slow down" means to a build
    // (docs/terminal.md § Backpressure). The alternative the hub used to take was throwing frames away,
    // which the client could only recover from by reconnecting and re-attaching every session.
    //
    // A pause is not visible to the session's state: the idle watch reads `lastActivityAt`, and a paused
    // PTY simply stops advancing it, which is indistinguishable from a quiet program and equally true.
    flowControl: (id, paused) => {
      if (engine.token !== engineToken) return
      const s = sessions.get(id)
      if (!s?.admitted || s.retired || s.meta.status !== 'running') return
      try {
        if (paused) s.pty.pause()
        else s.pty.resume()
      } catch {
        // A PTY that exited between the hub's decision and this call. Nothing to slow down.
      }
    },
  })

  // Durable-state reconciliation (reconcileTmux) is driven by the composition root's reconcile() step,
  // off the paint-critical path. The idle watch is engine-owned and starts here.
  startIdleWatch()
  return { terminal, taskSessions, taskCreated, worktreeCreated }
}
