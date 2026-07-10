import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LinearIssueDetail, LinearIssueSummary, LinearProjectIssuesResponse } from '../../../../core/shared/api'
import { getDb, schema } from '../../../../core/server/db'
import { linearFetch, type LinearNode } from '..'
import { linearProvider, linearRef } from '../provider'
import '../../../../app/server/providers'
import type { AppEnv } from '../../../../core/server/middleware/auth'
import { encryptSecret } from '../../../../core/server/session'
import { linear } from './linear'
import { makeTestDb, type TestDb } from '../../../../core/server/routes/testDb'

vi.mock('../../../../core/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../core/server/db')>()
  return { ...actual, getDb: vi.fn() }
})

vi.mock('..', async (importOriginal) => {
  const actual = await importOriginal<typeof import('..')>()
  return { ...actual, linearFetch: vi.fn() }
})

const ENC_KEY = 'b'.repeat(64)
const env = () => ({ SESSION_ENC_KEY: ENC_KEY }) as unknown as Env
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
      c.set('principal', { kind: 'user', user: { token: 'token', login: 'james', name: '', avatar: '', scopes: [] } })
      await next()
    })
    app.route('/api/linear', linear)
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
    expect((await response.json()) as { issues: LinearIssueSummary[] }).toMatchObject({ issues: [{ title: 'Workspace A' }] })
    expect(linearFetch).not.toHaveBeenCalled()
  })

  it('uses first-hit-wins for uncached bare identifiers', async () => {
    vi.mocked(linearFetch).mockImplementation(async (secret) => graphQl({ issues: { nodes: [node(secret === 'token-a' ? 'Workspace A' : 'Workspace B')] } }))

    const response = await app.fetch(new Request('http://acorn.test/api/linear/issues', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifiers: ['ENG-42'] }),
    }), env())

    expect(response.status).toBe(200)
    expect((await response.json()) as { issues: LinearIssueSummary[] }).toMatchObject({ issues: [{ title: 'Workspace A' }] })
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
