import { spawn, type ChildProcess } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocket } from 'ws'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { HELPER_PROTOCOL, type HelperMethod } from '../src/shell/wire'

// The boot test (docs/testing.md § The desktop boot test): does the shell's world come up.
//
// It runs the real thing — the staged helper bundle under the bundled Node runtime, spawning the real
// `service.js` over the fd-3 service protocol against a fresh data root — and then asks it the first
// two questions the renderer asks: which nodes are there, and can a `/v2` request reach one. That is
// phase 2's exit criterion minus the window, and it is what catches "the shell cannot load its world"
// the way `apps/node/test/integration/mainBarrelLoad.test.ts` catches barrel poisoning.
//
// What it deliberately does not do is drive the Rust shell. A headless Tauri app needs a display
// server, and the parts of the shell that could be wrong without one — the CSP, the traversal guard,
// the handshake shape, the signal parser — are Rust unit tests in `src-tauri/src/`. Between them
// nothing in the boot path is unexercised.

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const STAGING = join(PKG, 'dist/helper')

const nodeBinary = (): string => {
  const triple = /host: (\S+)/.exec(execFileSync('rustc', ['-vV'], { encoding: 'utf8' }))?.[1]
  return join(PKG, 'src-tauri/binaries', `node-${triple}`)
}

type Ready = { port: number; secret: string; nodeVersion: string; protocol: number }

let helper: ChildProcess
let dataDir: string
let ready: Ready
let socket: WebSocket
let nextId = 1

// One round trip on the same channel the renderer uses. Not a shared client: the point is that the
// wire works, so this test speaks it directly rather than through the bridge, which cannot run outside
// a webview anyway.
const call = <T>(method: HelperMethod, params?: unknown): Promise<T> =>
  new Promise((resolve_, reject) => {
    const id = nextId++
    const onMessage = (data: unknown): void => {
      const message = JSON.parse(String(data)) as { id?: number; ok?: boolean; value?: unknown; error?: string }
      if (message.id !== id) return
      socket.off('message', onMessage)
      if (message.ok) resolve_(message.value as T)
      else reject(new Error(message.error))
    }
    socket.on('message', onMessage)
    socket.send(JSON.stringify({ id, method, params: params ?? null }))
  })

beforeAll(async () => {
  for (const required of [join(STAGING, 'helper.js'), join(STAGING, 'service.js'), nodeBinary()]) {
    if (!existsSync(required)) throw new Error(`${required} is missing — run \`pnpm run stage\` first.`)
  }
  dataDir = mkdtempSync(join(tmpdir(), 'acorn-tauri-boot-'))

  helper = spawn(nodeBinary(), [join(STAGING, 'helper.js')], { stdio: ['pipe', 'pipe', 'inherit'] })
  const readyLine = new Promise<Ready>((resolve_, reject) => {
    const timer = setTimeout(() => reject(new Error('the helper never printed a ready line')), 120_000)
    createInterface({ input: helper.stdout! }).on('line', (line) => {
      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(line) as Record<string, unknown>
      } catch {
        return void console.log(line)
      }
      if (parsed['acorn-helper'] !== 'ready') return
      clearTimeout(timer)
      resolve_(parsed as unknown as Ready)
    })
    helper.once('exit', (code) => reject(new Error(`the helper exited with code ${code} before it was ready`)))
  })

  helper.stdin!.write(
    `${JSON.stringify({
      protocol: HELPER_PROTOCOL,
      dataKey: 'a'.repeat(64),
      dataDir: join(dataDir, 'node'),
      userDataDir: join(dataDir, 'shell'),
      serviceEntry: join(STAGING, 'service.js'),
      mcpEntry: join(STAGING, 'mcp.js'),
      envFiles: [],
      version: '0.0.0-test',
      isPackaged: false,
      appOrigin: 'app://acorn',
    })}\n`,
  )

  ready = await readyLine
  socket = new WebSocket(`ws://127.0.0.1:${ready.port}/helper?secret=${ready.secret}`, { origin: 'app://acorn' })
  await new Promise((done, fail) => {
    socket.once('open', done)
    socket.once('error', fail)
  })
}, 180_000)

afterAll(async () => {
  socket?.close()
  helper?.stdin?.write('{"command":"stop"}\n')
  await new Promise((done) => {
    if (!helper || helper.exitCode !== null) return done(undefined)
    const escalate = setTimeout(() => helper.kill('SIGKILL'), 15_000)
    helper.once('exit', () => {
      clearTimeout(escalate)
      done(undefined)
    })
  })
  rmSync(dataDir, { recursive: true, force: true })
}, 30_000)

describe('the Tauri shell boots its world', () => {
  it('runs the helper under the pinned Node runtime', () => {
    const pin = JSON.parse(readFileSync(resolve(PKG, '../../node-runtime.json'), 'utf8')) as { version: string }
    // The whole point of shipping a binary: `process.execPath` in the helper is what the node service,
    // the agents and the MCP registration are all spawned with.
    expect(ready.nodeVersion).toBe(`v${pin.version}`)
    expect(ready.protocol).toBe(HELPER_PROTOCOL)
  })

  it('adopts the local node into the fleet before the renderer connects', async () => {
    const fleet = await call<{ nodes: { nodeId: string; local: boolean }[]; statuses: unknown[] }>('fleet-list')
    const local = fleet.nodes.filter((node) => node.local)
    // Exactly one, and it cannot be unpaired: the app's own data root is what defines it.
    expect(local).toHaveLength(1)
    expect(local[0].nodeId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('carries a /v2 request through the broker to the node', async () => {
    const fleet = await call<{ nodes: { nodeId: string; local: boolean }[] }>('fleet-list')
    const nodeId = fleet.nodes.find((node) => node.local)!.nodeId
    const response = await call<{ status: number; body: string }>('node-fetch', {
      nodeId,
      request: { requestId: 'boot-test', path: '/v2/node', method: 'GET', headers: {} },
    })
    // 200 means the pinned TLS connection came up and the device token authenticated, which is the
    // whole custody stack end to end.
    expect(response.status).toBe(200)
    expect(JSON.parse(Buffer.from(response.body, 'base64').toString('utf8'))).toMatchObject({ nodeId })
  })

  it('refuses a socket without the secret', async () => {
    const refused = new WebSocket(`ws://127.0.0.1:${ready.port}/helper?secret=wrong`, { origin: 'app://acorn' })
    await expect(new Promise((done, fail) => {
      refused.once('open', () => done('opened'))
      refused.once('error', fail)
    })).rejects.toThrow()
  })

  it('answers a method it does not have instead of leaving the caller waiting', async () => {
    await expect(call('not-a-method' as never)).rejects.toThrow(/does not know/)
  })

  it('serves nothing over plain HTTP', async () => {
    const response = await fetch(`http://127.0.0.1:${ready.port}/helper`)
    // The listener exists to be upgraded. Anything else is 426, which is what keeps the renderer's
    // widened connect-src down to a WebSocket origin.
    expect(response.status).toBe(426)
  })
})
