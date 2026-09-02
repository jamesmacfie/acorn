/** @jsxImportSource @opentui/solid */
import { parseArgs } from 'node:util'
import { CliRenderEvents, createCliRenderer } from '@opentui/core'
import { render } from '@opentui/solid'
import { installPlatform } from './platform'
import { openNode } from './node/open'
import { installKeymap } from './keys/install'
import { COMMAND } from './keys/tiers'
import { installRenderGuard, RENDERER_LISTENER_CAP } from './renderGuard'

// `acorn`.
//
//   acorn                          the node for this machine's data root: attach if one is running,
//                                  start and supervise one if not
//   acorn --node <https://host>     pair with a node elsewhere, then open it
//   acorn --node <name>             open a node this device already paired with
//
// The shell is whole (docs/tui.md § The screen): a rail of tasks, a pane strip, a palette, a footer
// that says what the keyboard will do, and the same twelve client plugins the desktop registers.

// This host's cold-start account, held rather than printed. stderr is the file the renderer draws on,
// so a timing line written while it owns the terminal reads as the shell going to garbage — the same
// reason Node's own warnings are held below. Every mark is kept and printed on the way out, after
// `renderer.destroy()` has handed the terminal back.
//
// Unconditional, unlike the desktop helper's: these lines only appear once the shell has already
// exited, where there is nothing left to interrupt, and a person who ran `acorn` and waited two seconds
// for a rail has earned the account of where they went
// (docs/local-development.md § Timing a cold start).
const bootStarted = process.hrtime.bigint()
const bootMarks: { label: string; at: number }[] = []
const bootMark = (label: string): void => {
  bootMarks.push({ label, at: Number(process.hrtime.bigint() - bootStarted) / 1e6 })
}
const printBootMarks = (): void => {
  let previous = 0
  for (const { label, at } of bootMarks) {
    console.error(`[acorn:boot] ${label} +${at.toFixed(0)}ms (${(at - previous).toFixed(0)}ms)`)
    previous = at
  }
}

const { values } = parseArgs({
  options: {
    node: { type: 'string' },
    task: { type: 'string' },
  },
  allowPositionals: false,
})

// OpenTUI's render core is Zig reached over `node:ffi`, a Node 26.4 builtin behind a flag. Checked
// here rather than left to the loader, because the failure it produces otherwise is a stack trace from
// inside a chunk. Not declared as an `engines` floor on this package: the rest of the repo builds and
// tests this one happily on the Node it already has, and only running it needs 26.4 (findings.md,
// "The runtime floor").
const [nodeMajor = 0, nodeMinor = 0] = process.versions.node.split('.').map(Number)
if (nodeMajor < 26 || (nodeMajor === 26 && nodeMinor < 4)) {
  console.error(`acorn draws with OpenTUI, which needs Node 26.4 or later started with --experimental-ffi. This is Node ${process.versions.node}.`)
  process.exit(2)
}

// Before the renderer: pairing asks a question on stdin, and it is the one thing here that does. What
// no longer happens before the renderer is waiting for a node this run started — `openNode` returns as
// soon as the child is spawned, and the shell draws from the persisted cache while it boots
// (./node/open.ts, docs/future/performance/decisions.md § Every host draws first).
const opened = await openNode(values.node).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
// The node: attached to, or spawned and still booting.
bootMark('node open')

let leaving = false
// What this process wants to say and cannot, because stderr is the file the renderer draws on and a
// line written there garbles the shell until the next full repaint. Printed on the way out, beside the
// boot account. `opened.held` — a started child's stderr — is held the same way, in `supervise.ts`,
// and read at print time because it grows for the life of the run.
const heldLines: string[] = []
const platform = installPlatform(opened, () => void quit())

// Nothing that reaches the node may be imported before the seam exists: an import is evaluated once,
// and a module that reads `window.acorn` at its top level would read it before the line above ran.
const { selectActiveNode, setActiveNode } = await import('@acorn/client-core/infra/node/activeNode.ts')
const { clientFor, nodeState, setCacheStorage } = await import('@acorn/client-core/infra/node/fleet.ts')
const { fileCacheStorage } = await import('./node/cache')
const { persistQueryClient } = await import('@tanstack/query-persist-client-core')
const { PERSISTED_QUERY_MAX_AGE_MS, shouldPersistQuery } = await import('@acorn/client-core/infra/persistence/queryPersistence.ts')
const { setNodeStarting } = await import('./chrome/nodeState')
const { syncPluginDistribution } = await import('@acorn/client-core/host/plugins/distribution.ts')
const { syncPluginContributions } = await import('@acorn/client-core/host/plugins/syncContributions.ts')
const { watchPluginChanges } = await import('@acorn/client-core/host/plugins/reload.ts')
const { watchTaskChanges } = await import('@acorn/client-core/features/tasks/watchTaskChanges.ts')
const { createEffect, createRoot } = await import('solid-js')
const { setHostFocused } = await import('@acorn/client-core/features/notifications/deliver.ts')

// The query cache persists to files rather than to IndexedDB, which there is none of here. Installed
// before `selectActiveNode`, because that is what builds the first node's cache.
setCacheStorage(fileCacheStorage())

// Which node this run addresses, said out loud before the fleet is read. `selectActiveNode` keeps a
// selection it still recognises and otherwise prefers the home node, which is the LOCAL one — so
// without this line `acorn --node <remote>` opened a remote node's broker connection and then sent
// every request to the machine's own node. It also makes `activeCacheId()` and the client below the
// same partition, which is what the watchers write into.
setActiveNode(opened.nodeId)
await selectActiveNode()

// One client and one persister per node, and this host reads the same pair every other host does
// (docs/caching.md § Renderer query cache). `App` used to mint a second `QueryClient` of its own, so
// the shell read a cache nothing persisted and nothing invalidated: every start was cold, and a task
// created anywhere else never appeared. `clientFor` hands back both halves, so there is nothing to
// build here beyond driving them.
const { client, persister } = clientFor(opened.nodeId)
// A tuple, not an object: `[unsubscribe, restorePromise]`. Nothing calls the unsubscribe — the
// persister's lifetime is this process's.
const [, restored] = persistQueryClient({
  queryClient: client,
  persister,
  maxAge: PERSISTED_QUERY_MAX_AGE_MS,
  dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
})
// Awaited, which is this host's `isRestoring`: the snapshot is one synchronous file read, and a shell
// drawn a tick before it lands would draw an empty rail and then fill it.
await restored
bootMark('cache restored')

// The shell, and not one line earlier: a module that reaches the node must not be evaluated before
// `installPlatform` has run, or `send` finds no transport and falls back to global `fetch` with a
// relative path. The suite's harness imports it the same way (./harness.tsx).
//
// What is NOT in here any more is the roster. Those twelve plugin barrels were 224 KB of this graph
// and every one of their `init` and `activate` passes ran before a cell was drawn; they load after
// the first frame now (./roster.ts, scripts/check-startup-graph.mjs).
const { App } = await import('./App')
bootMark('App imported')

// The renderer is built here rather than left to `render`, because the keymap's terminal adapter
// binds to it and `render` hands it back to nobody.
//
// `exitOnCtrlC` is off: Ctrl+C at the shell is the TUI's, and inside an entered PTY rectangle it is
// the PTY's, which is the whole reason a rectangle owns its keys (docs/tui.md § Signals and exit).
// The renderer handles `SIGWINCH` itself, so a resize is its alone and nothing here listens for one.
installRenderGuard()
// The kitty keyboard protocol, asked for and not assumed: a terminal that does not know the request
// ignores it, and OpenTUI pops the mode on exit either way.
//
// Not a nicety. Ctrl+Return is the `commit` intent on this host — send this comment, send this message
// — and a legacy terminal sends the same single byte for Return with Ctrl and Return without it, so
// the chord does not exist to be bound. `disambiguate` is the one flag that fixes it, and it fixes the
// same ambiguity for a lone Escape, which the parser otherwise has to wait out
// (docs/tui.md § The adapter, ./kit/asking.tsx § Composer).
//
// `openConsoleOnError` is off because this host holds its own output. OpenTUI pops its console
// overlay over the frame on an uncaught error, and the shell now draws in front of a node that may
// not answer for a second — so one fire-and-forget request rejecting reads as the whole app being
// replaced by a debug panel. The error is not lost: it is captured below and printed on the way out.
const renderer = await createCliRenderer({
  exitOnCtrlC: false,
  useKittyKeyboard: { disambiguate: true },
  openConsoleOnError: false,
})
bootMark('renderer created')
// Time to first draw. `@opentui/solid` exports a `TimeToFirstDraw` renderable that holds the same
// number, but it is an on-screen label: it would have to be mounted in the tree and would paint a debug
// overlay over the shell. The renderer's own first `frame` event is the same moment with nothing drawn
// over.
renderer.once(CliRenderEvents.FRAME, () => {
  bootMark('first draw')
  void fillIn()
})

// Everything the shell does not need in order to draw, run once the first frame is on screen.
//
// The roster is the big one and it is safe here because every contribution registry is a Solid signal:
// the chrome draws, this lands, and the rail, the pane strip and the palette fill from the same
// reactivity that already handles a loaded plugin arriving from a node seconds later (./roster.ts).
// The agents plugin's `activate` fires an HTTP request to prime its session store as it goes, which is
// the one thing in the pass that touches the node at all.
async function fillIn(): Promise<void> {
  const { installRoster } = await import('./roster')
  installRoster()
  bootMark('roster registered')

  // Every task write on the node broadcasts `tasks:changed`, and this turns that into one invalidation
  // of the client the shell reads — which it now is (docs/plugins.md § Hearing a core event). The
  // desktop has had this since the fleet; this host had nothing, so a task created by an agent or in
  // another window moved nothing on screen until a restart.
  watchTaskChanges()

  // The node's arrival, which is behind the first frame now. Everything the shell asked for while a
  // node it had just spawned was booting came back as `ECONNREFUSED`, and the first non-offline state
  // is when those are worth asking again. The desktop's composition root holds the same effect for the
  // same reason (apps/desktop/src/client/index.tsx).
  createRoot(() => {
    createEffect(() => {
      if (nodeState(opened.nodeId) === 'offline') return
      void client.invalidateQueries({ refetchType: 'active' })
    })
  })

  // Third-party plugins: ask every node in the fleet what it carries, hash whatever is new into this
  // device's own cache, and register the surfaces of every bundle it has already accepted. Anything it
  // has not is queued for the trust prompt, which the shell draws as an overlay.
  void syncPluginDistribution().then(syncPluginContributions).catch((error: unknown) => {
    heldLines.push(`[plugins] could not read the fleet's plugins: ${error instanceof Error ? error.message : String(error)}`)
  })
  // …and stay reconciled: a node that reloads a plugin in place broadcasts `plugins:changed`.
  watchPluginChanges()

  // The sound channel: an unseen agent edge rings the terminal.
  const { initBellNotices } = await import('./kit/bell')
  initBellNotices()
}
// A library's log must not cover the screen, and must not be written to it either. OpenTUI's console
// stays ACTIVE — it replaces `global.console` with one that captures — and hidden. Active because
// stderr is the file the renderer draws on, so a line written there garbles the shell until the next
// full repaint; hidden because a debug panel over the workspace is not what a stray log deserves.
// Nothing is lost: the capture is printed after `renderer.destroy()` with the rest of the held output.
renderer.console.hide()
// Every live `scrollbox` subscribes to the renderer's `selection` event (./renderGuard.ts).
renderer.setMaxListeners(RENDERER_LISTENER_CAP)
// Node's own warnings never pass through that console. `process.emitWarning` writes to stderr, which
// is the file the renderer draws on, so one arriving mid-session leaves the shell reading as garbage
// until the next full repaint. Held while the renderer owns the terminal and printed once it hands it
// back, so nothing is lost and nothing is drawn over. A `Set` because Node repeats a warning per
// emitter, and the same line held fifty times says nothing the first one did not.
const heldWarnings = new Set<string>()
process.removeAllListeners('warning')
process.on('warning', (warning) => { heldWarnings.add(`${warning.name}: ${warning.message}`) })
// Whether this terminal is the one the reader is looking at, which is the gate's `focused()` and
// therefore the difference between a notice that lands read and one that raises a banner. The
// renderer asks for DEC 1004 focus reports and turns `ESC [ I` and `ESC [ O` into these two events.
//
// A plain variable rather than a signal: the gate reads it imperatively a second after an edge, and
// nothing draws from it. It starts true because unknown counts as focused — a terminal that never
// answers must not be treated as one nobody is watching (client-core § defaultDeliveryContext).
let terminalFocused = true
renderer.on(CliRenderEvents.FOCUS, () => { terminalFocused = true })
renderer.on(CliRenderEvents.BLUR, () => { terminalFocused = false })
setHostFocused(() => terminalFocused)

const engine = installKeymap(renderer)

// The terminal comes back first, then the node drains. A node that started here gets its bounded
// SIGTERM drain; one this TUI only attached to is left running, because whoever started it owns it.
async function quit(code = 0): Promise<never> {
  if (leaving) return await new Promise<never>(() => {}) // a second Ctrl+C during the drain waits
  leaving = true
  renderer.destroy()
  // The terminal is ours again, so everything held while the screen was busy can go out: the boot
  // account, then what this process logged, then a started node's own stderr, then whatever this file
  // wanted to say, then Node's warnings.
  printBootMarks()
  const logged = renderer.console.getCachedLogs()
  if (logged.trim()) console.error(logged)
  for (const line of opened.held ?? []) console.error(`[node] ${line}`)
  for (const line of heldLines) console.error(line)
  for (const warning of heldWarnings) console.error(warning)
  await platform.dispose()
  process.exit(code)
}

// `q` is the shell's, registered as a command with a confirm when this TUI is the thing that started
// the node (chrome/Shell.tsx). `Ctrl+C` is not: it is the signal a terminal sends to say stop now,
// and it stops now. Inside an entered rectangle it never reaches here at all, which is the whole
// point of the Rectangle contract.
engine.registerLayer({
  priority: COMMAND,
  bindings: [{ key: 'ctrl+c', cmd: () => { void quit(); return true } }],
})
// A supervisor's SIGTERM drains the child this process started, which is the whole reason it waits.
process.once('SIGTERM', () => void quit())

// A node this run started has not answered anything yet, and the footer says so until it does. Set
// before the first frame, so nothing draws the wrong thing even once — and after `quit`, because a
// child that fails to spawn rejects on the next tick and quitting needs a renderer to hand back
// (./chrome/nodeState.ts).
if (opened.starting) {
  setNodeStarting(true)
  void opened.starting.then(
    () => setNodeStarting(false),
    (error: unknown) => {
      setNodeStarting(false)
      heldLines.push(`acorn could not start a node: ${error instanceof Error ? error.message : String(error)}`)
      void quit(1)
    },
  )
}

await render(
  () => (
    <App
      client={client}
      nodeId={opened.nodeId}
      supervised={opened.supervised}
      {...(values.task ? { task: values.task } : {})}
      onNoTask={(id) => {
        heldLines.push(`No task ${id} on this node.`)
        // Not from here. A warm cache answers the tasks query on the first tick, so this callback can
        // fire inside `render()` — and `renderer.destroy()` from inside a render pass throws, which
        // took the exit path with it and printed nothing at all. Let the frame finish, then leave.
        setTimeout(() => void quit(1))
      }}
      onQuit={() => void quit()}
    />
  ),
  renderer,
)
