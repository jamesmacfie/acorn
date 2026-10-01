import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { probeMcpServer } from './mcpProbe'

// A real stdio server, spawned the way Settings' test button spawns one.
describe('testing an MCP server from Settings', () => {
  let dir: string
  let server: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'acorn-mcp-probe-'))
    server = join(dir, 'server.mjs')
    const resolve = (path: string) => pathToFileURL(createRequire(import.meta.url).resolve(path)).href
    await writeFile(server, [
      `import { McpServer } from '${resolve('@modelcontextprotocol/sdk/server/mcp.js')}'`,
      `import { StdioServerTransport } from '${resolve('@modelcontextprotocol/sdk/server/stdio.js')}'`,
      `const s = new McpServer({ name: 'probe', version: '1.0.0' })`,
      `s.registerTool('who_' + (process.env.PROBE_NAME ?? 'nobody'), { description: 'Says who.' }, async () => ({ content: [] }))`,
      `await s.connect(new StdioServerTransport())`,
    ].join('\n'))
  })
  afterAll(() => rm(dir, { recursive: true, force: true }))

  it('lists the tools of a server that starts, with its environment applied', async () => {
    const result = await probeMcpServer(
      { transport: 'stdio', name: 'probe', command: process.execPath, args: [server], env: { PROBE_NAME: 'acorn' } },
      [],
    )
    expect(result).toEqual({ ok: true, tools: [{ name: 'who_acorn', description: 'Says who.' }] })
  })

  it('says why a server did not start, with its secrets taken out', async () => {
    const result = await probeMcpServer(
      { transport: 'stdio', name: 'gone', command: '/nonexistent/mcp-sk_live_0123456789', args: [], env: {} },
      ['sk_live_0123456789'],
    )
    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.error).not.toContain('sk_live_0123456789')
  })
})
