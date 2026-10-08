import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { McpReviewProxy } from './mcpReviewProxy'
import type { McpCatalogue } from './mcpCatalogue'

let dir: string
let entry: string
let changeFlag: string
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'acorn-mcp-review-'))
  entry = join(dir, 'server.mjs')
  changeFlag = join(dir, 'change')
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
    await proxy.announceApproval()
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['echo'])
    expect((await client.callTool({ name: 'echo', arguments: {} })).content).toEqual([{ type: 'text', text: 'after' }])
    await writeFile(changeFlag, 'changed')
    await vi.waitFor(async () => expect((await client.listTools()).tools).toEqual([]), { timeout: 5_000 })
    await expect(client.callTool({ name: 'echo', arguments: {} })).rejects.toThrow('needs device review')
    expect((seen as McpCatalogue | null)?.tools.map((tool) => tool.name)).toEqual(['echo', 'new'])
    approved = { revision: 'revision-1', ...seen! }
    await proxy.announceApproval()
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['echo', 'new'])
  } finally {
    await client.close().catch(() => undefined)
    await proxy.close()
  }
})
