import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
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

  const posts: { url: string; body: unknown }[] = []
  let worktree: string

  beforeAll(async () => {
    stub = createServer((req, res) => {
      seenHeaders.push(String(req.headers['x-acorn-internal'] ?? ''))
      const json = (v: unknown) => {
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify(v))
      }
      const url = req.url ?? ''
      if (req.method === 'POST' || req.method === 'PUT') {
        let raw = ''
        req.on('data', (c) => (raw += c))
        req.on('end', () => {
          posts.push({ url, body: raw ? JSON.parse(raw) : null })
          if (url.includes('/memory/propose'))
            json({ ok: true, proposal: { id: 'p1', status: 'pending', name: 'null-token-guard' } })
          else if (url.includes('/run/')) json({ ok: true })
          else json({ ok: true })
        })
        return
      }
      if (url.startsWith('/api/tasks/t1/repo-info')) return json({ owner: 'acme', name: 'api', defaultBranch: 'main', branch: 'fix/null-token', worktreePath: '/wt' })
      if (url.startsWith('/api/tasks/t1/context')) return json(CTX)
      if (url.startsWith('/api/tasks/t1/notes/plan')) return json({ slug: 'plan', title: 'plan', body: 'do the thing' })
      if (url.startsWith('/api/tasks/t1/notes')) return json([{ slug: 'plan', title: 'plan', kind: 'plan', author: 'user' }])
      if (url.startsWith('/api/tasks/t1/memory/auth-conventions')) return json({ name: 'auth-conventions', body: 'Tokens rotate.', path: '/x.md' })
      if (url.startsWith('/api/tasks/t1/memory')) return json([{ name: 'auth-conventions', description: 'how auth works' }])
      if (url.startsWith('/api/tasks/t1/run/dev/status')) return json({ running: true, url: 'http://localhost:5173' })
      if (url.startsWith('/api/tasks/t1/run')) return json({ targets: [{ id: 'dev', running: false }], errors: [], layouts: [] })
      if (url.startsWith('/api/tasks/t1/browser/snapshot'))
        return json({ url: 'http://localhost:5173/login', text: '- textbox "Email" [e2]\n- button "Sign in" [e5]', tree: [] })
      if (url.startsWith('/api/tasks/t1/browser/console')) return json({ lines: ['[error] Uncaught TypeError: token is null'] })
      res.statusCode = 404
      res.end('{}')
    })
    await new Promise<void>((r) => stub.listen(0, '127.0.0.1', r))
    port = (stub.address() as { port: number }).port

    // Fixture worktree for the local_* tools (never the acorn repo).
    worktree = mkdtempSync(join(tmpdir(), 'acorn-mcp-wt-'))
    const git = (...args: string[]) => execFileSync('git', ['-C', worktree, ...args], { stdio: 'pipe' })
    execFileSync('git', ['init', '-q', '-b', 'main', worktree])
    git('config', 'user.email', 't@t.test')
    git('config', 'user.name', 'T')
    writeFileSync(join(worktree, 'a.ts'), 'one\ntwo\n')
    git('add', '.')
    git('commit', '-q', '-m', 'feat: initial')
    writeFileSync(join(worktree, 'a.ts'), 'one\nCHANGED\n')
  })

  afterAll(() => {
    stub.close()
    rmSync(worktree, { recursive: true, force: true })
  })

  it('initialize → tools/list → tools/call with the task env set', async () => {
    const client = new McpClient({
      ACORN_TASK_ID: 't1',
      ACORN_API_URL: `http://127.0.0.1:${port}`,
      ACORN_API_TOKEN: 'internal-token',
      ACORN_WORKTREE_PATH: worktree,
      ACORN_SESSION_ID: 'sess-42',
    })
    try {
      await client.init()

      // tools/list reflects the 06 catalog through P3 (orchestration-inversion P4 stays unbuilt).
      const list = await client.send('tools/list')
      const names = ((list.result as { tools: { name: string }[] }).tools ?? []).map((t) => t.name).sort()
      expect(names).toEqual([
        'browser_click',
        'browser_console',
        'browser_fill',
        'browser_navigate',
        'browser_screenshot',
        'browser_snapshot',
        'git_log',
        'linked_issues',
        'local_changes',
        'local_diff',
        'memory_get',
        'memory_list',
        'memory_search',
        'memory_write',
        'notes_append',
        'notes_list',
        'notes_read',
        'notes_write',
        'pr_changed_files',
        'pr_current',
        'repo_info',
        'run_start',
        'run_status',
        'run_stop',
        'run_targets',
        'task_context',
        'task_current',
      ])

      const current = toolText(await client.send('tools/call', { name: 'task_current', arguments: {} }))
      expect(current).toMatchObject({ repo: 'acme/api', branch: 'fix/null-token', pullNumber: 813 })
      expect((current as { links: unknown[] }).links).toHaveLength(2)

      const files = toolText(await client.send('tools/call', { name: 'pr_changed_files', arguments: {} }))
      expect(files).toEqual(['src/a.ts', 'src/b.ts'])

      const linear = toolText(await client.send('tools/call', { name: 'linked_issues', arguments: { provider: 'linear' } }))
      expect(linear).toEqual([CTX.issues[0]])

      const info = toolText(await client.send('tools/call', { name: 'repo_info', arguments: {} }))
      expect(info).toMatchObject({ owner: 'acme', defaultBranch: 'main' })

      // local_* over the fixture worktree (real git, one shared implementation with the pane).
      const changes = toolText(await client.send('tools/call', { name: 'local_changes', arguments: {} })) as { path: string }[]
      expect(changes).toEqual([expect.objectContaining({ path: 'a.ts', status: 'modified', staged: false })])
      const diffRes = await client.send('tools/call', { name: 'local_diff', arguments: { path: 'a.ts' } })
      expect((diffRes.result as { content: { text: string }[] }).content[0].text).toContain('+CHANGED')
      const log = toolText(await client.send('tools/call', { name: 'git_log', arguments: { n: 5 } })) as { subject: string }[]
      expect(log[0].subject).toBe('feat: initial')

      // notes/memory/run ride the harness loopback; agent writes carry the session id.
      expect(toolText(await client.send('tools/call', { name: 'notes_read', arguments: { slug: 'plan' } }))).toMatchObject({ slug: 'plan' })
      await client.send('tools/call', { name: 'notes_append', arguments: { slug: 'plan', text: 'Done: guarded token.' } })
      const appendPost = posts.find((p) => p.url.includes('/notes/plan/append'))
      expect(appendPost?.body).toEqual({ text: 'Done: guarded token.', sessionId: 'sess-42' })

      expect(toolText(await client.send('tools/call', { name: 'memory_search', arguments: { query: 'auth' } }))).toEqual([
        { name: 'auth-conventions', description: 'how auth works' },
      ])
      expect(toolText(await client.send('tools/call', { name: 'memory_get', arguments: { name: 'auth-conventions' } }))).toMatchObject({ body: 'Tokens rotate.' })

      // memory_write PROPOSES — the response carries a pending proposal, no direct write path.
      const proposal = toolText(
        await client.send('tools/call', { name: 'memory_write', arguments: { name: 'null-token-guard', type: 'fix', description: 'd', body: 'Why: order.' } }),
      )
      expect(proposal).toMatchObject({ proposal: { status: 'pending' } })
      const proposePost = posts.find((p) => p.url.includes('/memory/propose'))
      expect(proposePost?.body).toMatchObject({ name: 'null-token-guard', type: 'fix', sessionId: 'sess-42' })

      // The 08 example loop shape over the (stubbed) driver: navigate → snapshot → fill/click → console.
      await client.send('tools/call', { name: 'browser_navigate', arguments: { url: 'http://localhost:5173/login' } })
      expect(posts.some((p) => p.url.includes('/browser/navigate'))).toBe(true)
      const snap = toolText(await client.send('tools/call', { name: 'browser_snapshot', arguments: {} })) as { text: string }
      expect(snap.text).toContain('[e5]')
      await client.send('tools/call', { name: 'browser_fill', arguments: { ref: 'e2', text: 'a@b.com' } })
      await client.send('tools/call', { name: 'browser_click', arguments: { ref: 'e5' } })
      expect(posts.find((p) => p.url.includes('/browser/fill'))?.body).toEqual({ ref: 'e2', text: 'a@b.com' })
      expect(posts.find((p) => p.url.includes('/browser/click'))?.body).toEqual({ ref: 'e5' })
      const consoleOut = toolText(await client.send('tools/call', { name: 'browser_console', arguments: {} })) as { lines: string[] }
      expect(consoleOut.lines[0]).toContain('token is null')

      expect(toolText(await client.send('tools/call', { name: 'run_targets', arguments: {} }))).toMatchObject({ targets: [{ id: 'dev' }] })
      await client.send('tools/call', { name: 'run_start', arguments: { id: 'dev' } })
      expect(posts.some((p) => p.url.includes('/run/dev/start'))).toBe(true)
      expect(toolText(await client.send('tools/call', { name: 'run_status', arguments: { id: 'dev' } }))).toEqual({ running: true, url: 'http://localhost:5173' })

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
