import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PluginRequestContext } from '@acorn/plugin-api/node'
import { readEnvironment, type SentryTarget } from './credentials'
import { createSentryFetch } from './routes'

const ENV_TOKEN = 'sntryu_env_secret'
const environment = readEnvironment({
  ACORN_SENTRY_TOKEN: ENV_TOKEN,
  ACORN_SENTRY_ORG: 'acme',
  ACORN_SENTRY_PROJECT: 'web',
}).target

type Row = { id: string; label: string; config: string; token: string }
const row = (id: string, project: string): Row => ({
  id,
  label: `Sentry · acme/${project}`,
  config: JSON.stringify({ organization: 'acme', project, host: 'sentry.io', projectId: `${id}-project` }),
  token: `${id}-secret`,
})

// The host's provider runtime, reduced to the two calls these routes make. A token is lent only
// inside `withConnections`, as the host lends it.
const contextWith = (rows: Row[]) =>
  ({
    userId: 'user-1',
    principal: { kind: 'device', userId: 'user-1', deviceId: 'device-1' },
    providers: {
      connections: async () => rows,
      withConnections: async (_provider: string, visit: (row: Row, token: string) => Promise<unknown>) => {
        const values = []
        for (const r of rows) {
          const value = await visit(r, r.token)
          if (value !== undefined) values.push(value)
        }
        return values
      },
    },
  }) as unknown as PluginRequestContext

// Every link is workspace-wide unless a test says otherwise.
const projects = (links: { connectionId: string; projectId?: string }[]) => ({
  byId: async (id: string) => (id.startsWith('project-') ? ({ id, workspaceId: 'workspace-1' } as never) : null),
  externalProjects: async () =>
    links.map((link) => ({ connectionId: link.connectionId, externalId: 'x', projectId: link.projectId ?? '' })),
})

const issue = (id: string, lastSeen: string) => ({
  id,
  shortId: `WEB-${id}`,
  title: `Issue ${id}`,
  level: 'error',
  status: 'unresolved',
  count: '3',
  userCount: 1,
  firstSeen: '2026-10-01T00:00:00Z',
  lastSeen,
})

// Sentry, answering by path, and a record of which token asked for what.
const calls: { url: string; token: string }[] = []
const stubSentry = (answer: (url: URL, token: string) => Response) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit) => {
      const token = String((init.headers as Record<string, string>).authorization).replace('Bearer ', '')
      calls.push({ url: input, token })
      return answer(new URL(input), token)
    }),
  )

const issuesByProject = (url: URL) =>
  Response.json([issue(url.searchParams.get('project') === 'api' ? '2' : '1', '2026-10-25T00:00:00Z')])

const rail = (
  rows: Row[],
  env: SentryTarget | null,
  links: { connectionId: string; projectId?: string }[],
  query = '?project=project-1',
) => createSentryFetch(env, projects(links))(new Request(`http://sentry.test/rail-items${query}`), contextWith(rows))

afterEach(() => {
  calls.length = 0
  vi.unstubAllGlobals()
})

describe('the rail', () => {
  it('reads the environment when no connection exists, in every project', async () => {
    stubSentry(issuesByProject)
    const response = await rail([], environment, [])
    expect(await response.json()).toMatchObject({ items: [{ id: 'env:1', title: 'Issue 1', fields: ['3'] }] })
    expect(calls).toEqual([
      {
        url: 'https://sentry.io/api/0/organizations/acme/issues/?project=web&query=is%3Aunresolved&sort=date&limit=100',
        token: ENV_TOKEN,
      },
    ])
  })

  it("shows a connection's project instead of the environment's", async () => {
    stubSentry(issuesByProject)
    const response = await rail([row('c1', 'api')], environment, [{ connectionId: 'c1' }])
    expect(await response.json()).toMatchObject({ items: [{ id: 'c1:2' }] })
    expect(calls.map((call) => call.token)).toEqual(['c1-secret'])
  })

  it('reads only the connections the routed project follows', async () => {
    stubSentry(issuesByProject)
    const rows = [row('c1', 'web'), row('c2', 'api'), row('c3', 'web')]
    const links = [{ connectionId: 'c2' }, { connectionId: 'c3', projectId: 'project-other' }]
    expect(await (await rail(rows, null, links)).json()).toMatchObject({ items: [{ id: 'c2:2' }] })
    expect(calls.map((call) => call.token)).toEqual(['c2-secret'])
  })

  it('fetches nothing with no connection and no environment', async () => {
    stubSentry(() => {
      throw new Error('the rail asked Sentry with no credential')
    })
    expect(await (await rail([], null, [])).json()).toEqual({ items: [] })
  })

  it('fetches nothing without a project scope', async () => {
    stubSentry(() => {
      throw new Error('the rail asked Sentry with no project scope')
    })
    expect(await (await rail([], environment, [], '')).json()).toEqual({ items: [] })
    expect(await (await rail([], environment, [], '?project=gone')).json()).toEqual({ items: [] })
  })

  it('keeps the rows one connection returned when another fails', async () => {
    stubSentry((url) =>
      url.searchParams.get('project') === 'api' ? new Response(null, { status: 500 }) : issuesByProject(url),
    )
    const rows = [row('c1', 'web'), row('c2', 'api')]
    const response = await rail(rows, null, [{ connectionId: 'c1' }, { connectionId: 'c2' }])
    expect(await response.json()).toMatchObject({ items: [{ id: 'c1:1' }] })
  })

  it('says in plain words that a token was turned down, and never shows it', async () => {
    stubSentry(() => new Response('{"detail":"Invalid token"}', { status: 401 }))
    const response = await rail([], environment, [])
    expect(response.status).toBe(401)
    const body = (await response.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('provider_needs_auth')
    expect(body.error.message).toBe(
      'Sentry turned down the token for Sentry · acme/web (from ACORN_SENTRY_TOKEN). It needs event:read.',
    )
    expect(JSON.stringify(body)).not.toContain(ENV_TOKEN)
  })
})

describe('making a task from an issue', () => {
  it("seeds a connection's row with a task linked to the issue", async () => {
    stubSentry(() =>
      Response.json([{ ...issue('7', '2026-10-25T00:00:00Z'), permalink: 'https://acme.sentry.io/issues/7/' }]),
    )
    const response = await rail([row('c1', 'web')], null, [{ connectionId: 'c1' }])
    const [item] = ((await response.json()) as { items: { task?: unknown }[] }).items
    expect(item!.task).toMatchObject({
      origin: 'sentry',
      title: 'Issue 7',
      link: { connectionId: 'c1', identifier: '7', ref: { displayId: '7', url: 'https://acme.sentry.io/issues/7/' } },
    })
  })

  it('offers no task for an issue read through the environment, which has no connection to link', async () => {
    stubSentry(issuesByProject)
    const [item] = ((await (await rail([], environment, [])).json()) as { items: { task?: unknown }[] }).items
    expect(item).not.toHaveProperty('task')
  })
})

describe('palette search', () => {
  const search = (rows: Row[], links: { connectionId: string }[], query: string) =>
    createSentryFetch(environment, projects(links))(
      new Request(`http://sentry.test/palette/issues${query}`),
      contextWith(rows),
    )

  it("finds an issue by title in the routed project's connections", async () => {
    stubSentry(() =>
      Response.json([
        { ...issue('1', '2026-10-25T00:00:00Z'), title: 'TypeError: boom' },
        { ...issue('2', '2026-10-24T00:00:00Z'), title: 'Timeout' },
      ]),
    )
    const response = await search([row('c1', 'web')], [{ connectionId: 'c1' }], '?projectId=project-1&q=boom')
    expect(await response.json()).toEqual({
      items: [expect.objectContaining({ id: 'c1:1', title: 'TypeError: boom', ref: 'WEB-1' })],
    })
  })

  it('answers nothing without a routed project', async () => {
    stubSentry(() => {
      throw new Error('the palette asked Sentry with no project scope')
    })
    expect(await (await search([], [], '?q=boom')).json()).toEqual({ items: [] })
  })
})

describe('an issue', () => {
  const read = (rows: Row[], connection: string) =>
    createSentryFetch(environment, projects([]))(
      new Request(`http://sentry.test/issues/1?connection=${connection}`),
      contextWith(rows),
    )

  it('answers with its latest event and stack', async () => {
    stubSentry((url) =>
      url.pathname.endsWith('/events/latest/')
        ? Response.json({
            eventID: 'e1',
            entries: [
              {
                type: 'exception',
                data: {
                  values: [
                    { type: 'TypeError', value: 'boom', stacktrace: { frames: [{ filename: 'a.ts', lineNo: 3 }] } },
                  ],
                },
              },
            ],
          })
        : Response.json(issue('1', '2026-10-25T00:00:00Z')),
    )
    const detail = await (await read([], 'env')).json()
    expect(detail).toMatchObject({
      id: '1',
      connectionId: 'env',
      latestEvent: { exceptionType: 'TypeError', message: 'boom', frames: [{ filename: 'a.ts', line: 3 }] },
    })
    expect(calls.map((call) => new URL(call.url).pathname).sort()).toEqual([
      '/api/0/organizations/acme/issues/1/',
      '/api/0/organizations/acme/issues/1/events/latest/',
    ])
  })

  it('still answers when the event is gone', async () => {
    stubSentry((url) =>
      url.pathname.endsWith('/events/latest/')
        ? new Response(null, { status: 404 })
        : Response.json(issue('1', '2026-10-25T00:00:00Z')),
    )
    expect(await (await read([], 'env')).json()).toMatchObject({ id: '1', latestEvent: null })
  })

  it("won't read through the environment while a connection overrides it", async () => {
    stubSentry(() => {
      throw new Error('the route read through an overridden credential')
    })
    expect((await read([row('c1', 'web')], 'env')).status).toBe(403)
  })
})
