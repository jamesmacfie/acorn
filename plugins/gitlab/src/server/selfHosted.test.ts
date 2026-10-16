import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTestPluginDb, testGate, type AppEnv, type Env, type TestPluginDb } from '@acorn/plugin-api/testkit'
import type { CoreServices, PluginRequestContext, Principal, StoredConnection } from '@acorn/plugin-api/node'
import type { GitlabProject, MergeRequestDetail } from '../shared/api'
import { makeFakeGitlab, makeMergeRequest, type FakeProject } from './fakeGitlab.helper'
import { createGitlabProvider } from './provider'
import { createGitlabServers, gitlabOrigin } from './servers'
import { forgetOtherConnections, readCachedProjects, resolveProject } from './mirror/projects'
import { projectReads } from './routes/projectReads'
import { createBrowserHandoffHandler } from './browserHandoff'

vi.mock('./gitlabApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./gitlabApi')>()),
  gitlabSession: async (_c: unknown, server: { origin: string }) => ({ origin: server.origin, token: 'token' }),
}))

// A company GitLab at https://gitlab.example.test, served by the fake: the token form's address, the
// host the plugin claims for it, and the routes and browser button on it.

const COMPANY = 'https://gitlab.example.test'
const gitlabCom = { id: 'conn-com', status: 'connected', label: 'ada', name: null, config: '{}' } as StoredConnection
const company = {
  id: 'conn-company',
  status: 'connected',
  label: 'ada on gitlab.example.test',
  name: null,
  config: JSON.stringify({ baseUrl: COMPANY }),
} as StoredConnection

describe('the token form address', () => {
  it('takes an https server by itself, and gitlab.com when left empty', () => {
    expect(gitlabOrigin('', false)).toBe('https://gitlab.com')
    expect(gitlabOrigin(' https://gitlab.example.test/ ', false)).toBe(COMPANY)
    expect(() => gitlabOrigin('http://gitlab.example.test', false)).toThrow('https')
    expect(() => gitlabOrigin('https://gitlab.example.test/gitlab', false)).toThrow('no path')
    expect(() => gitlabOrigin('https://gitlab.example.test:8443', false)).toThrow('standard https port')
    expect(() => gitlabOrigin('https://ada:secret@gitlab.example.test', false)).toThrow('sign-in')
    expect(() => gitlabOrigin('gitlab.example.test', false)).toThrow("isn't a web address")
  })

  it('asks before a loopback or private address', () => {
    for (const address of ['https://localhost', 'https://10.0.0.5', 'https://192.168.1.2', 'https://127.0.0.1'])
      expect(() => gitlabOrigin(address, false)).toThrow('private address')
    expect(gitlabOrigin('https://10.0.0.5', true)).toBe('https://10.0.0.5')
    expect(() => gitlabOrigin('https://[::1]', true)).toThrow("can't match projects")
  })
})

describe('a company GitLab server', () => {
  let testDb: TestPluginDb
  let fake: ReturnType<typeof makeFakeGitlab>
  let project: FakeProject

  beforeEach(() => {
    testDb = makeTestPluginDb('gitlab')
    project = { id: 7, path: 'group/api', defaultBranch: 'main', mergeRequests: [makeMergeRequest({ iid: 3 })] }
    fake = makeFakeGitlab([project], COMPANY)
    vi.stubGlobal('fetch', fake.fetch)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    testDb.cleanup()
  })

  it('connects with a token and its address, which the connection keeps', async () => {
    const connection = createGitlabProvider({ clientId: () => '' }).connection
    const typed = { token: 'token', baseUrl: `${COMPANY}/` }
    expect(connection.normalize(typed, await connection.validate(typed))).toMatchObject({
      label: 'ada on gitlab.example.test',
      config: { baseUrl: COMPANY },
    })
    // The same token typed for gitlab.com goes to gitlab.com, which this fake isn't.
    await expect(connection.validate({ token: 'token' })).rejects.toMatchObject({ code: 'provider_needs_auth' })
    expect(await connection.test('token', { baseUrl: COMPANY })).toEqual({ ok: true })
  })

  it('claims its host while the connection exists, and forgets its mirror when it goes', async () => {
    let listed = [gitlabCom, company, { ...company, id: 'conn-second' }]
    const claims: string[] = []
    const forgotten: string[][] = []
    const servers = createGitlabServers({
      connections: async () => listed,
      claim: (host) => {
        claims.push(host)
        return { dispose: () => claims.splice(claims.indexOf(host), 1) }
      },
      forgetOthers: async (ids) => void forgotten.push(ids),
    })
    await servers.sync()
    // gitlab.com is declared, so only the company server is claimed. The older connection to a server
    // serves it.
    expect(claims).toEqual(['gitlab.example.test'])
    expect(servers.byHost('gitlab.example.test')).toEqual({
      connectionId: 'conn-company',
      origin: COMPANY,
      host: 'gitlab.example.test',
    })
    expect(servers.byHost('gitlab.com')?.connectionId).toBe('conn-com')
    listed = [gitlabCom]
    await servers.sync()
    expect(claims).toEqual([])
    expect(servers.byHost('gitlab.example.test')).toBeNull()
    expect(forgotten.at(-1)).toEqual(['conn-com'])
  })

  it('keeps each connection its own mirror, so two servers with the same project path stay apart', async () => {
    const other = makeFakeGitlab([{ ...project, id: 70 }])
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).startsWith(COMPANY) ? fake.fetch(input, init) : other.fetch(input, init),
    )
    await resolveProject({ origin: COMPANY, token: 'token' }, testDb.db, company.id, 'group/api')
    await resolveProject({ origin: 'https://gitlab.com', token: 'token' }, testDb.db, gitlabCom.id, 'group/api')
    expect((await readCachedProjects(testDb.db, company.id)).map((row) => row.id)).toEqual([7])
    expect((await readCachedProjects(testDb.db, gitlabCom.id)).map((row) => row.id)).toEqual([70])
    await forgetOtherConnections(testDb.db, [gitlabCom.id])
    expect(await readCachedProjects(testDb.db, company.id)).toEqual([])
    expect(await readCachedProjects(testDb.db, gitlabCom.id)).toHaveLength(1)
  })

  it("serves the server's projects and merge requests under its host, from its own address", async () => {
    const servers = createGitlabServers({
      connections: async () => [company],
      claim: () => ({ dispose: () => {} }),
      forgetOthers: async () => {},
    })
    await servers.sync()
    const core = { tasks: { adoptChangeRequests: async () => 0 } } as unknown as Pick<CoreServices, 'tasks'>
    const app = new Hono<AppEnv>()
      .use('/api/*', ...testGate({ kind: 'device', userId: 'owner' } as Principal))
      .route('/api/projects', projectReads(testDb.db, servers, { core, maxPages: 5 }))
    const env = { BLOBS: { get: async () => null, put: async () => {} } } as unknown as Env
    const get = async <T>(path: string) =>
      (await app.fetch(new Request(`http://acorn.test/api/projects${path}`), env)).json() as Promise<T>

    expect(await get<GitlabProject[]>('')).toEqual([
      expect.objectContaining({ host: 'gitlab.example.test', path: 'group/api', id: 7 }),
    ])
    const detail = await get<MergeRequestDetail>('/gitlab.example.test/group%2Fapi/merge-requests/3')
    expect(detail.request).toMatchObject({ number: 3, title: 'Fix the importer' })
    // Root-relative links in GitLab's HTML point at the company server.
    expect(detail.request?.body).toContain(`href="${COMPANY}/group/sub/api/-/issues/3"`)
    const unknown = await app.fetch(
      new Request('http://acorn.test/api/projects/gitlab.other.test/group%2Fapi/labels'),
      env,
    )
    expect(unknown.status).toBe(401)
  })

  it('resolves a merge request page on the server into a task on its project', async () => {
    const servers = createGitlabServers({
      connections: async () => [company],
      claim: () => ({ dispose: () => {} }),
      forgetOthers: async () => {},
    })
    await servers.sync()
    const repository = { provider: 'gitlab', host: 'gitlab.example.test', path: 'group/api', externalId: '7' }
    const core = {
      projects: {
        checkouts: async () => [{ id: 'project-1', path: '/src/api' }],
        byId: async (id: string) => ({ id, name: 'api', path: '/src/api', workspaceId: 'w', repository, github: null }),
      },
    } as unknown as Pick<CoreServices, 'projects'>
    const context = {
      userId: 'owner',
      principal: { kind: 'device', userId: 'owner' },
      providers: {
        withConnections: async <T>(
          _provider: string,
          visit: (c: StoredConnection, s: string) => Promise<T | undefined>,
        ) => {
          const value = await visit(company, 'token')
          return value === undefined ? [] : [value]
        },
      },
    } as unknown as PluginRequestContext
    const handler = createBrowserHandoffHandler(testDb.db, core, servers, () => {})
    const resolve = (url: string) =>
      handler(
        new Request('http://acorn.test/browser/merge-request', {
          method: 'POST',
          body: JSON.stringify({ url, captures: { path: 'group/api', number: '3' } }),
        }),
        context,
      )

    const { items } = (await (await resolve(`${COMPANY}/group/api/-/merge_requests/3`)).json()) as {
      items: Record<string, unknown>[]
    }
    expect(items).toEqual([
      expect.objectContaining({
        identifier: 'gitlab.example.test/group/api!3',
        url: `${COMPANY}/group/api/-/merge_requests/3`,
        projects: ['project-1'],
        seed: expect.objectContaining({
          changeRequest: { number: 3 },
          links: [expect.objectContaining({ connectionId: 'conn-company' })],
        }),
      }),
    ])
    expect((await resolve('https://gitlab.other.test/group/api/-/merge_requests/3')).status).toBe(403)
  })
})
