import { spawn, type ChildProcess } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Integration test over REAL stdio JSON-RPC (plan §validation): spawn the server entry with
// ACORN_TASK_ID set against a stubbed loopback HTTP "acorn API", drive
// initialize → tools/list → tools/call, and assert graceful no-active-task with the env absent.
// No real agent CLIs, no live APIs.

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

const CTX = {
  task: { id: 't1', title: 'fix: guard null token', repo: 'acme/api', branch: 'fix/null-token', worktreePath: '/wt', pullNumber: 813 },
  pr: { number: 813, title: 'fix: guard null token', body: 'Guards it.', changedFiles: ['src/a.ts', 'src/b.ts'] },
  issues: [
    { provider: 'linear', identifier: 'ENG-42', title: 'Login crashes', detail: 'In Progress' },
    { provider: 'rollbar', identifier: '142', title: 'TypeError', detail: 'prod' },
  ],
  notes: [],
  memory: [],
}

class McpClient {
  private child: ChildProcess
  private buffer = ''
  private pending = new Map<number, (msg: unknown) => void>()
  private nextId = 1

  constructor(env: Record<string, string | undefined>) {
    this.child = spawn(process.execPath, ['--import', 'tsx', 'src/mcp/server.ts'], {
      cwd: appRoot,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
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
    const res = await this.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'acorn-test', version: '0' },
    })
    expect(res.error).toBeUndefined()
    this.notify('notifications/initialized')
  }

  kill(): void {
    this.child.kill()
  }
}

const toolText = (res: { result?: unknown }): unknown => {
  const content = (res.result as { content: { type: string; text: string }[] }).content
  return JSON.parse(content[0].text)
}

describe('acorn MCP server over stdio JSON-RPC (docs/next 06 B)', () => {
  let stub: Server
  let port: number
  const seenHeaders: string[] = []

  beforeAll(async () => {
    stub = createServer((req, res) => {
      seenHeaders.push(String(req.headers['x-acorn-internal'] ?? ''))
      if (req.url?.startsWith('/api/tasks/t1/repo-info')) {
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ owner: 'acme', name: 'api', defaultBranch: 'main', branch: 'fix/null-token', worktreePath: '/wt' }))
        return
      }
      if (req.url?.startsWith('/api/tasks/t1/context')) {
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify(CTX))
        return
      }
      res.statusCode = 404
      res.end('{}')
    })
    await new Promise<void>((r) => stub.listen(0, '127.0.0.1', r))
    port = (stub.address() as { port: number }).port
  })

  afterAll(() => stub.close())

  it('initialize → tools/list → tools/call with the task env set', async () => {
    const client = new McpClient({
      ACORN_TASK_ID: 't1',
      ACORN_API_URL: `http://127.0.0.1:${port}`,
      ACORN_API_TOKEN: 'internal-token',
    })
    try {
      await client.init()

      const list = await client.send('tools/list')
      const names = ((list.result as { tools: { name: string }[] }).tools ?? []).map((t) => t.name).sort()
      expect(names).toEqual(['linked_issues', 'pr_changed_files', 'pr_current', 'repo_info', 'task_context', 'task_current'])

      const current = toolText(await client.send('tools/call', { name: 'task_current', arguments: {} }))
      expect(current).toMatchObject({ repo: 'acme/api', branch: 'fix/null-token', pullNumber: 813 })
      expect((current as { links: unknown[] }).links).toHaveLength(2)

      const files = toolText(await client.send('tools/call', { name: 'pr_changed_files', arguments: {} }))
      expect(files).toEqual(['src/a.ts', 'src/b.ts'])

      const linear = toolText(await client.send('tools/call', { name: 'linked_issues', arguments: { provider: 'linear' } }))
      expect(linear).toEqual([CTX.issues[0]])

      const info = toolText(await client.send('tools/call', { name: 'repo_info', arguments: {} }))
      expect(info).toMatchObject({ owner: 'acme', defaultBranch: 'main' })

      // Loopback calls carried the internal bearer (never a cookie).
      expect(seenHeaders.every((h) => h === 'internal-token')).toBe(true)
    } finally {
      client.kill()
    }
  }, 30_000)

  it('without ACORN_TASK_ID → structured no-active-task, not an error', async () => {
    const client = new McpClient({ ACORN_TASK_ID: '', ACORN_API_URL: `http://127.0.0.1:${port}`, ACORN_API_TOKEN: 'x' })
    try {
      await client.init()
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
      expect(toolText(await client.send('tools/call', { name: 'pr_current', arguments: {} }))).toMatchObject({ status: 'acorn-not-running' })
    } finally {
      client.kill()
    }
  }, 30_000)
})
