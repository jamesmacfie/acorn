import { createServer, type Server } from 'node:https'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { custody } from '@acorn/custody/local'
import { ensureCert } from '@acorn/node-core/server/transport'
import { ACORN_BASELINE } from '@acorn/protocol/baseline.ts'
import { NODE_PROTOCOL_VERSION } from '@acorn/protocol/node.ts'
import type { NodeStatus } from '@acorn/protocol/broker.ts'
import type { BridgeRequest } from '@acorn/protocol/extensionBridge.ts'
import { createBridge } from './bridge'

const CODE = 'GOOD-CODE'
const TOKEN = 'device-token-secret'
type Cert = ReturnType<typeof ensureCert>
let certA: Cert
let certB: Cert
const cleanup: (() => void | Promise<void>)[] = []

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-bridge-certs-'))
  certA = ensureCert(join(dir, 'a'))
  certB = ensureCert(join(dir, 'b'))
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
})

afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step()
})

// A Node that answers the routes pairing and project reads use, with knobs for each failure.
async function fakeNode(nodeId: string, options: { protocolVersion?: number } = {}) {
  const state = { revoked: false, projectsDelay: null as Promise<void> | null }
  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (req.url === '/v1/node')
      return reply(200, {
        baseline: ACORN_BASELINE,
        protocolVersion: options.protocolVersion ?? NODE_PROTOCOL_VERSION,
        fingerprint: current.fingerprint,
        nodeId,
      })
    if (req.url === '/v1/pair') {
      let body = ''
      for await (const chunk of req) body += chunk
      const { code } = JSON.parse(body) as { code: string }
      if (code !== CODE) return reply(401, { error: { code: 'pairing_failed', message: 'no' } })
      return reply(200, {
        baseline: ACORN_BASELINE,
        deviceToken: TOKEN,
        nodeId,
        device: { id: 'device-1', name: 'browser', createdAt: 1, lastSeenAt: null, revokedAt: null },
      })
    }
    if (req.url === '/v1/core/projects') {
      if (state.revoked || req.headers.authorization !== `Bearer ${TOKEN}`)
        return reply(401, { error: { code: 'unauthenticated', message: 'Unauthenticated.' } })
      await state.projectsDelay
      return reply(200, {
        projects: [{ id: 'p1', name: `${nodeId} project`, path: '/src/p1', workspaceId: 'w', sort: 0, hidden: false }],
      })
    }
    reply(404, { error: { code: 'not_found', message: 'Not found.' } })
  }
  let current: Cert = certA
  const server: Server = createServer({ key: certA.keyPem, cert: certA.certPem }, (req, res) => void handler(req, res))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
  return {
    endpoint: `https://127.0.0.1:${(server.address() as AddressInfo).port}`,
    state,
    // The same address now presents another certificate.
    replaceCertificate() {
      current = certB
      server.setSecureContext({ key: certB.keyPem, cert: certB.certPem })
      server.closeAllConnections()
    },
  }
}

function bridge() {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-bridge-custody-'))
  const statuses: NodeStatus[] = []
  const created = createBridge({ fleet: custody(dir).fleet, deviceName: 'test', status: (s) => statuses.push(s) })
  cleanup.push(() => {
    created.dispose()
    rmSync(dir, { recursive: true, force: true })
  })
  let id = 0
  const call = (request: Record<string, unknown>) =>
    created.handle({ v: 1, id: String(++id), ...request } as BridgeRequest) as Promise<any>
  return { call, dir, statuses }
}

async function paired(nodeId = 'node-a') {
  const node = await fakeNode(nodeId)
  const subject = bridge()
  await subject.call({ op: 'node.probe', endpoint: node.endpoint })
  await subject.call({ op: 'node.pair', code: CODE, label: 'Studio' })
  return { node, ...subject }
}

describe('browser bridge pairing', () => {
  it('shows the presented fingerprint, then pairs without returning the credential', async () => {
    const node = await fakeNode('node-a')
    const { call, dir } = bridge()
    const probe = await call({ op: 'node.probe', endpoint: node.endpoint })
    expect(probe).toMatchObject({ endpoint: node.endpoint, compatible: true })
    expect(probe.fingerprint.replaceAll(':', '').toLowerCase()).toBe(certA.fingerprint)
    expect(probe).not.toHaveProperty('certPem')

    const record = await call({ op: 'node.pair', code: CODE, label: 'Studio' })
    expect(record).toEqual({
      nodeId: 'node-a',
      label: 'Studio',
      endpoint: node.endpoint,
      local: false,
      fingerprint: probe.fingerprint,
    })
    const listed = await call({ op: 'nodes.list' })
    expect(JSON.stringify([probe, record, listed])).not.toContain(TOKEN)
    expect(JSON.stringify(listed)).not.toContain('BEGIN CERTIFICATE')
    // The token sits in this browser's own custody, one mode-0600 file per node.
    const tokenFile = readdirSync(dir).find((name) => name.includes('device-token'))!
    expect(readFileSync(join(dir, tokenFile), 'utf8')).toBe(TOKEN)
  })

  it('refuses pairing without a confirmed probe, and a wrong code', async () => {
    const node = await fakeNode('node-a')
    const { call } = bridge()
    await expect(call({ op: 'node.pair', code: CODE, label: 'x' })).rejects.toMatchObject({ code: 'no_probe' })
    await call({ op: 'node.probe', endpoint: node.endpoint })
    await expect(call({ op: 'node.pair', code: 'WRONG', label: 'x' })).rejects.toMatchObject({ code: 'pairing_failed' })
    expect((await call({ op: 'nodes.list' })).nodes).toEqual([])
  })

  it('reports an incompatible Node at the probe and refuses to pair it', async () => {
    const node = await fakeNode('node-a', { protocolVersion: NODE_PROTOCOL_VERSION + 1 })
    const { call } = bridge()
    expect(await call({ op: 'node.probe', endpoint: node.endpoint })).toMatchObject({ compatible: false })
    await expect(call({ op: 'node.pair', code: CODE, label: 'x' })).rejects.toMatchObject({ code: 'incompatible' })
  })
})

describe('browser bridge selection', () => {
  it('lists the selected Node projects and refuses an unselected Node', async () => {
    const { call } = await paired()
    await expect(call({ op: 'projects.list', nodeId: 'node-a' })).rejects.toMatchObject({ code: 'not_selected' })
    expect(await call({ op: 'node.select', nodeId: 'node-a' })).toMatchObject({ activeNodeId: 'node-a' })
    expect(await call({ op: 'projects.list', nodeId: 'node-a' })).toEqual({
      nodeId: 'node-a',
      projects: [{ id: 'p1', name: 'node-a project', path: '/src/p1', hidden: false }],
    })
    await expect(call({ op: 'node.select', nodeId: 'missing' })).rejects.toMatchObject({ code: 'unknown_node' })
  })

  it('discards a read that finishes after the selection moved', async () => {
    const { call, node } = await paired()
    await call({ op: 'node.select', nodeId: 'node-a' })
    let release!: () => void
    node.state.projectsDelay = new Promise((resolve) => (release = resolve))
    const late = call({ op: 'projects.list', nodeId: 'node-a' })
    await call({ op: 'node.select', nodeId: null })
    release()
    await expect(late).rejects.toMatchObject({ code: 'not_selected' })
  })

  it('reports a revoked device through the reply and the status event', async () => {
    const { call, node, statuses } = await paired()
    await call({ op: 'node.select', nodeId: 'node-a' })
    node.state.revoked = true
    await expect(call({ op: 'projects.list', nodeId: 'node-a' })).rejects.toMatchObject({ code: 'revoked' })
    expect(statuses.at(-1)).toMatchObject({ nodeId: 'node-a', state: 'revoked' })
  })

  it('stops at a changed certificate until the Node is paired again', async () => {
    const { call, node, statuses } = await paired()
    await call({ op: 'node.select', nodeId: 'node-a' })
    node.replaceCertificate()
    await expect(call({ op: 'projects.list', nodeId: 'node-a' })).rejects.toMatchObject({ code: 'identity_mismatch' })
    const changed = { nodeId: 'node-a', state: 'offline', error: { code: 'identity_mismatch' } }
    expect(statuses.at(-1)).toEqual(changed)
    expect((await call({ op: 'nodes.list' })).status).toEqual(changed)

    const probe = await call({ op: 'node.probe', endpoint: node.endpoint })
    expect(probe.fingerprint.replaceAll(':', '').toLowerCase()).toBe(certB.fingerprint)
    await call({ op: 'node.pair', code: CODE, label: 'Studio' })
    expect(await call({ op: 'projects.list', nodeId: 'node-a' })).toMatchObject({ nodeId: 'node-a' })
  })

  it('forgets a selected Node and clears the selection', async () => {
    const { call } = await paired()
    await call({ op: 'node.select', nodeId: 'node-a' })
    expect(await call({ op: 'node.forget', nodeId: 'node-a' })).toEqual({ nodes: [], activeNodeId: null, status: null })
  })
})
