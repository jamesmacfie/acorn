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
    // The session's requests as the agents plugin holds them, and the key each was settled with.
    agentRequests: new Map<string, Record<string, unknown>>([['r1', agentRequest('r1')]]),
    resolutionKeys: new Map<string, string>(),
    // Settle the next request, then drop the connection before answering.
    dropResolveReply: false,
    tasks: [
      { id: 't1', title: 'Fix it', projectId: 'p1', branch: 'fix', status: 'active', pullNumber: null, links: [] },
      { id: 't2', title: 'Elsewhere', projectId: 'p2', branch: null, status: 'active', pullNumber: 12, links: [] },
    ] as Record<string, unknown>[],
    // What discovery declares and what the tracker plugin's resolve route answers.
    handoffs: [
      {
        pluginId: 'tracker',
        id: 'item',
        label: 'Open in Acorn',
        match: ['https://tracker.example/{repo}/items/{number}'],
        anchors: ['.actions'],
        resolve: '/v1/p/tracker/handoff',
      },
    ] as Record<string, unknown>[],
    resolution: null as unknown,
    resolveRequests: [] as unknown[],
    createdTasks: [] as { key: string; body: Record<string, unknown> }[],
    projects: [{ id: 'p1', name: `${nodeId} project`, path: '/src/p1', workspaceId: 'w', sort: 0, hidden: false }],
    // Each project's site associations, as its config holds them, and every config write.
    sites: new Map<string, unknown[]>(),
    configWrites: [] as { projectId: string; patch: unknown }[],
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
    if (url.pathname === '/v1/core/tasks' && req.method === 'POST') {
      let body = ''
      for await (const chunk of req) body += chunk
      const key = String(req.headers['idempotency-key'])
      const seed = JSON.parse(body) as Record<string, unknown>
      const replayed = state.createdTasks.findIndex((created) => created.key === key)
      if (replayed < 0) state.createdTasks.push({ key, body: seed })
      const task = { id: `new-${state.createdTasks.length}`, branch: seed.branch ?? null, links: [], ...seed }
      return reply(200, task)
    }
    if (url.pathname === '/v1/core/tasks') return reply(200, state.tasks)
    if (url.pathname === '/v1/core/browser-handoffs') return reply(200, { handoffs: state.handoffs })
    if (url.pathname === '/v1/p/tracker/handoff') {
      let body = ''
      for await (const chunk of req) body += chunk
      state.resolveRequests.push(JSON.parse(body))
      return reply(200, state.resolution)
    }
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
    const resolveRoute = /^\/v1\/p\/agents\/sessions\/s1\/requests\/([^/]+)\/resolve$/.exec(url.pathname)
    if (resolveRoute) {
      let body = ''
      for await (const chunk of req) body += chunk
      const row = state.agentRequests.get(decodeURIComponent(resolveRoute[1]!))
      if (!row) return reply(404, { error: { code: 'agent_not_found', message: 'Agent request not found.' } })
      // As the agents runtime does: a settled request answers as it is, whatever the key.
      if (row.status === 'pending') {
        row.status = 'resolved'
        row.resolution = JSON.parse(body).resolution
        state.resolutionKeys.set(row.providerRequestId as string, String(req.headers['idempotency-key']))
      }
      if (state.dropResolveReply) {
        state.dropResolveReply = false
        return req.socket.destroy()
      }
      return reply(200, row)
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
      return reply(200, { projects: state.projects })
    }
    const config = /^\/v1\/core\/projects\/([^/]+)\/config$/.exec(url.pathname)
    if (config && state.projects.some((project) => project.id === config[1])) {
      const projectId = config[1]!
      if (req.method === 'PUT') {
        let body = ''
        for await (const chunk of req) body += chunk
        const { patch } = JSON.parse(body) as { patch: { siteAssociations: unknown[] } }
        state.configWrites.push({ projectId, patch })
        state.sites.set(projectId, patch.siteAssociations)
      }
      return reply(200, { projectId, config: { siteAssociations: state.sites.get(projectId) ?? [] } })
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

function agentRequest(providerRequestId: string) {
  return {
    id: `row-${providerRequestId}`,
    sessionId: 's1',
    turnId: 'turn-1',
    providerRequestId,
    kind: 'permission',
    status: 'pending',
    title: 'Run rm -rf build',
    detail: 'In /src/p1',
    payload: {
      options: [
        { id: 'allow', label: 'Allow', kind: 'allow_once' },
        { id: 'deny', label: 'Deny', kind: 'reject_once' },
      ],
      questions: [],
    },
    resolution: null as unknown,
    expiresAt: null,
    createdAt: 1,
    resolvedAt: null,
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

  describe('request.resolve', () => {
    const answer = (resolution: unknown, key = 'answer-key-1', requestId = 'r1') => ({
      op: 'request.resolve',
      nodeId: 'node-a',
      sessionId: 's1',
      requestId,
      resolution,
      key,
    })

    it('answers through the agents route with the key, and reads the settled row back', async () => {
      const { call, node } = await selected()
      const result = await call(answer({ optionId: 'allow' }))
      expect(result).toMatchObject({
        nodeId: 'node-a',
        sessionId: 's1',
        request: { requestId: 'r1', status: 'resolved', answer: 'Allow', unsupported: null },
      })
      expect(node.state.agentRequests.get('r1')!.resolution).toEqual({ optionId: 'allow' })
      expect(node.state.resolutionKeys.get('r1')).toBe('answer-key-1')
    })

    it('reports an unanswered answer as uncertain, and one already settled comes back unchanged', async () => {
      const { call, node } = await selected()
      node.state.dropResolveReply = true
      await expect(call(answer({ optionId: 'allow' }))).rejects.toMatchObject({ code: 'ambiguous_mutation' })
      // Another client, or a second press here, can't change the outcome the Node already holds.
      const again = await call(answer({ optionId: 'deny' }, 'answer-key-2'))
      expect(again.request).toMatchObject({ status: 'resolved', answer: 'Allow' })
      expect(node.state.agentRequests.get('r1')!.resolution).toEqual({ optionId: 'allow' })
    })

    it('refuses an answer for a Node that is no longer selected before sending it', async () => {
      const { call, node } = await selected()
      await call({ op: 'node.select', nodeId: null })
      await expect(call(answer({ optionId: 'allow' }))).rejects.toMatchObject({ code: 'not_selected' })
      expect(node.state.agentRequests.get('r1')!.status).toBe('pending')
    })

    it('reports a request the Node does not have as not found', async () => {
      const { call } = await selected()
      await expect(call(answer({ optionId: 'allow' }, 'answer-key-1', 'gone'))).rejects.toMatchObject({
        code: 'not_found',
      })
    })
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

describe('browser bridge handoffs', () => {
  const item = (over: Record<string, unknown> = {}) => ({
    identifier: 'acme/widget#12',
    url: 'https://tracker.example/acme/items/12',
    title: 'Fix the flaky test',
    connection: { id: 'conn-1', label: 'Tracker' },
    projects: ['p1'],
    seed: { origin: 'tracker', title: 'Fix the flaky test', branch: 'fix-flaky', pullNumber: 12 },
    context: { label: 'Item acme/widget#12', content: 'What to read.' },
    ...over,
  })
  const target = { pluginId: 'tracker', handoffId: 'item', url: 'https://tracker.example/acme/items/12' }

  async function selected() {
    const subject = await paired()
    await subject.call({ op: 'node.select', nodeId: 'node-a' })
    return subject
  }

  it('lists the declared handoffs without their routes', async () => {
    const { call, node } = await selected()
    node.state.handoffs.push({ ...node.state.handoffs[0], id: 'stray', resolve: '/v1/p/agents/sessions' })
    expect(await call({ op: 'handoffs.list', nodeId: 'node-a' })).toEqual({
      nodeId: 'node-a',
      handoffs: [
        {
          pluginId: 'tracker',
          id: 'item',
          label: 'Open in Acorn',
          match: ['https://tracker.example/{repo}/items/{number}'],
          anchors: ['.actions'],
        },
      ],
    })
  })

  it('resolves through the declared route with captures the host matched, and names linked tasks', async () => {
    const { call, node } = await selected()
    node.state.resolution = { items: [item({ projects: ['p1', 'p2'] })] }
    node.state.tasks.push({
      id: 't3',
      title: 'Linked',
      projectId: 'p9',
      branch: null,
      status: 'active',
      pullNumber: 12,
      links: [],
    })
    const result = await call({ op: 'handoff.resolve', nodeId: 'node-a', ...target })
    expect(node.state.resolveRequests).toEqual([{ url: target.url, captures: { repo: 'acme', number: '12' } }])
    expect(result.items).toEqual([
      {
        identifier: 'acme/widget#12',
        url: 'https://tracker.example/acme/items/12',
        title: 'Fix the flaky test',
        connection: { id: 'conn-1', label: 'Tracker' },
        // p2 isn't a project the Node lists any more, so it can't be offered.
        projects: [{ id: 'p1', name: 'node-a project' }],
        // t2 holds pull 12 in a project tied to the item; t3 holds a pull 12 of somewhere else.
        linkedTasks: [{ id: 't2', title: 'Elsewhere', projectId: 'p2' }],
        context: { label: 'Item acme/widget#12', content: 'What to read.' },
      },
    ])
  })

  it('finds a connection-stamped link in any project', async () => {
    const { call, node } = await selected()
    node.state.resolution = {
      items: [item({ seed: { origin: 'tracker', links: [{ connectionId: 'conn-1', identifier: 'TRK-1' }] } })],
    }
    node.state.tasks.push({
      id: 't4',
      title: 'Has the link',
      projectId: 'p7',
      branch: null,
      status: 'active',
      pullNumber: null,
      links: [{ connectionId: 'conn-1', providerId: 'tracker', identifier: 'TRK-1' }],
    })
    const result = await call({ op: 'handoff.resolve', nodeId: 'node-a', ...target })
    expect(result.items[0].linkedTasks).toEqual([{ id: 't4', title: 'Has the link', projectId: 'p7' }])
  })

  it('refuses a page the handoff does not match, a handoff the Node dropped, and an unreadable answer', async () => {
    const { call, node } = await selected()
    await expect(
      call({ op: 'handoff.resolve', nodeId: 'node-a', ...target, url: 'https://tracker.example/acme/boards/12' }),
    ).rejects.toMatchObject({ code: 'bad_request' })
    await expect(call({ op: 'handoff.resolve', nodeId: 'node-a', ...target, handoffId: 'gone' })).rejects.toMatchObject(
      { code: 'not_found' },
    )
    node.state.resolution = { items: [item({ context: { label: 'x', content: 'y'.repeat(16_001) } })] }
    await expect(call({ op: 'handoff.resolve', nodeId: 'node-a', ...target })).rejects.toMatchObject({
      code: 'node_error',
    })
    expect(node.state.createdTasks).toEqual([])
  })

  it('creates from the fresh resolution, only in a project tied to the item, and once per key', async () => {
    const { call, node } = await selected()
    node.state.resolution = { items: [item()] }
    const create = {
      op: 'handoff.create',
      nodeId: 'node-a',
      ...target,
      identifier: 'acme/widget#12',
      connectionId: 'conn-1',
    }
    const key = '0b5c1d3e-4f60-4a1b-9c2d-3e4f5a6b7c8d'
    await expect(call({ ...create, projectId: 'p2', key })).rejects.toMatchObject({ code: 'bad_request' })
    await expect(call({ ...create, connectionId: 'other', projectId: 'p1', key })).rejects.toMatchObject({
      code: 'not_found',
    })
    expect(node.state.createdTasks).toEqual([])

    const made = await call({ ...create, projectId: 'p1', key })
    expect(made).toMatchObject({ created: true, task: { projectId: 'p1', branch: 'fix-flaky' } })
    expect(node.state.createdTasks).toEqual([
      {
        key,
        body: { origin: 'tracker', title: 'Fix the flaky test', branch: 'fix-flaky', pullNumber: 12, projectId: 'p1' },
      },
    ])
    // Once the Node lists it, asking again answers the linked task rather than making another.
    node.state.tasks.push({ ...made.task, status: 'active', pullNumber: 12, links: [] })
    expect(await call({ ...create, projectId: 'p1', key: crypto.randomUUID() })).toMatchObject({
      created: false,
      task: { id: made.task.id },
    })
    expect(node.state.createdTasks).toHaveLength(1)
  })
})

describe('browser bridge site associations', () => {
  const app = { origin: 'https://example.com', pathPrefix: '/app' }
  const local = { origin: 'http://localhost:5173', pathPrefix: '/' }

  async function selected() {
    const subject = await paired()
    await subject.call({ op: 'node.select', nodeId: 'node-a' })
    subject.node.state.projects.push({ ...subject.node.state.projects[0]!, id: 'p2', name: 'Second' })
    return subject
  }

  it('lists every project associations, with the project each belongs to', async () => {
    const { call, node } = await selected()
    node.state.sites.set('p1', [app])
    node.state.sites.set('p2', [local, { origin: 'https://example.com', pathPrefix: '/docs' }])
    // A list that doesn't parse reads as none, rather than failing the whole read.
    node.state.projects.push({ ...node.state.projects[0]!, id: 'p3', name: 'Damaged' })
    node.state.sites.set('p3', [{ origin: 'ftp://example.com', pathPrefix: '/' }])
    expect(await call({ op: 'sites.list', nodeId: 'node-a' })).toEqual({
      nodeId: 'node-a',
      sites: [
        { projectId: 'p1', ...app },
        { projectId: 'p2', ...local },
        { projectId: 'p2', origin: 'https://example.com', pathPrefix: '/docs' },
      ],
    })
    await expect(call({ op: 'sites.list', nodeId: 'node-b' })).rejects.toMatchObject({ code: 'not_selected' })
  })

  it('adds and removes one association over the fresh list, and writes nothing for no change', async () => {
    const { call, node } = await selected()
    node.state.sites.set('p1', [app])
    expect(await call({ op: 'site.add', nodeId: 'node-a', projectId: 'p1', site: local })).toEqual({
      nodeId: 'node-a',
      projectId: 'p1',
      sites: [app, local],
    })
    // Another client added one since; the next change keeps it.
    const other = { origin: 'https://other.example', pathPrefix: '/' }
    node.state.sites.set('p1', [app, local, other])
    await call({ op: 'site.remove', nodeId: 'node-a', projectId: 'p1', site: app })
    expect(node.state.sites.get('p1')).toEqual([local, other])

    const writes = node.state.configWrites.length
    await call({ op: 'site.add', nodeId: 'node-a', projectId: 'p1', site: local })
    await call({ op: 'site.remove', nodeId: 'node-a', projectId: 'p1', site: app })
    expect(node.state.configWrites).toHaveLength(writes)
    // Every write names only the list, so the project's other settings stay as they are.
    expect(node.state.configWrites.map((write) => Object.keys(write.patch as object))).toEqual([
      ['siteAssociations'],
      ['siteAssociations'],
    ])
  })

  it('refuses a full list', async () => {
    const { call, node } = await selected()
    node.state.sites.set(
      'p1',
      Array.from({ length: 32 }, (_, index) => ({ origin: 'https://example.com', pathPrefix: `/p${index}` })),
    )
    await expect(call({ op: 'site.add', nodeId: 'node-a', projectId: 'p1', site: local })).rejects.toMatchObject({
      code: 'bad_request',
    })
  })

  describe('in a handoff', () => {
    const target = { pluginId: 'tracker', handoffId: 'item', url: 'https://tracker.example/acme/items/12' }
    const issue = {
      identifier: 'ENG-42',
      url: 'https://tracker.example/acme/items/12',
      title: 'Fix the flaky test',
      connection: { id: 'conn-1', label: 'Tracker' },
      projects: [],
      seed: { origin: 'tracker', links: [{ connectionId: 'conn-1', identifier: 'ENG-42' }] },
    }
    const create = {
      op: 'handoff.create',
      nodeId: 'node-a',
      ...target,
      identifier: 'ENG-42',
      connectionId: 'conn-1',
      key: '0b5c1d3e-4f60-4a1b-9c2d-3e4f5a6b7c8d',
    }

    it('offers and creates in a project whose association covers the page', async () => {
      const { call, node } = await selected()
      node.state.resolution = { items: [issue] }
      node.state.sites.set('p2', [{ origin: 'https://tracker.example', pathPrefix: '/acme' }])
      node.state.sites.set('p1', [{ origin: 'https://tracker.example', pathPrefix: '/other' }])
      const resolved = await call({ op: 'handoff.resolve', nodeId: 'node-a', ...target })
      expect(resolved.items[0].projects).toEqual([{ id: 'p2', name: 'Second' }])

      await expect(call({ ...create, projectId: 'p1' })).rejects.toMatchObject({ code: 'bad_request' })
      expect(await call({ ...create, projectId: 'p2' })).toMatchObject({ created: true, task: { projectId: 'p2' } })
    })

    it('keeps an item with a pull number to the projects the provider named', async () => {
      const { call, node } = await selected()
      node.state.resolution = { items: [{ ...issue, seed: { origin: 'tracker', pullNumber: 12 } }] }
      node.state.sites.set('p2', [{ origin: 'https://tracker.example', pathPrefix: '/' }])
      const resolved = await call({ op: 'handoff.resolve', nodeId: 'node-a', ...target })
      expect(resolved.items[0].projects).toEqual([])
      await expect(call({ ...create, projectId: 'p2' })).rejects.toMatchObject({ code: 'bad_request' })
      expect(node.state.createdTasks).toEqual([])
    })
  })
})
