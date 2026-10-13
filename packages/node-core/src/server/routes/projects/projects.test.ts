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

const app = new Hono<AppEnv>()
app.use('/api/*', async (c, next) => {
  c.set('principal', { kind: 'device', userId: 'james' })
  await next()
})
app.route('/api/projects', projects)
const call = (url: string, method = 'GET', body?: unknown) =>
  app.fetch(
    new Request(`http://acorn.test${url}`, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
    }),
    {} as Env,
  )

async function seedProject(t: TestDb, path: string) {
  const now = Date.now()
  await t.db
    .insert(schema.workspaces)
    .values({ id: 'workspace-1', name: 'Default', isDefault: true, sort: 0, createdAt: now, updatedAt: now })
  await t.db.insert(schema.projects).values({
    id: 'project-widget',
    name: 'widget',
    path,
    workspaceId: 'workspace-1',
    sort: 0,
    hidden: false,
    vcs: 'git',
    defaultBranch: 'main',
    remoteUrl: null,
    githubOwner: null,
    githubName: null,
    githubRepoId: null,
    createdAt: now,
    updatedAt: now,
  })
}

// The MCP config files a project's agents load, read by project so Settings shows the same servers
// whether or not a task is open (docs/mcp.md § Configuration).

describe('a project’s MCP config files', () => {
  let t: TestDb
  let dir: string

  beforeEach(async () => {
    t = makeTestDb()
    vi.mocked(getDb).mockReturnValue(t.db)
    dir = mkdtempSync(join(tmpdir(), 'acorn-project-mcp-'))
    await seedProject(t, dir)
  })

  afterEach(() => {
    t.cleanup()
    rmSync(dir, { recursive: true, force: true })
  })

  it('reads only the known candidate files in the project folder, with secrets masked', async () => {
    writeFileSync(
      join(dir, '.mcp.json'),
      JSON.stringify({ mcpServers: { probe: { command: 'x', env: { TOKEN: 'super-secret' } } } }),
    )
    writeFileSync(join(dir, 'other.json'), JSON.stringify({ mcpServers: { stray: { command: 'y' } } }))
    const found = (await (await call('/api/projects/project-widget/mcp')).json()) as {
      file: string
      servers: unknown[]
    }[]
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
    expect(await (await call('/api/projects/project-widget/mcp/starter', 'POST')).json()).toEqual({
      ok: false,
      reason: '.mcp.json already exists.',
    })
    expect(existsSync(outside)).toBe(false)
  })
})

// Site associations are machine-local project settings (docs/browser-extension/project-sites.md).
describe('a project’s site associations', () => {
  let t: TestDb
  let dir: string
  const config = async () =>
    ((await (await call('/api/projects/project-widget/config')).json()) as { config: Record<string, unknown> }).config
  const save = (patch: Record<string, unknown>) => call('/api/projects/project-widget/config', 'PUT', { patch })

  beforeEach(async () => {
    t = makeTestDb()
    vi.mocked(getDb).mockReturnValue(t.db)
    dir = mkdtempSync(join(tmpdir(), 'acorn-project-sites-'))
    await seedProject(t, dir)
  })

  afterEach(() => {
    t.cleanup()
    rmSync(dir, { recursive: true, force: true })
  })

  it('reads as an empty list when none are set', async () => {
    expect((await config()).siteAssociations).toEqual([])
  })

  it('round-trips, drops duplicates, and leaves other fields alone', async () => {
    expect((await save({ devScript: 'pnpm dev', branchPrefix: 'jm/' })).status).toBe(200)
    const sites = [
      { origin: 'https://example.com', pathPrefix: '/app' },
      { origin: 'http://localhost:5173', pathPrefix: '/' },
      { origin: 'https://example.com', pathPrefix: '/app' },
    ]
    const saved = (await (await save({ siteAssociations: sites })).json()) as { config: Record<string, unknown> }
    expect(saved.config.siteAssociations).toEqual(sites.slice(0, 2))
    expect(await config()).toMatchObject({
      devScript: 'pnpm dev',
      branchPrefix: 'jm/',
      siteAssociations: sites.slice(0, 2),
    })

    // A patch that doesn't name the list keeps it.
    await save({ devScript: 'pnpm start' })
    expect((await config()).siteAssociations).toEqual(sites.slice(0, 2))

    await save({ siteAssociations: [] })
    expect((await config()).siteAssociations).toEqual([])
    const [row] = await t.db.select().from(schema.projects)
    expect(row?.siteAssociations).toBeNull()
    expect(row?.devScript).toBe('pnpm start')
  })

  it('refuses credentials, other schemes, and non-canonical addresses', async () => {
    for (const site of [
      { origin: 'https://user:pw@example.com', pathPrefix: '/' },
      { origin: 'ftp://example.com', pathPrefix: '/' },
      { origin: 'https://example.com/path', pathPrefix: '/' },
      { origin: 'https://example.com', pathPrefix: '/a?b=1' },
      { origin: 'not an origin', pathPrefix: '/' },
    ]) {
      const response = await save({ siteAssociations: [site] })
      expect(response.status, JSON.stringify(site)).toBe(400)
    }
    expect((await config()).siteAssociations).toEqual([])
  })

  it('reads a damaged stored value as no associations', async () => {
    await t.db.update(schema.projects).set({ siteAssociations: '{not json' })
    expect((await config()).siteAssociations).toEqual([])
  })
})
