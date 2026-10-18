import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'
import { ACORN_BASELINE } from '@acorn/protocol/baseline.ts'
import { NODE_PROTOCOL_VERSION } from '@acorn/protocol/node.ts'

// How a launcher starts a standalone Node and gets the device token the Node issues it
// (docs/node-distribution.md § Runtime). The token has full owner authority, so it travels only over
// two private pipes, never in an argument, an environment variable, or the Node's output: the launcher
// writes the token it already holds to the child's fd 4, and the Node writes its handshake, token
// included, to fd 3.

export type NodeHandshake = {
  baseline: typeof ACORN_BASELINE
  protocolVersion: typeof NODE_PROTOCOL_VERSION
  nodeId: string
  endpoint: string
  fingerprint: string
  certPem: string
  deviceToken: string
}

export type NodeEntry = { command: string; args: string[]; cwd?: string }

export type LaunchedNode = { child: ChildProcess; handshake: Promise<NodeHandshake> }

/** The Node sent no handshake before the deadline. The CLI reports it with its timeout exit code. */
export class NodeStartTimeout extends Error {}

// A first boot under tsx in a checkout is the slow case this covers.
const HANDSHAKE_DEADLINE_MS = 120_000

export function launchNode(options: {
  entry: NodeEntry
  dataDir: string
  /** The token this launcher already holds for the data root. The Node reuses it while it still
   *  authenticates, which is what stops every launch adding a device row. */
  previousToken?: string
  env?: NodeJS.ProcessEnv
  stdout: 'ignore' | 'pipe' | number
  stderr: 'ignore' | 'pipe' | number
  detached?: boolean
}): LaunchedNode {
  const { entry } = options
  const child = spawn(entry.command, entry.args, {
    ...(entry.cwd ? { cwd: entry.cwd } : {}),
    detached: options.detached,
    env: { ...process.env, ...options.env, ACORN_DATA_DIR: options.dataDir, ACORN_LAUNCHER_PIPES: '1' },
    stdio: ['ignore', options.stdout, options.stderr, 'pipe', 'pipe'],
  })
  // An empty line asks for a new device. A child that dies before reading it leaves the bytes unread,
  // and Linux then resets this pipe under us. The exit and timeout handlers below already report that
  // death, so the reset needs a listener only to stop it crashing the launcher.
  ;(child.stdio[4] as Writable).on('error', () => {}).end(`${options.previousToken ?? ''}\n`)
  const handshake = new Promise<NodeHandshake>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new NodeStartTimeout('The Node did not become ready before the startup deadline.')),
      HANDSHAKE_DEADLINE_MS,
    )
    timer.unref()
    const lines = createInterface({ input: child.stdio[3] as Readable })
    lines.once('line', (line) => {
      clearTimeout(timer)
      lines.close()
      const parsed = parseHandshake(line)
      if (parsed) return resolve(parsed)
      // It still holds the data root's lock, and nothing will drive it.
      child.kill('SIGTERM')
      reject(
        new Error(
          `The Node has no matching ${ACORN_BASELINE} baseline or protocol ${NODE_PROTOCOL_VERSION}. Reset or rebuild it before starting.`,
        ),
      )
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`The Node exited with code ${code} before readiness.`))
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
  return { child, handshake }
}

function parseHandshake(line: string): NodeHandshake | null {
  try {
    const parsed = JSON.parse(line) as Partial<NodeHandshake>
    const usable =
      parsed.baseline === ACORN_BASELINE &&
      parsed.protocolVersion === NODE_PROTOCOL_VERSION &&
      parsed.nodeId &&
      parsed.endpoint &&
      parsed.fingerprint &&
      parsed.certPem &&
      parsed.deviceToken
    return usable ? (parsed as NodeHandshake) : null
  } catch {
    return null
  }
}
