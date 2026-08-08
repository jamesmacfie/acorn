import { spawn, type IPty } from 'node-pty'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { homedir } from 'node:os'
import { eq } from 'drizzle-orm'
import { buildSessionEnv, childEnv, type CoreServices, getProfile, type InternalEnvFactory, type Launcher, launcherSpec, listProfileDefs, listProfiles, type PluginBroadcast, type PluginDatabase, rendererBaseCheckout, resolveCommand, resolveMcpEntry, serverName, taskContext, type TaskCreatedHook, type TaskRow, type TaskSessionsBridge, TEARDOWN_TIMEOUT_MS, tmuxAvailable } from '@acorn/plugin-api/node'
import { terminalSessions } from '../node/schema'
import type { TerminalBridge } from '../server/routes/terminal'
import type { CreateOpts, ServerMsg, TerminalSession } from '@acorn/protocol/terminal.ts'
import type { SendSubmit } from '../shared/send'
import { AgentSender } from './agentSend'
import {
  clampDim,
  computeIdle,
  FIRST_IDLE_MS,
  IDLE_MS,
  matchBlockedPrompt,
  parseTmuxSessions,
  resolveBackend,
  tmuxAttachArgs,
  tmuxName,
  tmuxNewSessionArgs,
  trimRing,
} from './terminalUtils'
import { fileURLToPath } from 'node:url'
import type { RunSessionGlue } from './runIpc'
import { TerminalDisplay } from './terminalDisplay'

// PTYs live in the Node utility service. Sessions run on one of two backends:
//  - node-pty: spawn the command directly. Survives a window reload (PTY is in the service), not an app
//    restart. In-memory only.
//  - tmux: a detached `tmux` session drives the command; a PTY attaches to it. Survives an app
//    restart (the tmux daemon is separate) and can be attached from a real terminal. Persisted to
//    SQLite so startup can reconcile rows against `tmux list-sessions` and re-attach survivors.
// Terminal output is never persisted (docs/terminal-and-agents.md).
//
// This module is the session engine. HTTP bridges and WebSocket handlers are installed at the
// bottom; cross-feature wiring stays in the app composition root.

type Session = {
  meta: TerminalSession
  pty: IPty
  ring: string
  display: TerminalDisplay
  lastActivityAt: number
  sawIdle: boolean // has this session ever gone idle? the first idle uses a shorter window (FIRST_IDLE_MS)
  // PTY output coalescing (docs/electron.md §12): buffer bytes and flush one 'output' frame per ~16ms
  // tick instead of one per PTY chunk, so a busy TUI doesn't spam a frame per keystroke-echo.
  pendingOut: string
  flushTimer: ReturnType<typeof setTimeout> | null
}

// ~16ms ≈ one frame at 60fps; the busy-TUI coalescing target (docs/electron.md §12).
const OUTPUT_COALESCE_MS = 16

const sessions = new Map<string, Session>()

// What this engine needs from core, now that it cannot read core's tables at all: resolve a taskId to
// a row and to the cwd its commands run in, and read the project's setup script. `proc` and
// `projects.assertConfigTrusted` are for the run-target service built over this engine (runIpc.ts).
export type TerminalCoreServices = Pick<CoreServices, 'tasks' | 'projects' | 'proc'>

// This engine is a PROCESS singleton by construction — one PTY table, one idle watch, one session map
// per node — so its database handle and core services live in module state alongside them rather than
// being threaded through fourteen signatures. init() installs them; dispose() removes them, so a second
// startServiceRuntime in one process (the integration tests do this) REPLACES the first boot's handle
// instead of stacking a second engine beside it.
//
// `store` is nulled BEFORE the file is closed, which is what makes the persistence helpers below safe:
// a tmux PTY that exits after teardown has begun sees no store and writes nothing, rather than throwing
// from a `void`-called update against a closed SQLite handle.
let store: PluginDatabase | null = null
let core: TerminalCoreServices | null = null

// Every caller runs inside a request, a spawn or a reconcile — all strictly after init — so an absent
// value here is a programming error, not a degraded mode. The HTTP surface's degraded mode is the
// unfilled bridge slot answering 503, which is a level above this.
function services(): TerminalCoreServices {
  if (!core) throw new Error('The terminal engine has not been initialized.')
  return core
}

// sendToAgent (docs/panes.md): bracketed-paste delivery into agent PTYs, with 'after-ready'
// queued on the idle edge below. One instance over the live session map.
const agentSender = new AgentSender((id) => {
  const s = sessions.get(id)
  if (!s) return null
  return { write: (data: string) => s.pty.write(data), running: () => s.meta.status === 'running', idle: () => s.meta.idle }
})

export function sendToAgent(sessionId: string, text: string, submit: SendSubmit): void {
  void agentSender.send(sessionId, text, submit)
}

// Spawn and enumerate, published by this plugin's init as the `terminal.sessions` capability
// (contract/sessions.ts). Exported as a two-method object rather than by reaching into the
// TerminalBridge, because the bridge is the ROUTE layer's dependency: it exists to be nulled on
// dispose, and a capability consumer resolving it would be reading this plugin's HTTP wiring.
//
// Its one consumer is plugins/agents' terminal handoff — the only cross-plugin caller that needs to
// start a PTY. Same list/create implementations the bridge exposes, deliberately not the other six
// methods (contract/sessions.ts says why).
// Named `sessionControl`, not `terminalSessions`: that name is already the Drizzle table this module
// imports, and shadowing it here would silently rebind every query below.
export const sessionControl = {
  create: (opts: CreateOpts): Promise<TerminalSession> => create(opts),
  list: async (): Promise<TerminalSession[]> => [...sessions.values()].map((s) => s.meta),
}

let launchInjector: ((taskId: string, sessionId: string) => Promise<void>) | null = null
let memoryReviewTrigger: ((taskId: string, transcriptTail: string) => Promise<void>) | null = null
let seedNotes: ((task: TaskRow) => Promise<void>) | null = null
let internalEnv: InternalEnvFactory = () => ({})
let bootReconciled: Promise<void> = Promise.resolve()
let statusBroadcast: () => void = () => {}

// PTY-tier AgentState (docs/terminal-and-agents.md): shells stay 'unknown'; agents flip working/idle with the
// silence detector ('blocked' lands with the prompt-pattern scan).
const ptyState = (kind: 'shell' | 'agent', status: 'running' | 'exited', idle: boolean): TerminalSession['agentState'] =>
  kind !== 'agent' ? 'unknown' : status !== 'running' ? 'done' : idle ? 'idle' : 'working'

// Flush any coalesced PTY output as one 'output' frame. Called on the ~16ms tick, and eagerly
// before any non-output frame (exit) or a new attachment snapshot so ordering stays exact.
function flushOutput(s: Session) {
  if (s.flushTimer) {
    clearTimeout(s.flushTimer)
    s.flushTimer = null
  }
  if (!s.pendingOut) return
  const data = s.pendingOut
  s.pendingOut = ''
  s.display.publish({ type: 'output', data })
}

// Non-output frames flush pending output first (exit must not overtake buffered bytes).
function emit(s: Session, msg: ServerMsg) {
  flushOutput(s)
  s.display.publish(msg)
}

// Buffer PTY output; the raw ring feeds transcript-tail analysis, while the display emulator owns
// canonical renderer restoration. The live wire frame is coalesced onto the next tick.
function queueOutput(s: Session, data: string) {
  appendRing(s, data)
  s.display.write(data)
  s.pendingOut += data
  if (!s.flushTimer) s.flushTimer = setTimeout(() => flushOutput(s), OUTPUT_COALESCE_MS)
}

function appendRing(s: Session, data: string) {
  s.ring = trimRing(s.ring + data)
}

// --- tmux process plumbing (execFileSync with arg arrays — no shell, command is a fixed profile
// binary, cwd is validated, name is acorn-<uuid>) ---

function ensureTmuxSession(name: string, cwd: string, command: string, env: Record<string, string>) {
  // tmux runs the command argument through the user's shell, so a full "pnpm dev" line works; env
  // (e.g. PORT) is inherited by that shell (docs/workspaces-and-tasks.md).
  execFileSync('tmux', tmuxNewSessionArgs(name, cwd, command, env), { env, stdio: 'ignore' })
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
//
// This plugin's OWN database (<data-root>/plugins/terminal.sqlite), not core's. Every helper tolerates
// an absent store: the write path can only be reached after init, but the exit path is driven by a live
// PTY and can fire at any moment, including after teardown has nulled the handle.

async function persistSession(m: TerminalSession) {
  if (!store) return
  await store.insert(terminalSessions).values({
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
async function markExited(id: string, exitCode: number | null) {
  if (!store) return
  try {
    await store
      .update(terminalSessions)
      .set({ status: 'exited', exitCode, exitedAt: Date.now() })
      .where(eq(terminalSessions.id, id))
  } catch (error) {
    console.warn('[terminal] could not record session exit', id, error)
  }
}

const deleteRow = async (id: string): Promise<void> => {
  if (!store) return
  await store.delete(terminalSessions).where(eq(terminalSessions.id, id))
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

function wireSession(meta: TerminalSession, pty: IPty): Session {
  const s: Session = {
    meta,
    pty,
    ring: '',
    display: new TerminalDisplay(meta.cols, meta.rows),
    lastActivityAt: Date.now(),
    sawIdle: false,
    pendingOut: '',
    flushTimer: null,
  }
  sessions.set(meta.id, s)
  pty.onData((data) => {
    s.lastActivityAt = Date.now()
    if (s.meta.idle) {
      s.meta.idle = false // output resumed → no longer waiting
      s.meta.agentState = ptyState(s.meta.kind, s.meta.status, false)
      statusBroadcast()
    }
    queueOutput(s, data) // append to ring now; coalesce the wire frame onto the ~16ms tick
  })
  pty.onExit(({ exitCode, signal }) => {
    s.meta.status = 'exited'
    s.meta.idle = false
    s.meta.agentState = ptyState(s.meta.kind, 'exited', false)
    s.meta.exitCode = exitCode
    agentSender.clear(s.meta.id) // queued sends can never fire now
    emit(s, { type: 'exit', exitCode, signal: signal != null ? String(signal) : null })
    if (s.meta.backend === 'tmux') void markExited(s.meta.id, exitCode)
    // Task-completion trigger (docs/notes-and-memory.md): an agent session ending is the extraction moment.
    if (s.meta.kind === 'agent' && s.meta.title !== 'Teardown') void memoryReviewTrigger?.(s.meta.taskId, s.ring.slice(-10_000))
    statusBroadcast()
  })
  return s
}

let idleWatch: ReturnType<typeof setInterval> | null = null
function startIdleWatch() {
  if (idleWatch) return // registered once; a second boot must not stack a second timer
  const timer = setInterval(() => {
    const now = Date.now()
    for (const s of sessions.values()) {
      if (computeIdle(s.meta.kind, s.meta.status, s.lastActivityAt, now, s.sawIdle ? IDLE_MS : FIRST_IDLE_MS) && !s.meta.idle) {
        s.meta.idle = true
        s.sawIdle = true
        // An idle session showing an input prompt in its tail is BLOCKED, not done (05 P3).
        s.meta.agentState = matchBlockedPrompt(s.ring.slice(-4000)) ? 'blocked' : 'idle'
        agentSender.onIdle(s.meta.id) // flush 'after-ready' sends on the busy→idle edge (04 §D)
        // The OS toast moved to the renderer (docs/terminal-and-agents.md): focus-gated + cooldown/dedup there.
        statusBroadcast()
      }
    }
  }, 3000)
  // unref'd because nothing should be kept alive BY this timer: the node is held open by its HTTPS
  // listener, and a test that initializes the plugin without tearing it down would otherwise hang
  // vitest for three seconds at a time, forever.
  timer.unref?.()
  idleWatch = timer
}

// Run the workspace setup script as a "Setup" session in the freshly-created worktree, unless it's
// blank or disabled ('off'). Registered as the taskWorktree onWorktreeCreated hook, so it fires
// exactly once no matter which path creates the worktree (first terminal, editor/changes pane,
// onCreated eager pre-create, run config, workflows). Ordered before any requested session so a
// setup spawned from create() is tab #1.
async function maybeRunSetup(t: TaskRow, cwd: string): Promise<void> {
  if (!t.projectId) return
  const { script, trigger } = await services().projects.setup(t.projectId)
  if (trigger === 'off' || !script?.trim()) return
  await spawnOne({ taskId: t.id, command: script, title: 'Setup' }, cwd, true, taskContext(t), t)
  statusBroadcast() // panel re-lists to show the Setup tab even when no other spawn follows
}

async function create(opts: CreateOpts): Promise<TerminalSession> {
  // The renderer passes the base checkout as opts.cwd (validated at the boundary); the worktree is
  // derived from it. Lazy worktree on first terminal, reused after (docs/workspaces-and-tasks.md).
  // A first-ever worktree fires the onWorktreeCreated hook inside resolveTaskCwd → maybeRunSetup.
  const baseCheckout = rendererBaseCheckout(opts.cwd)
  const t = await services().tasks.load(opts.taskId)
  const { cwd, isWorktree } = await services().tasks.resolveCwd(t, baseCheckout)
  return spawnOne(opts, cwd, isWorktree, taskContext(t), t)
}

// Build the session meta, spawn the PTY (tmux or node-pty) in the already-resolved cwd, and wire it.
async function spawnOne(
  opts: CreateOpts,
  cwd: string,
  isWorktree: boolean,
  ctx: Pick<TerminalSession, 'repo' | 'pull'>,
  task?: TaskRow,
): Promise<TerminalSession> {
  const profile = getProfile(opts.profileId)
  // Dev-server pane (docs/workspaces-and-tasks.md): a command override runs via the user's shell with env
  // merged in; otherwise the profile's binary. resolveCommand stays the path for shells/agents.
  const command = opts.command?.trim() || resolveCommand(profile)
  const id = randomUUID()
  const project = task?.projectId ? await services().projects.byId(task.projectId) : null
  // Every task-scoped session carries the ACORN_* identity vars (docs/terminal-and-agents.md, docs/agent-tools.md §4) plus its own
  // session id — MCP notes/memory writes use it for `author: agent` provenance (docs/notes-and-memory.md).
  const env = buildSessionEnv({
    taskId: opts.taskId,
    cwd,
    task: task && project
      ? { projectId: project.id, projectName: project.name, github: project.github, branch: task.branch, title: task.title }
      : null,
    env: { ...internalEnv({ scope: 'task', taskId: opts.taskId, sessionId: id }), ACORN_SESSION_ID: id, ...opts.env },
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

  let pty: IPty
  if (backend === 'tmux') {
    ensureTmuxSession(meta.tmuxSession!, cwd, command, env)
    pty = attachTmuxPty(meta.tmuxSession!, cols, rows)
    await persistSession(meta)
  } else if (opts.command) {
    // No tmux: run the command line through a login shell so PATH/nvm resolve "pnpm" etc.
    pty = spawn(env.SHELL || '/bin/sh', ['-lc', command], { name: 'xterm-256color', cols, rows, cwd, env })
  } else {
    pty = spawn(command, [], { name: 'xterm-256color', cols, rows, cwd, env })
  }
  wireSession(meta, pty)
  // A fresh AGENT session gets the combined task-context + repo-memory block queued for its idle edge (docs/notes-and-memory.md).
  if (profile.kind === 'agent') void launchInjector?.(opts.taskId, id)
  return meta
}

// Profiles whose MCP registration succeeded this app-run (spawnOne skips the CLI round trip).
const mcpRegistered = new Set<string>()

// acorn MCP server launcher + build-flavored name. Whether/how a CLI registers it is declared by
// that profile contribution rather than a second profile-id lookup table.
let configuredMcp: { name: string; launcher: Launcher } | null = null

export function configureTerminalMcp(name: string, launcher: Launcher): void {
  configuredMcp = { name, launcher }
}

// `defaultApp` is an Electron addition to the Node `process` globals (true for an unpackaged run).
// This module is service-owned and therefore also compiles inside @acorn/node's plain-Node program,
// so read it defensively rather than widening this package's type surface — the same pattern
// node-core uses for `process.resourcesPath`.
const isDefaultApp = (): boolean => (process as { defaultApp?: boolean }).defaultApp === true

const mcpName = () => configuredMcp?.name ?? serverName(!isDefaultApp() && !process.env.ELECTRON_IS_DEV)
const mcpLauncher = () => configuredMcp?.launcher ?? launcherSpec(process.execPath, resolveMcpEntry(dirname(fileURLToPath(import.meta.url))), mcpName())

// Boot-time MCP re-registration (docs/mcp.md): the registered launcher command is process.execPath —
// a volatile pnpm-store Electron path in dev that ENOENTs after any electron reinstall/bump, leaving
// `/mcp` showing acorn disconnected. Session-spawn already re-registers, but restored/tmux-reattached
// sessions never do, so refresh every agent CLI's entry to the CURRENT binary once at boot too.
// Idempotent (remove-then-add), failures swallowed.
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

// Killing a tmux session's attach PTY only *detaches* it — the session keeps running. To actually
// stop a tmux agent we must kill the tmux session itself (which then EOFs the PTY → onExit).
function killSession(s: Session) {
  if (s.meta.backend === 'tmux' && s.meta.tmuxSession) killTmuxSession(s.meta.tmuxSession)
  s.pty.kill()
}

// On startup, re-attach tmux sessions that are still alive and drop DB rows whose tmux is gone
// (docs/terminal-and-agents.md: app restart rediscovers tmux sessions). Run by the composition root's coordinated
// reconcile() step, off the paint-critical path (composition-root ownership, docs/electron.md §11).
export async function reconcileTmux() {
  if (!store) return
  let rows: (typeof terminalSessions.$inferSelect)[]
  try {
    rows = await store.select().from(terminalSessions)
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
        const task = await services().tasks.load(row.taskId)
        // isWorktree is derived, not persisted (docs/workspaces-and-tasks.md): tasks.worktreePath is the truth,
        // so recompute it here so a session that survives an app restart keeps its worktree affordance.
        const isWorktree = !!task?.worktreePath && resolve(row.cwd) === resolve(task.worktreePath)
        wireSession(rowToMeta(row, taskContext(task), isWorktree), attachTmuxPty(row.tmuxSession, row.cols, row.rows))
        reattached++
      } else {
        await deleteRow(row.id)
      }
    } catch (e) {
      console.warn('[terminal] tmux reconcile failed for session', row.id, e)
    }
  }
  // This now runs after the window (composition root step 6), so the renderer's initial term:list
  // has already fired — ping it to re-list, or resurrected sessions stay invisible until some
  // unrelated broadcast (shell sessions never hit the idle-edge broadcasts).
  if (reattached) statusBroadcast()
}

// The session-engine glue the run-target service (runIpc) needs: spawn a target's command as a
// terminal session in the task worktree, and observe/kill it. Exported so the plugin's init can build
// the RuntimeService without this engine importing the run domain (the run service depends on the
// engine, not the reverse).
export function terminalRunGlue(): RunSessionGlue {
  return {
    startSession: async (taskId: string, target: { id: string; command: string }, cwd: string) => {
      const t = await services().tasks.load(taskId)
      const meta = await spawnOne({ taskId, command: target.command, title: `▶ ${target.id}` }, cwd, true, taskContext(t), t)
      statusBroadcast()
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

export type TerminalIpcDeps = {
  internalEnv: InternalEnvFactory
  launchInjector: (taskId: string, sessionId: string) => Promise<void>
  memoryReviewTrigger: (taskId: string, transcriptTail: string) => Promise<void>
  seedTaskNotes: (task: TaskRow) => Promise<void>
  // Resolves when the composition root's post-window reconcile pass is done (always resolves,
  // even on reconcile failure). Mutating surfaces that read the sessions map await it.
  reconciled: Promise<void>
  status?: () => void
  streams?: (handlers: Parameters<PluginBroadcast['streams']>[0]) => void
}

// Release everything registerTerminalIpc installed. Called from the plugin's dispose (node/index.ts),
// which runs before the data root's lock is dropped. Idempotent — safe after a partial boot that never
// started the idle-watch.
//
// The session map is CLEARED, which it was not before. Without that, a second startServiceRuntime in one
// process inherits the previous boot's sessions: `list()` would report PTYs owned by a torn-down engine,
// and the WS hub's task-scope guard would resolve stream ids against them. The PTYs themselves are
// deliberately NOT killed — a tmux session outliving the app is the entire point of the tmux backend,
// and killing the attach PTY of a node-pty session at quit is what process exit does anyway.
export function disposeTerminal(): void {
  if (idleWatch) {
    clearInterval(idleWatch)
    idleWatch = null
  }
  for (const [id, session] of sessions) {
    session.display.dispose()
    agentSender.clear(id) // queued 'after-ready' blocks can never fire against a disposed engine
  }
  sessions.clear()
  // Back to the "never initialized" state, so nothing that survives teardown (a PTY exit callback, a
  // late bridge call) can reach the previous boot's database handle or core services.
  store = null
  core = null
  internalEnv = () => ({})
  launchInjector = null
  memoryReviewTrigger = null
  seedNotes = null
  bootReconciled = Promise.resolve()
  statusBroadcast = () => {}
}

export type TerminalIpcRegistrations = {
  terminal: TerminalBridge
  taskSessions: TaskSessionsBridge
  taskCreated: TaskCreatedHook
  worktreeCreated: (task: TaskRow, cwd: string) => Promise<void>
}

export function registerTerminalIpc(pluginDb: PluginDatabase, coreServices: TerminalCoreServices, deps: TerminalIpcDeps): TerminalIpcRegistrations {
  store = pluginDb
  core = coreServices
  internalEnv = deps.internalEnv
  launchInjector = deps.launchInjector
  memoryReviewTrigger = deps.memoryReviewTrigger
  seedNotes = deps.seedTaskNotes
  bootReconciled = deps.reconciled
  statusBroadcast = deps.status ?? (() => {})

  // Every worktree creation funnels through core's resolveTaskCwd; this hook makes the setup script run
  // regardless of which surface (terminal, pane, workflow) created the worktree.
  const worktreeCreated = (t: TaskRow, cwd: string): Promise<void> => maybeRunSetup(t, cwd)

  // The request/response half of the terminal engine, exposed as the TerminalBridge behind the HTTP
  // routes (server/routes/terminal.ts).
  // The STREAM half (term:input/attach/detach + the term:out push, term:status) is the WebSocket
  // hub (setStreamHandlers below). The native repo picker is registered separately through preload.
  // The bridge closes over the engine internals (sessions map, agentSender, …).
  const terminal: TerminalBridge = {
    // Same lookup the WS hub gets as `streamTaskId` below, off the same map — see TerminalBridge.
    taskIdFor: (id) => sessions.get(id)?.meta.taskId ?? null,
    list: async () => [...sessions.values()].map((s) => s.meta),
    profiles: async () => listProfiles(),
    create: (opts) => create(opts ?? ({} as CreateOpts)),
    // sendToAgent (docs/panes.md): bracketed paste into an agent session's PTY with a submit mode.
    sendToAgent: async (sessionId, text, submit) => {
      if (!sessionId || !text) return { ok: false, reason: 'Invalid payload.' }
      return agentSender.send(sessionId, text, submit)
    },
    kill: async (id) => {
      const s = sessions.get(id)
      if (!s) return false
      killSession(s)
      return true
    },
    interrupt: async (id) => {
      const s = sessions.get(id)
      if (!s || s.meta.status !== 'running') return false
      s.pty.write('\x03') // Ctrl-C to the foreground process
      return true
    },
    // Close a session in one shot: kill it if still running, then drop it.
    remove: async (id) => {
      const s = sessions.get(id)
      if (!s) return false
      if (s.meta.status === 'running') killSession(s)
      s.display.dispose()
      sessions.delete(id)
      if (s.meta.backend === 'tmux') await deleteRow(id)
      return true
    },
    resize: async (id, cols, rows) => {
      const s = sessions.get(id)
      if (!s) return false
      const c = clampDim(cols, s.meta.cols)
      const r = clampDim(rows, s.meta.rows)
      s.meta.cols = c
      s.meta.rows = r
      s.display.resize(c, r)
      if (s.meta.status === 'running') s.pty.resize(c, r)
      return true
    },
  }

  // The PTY half of archive (@acorn/node-core/server/routes/worktree.ts owns the route and the
  // orchestration). These four are the only parts of tearing a task down that need a pseudo-terminal:
  // the running-session guard, killing this task's sessions, dropping their rows, and streaming
  // teardown output into a "Teardown" tab. An unfilled slot answers 503, which is exactly what
  // dev:node did before when the whole terminal bridge was unset.
  const taskSessions: TaskSessionsBridge = {
    // The reconcile gate the route awaits before the running-session guard (see TaskSessionsBridge).
    ready: () => bootReconciled,
    runningCount: (taskId) => [...sessions.values()].filter((s) => s.meta.taskId === taskId && s.meta.status === 'running').length,
    killRunning: (taskId) => {
      for (const s of sessions.values()) if (s.meta.taskId === taskId && s.meta.status === 'running') killSession(s)
    },
    // Drop any lingering exited sessions for this task so their rows don't outlive it.
    dropTaskSessions: async (taskId) => {
      for (const [sid, s] of sessions) {
        if (s.meta.taskId === taskId) {
          s.display.dispose()
          sessions.delete(sid)
          if (s.meta.backend === 'tmux') await deleteRow(sid)
        }
      }
    },
    // Teardown streams to the task drawer as a "Teardown" tab; its exit code + ring buffer are the
    // result. A ~2 min timeout kills it (exitCode null → surfaced as a timeout).
    //
    runTeardown: async (script, cwd, env, taskId) => {
      const t = await services().tasks.load(taskId)
      const meta = await spawnOne({ taskId, command: script, title: 'Teardown', env }, cwd, true, taskContext(t), t)
      const s = sessions.get(meta.id)
      if (!s) return { exitCode: 1, output: 'Could not start the teardown session.' }
      statusBroadcast()
      return new Promise((resolveTeardown) => {
        const timer = setTimeout(() => killSession(s), TEARDOWN_TIMEOUT_MS)
        s.pty.onExit(({ exitCode }) => {
          clearTimeout(timer)
          resolveTeardown({ exitCode, output: s.ring })
        })
      })
    },
  }

  // Seeding PR/ticket notes on task creation is core's route now, but the notes store is injected
  // here by the composition root — so this hands core the hook rather than moving the dependency.
  const taskCreated: TaskCreatedHook = async (taskId) => {
    const task = await services().tasks.load(taskId)
    if (task) await seedNotes?.(task)
  }

  // The STREAM half (the WebSocket transport): the terminal engine's PTY input/output + attach/detach now
  // ride the one authenticated WebSocket (main/wsHub.ts) instead of per-session IPC channels. The
  // hub routes client frames here and hands each attachment a sink to fan output to.
  deps.streams?.({
    // Which task owns a session, so the WS hub can refuse a task-scoped internal credential that tries
    // to attach to (or type into) another task's pseudo-terminal (main/wsHub.ts § mayDriveStream).
    streamTaskId: (id) => sessions.get(id)?.meta.taskId ?? null,
    input: (id, data) => {
      const s = sessions.get(id)
      if (s && s.meta.status === 'running' && typeof data === 'string') s.pty.write(data)
    },
    // attach = subscribe + restore. The subscription is an attachment, not the session itself:
    // detaching / reloading never kills the PTY or tmux. TerminalDisplay serializes its canonical
    // framebuffer and buffers concurrent live frames, preserving snapshot-before-live ordering.
    attach: (id, sink) => {
      const s = sessions.get(id)
      if (!s) return
      flushOutput(s)
      s.display.attach(sink, s.meta)
    },
    detach: (id, sink) => {
      sessions.get(id)?.display.detach(sink)
    },
  })

  // Durable-state reconciliation (reconcileTmux) is driven by the composition root's reconcile()
  // step, off the paint-critical path. The idle-watch is engine-owned and starts here.
  startIdleWatch()
  return { terminal, taskSessions, taskCreated, worktreeCreated }
}
