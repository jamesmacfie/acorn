import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { expect } from 'vitest'
import type { NodeStatus } from '@acorn/protocol/broker.ts'
import { NodeBroker } from '@acorn/custody/broker'
import type { AccountStub } from '@acorn/node-core/testkit'

// Real Nodes for the tests that put an account service and a relay between them: each is the standalone
// entry, started as the lifecycle tests in apps/node start it, with its own data folder and its own
// client, so the two reach each other only through the relay.

const NODE_APP = resolve(dirname(fileURLToPath(import.meta.url)), '../../../node')
const ACCOUNT_ROUTE = '/v1/p/account'
const READY_BUDGET_MS = 90_000

type Handshake = { nodeId: string; endpoint: string; fingerprint: string; certPem: string; deviceToken: string }
export type RunningNode = {
  child: ChildProcess
  handshake: Handshake
  dir: string
  broker: NodeBroker
  statuses: NodeStatus[]
}

export function nodeHarness(account: () => AccountStub) {
  const nodes: RunningNode[] = []

  async function startNode(env: Record<string, string> = {}): Promise<RunningNode> {
    const dir = mkdtempSync(join(tmpdir(), 'acorn-remote-access-'))
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/entries/standalone.ts'], {
      cwd: NODE_APP,
      env: {
        ...process.env,
        ACORN_DATA_DIR: dir,
        SESSION_ENC_KEY: '0'.repeat(64),
        GITHUB_CLIENT_ID: 'test-client',
        ACORN_PORT: '',
        ACORN_RELAY_URL: '',
        ACORN_RELAY_CREDENTIAL: '',
        ACORN_ACCOUNT_URL: account().url,
        ACORN_LAUNCHER_PIPES: '1',
        ...env,
      },
      stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'],
    })
    ;(child.stdio[4] as Writable).end('\n')
    const handshake = await new Promise<Handshake>((resolveReady, reject) => {
      const timer = setTimeout(() => reject(new Error('the Node wrote no handshake')), READY_BUDGET_MS)
      createInterface({ input: child.stdio[3] as Readable }).once('line', (line) => {
        clearTimeout(timer)
        resolveReady(JSON.parse(line) as Handshake)
      })
      child.once('exit', (code) => reject(new Error(`the Node exited (${code}) before it was listening`)))
    })
    const statuses: NodeStatus[] = []
    const broker = new NodeBroker(
      { frame: () => {}, bytes: () => {}, status: (status) => statuses.push(status) },
      { relayTicketRoute: `${ACCOUNT_ROUTE}/tickets` },
    )
    broker.upsert({
      nodeId: handshake.nodeId,
      label: 'This computer',
      endpoint: handshake.endpoint,
      local: true,
      fingerprint: handshake.fingerprint,
      certPem: handshake.certPem,
      token: handshake.deviceToken,
    })
    const running = { child, handshake, dir, broker, statuses }
    nodes.push(running)
    return running
  }

  // A request to a Node through its own client, as a settings page makes it.
  async function request(node: RunningNode, method: string, path: string, body?: unknown) {
    const response = await node.broker.fetch(node.handshake.nodeId, {
      requestId: `${method}${path}${Math.random()}`,
      method,
      path,
      headers: { 'content-type': 'application/json' },
      ...(body === undefined
        ? {}
        : { body: { kind: 'bytes' as const, bytes: new TextEncoder().encode(JSON.stringify(body)) } }),
    })
    const text = new TextDecoder().decode(response.body)
    return { status: response.status, json: text ? (JSON.parse(text) as Record<string, any>) : undefined }
  }

  // A request to a Node's own account plugin.
  const ask = (node: RunningNode, method: string, path: string, body?: unknown) =>
    request(node, method, `${ACCOUNT_ROUTE}${path}`, body)

  async function signIn(node: RunningNode): Promise<void> {
    const started = (await ask(node, 'POST', '/auth/device/start')).json!
    const poll = await ask(node, 'POST', '/auth/device/poll', { deviceCode: started.deviceCode })
    expect(poll.json).toMatchObject({ status: 'connected' })
  }

  async function stopAll(): Promise<void> {
    for (const node of nodes) {
      node.broker.dispose()
      node.child.kill('SIGKILL')
      rmSync(node.dir, { recursive: true, force: true })
    }
  }

  return { startNode, request, ask, signIn, stopAll }
}

export const waitFor = async (predicate: () => boolean | Promise<boolean>, label: string): Promise<void> => {
  const deadline = Date.now() + 20_000
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}
