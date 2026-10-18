import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, type ChildProcess } from 'node:child_process'
import { request as httpsRequest } from 'node:https'
import { createInterface } from 'node:readline'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NodeBroker } from '@acorn/custody/broker'
import { pairWithNode, probeNode } from '@acorn/custody/broker/nodePairing.ts'
import { custody } from '@acorn/custody/local'
import { LOCAL_TOKEN_SCOPE } from '@acorn/custody/custody/deviceTokenStore.ts'
import { fingerprintPhrase } from '@acorn/protocol/fingerprintWords.ts'
import { main } from '../main'
import { nodeServiceStatus, runNodeForeground, startNodeService, stopNodeService } from './lifecycle'
import { servicePaths } from './record'

// The task variables too: a run inside an acorn task terminal would otherwise hit main's task-scope guard.
const keys = [
  'ACORN_DATA_DIR',
  'ACORN_TUI_CONFIG_DIR',
  'ACORN_CLI_NODE_ENTRY',
  'ACORN_PORT',
  'ACORN_TASK_ID',
  'ACORN_API_TOKEN',
] as const
const initial = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
let base: string | undefined
let root: string | undefined
let manual: ChildProcess | undefined

function isolatedRoot(): string {
  base = mkdtempSync(join(tmpdir(), 'acorn-cli-service-'))
  root = join(base, 'node') // absent on purpose: first run must bootstrap without stdin
  process.env.ACORN_DATA_DIR = root
  process.env.ACORN_TUI_CONFIG_DIR = join(base, 'custody')
  process.env.ACORN_CLI_NODE_ENTRY = fileURLToPath(new URL('../../../node/src/entries/standalone.ts', import.meta.url))
  delete process.env.ACORN_PORT
  delete process.env.ACORN_TASK_ID
  delete process.env.ACORN_API_TOKEN
  return root
}

/** Runs one `acorn` command in this process and returns its exit code and stdout. */
async function acorn(...argv: string[]): Promise<{ code: number; out: string }> {
  const chunks: string[] = []
  const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    chunks.push(String(chunk))
    return true
  })
  try {
    return { code: await main(argv), out: chunks.join('') }
  } finally {
    write.mockRestore()
  }
}

async function until<T>(read: () => T | Promise<T>, done: (value: T) => boolean, timeoutMs = 60_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await read()
    if (done(value)) return value
    if (Date.now() > deadline) throw new Error(`Timed out; last value ${JSON.stringify(value)}`)
    await delay(150)
  }
}

afterEach(async () => {
  manual?.kill('SIGTERM')
  manual = undefined
  if (root) await stopNodeService(true, root).catch(() => undefined)
  if (base) rmSync(base, { recursive: true, force: true })
  base = undefined
  root = undefined
  for (const key of keys) {
    const value = initial[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('CLI-owned local Node', () => {
  it('serializes racing starts, hands off the token privately, and survives the launching command', async () => {
    const dataDir = isolatedRoot()
    const [first, second] = await Promise.all([startNodeService(dataDir), startNodeService(dataDir)])
    expect(first.state).toBe('running')
    expect(second.pid).toBe(first.pid)
    expect((await nodeServiceStatus(dataDir)).state).toBe('running')
    const token = custody().tokens.read(LOCAL_TOKEN_SCOPE)
    expect(token).toMatch(/^acorn_dt_/)
    const paths = servicePaths(dataDir)
    for (const path of [paths.record, paths.log]) {
      expect(statSync(path).mode & 0o777).toBe(0o600)
      expect(readFileSync(path, 'utf8')).not.toContain(token!)
    }
    expect(await stopNodeService(false, dataDir)).toMatchObject({ state: 'stopped' })
    expect(await nodeServiceStatus(dataDir)).toMatchObject({ state: 'stopped' })
  }, 90_000)

  it('refuses to stop a PID whose authenticated instance no longer matches its record', async () => {
    const dataDir = isolatedRoot()
    await startNodeService(dataDir)
    const path = servicePaths(dataDir).record
    const original = readFileSync(path, 'utf8')
    const tampered = { ...JSON.parse(original), instanceId: '00000000-0000-4000-8000-000000000001' }
    writeFileSync(path, JSON.stringify(tampered), { mode: 0o600 })
    expect((await nodeServiceStatus(dataDir)).state).toBe('running-unowned')
    await expect(stopNodeService(false, dataDir)).rejects.toMatchObject({ code: 'node_not_owned' })
    writeFileSync(path, original, { mode: 0o600 })
    expect((await nodeServiceStatus(dataDir)).state).toBe('running')
  }, 90_000)

  it('reports a manually started standalone Node as running-unowned', async () => {
    const dataDir = isolatedRoot()
    const entry = process.env.ACORN_CLI_NODE_ENTRY!
    manual = spawn(process.execPath, ['--import', 'tsx', entry], {
      cwd: fileURLToPath(new URL('../../../node', import.meta.url)),
      env: {
        ...process.env,
        ACORN_DATA_DIR: dataDir,
        ACORN_CLI_BACKGROUND: undefined,
        ACORN_CLI_SERVICE_ID: undefined,
        ACORN_CLI_LOG_PATH: undefined,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    manual.stderr?.resume()
    await new Promise<void>((resolve, reject) => {
      const lines = createInterface({ input: manual!.stdout! })
      lines.on('line', (line) => {
        try {
          if ((JSON.parse(line) as { nodeId?: unknown }).nodeId) {
            lines.close()
            resolve()
          }
        } catch {
          /* startup log, not the handshake */
        }
      })
      manual!.once('exit', (code) => reject(new Error(`Manual Node exited before readiness (${code}).`)))
    })
    expect((await nodeServiceStatus(dataDir)).state).toBe('running-unowned')
    expect((await startNodeService(dataDir)).state).toBe('running-unowned')
    await expect(stopNodeService(false, dataDir)).rejects.toMatchObject({ code: 'node_not_owned' })
  }, 90_000)

  it('releases the startup claim after a child exits before readiness', async () => {
    const dataDir = isolatedRoot()
    const sourceEntry = process.env.ACORN_CLI_NODE_ENTRY!
    const failedEntry = join(base!, 'fail.mjs')
    writeFileSync(failedEntry, 'throw new Error("synthetic early boot failure")\n')
    process.env.ACORN_CLI_NODE_ENTRY = failedEntry
    await expect(startNodeService(dataDir)).rejects.toThrow('before readiness')
    expect(readFileSync(servicePaths(dataDir).log, 'utf8')).toContain('synthetic early boot failure')
    expect(existsSync(servicePaths(dataDir).claim)).toBe(false)
    expect((await nodeServiceStatus(dataDir)).state).toBe('stopped')
    process.env.ACORN_CLI_NODE_ENTRY = sourceEntry
    expect((await startNodeService(dataDir)).state).toBe('running')
  }, 90_000)

  it('runs in the foreground, pairs and revokes a second client, restarts in place, and drains on stop', async () => {
    const dataDir = isolatedRoot()
    const logPath = join(base!, 'foreground.log')
    const foreground = runNodeForeground(logPath, dataDir)
    const first = await until(
      () => nodeServiceStatus(dataDir),
      (service) => service.state === 'running',
      90_000,
    )
    expect(first.logPath).toBe(logPath)

    const window = JSON.parse((await acorn('node', 'pair', '--output', 'json')).out) as {
      kind: string
      endpoints: string[]
      identity: string
      code: string
    }
    expect(window).toMatchObject({ kind: 'PairingWindow', endpoints: [first.endpoint] })
    const probe = await probeNode(window.endpoints[0]!)
    expect(window.identity).toBe(fingerprintPhrase(probe.fingerprint))
    const second = await pairWithNode(probe, { code: window.code, deviceName: 'second client' })

    const states: string[] = []
    const broker = new NodeBroker({ frame() {}, bytes() {}, status: (status) => states.push(status.state) })
    try {
      broker.upsert({
        nodeId: second.nodeId,
        label: 'second client',
        local: false,
        endpoint: probe.endpoint,
        fingerprint: probe.fingerprint,
        certPem: probe.certPem,
        token: second.deviceToken,
      })
      await until(
        () => states,
        (seen) => seen.includes('online'),
      )

      const devices = JSON.parse((await acorn('node', 'devices', '--output', 'json')).out) as {
        id: string
        name: string
        revokedAt: string | null
        thisTerminal: boolean
      }[]
      expect(devices.filter((device) => device.revokedAt === null)).toHaveLength(2)
      const own = devices.find((device) => device.thisTerminal)!
      expect(devices.find((device) => device.id === second.device.id)).toMatchObject({ thisTerminal: false })

      expect((await acorn('node', 'revoke', own.id)).code).toBe(4)
      expect((await acorn('node', 'revoke', second.device.id)).code).toBe(0)
      await until(
        () => states,
        (seen) => seen.includes('revoked'),
      )
    } finally {
      broker.dispose()
    }

    const restarted = JSON.parse((await acorn('node', 'restart', '--output', 'json')).out) as { pid: number }
    expect(restarted).toMatchObject({ state: 'running' })
    expect(restarted.pid).not.toBe(first.pid)

    expect(JSON.parse((await acorn('node', 'stop', '--output', 'json')).out)).toMatchObject({ state: 'stopped' })
    expect(await foreground).toBe(0)
    const log = readFileSync(logPath, 'utf8')
    expect(log).toContain('restart requested — draining')
    expect(log).toContain('stop requested — draining')
    expect(log).not.toContain('acorn_dt_')
  }, 240_000)

  it('makes a CLI-owned Node answer on a name without moving its port, then private again', async () => {
    const dataDir = isolatedRoot()
    const first = await startNodeService(dataDir)
    const port = Number(new URL(first.endpoint!).port)
    const { certPem } = await probeNode(first.endpoint!)
    // Over loopback with the name in Host, which is what the listener checks. The certificate names
    // localhost, not the advertised name, because a remote client pins its fingerprint instead.
    const answersAs = (host: string) =>
      new Promise<number>((resolve, reject) => {
        const request = httpsRequest(
          {
            host: '127.0.0.1',
            port,
            path: '/v1/node',
            ca: [certPem],
            servername: 'localhost',
            agent: false,
            headers: { host: `${host}:${port}` },
          },
          (response) => {
            response.resume()
            resolve(response.statusCode ?? 0)
          },
        )
        request.on('error', reject)
        request.end()
      })
    expect(await answersAs('reach.test')).toBe(403)

    const reachable = JSON.parse((await acorn('node', 'reach', 'reach.test', '--output', 'json')).out)
    expect(reachable).toMatchObject({
      kind: 'NodeReach',
      hosts: ['reach.test'],
      source: 'node.json',
      endpoints: [`https://reach.test:${port}`],
      restartRequired: false,
      restarted: true,
    })
    expect(await answersAs('reach.test')).toBe(200)
    expect(JSON.parse((await acorn('node', 'pair', '--output', 'json')).out)).toMatchObject({
      endpoints: [`https://reach.test:${port}`],
    })

    expect(JSON.parse((await acorn('node', 'reach', '--private', '--output', 'json')).out)).toMatchObject({
      hosts: [],
      source: 'none',
      restarted: true,
    })
    expect(await answersAs('reach.test')).toBe(403)
    expect((await nodeServiceStatus(dataDir)).endpoint).toBe(first.endpoint)
  }, 120_000)
})
