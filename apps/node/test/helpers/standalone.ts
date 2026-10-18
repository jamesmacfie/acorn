import { spawn, type ChildProcess, type StdioOptions } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'

// The standalone entry as a child process, for the lifecycle tests. `startStandalone` starts it the way
// a launcher does, on launcher pipes (docs/node-distribution.md § Runtime). The launchers share
// `launchNode` from @acorn/custody/local; this copy checks the Node's half of that contract without
// leaning on the launcher's.

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const READY_BUDGET_MS = 90_000

type Handshake = { nodeId: string; endpoint: string; fingerprint: string; certPem: string; deviceToken: string }

export function spawnStandalone(dataDir: string, stdio: StdioOptions, env: NodeJS.ProcessEnv = {}): ChildProcess {
  return spawn(process.execPath, ['--import', 'tsx', 'src/entries/standalone.ts'], {
    cwd: appRoot,
    env: {
      ...process.env,
      ACORN_DATA_DIR: dataDir,
      SESSION_ENC_KEY: '0'.repeat(64),
      GITHUB_CLIENT_ID: 'test-client',
      // vitest's environment is inherited, and a leaked ACORN_PORT would pin the port.
      ACORN_PORT: '',
      ...env,
    },
    stdio,
  })
}

export type StandaloneNode = { child: ChildProcess; ready: Promise<Handshake>; stderr(): string }

/** Starts a Node on launcher pipes with no previous token, so it issues the launcher a new device. */
export function startStandalone(dataDir: string, env: NodeJS.ProcessEnv = {}): StandaloneNode {
  const child = spawnStandalone(dataDir, ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'], {
    ...env,
    ACORN_LAUNCHER_PIPES: '1',
  })
  let stderr = ''
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
    console.error(`[standalone] ${chunk.toString().trimEnd()}`)
  })
  ;(child.stdio[4] as Writable).end('\n')
  const ready = new Promise<Handshake>((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error('standalone wrote no handshake')), READY_BUDGET_MS)
    timer.unref()
    createInterface({ input: child.stdio[3] as Readable }).once('line', (line) => {
      clearTimeout(timer)
      resolveReady(JSON.parse(line) as Handshake)
    })
    child.once('exit', (code) => reject(new Error(`standalone exited (${code}) before it was listening`)))
  })
  return { child, ready, stderr: () => stderr }
}

/** Sends SIGTERM and resolves with the exit code, or null if the budget runs out first. Never hangs
 *  the suite on the very failure a test is looking for. */
export function stopStandalone(child: ChildProcess, budgetMs: number): Promise<number | null> {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode)
  return new Promise((resolveExit) => {
    const timer = setTimeout(() => resolveExit(null), budgetMs)
    timer.unref()
    child.once('exit', (code) => {
      clearTimeout(timer)
      resolveExit(code)
    })
    child.kill('SIGTERM')
  })
}
