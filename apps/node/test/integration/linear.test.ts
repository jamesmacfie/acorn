import { testSecretEnv } from '@acorn/node-core/testkit/db.ts'
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LinearIssueDetail, LinearIssueSummary, LinearProjectIssuesResponse } from '@acorn/plugin-linear/shared/api.ts'
import { getDb, schema } from '@acorn/node-core/server/db/index.ts'
import { linearFetch, type LinearNode } from '@acorn/plugin-linear/server/index.ts'
import { linearProvider, linearRef } from '@acorn/plugin-linear/server/provider.ts'
import '../registerProviders'
import type { PluginRefResolutionBody } from '@acorn/protocol/refResolvers.ts'
import type { AppEnv } from '@acorn/node-core/server/middleware/auth.ts'
import { encryptSecret } from '@acorn/node-core/server/secretBox.ts'
import { createLinearFetch } from '@acorn/plugin-linear/server/routes/linear.ts'
import { servePluginFetch } from '@acorn/node-core/server/plugin/fetchRoute.ts'
import { makeTestDb, type TestDb } from '@acorn/node-core/testkit/db.ts'
import type { Env } from '@acorn/node-core/main/bindings.ts'

vi.mock('@acorn/node-core/server/db/index.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@acorn/node-core/server/db/index.ts')>()
  return { ...actual, getDb: vi.fn() }
})

vi.mock('@acorn/plugin-linear/server/index.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@acorn/plugin-linear/server/index.ts')>()
  return { ...actual, linearFetch: vi.fn() }
})

const ENC_KEY = 'b'.repeat(64)
const env = () => ({ ...testSecretEnv(ENC_KEY) }) as unknown as Env
const graphQl = (data: unknown) => new Response(JSON.stringify({ data }), { headers: { 'content-type': 'application/json' } })

const node = (title: string, overrides: Partial<LinearNode> = {}): LinearNode => ({
  id: `issue-${title}`,
  identifier: 'ENG-42',
  title,
  url: `https://linear.app/acme/issue/ENG-42`,
  state: { name: 'In Progress', type: 'started', color: '#55f' },
  assignee: null,
  description: `${title} description`,
  comments: { nodes: [] },
  history: { nodes: [] },
  labels: { nodes: [] },
  ...overrides,
})

describe('Linear provider parity', () => {
  let t: TestDb
  let app: Hono<AppEnv>

  beforeEach(async () => {
    vi.clearAllMocks()
    t = makeTestDb()
    vi.mocked(getDb).mockReturnValue(t.db)
    app = new Hono<AppEnv>()
    app.use('/api/*', async (c, next) => {
      c.set('principal', { kind: 'device', userId: 'james' })
      await next()
    })
    // Through the portable carrier, exactly as production mounts it: linear has no compiled router
    // to hand `app.route` any more. `servePluginFetch` builds the identity-bound request context the
    // routes' helpers require.
    const fetch = createLinearFetch()
    app.all('/api/linear/*', (c) => servePluginFetch(c, { pluginId: 'linear', mount: '/api/linear', fetch }))
    await t.db.insert(schema.integrations).values([
      {
        id: 'linear-a', userId: 'james', provider: 'linear', label: 'Linear A',
        authRef: await encryptSecret('token-a', ENC_KEY), createdAt: 1, updatedAt: 1,
      },
      {
        id: 'linear-b', userId: 'james', provider: 'linear', label: 'Linear B',
        authRef: await encryptSecret('token-b', ENC_KEY), createdAt: 2, updatedAt: 2,
      },
    ])
  })

  afterEach(() => t.cleanup())

  const cacheDetail = async (connectionId: string, title: string, fetchedAt = Date.now()) => {
    const detail: LinearIssueDetail = {
      id: `issue-${title}`,
      identifier: 'ENG-42',
      title,
      url: 'https://linear.app/acme/issue/ENG-42',
      state: { name: 'In Progress', type: 'started', color: '#55f' },
      assignee: null,
      description: `${title} description`,
      comments: [],
      activity: [],
    }
    const summary: LinearIssueSummary = detail
    const cached = linearProvider.codec!.withDetail(linearRef(connectionId, 'ENG-42', detail.url), summary, detail, fetchedAt)
    await t.db.insert(schema.issues).values({
      userId: 'james', integrationId: connectionId, provider: 'linear', identifier: 'ENG-42',
      data: JSON.stringify(cached), fetchedAt,
    })
  }

  it('uses connectionId for task-scoped detail reads', async () => {
    vi.mocked(linearFetch).mockImplementation(async (secret) => graphQl({ issues: { nodes: [node(secret === 'token-b' ? 'Workspace B' : 'Workspace A')] } }))

    const response = await app.fetch(
      new Request('http://acorn.test/api/linear/issues/ENG-42?refresh=1&integration=linear-b'),
      env(),
    )

    expect(response.status).toBe(200)
    expect(((await response.json()) as LinearIssueDetail).title).toBe('Workspace B')
    expect(vi.mocked(linearFetch).mock.calls.map(([secret]) => secret)).toEqual(['token-b'])
  })

  // The reference-panel path, and the one with no connection to name: github scans `ENG-42` out of a
  // PR body and cannot know which connected Linear owns it. Asking each workspace in turn is the
  // resolution. It replaced a hand-rolled cache read plus a second fan-out, so this is the case that
  // has to keep working, and the one nothing covered before.
  it('resolves a bare identifier by asking each connection until one answers', async () => {
    vi.mocked(linearFetch).mockImplementation(async (secret) =>
      graphQl({ issues: { nodes: secret === 'token-b' ? [node('Workspace B')] : [] } }))

    const response = await app.fetch(new Request('http://acorn.test/api/linear/issues/ENG-42?refresh=1'), env())

    expect(response.status).toBe(200)
    expect(((await response.json()) as LinearIssueDetail).title).toBe('Workspace B')
    expect(vi.mocked(linearFetch).mock.calls.map(([secret]) => secret)).toEqual(['token-a', 'token-b'])
  })

  it('reports "not found" rather than the first workspace’s miss when no connection has it', async () => {
    vi.mocked(linearFetch).mockImplementation(async () => graphQl({ issues: { nodes: [] } }))

    const response = await app.fetch(new Request('http://acorn.test/api/linear/issues/ENG-42?refresh=1'), env())

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ error: { code: 'provider_resource_not_found' } })
  })

  // The declarative rail source. This router carries no `projects` scope, the loaded package's does,
  // so nothing is mapped for any connection here.
  it('contributes no rows when a connection has no linked projects, rather than the viewer’s own issues', async () => {
    // The fallback this replaces showed whatever was assigned to you, which answered a question nobody
    // asked and whose rows belonged to no project in the workspace. The rail says so instead, through the
    // source's authored `emptyState` (docs/integrations.md § Linear).
    vi.mocked(linearFetch).mockImplementation(async () => graphQl({ issues: { nodes: [node('Urgent')] } }))

    const response = await app.fetch(new Request('http://acorn.test/api/linear/rail-items'), env())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ items: [] })
    // And it costs no provider call at all, which the fallback did once per connection on every visit.
    expect(linearFetch).not.toHaveBeenCalled()
  })

  it('answers the rail with an empty list, never an error, when nothing is connected', async () => {
    await t.db.delete(schema.integrations)

    const response = await app.fetch(new Request('http://acorn.test/api/linear/rail-items'), env())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ items: [] })
    expect(linearFetch).not.toHaveBeenCalled()
  })

  it('routes threaded comments to the linked connection', async () => {
    vi.mocked(linearFetch).mockImplementation(async (secret, query) => {
      if (query.includes('commentCreate')) return graphQl({ commentCreate: { success: true } })
      return graphQl({ issues: { nodes: [{ id: secret === 'token-b' ? 'issue-b' : 'issue-a' }] } })
    })

    const response = await app.fetch(
      new Request('http://acorn.test/api/linear/issues/ENG-42/comments?integration=linear-b', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: 'Reply', parentId: 'comment-parent' }),
      }),
      env(),
    )

    expect(response.status).toBe(200)
    expect(vi.mocked(linearFetch).mock.calls.map(([secret]) => secret)).toEqual(['token-b', 'token-b'])
    expect(vi.mocked(linearFetch).mock.calls[1][2]).toEqual({
      input: { issueId: 'issue-b', body: 'Reply', parentId: 'comment-parent' },
    })
  })

  it('keeps cached bare-id resolution in stable connection order', async () => {
    await cacheDetail('linear-b', 'Workspace B')
    await cacheDetail('linear-a', 'Workspace A')

    const response = await app.fetch(new Request('http://acorn.test/api/linear/issues', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifiers: ['ENG-42'] }),
    }), env())

    expect(response.status).toBe(200)
    // The host's ref-resolver shape, not a Linear-flavoured one: a bare array, `label` rather than
    // `title`, and no `providerId`. The device stamps that from the plugin whose route answered.
    expect((await response.json()) as PluginRefResolutionBody[]).toMatchObject([{ label: 'Workspace A' }])
    expect(linearFetch).not.toHaveBeenCalled()
  })

  it('uses first-hit-wins for uncached bare identifiers', async () => {
    vi.mocked(linearFetch).mockImplementation(async (secret) => graphQl({ issues: { nodes: [node(secret === 'token-a' ? 'Workspace A' : 'Workspace B')] } }))

    const response = await app.fetch(new Request('http://acorn.test/api/linear/issues', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifiers: ['ENG-42'] }),
    }), env())

    expect(response.status).toBe(200)
    expect((await response.json()) as PluginRefResolutionBody[]).toMatchObject([{ label: 'Workspace A' }])
    expect(vi.mocked(linearFetch).mock.calls.map(([secret]) => secret)).toEqual(['token-a'])
  })

  it('serves connection-scoped cache while reauthentication is required', async () => {
    await cacheDetail('linear-b', 'Cached Workspace B', 1)
    await t.db.update(schema.integrations).set({ status: 'needs-auth' }).where(eq(schema.integrations.id, 'linear-b'))

    const response = await app.fetch(
      new Request('http://acorn.test/api/linear/issues/ENG-42?refresh=1&integration=linear-b'),
      env(),
    )

    expect(response.status).toBe(200)
    expect(((await response.json()) as LinearIssueDetail).title).toBe('Cached Workspace B')
    expect(linearFetch).not.toHaveBeenCalled()
  })

  it('keeps project browse explicit, active-only, and preserves suggested branches', async () => {
    vi.mocked(linearFetch).mockResolvedValueOnce(graphQl({ issues: { nodes: [node('Project issue', { branchName: 'eng-42-project' })] } }))

    const response = await app.fetch(
      new Request('http://acorn.test/api/linear/project-issues?integration=linear-b&ids=project-1'),
      env(),
    )
    const body = (await response.json()) as LinearProjectIssuesResponse

    expect(response.status).toBe(200)
    expect(vi.mocked(linearFetch).mock.calls[0][0]).toBe('token-b')
    expect(vi.mocked(linearFetch).mock.calls[0][2]).toMatchObject({
      filter: { project: { id: { in: ['project-1'] } }, state: { type: { nin: ['completed', 'canceled'] } } },
    })
    expect(body.issues[0]).toMatchObject({ integrationId: 'linear-b', branchName: 'eng-42-project' })
  })
})
