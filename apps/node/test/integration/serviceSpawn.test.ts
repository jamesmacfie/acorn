import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { request as httpsRequest } from 'node:https'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import type { ApiError } from '@acorn/protocol/api.ts'
import type { DevicesResponse, PairResult, PairingWindow } from '@acorn/protocol/node.ts'
import {
  SERVICE_PROTOCOL_VERSION,
  serviceStartResultSchema,
  type ServiceMessage,
  type ServiceStartResult,
  type ServiceState,
} from '@acorn/protocol/serviceProtocol.ts'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

class ServiceChild {
  readonly states: ServiceState[] = []
  private readonly child: ChildProcess
  private readonly pending = new Map<string, (message: ServiceMessage) => void>()
  private sequence = 0

  constructor(env: Record<string, string>) {
    this.child = spawn(process.execPath, ['--import', 'tsx', 'src/service/index.ts'], {
      cwd: appRoot,
      env: { ...process.env, ...env },
      // fd 3 is the channel. stdout/stderr piped rather than inherited so a boot failure shows up in the
      // test output instead of interleaving with vitest's reporter.
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })
    this.child.stderr?.on('data', (chunk: Buffer) => console.error(`[service] ${chunk.toString().trimEnd()}`))
    this.child.on('message', (raw) => {
      const message = raw as ServiceMessage
      if (message.kind === 'response') this.pending.get(message.id)?.(message)
      if (message.kind === 'event' && message.event === 'service.state') {
        this.states.push((message.payload as { state: ServiceState }).state)
      }
    })
  }

  request(method: 'service.start' | 'service.stop', payload: unknown, timeoutMs = 30_000): Promise<unknown> {
    const id = String(++this.sequence)
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => reject(new Error(`${method} timed out`)), timeoutMs)
      this.pending.set(id, (message) => {
        clearTimeout(timer)
        this.pending.delete(id)
        if (message.kind !== 'response') return
        if (message.ok) resolvePromise(message.result)
        else reject(new Error(message.error?.message ?? `${method} failed`))
      })
      this.child.send({ protocol: SERVICE_PROTOCOL_VERSION, kind: 'request', id, method, payload })
    })
  }

  waitForState(state: ServiceState, timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    const poll = async (): Promise<void> => {
      while (!this.states.includes(state)) {
        if (Date.now() > deadline) throw new Error(`timed out waiting for state '${state}'; saw ${this.states.join(' → ')}`)
        await new Promise((r) => setTimeout(r, 20))
      }
    }
    return poll()
  }

  kill(): void {
    this.child.kill('SIGKILL')
  }
}

// Full verification against the certificate the service reported. `agent: false` because https's global
// agent pools sockets and would let one call's terms serve another's.
type Reply = { status: number; body: string }

function call(
  started: ServiceStartResult,
  path: string,
  init: { method?: string; token?: string; body?: unknown; idempotencyKey?: string } = {},
): Promise<Reply> {
  const payload = init.body === undefined ? undefined : JSON.stringify(init.body)
  return new Promise((resolvePromise, reject) => {
    const req = httpsRequest(
      {
        host: '127.0.0.1',
        port: started.endpoint.port,
        path,
        method: init.method ?? 'GET',
        ca: [started.certPem],
        rejectUnauthorized: true,
        agent: false,
        headers: {
          ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
          ...(payload === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }),
          ...(init.idempotencyKey ? { 'idempotency-key': init.idempotencyKey } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => resolvePromise({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }))
      },
    )
    req.on('error', reject)
    if (payload !== undefined) req.write(payload)
    req.end()
  })
}

const get = async (started: ServiceStartResult, path: string): Promise<number> => (await call(started, path)).status

describe('the service as a spawned child process', () => {
  let child: ServiceChild | null = null
  let dataDir: string | null = null

  afterEach(() => {
    child?.kill()
    child = null
    if (dataDir) rmSync(dataDir, { recursive: true, force: true })
    dataDir = null
  })

  // Spawn a service on a fresh temp data root and complete the boot handshake. Shared by both cases so
  // each gets its own root, its own nodeId and its own certificate — a root reused between cases would
  // make "the token this node issued at boot" ambiguous.
  async function boot(): Promise<{ started: ServiceStartResult; service: ServiceChild }> {
    dataDir = mkdtempSync(join(tmpdir(), 'acorn-spawn-'))
    const service = new ServiceChild({
      SESSION_ENC_KEY: '0'.repeat(64),
      GITHUB_CLIENT_ID: 'test-client',
      GITHUB_CLIENT_SECRET: 'test-secret',
      // The parent inherits vitest's environment; an ACORN_PORT leaking in would pin the port and hide
      // the ephemeral path this whole phase depends on.
      ACORN_PORT: '',
    })
    child = service
    // No clientDir: the node serves no web assets, which is also why this test needs no renderer build.
    const result = await service.request('service.start', {
      dataDir,
      version: 'spawn-test',
      isPackaged: false,
      electronPath: process.execPath,
      mcpEntry: join(dataDir, 'unused-mcp.js'),
    })
    return { started: serviceStartResultSchema.parse(result), service }
  }

  it('boots over IPC, reports its endpoint and pin, serves TLS, and drains on request', async () => {
    const { started, service } = await boot()

    expect(started.endpoint.origin).toBe(`https://127.0.0.1:${started.endpoint.port}`)
    expect(started.nodeId).toMatch(/^[0-9a-f-]{36}$/)
    expect(started.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(started.deviceToken).toMatch(/^acorn_dt_/)

    // A real request over the wire, validated against the pin the child just handed back — which is the
    // one assertion that covers the whole chain at once: the certificate on disk, the listener serving
    // it, the port in the result, and the IP SAN.
    expect(await get(started, '/v2/node')).toBe(200)

    await service.waitForState('ready')
    // 'starting' is the entry's own acknowledgement before the runtime exists; the rest is the runtime's.
    expect(service.states).toEqual(['starting', 'migrating', 'listening', 'reconciling', 'ready'])

    await service.request('service.stop', {})
    expect(service.states.at(-1)).toBe('stopped')
    // The listener is closed and the data root's lock released, so nothing is left holding the temp dir.
    await expect(get(started, '/v2/node')).rejects.toThrow()
  }, 60_000)

  it('honours pairing, idempotency and revocation over the wire on a temp data root', async () => {
    const { started } = await boot()

    // The boot token is a real credential on a real node, so the authenticated surface answers to it —
    // and the device list shows exactly the one row the boot handshake created.
    const listed = await call(started, '/v2/core/devices', { token: started.deviceToken })
    expect(listed.status).toBe(200)
    expect((JSON.parse(listed.body) as DevicesResponse).devices.map((device) => device.name)).toEqual(['This computer'])

    // Idempotency-Key through the middleware createApp() mounts. POST /v2/core/pair/start mints a NEW
    // code on every call, so an identical body back is only explicable as the stored response.
    const key = randomUUID()
    const opened = await call(started, '/v2/core/pair/start', { method: 'POST', token: started.deviceToken, idempotencyKey: key })
    const replayed = await call(started, '/v2/core/pair/start', { method: 'POST', token: started.deviceToken, idempotencyKey: key })
    expect(opened.status).toBe(200)
    expect(replayed.status).toBe(200)
    expect(replayed.body).toBe(opened.body)

    // Spend the code the owner just opened, UNAUTHENTICATED — a client that has never paired holds no
    // credential, so this route is the only way in.
    const { code } = JSON.parse(opened.body) as PairingWindow
    const paired = await call(started, '/v2/pair', { method: 'POST', body: { code, deviceName: 'spawn-test laptop' } })
    expect(paired.status).toBe(200)
    const result = JSON.parse(paired.body) as PairResult
    expect(result.nodeId).toBe(started.nodeId)
    expect(result.deviceToken).toMatch(/^acorn_dt_/)
    expect((await call(started, '/v2/core/devices', { token: result.deviceToken })).status).toBe(200)

    // ...and revocation takes it away on the very next request, envelope and all.
    const revoke = await call(started, `/v2/core/devices/${result.device.id}`, { method: 'DELETE', token: started.deviceToken })
    expect(revoke.status).toBe(204)
    const after = await call(started, '/v2/core/devices', { token: result.deviceToken })
    expect(after.status).toBe(401)
    expect((JSON.parse(after.body) as ApiError).error.code).toBe('unauthenticated')
    // The revoking device is untouched: revocation is per-device, not a reset.
    expect((await call(started, '/v2/core/devices', { token: started.deviceToken })).status).toBe(200)
  }, 60_000)
})
