import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { memoryIdentityStore } from '@acorn/node-core/main/activeIdentity.ts'
import { createCoreServices, SecretService } from '@acorn/node-core/main/core/index.ts'
import { reconcileBundledPlugins } from '@acorn/node-core/main/bundledPlugins.ts'
import { loadExternalPlugins } from '@acorn/node-core/main/pluginLoader.ts'
import { pluginDbPath } from '@acorn/node-core/main/pluginStorage.ts'
import { pluginDir } from '@acorn/node-core/main/pluginInstaller.ts'
import { CapabilityRegistry } from '@acorn/node-core/server/plugin/capabilities.ts'
import { initPlugins } from '@acorn/node-core/server/plugin/host.ts'
import { pluginRouteContributions } from '@acorn/node-core/server/routeRegistry.ts'
import { openSqlite } from '@acorn/node-core/main/sqlite.ts'
import { makeTestDb, type TestDb } from '@acorn/node-core/testkit/db.ts'
import { schema } from '@acorn/node-core/server/db/index.ts'

// http is the first plugin to ship loaded with tables of its own, so this is the suite the storage
// path never had: a manifest-declared migrations directory staged inside the package, a host-opened
// database bound to the manifest id, and a schema change arriving through the installer against a
// database that already has rows in it (docs/third-party/README.md § "http has moved").
//
// Not folded into pluginLoader.test.ts. That suite is about the load path being the same for a loaded
// plugin as for a built-in; this one is about what happens on the second boot, which is a different
// question and needs a data root that survives between two loads.
const NODE_APP = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

const secrets = () => new SecretService('0'.repeat(64))

describe('http as a loaded plugin with its own tables', () => {
  let dataRoot = ''
  let core: TestDb
  let running: Awaited<ReturnType<typeof initPlugins>> | null = null

  const coreServices = () =>
    createCoreServices({ secrets: secrets(), db: core.db, activeIdentity: memoryIdentityStore() })

  // One load-and-init cycle, standing in for a boot. Returns the route handler the plugin registered, so
  // a caller can drive real requests through the same door the host uses.
  const boot = async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { loaded, failures } = await loadExternalPlugins(dataRoot, { builtins: [] })
      const entry = loaded.find((row) => row.manifest.id === 'http')
      const plugins = entry
        ? await initPlugins([entry.plugin], {
          capabilities: new CapabilityRegistry(),
          core: coreServices(),
          dataDir: dataRoot,
          loaded: new Map([['http', { permissions: entry.manifest.permissions.node, storage: entry.storage }]]),
        })
        : null
      running = plugins
      const route = pluginRouteContributions().find((row) => row.plugin === 'http')
      return { failures, plugins, route, manifest: entry?.manifest }
    } finally {
      warn.mockRestore()
    }
  }

  // The plugin's own SQLite, read directly. Read-only and closed immediately: the plugin holds the same
  // file open in WAL mode, and this must not be the thing that changes its schema.
  const columnsOf = (table: string): string[] => {
    const db = openSqlite(pluginDbPath(dataRoot, 'http'), { readonly: true })
    try {
      return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((row) => row.name)
    } finally {
      db.close()
    }
  }

  const call = (route: { fetch?: unknown }, path: string, init?: RequestInit) =>
    (route.fetch as (request: Request, context: unknown) => Promise<Response>)(
      new Request(`http://http.test${path}`, init),
      {
        userId: 'owner-1',
        principal: { kind: 'device', userId: 'owner-1', deviceId: 'device-1' },
        providers: {
          connections: async () => [],
          resource: async () => { throw new Error('http has no provider') },
          withConnections: async () => [],
          items: () => { throw new Error('http has no provider') },
        },
      },
    )

  beforeAll(() => {
    dataRoot = mkdtempSync(join(tmpdir(), 'acorn-http-loaded-'))
    core = makeTestDb()
    const now = Date.now()
    core.db.insert(schema.workspaces).values({ id: 'ws-1', name: 'Default', isDefault: true, sort: 0, createdAt: now, updatedAt: now }).run?.()
    execFileSync(process.execPath, [join(NODE_APP, 'scripts/build-plugin.mjs'), 'http'], {
      cwd: NODE_APP,
      env: { ...process.env, ACORN_DATA_DIR: dataRoot },
      stdio: 'pipe',
    })
  }, 180_000)

  afterAll(async () => {
    await running?.dispose()
    core.cleanup()
    rmSync(dataRoot, { recursive: true, force: true })
  })

  it('stages its migration chain inside the package and declares it', () => {
    const dir = pluginDir(dataRoot, 'http')
    const manifest = JSON.parse(readFileSync(join(dir, 'acorn-plugin.json'), 'utf8')) as { migrations?: string }
    // The whole point of the builder change: without a staged chain the manifest declaration would name a
    // directory the loader confines and then fails to find, which is a plugin that dies on first open.
    expect(manifest.migrations).toBe('./migrations')
    expect(existsSync(join(dir, 'migrations/meta/_journal.json'))).toBe(true)
  })

  it('opens a database bound to the manifest id, and answers over the portable carrier', async () => {
    const { failures, plugins, route } = await boot()
    expect(failures).toEqual([])
    expect(plugins?.failed).toEqual([])
    expect(plugins?.enabled).toEqual(['http'])
    // The filename is the manifest id, host-bound. It has to be this exact path or an upgrade from the
    // compiled build orphans every saved request on the machine.
    expect(existsSync(pluginDbPath(dataRoot, 'http'))).toBe(true)
    expect(route?.fetch).toEqual(expect.any(Function))
    expect(route?.router).toBeUndefined()

    // A real request through the real door. 404 rather than 500: the project does not exist, which is the
    // route's own answer and proves the request context, the storage handle and core all arrived.
    const missing = await call(route!, '/projects/nope/requests')
    expect(missing.status).toBe(404)
  })

  it('applies a migration that arrives through an update, and keeps the rows', async () => {
    const now = Date.now()
    await core.db.insert(schema.projects).values({
      id: 'proj-1', name: 'web', path: null, workspaceId: 'ws-1', sort: 0, hidden: false,
      vcs: 'git', defaultBranch: 'main', remoteUrl: null, githubOwner: null, githubName: null, githubRepoId: null,
      createdAt: now, updatedAt: now,
    })

    const { route } = await boot()
    const created = await call(route!, '/projects/proj-1/requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Health', method: 'GET', url: 'https://api.example.test/health' }),
    })
    expect(created.status).toBe(201)
    const row = (await created.json()) as { id: string }
    await running?.dispose()
    running = null

    // Stands in for the app's resources holding a newer package: same id, one version up, with a
    // second migration appended to the chain. This is what an installer-driven update looks like on
    // disk.
    const resources = mkdtempSync(join(tmpdir(), 'acorn-http-resources-'))
    try {
      const built = pluginDir(dataRoot, 'http')
      const staged = join(resources, 'http')
      cpSync(built, staged, { recursive: true })
      rmSync(join(staged, '.acorn-dev-build'), { force: true })
      const manifest = JSON.parse(readFileSync(join(staged, 'acorn-plugin.json'), 'utf8')) as { version: string }
      writeFileSync(join(staged, 'acorn-plugin.json'), JSON.stringify({ ...manifest, version: `${manifest.version}-next` }))

      const journalPath = join(staged, 'migrations/meta/_journal.json')
      const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[] }
      writeFileSync(join(staged, 'migrations/0001_added_column.sql'), 'ALTER TABLE `http_requests` ADD `note` text;')
      journal.entries.push({ idx: 1, version: '6', when: now, tag: '0001_added_column', breakpoints: true })
      writeFileSync(journalPath, JSON.stringify(journal))

      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        expect(reconcileBundledPlugins(dataRoot, resources)).toMatchObject({ updated: ['http'] })
      } finally {
        warn.mockRestore()
      }

      // Next boot: the chain applies against a populated database.
      const second = await boot()
      expect(second.failures).toEqual([])
      expect(second.plugins?.failed).toEqual([])
      const kept = await call(second.route!, '/projects/proj-1/requests')
      expect(((await kept.json()) as { id: string }[]).map((entry) => entry.id)).toEqual([row.id])
      // …and the column really is there. Read straight off the file, because the routes above would answer
      // identically whether or not the chain ran, which is exactly the failure this test exists to catch.
      expect(columnsOf('http_requests')).toContain('note')
    } finally {
      rmSync(resources, { recursive: true, force: true })
    }
  }, 60_000)

  it('fails contained when a chain is broken, and leaves the node bootable', async () => {
    await running?.dispose()
    running = null
    const dir = pluginDir(dataRoot, 'http')
    const journalPath = join(dir, 'migrations/meta/_journal.json')
    const goodJournal = readFileSync(journalPath, 'utf8')
    const journal = JSON.parse(goodJournal) as { entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[] }
    writeFileSync(join(dir, 'migrations/0002_broken.sql'), 'CREATE TABLE `http_requests` (`id` text);')
    journal.entries.push({ idx: 2, version: '6', when: Date.now(), tag: '0002_broken', breakpoints: true })
    writeFileSync(journalPath, JSON.stringify(journal))

    try {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        const { plugins } = await boot()
        // The plugin is reported failed and its registrations rolled back; the host still returned, which
        // is the difference between "this plugin is broken" and "this node will not start".
        expect(plugins?.failed.map((row) => row.name)).toEqual(['http'])
        expect(plugins?.enabled).toEqual([])
        expect(pluginRouteContributions().some((row) => row.plugin === 'http')).toBe(false)
      } finally {
        error.mockRestore()
      }
    } finally {
      rmSync(join(dir, 'migrations/0002_broken.sql'), { force: true })
      writeFileSync(journalPath, goodJournal)
    }
  })

  it('keeps the database file when the package goes away, and picks it back up', async () => {
    await running?.dispose()
    running = null
    const dir = pluginDir(dataRoot, 'http')
    const parked = mkdtempSync(join(tmpdir(), 'acorn-http-parked-'))
    try {
      // Uninstall without purge: the package leaves, the data stays. Reinstalling has to find the
      // same rows, which is the promise the manifest-bound filename makes.
      cpSync(dir, join(parked, 'http'), { recursive: true })
      rmSync(dir, { recursive: true, force: true })
      expect(existsSync(pluginDbPath(dataRoot, 'http'))).toBe(true)
      const gone = await boot()
      expect(gone.route).toBeUndefined()

      mkdirSync(dir, { recursive: true })
      cpSync(join(parked, 'http'), dir, { recursive: true })
      const back = await boot()
      expect(back.plugins?.enabled).toEqual(['http'])
      const rows = await call(back.route!, '/projects/proj-1/requests')
      expect(((await rows.json()) as unknown[]).length).toBe(1)
    } finally {
      rmSync(parked, { recursive: true, force: true })
    }
  })
})
