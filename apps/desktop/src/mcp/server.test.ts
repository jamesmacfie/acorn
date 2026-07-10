import { spawn, type ChildProcess } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Integration test over REAL stdio JSON-RPC (docs/agent-tools.md): the MCP server is now a generic
// PROJECTION of the agent-tool registry — it fetches the manifest (GET /:id/tools) and proxies calls
// (POST /:id/tools/:name). This test stubs that loopback surface and asserts the projection: list
// mirrors the manifest, a call proxies the arguments (with the internal bearer + session header),
// and env-absent / acorn-down degrade to structured results, never protocol errors. The per-tool
// behaviour (git, notes provenance, memory PROPOSE-only) is covered at the registry/route layer.

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

// A tiny fixture manifest — two tools, one with args — projected as JSON schema by the registry.
const MANIFEST = {
  tools: [
    { name: 'task_current', description: 'the task', risk: 'read', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    {
      name: 'notes_append',
      description: 'append a note',
      risk: 'write',
      inputSchema: { type: 'object', properties: { slug: { type: 'string' }, text: { type: 'string' } }, required: ['slug', 'text'], additionalProperties: false },
    },
  ],
}

class McpClient {
  private child: ChildProcess
  private buffer = ''
  private pending = new Map<number, (msg: unknown) => void>()
  private nextId = 1

  constructor(env: Record<string, string | undefined>) {
    this.child = spawn(process.execPath, ['--import', 'tsx', 'src/mcp/main.ts'], { cwd: appRoot, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] })
    this.child.stdout!.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString()
      let i: number
      while ((i = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, i).trim()
        this.buffer = this.buffer.slice(i + 1)
        if (!line) continue
        try {
          const msg = JSON.parse(line) as { id?: number }
          if (msg.id != null) this.pending.get(msg.id)?.(msg)
        } catch {
          // non-JSON stdout noise — ignore
        }
      }
    })
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<{ result?: unknown; error?: unknown }> {
    const id = this.nextId++
    const p = new Promise<{ result?: unknown; error?: unknown }>((resolvePromise, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 15_000)
      this.pending.set(id, (msg) => {
        clearTimeout(timer)
        resolvePromise(msg as { result?: unknown; error?: unknown })
      })
    })
    this.child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    return p
  }

  notify(method: string): void {
    this.child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`)
  }

  async init(): Promise<void> {
    const res = await this.send('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'acorn-test', version: '0' } })
    expect(res.error).toBeUndefined()
    this.notify('notifications/initialized')
  }

  kill(): void {
    this.child.kill()
  }
}

const toolText = (res: { result?: unknown }): unknown => JSON.parse((res.result as { content: { text: string }[] }).content[0].text)

describe('acorn MCP server projects the agent-tool registry over stdio (docs/agent-tools.md)', () => {
  let stub: Server
  let port: number
  const posts: { url: string; body: unknown; internal: string; session: string; ceiling: string }[] = []

  beforeAll(async () => {
    stub = createServer((req, res) => {
      const json = (v: unknown) => {
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify(v))
      }
      const url = req.url ?? ''
      if (req.method === 'POST') {
        let raw = ''
        req.on('data', (c) => (raw += c))
        req.on('end', () => {
          posts.push({
            url,
            body: raw ? JSON.parse(raw) : null,
            internal: String(req.headers['x-acorn-internal'] ?? ''),
            session: String(req.headers['x-acorn-session-id'] ?? ''),
            ceiling: String(req.headers['x-acorn-tool-ceiling'] ?? ''),
          })
          if (url.endsWith('/tools/task_current')) return json({ repo: 'acme/api', branch: 'fix/null-token', pullNumber: 813, links: [{ provider: 'linear' }] })
          json({ ok: true })
        })
        return
      }
      if (url.startsWith('/api/tasks/t1/tools')) return json(MANIFEST)
      res.statusCode = 404
      res.end('{}')
    })
    await new Promise<void>((r) => stub.listen(0, '127.0.0.1', r))
    port = (stub.address() as { port: number }).port
  })

  afterAll(() => stub.close())

  it('tools/list mirrors the manifest; tools/call proxies args with bearer + session header', async () => {
    const client = new McpClient({
      ACORN_TASK_ID: 't1',
      ACORN_API_URL: `http://127.0.0.1:${port}`,
      ACORN_API_TOKEN: 'internal-token',
      ACORN_SESSION_ID: 'sess-42',
      ACORN_TOOL_CEILING: 'encoded-scope',
    })
    try {
      await client.init()

      const list = await client.send('tools/list')
      const tools = (list.result as { tools: { name: string; inputSchema: unknown }[] }).tools
      expect(tools.map((t) => t.name).sort()).toEqual(['notes_append', 'task_current'])
      // The registry's JSON schema rides through unchanged.
      expect(tools.find((t) => t.name === 'notes_append')?.inputSchema).toMatchObject({ properties: { slug: { type: 'string' } } })

      const current = toolText(await client.send('tools/call', { name: 'task_current', arguments: {} }))
      expect(current).toMatchObject({ repo: 'acme/api', pullNumber: 813 })

      await client.send('tools/call', { name: 'notes_append', arguments: { slug: 'plan', text: 'Done.' } })
      const post = posts.find((p) => p.url.endsWith('/tools/notes_append'))
      // Args ride the body verbatim; provenance rides HEADERS, not the body.
      expect(post?.body).toEqual({ slug: 'plan', text: 'Done.' })
      expect(post?.internal).toBe('internal-token')
      expect(post?.session).toBe('sess-42')
      expect(post?.ceiling).toBe('encoded-scope')
    } finally {
      client.kill()
    }
  }, 30_000)

  it('without ACORN_TASK_ID → empty list and a structured no-active-task, not an error', async () => {
    const client = new McpClient({ ACORN_TASK_ID: '', ACORN_API_URL: `http://127.0.0.1:${port}`, ACORN_API_TOKEN: 'x' })
    try {
      await client.init()
      expect((await client.send('tools/list')).result).toMatchObject({ tools: [] })
      const res = await client.send('tools/call', { name: 'task_current', arguments: {} })
      expect(res.error).toBeUndefined()
      expect(toolText(res)).toMatchObject({ status: 'no-active-task' })
    } finally {
      client.kill()
    }
  }, 30_000)

  it('with acorn not running → structured acorn-not-running', async () => {
    const client = new McpClient({ ACORN_TASK_ID: 't1', ACORN_API_URL: 'http://127.0.0.1:1', ACORN_API_TOKEN: 'x' })
    try {
      await client.init()
      expect(toolText(await client.send('tools/call', { name: 'task_current', arguments: {} }))).toMatchObject({ status: 'acorn-not-running' })
    } finally {
      client.kill()
    }
  }, 30_000)
})
