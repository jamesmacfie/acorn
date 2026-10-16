import { createServer, type Server } from 'node:https'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { custody, desktopDataRootDir } from '@acorn/custody/local'
import { ensureCert } from '@acorn/node-core/server/transport'
import { ACORN_BASELINE } from '@acorn/protocol/baseline.ts'
import { NODE_PROTOCOL_VERSION } from '@acorn/protocol/node.ts'
import type { NodeStatus } from '@acorn/protocol/broker.ts'
import type { BridgeRequest } from '@acorn/protocol/extensionBridge.ts'
import { createBridge } from './bridge'

// Every broker the bridge makes keeps its event handlers here, so a test can deliver a Node's frame
// without a socket.
const brokerEvents = vi.hoisted(() => [] as { frame(nodeId: string, frame: unknown): void }[])
vi.mock('@acorn/custody/broker', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@acorn/custody/broker')>()
  class RecordingBroker extends actual.NodeBroker {
    constructor(...args: ConstructorParameters<typeof actual.NodeBroker>) {
      super(...args)
      brokerEvents.push(args[0])
    }
  }
  return { ...actual, NodeBroker: RecordingBroker }
})

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
    // Whether the owner has allowed the pairing ask.
    allowed: false,
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
    // The task address routes and panels discovery declares, and what each plugin route answers: a
    // body, an Error for a 500, or a bare status.
    taskAddresses: [] as { pluginId: string; route: string }[],
    panels: [] as Record<string, unknown>[],
    icons: [] as Record<string, unknown>[],
    pluginAnswers: new Map<string, unknown>(),
    createdTasks: [] as { key: string; body: Record<string, unknown> }[],
    projects: [{ id: 'p1', name: `${nodeId} project`, path: '/src/p1', workspaceId: 'w', sort: 0, hidden: false }],
    workspaces: [
      { id: 'w2', name: 'Later', sort: 1, isDefault: false, projects: [] },
      { id: 'w', name: 'Main', sort: 0, isDefault: true, projects: [{ id: 'p1', name: `${nodeId} project`, sort: 0 }] },
    ],
    // Each project's site associations, as its config holds them, and every config write.
    sites: new Map<string, unknown[]>(),
    configWrites: [] as { projectId: string; patch: unknown }[],
    // Every path the host asked for, in order.
    paths: [] as string[],
    // Every session archive, with its key.
    archives: [] as { key: string; body: unknown }[],
    // Every stop of a session's turn, with its key.
    cancels: [] as { key: string; body: unknown }[],
    // The body of the last session start.
    lastSessionBody: null as unknown,
    // A task's sessions, where a test names them. Any other task lists s1.
    taskSessions: new Map<string, Record<string, unknown>[]>(),
    // The workflows plugin's definitions, the runs it answers, and every start with its key.
    workflowDefs: [] as Record<string, unknown>[],
    workflowStartAnswer: { runId: 'run-1' } as Record<string, unknown>,
    workflowStarts: [] as { key: string; body: unknown }[],
  }
  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    state.paths.push(req.url ?? '')
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
    if (req.url === '/v1/pair/requests')
      return reply(200, { secret: 'ask-secret', phrase: 'maple river stone', expiresInMs: 1 })
    if (req.url === '/v1/pair/requests/claim') {
      let body = ''
      for await (const chunk of req) body += chunk
      if ((JSON.parse(body) as { secret: string }).secret !== 'ask-secret')
        return reply(401, { error: { code: 'pairing_failed', message: 'no' } })
      if (!state.allowed) return reply(202, { status: 'pending' })
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
    if (url.pathname === '/v1/core/browser-handoffs')
      return reply(200, {
        handoffs: state.handoffs,
        taskAddresses: state.taskAddresses,
        panels: state.panels,
        icons: state.icons,
      })
    if (state.pluginAnswers.has(url.pathname)) {
      const answer = state.pluginAnswers.get(url.pathname)
      if (answer instanceof Error) return reply(500, { error: { message: answer.message } })
      return typeof answer === 'number' ? reply(answer, { error: { message: 'No.' } }) : reply(200, answer)
    }
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
    // The open requests across the Node: one in a task the list has, one in a task it doesn't.
    if (url.pathname === '/v1/p/agents/requests')
      return reply(200, {
        requests: [
          { ...agentRequest('r1'), taskId: 't1' },
          { ...agentRequest('r9'), sessionId: 's9', taskId: 'archived-task' },
        ],
      })
    if (url.pathname === '/v1/p/agents/sessions' && req.method === 'GET') {
      state.lastQuery = url.search
      const sessions = state.taskSessions.get(url.searchParams.get('taskId')!) ?? [agentSession('s1')]
      return reply(200, { sessions, delegations: [], nextCursor: null })
    }
    if (url.pathname === '/v1/p/workflows/defs' && url.searchParams.get('workspaceId') === 'w')
      return reply(200, { workflows: state.workflowDefs, errors: [] })
    if (url.pathname === '/v1/p/workflows/tasks/t1/workflows' && req.method === 'POST') {
      let body = ''
      for await (const chunk of req) body += chunk
      state.workflowStarts.push({ key: String(req.headers['idempotency-key']), body: JSON.parse(body) })
      return reply(200, state.workflowStartAnswer)
    }
    if (url.pathname === '/v1/p/workflows/tasks/t1/workflows/runs')
      return reply(200, [
        { id: 'run-old', taskId: 't1', name: 'Older', status: 'done', createdAt: 1, updatedAt: 2, posture: 'gated' },
        { id: 'run-1', taskId: 't1', name: 'Review', status: 'running', createdAt: 5, updatedAt: 6, posture: 'gated' },
      ])
    if (url.pathname === '/v1/p/workflows/workflows/runs/run-1/steps')
      return reply(200, [
        {
          id: 'step-1',
          name: 'Explain',
          status: 'done',
          agentSessionId: 'w1',
          inputsJson: null,
          createdAt: 1,
          updatedAt: 9,
        },
        {
          id: 'step-2',
          name: 'Check',
          status: 'running',
          agentSessionId: null,
          inputsJson: null,
          createdAt: 9,
          updatedAt: 9,
        },
        {
          id: 'step-3',
          name: 'Elsewhere',
          status: 'running',
          agentSessionId: null,
          inputsJson: JSON.stringify({ childTaskId: 't-child' }),
          createdAt: 9,
          updatedAt: 9,
        },
        {
          id: 'step-4',
          name: 'Gate',
          status: 'pending',
          agentSessionId: null,
          inputsJson: null,
          createdAt: 9,
          updatedAt: 9,
        },
      ])
    if (url.pathname === '/v1/p/agents/sessions' && req.method === 'POST') {
      let body = ''
      for await (const chunk of req) body += chunk
      state.lastSessionBody = JSON.parse(body)
      return reply(200, { ...agentSession('s2'), ...JSON.parse(body), config: {} })
    }
    if (url.pathname === '/v1/p/agents/custom-agents')
      return reply(200, [
        {
          id: 'reviewer',
          name: 'Reviewer',
          providerId: 'claude',
          options: { model: 'opus' },
          glyph: 'rocket',
          instructions: '',
          source: { kind: 'user' },
        },
        { id: 'orphan', name: 'Orphan', providerId: 'gone', options: {}, instructions: '', source: { kind: 'user' } },
      ])
    if (url.pathname === '/v1/p/agents/sessions/s1/cancel' && req.method === 'POST') {
      let body = ''
      for await (const chunk of req) body += chunk
      state.cancels.push({ key: String(req.headers['idempotency-key']), body: JSON.parse(body) })
      return reply(200, { ok: true })
    }
    if (url.pathname === '/v1/p/agents/sessions/s1' && req.method === 'PATCH') {
      let body = ''
      for await (const chunk of req) body += chunk
      state.archives.push({ key: String(req.headers['idempotency-key']), body: JSON.parse(body) })
      return reply(200, { ...agentSession('s1'), archivedAt: 5 })
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
    if (req.url === '/v1/core/workspaces') return reply(200, state.workspaces)
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

function bridge(events: { tasksChanged?(nodeId: string): void } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-bridge-custody-'))
  const statuses: NodeStatus[] = []
  const created = createBridge({
    fleet: custody(dir).fleet,
    deviceName: 'test',
    status: (s) => statuses.push(s),
    ...events,
  })
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

// A data root as a running Node leaves it: its lock, `node.json` with the port, and `tls/cert.pem`.
// This test process holds the lock, so it reads as running.
function dataRoot(
  files: { nodeId?: string; port?: number; certPem?: string } = {},
  root = mkdtempSync(join(tmpdir(), 'acorn-bridge-root-')),
) {
  mkdirSync(root, { recursive: true })
  cleanup.push(() => rmSync(root, { recursive: true, force: true }))
  writeFileSync(join(root, 'node.lock'), `${process.pid}\n`)
  if (files.port)
    writeFileSync(
      join(root, 'node.json'),
      JSON.stringify({ baseline: ACORN_BASELINE, nodeId: files.nodeId, createdAt: 1, port: files.port }),
    )
  mkdirSync(join(root, 'tls'))
  writeFileSync(join(root, 'tls', 'cert.pem'), files.certPem ?? certA.certPem)
  return root
}

describe('browser bridge local discovery', () => {
  const nodeId = randomUUID()
  const portOf = (endpoint: string) => Number(new URL(endpoint).port)
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('finds the Node in the data root acorn reads, and pairs it with a code over the file certificate', async () => {
    const node = await fakeNode(nodeId)
    vi.stubEnv('ACORN_DATA_DIR', dataRoot({ nodeId, port: portOf(node.endpoint) }))
    const { call } = bridge()
    const found = await call({ op: 'node.local' })
    expect(found).toEqual({
      nodeId,
      endpoint: node.endpoint,
      fingerprint: certA.fingerprint,
      protocolVersion: NODE_PROTOCOL_VERSION,
      baseline: ACORN_BASELINE,
      compatible: true,
    })
    await expect(call({ op: 'node.pair', code: 'WRONG', label: 'x' })).rejects.toMatchObject({ code: 'pairing_failed' })
    expect(await call({ op: 'node.pair', code: CODE, label: 'This computer' })).toMatchObject({
      nodeId,
      fingerprint: certA.fingerprint,
    })
    await call({ op: 'node.select', nodeId })
    expect(await call({ op: 'projects.list', nodeId })).toMatchObject({ nodeId })
  })

  it('pairs the Node on this computer once the owner allows the ask', async () => {
    const node = await fakeNode(nodeId)
    vi.stubEnv('ACORN_DATA_DIR', dataRoot({ nodeId, port: portOf(node.endpoint) }))
    const { call } = bridge()
    await expect(call({ op: 'node.ask' })).rejects.toMatchObject({ code: 'no_probe' })
    await call({ op: 'node.local' })
    // The secret stays in the host. The sidebar gets the words the owner's dialog shows.
    expect(await call({ op: 'node.ask' })).toEqual({ phrase: 'maple river stone' })
    expect(await call({ op: 'node.collect', label: 'This computer' })).toBeNull()
    node.state.allowed = true
    expect(await call({ op: 'node.collect', label: 'This computer' })).toMatchObject({ nodeId, label: 'This computer' })
    await call({ op: 'node.select', nodeId })
    expect(await call({ op: 'projects.list', nodeId })).toMatchObject({ nodeId })
  })

  it('asks only the Node on this computer, never one typed in', async () => {
    const node = await fakeNode(nodeId)
    const { call } = bridge()
    await call({ op: 'node.probe', endpoint: node.endpoint })
    await expect(call({ op: 'node.ask' })).rejects.toMatchObject({ code: 'no_probe' })
  })

  it('finds nothing when no Node holds the data root', async () => {
    vi.stubEnv('ACORN_DATA_DIR', mkdtempSync(join(tmpdir(), 'acorn-bridge-empty-')))
    const { call } = bridge()
    expect(await call({ op: 'node.local' })).toBeNull()
    await expect(call({ op: 'node.pair', code: CODE, label: 'x' })).rejects.toMatchObject({ code: 'no_probe' })
  })

  it('refuses a held data root with no node.json, or a certificate it cannot read', async () => {
    const { call } = bridge()
    vi.stubEnv('ACORN_DATA_DIR', dataRoot())
    await expect(call({ op: 'node.local' })).rejects.toMatchObject({ code: 'node_error' })
    const node = await fakeNode(nodeId)
    vi.stubEnv('ACORN_DATA_DIR', dataRoot({ nodeId, port: portOf(node.endpoint), certPem: 'not a certificate' }))
    await expect(call({ op: 'node.local' })).rejects.toMatchObject({ code: 'node_error' })
  })

  it('refuses a Node whose address presents another certificate than its files, and keeps no probe', async () => {
    const node = await fakeNode(nodeId)
    const { call } = bridge()
    await call({ op: 'node.probe', endpoint: node.endpoint })
    vi.stubEnv('ACORN_DATA_DIR', dataRoot({ nodeId, port: portOf(node.endpoint), certPem: certB.certPem }))
    await expect(call({ op: 'node.local' })).rejects.toMatchObject({ code: 'identity_mismatch' })
    await expect(call({ op: 'node.pair', code: CODE, label: 'x' })).rejects.toMatchObject({ code: 'no_probe' })
  })

  it("reads only the data root acorn would, never the desktop's when another is set", async () => {
    const node = await fakeNode(nodeId)
    // The desktop app's root, under a stand-in home folder, holds a running Node.
    const home = dataRoot({}, mkdtempSync(join(tmpdir(), 'acorn-bridge-home-')))
    // Every variable the platform's app data folder reads, so no run touches the real desktop root.
    vi.stubEnv('HOME', home)
    vi.stubEnv('USERPROFILE', home)
    vi.stubEnv('XDG_CONFIG_HOME', '')
    vi.stubEnv('APPDATA', '')
    dataRoot({ nodeId, port: portOf(node.endpoint) }, desktopDataRootDir())
    const { call } = bridge()

    vi.stubEnv('ACORN_DATA_DIR', mkdtempSync(join(tmpdir(), 'acorn-bridge-empty-')))
    expect(await call({ op: 'node.local' })).toBeNull()
    vi.stubEnv('ACORN_DATA_DIR', '')
    expect(await call({ op: 'node.local' })).toMatchObject({ nodeId })
  })
})

describe('browser bridge selection', () => {
  it('lists the selected Node projects with their workspaces and refuses an unselected Node', async () => {
    const { call } = await paired()
    await expect(call({ op: 'projects.list', nodeId: 'node-a' })).rejects.toMatchObject({ code: 'not_selected' })
    expect(await call({ op: 'node.select', nodeId: 'node-a' })).toMatchObject({ activeNodeId: 'node-a' })
    expect(await call({ op: 'projects.list', nodeId: 'node-a' })).toEqual({
      nodeId: 'node-a',
      projects: [{ id: 'p1', name: 'node-a project', path: '/src/p1', hidden: false, workspaceId: 'w' }],
      // In the rail's order.
      workspaces: [
        { id: 'w', name: 'Main' },
        { id: 'w2', name: 'Later' },
      ],
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

  it('names a changed certificate when the sidebar lists Nodes, before any read', async () => {
    const { call, node, statuses } = await paired()
    await call({ op: 'node.select', nodeId: 'node-a' })
    // This fake Node has no WebSocket, so the broker already reports it offline.
    expect((await call({ op: 'nodes.list' })).status).toMatchObject({ nodeId: 'node-a', state: 'offline' })
    node.replaceCertificate()
    // The reply itself names it: a sidebar that has just opened ignores status events until then.
    const changed = { nodeId: 'node-a', state: 'offline', error: { code: 'identity_mismatch' } }
    expect((await call({ op: 'nodes.list' })).status).toEqual(changed)
    expect(statuses.at(-1)).toEqual(changed)
  })

  it('forgets a selected Node and clears the selection', async () => {
    const { call } = await paired()
    await call({ op: 'node.select', nodeId: 'node-a' })
    expect(await call({ op: 'node.forget', nodeId: 'node-a' })).toEqual({ nodes: [], activeNodeId: null, status: null })
  })

  it('renames a Node for this browser and keeps its pairing and selection', async () => {
    const { call } = await paired()
    await call({ op: 'node.select', nodeId: 'node-a' })
    const renamed = await call({ op: 'node.rename', nodeId: 'node-a', label: 'Studio Mac' })
    expect(renamed).toMatchObject({ activeNodeId: 'node-a', nodes: [{ nodeId: 'node-a', label: 'Studio Mac' }] })
    expect((await call({ op: 'nodes.list' })).nodes[0]).toMatchObject({ label: 'Studio Mac' })
    expect(await call({ op: 'projects.list', nodeId: 'node-a' })).toMatchObject({ nodeId: 'node-a' })
    await expect(call({ op: 'node.rename', nodeId: 'missing', label: 'Gone' })).rejects.toMatchObject({
      code: 'unknown_node',
    })
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
    // The desktop's New rows: the harness, then each custom agent on a harness this Node registers.
    expect(await call({ op: 'agents.choices', nodeId: 'node-a' })).toEqual({
      nodeId: 'node-a',
      choices: [
        {
          providerId: 'claude',
          profileId: 'claude-code',
          customAgentId: null,
          account: null,
          label: 'Claude Code',
          text: 'Claude Code',
          description: 'Available',
          glyph: null,
          accountIcon: null,
          available: true,
        },
        {
          providerId: 'claude',
          profileId: 'claude-code',
          customAgentId: 'reviewer',
          account: null,
          label: 'Reviewer',
          text: 'Reviewer',
          description: 'Claude Code · opus',
          glyph: 'rocket',
          accountIcon: null,
          available: true,
        },
      ],
    })
    await call({ op: 'agents.choices', nodeId: 'node-a', refresh: true })
    expect(node.state.paths).toContain('/v1/p/agents/providers?force=true')
    const listed = await call({ op: 'sessions.list', nodeId: 'node-a', taskId: 't1' })
    expect(listed.sessions.map((session: { id: string }) => session.id)).toEqual(['s1'])
    expect(listed.sessions[0]).not.toHaveProperty('config')
    expect(node.state.lastQuery).toBe('?taskId=t1&archived=false&limit=100')
    // Or every task's in a workspace.
    const inWorkspace = await call({ op: 'sessions.list', nodeId: 'node-a', workspaceId: 'w1' })
    expect(inWorkspace).toMatchObject({ workspaceId: 'w1', sessions: [{ id: 's1' }] })
    expect(node.state.lastQuery).toBe('?workspaceId=w1&archived=false&limit=100')
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
    const { call, node } = await selected()
    const created = await call({
      op: 'session.create',
      nodeId: 'node-a',
      taskId: 't1',
      providerId: 'claude',
      profileId: 'claude-code',
      key: 'create-key-1',
    })
    expect(created).toMatchObject({ nodeId: 'node-a', session: { id: 's2', taskId: 't1', kind: 'interactive' } })
    expect(node.state.lastSessionBody).not.toHaveProperty('customAgentId')
    // A custom agent's or a named login's row names it, and the Node applies it.
    await call({
      op: 'session.create',
      nodeId: 'node-a',
      taskId: 't1',
      providerId: 'claude',
      profileId: 'claude-code',
      customAgentId: 'reviewer',
      account: 'work',
      key: 'create-key-2',
    })
    expect(node.state.lastSessionBody).toMatchObject({ customAgentId: 'reviewer', account: 'work', config: {} })
  })

  it('archives a session through the agents route with the key', async () => {
    const { call, node } = await selected()
    expect(await call({ op: 'session.archive', nodeId: 'node-a', sessionId: 's1', key: 'archive-key-1' })).toEqual({
      nodeId: 'node-a',
      sessionId: 's1',
    })
    expect(node.state.archives).toEqual([{ key: 'archive-key-1', body: { archived: true } }])
  })

  it("stops a session's turn through the agents route with the key", async () => {
    const { call, node } = await selected()
    expect(await call({ op: 'session.cancel', nodeId: 'node-a', sessionId: 's1', key: 'cancel-key-1' })).toEqual({
      nodeId: 'node-a',
      sessionId: 's1',
    })
    expect(node.state.cancels).toEqual([{ key: 'cancel-key-1', body: {} }])
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

  it("lists the Node's open requests with their project and task, leaving out tasks that aren't active", async () => {
    const { call } = await selected()
    expect(await call({ op: 'requests.pending', nodeId: 'node-a' })).toEqual({
      nodeId: 'node-a',
      requests: [
        {
          requestId: 'r1',
          sessionId: 's1',
          taskId: 't1',
          projectId: 'p1',
          kind: agentRequest('r1').kind,
          title: agentRequest('r1').title,
          taskTitle: 'Fix it',
        },
      ],
    })
    await call({ op: 'node.select', nodeId: null })
    await expect(call({ op: 'requests.pending', nodeId: 'node-a' })).rejects.toMatchObject({ code: 'not_selected' })
  })

  it("lists each active task's page addresses from the Node's task list alone", async () => {
    const { call, node } = await selected()
    const task = { branch: null, status: 'active', github: null, pullNumber: null, links: [] }
    node.state.tasks = [
      // A pull request is the project's repository and the task's number.
      {
        ...task,
        id: 'pr',
        title: 'Fix rounding',
        projectId: 'p1',
        github: { owner: 'acme', name: 'runn' },
        pullNumber: 482,
      },
      {
        ...task,
        id: 'issue',
        title: 'Linear issue',
        projectId: 'p1',
        branch: 'eng-42',
        links: [
          {
            connectionId: 'c1',
            providerId: 'linear',
            identifier: 'ENG-42',
            ref: {
              providerId: 'linear',
              connectionId: 'c1',
              displayId: 'ENG-42',
              url: 'https://linear.app/acme/issue/ENG-42/fix/',
            },
          },
          // A link whose provider stamped no address, and one that isn't a web address.
          { connectionId: 'c2', providerId: 'rollbar', identifier: '7' },
          { connectionId: 'c3', providerId: 'other', identifier: 'x', ref: { url: 'mailto:someone@example.com' } },
        ],
      },
      // The project's repository alone names no page, so the task is listed with none. An archived
      // task is never listed.
      { ...task, id: 'plain', title: 'No item', projectId: 'p1', github: { owner: 'acme', name: 'runn' } },
      {
        ...task,
        id: 'old',
        title: 'Old',
        projectId: 'p1',
        status: 'archived',
        github: { owner: 'acme', name: 'runn' },
        pullNumber: 1,
      },
    ]
    node.state.paths = []
    expect(await call({ op: 'tasks.pages', nodeId: 'node-a' })).toEqual({
      nodeId: 'node-a',
      tasks: [
        {
          id: 'pr',
          title: 'Fix rounding',
          branch: null,
          projectId: 'p1',
          pages: [{ origin: 'https://github.com', pathPrefix: '/acme/runn/pull/482', source: 'github' }],
        },
        {
          id: 'issue',
          title: 'Linear issue',
          branch: 'eng-42',
          projectId: 'p1',
          pages: [{ origin: 'https://linear.app', pathPrefix: '/acme/issue/ENG-42/fix', source: 'linear' }],
        },
        { id: 'plain', title: 'No item', branch: null, projectId: 'p1', pages: [] },
      ],
    })
    // One read of the Node's active tasks and one of its plugins' declarations, besides the broker's own
    // connection checks, and nothing that reaches a provider.
    expect(node.state.paths.filter((path) => !['/v1/node', '/v1/events'].includes(path)).sort()).toEqual([
      '/v1/core/browser-handoffs',
      '/v1/core/tasks',
    ])
    await call({ op: 'node.select', nodeId: null })
    await expect(call({ op: 'tasks.pages', nodeId: 'node-a' })).rejects.toMatchObject({ code: 'not_selected' })
  })

  it('adds the exact origins plugins publish for active tasks, and skips a plugin that fails', async () => {
    const { call, node } = await selected()
    const task = { branch: null, status: 'active', github: null, pullNumber: null, links: [], projectId: 'p1' }
    node.state.tasks = [
      { ...task, id: 'stack', title: 'Fix rounding', branch: 'fix/rounding' },
      { ...task, id: 'old', title: 'Old', status: 'archived' },
    ]
    const address = { label: 'Runn stack', state: 'running', severity: 'info' }
    node.state.taskAddresses = [
      { pluginId: 'runn', route: '/v1/p/runn/task-addresses' },
      { pluginId: 'broken', route: '/v1/p/broken/addresses' },
      { pluginId: 'odd', route: '/v1/p/odd/addresses' },
      // A route outside the plugin's own namespace is never called.
      { pluginId: 'sneaky', route: '/v1/core/tasks' },
    ]
    node.state.pluginAnswers.set('/v1/p/runn/task-addresses', {
      addresses: [
        { ...address, taskId: 'stack', origin: 'https://runn-05ea41.runn.localhost:5104' },
        { ...address, taskId: 'old', origin: 'https://runn-0ld.runn.localhost:5104' },
        { ...address, taskId: 'gone', origin: 'https://runn-g0ne.runn.localhost:5104' },
      ],
    })
    node.state.pluginAnswers.set('/v1/p/broken/addresses', new Error('boom'))
    // Another site's host isn't a task's app, so the whole answer is refused.
    node.state.pluginAnswers.set('/v1/p/odd/addresses', {
      addresses: [
        { ...address, taskId: 'stack', origin: 'https://runn-0dd.runn.localhost:5104' },
        { ...address, taskId: 'stack', origin: 'https://github.com' },
      ],
    })
    node.state.paths = []
    expect(await call({ op: 'tasks.pages', nodeId: 'node-a' })).toEqual({
      nodeId: 'node-a',
      tasks: [
        {
          id: 'stack',
          title: 'Fix rounding',
          branch: 'fix/rounding',
          projectId: 'p1',
          pages: [
            {
              origin: 'https://runn-05ea41.runn.localhost:5104',
              pathPrefix: '/',
              source: 'runn',
              status: { label: 'Runn stack', state: 'running', tone: 'ok' },
            },
          ],
        },
      ],
    })
    expect(node.state.paths.filter((path) => path === '/v1/core/tasks')).toHaveLength(1)
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

describe('browser bridge workflows', () => {
  async function selected() {
    const subject = await paired()
    await subject.call({ op: 'node.select', nodeId: 'node-a' })
    return subject
  }
  const definition = (over: Record<string, unknown>) => ({ id: 'd', name: 'D', source: 'repo', steps: [], ...over })

  it("lists what a task in the project can run, by the desktop's rule, with each one's inputs", async () => {
    const { call, node } = await selected()
    node.state.workflowDefs = [
      definition({ id: 'review', name: 'Review', projectId: 'p1', inputs: [{ name: 'issue', required: true }] }),
      definition({ id: 'shared', name: 'Shared', source: 'database', projectId: null, publishedRevision: 2 }),
      definition({ id: 'draft', source: 'database', publishedRevision: null }),
      definition({ id: 'broken', problems: ['Step 2 names no profile.'] }),
      definition({ id: 'other', projectId: 'p2' }),
    ]
    expect(await call({ op: 'workflows.list', nodeId: 'node-a', projectId: 'p1' })).toEqual({
      nodeId: 'node-a',
      projectId: 'p1',
      workflows: [
        { id: 'review', name: 'Review', inputs: [{ name: 'issue', required: true }] },
        { id: 'shared', name: 'Shared', inputs: [] },
      ],
    })
    await expect(call({ op: 'workflows.list', nodeId: 'node-a', projectId: 'gone' })).rejects.toMatchObject({
      code: 'not_found',
    })
  })

  it('starts a run with its key and inputs, and passes on a refusal in words', async () => {
    const { call, node } = await selected()
    const start = { op: 'workflow.start', nodeId: 'node-a', taskId: 't1', defId: 'review', key: 'start-key-1' }
    expect(await call({ ...start, inputs: { issue: 'Flaky test' } })).toEqual({
      nodeId: 'node-a',
      taskId: 't1',
      runId: 'run-1',
    })
    expect(node.state.workflowStarts).toEqual([
      { key: 'start-key-1', body: { defId: 'review', inputs: { issue: 'Flaky test' } } },
    ])
    node.state.workflowStartAnswer = { error: 'needs-trust' }
    await expect(call(start)).rejects.toMatchObject({ code: 'node_error', message: expect.stringContaining('trust') })
    node.state.workflowStartAnswer = {}
    await expect(call(start)).rejects.toMatchObject({ code: 'ambiguous_mutation' })
  })

  it("lists a task's runs newest first, and finds each step's conversation in its own task", async () => {
    const { call, node } = await selected()
    expect(await call({ op: 'workflow.runs', nodeId: 'node-a', taskId: 't1' })).toEqual({
      nodeId: 'node-a',
      taskId: 't1',
      runs: [
        { id: 'run-1', name: 'Review', status: 'running', createdAt: 5, updatedAt: 6 },
        { id: 'run-old', name: 'Older', status: 'done', createdAt: 1, updatedAt: 2 },
      ],
    })
    // The finished step names its session; a running one is found by the step the agents plugin wrote
    // on it, here and in the task the runner gave a step of its own.
    node.state.taskSessions.set('t1', [
      { ...agentSession('w1'), kind: 'workflow' },
      { ...agentSession('w2'), kind: 'workflow', config: { workflowStepId: 'step-2' } },
    ])
    node.state.taskSessions.set('t-child', [
      { ...agentSession('w3'), taskId: 't-child', config: { workflowStepId: 'step-3' } },
    ])
    const read = await call({ op: 'workflow.steps', nodeId: 'node-a', taskId: 't1', runId: 'run-1' })
    expect(
      read.steps.map((step: { id: string; session: { id: string } | null }) => [step.id, step.session?.id ?? null]),
    ).toEqual([
      ['step-1', 'w1'],
      ['step-2', 'w2'],
      ['step-3', 'w3'],
      ['step-4', null],
    ])
    expect(read.steps[0]).toMatchObject({ name: 'Explain', status: 'done', createdAt: 1, updatedAt: 9 })
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

  it('lists the declared handoffs without their routes, and the logos that pass the manifest rule', async () => {
    const { call, node } = await selected()
    node.state.handoffs.push({ ...node.state.handoffs[0], id: 'stray', resolve: '/v1/p/agents/sessions' })
    const icon = { pluginId: 'tracker', d: 'M2 2h20v20H2z', color: '#5e6ad2' }
    node.state.icons.push(icon, { pluginId: 'sneaky', d: 'M0 0', color: 'url(https://sneaky.example/)' })
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
      panels: [],
      icons: [icon],
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

describe('browser bridge plugin panels', () => {
  const panel = { pluginId: 'runn', label: 'Runn', glyph: 'container', pane: 'runn', route: '/v1/p/runn/browser-panel' }
  const view = {
    blocks: [
      { kind: 'status', label: 'Stack', state: 'running', severity: 'info' },
      { kind: 'logs', title: 'Logs', sources: [{ id: 'web', label: 'web' }], source: 'web', lines: ['ready'] },
    ],
  }

  async function selected(events: { tasksChanged?(nodeId: string): void } = {}) {
    const node = await fakeNode('node-a')
    const subject = bridge(events)
    await subject.call({ op: 'node.probe', endpoint: node.endpoint })
    await subject.call({ op: 'node.pair', code: CODE, label: 'Studio' })
    await subject.call({ op: 'node.select', nodeId: 'node-a' })
    node.state.panels = [
      panel,
      // A panel served from outside its plugin's namespace is never listed or called.
      { pluginId: 'sneaky', label: 'Sneaky', route: '/v1/core/tasks' },
    ]
    return { node, ...subject }
  }

  it('lists the declared panels without their routes', async () => {
    const { call } = await selected()
    const { route: _route, ...listed } = panel
    expect((await call({ op: 'handoffs.list', nodeId: 'node-a' })).panels).toEqual([listed])
  })

  it("calls the declared route with the task and the person's log source", async () => {
    const { call, node } = await selected()
    node.state.pluginAnswers.set(panel.route, view)
    node.state.paths = []
    expect(await call({ op: 'plugin.panel', nodeId: 'node-a', pluginId: 'runn', taskId: 't1', source: 'web' })).toEqual(
      {
        nodeId: 'node-a',
        pluginId: 'runn',
        taskId: 't1',
        view,
      },
    )
    expect(node.state.paths).toContain('/v1/p/runn/browser-panel?taskId=t1&source=web')
  })

  it('answers no view for a task the plugin has no panel for, or a plugin with no panel', async () => {
    const { call, node } = await selected()
    node.state.pluginAnswers.set(panel.route, 404)
    expect((await call({ op: 'plugin.panel', nodeId: 'node-a', pluginId: 'runn', taskId: 't1' })).view).toBeNull()
    node.state.paths = []
    for (const pluginId of ['tracker', 'sneaky'])
      expect((await call({ op: 'plugin.panel', nodeId: 'node-a', pluginId, taskId: 't1' })).view).toBeNull()
    expect(node.state.paths).toEqual(['/v1/core/browser-handoffs', '/v1/core/browser-handoffs'])
  })

  it('refuses a view the extension cannot draw, or one past the size limit', async () => {
    const { call, node } = await selected()
    const read = () => call({ op: 'plugin.panel', nodeId: 'node-a', pluginId: 'runn', taskId: 't1' })
    node.state.pluginAnswers.set(panel.route, { blocks: [{ kind: 'chart', title: 'CPU' }] })
    await expect(read()).rejects.toMatchObject({
      code: 'node_error',
      message: "The runn plugin answered with something the extension can't use.",
    })
    // Valid block by block, and over 512 KiB as a whole.
    const lines = Array.from({ length: 200 }, () => 'x'.repeat(1_000))
    const logs = { kind: 'logs', title: 'Logs', sources: [], source: null, lines }
    node.state.pluginAnswers.set(panel.route, { blocks: [logs, logs, logs] })
    // The broker stops reading at the limit, as it does for a handoff's resolution.
    await expect(read()).rejects.toMatchObject({ code: 'node_unreachable' })
  })

  it('asks the sidebar to read again when a plugin with only a panel reports a change', async () => {
    const tasksChanged = vi.fn()
    const { call } = await selected({ tasksChanged })
    await call({ op: 'tasks.pages', nodeId: 'node-a' })
    const events = brokerEvents.at(-1)!
    events.frame('node-a', { channel: 'term:status', pluginId: 'tracker' })
    expect(tasksChanged).not.toHaveBeenCalled()
    events.frame('node-a', { channel: 'term:status', pluginId: 'runn' })
    expect(tasksChanged).toHaveBeenCalledWith('node-a')
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
