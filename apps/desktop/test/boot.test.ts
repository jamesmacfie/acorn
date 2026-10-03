import { spawn, type ChildProcess } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocket } from 'ws'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { HELPER_PROTOCOL, type HelperMethod } from '../src/shell/wire'
import { ACORN_BASELINE } from '@acorn/protocol/baseline.ts'
import { PLUGIN_API_MAJOR } from '@acorn/protocol/plugin/apiVersion.ts'

// The boot test (docs/testing/desktop.md § The desktop boot test): does the shell's world come up.
//
// It runs the real thing — the staged helper bundle under the bundled Node runtime, spawning the real
// `service.js` over the fd-3 service protocol against a fresh data root — and then asks it the first
// two questions the renderer asks: which nodes are there, and can a `/v1` request reach one. That is
// the exit criterion minus the window, and it is what catches "the shell cannot load its world"
// the way `apps/node/test/integration/mainBarrelLoad.test.ts` catches barrel poisoning.
//
// It also holds the boot ORDER, which is the thing a reader is most likely to undo by accident. The
// ready line goes out when the helper is listening, not when the node is up
// (docs/shell.md § The shell process), so the window can open on the persisted cache. `ACORN_PERF=1`
// makes the helper print its own marks on stderr and this test reads their order back.
//
// What it deliberately does not do is drive the Rust shell. A headless Tauri app needs a display
// server, and the parts of the shell that could be wrong without one — the CSP, the traversal guard,
// the handshake shape, the signal parser — are Rust unit tests in `src-tauri/src/`. Between them
// nothing in the boot path is unexercised.

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const resources = process.env.ACORN_BOOT_RESOURCES
const STAGING = resources ? join(resources, 'helper') : join(PKG, 'dist/helper')
const appOrigin = process.platform === 'win32' ? 'http://app.localhost' : 'app://acorn'

const nodeBinary = (): string => {
  if (process.env.ACORN_BOOT_NODE) return process.env.ACORN_BOOT_NODE
  const triple = /host: (\S+)/.exec(execFileSync('rustc', ['-vV'], { encoding: 'utf8' }))?.[1]
  return join(PKG, 'src-tauri/binaries', `node-${triple}${process.platform === 'win32' ? '.exe' : ''}`)
}

type Ready = { port: number; secret: string; nodeVersion: string; protocol: number }

let helper: ChildProcess
let dataDir: string
let ready: Ready
let socket: WebSocket
let nextId = 1
// The helper's `[helper:boot] <label> +<ms>ms` marks, in the order they were printed, and each
// one's offset from the helper's start.
const bootMarks: string[] = []
const markOffsets = new Map<string, number>()
const markIndex = (label: string): number => bootMarks.indexOf(label)
const devicePluginId = 'boot-probe'
const deviceBundle = 'export default {}'
const deviceHash = createHash('sha256').update(deviceBundle).digest('hex')

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
  // The cache predates this launch. The helper must retain device bytes without a node roster, and
  // return an unacknowledged manifest so the renderer can queue its trust prompt at first paint.
  const cacheDir = join(dataDir, 'shell', `${ACORN_BASELINE}-plugin-cache`)
  mkdirSync(cacheDir, { recursive: true })
  writeFileSync(join(cacheDir, `${deviceHash}.js`), deviceBundle)
  writeFileSync(join(cacheDir, 'index.json'), JSON.stringify({ version: 1, entries: {
    [deviceHash]: {
      pluginId: devicePluginId, version: '1.0.0', bytes: Buffer.byteLength(deviceBundle),
      nodeIds: [], source: { kind: 'device' }, sourceLabel: 'https://example.com/boot-probe.tgz',
      manifest: {
        id: devicePluginId, name: 'Boot Probe', version: '1.0.0', baseline: ACORN_BASELINE,
        apiVersion: PLUGIN_API_MAJOR, client: 'client.js',
      },
      firstSeen: Date.now(), lastSeen: Date.now(),
    },
  } }))

  // stderr piped rather than inherited, because that is where the boot marks are and the order of
  // them is an assertion below. They are still echoed, so a failing run reads the same as before.
  // First-run boot must work without host tools such as OpenSSL. Remove every spelling of PATH
  // because Windows treats environment variable names as case-insensitive.
  const bootEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toUpperCase() !== 'PATH'))
  helper = spawn(nodeBinary(), [join(STAGING, 'helper.js')], {
    cwd: dataDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...bootEnv, PATH: join(dataDir, 'no-host-tools'), ACORN_PERF: '1' },
  })
  createInterface({ input: helper.stderr! }).on('line', (line) => {
    console.error(line)
    const mark = /^\[helper:boot] (.+?) \+(\d+)ms/.exec(line)
    if (mark) {
      bootMarks.push(mark[1])
      markOffsets.set(mark[1], Number(mark[2]))
    }
  })
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
      isPackaged: Boolean(resources),
      ...(resources ? { bundledPluginsDir: join(resources, 'plugins') } : {}),
      appOrigin,
    })}\n`,
  )

  ready = await readyLine
  socket = new WebSocket(`ws://127.0.0.1:${ready.port}/helper?secret=${ready.secret}`, { origin: appOrigin })
  await new Promise((done, fail) => {
    socket.once('open', done)
    socket.once('error', fail)
  })
  // The node boots behind the ready line, so the fleet is empty for a moment after this socket opens.
  // The renderer lives with that by drawing its persisted cache; a test that wants to ask the node
  // something has to wait, which is also how it observes that adoption happened at all.
  await waitFor(async () => (await call<{ nodes: { local: boolean }[] }>('fleet-list')).nodes.some((node) => node.local), 'the local node was never adopted')
  await waitFor(() => markIndex('service.start') !== -1, 'the helper never recorded starting the node')
}, 180_000)

// Poll until it is true, or say what never happened. No fake timers: everything here is a real
// process coming up.
async function waitFor(condition: () => boolean | Promise<boolean>, complaint: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await condition()) return
    await new Promise((done) => setTimeout(done, 50))
  }
  throw new Error(complaint)
}

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
  it('keeps a cached device bundle untrusted for the renderer to prompt', async () => {
    const state = await call<{ cached: Record<string, { source?: { kind: string }; manifest?: { id: string } }>; acks: { pluginId: string }[] }>('plugins-state')
    expect(state.cached[deviceHash]).toMatchObject({ source: { kind: 'device' }, manifest: { id: devicePluginId } })
    expect(state.acks.some((ack) => ack.pluginId === devicePluginId)).toBe(false)
  })

  it('runs the helper under the pinned Node runtime', () => {
    const pin = JSON.parse(readFileSync(resolve(PKG, '../../node-runtime.json'), 'utf8')) as { version: string }
    // The whole point of shipping a binary: `process.execPath` in the helper is what the node service,
    // the agents and the MCP registration are all spawned with.
    expect(ready.nodeVersion).toBe(`v${pin.version}`)
    expect(ready.protocol).toBe(HELPER_PROTOCOL)
  })

  it('says it is ready when it is listening, not when the node is up', () => {
    // The whole of phase 2's desktop half, in three offsets. Rust blocks on the ready line and opens
    // the window on it, so anything the helper does after that mark is behind the first paint. The
    // node's boot is `service.start`, and it has to be one of those things.
    expect(bootMarks).toContain('ready line')
    expect(bootMarks).toContain('service.start')
    expect(markIndex('ws bound')).toBeLessThan(markIndex('ready line'))
    expect(markIndex('ready line')).toBeLessThan(markIndex('service.start'))
    expect(markIndex('service.start')).toBeLessThan(markIndex('node adopted'))
  })

  it('starts the node within a generous bound', () => {
    // From the ready line to the node answering `service.start`: spawning it, evaluating the service
    // bundle, and its whole boot to a bound listener. About 270 ms on an M2 Pro, but Windows CI
    // measured 2,705-5,126 ms on 2026-10-01. Run this separately from the unit suites and leave
    // room for shared-runner variation while catching startup regressions.
    const elapsed = markOffsets.get('service.start')! - markOffsets.get('ready line')!
    console.log(`[boot-test] node started ${elapsed}ms after the ready line`)
    expect(elapsed).toBeLessThan(process.platform === 'win32' ? 10_000 : 1_500)
  })

  it('adopts the local node into the fleet behind the ready line', async () => {
    const fleet = await call<{ nodes: { nodeId: string; local: boolean }[]; statuses: unknown[] }>('fleet-list')
    const local = fleet.nodes.filter((node) => node.local)
    // Exactly one, and it cannot be unpaired: the app's own data root is what defines it.
    expect(local).toHaveLength(1)
    expect(local[0].nodeId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('carries a /v1 request through the broker to the node', async () => {
    const fleet = await call<{ nodes: { nodeId: string; local: boolean }[] }>('fleet-list')
    const nodeId = fleet.nodes.find((node) => node.local)!.nodeId
    const response = await call<{ status: number; body: string }>('node-fetch', {
      nodeId,
      request: { requestId: 'boot-test', path: '/v1/node', method: 'GET', headers: {} },
    })
    // 200 means the pinned TLS connection came up and the device token authenticated, which is the
    // whole custody stack end to end.
    expect(response.status).toBe(200)
    expect(JSON.parse(Buffer.from(response.body, 'base64').toString('utf8'))).toMatchObject({ nodeId })
  })

  it('refuses a socket without the secret', async () => {
    const refused = new WebSocket(`ws://127.0.0.1:${ready.port}/helper?secret=wrong`, { origin: appOrigin })
    await expect(new Promise((done, fail) => {
      refused.once('open', () => done('opened'))
      refused.once('error', fail)
    })).rejects.toThrow()
  })

  it('refuses a different origin even with the correct secret', async () => {
    const refused = new WebSocket(`ws://127.0.0.1:${ready.port}/helper?secret=${ready.secret}`, { origin: 'http://example.com' })
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
