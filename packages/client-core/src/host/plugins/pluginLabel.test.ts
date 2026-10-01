import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NodePluginRow } from '@acorn/protocol/api.ts'
import type { PluginDistributionSnapshot } from './distributionModel'

const state = vi.hoisted(() => ({ snapshot: null as unknown, active: null as string | null }))
vi.mock('./distribution', () => ({ distribution: () => state.snapshot }))
vi.mock('../../infra/node/activeNode', () => ({ activeNodeId: () => state.active }))

const { pluginLabel } = await import('./pluginLabel')

const row = (name: string, label?: string): NodePluginRow =>
  ({ name, ...(label === undefined ? {} : { label }), required: false, disabled: false, running: true, state: 'active' })

const serve = (byNode: Record<string, NodePluginRow[]>, device: NodePluginRow[] = []): void => {
  state.snapshot = {
    byNode: new Map(Object.entries(byNode).map(([nodeId, rows]) => [nodeId, { nodeId, rows }])),
    devicePlugins: device.map((entry) => ({ row: entry })),
  } as unknown as PluginDistributionSnapshot
}

afterEach(() => {
  state.active = null
})

describe('pluginLabel', () => {
  it('reads the label off a row, and falls back to the id', () => {
    expect(pluginLabel(row('github', 'GitHub'))).toBe('GitHub')
    expect(pluginLabel(row('github'))).toBe('github')
    expect(pluginLabel(row('github', '  '))).toBe('github')
  })

  it("prefers the active node's roster to another node's", () => {
    state.active = 'b'
    serve({ a: [row('http', 'HTTP')], b: [row('http', 'API requests')] })
    expect(pluginLabel('http')).toBe('API requests')
  })

  it('takes a label from any node when the active one sends none', () => {
    state.active = 'old'
    serve({ old: [row('linear')], new: [row('linear', 'Linear')] })
    expect(pluginLabel('linear')).toBe('Linear')
  })

  it('names a plugin this device holds from its own manifest', () => {
    serve({ a: [row('board', 'Board on the node')] }, [row('board', 'Board')])
    expect(pluginLabel('board')).toBe('Board')
  })

  it('gives back the id for a plugin nobody lists', () => {
    serve({ a: [row('linear', 'Linear')] })
    expect(pluginLabel('gone')).toBe('gone')
  })
})
