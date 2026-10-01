import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DATABASE_QUERY } from '@acorn/plugin-database/contract/query.ts'
import { memoryIdentityStore } from '@acorn/node-core/server/activeIdentity.ts'
import { createCoreServices } from '@acorn/node-core/server/core/index.ts'
import { loadExternalPlugins } from '@acorn/node-core/server/plugins'
import { CapabilityRegistry } from '@acorn/node-core/server/pluginHost/capabilities.ts'
import { initPlugins } from '@acorn/node-core/server/pluginHost/host.ts'
import { pluginRouteContributions } from '@acorn/node-core/server/routes/registry.ts'
import { makeTestDb, type TestDb } from '@acorn/node-core/testkit'
import { schema } from '@acorn/node-core/server/db/index.ts'

const NODE_APP = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

describe('database as a host-mediated loaded plugin', () => {
  let dataRoot = ''
  let core: TestDb
  let plugins: Awaited<ReturnType<typeof initPlugins>> | null = null

  beforeAll(async () => {
    dataRoot = mkdtempSync(join(tmpdir(), 'acorn-database-loaded-'))
    core = makeTestDb()
    await core.db.insert(schema.workspaces).values({ id: 'workspace-one', name: 'Fixture', isDefault: true, sort: 0, createdAt: 0, updatedAt: 0 })
    await core.db.insert(schema.projects).values({ id: 'project-one', workspaceId: 'workspace-one', name: 'Fixture', path: null, sort: 0, hidden: false, vcs: 'git', defaultBranch: 'main', remoteUrl: null, githubOwner: null, githubName: null, githubRepoId: null, createdAt: 0, updatedAt: 0 })
    await core.db.insert(schema.tasks).values({ id: 'task-one', title: 'Fixture', origin: 'local', projectId: 'project-one', branch: 'main', worktreePath: null, pullNumber: null, status: 'active', parentId: null, sort: 0, createdAt: 0, updatedAt: 0, archivedAt: null })
    execFileSync(process.execPath, [join(NODE_APP, 'scripts/build-plugin.mjs'), 'database'], {
      cwd: NODE_APP,
      env: { ...process.env, ACORN_DATA_DIR: dataRoot },
      stdio: 'pipe',
    })
  }, 120_000)

  afterAll(async () => {
    await plugins?.dispose()
    core.cleanup()
    rmSync(dataRoot, { recursive: true, force: true })
  })

  it('loads without a driver or raw-socket builtin in its bundle', async () => {
    const bundle = readFileSync(join(dataRoot, 'plugins/database/dist/node.js'), 'utf8')
    expect(bundle).not.toMatch(/node:(?:module|net|tls)/)
    expect(bundle).not.toContain("from 'pg'")

    const { loaded, failures } = await loadExternalPlugins(dataRoot, { builtins: [] })
    expect(failures).toEqual([])
    expect(loaded).toHaveLength(1)
    expect(loaded[0].manifest.permissions.node).toMatchObject({
      core: expect.arrayContaining(['data:query', 'data:write']),
      exec: false,
      net: [],
    })
    expect(loaded[0].manifest.permissions.node.env).toBeUndefined()
    expect(loaded[0].manifest.permissions.node).toMatchObject({ secrets: false, exec: false, net: [] })
    expect(loaded[0].manifest.contributions.cliCommands).toMatchObject([
      { name: 'query', risk: 'read', capability: 'data:query', route: { method: 'POST', path: '/cli/query' } },
    ])

    const capabilities = new CapabilityRegistry()
    plugins = await initPlugins([loaded[0].plugin], {
      capabilities,
      core: createCoreServices({
        secrets: core.secrets,
        db: core.db,
        activeIdentity: memoryIdentityStore('owner-1'),
      }),
      dataDir: dataRoot,
      loaded: new Map([['database', {
        permissions: loaded[0].manifest.permissions.node,
        storage: loaded[0].storage,
      }]]),
    })

    expect(plugins.failed).toEqual([])
    expect(plugins.enabled).toEqual(['database'])
    expect(capabilities.get(DATABASE_QUERY)).toBeDefined()
    const route = pluginRouteContributions().find((entry) => entry.plugin === 'database' && entry.fetch)
    expect(route?.fetch).toBeDefined()
    const response = await route!.fetch!(new Request('http://database.test/cli/query', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId: 'node-a', taskId: 'task-one', sql: 'delete from users' }),
    }), {
      userId: 'owner-1', principal: { kind: 'device', userId: 'owner-1', deviceId: 'device-one' },
      providers: { connections: async () => [], withConnections: async () => [],
        resource: async () => { throw new Error('no provider') }, items: () => { throw new Error('no provider') } },
    })
    expect(response.status).toBe(400)
  })
})
