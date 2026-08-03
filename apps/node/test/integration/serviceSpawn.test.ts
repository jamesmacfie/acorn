import { spawn, type ChildProcess } from 'node:child_process'
import { request as httpsRequest } from 'node:https'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  SERVICE_PROTOCOL_VERSION,
  serviceStartResultSchema,
  type ServiceMessage,
  type ServiceStartResult,
  type ServiceState,
} from '@acorn/protocol/serviceProtocol.ts'

// The service as a real, separately-spawned process — the thing every other test in this repo stubs.
//
// This exists because the supervision channel is now an ordinary Node IPC channel rather than Electron's
// utilityProcess, which means the whole handshake can be exercised under PLAIN NODE, with no Electron
// anywhere: spawn, service.start, the state sequence, a validated HTTPS request against the reported
// pin, and an ordered service.stop. Under utilityProcess none of that was reachable from a unit test,
// and the first thing to find out that the boot handshake was broken would have been a person.
//
// What it cannot cover is the PACKAGED path (Electron's binary under ELECTRON_RUN_AS_NODE, loading the
// bundled artifact out of app.asar). That is the desktop smoke suite's job.

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
function get(started: ServiceStartResult, path: string): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const req = httpsRequest(
      { host: '127.0.0.1', port: started.endpoint.port, path, ca: [started.certPem], rejectUnauthorized: true, agent: false },
      (res) => {
        res.resume()
        res.on('end', () => resolvePromise(res.statusCode ?? 0))
      },
    )
    req.on('error', reject)
    req.end()
  })
}

describe('the service as a spawned child process', () => {
  let child: ServiceChild | null = null
  let dataDir: string | null = null

  afterEach(() => {
    child?.kill()
    child = null
    if (dataDir) rmSync(dataDir, { recursive: true, force: true })
    dataDir = null
  })

  it('boots over IPC, reports its endpoint and pin, serves TLS, and drains on request', async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'acorn-spawn-'))
    child = new ServiceChild({
      SESSION_ENC_KEY: '0'.repeat(64),
      GITHUB_CLIENT_ID: 'test-client',
      GITHUB_CLIENT_SECRET: 'test-secret',
      // The parent inherits vitest's environment; an ACORN_PORT leaking in would pin the port and hide
      // the ephemeral path this whole phase depends on.
      ACORN_PORT: '',
    })

    // No clientDir: the node serves no web assets, which is also why this test needs no renderer build.
    const result = await child.request('service.start', {
      dataDir,
      version: 'spawn-test',
      isPackaged: false,
      electronPath: process.execPath,
      mcpEntry: join(dataDir, 'unused-mcp.js'),
    })
    const started = serviceStartResultSchema.parse(result)

    expect(started.endpoint.origin).toBe(`https://127.0.0.1:${started.endpoint.port}`)
    expect(started.nodeId).toMatch(/^[0-9a-f-]{36}$/)
    expect(started.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(started.deviceToken).toMatch(/^acorn_dt_/)

    // A real request over the wire, validated against the pin the child just handed back — which is the
    // one assertion that covers the whole chain at once: the certificate on disk, the listener serving
    // it, the port in the result, and the IP SAN.
    expect(await get(started, '/v2/node')).toBe(200)

    await child.waitForState('ready')
    // 'starting' is the entry's own acknowledgement before the runtime exists; the rest is the runtime's.
    expect(child.states).toEqual(['starting', 'migrating', 'listening', 'reconciling', 'ready'])

    await child.request('service.stop', {})
    expect(child.states.at(-1)).toBe('stopped')
    // The listener is closed and the data root's lock released, so nothing is left holding the temp dir.
    await expect(get(started, '/v2/node')).rejects.toThrow()
  }, 60_000)
})
