import { Hono } from 'hono'
import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb, schema } from '../../db'
import type { AppEnv } from '../../middleware/auth'
import { projects } from './projects'
import { makeTestDb, type TestDb } from '../../../testkit/db'
import type { Env } from '../../bindings'

vi.mock('../../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db')>()
  return { ...actual, getDb: vi.fn() }
})

// The MCP config files a project's agents load, read by project so Settings shows the same servers
// whether or not a task is open (docs/mcp.md § Configuration).

describe('a project’s MCP config files', () => {
  let t: TestDb
  let dir: string
  const app = new Hono<AppEnv>()
  app.use('/api/*', async (c, next) => {
    c.set('principal', { kind: 'device', userId: 'james' })
    await next()
  })
  app.route('/api/projects', projects)
  const call = (url: string, method = 'GET') => app.fetch(new Request(`http://acorn.test${url}`, { method }), {} as Env)

  beforeEach(async () => {
    t = makeTestDb()
    vi.mocked(getDb).mockReturnValue(t.db)
    dir = mkdtempSync(join(tmpdir(), 'acorn-project-mcp-'))
    const now = Date.now()
    await t.db.insert(schema.workspaces).values({ id: 'workspace-1', name: 'Default', isDefault: true, sort: 0, createdAt: now, updatedAt: now })
    await t.db.insert(schema.projects).values({
      id: 'project-widget', name: 'widget', path: dir, workspaceId: 'workspace-1', sort: 0, hidden: false,
      vcs: 'git', defaultBranch: 'main', remoteUrl: null, githubOwner: null, githubName: null, githubRepoId: null,
      createdAt: now, updatedAt: now,
    })
  })

  afterEach(() => {
    t.cleanup()
    rmSync(dir, { recursive: true, force: true })
  })

  it('reads only the known candidate files in the project folder, with secrets masked', async () => {
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { probe: { command: 'x', env: { TOKEN: 'super-secret' } } } }))
    writeFileSync(join(dir, 'other.json'), JSON.stringify({ mcpServers: { stray: { command: 'y' } } }))
    const found = (await (await call('/api/projects/project-widget/mcp')).json()) as { file: string; servers: unknown[] }[]
    const own = found.find((entry) => entry.file === join(dir, '.mcp.json'))
    expect(own?.servers).toHaveLength(1)
    expect(found.some((entry) => entry.file.endsWith('other.json'))).toBe(false)
    // Masked in core, so a raw value never reaches the renderer.
    expect(JSON.stringify(own)).not.toContain('super-secret')
    expect((await call('/api/projects/nope/mcp')).status).toBe(404)
  })

  it('seeds a starter .mcp.json once and refuses to overwrite it', async () => {
    expect(await (await call('/api/projects/project-widget/mcp/starter', 'POST')).json()).toEqual({ ok: true })
    expect(await (await call('/api/projects/project-widget/mcp/starter', 'POST')).json()).toMatchObject({ ok: false })
  })

  it('refuses a committed .mcp.json link that points nowhere, rather than writing where it points', async () => {
    const outside = join(dir, '..', `${dir.split('/').at(-1)}-outside.json`)
    symlinkSync(outside, join(dir, '.mcp.json'))
    expect(await (await call('/api/projects/project-widget/mcp/starter', 'POST')).json()).toEqual({ ok: false, reason: '.mcp.json already exists.' })
    expect(existsSync(outside)).toBe(false)
  })
})
