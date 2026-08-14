import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PluginDatabase, Principal } from '@acorn/plugin-api/node'
import { makeTestNodeContext, makeTestRequestContext, schema, validatePluginConfig, type TestNodeContext } from '@acorn/plugin-api/testkit'
import type { AgentContextOption } from '@acorn/protocol/agentContext.ts'
import type { PluginRailItems } from '@acorn/protocol/api.ts'
import type { HttpRequest, HttpVariable } from '../../shared/model'
import { httpRequests, httpVariables } from '../../node/schema'
import { createHttpFetch } from './http'

// This package's own root, for reading the declaration below.
const PACKAGE_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
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
  // The router is a factory over this plugin's own database, so the test hands it one instead of putting
  // core's handle on `c.env`. Nothing about `c.env` is used any more except the one symbol the carrier
  // puts there, which is what `call` below supplies.
  // The host's own context for this plugin, on the loaded tier — which is the only tier http has. The
  // permissions come from the plugin's own acorn-plugin.config.mjs, so `ctx.core` here holds exactly the
  // facets the owner is told about: under-declare `tasks`, `projects:read` or `secrets` in the config and
  // these routes stop working in this suite, which is the point.
  let ctx: TestNodeContext
  let pluginDb: PluginDatabase

  beforeEach(async () => {
    const config = await validatePluginConfig(PACKAGE_ROOT)
    if (!config.ok) throw new Error(config.reason)
    // No `migrations`: the testkit resolves this checkout's plugins/http/migrations from the id, the same
    // chain the builder stages inside the package for the real loader to find.
    ctx = makeTestNodeContext({
      plugin: { name: 'http' },
      permissions: config.manifest.permissions.node,
    })
    // The manifest-bound storage seam, opened and migrated by the host, exactly as init() does at boot.
    pluginDb = ctx.storage.open()
    const now = Date.now()
    await ctx.db.insert(schema.workspaces).values({ id: 'workspace-1', name: 'Default', isDefault: true, sort: 0, createdAt: now, updatedAt: now })
    await ctx.db.insert(schema.projects).values([
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
    await ctx.db.insert(schema.tasks).values([
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
    ctx.cleanup()
  })

  // Straight through the portable carrier, which is the only door these routes have now: no host Hono
  // stack, no middleware-set principal, and the identity arriving as the request context the host binds.
  const call = async (caller: Principal, path: string, init?: RequestInit) => {
    // The real request context, over the real bindings. It used to be a literal with four throwing
    // provider stubs; http registers no provider, so the host's own ownership check is what refuses them
    // now — and nothing here has to remember to keep the shape up to date.
    const context = await makeTestRequestContext({ plugin: 'http', principal: caller, env: ctx.env })
    return createHttpFetch(pluginDb, ctx.core)(new Request(`http://acorn.test${path}`, init), context)
  }

  it('encrypts saved request payloads and returns them only to their owner', async () => {
    const created = await call(principal('alice'), '/projects/project-web/requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody),
    })
    expect(created.status).toBe(201)
    expect((await created.json()) as HttpRequest).toMatchObject(requestBody)

    const [stored] = await pluginDb.select().from(httpRequests)
    expect(stored).toMatchObject({ userId: 'alice', encrypted: true })
    const raw = JSON.stringify(stored)
    for (const secret of ['query-secret', 'header-secret', 'body-secret', 'auth-secret', 'override-secret']) {
      expect(raw).not.toContain(secret)
    }

    const alice = (await (await call(principal('alice'), '/projects/project-web/requests')).json()) as HttpRequest[]
    expect(alice).toHaveLength(1)
    expect(alice[0]).toMatchObject(requestBody)
    expect(await (await call(principal('bob'), '/projects/project-web/requests')).json()).toEqual([])
  })

  it('encrypts every variable kind, masks secrets, and scopes names per user', async () => {
    const create = (login: string, kind: 'value' | 'secret' | 'command', value: string) =>
      call(principal(login), '/projects/project-web/vars', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'TOKEN', kind, value, enabled: true }),
      })

    const alice = await create('alice', 'secret', 'alice-secret')
    const bob = await create('bob', 'value', 'bob-value')
    expect(alice.status).toBe(201)
    expect(bob.status).toBe(201)
    expect(((await alice.json()) as HttpVariable).value).toBe('')

    const stored = await pluginDb.select().from(httpVariables)
    expect(stored).toHaveLength(2)
    expect(JSON.stringify(stored)).not.toContain('alice-secret')
    expect(JSON.stringify(stored)).not.toContain('bob-value')
    expect(stored.every((row) => row.encrypted)).toBe(true)

    const bobRows = (await (await call(principal('bob'), '/projects/project-web/vars')).json()) as HttpVariable[]
    expect(bobRows).toMatchObject([{ name: 'TOKEN', kind: 'value', value: 'bob-value' }])
  })

  it('rejects request task IDs that are missing or owned by another project', async () => {
    const mismatched = { ...requestBody, taskId: 'task-api' }
    const create = await call(principal('alice'), '/projects/project-web/requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(mismatched),
    })
    expect(create.status).toBe(400)
    expect(await create.json()).toMatchObject({ error: { code: 'bad_request' } })

    const valid = await call(principal('alice'), '/projects/project-web/requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...requestBody, taskId: 'task-web' }),
    })
    expect(valid.status).toBe(201)
    const saved = (await valid.json()) as HttpRequest

    const update = await call(principal('alice'), `/projects/project-web/requests/${saved.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(mismatched),
    })
    expect(update.status).toBe(400)
    expect(await update.json()).toMatchObject({ error: { code: 'bad_request' } })

    const read = await call(principal('alice'), '/projects/project-web/requests?taskId=task-api')
    expect(read.status).toBe(400)
    expect(await read.json()).toMatchObject({ error: { code: 'bad_request' } })
  })

  it('rejects the machine internal principal before it can read or send credentials', async () => {
    const response = await call(principal('alice', 'internal'), '/projects/project-web/requests')
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: { code: 'interactive_user_required' } })
  })

  // ── The descriptor routes the move added: what the HOST reads, not what the frame reads ───────────

  const save = (login: string, body: Record<string, unknown>) =>
    call(principal(login), '/projects/project-web/requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...requestBody, ...body }),
    })

  it('lists the routed project’s saved requests as rail rows, and nobody else’s', async () => {
    await save('alice', { name: 'Filed', folder: 'auth' })
    await save('alice', { name: 'Ad hoc', taskId: 'task-web' })
    await save('bob', { name: 'Bob’s' })

    const rows = (await (await call(principal('alice'), '/rail-items?project=project-web')).json()) as PluginRailItems
    // The project tree only: a task's ad-hoc request is not a project row, and another owner's never was.
    expect(rows.items).toEqual([{ id: expect.any(String), title: 'Filed', badge: 'POST', icon: 'send', subtitle: 'auth' }])
    // No `task` block, which is what tells the host there is nothing here to promote.
    expect(rows.items[0]).not.toHaveProperty('task')
  })

  it('answers an empty rail rather than everything when no project is routed', async () => {
    await save('alice', { name: 'Filed' })
    expect(await (await call(principal('alice'), '/rail-items')).json()).toEqual({ items: [] })
    expect(await (await call(principal('alice'), '/rail-items?project=nope')).json()).toEqual({ items: [] })
  })

  it('offers a task’s own requests to the agent composer and captures them redacted', async () => {
    const adhoc = (await (await save('alice', { name: 'Login', taskId: 'task-web' })).json()) as HttpRequest
    await save('alice', { name: 'Filed in the project' })

    const options = (await (await call(principal('alice'), '/context-options?taskId=task-web')).json()) as AgentContextOption[]
    // The option's URL is redacted too — the fixture's `?token=query-secret` is exactly the case for it.
    expect(options).toEqual([{ id: adhoc.id, label: 'Login', description: 'POST https://api.example.test/items?token=•••' }])

    const captured = await call(principal('alice'), '/context-capture', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ taskId: 'task-web', optionIds: [adhoc.id] }),
    })
    expect(captured.status).toBe(200)
    // The assertion the whole node-side move rests on: the rows this route read had their ciphertext
    // opened, and the snapshot still carries no credential.
    const body = JSON.stringify(await captured.json())
    expect(body).toContain('Login')
    for (const secret of ['query-secret', 'header-secret', 'body-secret', 'auth-secret', 'override-secret']) {
      expect(body).not.toContain(secret)
    }
  })

  it('needs a task the caller can name for either context route', async () => {
    expect((await call(principal('alice'), '/context-options')).status).toBe(404)
    expect((await call(principal('alice'), '/context-options?taskId=nope')).status).toBe(404)
    const bad = await call(principal('alice'), '/context-capture', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(bad.status).toBe(400)
  })
})
