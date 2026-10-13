import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTestRequestContext } from '@acorn/plugin-api/testkit'
import { createRollbarFetch } from './rollbar'

const item = (integrationId: string, over: Record<string, unknown> = {}) => ({
  integrationId,
  integrationLabel: integrationId,
  identifier: integrationId === 'rollbar-a' ? '1' : '2',
  itemId: '',
  url: null,
  title: integrationId,
  level: 'error',
  environment: 'production',
  status: 'active',
  totalOccurrences: 1,
  firstOccurrenceAt: 1,
  lastOccurrenceAt: 2,
  ...over,
})

describe('Rollbar loaded routes', () => {
  it('intersects the active workspace mapping with provider-owned connections', async () => {
    const fetch = createRollbarFetch({
      byId: async (id) => (id === 'project-1' ? ({ id, workspaceId: 'workspace-1' } as never) : null),
      checkouts: async () => [],
      externalProjects: async () => [{ connectionId: 'rollbar-b', externalId: 'project-b', projectId: '' }],
    })
    // The host's request context, with canned answers only for the two provider calls that would
    // otherwise reach Rollbar's API. `withConnections` and `items` are not stubbed: they stay the
    // real runtime, so if this route starts reading the item store directly, the host's own
    // ownership check fails the test.
    const context = await makeTestRequestContext({
      plugin: 'rollbar',
      principal: { kind: 'device', userId: 'user-1', deviceId: 'device-1' },
      providers: {
        connections: async () => [{ id: 'rollbar-a' } as never, { id: 'rollbar-b' } as never],
        resource: async (request) =>
          ({
            ok: true,
            value: { items: [item(request.connectionId)], capped: false },
          }) as never,
      },
    })

    const response = await fetch(new Request('http://rollbar.test/rail-items?project=project-1'), context)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      items: [{ title: 'rollbar-b', task: { origin: 'rollbar', link: { connectionId: 'rollbar-b' } } }],
    })
  })

  // A link may name a single project rather than the whole workspace, and then the routed project has
  // to match it. Without this, two repositories in one workspace show each other's errors.
  it('keeps only the links the routed project is in scope for', async () => {
    const fetch = createRollbarFetch({
      byId: async (id) => ({ id, workspaceId: 'workspace-1' }) as never,
      checkouts: async () => [],
      externalProjects: async () => [
        { connectionId: 'rollbar-a', externalId: 'project-a', projectId: 'project-1' },
        { connectionId: 'rollbar-b', externalId: 'project-b', projectId: '' },
      ],
    })
    const context = await makeTestRequestContext({
      plugin: 'rollbar',
      principal: { kind: 'device', userId: 'user-1', deviceId: 'device-1' },
      providers: {
        connections: async () => [{ id: 'rollbar-a' } as never, { id: 'rollbar-b' } as never],
        resource: async (request) =>
          ({
            ok: true,
            value: { items: [item(request.connectionId)], capped: false },
          }) as never,
      },
    })

    const forProject = (projectId: string) =>
      fetch(new Request(`http://rollbar.test/rail-items?project=${projectId}`), context)

    // project-1 gets both: its own narrow link and the workspace-wide one.
    expect(await (await forProject('project-1')).json()).toMatchObject({
      items: [{ title: 'rollbar-a' }, { title: 'rollbar-b' }],
    })
    // Its sibling gets the workspace-wide link alone.
    expect(await (await forProject('project-2')).json()).toMatchObject({ items: [{ title: 'rollbar-b' }] })
  })

  // The counterpart to the intersection above: no `?project=` means no scope to intersect with, and a
  // rail that fell back to every connection would put one workspace's errors in front of every other
  // workspace.
  it('returns no rail rows without a project scope', async () => {
    const fetch = createRollbarFetch({
      byId: async () => null,
      checkouts: async () => [],
      externalProjects: async () => [],
    })
    const context = await makeTestRequestContext({
      plugin: 'rollbar',
      principal: { kind: 'device', userId: 'user-1', deviceId: 'device-1' },
      providers: {
        connections: async () => [{ id: 'rollbar-a' } as never],
        resource: async () => {
          throw new Error('the route asked Rollbar for items it has no scope for')
        },
      },
    })

    const response = await fetch(new Request('http://rollbar.test/rail-items'), context)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ items: [] })
  })
})

// The palette's search is the same three facts as the rail beside it — the routed project decides the
// connections, the cached listing decides the items, one connection failing does not erase another's
// — with the reader's word filtering what comes back
// (docs/integrations/rollbar.md § Palette search).
describe('Rollbar palette search', () => {
  const mappingFor = (rows: { connectionId: string; externalId: string; projectId: string }[]) => ({
    byId: async (id: string) => ({ id, workspaceId: 'workspace-1' }) as never,
    checkouts: async () => [],
    externalProjects: async () => rows,
  })

  const contextWith = (resource: (request: { connectionId: string }) => unknown) =>
    makeTestRequestContext({
      plugin: 'rollbar',
      principal: { kind: 'device', userId: 'user-1', deviceId: 'device-1' },
      providers: {
        connections: async () => [{ id: 'rollbar-a' } as never, { id: 'rollbar-b' } as never],
        resource: resource as never,
      },
    })

  it('reads only the connections the routed project maps, and never falls back to the rest', async () => {
    const fetch = createRollbarFetch(
      mappingFor([
        { connectionId: 'rollbar-a', externalId: 'project-a', projectId: 'project-1' },
        { connectionId: 'rollbar-b', externalId: 'project-b', projectId: 'project-2' },
      ]),
    )
    const asked: string[] = []
    const context = await contextWith((request) => {
      asked.push(request.connectionId)
      return { ok: true, value: { items: [item(request.connectionId)], capped: false } }
    })

    const response = await fetch(
      new Request('http://rollbar.test/palette/issues?projectId=project-1&q=rollbar'),
      context,
    )
    expect(response.status).toBe(200)
    // The unmapped connection is never asked, so there is no row of its to filter out on the client.
    expect(asked).toEqual(['rollbar-a'])
    expect(await response.json()).toEqual({
      items: [
        {
          id: 'rollbar-a:1',
          title: 'rollbar-a',
          subtitle: '#1 · error · production · rollbar-a',
          badge: '1 occurrence',
          ref: '1',
        },
      ],
    })
  })

  // The counterpart the rail already keeps: without a scope there is nothing to intersect with, and a
  // route that answered every connection would be reading another project's rows before any client
  // filter ran.
  it('answers nothing without a project scope, and asks Rollbar nothing', async () => {
    const fetch = createRollbarFetch({
      byId: async () => null,
      checkouts: async () => [],
      externalProjects: async () => [],
    })
    const context = await contextWith(() => {
      throw new Error('the route asked for items it has no scope for')
    })

    const response = await fetch(new Request('http://rollbar.test/palette/issues?q=boom'), context)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ items: [] })
  })

  it('merges two mapped connections and ranks the counter above the title', async () => {
    const fetch = createRollbarFetch(
      mappingFor([
        { connectionId: 'rollbar-a', externalId: 'project-a', projectId: '' },
        { connectionId: 'rollbar-b', externalId: 'project-b', projectId: '' },
      ]),
    )
    const context = await contextWith((request) => ({
      ok: true,
      value: {
        items: [
          request.connectionId === 'rollbar-a'
            ? item('rollbar-a', { identifier: '7', title: 'mentions 7 in the title' })
            : item('rollbar-b', { identifier: '7', title: 'unrelated' }),
        ],
        capped: false,
      },
    }))

    const response = await fetch(new Request('http://rollbar.test/palette/issues?projectId=project-1&q=7'), context)
    const body = (await response.json()) as { items: { id: string }[] }
    // Both connections' rows are here, and the two ids differ by connection even though the counter is
    // the same in each — which is the collision the rail id exists to stop.
    expect(body.items.map((row) => row.id).sort()).toEqual(['rollbar-a:7', 'rollbar-b:7'])
  })

  it('keeps the rows it did get when one connection fails', async () => {
    const fetch = createRollbarFetch(
      mappingFor([
        { connectionId: 'rollbar-a', externalId: 'project-a', projectId: '' },
        { connectionId: 'rollbar-b', externalId: 'project-b', projectId: '' },
      ]),
    )
    const context = await contextWith((request) =>
      request.connectionId === 'rollbar-a'
        ? { ok: false, failure: { status: 502, error: 'provider_unavailable' } }
        : { ok: true, value: { items: [item('rollbar-b')], capped: false } },
    )

    const response = await fetch(
      new Request('http://rollbar.test/palette/issues?projectId=project-1&q=rollbar'),
      context,
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ items: [{ id: 'rollbar-b:2' }] })
  })

  it('reports a total wash through the ordinary error envelope', async () => {
    const fetch = createRollbarFetch(
      mappingFor([{ connectionId: 'rollbar-a', externalId: 'project-a', projectId: '' }]),
    )
    const context = await contextWith(() => ({ ok: false, failure: { status: 401, error: 'provider_needs_auth' } }))

    const response = await fetch(new Request('http://rollbar.test/palette/issues?projectId=project-1&q=boom'), context)
    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ error: { code: 'provider_needs_auth' } })
  })

  it('caps at the fifty rows the host will draw', async () => {
    const fetch = createRollbarFetch(
      mappingFor([{ connectionId: 'rollbar-a', externalId: 'project-a', projectId: '' }]),
    )
    const context = await contextWith(() => ({
      ok: true,
      value: {
        items: Array.from({ length: 80 }, (_, at) =>
          item('rollbar-a', { identifier: String(at), title: `boom ${at}` }),
        ),
        capped: false,
      },
    }))

    const response = await fetch(new Request('http://rollbar.test/palette/issues?projectId=project-1&q=boom'), context)
    expect(((await response.json()) as { items: unknown[] }).items).toHaveLength(50)
  })
})

// The rail's Search field (docs/integrations/rollbar.md § Rail search). Rollbar's own items search,
// asked of the mapped connections only, past the three mirrored pages, and never written to the mirror.
describe('Rollbar rail search', () => {
  const apiItem = (counter: number, over: Record<string, unknown> = {}) => ({
    id: 1000 + counter,
    counter,
    title: `Error ${counter}`,
    level: 'error',
    environment: 'production',
    status: 'active',
    total_occurrences: 3,
    first_occurrence_timestamp: 1,
    last_occurrence_timestamp: counter,
    ...over,
  })

  const setup = async (answer: (token: string) => { status?: number; items?: unknown[] }) => {
    const asked: { token: string; url: string }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
        const token = init.headers['X-Rollbar-Access-Token']
        asked.push({ token, url })
        const reply = answer(token)
        if (reply.status) return new Response('{}', { status: reply.status })
        return new Response(JSON.stringify({ err: 0, result: { items: reply.items ?? [] } }))
      }),
    )
    const connections = [{ id: 'rollbar-a', label: 'A' } as never, { id: 'rollbar-b', label: 'B' } as never]
    const fetchRoutes = createRollbarFetch({
      byId: async (id) => ({ id, workspaceId: 'workspace-1' }) as never,
      checkouts: async () => [],
      externalProjects: async () => [
        { connectionId: 'rollbar-a', externalId: 'a', projectId: '' },
        { connectionId: 'rollbar-c', externalId: 'c', projectId: '' },
      ],
    })
    const context = await makeTestRequestContext({
      plugin: 'rollbar',
      principal: { kind: 'device', userId: 'user-1', deviceId: 'device-1' },
      providers: {
        connections: async () => connections,
        withConnections: (async (_provider: string, visit: (row: unknown, key: string) => unknown) =>
          (await Promise.all(connections.map((row: { id: string }) => visit(row, `token-${row.id}`)))).filter(
            (value) => value !== undefined,
          )) as never,
      },
    })
    const search = (q: string) =>
      fetchRoutes(new Request(`http://rollbar.test/rail-search?project=project-1&q=${encodeURIComponent(q)}`), context)
    return { asked, search }
  }

  afterEach(() => vi.unstubAllGlobals())

  it("asks Rollbar's search for active items in the mapped connection only", async () => {
    const { asked, search } = await setup(() => ({ items: [apiItem(412), apiItem(7, { status: 'resolved' })] }))
    const response = await search('TypeError')
    expect(response.status).toBe(200)
    expect(asked).toHaveLength(1)
    expect(asked[0].token).toBe('token-rollbar-a')
    expect(asked[0].url).toContain('/items?status=active&page=1&query=TypeError')
    const body = (await response.json()) as { items: { id: string; short: string }[]; incomplete: boolean }
    // A resolved item the reader's own query reached is still not an active one.
    expect(body.items.map((row) => row.id)).toEqual(['rollbar-a:412'])
    expect(body.incomplete).toBe(false)
  })

  it('says the answer is incomplete when the page was full', async () => {
    const { search } = await setup(() => ({ items: Array.from({ length: 100 }, (_, at) => apiItem(at + 1)) }))
    expect(await (await search('error')).json()).toMatchObject({ incomplete: true })
  })

  it('reports a total failure', async () => {
    const { search } = await setup(() => ({ status: 500 }))
    expect((await search('error')).status).toBe(502)
  })
})

// The browser extension's item handoff. This router answers every path under /v1/p/rollbar over HTTP, so
// the handoff has to be one of its routes; a mount of its own would never be reached.
describe('Rollbar browser handoff route', () => {
  it('is served by the provider router, with the mapped projects and the item read by its system id', async () => {
    const fetchRoutes = createRollbarFetch({
      byId: async (id) => ({ id, workspaceId: 'workspace-1' }) as never,
      checkouts: async () => [{ id: 'project-1' }] as never,
      externalProjects: async () => [{ connectionId: 'rollbar-a', externalId: '7', projectId: '' }],
    })
    const asked: unknown[] = []
    const context = await makeTestRequestContext({
      plugin: 'rollbar',
      principal: { kind: 'device', userId: 'user-1', deviceId: 'device-1' },
      providers: {
        connections: (async () => [{ id: 'rollbar-a', label: 'Rollbar · web', status: 'connected' }]) as never,
        resource: (async (request: { resourceId: string; input: unknown }) => {
          asked.push(request.input)
          return request.resourceId === 'rollbar.items'
            ? {
                ok: true,
                value: { ...item('rollbar-a', { identifier: '142', itemId: '999' }), resolvedInVersion: null },
              }
            : { ok: false, failure: { error: 'provider_resource_not_found', status: 404 } }
        }) as never,
      },
    })

    const response = await fetchRoutes(
      new Request('http://rollbar.test/browser/item', {
        method: 'POST',
        body: JSON.stringify({ url: 'https://rollbar.com/item/999/', captures: { itemId: '999' } }),
      }),
      context,
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      items: [{ identifier: '#142', connection: { id: 'rollbar-a' }, projects: ['project-1'] }],
    })
    expect(asked[0]).toEqual({ kind: 'item', itemId: '999' })
  })
})
