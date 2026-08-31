/** @jsxImportSource @opentui/solid */
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { createCliRenderer } from '@opentui/core'
import { render } from '@opentui/solid'
import type { Task } from '@acorn/protocol/api.ts'
import { installPlatform, readHandshake } from './platform'
import { installKeymap } from './keys'
import { App } from './App'

// `acorn`, phase 0. Attach-or-start, pairing and the config directory are phase 3; this is handed the
// node's own boot line and told which task to open.
//
//   pnpm dev:node                                   # copy its first line, which is JSON
//   ACORN_NODE_HANDSHAKE='<that line>' pnpm --filter @acorn/tui dev
//
// `--handshake <file>` reads it from a file instead, which is easier to live with than a very long
// environment variable.

const { values } = parseArgs({
  options: {
    pane: { type: 'string', default: 'notes' },
    task: { type: 'string' },
    handshake: { type: 'string' },
  },
  allowPositionals: false,
})

// OpenTUI's render core is Zig reached over `node:ffi`, a Node 26.4 builtin behind a flag. Checked
// here rather than left to the loader, because the failure it produces otherwise is a stack trace from
// inside a chunk. Not declared as an `engines` floor on this package: the rest of the repo builds and
// tests this one happily on the Node it already has, and only running it needs 26.4 (FINDINGS.md,
// "The runtime floor").
const [nodeMajor = 0, nodeMinor = 0] = process.versions.node.split('.').map(Number)
if (nodeMajor < 26 || (nodeMajor === 26 && nodeMinor < 4)) {
  console.error(`acorn draws with OpenTUI, which needs Node 26.4 or later started with --experimental-ffi. This is Node ${process.versions.node}.`)
  process.exit(2)
}

if (values.pane !== 'notes') {
  console.error('This build draws the notes pane only. See docs/future/terminal/phase-1-kit-complete.md.')
  process.exit(2)
}

const raw = values.handshake ? readFileSync(values.handshake, 'utf8').trim() : process.env.ACORN_NODE_HANDSHAKE
if (!raw) {
  console.error('Set ACORN_NODE_HANDSHAKE to the JSON line `pnpm dev:node` prints first, or pass --handshake <file>.')
  process.exit(2)
}

const { broker } = installPlatform(readHandshake(raw))

// Nothing that reaches the node may be imported before the seam exists: an import is evaluated once,
// and a module that reads `window.acorn` at its top level would read it before the line above ran.
const { selectActiveNode } = await import('@acorn/client-core/infra/node/activeNode.ts')
const { readJson } = await import('@acorn/client-core/infra/node/apiClient.ts')
const { tasksRoute } = await import('@acorn/protocol/api.ts')

await selectActiveNode()

const tasks = await readJson<Task[]>(tasksRoute)
const task = values.task ? tasks.find((candidate) => candidate.id === values.task) : tasks[0]
if (!task) {
  console.error(values.task ? `No task ${values.task} on this node.` : 'This node has no tasks. Make one in the app first.')
  process.exit(1)
}

// The renderer is built here rather than left to `render`, because the keymap's terminal adapter
// binds to it and `render` hands it back to nobody.
const renderer = await createCliRenderer({ exitOnCtrlC: true })
installKeymap(renderer, () => {
  renderer.destroy()
  broker.dispose()
  process.exit(0)
})
await render(() => <App task={task} />, renderer)
