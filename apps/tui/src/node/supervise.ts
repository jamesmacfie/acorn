import type { ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { launchNode, requestNodeStop, type NodeEntry, type NodeHandshake } from '@acorn/custody/local'
import { findWorkspaceRoot } from '@acorn/node-core/server/storage/paths.ts'
import { join } from 'node:path'

// Starting a node and owning its lifetime, for the case where nothing holds the data root yet.
//
// This is not `packages/custody/src/supervision/serviceHost.ts`. The helper's supervisor drives
// `service.js` over an fd-3 RPC channel it opens before the service has bound anything; a standalone
// node announces itself with one JSON line on a launcher pipe and speaks no RPC at all
// (`launchNode`). Two protocols in one class would be worse than the forty lines below, and the part
// worth sharing — ask to stop, then SIGKILL — is a few of them.

/** How long a node gets to drain after it is asked to stop before it is killed. Its own handler closes the
 *  listener, the PTYs and SQLite, and releases the root's lock, which is worth waiting for; a wedged
 *  one still holding that lock is worse than a hard kill. The same five seconds the desktop helper
 *  allows (packages/custody/src/supervision/serviceHost.ts). */
const KILL_ESCALATION_MS = 5_000

/** How many of the child's stderr lines are kept. A node that fails to boot says so in its last few
 *  lines, and a node that boots fine can log for hours: holding all of it would be a leak in the one
 *  process that is also drawing. */
const HELD_STDERR_LINES = 200

export type SupervisedNode = {
  /** The child's boot line, still in flight. Not awaited by `startNode`, so the shell can draw while
   *  the node boots (docs/tui/process.md § Attach or start). */
  handshake: Promise<NodeHandshake>
  /** Whatever the child wrote to stderr, in order, for printing once the renderer has handed the
   *  terminal back. Piped rather than inherited: stderr is the file the renderer draws on, so a line
   *  arriving mid-session reads as the shell going to garbage. */
  held: readonly string[]
  stop(): Promise<void>
}

/** Where the node's entry lives. Beside this bundle in a packaged artifact, which is what
 *  `bin/acorn` and the tarball give us (docs/tui.md); in a checkout fall back to the source entry
 *  under tsx, which is what `pnpm dev:node` runs. */
function nodeEntry(): NodeEntry {
  // The PTY agent stages the built Node with its external runtime packages beside the artifact.
  // ESM package resolution ignores NODE_PATH, so it passes that entry explicitly.
  const agentEntry = process.env.ACORN_TUI_NODE_ENTRY
  if (agentEntry) return { command: process.execPath, args: [agentEntry] }
  // Two candidates rather than one, because this file may end up in `dist/` or in `dist/chunks/`
  // depending on how rollup splits it, and `standalone.js` sits in `dist/`.
  const packaged = ['./standalone.js', '../standalone.js'].map((at) => fileURLToPath(new URL(at, import.meta.url)))
  const built = packaged.find((candidate) => existsSync(candidate))
  if (built) return { command: process.execPath, args: [built] }
  const app = join(findWorkspaceRoot(fileURLToPath(import.meta.url)), 'apps/node')
  const source = join(app, 'src/entries/standalone.ts')
  if (!existsSync(source))
    throw new Error(`acorn could not find a node to start: none of ${[...packaged, source].join(', ')} exists.`)
  // From apps/node, because that is where `tsx` is a dependency and where `pnpm dev:node` runs it.
  return { command: process.execPath, args: ['--import', 'tsx', source], cwd: app }
}

/** Start a node against `dataDir`. Returns as soon as the child is spawned; its boot line arrives on
 *  `handshake`.
 *
 *  Not awaited here, and that is the point: the renderer is created and the shell drawn while the
 *  child boots, which in a checkout with no build is a full tsx boot of the node
 *  (docs/tui/process.md § Attach or start).
 *
 *  `deviceToken` is whatever this TUI already holds for this data root. The node reuses a token that
 *  still authenticates and mints one otherwise, so passing it is what stops every launch adding a
 *  device row (server/auth/deviceTokens.ts § resolveDeviceToken). */
export function startNode(dataDir: string, deviceToken?: string): SupervisedNode {
  const { child, handshake } = launchNode({
    entry: nodeEntry(),
    dataDir,
    previousToken: deviceToken,
    // A full-screen renderer owns this terminal, so the node's stdout is dropped rather than drawn over
    // the top of the workspace. stderr is piped for the same reason and held, because a boot failure is
    // the one thing worth reading afterwards.
    stdout: 'ignore',
    stderr: 'pipe',
  })

  const held: string[] = []
  createInterface({ input: child.stderr! }).on('line', (line) => {
    if (held.length >= HELD_STDERR_LINES) held.shift()
    held.push(line)
  })

  let ready: NodeHandshake | undefined
  handshake.then(
    (value) => (ready = value),
    () => {},
  )
  return { handshake, held, stop: () => stop(child, ready) }
}

// Asked over the stop route, because Windows ends a process outright for SIGTERM and skips the drain.
// SIGTERM covers a node still booting, or one that doesn't take the request.
async function stop(child: ChildProcess, ready: NodeHandshake | undefined): Promise<void> {
  if (child.exitCode !== null) return
  const exited = new Promise<void>((done) => child.once('exit', () => done()))
  const escalate = setTimeout(() => child.kill('SIGKILL'), KILL_ESCALATION_MS)
  escalate.unref?.()
  if (!ready || !(await requestNodeStop(ready, ready.deviceToken))) child.kill('SIGTERM')
  await exited
  clearTimeout(escalate)
}
