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
  const state = {
    revoked: false,
    projectsDelay: null as Promise<void> | null,
    // Accept the next turn, then drop the connection before answering.
    dropTurnReply: false,
    turns: new Map<string, { id: string; text: string }>(),
    lastQuery: '',
    lastTurnInput: null as unknown,
    // Uploads keyed by content, as the agents plugin keeps one row per task and content.
    uploads: [] as { taskId: string; body: string }[],
    attachments: new Map([
      ['a1', { id: 'a1', taskId: 't1', filename: 'shot.png', mediaType: 'image/png', byteSize: 4, createdAt: 1 }],
      ['a2', { id: 'a2', taskId: 't2', filename: 'other.png', mediaType: 'image/png', byteSize: 4, createdAt: 1 }],
      ['a3', { id: 'a3', taskId: 't1', filename: 'notes.txt', mediaType: 'text/plain', byteSize: 4, createdAt: 1 }],
    ]),
    deleted: [] as string[],
  }
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
    if (req.url?.startsWith('/v1/core/') || req.url?.startsWith('/v1/p/agents/')) {
      if (state.revoked || req.headers.authorization !== `Bearer ${TOKEN}`)
        return reply(401, { error: { code: 'unauthenticated', message: 'Unauthenticated.' } })
    }
    const url = new URL(req.url ?? '/', 'https://node.test')
    if (url.pathname === '/v1/core/tasks')
      return reply(200, [
        { id: 't1', title: 'Fix it', projectId: 'p1', branch: 'fix', status: 'active' },
        { id: 't2', title: 'Elsewhere', projectId: 'p2', branch: null, status: 'active' },
      ])
    if (url.pathname === '/v1/p/agents/providers')
      return reply(200, [
        {
          id: 'claude',
          profileId: 'claude-code',
          label: 'Claude Code',
          installed: true,
          authenticated: false,
          diagnostics: ['Not signed in'],
          configOptions: [],
        },
      ])
    if (url.pathname === '/v1/p/agents/sessions' && req.method === 'GET') {
      state.lastQuery = url.search
      return reply(200, { sessions: [agentSession('s1')], delegations: [], nextCursor: null })
    }
    if (url.pathname === '/v1/p/agents/sessions' && req.method === 'POST') {
      let body = ''
      for await (const chunk of req) body += chunk
      return reply(200, { ...agentSession('s2'), ...JSON.parse(body), config: {} })
    }
    if (url.pathname === '/v1/p/agents/sessions/s1')
      return reply(200, {
        session: agentSession('s1'),
        turns: [],
        requests: [],
        events: [
          {
            id: 'e1',
            sessionId: 's1',
            turnId: null,
            seq: 1,
            schemaVersion: 1,
            createdAt: 1,
            event: { type: 'user_message', text: 'hi' },
          },
        ],
      })
    if (url.pathname === '/v1/p/agents/sessions/gone')
      return reply(404, { error: { code: 'not_found', message: 'Not found.' } })
    if (url.pathname === '/v1/p/agents/sessions/s1/turns') {
      let body = ''
      for await (const chunk of req) body += chunk
      const key = String(req.headers['idempotency-key'])
      state.lastTurnInput = JSON.parse(body).input
      const turn = state.turns.get(key) ?? { id: `turn-${state.turns.size + 1}`, text: JSON.parse(body).input[0].text }
      state.turns.set(key, turn)
      if (state.dropTurnReply) {
        state.dropTurnReply = false
        return req.socket.destroy()
      }
      return reply(200, { id: turn.id, sessionId: 's1', status: 'queued' })
    }
    if (url.pathname === '/v1/p/agents/attachments' && req.method === 'POST') {
      let body = ''
      for await (const chunk of req) body += chunk
      const taskId = url.searchParams.get('taskId')!
      const content = /\r\n\r\n([\s\S]*)\r\n--/.exec(body)?.[1] ?? ''
      let index = state.uploads.findIndex((upload) => upload.taskId === taskId && upload.body === content)
      if (index < 0) index = state.uploads.push({ taskId, body: content }) - 1
      const filename = /filename="([^"]*)"/.exec(body)?.[1]
      const type = /content-type: ([^\r]*)/i.exec(body)?.[1]
      return reply(200, {
        id: `up-${index}`,
        taskId,
        filename,
        mediaType: type,
        byteSize: content.length,
        createdAt: 1,
      })
    }
    const attachment = /^\/v1\/p\/agents\/attachments\/([^/]+)(\/content)?$/.exec(url.pathname)
    if (attachment) {
      const row = state.attachments.get(attachment[1]!)
      if (!row) return reply(500, { error: { code: 'internal', message: 'Attachment not found.' } })
      if (req.method === 'DELETE') {
        state.deleted.push(row.id)
        return reply(200, { removed: row.id !== 'a1' })
      }
      if (attachment[2]) {
        res.writeHead(200, { 'content-type': row.mediaType })
        return res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
      }
      return reply(200, row)
    }
    if (req.url === '/v1/core/projects') {
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

const agentSession = (id: string) => ({
  id,
  taskId: 't1',
  title: 'Chat',
  providerId: 'claude',
  profileId: 'claude-code',
  kind: 'interactive',
  runtimeState: 'ready',
  attention: 'none',
  lastEventSeq: 1,
  archivedAt: null,
  updatedAt: 1,
  config: {},
})

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

describe('browser bridge agent operations', () => {
  async function selected() {
    const subject = await paired()
    await subject.call({ op: 'node.select', nodeId: 'node-a' })
    return subject
  }

  it('lists one project tasks, the agent profiles, and a task sessions', async () => {
    const { call, node } = await selected()
    expect(await call({ op: 'tasks.list', nodeId: 'node-a', projectId: 'p1' })).toEqual({
      nodeId: 'node-a',
      projectId: 'p1',
      tasks: [{ id: 't1', title: 'Fix it', branch: 'fix' }],
    })
    expect(await call({ op: 'agents.profiles', nodeId: 'node-a' })).toEqual({
      nodeId: 'node-a',
      profiles: [
        {
          providerId: 'claude',
          profileId: 'claude-code',
          label: 'Claude Code',
          installed: true,
          authenticated: false,
          diagnostics: ['Not signed in'],
        },
      ],
    })
    const listed = await call({ op: 'sessions.list', nodeId: 'node-a', taskId: 't1' })
    expect(listed.sessions.map((session: { id: string }) => session.id)).toEqual(['s1'])
    expect(listed.sessions[0]).not.toHaveProperty('config')
    expect(node.state.lastQuery).toBe('?taskId=t1&archived=false&limit=100')
  })

  it('reads a session page and reports a missing session as not found', async () => {
    const { call } = await selected()
    const read = await call({ op: 'session.read', nodeId: 'node-a', sessionId: 's1', afterSeq: 0, limit: 50 })
    expect(read).toMatchObject({ nodeId: 'node-a', sessionId: 's1', reach: 1, queued: [] })
    expect(read.records).toEqual([
      { id: 'e1', seq: 1, turnId: null, createdAt: 1, event: { type: 'user_message', text: 'hi' } },
    ])
    await expect(
      call({ op: 'session.read', nodeId: 'node-a', sessionId: 'gone', afterSeq: 0, limit: 50 }),
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('starts a session with the normal defaults', async () => {
    const { call } = await selected()
    const created = await call({
      op: 'session.create',
      nodeId: 'node-a',
      taskId: 't1',
      providerId: 'claude',
      profileId: 'claude-code',
      key: 'create-key-1',
    })
    expect(created).toMatchObject({ nodeId: 'node-a', session: { id: 's2', taskId: 't1', kind: 'interactive' } })
  })

  it('reports an unanswered write as uncertain, and a retry with the same key makes no second turn', async () => {
    const { call, node } = await selected()
    node.state.dropTurnReply = true
    const submit = {
      op: 'turn.submit',
      nodeId: 'node-a',
      sessionId: 's1',
      input: [{ type: 'text', text: 'hello' }],
      key: 'turn-key-1',
    }
    await expect(call(submit)).rejects.toMatchObject({ code: 'ambiguous_mutation' })
    expect(await call(submit)).toEqual({ nodeId: 'node-a', sessionId: 's1', turnId: 'turn-1' })
    expect([...node.state.turns.values()]).toEqual([{ id: 'turn-1', text: 'hello' }])
  })

  it('refuses a write for a Node that is no longer selected before sending it', async () => {
    const { call, node } = await selected()
    await call({ op: 'node.select', nodeId: null })
    await expect(
      call({
        op: 'turn.submit',
        nodeId: 'node-a',
        sessionId: 's1',
        input: [{ type: 'text', text: 'hello' }],
        key: 'turn-key-1',
      }),
    ).rejects.toMatchObject({ code: 'not_selected' })
    expect(node.state.turns.size).toBe(0)
  })

  it('passes captured context and screenshots to the Node as the turn input', async () => {
    const { call, node } = await selected()
    const input = [
      { type: 'text', text: 'Look at this' },
      {
        type: 'context',
        contextId: 'c1',
        label: 'Page: Docs',
        content: 'https://example.test/docs',
        source: 'browser-extension',
        capturedAt: 5,
      },
      { type: 'image', attachmentId: 'a1', alt: 'Screenshot of Docs' },
    ]
    await call({ op: 'turn.submit', nodeId: 'node-a', sessionId: 's1', input, key: 'turn-key-2' })
    expect(node.state.lastTurnInput).toEqual(input)
  })
})

describe('browser bridge attachments', () => {
  async function selected() {
    const subject = await paired()
    await subject.call({ op: 'node.select', nodeId: 'node-a' })
    return subject
  }
  const png = Buffer.from('\x89PNG fake screenshot').toString('base64')

  it('uploads to the named task, and the same bytes answer with the same attachment', async () => {
    const { call, node } = await selected()
    const upload = {
      op: 'attachment.upload',
      nodeId: 'node-a',
      taskId: 't1',
      filename: 'Screenshot.png',
      mediaType: 'image/png',
      data: png,
    }
    const first = await call(upload)
    expect(first).toMatchObject({
      nodeId: 'node-a',
      taskId: 't1',
      attachment: { id: 'up-0', taskId: 't1', filename: 'Screenshot.png', mediaType: 'image/png' },
    })
    expect((await call(upload)).attachment.id).toBe('up-0')
    expect(node.state.uploads).toHaveLength(1)
  })

  it('reads an image of the task as base64, and only names one that is not an image', async () => {
    const { call } = await selected()
    const read = await call({ op: 'attachment.read', nodeId: 'node-a', taskId: 't1', attachmentId: 'a1' })
    expect(read).toMatchObject({ attachment: { id: 'a1', filename: 'shot.png' } })
    expect(Buffer.from(read.data, 'base64')).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    expect(await call({ op: 'attachment.read', nodeId: 'node-a', taskId: 't1', attachmentId: 'a3' })).toMatchObject({
      attachment: { id: 'a3' },
      data: null,
    })
  })

  it('refuses to read or delete another task attachment', async () => {
    const { call, node } = await selected()
    for (const op of ['attachment.read', 'attachment.delete'])
      await expect(call({ op, nodeId: 'node-a', taskId: 't1', attachmentId: 'a2' })).rejects.toMatchObject({
        code: 'not_found',
      })
    expect(node.state.deleted).toEqual([])
  })

  it('reports whether the Node removed a draft attachment', async () => {
    const { call } = await selected()
    expect(await call({ op: 'attachment.delete', nodeId: 'node-a', taskId: 't1', attachmentId: 'a3' })).toEqual({
      nodeId: 'node-a',
      taskId: 't1',
      attachmentId: 'a3',
      removed: true,
    })
    // The Node keeps an attachment a turn has sent.
    expect(await call({ op: 'attachment.delete', nodeId: 'node-a', taskId: 't1', attachmentId: 'a1' })).toMatchObject({
      removed: false,
    })
  })
})
