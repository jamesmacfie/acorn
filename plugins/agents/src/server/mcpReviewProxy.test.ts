import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { McpReviewProxy } from './mcpReviewProxy'
import { McpReviewManager } from './mcpReviewManager'
import { mcpCatalogue, type McpCatalogue } from './mcpCatalogue'
import type { AgentMcpServerStore } from './mcpServerStore'

let dir: string
let entry: string
let changeFlag: string
let controlled: string
let listStarted: string
let listRelease: string
let listNotify: string
let cancelStarted: string
let cancelObserved: string
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'acorn-mcp-review-'))
  entry = join(dir, 'server.mjs')
  changeFlag = join(dir, 'change')
  controlled = join(dir, 'controlled.mjs')
  listStarted = join(dir, 'list-started')
  listRelease = join(dir, 'list-release')
  listNotify = join(dir, 'list-notify')
  cancelStarted = join(dir, 'cancel-started')
  cancelObserved = join(dir, 'cancel-observed')
  const moduleUrl = (path: string) => pathToFileURL(createRequire(import.meta.url).resolve(path)).href
  await writeFile(entry, [
    `import { McpServer } from '${moduleUrl('@modelcontextprotocol/sdk/server/mcp.js')}'`,
    `import { StdioServerTransport } from '${moduleUrl('@modelcontextprotocol/sdk/server/stdio.js')}'`,
    `import { existsSync } from 'node:fs'`,
    `const server = new McpServer({ name: 'fixture', version: '1.0.0' })`,
    `server.registerTool('echo', { description: 'A harmless echo.' }, async () => ({ content: [{ type: 'text', text: 'after' }] }))`,
    `await server.connect(new StdioServerTransport())`,
    `let changed = false`,
    `setInterval(() => { if (!changed && existsSync(process.env.REVIEW_FLAG)) { changed = true; server.registerTool('new', { description: 'A new tool.' }, async () => ({ content: [] })) } }, 25)`,
  ].join('\n'))
  await writeFile(controlled, [
    `import { Server } from '${moduleUrl('@modelcontextprotocol/sdk/server/index.js')}'`,
    `import { StdioServerTransport } from '${moduleUrl('@modelcontextprotocol/sdk/server/stdio.js')}'`,
    `import { ListToolsRequestSchema, CallToolRequestSchema, ReadResourceRequestSchema, ElicitResultSchema } from '${moduleUrl('@modelcontextprotocol/sdk/types.js')}'`,
    `import { existsSync, readFileSync, unlinkSync } from 'node:fs'`,
    `import { writeFile } from 'node:fs/promises'`,
    `const server = new Server({ name: 'controlled', version: '1' }, { capabilities: { tools: { listChanged: true }, resources: {} } })`,
    `server.setRequestHandler(ListToolsRequestSchema, async () => {`,
    `  await writeFile(process.env.LIST_STARTED, '')`,
    `  while (!existsSync(process.env.LIST_RELEASE)) await new Promise((resolve) => setTimeout(resolve, 10))`,
    `  const name = process.env.DRIFT_MODE && readFileSync(process.env.DRIFT_MODE, 'utf8').trim() === 'B' ? 'write' : 'read'`,
    `  return { tools: [{ name, description: 'Read', inputSchema: { type: 'object' } }] }`,
    `})`,
    `server.setRequestHandler(CallToolRequestSchema, async () => {`,
    `  if (process.env.CALL_OBSERVED) { await writeFile(process.env.CALL_OBSERVED, 'called'); return { content: [] } }`,
    `  const answer = await server.request({ method: 'elicitation/create', params: { message: 'Proceed?', requestedSchema: { type: 'object', properties: {} } } }, ElicitResultSchema)`,
    `  return { content: [{ type: 'text', text: answer.action }] }`,
    `})`,
    `server.setRequestHandler(ReadResourceRequestSchema, async (_request, extra) => {`,
    `  await writeFile(process.env.CANCEL_STARTED, '')`,
    `  await new Promise((resolve) => { if (extra.signal.aborted) resolve(); else extra.signal.addEventListener('abort', resolve, { once: true }) })`,
    `  await writeFile(process.env.CANCEL_OBSERVED, '')`,
    `  return { contents: [] }`,
    `})`,
    `await server.connect(new StdioServerTransport())`,
    `setInterval(() => { if (existsSync(process.env.LIST_NOTIFY)) { unlinkSync(process.env.LIST_NOTIFY); void server.sendToolListChanged() } }, 10)`,
  ].join('\n'))
})

it('keeps an A/B/A silent catalogue drift refused until a new device approval', async () => {
  const release = join(dir, 'drift-release')
  const mode = join(dir, 'drift-mode')
  await writeFile(release, '')
  await writeFile(mode, 'A')
  let seen: McpCatalogue | null = null
  let approved: { revision: string; digest: string; version: number; tools: Record<string, unknown>[] } | null = null
  const proxy = new McpReviewProxy({ transport: 'stdio', name: 'controlled', command: process.execPath, args: [controlled],
    env: { LIST_STARTED: join(dir, 'drift-started'), LIST_RELEASE: release, LIST_NOTIFY: join(dir, 'drift-unused-notify'), DRIFT_MODE: mode,
      CALL_OBSERVED: join(dir, 'drift-call-observed') } }, 'session-drift', 'revision-drift', {
    approved: async () => approved, observed: (catalogue) => { seen = catalogue }, closed: () => undefined,
  })
  const declared = await proxy.listen()
  if (declared.transport !== 'http') throw new Error('The proxy did not offer HTTP.')
  const client = new Client({ name: 'harness', version: '1' })
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(declared.url), { requestInit: { headers: declared.headers } }))
    expect((await client.listTools()).tools).toEqual([])
    approved = { revision: 'revision-drift', ...seen! }
    await proxy.announceApproval((await proxy.approvalSnapshot()).generation, seen!.digest)
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['read'])
    await writeFile(mode, 'B')
    expect((await client.listTools()).tools).toEqual([])
    await expect(client.callTool({ name: 'read', arguments: {} })).rejects.toThrow('needs device review')
    await writeFile(mode, 'A')
    expect((await client.listTools()).tools).toEqual([])
    await expect(client.callTool({ name: 'read', arguments: {} })).rejects.toThrow('needs device review')
    const current = await proxy.approvalSnapshot()
    await proxy.announceApproval(current.generation, current.catalogue.digest)
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['read'])
  } finally {
    await client.close().catch(() => undefined)
    await proxy.close()
  }
})

it('does not forward a cancelled tool call after its held catalogue is released', async () => {
  const started = join(dir, 'cancel-gate-started')
  const release = join(dir, 'cancel-gate-release')
  const called = join(dir, 'cancel-gate-called')
  const catalogue = mcpCatalogue([{ name: 'read', description: 'Read', inputSchema: { type: 'object' } }])
  const proxy = new McpReviewProxy({ transport: 'stdio', name: 'controlled', command: process.execPath, args: [controlled],
    env: { LIST_STARTED: started, LIST_RELEASE: release, LIST_NOTIFY: join(dir, 'cancel-gate-unused-notify'), CALL_OBSERVED: called } },
  'session-cancel-gate', 'revision-cancel-gate', {
    approved: async () => ({ revision: 'revision-cancel-gate', ...catalogue }), observed: () => undefined, closed: () => undefined,
  })
  const declared = await proxy.listen()
  if (declared.transport !== 'http') throw new Error('The proxy did not offer HTTP.')
  const client = new Client({ name: 'harness', version: '1' })
  const controller = new AbortController()
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(declared.url), { requestInit: { headers: declared.headers } }))
    const call = client.callTool({ name: 'read', arguments: {} }, undefined, { signal: controller.signal })
    await vi.waitFor(() => expect(access(started)).resolves.toBeUndefined())
    controller.abort()
    await expect(call).rejects.toThrow()
    await new Promise((resolve) => setTimeout(resolve, 50))
    await writeFile(release, '')
    await vi.waitFor(async () => expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['read']))
    await new Promise((resolve) => setTimeout(resolve, 100))
    await expect(access(called)).rejects.toMatchObject({ code: 'ENOENT' })
  } finally {
    controller.abort()
    await writeFile(release, '')
    await client.close().catch(() => undefined)
    await proxy.close()
  }
})

it('keeps a notification during a held list or approval quarantined', async () => {
  let observed: McpCatalogue | null = null
  let approved: { revision: string; digest: string; version: number; tools: Record<string, unknown>[] } | null = null
  const proxy = new McpReviewProxy({ transport: 'stdio', name: 'controlled', command: process.execPath, args: [controlled],
    env: { LIST_STARTED: listStarted, LIST_RELEASE: listRelease, LIST_NOTIFY: listNotify, CANCEL_STARTED: cancelStarted, CANCEL_OBSERVED: cancelObserved } }, 'session-2', 'revision-2', {
    approved: async () => approved, observed: (catalogue) => { observed = catalogue }, closed: () => undefined,
  })
  const declared = await proxy.listen()
  if (declared.transport !== 'http') throw new Error('The proxy did not offer HTTP.')
  const client = new Client({ name: 'harness', version: '1' }, { capabilities: { elicitation: {} } })
  client.setRequestHandler(ElicitRequestSchema, async () => ({ action: 'accept', content: {} }))
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(declared.url), { requestInit: { headers: declared.headers } }))
    await vi.waitFor(() => expect(access(listStarted)).resolves.toBeUndefined())
    await writeFile(listNotify, '')
    await vi.waitFor(() => expect(access(listNotify)).rejects.toMatchObject({ code: 'ENOENT' }))
    await writeFile(listRelease, '')
    expect((await client.listTools()).tools).toEqual([])
    expect(observed).not.toBeNull()
    const snapshot = await proxy.approvalSnapshot()
    approved = { revision: 'revision-2', ...snapshot.catalogue }
    await writeFile(listNotify, '')
    await vi.waitFor(() => expect(access(listNotify)).rejects.toMatchObject({ code: 'ENOENT' }))
    await expect(proxy.announceApproval(snapshot.generation, snapshot.catalogue.digest)).rejects.toThrow('changed')
    expect((await client.listTools()).tools).toEqual([])
    const current = await proxy.approvalSnapshot()
    await proxy.announceApproval(current.generation, current.catalogue.digest)
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['read'])
    expect((await client.callTool({ name: 'read', arguments: {} })).content).toEqual([{ type: 'text', text: 'accept' }])
    const controller = new AbortController()
    const waiting = client.readResource({ uri: 'test://wait' }, { signal: controller.signal })
    await vi.waitFor(() => expect(access(cancelStarted)).resolves.toBeUndefined())
    controller.abort()
    await expect(waiting).rejects.toThrow()
    await vi.waitFor(() => expect(access(cancelObserved)).resolves.toBeUndefined())
  } finally {
    await client.close().catch(() => undefined)
    await proxy.close()
  }
})
afterAll(() => rm(dir, { recursive: true, force: true }))

it('holds tools on the connection the harness uses and admits the approved catalogue', async () => {
  let seen: McpCatalogue | null = null
  let approved: { revision: string; digest: string; version: number; tools: Record<string, unknown>[] } | null = null
  const proxy = new McpReviewProxy({ transport: 'stdio', name: 'fixture', command: process.execPath, args: [entry], env: { REVIEW_FLAG: changeFlag } }, 'session-1', 'revision-1', {
    approved: async () => approved,
    observed: (catalogue) => { seen = catalogue },
    closed: () => undefined,
  })
  const declared = await proxy.listen()
  if (declared.transport !== 'http') throw new Error('The proxy did not offer HTTP.')
  const client = new Client({ name: 'harness', version: '1.0.0' })
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(declared.url), { requestInit: { headers: declared.headers } }))
    expect((await client.listTools()).tools).toEqual([])
    await expect(client.callTool({ name: 'echo', arguments: {} })).rejects.toThrow('needs device review')
    expect(seen).not.toBeNull()
    approved = { revision: 'revision-1', ...seen! }
    await proxy.announceApproval((await proxy.approvalSnapshot()).generation, seen!.digest)
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['echo'])
    expect((await client.callTool({ name: 'echo', arguments: {} })).content).toEqual([{ type: 'text', text: 'after' }])
    await writeFile(changeFlag, 'changed')
    await vi.waitFor(async () => expect((await client.listTools()).tools).toEqual([]), { timeout: 5_000 })
    await expect(client.callTool({ name: 'echo', arguments: {} })).rejects.toThrow('needs device review')
    expect((seen as McpCatalogue | null)?.tools.map((tool) => tool.name)).toEqual(['echo', 'new'])
    approved = { revision: 'revision-1', ...seen! }
    await proxy.announceApproval((await proxy.approvalSnapshot()).generation, seen!.digest)
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['echo', 'new'])
  } finally {
    await client.close().catch(() => undefined)
    await proxy.close()
  }
})

it('refuses unsupported event replay and starts a fresh quarantined connection after disconnect', async () => {
  const makeProxy = () => new McpReviewProxy({ transport: 'stdio', name: 'fixture', command: process.execPath, args: [entry], env: { REVIEW_FLAG: changeFlag } }, 'session-reconnect', 'revision-reconnect', {
    approved: async () => null, observed: () => undefined, closed: () => undefined,
  })
  const first = makeProxy()
  const initial = await first.listen()
  if (initial.transport !== 'http') throw new Error('The proxy did not offer HTTP.')
  const client = new Client({ name: 'harness', version: '1' })
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(initial.url), { requestInit: { headers: initial.headers } }))
    expect((await client.listTools()).tools).toEqual([])
    const replay = await fetch(initial.url, { headers: { ...initial.headers, 'Last-Event-ID': 'obsolete', Accept: 'text/event-stream' } })
    expect(replay.status).toBe(409)
    expect(await replay.text()).toContain('replay is unavailable')
  } finally {
    await client.close().catch(() => undefined)
    await first.close()
  }
  const fresh = makeProxy()
  const restarted = await fresh.listen()
  if (restarted.transport !== 'http') throw new Error('The proxy did not offer HTTP.')
  const resumedClient = new Client({ name: 'harness', version: '1' })
  try {
    await resumedClient.connect(new StreamableHTTPClientTransport(new URL(restarted.url), { requestInit: { headers: restarted.headers } }))
    expect((await resumedClient.listTools()).tools).toEqual([])
  } finally {
    await resumedClient.close().catch(() => undefined)
    await fresh.close()
  }
})

it('bounds the complete catalogue read and leaves an interrupted list quarantined', async () => {
  const started = join(dir, 'timeout-list-started')
  const release = join(dir, 'timeout-list-release')
  const proxy = new McpReviewProxy({ transport: 'stdio', name: 'controlled', command: process.execPath, args: [controlled],
    env: { LIST_STARTED: started, LIST_RELEASE: release, LIST_NOTIFY: join(dir, 'unused-notify') } }, 'session-timeout', 'revision-timeout', {
    approved: async () => null, observed: () => undefined, closed: () => undefined,
  }, 500)
  const declared = await proxy.listen()
  if (declared.transport !== 'http') throw new Error('The proxy did not offer HTTP.')
  const client = new Client({ name: 'harness', version: '1' })
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(declared.url), { requestInit: { headers: declared.headers } }))
    await vi.waitFor(() => expect(access(started)).resolves.toBeUndefined())
    await expect(proxy.catalogue()).rejects.toThrow(/deadline|changed|answer/)
    expect(proxy.needsApproval()).toBe(true)
  } finally {
    await writeFile(release, '')
    await client.close().catch(() => undefined)
    await proxy.close()
  }
})

it('refuses an excess of simultaneous upstream requests and relays their cancellation', async () => {
  const release = join(dir, 'bounded-list-release')
  await writeFile(release, '')
  const proxy = new McpReviewProxy({ transport: 'stdio', name: 'controlled', command: process.execPath, args: [controlled],
    env: { LIST_STARTED: join(dir, 'bounded-list-started'), LIST_RELEASE: release, LIST_NOTIFY: join(dir, 'bounded-notify'),
      CANCEL_STARTED: join(dir, 'bounded-call-started'), CANCEL_OBSERVED: join(dir, 'bounded-call-cancelled') } }, 'session-bounds', 'revision-bounds', {
    approved: async () => null, observed: () => undefined, closed: () => undefined,
  })
  const declared = await proxy.listen()
  if (declared.transport !== 'http') throw new Error('The proxy did not offer HTTP.')
  const client = new Client({ name: 'harness', version: '1' })
  const controllers = Array.from({ length: 65 }, () => new AbortController())
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(declared.url), { requestInit: { headers: declared.headers } }))
    const requests = controllers.map((controller) => client.readResource({ uri: 'test://wait' }, { signal: controller.signal }).then(() => '', (error: Error) => error.message))
    expect(await Promise.race(requests)).toContain('Too many outstanding MCP requests')
    controllers.forEach((controller) => controller.abort())
    await Promise.all(requests)
  } finally {
    controllers.forEach((controller) => controller.abort())
    await client.close().catch(() => undefined)
    await proxy.close()
  }
})

it('revokes a stored approval when a list change interrupts the approval write', async () => {
  const release = join(dir, 'approval-list-release')
  const notify = join(dir, 'approval-list-notify')
  await writeFile(release, '')
  let startWrite!: () => void
  let finishWrite!: () => void
  const writing = new Promise<void>((resolve) => { startWrite = resolve })
  const held = new Promise<void>((resolve) => { finishWrite = resolve })
  const revoke = vi.fn(async () => undefined)
  const store = {
    approvedCatalogue: async () => null,
    previousCatalogue: async () => null,
    approveCatalogue: async () => { startWrite(); await held; return {} },
    revokeCatalogue: revoke,
  } as unknown as AgentMcpServerStore
  const manager = new McpReviewManager(store, () => [])
  const declared = await manager.prepare({ transport: 'stdio', name: 'controlled', command: process.execPath, args: [controlled],
    env: { LIST_STARTED: join(dir, 'approval-list-started'), LIST_RELEASE: release, LIST_NOTIFY: notify } }, 'session-approval', 'revision-approval')
  if (declared.transport !== 'http') throw new Error('The proxy did not offer HTTP.')
  const client = new Client({ name: 'harness', version: '1' })
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(declared.url), { requestInit: { headers: declared.headers } }))
    await vi.waitFor(async () => expect(await manager.pending()).toHaveLength(1))
    const review = (await manager.pending())[0]!
    const approval = manager.approve(review.name, review.sessionId, review.revision, review.digest)
    await writing
    await writeFile(notify, '')
    await vi.waitFor(() => expect(access(notify)).rejects.toMatchObject({ code: 'ENOENT' }))
    finishWrite()
    await expect(approval).rejects.toThrow('changed during approval')
    expect(revoke).toHaveBeenCalledWith(review.name, review.revision, review.digest)
    expect((await client.listTools()).tools).toEqual([])
  } finally {
    finishWrite()
    await client.close().catch(() => undefined)
    await manager.close()
  }
})
