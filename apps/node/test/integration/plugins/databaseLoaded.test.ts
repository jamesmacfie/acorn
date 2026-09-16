import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DATABASE_QUERY } from '@acorn/plugin-database/contract/query.ts'
import { memoryIdentityStore } from '@acorn/node-core/server/activeIdentity.ts'
import { createCoreServices } from '@acorn/node-core/server/core/index.ts'
import { loadExternalPlugins } from '@acorn/node-core/server/plugins/loader.ts'
import { CapabilityRegistry } from '@acorn/node-core/server/pluginHost/capabilities.ts'
import { initPlugins } from '@acorn/node-core/server/pluginHost/host.ts'
import { makeTestDb, type TestDb } from '@acorn/node-core/testkit/db.ts'

const NODE_APP = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

describe('database as a host-mediated loaded plugin', () => {
  let dataRoot = ''
  let core: TestDb
  let plugins: Awaited<ReturnType<typeof initPlugins>> | null = null

  beforeAll(() => {
    dataRoot = mkdtempSync(join(tmpdir(), 'acorn-database-loaded-'))
    core = makeTestDb()
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
  })
})
