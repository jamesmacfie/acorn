/** @jsxImportSource @opentui/solid */
import { parseArgs } from 'node:util'
import { createCliRenderer } from '@opentui/core'
import { render } from '@opentui/solid'
import type { Task } from '@acorn/protocol/api.ts'
import { installPlatform } from './platform'
import { openNode } from './node/open'
import { installKeymap } from './keys/install'
import { App } from './App'

// `acorn`.
//
//   acorn                          the node for this machine's data root: attach if one is running,
//                                  start and supervise one if not
//   acorn --node <https://host>     pair with a node elsewhere, then open it
//   acorn --node <name>             open a node this device already paired with
//
// Phases 3 and 4 (docs/future/terminal/phase-4-chrome.md). The shell is whole: a rail of tasks, a
// pane strip, a palette, a footer that says what the keyboard will do. What it does not have yet is
// most of the panes, which is the pane sweep.

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

const tasks = await readJson<Task[]>(tasksRoute).catch(async (error: unknown) => {
  await platform.dispose()
  console.error(`acorn reached ${opened.nodeId} but could not read its tasks: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
// `--task` opens one by id; without it the shell opens the first task in the workspace it lands on.
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

// The renderer is built here rather than left to `render`, because the keymap's terminal adapter
// binds to it and `render` hands it back to nobody.
//
// `exitOnCtrlC` is off: Ctrl+C at the shell is the TUI's, and inside an entered PTY rectangle it is
// the PTY's, which is the whole reason a rectangle owns its keys (docs/future/terminal/03-process-model.md
// § Signals and exit). The renderer handles `SIGWINCH` itself, so a resize is its alone and nothing
// here listens for one.
const renderer = await createCliRenderer({ exitOnCtrlC: false })
const engine = installKeymap(renderer)

// The terminal comes back first, then the node drains. A node that started here gets its bounded
// SIGTERM drain; one this TUI only attached to is left running, because whoever started it owns it.
async function quit(code = 0): Promise<never> {
  if (leaving) return await new Promise<never>(() => {}) // a second Ctrl+C during the drain waits
  leaving = true
  renderer.destroy()
  await platform.dispose()
  process.exit(code)
}

// `q` is the shell's, registered as a command with a confirm when this TUI is the thing that started
// the node (chrome/Shell.tsx). `Ctrl+C` is not: it is the signal a terminal sends to say stop now,
// and it stops now. Inside an entered rectangle it never reaches here at all, which is the whole
// point of the Rectangle contract.
engine.registerLayer({
  priority: 0,
  bindings: [{ key: 'ctrl+c', cmd: () => { void quit(); return true } }],
})
// A supervisor's SIGTERM drains the child this process started, which is the whole reason it waits.
process.once('SIGTERM', () => void quit())

await render(() => <App nodeId={opened.nodeId} supervised={opened.supervised} onQuit={() => void quit()} />, renderer)
