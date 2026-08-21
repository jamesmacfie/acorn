import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

// Generous relative to the 30s deadline the drain itself carries. The point is to catch a hang, not
// to police the drain's speed on a loaded runner (CLAUDE.md § the suite is load-sensitive).
const EXIT_BUDGET_MS = 25_000

type Handshake = { nodeId: string; endpoint: string; deviceToken: string }

class StandaloneNode {
  readonly child: ChildProcess
  private readonly handshake: Promise<Handshake>

  constructor(dataDir: string) {
    this.child = spawn(process.execPath, ['--import', 'tsx', 'src/server/standalone.ts'], {
      cwd: appRoot,
      env: {
        ...process.env,
        ACORN_DATA_DIR: dataDir,
        SESSION_ENC_KEY: '0'.repeat(64),
        GITHUB_CLIENT_ID: 'test-client',
        // vitest's environment is inherited; a leaked ACORN_PORT would pin the port and make the
        // rebind implicit in "the process exited" mean something else.
        ACORN_PORT: '',
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ignore'],
    })
    this.child.stderr?.on('data', (chunk: Buffer) => console.error(`[standalone] ${chunk.toString().trimEnd()}`))
    this.handshake = new Promise<Handshake>((resolveHandshake, reject) => {
      const timer = setTimeout(() => reject(new Error('standalone printed no handshake line')), 90_000)
      timer.unref?.()
      let buffered = ''
      this.child.stdout?.on('data', (chunk: Buffer) => {
        buffered += chunk.toString()
        // The handshake is one line of JSON among free-form logging (server/standalone.ts's head
        // comment calls it the contract), so scan lines rather than assuming it arrives first or
        // alone.
        for (const line of buffered.split('\n')) {
          try {
            const parsed = JSON.parse(line) as Partial<Handshake>
            if (parsed.nodeId && parsed.endpoint && parsed.deviceToken) {
              clearTimeout(timer)
              resolveHandshake(parsed as Handshake)
              return
            }
          } catch {
            // not the contract line
          }
        }
        buffered = buffered.slice(buffered.lastIndexOf('\n') + 1)
      })
      this.child.once('exit', (code) => reject(new Error(`standalone exited (${code}) before it was listening`)))
    })
  }

  ready(): Promise<Handshake> {
    return this.handshake
  }

  // Resolves with the exit code, or null if the budget expires first. Never hangs the suite on the
  // very failure it is looking for.
  terminate(budgetMs: number): Promise<number | null> {
    return new Promise((resolveExit) => {
      const timer = setTimeout(() => resolveExit(null), budgetMs)
      timer.unref?.()
      this.child.once('exit', (code) => {
        clearTimeout(timer)
        resolveExit(code)
      })
      this.child.kill('SIGTERM')
    })
  }
}

describe('a standalone node drains on SIGTERM', () => {
  let node: StandaloneNode | null = null
  let dataDir: string | null = null

  afterEach(() => {
    node?.child.kill('SIGKILL')
    node = null
    if (dataDir) rmSync(dataDir, { recursive: true, force: true })
    dataDir = null
  })

  it('exits cleanly, and releases the data root so the next start can take the lock', async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'acorn-standalone-'))
    node = new StandaloneNode(dataDir)
    await node.ready()

    const code = await node.terminate(EXIT_BUDGET_MS)
    expect(code).toBe(0)

    // The lock is the observable half of "the drain finished in the right order": openDataRoot refuses a
    // root whose recorded pid is still live, so a second node starting here proves the first let go.
    const second = new StandaloneNode(dataDir)
    node = second
    await expect(second.ready()).resolves.toMatchObject({ endpoint: expect.stringContaining('https://127.0.0.1:') })
    expect(await second.terminate(EXIT_BUDGET_MS)).toBe(0)
    node = null
  }, 180_000)
})
