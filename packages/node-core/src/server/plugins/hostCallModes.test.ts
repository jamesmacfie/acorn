import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import { pluginManifestSchema } from './manifest'
import { hostFunctionMode } from './hostCallModes'
import { isolateNodePlugin } from './isolation'
import type { CompiledNodePluginContext } from '../pluginHost/types'
import type { ModelProviderAdapter } from '../modelProviders/types'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

it('classifies init and ready public paths and refuses an unclassified host method', () => {
  expect(hostFunctionMode('plugin.init.args[0].routes.fetch')).toBe('sync')
  expect(hostFunctionMode('plugin.ready.args[0].core.tasks.load')).toBe('async')
  expect(hostFunctionMode('plugin.init.args[0].core.proc.brokerEnv')).toBe('sync')
  expect(hostFunctionMode('plugin.init.args[0].providers.model')).toBe('sync')
  expect(() => hostFunctionMode('plugin.init.args[0].core.tasks.newMethod')).toThrow('Unclassified host context method')
  expect(() => hostFunctionMode('plugin.init.args[0].newGroup.method')).toThrow('Unclassified host context method')
})

it('keeps loaded worker calls in their declared modes across registration and disposal', async () => {
  const root = mkdtempSync(join(tmpdir(), 'acorn-host-modes-'))
  roots.push(root)
  const fixture = fileURLToPath(new URL('./__fixtures__/hostModesPlugin.mjs', import.meta.url))
  const parsed = pluginManifestSchema.parse({ id: 'host-modes', name: 'Host modes', version: '1', baseline: 'acorn-1', apiVersion: '1' })
  let listener: ((frame: unknown) => unknown) | undefined
  let modelAdapter: ModelProviderAdapter | undefined
  const disposed = vi.fn()
  const registered = vi.fn()
  const ctx = {
    tools: { register: registered },
    contextSections: { register: registered },
    nodeActions: { register: registered },
    harnesses: { register: registered },
    routes: { fetch: registered, register: registered },
    schedules: { register: registered, registerTarget: registered },
    dataSources: { register: registered },
    taskChecks: { register: registered },
    runs: { register: registered },
    audit: { declare: registered },
    extensionPoints: { declare: registered },
    hooks: { declare: registered },
    providers: {
      connection: registered,
      model: (adapter: ModelProviderAdapter) => { modelAdapter = adapter },
    },
    capabilities: {
      provide: () => ({ dispose: disposed }),
      get: () => ({ read: async () => 'capability' }),
    },
    events: {
      on: (_: string, callback: (frame: unknown) => unknown) => {
        listener = callback
        return { dispose: disposed }
      },
      status: registered,
      channel: registered,
      streams: registered,
    },
    telemetry: { event: registered, measure: (_: string, run: () => unknown) => run() },
    log: { info: registered },
    core: {
      identity: { active: () => 'owner' },
      fs: { isValidRepoIdent: () => true },
      proc: { brokerEnv: () => ({}) },
      telemetry: { onBatch: () => ({ dispose: disposed }) },
      tasks: { load: async () => undefined },
    },
  } as unknown as CompiledNodePluginContext
  const plugin = await isolateNodePlugin({
    entrypoint: fixture,
    pluginDir: dirname(fixture),
    plugin: 'host-modes',
    dataRoot: root,
    migrationsFolder: null,
    permissions: parsed.permissions.node,
  })
  try {
    await plugin.init(ctx)
    expect(registered).toHaveBeenCalled()
    expect(disposed).toHaveBeenCalledTimes(3)
    expect(await listener?.({ event: 'tasks:changed' })).toBe('heard')
    expect(await modelAdapter?.generateText({
      secret: 'credential', config: {},
      input: { system: '', prompt: 'hello', maxOutputTokens: 10 },
    })).toEqual({ text: 'credential:hello', modelId: 'probe-model' })
  } finally {
    await plugin.dispose?.()
  }
})
