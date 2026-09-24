import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { loadExternalPlugins } from '@acorn/node-core/server/plugins'
import type { ModelProviderAdapter } from '@acorn/node-core/server/modelProviders'

const NODE_APP = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
let dataRoot = ''
let dispose: (() => Promise<void> | void) | undefined

beforeAll(() => {
  dataRoot = mkdtempSync(join(tmpdir(), 'acorn-model-providers-'))
  execFileSync(process.execPath, [join(NODE_APP, 'scripts/build-plugin.mjs'), 'model-providers'], {
    cwd: NODE_APP,
    env: { ...process.env, ACORN_DATA_DIR: dataRoot },
    stdio: 'pipe',
  })
}, 120_000)

afterAll(async () => {
  await dispose?.()
  rmSync(dataRoot, { recursive: true, force: true })
})

it('loads and registers both model adapters through the worker context', async () => {
  const { loaded, failures } = await loadExternalPlugins(dataRoot, { builtins: [] })
  expect(failures).toEqual([])
  expect(loaded.map((entry) => entry.manifest.id)).toEqual(['model-providers'])
  const plugin = loaded[0]!.plugin
  dispose = () => plugin.dispose?.()
  const connections: string[] = []
  const adapters: ModelProviderAdapter[] = []
  await plugin.init({
    routes: {}, schedules: {}, events: {},
    providers: {
      connection: (provider: { id: string }) => { connections.push(provider.id) },
      model: (adapter: ModelProviderAdapter) => { adapters.push(adapter) },
    },
  } as never)
  expect(connections.sort()).toEqual(['anthropic', 'openai'])
  expect(adapters.map((adapter) => adapter.providerId).sort()).toEqual(['anthropic', 'openai'])
  expect(adapters.every((adapter) => typeof adapter.generateText === 'function')).toBe(true)
})
