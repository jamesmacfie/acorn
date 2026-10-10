import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { memoryIdentityStore } from '@acorn/node-core/server/activeIdentity.ts'
import { createCoreServices } from '@acorn/node-core/server/core/index.ts'
import { createApp } from '@acorn/node-core/server/index.ts'
import { CapabilityRegistry } from '@acorn/node-core/server/pluginHost/capabilities.ts'
import { initPlugins, type LoadedPluginBinding } from '@acorn/node-core/server/pluginHost/host.ts'
import { loadExternalPlugins, pluginDir, type LoadedPlugin } from '@acorn/node-core/server/plugins'
import { makeTestDb, testEnv, type TestDb } from '@acorn/node-core/testkit'
import type { Env } from '@acorn/node-core/server/bindings.ts'

// The loaded file-language provider from docs/editor/document-surface.md § Language smarts, installed
// the way a person installs a folder. Its node.js has no imports, so it can't lean on this repository.
const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '../../__fixtures__/json-diagnostics')

const binding = (entry: LoadedPlugin): LoadedPluginBinding => ({
  permissions: entry.manifest.permissions.node,
  events: entry.manifest.permissions.events,
  emits: entry.manifest.emits,
  storage: entry.storage,
  agentTools: entry.manifest.contributions.agentTools,
  contextSections: entry.manifest.contributions.contextSections,
  dir: entry.dir,
})

describe('a loaded JSON diagnostics provider', () => {
  let dataRoot = ''
  let core: TestDb
  let env: Env
  let loaded: LoadedPlugin
  let running: Awaited<ReturnType<typeof initPlugins>> | null = null

  // A paired device, which is who the host's editor asks as.
  const check = async (text: string, revision = 3) => createApp().fetch(new Request('http://127.0.0.1/v1/p/json-diagnostics/check', {
    method: 'POST',
    headers: { authorization: 'Bearer paired-device-token', 'content-type': 'application/json' },
    body: JSON.stringify({ text, revision }),
  }), env)

  beforeAll(async () => {
    dataRoot = mkdtempSync(join(tmpdir(), 'acorn-document-services-'))
    cpSync(FIXTURE, pluginDir(dataRoot, 'json-diagnostics'), { recursive: true })
    core = makeTestDb()
    env = testEnv({
      DB: core.db,
      DATA_DIR: dataRoot,
      ACTIVE_IDENTITY: { get: () => 'james', set: () => {}, clear: () => {} },
      DEVICES: {
        authenticate: async (candidate: string) => candidate === 'paired-device-token' ? { deviceId: 'device-1' } : null,
      } as Env['DEVICES'],
    })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const result = await loadExternalPlugins(dataRoot, { builtins: [] })
      expect(result.failures).toEqual([])
      loaded = result.loaded[0]!
      running = await initPlugins([loaded.plugin], {
        capabilities: new CapabilityRegistry(),
        core: createCoreServices({ db: core.db, secrets: core.secrets, activeIdentity: memoryIdentityStore('james') }),
        dataDir: dataRoot,
        env,
        loaded: new Map([[loaded.manifest.id, binding(loaded)]]),
      })
    } finally {
      error.mockRestore()
    }
  })

  afterAll(async () => {
    await running?.dispose()
    core.cleanup()
    rmSync(dataRoot, { recursive: true, force: true })
  })

  it('declares JSON diagnostics on its own route', () => {
    expect(loaded.manifest.contributions.documentServices).toEqual([
      { id: 'json-syntax', label: 'JSON syntax', languageId: 'json', diagnostics: { route: '/v1/p/json-diagnostics/check' } },
    ])
  })

  it('marks a syntax error at a one-based position, echoes the revision, and clears once the JSON is fixed', async () => {
    const broken = await check('{\n  "a": 1,\n}', 5)
    expect(broken.status).toBe(200)
    const answer = await broken.json() as { revision: number; items: { range: { start: { line: number; column: number } }; severity: string; source: string }[] }
    expect(answer.revision).toBe(5)
    expect(answer.items).toHaveLength(1)
    expect(answer.items[0]).toMatchObject({ severity: 'error', source: 'JSON.parse', range: { start: { line: 3 } } })

    expect(await (await check('{\n  "a": 1\n}', 6)).json()).toEqual({ revision: 6, items: [] })
    // V8 leaves the position out of an "Unexpected token" message. The mark still lands on the token.
    const token = await (await check('{\n  "items": [1, 2,]\n}', 7)).json() as typeof answer
    expect(token.items[0]!.range).toEqual({ start: { line: 2, column: 18 }, end: { line: 2, column: 19 } })
  })
})
