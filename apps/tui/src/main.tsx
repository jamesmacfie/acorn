/** @jsxImportSource @opentui/solid */
import { parseArgs } from 'node:util'
import { createCliRenderer } from '@opentui/core'
import { isTyping } from '@acorn/client-core/kit/keys/keymapHost.ts'
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
// Phase 3 (docs/future/terminal/phase-3-process-and-auth.md). What it still does not have is chrome:
// one pane on one task, no rail and no task switcher, which is phase 4.

const { values } = parseArgs({
  options: {
    node: { type: 'string' },
    pane: { type: 'string', default: 'notes' },
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

if (values.pane !== 'notes') {
  console.error('This build draws the notes pane only. The rail, the pane row and the task switcher are docs/future/terminal/phase-4-chrome.md.')
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

// The query cache persists to files rather than to IndexedDB, which there is none of here. Installed
// before `selectActiveNode`, because that is what builds the first node's cache.
setCacheStorage(fileCacheStorage())

await selectActiveNode()

const tasks = await readJson<Task[]>(tasksRoute).catch(async (error: unknown) => {
  await platform.dispose()
  console.error(`acorn reached ${opened.nodeId} but could not read its tasks: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
const task = values.task ? tasks.find((candidate) => candidate.id === values.task) : tasks[0]
if (!task) {
  await platform.dispose()
  console.error(values.task ? `No task ${values.task} on this node.` : 'This node has no tasks. Make one in the app first.')
  process.exit(1)
}

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

// Not an intent: quitting is the shell's, and phase 4 gives it a command and a confirm when the TUI
// is the thing that started the node.
engine.registerLayer({
  priority: 0,
  bindings: [
    { key: 'q', cmd: () => { void quit(); return true }, active: () => !isTyping() },
    { key: 'ctrl+c', cmd: () => { void quit(); return true } },
  ],
})
// A supervisor's SIGTERM drains the child this process started, which is the whole reason it waits.
process.once('SIGTERM', () => void quit())

await render(() => <App task={task} nodeId={opened.nodeId} />, renderer)
