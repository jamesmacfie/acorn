import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import type { RouteResult, StoredConnection } from '@acorn/plugin-api/node'
import { validatePluginConfig } from '@acorn/plugin-api/testkit'
import { browserHandoffResolution, matchHandoffPage, type BrowserHandoff } from '@acorn/protocol/plugin/handoffs.ts'
import type { RollbarItemMetadata, RollbarOccurrenceDetail } from '../shared/api'
import { createBrowserHandoffHandler, projectsMappingConnection } from './browserHandoff'
import { normalizeOccurrence } from './normalize'

const connection = (id: string, project: string, status = 'connected') =>
  ({ id, label: `Rollbar · ${project}`, name: null, status }) as StoredConnection

// The system id and the project counter differ on purpose, so a swap of one for the other shows.
const item = (overrides: Partial<RollbarItemMetadata> = {}): RollbarItemMetadata => ({
  integrationId: 'c-web',
  integrationLabel: 'Rollbar · web',
  identifier: '142',
  itemId: '999',
  url: 'https://rollbar.com/item/999/',
  title: 'TypeError: token is null',
  level: 'error',
  environment: 'production',
  status: 'active',
  totalOccurrences: 37,
  firstOccurrenceAt: Date.UTC(2026, 9, 1),
  lastOccurrenceAt: Date.UTC(2026, 9, 12),
  framework: 'express',
  resolvedInVersion: null,
  assignedTo: null,
  ...overrides,
})

// Through the real normalizer, with the fields it must drop, so the test sees what the cache holds.
const occurrence = (frames = 2, folder = 'src'): RollbarOccurrenceDetail =>
  normalizeOccurrence({
    id: 555,
    timestamp: Date.UTC(2026, 9, 12) / 1000,
    data: {
      uuid: 'aaaa-bbbb',
      environment: 'production',
      code_version: 'abc123',
      body: {
        trace: {
          exception: { class: 'TypeError', message: 'token is null' },
          frames: Array.from({ length: frames }, (_, at) => ({
            filename: `${folder}/auth${at}.ts`,
            lineno: 80 + at,
            method: `step${at}`,
            code: `const token = session${at}.token`,
            context: { pre: ['function login() {'], post: ['}'] },
          })),
        },
      },
      request: {
        method: 'POST',
        url: 'https://app.example/api/login?access_token=SECRET-QUERY',
        headers: { authorization: 'SECRET-HEADER', cookie: 'session=SECRET-COOKIE' },
        body: 'password=SECRET-BODY',
      },
      person: { id: '7', username: 'ana', email: 'ana@example.com' },
      server: { host: 'web-1', branch: 'main' },
      custom: { secret: 'SECRET-CUSTOM' },
    },
  })

type Read = RouteResult<RollbarItemMetadata>
const found = (value: RollbarItemMetadata): Read => ({ ok: true, value })
const failed = (error: string, status: 401 | 403 | 404 | 429 | 502): Read => ({ ok: false, failure: { error, status } })

const resolve = async (options: {
  connections: StoredConnection[]
  // Each connection's answer to the item read, by connection ID.
  reads: Record<string, Read>
  occurrence?: RollbarOccurrenceDetail | null
  url?: string
  captures?: Record<string, string>
}) => {
  const asked: { connectionId: string; resourceId: string; input: unknown; force?: boolean; requireFresh?: boolean }[] =
    []
  const handler = createBrowserHandoffHandler({
    projectsFor: async (connectionId) => (connectionId === 'c-web' ? ['project-1'] : []),
  })
  const url = options.url ?? 'https://rollbar.com/item/999/'
  const captures = options.captures ?? matchHandoffPage(declared(), url)!
  const latest = options.occurrence === undefined ? occurrence() : options.occurrence
  const response = await handler(
    new Request('https://acorn.invalid/browser/item', { method: 'POST', body: JSON.stringify({ url, captures }) }),
    {
      userId: 'owner',
      principal: { kind: 'device', userId: 'owner' },
      providers: {
        connections: async () => options.connections,
        resource: async (request: {
          connectionId: string
          resourceId: string
          input: unknown
          force?: boolean
          requireFresh?: boolean
        }) => {
          asked.push(request)
          if (request.resourceId === 'rollbar.items')
            return options.reads[request.connectionId] ?? failed('provider_resource_not_found', 404)
          if (request.resourceId === 'rollbar.item-occurrences')
            return { ok: true, value: { occurrences: latest ? [{ id: latest.id }] : [], capped: false } }
          return latest ? { ok: true, value: latest } : failed('provider_resource_not_found', 404)
        },
      },
    } as never,
  )
  return { response, asked }
}

// The handoff as the manifest schema reads it from the plugin's own config, the same check the Node runs
// before it advertises anything.
let handoff: Omit<BrowserHandoff, 'pluginId'>
const declared = () => handoff
beforeAll(async () => {
  const config = await validatePluginConfig(fileURLToPath(new URL('../../', import.meta.url)))
  if (!config.ok) throw new Error(config.reason)
  handoff = config.manifest.contributions.browserHandoffs![0]!
})

describe('the Rollbar item handoff', () => {
  it('declares a valid handoff on the item permalink, with or without its trailing slash', () => {
    expect(handoff.resolve).toBe('/v1/p/rollbar/browser/item')
    expect(handoff.anchors).toEqual([])
    expect(matchHandoffPage(handoff, 'https://rollbar.com/item/999/')).toEqual({ itemId: '999' })
    expect(matchHandoffPage(handoff, 'https://rollbar.com/item/999')).toEqual({ itemId: '999' })
    expect(matchHandoffPage(handoff, 'https://rollbar.com/item/999/occurrences/')).toBeNull()
    expect(matchHandoffPage(handoff, 'https://rollbar.com/acme/web/items/142/')).toBeNull()
  })

  it('answers the item with its own counter, its connection, mapped projects, the rail seed, and context', async () => {
    const { response, asked } = await resolve({
      connections: [connection('c-web', 'web')],
      reads: { 'c-web': found(item()) },
    })
    expect(response.status).toBe(200)
    const { items } = browserHandoffResolution.parse(await response.json())
    expect(items).toEqual([
      {
        identifier: '#142',
        url: 'https://rollbar.com/item/999/',
        title: 'TypeError: token is null',
        connection: { id: 'c-web', label: 'Rollbar · web' },
        projects: ['project-1'],
        seed: {
          origin: 'rollbar',
          title: 'TypeError: token is null',
          links: [
            {
              connectionId: 'c-web',
              identifier: '142',
              ref: { displayId: '142', externalId: '999', url: 'https://rollbar.com/item/999/' },
            },
          ],
        },
        context: { label: 'Rollbar item #142', content: expect.any(String) },
      },
    ])
    // The page's number goes to Rollbar as the system id, never as a counter, and past the cache.
    expect(asked[0]).toMatchObject({
      resourceId: 'rollbar.items',
      input: { kind: 'item', itemId: '999' },
      force: true,
      requireFresh: true,
    })
    // The occurrences are read by the counter Rollbar answered with.
    expect(asked.slice(1).map((request) => request.input)).toEqual([
      { identifier: '142' },
      { identifier: '142', occurrenceId: '555' },
    ])
  })

  it('proposes the investigation context without the person, headers, cookies, body, or query string', async () => {
    const { response } = await resolve({ connections: [connection('c-web', 'web')], reads: { 'c-web': found(item()) } })
    const content = browserHandoffResolution.parse(await response.json()).items[0]!.context!.content
    expect(content).toContain('Rollbar item #142: TypeError: token is null')
    expect(content).toContain('Level: error · Environment: production · Status: active')
    expect(content).toContain('TypeError: token is null')
    expect(content).toContain('Code version: abc123 · Branch: main · Host: web-1')
    expect(content).toContain('Request: POST https://app.example/api/login')
    expect(content).toContain('  src/auth1.ts:81 in step1')
    expect(content).toContain('81 | const token = session1.token')
    // Only the frame that raised shows its source.
    expect(content).not.toContain('session0.token')
    for (const leaked of ['SECRET', 'ana@example.com', 'ana', 'cookie', 'authorization'])
      expect(content).not.toContain(leaked)
  })

  it('keeps a long trace within the byte limit', async () => {
    const { response } = await resolve({
      connections: [connection('c-web', 'web')],
      reads: { 'c-web': found(item()) },
      occurrence: occurrence(200, `src/${'nested/'.repeat(12)}`),
    })
    const content = browserHandoffResolution.parse(await response.json()).items[0]!.context!.content
    expect(Buffer.byteLength(content)).toBeLessThanOrEqual(12_000)
    expect(content.endsWith('…')).toBe(true)
  })

  it('still hands the item over when its occurrences can’t be read', async () => {
    const { response } = await resolve({
      connections: [connection('c-web', 'web')],
      reads: { 'c-web': found(item()) },
      occurrence: null,
    })
    const content = browserHandoffResolution.parse(await response.json()).items[0]!.context!.content
    expect(content).toContain('Occurrences: 37')
    expect(content).not.toContain('Latest occurrence')
  })

  it('asks every connection and answers only the project that has the item', async () => {
    const { response, asked } = await resolve({
      connections: [connection('c-api', 'api'), connection('c-web', 'web')],
      reads: { 'c-web': found(item()) },
    })
    const { items } = browserHandoffResolution.parse(await response.json())
    expect(items.map((candidate) => candidate.connection.id)).toEqual(['c-web'])
    expect(asked.filter((request) => request.resourceId === 'rollbar.items').map((r) => r.connectionId)).toEqual([
      'c-api',
      'c-web',
    ])
  })

  it('offers each connection that can read the item as its own choice', async () => {
    const { response } = await resolve({
      connections: [connection('c-web', 'web'), connection('c-web-2', 'web, second token')],
      reads: {
        'c-web': found(item()),
        'c-web-2': found(item({ integrationId: 'c-web-2' })),
      },
    })
    const { items } = browserHandoffResolution.parse(await response.json())
    expect(items.map((candidate) => [candidate.connection.id, candidate.seed.links?.[0]?.connectionId])).toEqual([
      ['c-web', 'c-web'],
      ['c-web-2', 'c-web-2'],
    ])
    // Only the mapped connection suggests a project.
    expect(items.map((candidate) => candidate.projects)).toEqual([['project-1'], []])
  })

  it("doesn't take an answer for another item as the page's", async () => {
    const { response } = await resolve({
      connections: [connection('c-web', 'web')],
      reads: { 'c-web': found(item({ itemId: '142' })) },
    })
    expect(response.status).toBe(404)
  })

  it('skips a disabled connection and asks for one when none is left', async () => {
    const { response, asked } = await resolve({
      connections: [connection('c-web', 'web', 'disabled')],
      reads: { 'c-web': found(item()) },
    })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: { code: 'provider_not_connected' } })
    expect(asked).toEqual([])
  })

  it('asks for a reconnect with 403, never 401, when a token is refused', async () => {
    const { response } = await resolve({
      connections: [connection('c-api', 'api'), connection('c-web', 'web', 'needs-auth')],
      reads: { 'c-web': failed('provider_needs_auth', 401), 'c-api': failed('provider_rate_limited', 429) },
    })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      error: { code: 'provider_needs_auth', message: expect.stringContaining('Rollbar · web') },
    })
  })

  it('says Rollbar is limiting requests, then that it is unavailable', async () => {
    const limited = await resolve({
      connections: [connection('c-web', 'web')],
      reads: { 'c-web': failed('provider_rate_limited', 429) },
    })
    expect(limited.response.status).toBe(429)
    const down = await resolve({
      connections: [connection('c-web', 'web')],
      reads: { 'c-web': failed('provider_unavailable', 502) },
    })
    expect(down.response.status).toBe(502)
  })

  it('answers the project that has the item when another connection fails', async () => {
    const { response } = await resolve({
      connections: [connection('c-api', 'api'), connection('c-web', 'web')],
      reads: { 'c-api': failed('provider_needs_auth', 401), 'c-web': found(item()) },
    })
    expect(response.status).toBe(200)
  })

  it('refuses an address that names no item id', async () => {
    const { response, asked } = await resolve({
      connections: [connection('c-web', 'web')],
      reads: {},
      captures: { itemId: '142abc' },
    })
    expect(response.status).toBe(400)
    expect(asked).toEqual([])
  })
})

describe('projects mapping a Rollbar connection', () => {
  const projects = (rows: { connectionId: string; externalId: string; projectId: string }[]) => ({
    checkouts: async () => [{ id: 'project-1' }, { id: 'project-2' }, { id: 'project-3' }] as never,
    byId: async (id: string) => ({ id, workspaceId: id === 'project-3' ? 'workspace-2' : 'workspace-1' }) as never,
    externalProjects: async (workspaceId: string) => (workspaceId === 'workspace-1' ? rows : []),
  })

  it('takes every checkout in a workspace that maps the connection', async () => {
    await expect(
      projectsMappingConnection(projects([{ connectionId: 'c-web', externalId: '7', projectId: '' }]), 'c-web'),
    ).resolves.toEqual(['project-1', 'project-2'])
  })

  it('keeps a mapping that names one project to that project, and ignores other connections', async () => {
    const rows = [
      { connectionId: 'c-web', externalId: '7', projectId: 'project-2' },
      { connectionId: 'c-api', externalId: '8', projectId: '' },
    ]
    await expect(projectsMappingConnection(projects(rows), 'c-web')).resolves.toEqual(['project-2'])
  })
})
