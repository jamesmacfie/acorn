import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import type { BrowserHandoffDescriptor, BrowserHandoffsResponse } from '@acorn/protocol/plugin/handoffs.ts'
import { memoryIdentityStore } from '../activeIdentity'
import { createCoreServices, SecretService } from '../core'
import { makeTestDb, testCoreSeams } from '../../testkit/db'
import { browserHandoffsRoute } from '../routes/browserHandoffs'
import { browserHandoffs, browserPanels, taskAddressRoutes } from './browserHandoffs'
import { CapabilityRegistry } from './capabilities'
import { clearRegistrations, initPlugins, type LoadedPluginBinding } from './host'
import type { NodePlugin } from './types'

const handoff = (pluginId: string, over: Partial<BrowserHandoffDescriptor> = {}): BrowserHandoffDescriptor => ({
  id: 'item',
  label: 'Open in Acorn',
  match: ['https://tracker.example/items/{id}'],
  resolve: `/v1/p/${pluginId}/handoff`,
  ...over,
})

const binding = (
  handoffs: BrowserHandoffDescriptor[],
  taskAddresses?: string,
  browserPanel?: LoadedPluginBinding['browserPanel'],
): LoadedPluginBinding => ({
  permissions: { core: [], capabilities: [], secrets: false, exec: false, net: [], sockets: false },
  storage: {
    open: () => {
      throw new Error('test storage is not configured')
    },
  },
  browserHandoffs: handoffs,
  taskAddresses,
  browserPanel,
})

describe('browser handoff declarations', () => {
  let shared: ReturnType<typeof makeTestDb> | null = null
  const coreDb = () => (shared ??= makeTestDb()).db
  afterAll(() => shared?.cleanup())
  const names: string[] = []
  afterEach(() => {
    for (const name of names.splice(0)) clearRegistrations(name)
    vi.restoreAllMocks()
  })

  const host = (
    plugins: NodePlugin[],
    options: { loaded?: Record<string, LoadedPluginBinding>; disabled?: string[] } = {},
  ) => {
    names.push(...plugins.map((plugin) => plugin.name))
    return initPlugins(plugins, {
      capabilities: new CapabilityRegistry(),
      core: createCoreServices({
        secrets: new SecretService('a'.repeat(64)),
        db: coreDb(),
        activeIdentity: memoryIdentityStore(),
        ...testCoreSeams(),
      }),
      dataDir: '',
      disabled: options.disabled,
      loaded: new Map(Object.entries(options.loaded ?? {})),
    })
  }

  it('advertises a compiled and a loaded declaration in the same shape', async () => {
    await host(
      [
        { name: 'tracker', browserHandoffs: [handoff('tracker')], init: () => {} },
        { name: 'board', init: () => {} },
      ],
      {
        loaded: {
          board: binding([handoff('board', { id: 'card', anchors: ['.card > header'] })], '/v1/p/board/addresses'),
        },
      },
    )
    const response = (await (await browserHandoffsRoute.request('/')).json()) as BrowserHandoffsResponse
    expect(response.handoffs).toEqual([
      { pluginId: 'board', ...handoff('board', { id: 'card', anchors: ['.card > header'] }) },
      { pluginId: 'tracker', ...handoff('tracker'), anchors: [] },
    ])
    expect(response.taskAddresses).toEqual([{ pluginId: 'board', route: '/v1/p/board/addresses' }])
  })

  it('advertises the logo only of a plugin that declares a handoff or a panel', async () => {
    const icon = { d: 'M2 2h20v20H2z', color: '#5e6ad2' }
    await host(
      [
        { name: 'board', init: () => {} },
        { name: 'quiet', init: () => {} },
      ],
      {
        loaded: { board: { ...binding([handoff('board')]), icon }, quiet: { ...binding([]), icon } },
      },
    )
    const response = (await (await browserHandoffsRoute.request('/')).json()) as BrowserHandoffsResponse
    expect(response.icons).toEqual([{ pluginId: 'board', ...icon }])
  })

  it('advertises a declared panel, and drops it with the declaration', async () => {
    const panel = { label: 'Board', pane: 'board', route: '/v1/p/board/browser-panel' }
    const result = await host([{ name: 'board', init: () => {} }], {
      loaded: { board: binding([], undefined, panel) },
    })
    const response = (await (await browserHandoffsRoute.request('/')).json()) as BrowserHandoffsResponse
    expect(response.panels).toEqual([{ pluginId: 'board', ...panel }])
    await result.reload('board', { plugin: { name: 'board', init: () => {} }, binding: binding([]) })
    expect(browserPanels()).toEqual([])
    await result.dispose()
  })

  it("advertises a built-in's panel, and ignores the field on a loaded plugin", async () => {
    const panel = { label: 'Tracker', pane: 'tracker', route: '/v1/p/tracker/browser-panel' }
    await host(
      [
        { name: 'tracker', browserPanel: panel, init: () => {} },
        { name: 'board', browserPanel: { label: 'Board', route: '/v1/p/board/compiled' }, init: () => {} },
      ],
      { loaded: { board: binding([], undefined, { label: 'Board', route: '/v1/p/board/manifest' }) } },
    )
    const response = (await (await browserHandoffsRoute.request('/')).json()) as BrowserHandoffsResponse
    expect(response.panels).toEqual([
      { pluginId: 'board', label: 'Board', route: '/v1/p/board/manifest' },
      { pluginId: 'tracker', ...panel },
    ])
  })

  it("refuses a built-in panel that reads through another plugin's routes", async () => {
    await expect(
      host([{ name: 'tracker', browserPanel: { label: 'Tracker', route: '/v1/p/agents/x' }, init: () => {} }]),
    ).rejects.toThrow(/outside \/v1\/p\/tracker\//)
    await expect(
      host([{ name: 'tracker', browserPanel: { label: '', route: '/v1/p/tracker/x' }, init: () => {} }]),
    ).rejects.toThrow()
  })

  it('advertises nothing for a disabled plugin, or one whose init failed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await host(
      [
        { name: 'off', browserHandoffs: [handoff('off')], init: () => {} },
        {
          name: 'broken',
          init: () => {
            throw new Error('boom')
          },
        },
      ],
      { disabled: ['off'], loaded: { broken: binding([handoff('broken')], '/v1/p/broken/addresses') } },
    )
    expect(browserHandoffs()).toEqual([])
    expect(taskAddressRoutes()).toEqual([])
  })

  it('swaps a reloaded plugin to the declarations of its new binding', async () => {
    const result = await host([{ name: 'board', init: () => {} }], { loaded: { board: binding([handoff('board')]) } })
    expect(browserHandoffs().map((entry) => entry.id)).toEqual(['item'])
    await result.reload('board', {
      plugin: { name: 'board', init: () => {} },
      binding: binding([handoff('board', { id: 'card' })]),
    })
    expect(browserHandoffs().map((entry) => entry.id)).toEqual(['card'])
    await result.dispose()
  })

  it("refuses a compiled declaration that resolves through another plugin's routes", async () => {
    await expect(
      host([{ name: 'tracker', browserHandoffs: [handoff('tracker', { resolve: '/v1/p/agents/x' })], init: () => {} }]),
    ).rejects.toThrow(/outside \/v1\/p\/tracker\//)
    await expect(
      host([{ name: 'tracker', browserHandoffs: [handoff('tracker'), handoff('tracker')], init: () => {} }]),
    ).rejects.toThrow(/duplicate browser handoff id 'item'/)
    await expect(
      host([
        {
          name: 'tracker',
          browserHandoffs: [handoff('tracker', { match: ['http://x.example/{id}'] })],
          init: () => {},
        },
      ]),
    ).rejects.toThrow(/https/)
  })
})
