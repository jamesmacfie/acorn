import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { findWorkspaceRoot } from '@acorn/node-core/server/storage/paths.ts'
import { join } from 'node:path'

// Starting a node and owning its lifetime, for the case where nothing holds the data root yet.
//
// This is not `packages/custody/src/supervision/serviceHost.ts`, and that is a departure from the
// plan. The helper's supervisor drives `service.js` over an fd-3 RPC channel it opens before the
// service has bound anything; a standalone node announces itself with one JSON line on stdout and
// speaks no RPC at all (apps/node/src/entries/standalone.ts). Two protocols in one class would be
// worse than the forty lines below, and the part worth sharing — SIGTERM then SIGKILL — is six of
// them.

/** The node's boot line, as the standalone entry prints it. */
export type Handshake = {
  nodeId: string
  endpoint: string
  fingerprint?: string
  certPem?: string
  deviceToken: string
}

/** How long a node gets to drain after SIGTERM before it is killed. Its own handler closes the
 *  listener, the PTYs and SQLite, and releases the root's lock, which is worth waiting for; a wedged
 *  one still holding that lock is worse than a hard kill. The same five seconds the desktop helper
 *  allows (packages/custody/src/supervision/serviceHost.ts). */
const KILL_ESCALATION_MS = 5_000
const HANDSHAKE_BUDGET_MS = 120_000

/** How many of the child's stderr lines are kept. A node that fails to boot says so in its last few
 *  lines, and a node that boots fine can log for hours: holding all of it would be a leak in the one
 *  process that is also drawing. */
const HELD_STDERR_LINES = 200

export type SupervisedNode = {
  /** The child's boot line, still in flight. Not awaited by `startNode`, so the shell can draw while
   *  the node boots (docs/tui.md § Attach or start). */
  handshake: Promise<Handshake>
  /** Whatever the child wrote to stderr, in order, for printing once the renderer has handed the
   *  terminal back. Piped rather than inherited: stderr is the file the renderer draws on, so a line
   *  arriving mid-session reads as the shell going to garbage. */
  held: readonly string[]
  stop(): Promise<void>
}

/** Where the node's entry lives. Beside this bundle in a packaged artifact, which is what
 *  `bin/acorn` and the tarball give us (docs/tui.md); in a checkout there
 *  is no build, so fall back to the source entry under tsx, which is what `pnpm dev:node` runs. */
function nodeEntry(): { command: string; args: string[]; cwd?: string } {
  // Two candidates rather than one, because this file may end up in `dist/` or in `dist/chunks/`
  // depending on how rollup splits it, and `standalone.js` sits in `dist/`. Phase 7 pins that layout
  // and can drop whichever of these it does not use.
  const packaged = ['./standalone.js', '../standalone.js'].map((at) => fileURLToPath(new URL(at, import.meta.url)))
  const built = packaged.find((candidate) => existsSync(candidate))
  if (built) return { command: process.execPath, args: [built] }
  const app = join(findWorkspaceRoot(fileURLToPath(import.meta.url)), 'apps/node')
  const source = join(app, 'src/entries/standalone.ts')
  if (!existsSync(source)) throw new Error(`acorn could not find a node to start: none of ${[...packaged, source].join(', ')} exists.`)
  // From apps/node, because that is where `tsx` is a dependency and where `pnpm dev:node` runs it.
  return { command: process.execPath, args: ['--import', 'tsx', source], cwd: app }
}

/** Start a node against `dataDir`. Returns as soon as the child is spawned; its boot line arrives on
 *  `handshake`.
 *
 *  Not awaited here, and that is the point: the renderer is created and the shell drawn while the
 *  child boots, which in a checkout with no build is a full tsx boot of the node
 *  (docs/future/performance/decisions.md § Every host draws first).
 *
 *  `deviceToken` is whatever this TUI already holds for this data root. The node reuses a token that
 *  still authenticates and mints one otherwise, so passing it is what stops every launch adding a
 *  device row (server/auth/deviceTokens.ts § resolveDeviceToken). */
export function startNode(dataDir: string, deviceToken?: string): SupervisedNode {
  const { command, args, cwd } = nodeEntry()
  const child = spawn(command, args, {
    ...(cwd ? { cwd } : {}),
    env: { ...process.env, ACORN_DATA_DIR: dataDir, ...(deviceToken ? { ACORN_DEVICE_TOKEN: deviceToken } : {}) },
    // stdin closed, because the node never reads it. stdout is ours until the handshake arrives, and
    // then it is drained: a full-screen renderer owns this terminal, so the node's logging is dropped
    // rather than drawn over the top of the workspace. stderr is piped for the same reason and held,
    // because a boot failure is the one thing worth reading afterwards.
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const held: string[] = []
  createInterface({ input: child.stderr! }).on('line', (line) => {
    if (held.length >= HELD_STDERR_LINES) held.shift()
    held.push(line)
  })

  const handshake = new Promise<Handshake>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The node printed no handshake line.')), HANDSHAKE_BUDGET_MS)
    timer.unref?.()
    const lines = createInterface({ input: child.stdout! })
    // The handshake is one line of JSON among free-form logging, so every line is tried rather than
    // the first one taken (apps/node/test/integration/lifecycle/ does the same).
    lines.on('line', (line) => {
      try {
        const parsed = JSON.parse(line) as Partial<Handshake>
        if (!parsed.nodeId || !parsed.endpoint || !parsed.deviceToken) return
        clearTimeout(timer)
        lines.close()
        child.stdout?.resume() // drained, not read: a paused pipe would block the node's own logging
        resolve(parsed as Handshake)
      } catch {
        // not the contract line
      }
    })
    child.once('exit', (code) => reject(new Error(`The node exited with code ${code} before it was listening.`)))
    child.once('error', reject)
  })

  return { handshake, held, stop: () => stop(child) }
}

function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve()
  return new Promise((done) => {
    const escalate = setTimeout(() => child.kill('SIGKILL'), KILL_ESCALATION_MS)
    escalate.unref?.()
    child.once('exit', () => {
      clearTimeout(escalate)
      done()
    })
    child.kill('SIGTERM')
  })
}
