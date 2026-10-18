import type { ChildProcess } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { request as httpsRequest } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, expect, it } from 'vitest'
import type { DevicesResponse, PairResult } from '@acorn/protocol/node.ts'
import { spawnStandalone, stopStandalone } from '../../helpers/standalone'

// A Node nobody launched with pipes, as a service manager runs it. Its output ends up in a log that
// anyone who can read the logs sees, so it carries no device token, and a restart adds no device
// (docs/node-distribution.md § Runtime).

const EXIT_BUDGET_MS = 25_000
const READY_BUDGET_MS = 90_000
const RESTARTS = 5

type Handshake = { endpoint: string; certPem: string }
type Started = { child: ChildProcess; output: string; handshake: Handshake }

// stdout and stderr both go to a file, the way launchd and systemd keep them. The banner follows the
// handshake, so the Node is ready once the banner shows.
async function startUnpiped(dataDir: string, outPath: string): Promise<Started> {
  const out = openSync(outPath, 'w')
  let child: ChildProcess
  try {
    child = spawnStandalone(dataDir, ['ignore', out, out], { ACORN_LAUNCHER_PIPES: undefined })
  } finally {
    closeSync(out)
  }
  const deadline = Date.now() + READY_BUDGET_MS
  for (;;) {
    const output = readFileSync(outPath, 'utf8')
    if (/Pairing code|already paired/.test(output)) {
      const line = output.split('\n').find((candidate) => candidate.startsWith('{"baseline"'))
      return { child, output, handshake: JSON.parse(line!) as Handshake }
    }
    if (child.exitCode !== null) throw new Error(`standalone exited (${child.exitCode}) before its banner:\n${output}`)
    if (Date.now() > deadline) throw new Error(`standalone printed no banner:\n${output}`)
    await delay(200)
  }
}

function call(
  node: Handshake,
  path: string,
  init: { method?: string; token?: string; body?: unknown } = {},
): Promise<{ status: number; body: string }> {
  const payload = init.body === undefined ? undefined : JSON.stringify(init.body)
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      new URL(path, node.endpoint),
      {
        method: init.method ?? 'GET',
        ca: [node.certPem],
        agent: false,
        headers: {
          ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
          ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }))
      },
    )
    req.on('error', reject)
    req.end(payload)
  })
}

const deviceIds = async (node: Handshake, token: string): Promise<string[]> => {
  const reply = await call(node, '/v1/core/devices', { token })
  expect(reply.status).toBe(200)
  return (JSON.parse(reply.body) as DevicesResponse).devices.map((device) => device.id)
}

describe('a standalone node started without launcher pipes', () => {
  let child: ChildProcess | null = null
  let base: string | null = null

  afterEach(() => {
    child?.kill('SIGKILL')
    child = null
    if (base) rmSync(base, { recursive: true, force: true })
    base = null
  })

  it('writes no device token, and adds no device on a restart', async () => {
    base = mkdtempSync(join(tmpdir(), 'acorn-unpiped-'))
    const dataDir = join(base, 'node')
    const first = await startUnpiped(dataDir, join(base, 'out-0.log'))
    child = first.child
    expect(first.handshake).not.toHaveProperty('deviceToken')
    expect(first.output).not.toContain('acorn_dt_')

    // Nothing is paired yet, so the banner still opens a code, and a client pairs with it.
    const code = /Pairing code\s+(\S+)/.exec(first.output)![1]
    const paired = await call(first.handshake, '/v1/pair', {
      method: 'POST',
      body: { code, deviceName: 'test client' },
    })
    expect(paired.status).toBe(200)
    const { deviceToken } = JSON.parse(paired.body) as PairResult
    const devices = await deviceIds(first.handshake, deviceToken)
    expect(devices).toHaveLength(1)
    expect(await stopStandalone(first.child, EXIT_BUDGET_MS)).toBe(0)

    for (let restart = 1; restart <= RESTARTS; restart += 1) {
      const next = await startUnpiped(dataDir, join(base, `out-${restart}.log`))
      child = next.child
      expect(next.output).not.toContain('acorn_dt_')
      expect(await deviceIds(next.handshake, deviceToken)).toEqual(devices)
      expect(await stopStandalone(next.child, EXIT_BUDGET_MS)).toBe(0)
    }
    child = null
  }, 600_000)
})
