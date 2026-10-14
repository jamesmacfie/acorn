import { createComponent } from 'solid-js'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { render } from 'solid-js/web'
import { afterEach, expect, it, vi } from 'vitest'
import { PLUGIN_API_MAJOR, type NodePluginRow } from '@acorn/protocol/api.ts'
import { registerQueryOwner } from '../../infra/node/queryOwnership'
import type { PluginFrameProps } from './frameServices'

// A host that has no iframe supplies what a `frame` region draws instead. Without the seam the shared
// pass mounted the DOM's iframe on every host, and the terminal's reconciler threw on it.

const iframes: string[] = []
vi.mock('../../infra/node/hostCapabilities', () => ({ hasHostCapability: () => true }))
vi.mock('./PluginFrame', () => ({
  default: (props: PluginFrameProps) => {
    iframes.push(props.binding.pluginId)
    return <iframe />
  },
}))
const { paneRegistry } = await import('../registries/panes/panes')
const { _resetPluginDistribution, _seedPluginDistribution } = await import('../plugins/distribution')
const { setActiveNode } = await import('../../infra/node/activeNode')
const { syncFrameContributions, _resetFrameContributions } = await import('./register')
const { setFrameSurface, _resetFrameSurface } = await import('./frameSurface')

const HASH = 'a'.repeat(64)

const row = {
  name: 'machine-stats',
  required: false,
  disabled: false,
  running: true,
  state: 'active',
  installed: {
    version: '1.0.0',
    baseline: 'acorn-1',
    apiVersion: PLUGIN_API_MAJOR,
    permissions: {
      api: [],
      events: [],
      node: { core: [], capabilities: [], secrets: false, exec: false, net: [], sockets: false },
    },
    client: { hash: HASH, bytes: 12 },
    contributions: {
      frames: [
        {
          target: 'pane',
          id: 'stats',
          label: 'Machine',
          glyph: 'activity',
          order: 400,
          scope: 'task',
          formFactor: ['desktop'],
          claimsKeys: [],
          layout: 'single',
          regions: { body: 'frame' },
        },
      ],
    },
  },
} as unknown as NodePluginRow

afterEach(() => {
  _resetFrameSurface()
  _resetFrameContributions()
  _resetPluginDistribution()
  setActiveNode(null)
})

it('draws the host-supplied stand-in for a frame region instead of the iframe', async () => {
  const standIns: string[] = []
  setFrameSurface((props) => {
    standIns.push(props.binding.pluginId)
    return <span>stand-in</span>
  })
  setActiveNode('node-a')
  _seedPluginDistribution([['node-a', [row]]], [`machine-stats ${HASH}`])
  syncFrameContributions()

  const pane = paneRegistry.entries().find((entry) => entry.id === 'stats')!
  const qc = new QueryClient()
  registerQueryOwner(qc, null)
  const dispose = render(
    () =>
      createComponent(QueryClientProvider, {
        client: qc,
        get children() {
          return pane.component({ task: { id: 'task-1', projectId: 'p-1', links: [] } } as never)
        },
      }),
    document.createElement('div'),
  )

  // The layout and the region are both lazy, so the stand-in arrives a few microtasks later.
  await vi.waitFor(() => expect(standIns).toEqual(['machine-stats']))
  expect(iframes).toEqual([])
  dispose()
  qc.clear()
})
