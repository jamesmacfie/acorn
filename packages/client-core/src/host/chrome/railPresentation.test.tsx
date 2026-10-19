import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NodeRecord } from '@acorn/protocol/broker.ts'
import { createFleetQuery, type FleetResult } from '../../infra/node/fanout'
import { setActiveNode } from '../../infra/node/activeNode'
import type { PluginRailPresentation } from '@acorn/protocol/railPresentation.ts'
import { createPluginRailPresentation } from './railPresentation'

vi.mock('../../infra/node/fanout', () => ({ createFleetQuery: vi.fn() }))

const node: NodeRecord = { nodeId: 'node-a', label: 'Node A', endpoint: 'http://localhost:1', local: true }
const answer: PluginRailPresentation = {
  artwork: { path: '/v1/p/music/art/42', revision: '42', alt: 'Cover' },
  tooltip: { title: 'Song' },
}

let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  setActiveNode(null)
  vi.mocked(createFleetQuery).mockReset()
})

function present(result: () => FleetResult<PluginRailPresentation>) {
  setActiveNode('node-a')
  vi.mocked(createFleetQuery).mockImplementation(() => [result] as never)
  let read!: ReturnType<typeof createPluginRailPresentation>
  dispose = render(() => {
    read = createPluginRailPresentation('music', 'hash-1', 'now', '/v1/p/music/now')
    return null
  }, document.createElement('div'))
  return read
}

describe('a loaded source’s rail presentation', () => {
  it('binds the answer’s artwork to the plugin and Node it was read from, keyed by registration', () => {
    const read = present(() => ({
      rows: [{ nodeId: 'node-a', node, data: answer, freshness: 'live' }],
      unavailable: [],
    }))
    expect(read()).toEqual({
      artwork: { owner: { nodeId: 'node-a', pluginId: 'music' }, image: answer!.artwork },
      tooltip: { title: 'Song' },
    })
    const [key, , , options] = vi.mocked(createFleetQuery).mock.calls[0]!
    expect(key(undefined as never)).toEqual(['plugin-chrome', 'music', 'rail-presentation:now', 'hash-1'])
    expect(options).toEqual({ nodeIds: ['node-a'] })
  })

  it('marks a kept answer stale, says when there was never one, and is static for null', () => {
    const [result, setResult] = createSignal<FleetResult<PluginRailPresentation>>({
      rows: [{ nodeId: 'node-a', node, data: answer, freshness: 'offline' }],
      unavailable: [],
    })
    const read = present(result)
    expect(read()?.freshness).toBe('stale')
    setResult({ rows: [], unavailable: [{ nodeId: 'node-a', label: 'Node A', reason: 'timed out' }] })
    expect(read()).toEqual({ freshness: 'unavailable' })
    setResult({ rows: [], unavailable: [] })
    expect(read()).toBeNull()
    setResult({ rows: [{ nodeId: 'node-a', node, data: null, freshness: 'live' }], unavailable: [] })
    expect(read()).toBeNull()
  })
})
