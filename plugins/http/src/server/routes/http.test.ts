import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  // The router is a factory over this plugin's own database, so the test hands it one instead of
  // putting core's handle on `c.env`. Permissions come from the plugin's own
  // acorn-plugin.config.mjs, so under-declaring `tasks`, `projects:read`, or `secrets` there breaks
  // these routes in this suite too.
  let ctx: TestNodeContext
  let pluginDb: PluginDatabase

  beforeEach(async () => {
    const config = await validatePluginConfig(PACKAGE_ROOT)
    if (!config.ok) throw new Error(config.reason)
    // No `migrations`: the testkit resolves plugins/http/migrations from the id, the same chain the
    // builder stages inside the package for the real loader.
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

  // Straight through the portable carrier, the only door these routes have: no host Hono stack, no
  // middleware-set principal, and the identity arriving as the request context the host binds.
  const call = async (caller: Principal, path: string, init?: RequestInit) => {
    // The real request context over the real bindings, so nothing here has to keep a stub shape up to
    // date.
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

  // ── Descriptor routes: what the host reads, not what the frame reads ───────────

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
    // The option's URL is redacted too: the fixture's `?token=query-secret` is exactly the case for it.
    expect(options).toEqual([{ id: adhoc.id, label: 'Login', description: 'POST https://api.example.test/items?token=•••' }])

    const captured = await call(principal('alice'), '/context-capture', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ taskId: 'task-web', optionIds: [adhoc.id] }),
    })
    expect(captured.status).toBe(200)
    // The rows this route read had their ciphertext opened, and the snapshot still carries no
    // credential.
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

// The command palette's two routes (docs/plugins.md § Command kinds
// § HTTP). One reads and one writes, and each has one property that is the point: the search cannot
// carry a secret because it never reads one, and the import never sends.
describe('the palette routes', () => {
  let ctx: TestNodeContext
  let pluginDb: PluginDatabase

  beforeEach(async () => {
    const config = await validatePluginConfig(PACKAGE_ROOT)
    if (!config.ok) throw new Error(config.reason)
    ctx = makeTestNodeContext({ plugin: { name: 'http' }, permissions: config.manifest.permissions.node })
    pluginDb = ctx.storage.open()
    const now = Date.now()
    await ctx.db.insert(schema.workspaces).values({ id: 'workspace-1', name: 'Default', isDefault: true, sort: 0, createdAt: now, updatedAt: now })
    await ctx.db.insert(schema.projects).values([
      {
        id: 'project-web', name: 'web', path: null, workspaceId: 'workspace-1', sort: 0, hidden: false,
        vcs: 'git', defaultBranch: 'main', remoteUrl: null, githubOwner: 'acme', githubName: 'web', githubRepoId: null,
        createdAt: now, updatedAt: now,
      },
      {
        id: 'project-api', name: 'api', path: null, workspaceId: 'workspace-1', sort: 1, hidden: false,
        vcs: 'git', defaultBranch: 'main', remoteUrl: null, githubOwner: 'acme', githubName: 'api', githubRepoId: null,
        createdAt: now, updatedAt: now,
      },
    ])
    await ctx.db.insert(schema.tasks).values([{
      id: 'task-web', title: 'Web task', icon: null, origin: 'local', projectId: 'project-web', branch: 'main', worktreePath: null,
      pullNumber: null, status: 'active', parentId: null, sort: 0, createdAt: now, updatedAt: now, archivedAt: null,
    }])
  })
  afterEach(() => ctx.cleanup())

  const call = async (caller: Principal, path: string, init?: RequestInit) => {
    const context = await makeTestRequestContext({ plugin: 'http', principal: caller, env: ctx.env })
    return createHttpFetch(pluginDb, ctx.core)(new Request(`http://acorn.test${path}`, init), context)
  }
  const save = (login: string, project: string, body: Record<string, unknown>) =>
    call(principal(login), `/projects/${project}/requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...requestBody, ...body }),
    })
  const search = async (login: string, path: string): Promise<{ items: Record<string, string>[] }> =>
    (await call(principal(login), path)).json()
  const importCurl = (login: string, input: string, taskId = 'task-web') =>
    call(principal(login), '/palette/import-curl', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input, taskId }),
    })

  it('answers the routed project’s own rows, and never another owner’s or another project’s', async () => {
    await save('alice', 'project-web', { name: 'Filed', folder: 'auth' })
    await save('alice', 'project-api', { name: 'Elsewhere' })
    await save('bob', 'project-web', { name: 'Bob’s' })

    expect((await search('alice', '/palette/requests?projectId=project-web')).items)
      .toEqual([{ id: expect.any(String), title: 'Filed', subtitle: 'auth', badge: 'POST', icon: 'send' }])
    // Bob's row is not narrowed out afterwards — the query filters on owner and project in SQL.
    expect((await search('bob', '/palette/requests?projectId=project-web')).items.map((i) => i.title)).toEqual(['Bob’s'])
    expect((await search('alice', '/palette/requests?projectId=project-api')).items.map((i) => i.title)).toEqual(['Elsewhere'])
    // No routed project, and a project that does not exist: an empty list rather than everything.
    expect((await search('alice', '/palette/requests')).items).toEqual([])
    expect((await search('alice', '/palette/requests?projectId=nope')).items).toEqual([])
  })

  it('carries no URL, header, body, auth or variable into a row', async () => {
    await save('alice', 'project-web', { name: 'Filed' })
    const body = JSON.stringify(await search('alice', '/palette/requests?projectId=project-web'))
    // The fixture request carries a secret in each of the five encrypted columns.
    for (const secret of ['query-secret', 'header-secret', 'body-secret', 'auth-secret', 'override-secret']) {
      expect(body).not.toContain(secret)
    }
    // Not even the endpoint, which the rail beside it also leaves out.
    expect(body).not.toContain('api.example.test')
  })

  it('leaves a task’s ad-hoc requests out of the project search, exactly as the rail does', async () => {
    await save('alice', 'project-web', { name: 'Ad hoc', taskId: 'task-web' })
    expect((await search('alice', '/palette/requests?projectId=project-web')).items).toEqual([])
  })

  it('imports a curl command into an encrypted row and answers only after it is stored', async () => {
    const res = await importCurl('alice', `curl -X POST 'https://api.example.test/v1/orders' -H 'Authorization: Bearer import-secret' -d '{"a":1}'`)
    expect(res.status).toBe(200)
    const answer = await res.json() as { ok: true; item: { id: string; title: string; badge: string } }
    expect(answer.ok).toBe(true)
    expect(answer.item).toEqual({ id: expect.any(String), title: 'POST orders', badge: 'POST' })
    // The answer itself carries none of what was just parsed.
    expect(JSON.stringify(answer)).not.toContain('import-secret')

    // The row is there by the time the answer arrived, on the task, and encrypted like every other
    // write in this file.
    const [stored] = await pluginDb.select().from(httpRequests)
    expect(stored).toMatchObject({ userId: 'alice', projectId: 'project-web', taskId: 'task-web', method: 'POST', encrypted: true })
    expect(JSON.stringify(stored)).not.toContain('import-secret')

    // And it reads back as the request that was pasted.
    const rows = (await (await call(principal('alice'), '/projects/project-web/requests?taskId=task-web')).json()) as HttpRequest[]
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: answer.item.id,
      method: 'POST',
      url: 'https://api.example.test/v1/orders',
      bodyMode: 'json',
      body: '{"a":1}',
      headers: [{ name: 'Authorization', value: 'Bearer import-secret', enabled: true }],
    })
  })

  // The property the whole command turns on. `fromCurl` reads flags out of a token list and
  // `tokenizeShell` is a quote-and-escape reader, not a shell — so an import can neither run a command
  // nor make a request, whatever the command line says.
  it('never sends and never shells out, whatever the pasted command asks for', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const res = await importCurl('alice', `curl 'https://api.example.test/danger?x=$(rm -rf /)' -H 'X: \`whoami\`'`)
    expect(res.status).toBe(200)
    expect(fetchSpy).not.toHaveBeenCalled()
    // The substitutions were stored as the literal text they are, not run.
    const rows = (await (await call(principal('alice'), '/projects/project-web/requests?taskId=task-web')).json()) as HttpRequest[]
    expect(rows[0].url).toBe('https://api.example.test/danger?x=$(rm -rf /)')
    expect(rows[0].headers).toEqual([{ name: 'X', value: '`whoami`', enabled: true }])
    fetchSpy.mockRestore()
  })

  it('refuses text that is not a curl command with a URL, and stores nothing', async () => {
    for (const input of ['ls -la', 'curl', 'curl -X POST']) {
      const res = await importCurl('alice', input)
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ error: { code: 'bad_request' } })
    }
    expect(await pluginDb.select().from(httpRequests)).toEqual([])
  })

  it('needs a task it can resolve to a project, and refuses an internal token like every route here', async () => {
    expect((await importCurl('alice', 'curl https://x/y', 'nope')).status).toBe(404)
    expect((await call(principal('alice', 'internal'), '/palette/requests?projectId=project-web')).status).toBe(403)
    expect((await importCurl('alice', 'curl https://x/y')).status).toBe(200)
    const agent = await call(principal('alice', 'internal'), '/palette/import-curl', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: 'curl https://x/z', taskId: 'task-web' }),
    })
    expect(agent.status).toBe(403)
    expect(await pluginDb.select().from(httpRequests)).toHaveLength(1)
  })
})
