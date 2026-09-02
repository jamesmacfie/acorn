/** @jsxImportSource @opentui/solid */
import { parseArgs } from 'node:util'
import { CliRenderEvents, createCliRenderer } from '@opentui/core'
import { render } from '@opentui/solid'
import type { Task } from '@acorn/protocol/api.ts'
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

// Before the renderer: pairing asks a question on stdin, and starting a node prints its own boot
// output. Both want a plain terminal, and neither has anything to draw.
const opened = await openNode(values.node).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
// The node, attached to or started and waited for. When this TUI started it, every `[service:boot]`
// line the node printed is above this mark and accounts for the whole of it.
bootMark('node open')

let leaving = false
const platform = installPlatform(opened, () => void quit())

// Nothing that reaches the node may be imported before the seam exists: an import is evaluated once,
// and a module that reads `window.acorn` at its top level would read it before the line above ran.
const { selectActiveNode } = await import('@acorn/client-core/infra/node/activeNode.ts')
const { readJson } = await import('@acorn/client-core/infra/node/apiClient.ts')
const { setCacheStorage } = await import('@acorn/client-core/infra/node/fleet.ts')
const { fileCacheStorage } = await import('./node/cache')
const { tasksRoute } = await import('@acorn/protocol/api.ts')
const { activateTaskSignals } = await import('@acorn/client-core/features/tasks/activate.ts')
const { syncPluginDistribution } = await import('@acorn/client-core/host/plugins/distribution.ts')
const { syncPluginContributions } = await import('@acorn/client-core/host/plugins/syncContributions.ts')
const { watchPluginChanges } = await import('@acorn/client-core/host/plugins/reload.ts')

// The query cache persists to files rather than to IndexedDB, which there is none of here. Installed
// before `selectActiveNode`, because that is what builds the first node's cache.
setCacheStorage(fileCacheStorage())

await selectActiveNode()

// The roster, and not one line earlier. `App` calls `initClientPlugins` at module scope, which runs
// every plugin's `activate` pass, and agents' primes its session store over HTTP as it goes. A static
// import here evaluated that before `installPlatform` had run, so `send` found no transport, took its
// no-broker fallback into global `fetch`, and handed Node a relative path to parse. The suite's
// harness already imports `App` this way (./harness.tsx).
const { App } = await import('./App')
// 110 chunks and 1.06 MB of it, evaluated here — half of everything this bundle contains, before a
// cell has been drawn. Phase 1 of the performance programme is what shrinks it, and
// scripts/check-startup-graph.mjs is what stops it growing back.
bootMark('App imported')

const tasks = await readJson<Task[]>(tasksRoute).catch(async (error: unknown) => {
  await platform.dispose()
  console.error(`acorn reached ${opened.nodeId} but could not read its tasks: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
bootMark('tasks read')
// `--task` opens one by id; without it the shell opens the first available Menu source.
// Refused here rather than drawn as an empty rail, because a name that matches nothing is a typo and
// a person wants to hear about it before the screen is redrawn.
if (values.task) {
  const task = tasks.find((candidate) => candidate.id === values.task)
  if (!task) {
    await platform.dispose()
    console.error(`No task ${values.task} on this node.`)
    process.exit(1)
  }
  activateTaskSignals(task)
}

// Third-party plugins: ask every node in the fleet what it carries, hash whatever is new into this
// device's own cache, and register the surfaces of every bundle it has already accepted. Anything it
// has not is queued for the trust prompt, which the shell draws as an overlay.
//
// Not awaited, for the reason the desktop's composition root gives: a fleet with an offline machine in
// it must not hold up the first frame, and a plugin pane appearing a moment after the shell does is
// the right trade (docs/plugins.md § Loaded plugins: the client half).
void syncPluginDistribution().then(syncPluginContributions).catch((error: unknown) => {
  console.warn('[plugins] could not read the fleet\'s plugins:', error)
})
// …and stay reconciled: a node that reloads a plugin in place broadcasts `plugins:changed`.
watchPluginChanges()

// The sound channel: an unseen agent edge rings the terminal. Imported here rather than at the top,
// for the reason every client-core import in this file is — the seam has to exist before a module
// that reaches the node is evaluated.
const { initBellNotices } = await import('./kit/bell')
const { setHostFocused } = await import('@acorn/client-core/features/notifications/deliver.ts')
initBellNotices()

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
const renderer = await createCliRenderer({ exitOnCtrlC: false, useKittyKeyboard: { disambiguate: true } })
bootMark('renderer created')
// Time to first draw. `@opentui/solid` exports a `TimeToFirstDraw` renderable that holds the same
// number, but it is an on-screen label: it would have to be mounted in the tree and would paint a debug
// overlay over the shell. The renderer's own first `frame` event is the same moment with nothing drawn
// over.
renderer.once(CliRenderEvents.FRAME, () => bootMark('first draw'))
// A library warning must not cover the screen. OpenTUI pops its console overlay over the frame on
// any `console.warn`/`error` once the renderer owns the terminal, so a single stray line from a
// dependency reads as the whole app going blank. Deactivated the same way the test harness does
// (./harness.tsx); anything logged still lands in the terminal's scrollback after quit.
renderer.console.deactivate()
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
  // The terminal is ours again, so the held output can go out: the boot account first, then anything
  // Node wanted to warn about while the screen was busy.
  printBootMarks()
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

await render(() => <App nodeId={opened.nodeId} supervised={opened.supervised} onQuit={() => void quit()} />, renderer)
