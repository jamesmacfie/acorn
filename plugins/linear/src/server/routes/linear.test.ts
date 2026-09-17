import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTestRequestContext } from '@acorn/plugin-api/testkit'
import type { StoredConnection } from '@acorn/plugin-api/node'
import { createLinearFetch } from './linear'

// The palette's Linear search, driven the way the host drives it: a request context whose connections
// are canned, and Linear itself replaced by a stubbed `fetch`, because these routes spend the owner's
// key against a live GraphQL endpoint and a test has none
// (docs/integrations.md § From the command palette).
//
// The two things worth pinning are the two the route decides on its own: which connections it is
// allowed to ask, and what it asks them. Everything else about a row — where picking it lands — is the
// manifest's static verb and the host's, not this route's.

type Sent = { key: string; variables: { filter: Record<string, unknown> } }

const node = (identifier: string, over: Record<string, unknown> = {}) => ({
  id: `uuid-${identifier}`,
  identifier,
  title: `Fix ${identifier}`,
  url: `https://linear.app/acme/issue/${identifier}`,
  state: { name: 'In Progress', type: 'started', color: '#000' },
  assignee: null,
  ...over,
})

const connection = (id: string, label: string) => ({ id, label } as StoredConnection)

/** The request context the host would build, with the connection list and the credential lending
 *  stubbed. `withConnections` is what the route calls; everything else stays the real runtime. */
const contextFor = (connections: StoredConnection[]) => makeTestRequestContext({
  plugin: 'linear',
  principal: { kind: 'device', userId: 'user-1', deviceId: 'device-1' },
  providers: {
    connections: (async () => connections) as never,
    withConnections: (async (_provider: string, visit: (row: StoredConnection, key: string) => unknown) =>
      Promise.all(connections.map((row) => visit(row, `key-for-${row.id}`)))) as never,
  },
})

/** Linear's answer per credential, and a record of what each one was asked. */
function stubLinear(answer: (key: string) => { status?: number; nodes?: ReturnType<typeof node>[] }): Sent[] {
  const sent: Sent[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string; headers: Record<string, string> }) => {
    const key = init.headers.Authorization
    const body = JSON.parse(init.body) as { variables: { filter: Record<string, unknown> } }
    sent.push({ key, variables: body.variables })
    const reply = answer(key)
    if (reply.status) return new Response('{}', { status: reply.status })
    return new Response(JSON.stringify({ data: { issues: { nodes: reply.nodes ?? [] } } }))
  }))
  return sent
}

const mappingFor = (rows: { connectionId: string; externalId: string; projectId: string }[]) => ({
  byId: async (id: string) => ({ id, workspaceId: 'workspace-1' } as never),
  externalProjects: async () => rows,
})

const search = (query: string, projectId = 'project-1') =>
  new Request(`http://linear.test/palette/issues?projectId=${projectId}&q=${encodeURIComponent(query)}`)

afterEach(() => vi.unstubAllGlobals())

describe('Linear palette search', () => {
  it('asks only the connections the routed project maps, and sends their project ids with the query', async () => {
    const fetchRoutes = createLinearFetch(mappingFor([
      { connectionId: 'linear-a', externalId: 'proj-a', projectId: 'project-1' },
      { connectionId: 'linear-b', externalId: 'proj-b', projectId: 'project-2' },
    ]))
    const context = await contextFor([connection('linear-a', 'Acme'), connection('linear-b', 'Other')])
    const sent = stubLinear(() => ({ nodes: [node('ENG-42')] }))

    const response = await fetchRoutes(search('login'), context)
    expect(response.status).toBe(200)
    // One request, to the mapped connection only. The unmapped workspace's issues are never read, so
    // there is nothing of theirs for a client filter to have to remove.
    expect(sent).toHaveLength(1)
    expect(sent[0].key).toBe('key-for-linear-a')
    expect(sent[0].variables.filter).toEqual({
      and: [
        { project: { id: { in: ['proj-a'] } }, state: { type: { nin: ['completed', 'canceled'] } } },
        { or: [{ title: { containsIgnoreCase: 'login' } }] },
      ],
    })
    expect(await response.json()).toEqual({
      items: [{
        id: 'linear-a:ENG-42',
        title: 'Fix ENG-42',
        subtitle: 'ENG-42 · In Progress · Acme',
        ref: 'ENG-42',
      }],
    })
  })

  it('answers nothing, and asks Linear nothing, where the routed project maps no workspace', async () => {
    const fetchRoutes = createLinearFetch({ byId: async () => null, externalProjects: async () => [] })
    const context = await contextFor([connection('linear-a', 'Acme')])
    const sent = stubLinear(() => ({ nodes: [node('ENG-1')] }))

    const response = await fetchRoutes(search('login'), context)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ items: [] })
    expect(sent).toHaveLength(0)
  })

  // The reason a row is addressed by connection and identifier rather than by identifier: a Linear key
  // is unique inside its workspace and no further, so two connected workspaces whose teams share a
  // prefix both have an ENG-42 and one would otherwise overwrite the other.
  it('keeps two connections’ identically named issues apart', async () => {
    const fetchRoutes = createLinearFetch(mappingFor([
      { connectionId: 'linear-a', externalId: 'proj-a', projectId: '' },
      { connectionId: 'linear-b', externalId: 'proj-b', projectId: '' },
    ]))
    const context = await contextFor([connection('linear-a', 'Acme'), connection('linear-b', 'Globex')])
    stubLinear(() => ({ nodes: [node('ENG-42')] }))

    const body = await (await fetchRoutes(search('ENG-42'), context)).json() as { items: { id: string; subtitle: string }[] }
    expect(body.items.map((row) => row.id)).toEqual(['linear-a:ENG-42', 'linear-b:ENG-42'])
    // And the reader can tell which is which, because the row says whose workspace it came from.
    expect(body.items.map((row) => row.subtitle)).toEqual(['ENG-42 · In Progress · Acme', 'ENG-42 · In Progress · Globex'])
  })

  it('sends a pasted identifier as its team and number as well as as text', async () => {
    const fetchRoutes = createLinearFetch(mappingFor([{ connectionId: 'linear-a', externalId: 'proj-a', projectId: '' }]))
    const context = await contextFor([connection('linear-a', 'Acme')])
    const sent = stubLinear(() => ({ nodes: [] }))

    await fetchRoutes(search('eng-42'), context)
    const clauses = sent[0].variables.filter.and as Record<string, unknown>[]
    expect(clauses[1].or).toEqual([
      { title: { containsIgnoreCase: 'eng-42' } },
      { team: { key: { eq: 'ENG' } }, number: { eq: 42 } },
    ])
  })

  it('keeps the workspace that answered when another one fails', async () => {
    const fetchRoutes = createLinearFetch(mappingFor([
      { connectionId: 'linear-a', externalId: 'proj-a', projectId: '' },
      { connectionId: 'linear-b', externalId: 'proj-b', projectId: '' },
    ]))
    const context = await contextFor([connection('linear-a', 'Acme'), connection('linear-b', 'Globex')])
    stubLinear((key) => key === 'key-for-linear-a' ? { status: 500 } : { nodes: [node('OPS-1')] })

    const response = await fetchRoutes(search('ops'), context)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ items: [{ id: 'linear-b:OPS-1' }] })
  })

  // An empty answer is an answer. The reader typed a word no ticket in that workspace matches, which is
  // not the same as the workspace being unreachable, so the failing sibling does not turn it into one.
  it('treats a workspace that answered with nothing as a success', async () => {
    const fetchRoutes = createLinearFetch(mappingFor([
      { connectionId: 'linear-a', externalId: 'proj-a', projectId: '' },
      { connectionId: 'linear-b', externalId: 'proj-b', projectId: '' },
    ]))
    const context = await contextFor([connection('linear-a', 'Acme'), connection('linear-b', 'Globex')])
    stubLinear((key) => key === 'key-for-linear-a' ? { status: 500 } : { nodes: [] })

    const response = await fetchRoutes(search('nothing matches'), context)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ items: [] })
  })

  it('reports a total failure rather than looking like an empty workspace', async () => {
    const fetchRoutes = createLinearFetch(mappingFor([{ connectionId: 'linear-a', externalId: 'proj-a', projectId: '' }]))
    const context = await contextFor([connection('linear-a', 'Acme')])
    stubLinear(() => ({ status: 401 }))

    const response = await fetchRoutes(search('login'), context)
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ error: { code: 'provider_needs_auth' } })
  })

  it('caps at the fifty rows the host will draw', async () => {
    const fetchRoutes = createLinearFetch(mappingFor([{ connectionId: 'linear-a', externalId: 'proj-a', projectId: '' }]))
    const context = await contextFor([connection('linear-a', 'Acme')])
    stubLinear(() => ({ nodes: Array.from({ length: 80 }, (_, at) => node(`ENG-${at}`)) }))

    const body = await (await fetchRoutes(search('eng'), context)).json() as { items: unknown[] }
    expect(body.items).toHaveLength(50)
  })

  // The row carries what a reader reads and the identity the surface is addressed by. It never carries
  // the credential the request was made with, the branch name, the description, or a verb.
  it('answers with display facts only', async () => {
    const fetchRoutes = createLinearFetch(mappingFor([{ connectionId: 'linear-a', externalId: 'proj-a', projectId: '' }]))
    const context = await contextFor([connection('linear-a', 'Acme')])
    stubLinear(() => ({ nodes: [node('ENG-9', { branchName: 'eng-9-fix', description: 'secret plan', priority: 1, priorityLabel: 'Urgent' })] }))

    const body = await (await fetchRoutes(search('eng'), context)).json() as { items: Record<string, unknown>[] }
    expect(Object.keys(body.items[0]).sort()).toEqual(['badge', 'id', 'ref', 'subtitle', 'title'])
    expect(body.items[0].badge).toBe('Urgent')
    expect(JSON.stringify(body)).not.toContain('key-for-linear-a')
    expect(JSON.stringify(body)).not.toContain('secret plan')
  })
})
