import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { memoryIdentityStore } from '@acorn/node-core/main/activeIdentity.ts'
import { createCoreServices } from '@acorn/node-core/main/core/index.ts'
import { SecretService } from '@acorn/node-core/main/core/secrets.ts'
import type { AppEnv, Principal } from '@acorn/node-core/server/middleware/auth.ts'
import { makeTestDb, makeTestPluginDb, type TestDb, type TestPluginDb } from '@acorn/node-core/testkit/db.ts'
import { schema } from '@acorn/node-core/server/db/index.ts'
import type { HttpRequest, HttpVariable } from '../../shared/model'
import { httpRequests, httpVariables } from '../../node/schema'
import { migrationsDir } from '../../node/migrations'
import { httpRoutes } from './http'
import type { Env } from '@acorn/node-core/main/bindings.ts'

const ENC_KEY = '0'.repeat(64)
const requestBody = {
  folder: '',
  taskId: null,
  name: 'Private API',
  method: 'POST',
  url: 'https://api.example.test/items?token=query-secret',
  headers: [{ name: 'Authorization', value: 'Bearer header-secret', enabled: true }],
  bodyMode: 'json',
  body: '{"password":"body-secret"}',
  auth: { mode: 'bearer', token: 'auth-secret' },
  vars: { TOKEN: 'override-secret' },
}

const principal = (login: string, kind: Principal['kind'] = 'device'): Principal => ({ kind, userId: login })

describe('HTTP credential isolation', () => {
  // The router is a factory over this plugin's own database now, so the test hands it one instead of
  // putting core's handle on `c.env`. The empty Env below is deliberate: it proves the router reads
  // nothing from the bindings any more.
  let pluginDb: TestPluginDb
  let coreDb: TestDb

  beforeEach(async () => {
    pluginDb = makeTestPluginDb('http', migrationsDir())
    coreDb = makeTestDb()
    const now = Date.now()
    await coreDb.db.insert(schema.workspaces).values({ id: 'workspace-1', name: 'Default', isDefault: true, sort: 0, createdAt: now, updatedAt: now })
    await coreDb.db.insert(schema.projects).values([
      {
        id: 'project-web', name: 'web', path: null, workspaceId: 'workspace-1', sort: 0, hidden: false,
        vcs: 'git', defaultBranch: 'main', remoteUrl: 'https://github.com/acme/web.git', githubOwner: 'acme', githubName: 'web', githubRepoId: null,
        createdAt: now, updatedAt: now,
      },
      {
        id: 'project-api', name: 'api', path: null, workspaceId: 'workspace-1', sort: 1, hidden: false,
        vcs: 'git', defaultBranch: 'main', remoteUrl: 'https://github.com/acme/api.git', githubOwner: 'acme', githubName: 'api', githubRepoId: null,
        createdAt: now, updatedAt: now,
      },
    ])
    await coreDb.db.insert(schema.tasks).values([
      {
        id: 'task-web', title: 'Web task', icon: null, origin: 'local', projectId: 'project-web', branch: 'main', worktreePath: null,
        pullNumber: null, status: 'active', parentId: null, sort: 0, createdAt: now, updatedAt: now, archivedAt: null,
      },
      {
        id: 'task-api', title: 'API task', icon: null, origin: 'local', projectId: 'project-api', branch: 'main', worktreePath: null,
        pullNumber: null, status: 'active', parentId: null, sort: 1, createdAt: now, updatedAt: now, archivedAt: null,
      },
    ])
  })

  afterEach(() => {
    pluginDb.cleanup()
    coreDb.cleanup()
  })

  const call = (caller: Principal, path: string, init?: RequestInit) => {
    const app = new Hono<AppEnv>()
    app.use('/api/*', async (c, next) => {
      c.set('principal', caller)
      await next()
    })
    app.route('/api/http', httpRoutes(pluginDb.db, createCoreServices({ secrets: new SecretService(ENC_KEY), db: coreDb.db, activeIdentity: memoryIdentityStore() })))
    return app.fetch(new Request(`http://acorn.test${path}`, init), {} as Env)
  }

  it('encrypts saved request payloads and returns them only to their owner', async () => {
    const created = await call(principal('alice'), '/api/http/projects/project-web/requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody),
    })
    expect(created.status).toBe(201)
    expect((await created.json()) as HttpRequest).toMatchObject(requestBody)

    const [stored] = await pluginDb.db.select().from(httpRequests)
    expect(stored).toMatchObject({ userId: 'alice', encrypted: true })
    const raw = JSON.stringify(stored)
    for (const secret of ['query-secret', 'header-secret', 'body-secret', 'auth-secret', 'override-secret']) {
      expect(raw).not.toContain(secret)
    }

    const alice = (await (await call(principal('alice'), '/api/http/projects/project-web/requests')).json()) as HttpRequest[]
    expect(alice).toHaveLength(1)
    expect(alice[0]).toMatchObject(requestBody)
    expect(await (await call(principal('bob'), '/api/http/projects/project-web/requests')).json()).toEqual([])
  })

  it('encrypts every variable kind, masks secrets, and scopes names per user', async () => {
    const create = (login: string, kind: 'value' | 'secret' | 'command', value: string) =>
      call(principal(login), '/api/http/projects/project-web/vars', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'TOKEN', kind, value, enabled: true }),
      })

    const alice = await create('alice', 'secret', 'alice-secret')
    const bob = await create('bob', 'value', 'bob-value')
    expect(alice.status).toBe(201)
    expect(bob.status).toBe(201)
    expect(((await alice.json()) as HttpVariable).value).toBe('')

    const stored = await pluginDb.db.select().from(httpVariables)
    expect(stored).toHaveLength(2)
    expect(JSON.stringify(stored)).not.toContain('alice-secret')
    expect(JSON.stringify(stored)).not.toContain('bob-value')
    expect(stored.every((row) => row.encrypted)).toBe(true)

    const bobRows = (await (await call(principal('bob'), '/api/http/projects/project-web/vars')).json()) as HttpVariable[]
    expect(bobRows).toMatchObject([{ name: 'TOKEN', kind: 'value', value: 'bob-value' }])
  })

  it('rejects request task IDs that are missing or owned by another project', async () => {
    const mismatched = { ...requestBody, taskId: 'task-api' }
    const create = await call(principal('alice'), '/api/http/projects/project-web/requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(mismatched),
    })
    expect(create.status).toBe(400)
    expect(await create.json()).toMatchObject({ error: { code: 'bad_request' } })

    const valid = await call(principal('alice'), '/api/http/projects/project-web/requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...requestBody, taskId: 'task-web' }),
    })
    expect(valid.status).toBe(201)
    const saved = (await valid.json()) as HttpRequest

    const update = await call(principal('alice'), `/api/http/projects/project-web/requests/${saved.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(mismatched),
    })
    expect(update.status).toBe(400)
    expect(await update.json()).toMatchObject({ error: { code: 'bad_request' } })

    const read = await call(principal('alice'), '/api/http/projects/project-web/requests?taskId=task-api')
    expect(read.status).toBe(400)
    expect(await read.json()).toMatchObject({ error: { code: 'bad_request' } })
  })

  it('rejects the machine internal principal before it can read or send credentials', async () => {
    const response = await call(principal('alice', 'internal'), '/api/http/projects/project-web/requests')
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: { code: 'interactive_user_required' } })
  })
})
