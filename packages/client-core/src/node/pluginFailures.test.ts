import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NodePluginRow, NodePluginState } from '@acorn/protocol/api.ts'

const mocks = vi.hoisted(() => ({ readJson: vi.fn() }))
// The roster is the whole input, so stub the transport and nothing else.
vi.mock('../apiClient', () => ({ readJson: mocks.readJson }))

import { pluginFailureAttention } from './pluginFailures'
import { clearSurfaceFailures, recordSurfaceFailure } from '../plugins/surfaceFailures'

const row = (over: Partial<NodePluginRow>): NodePluginRow =>
  ({ name: 'ntfy', required: false, disabled: false, running: true, state: 'active', ...over })

const serve = (plugins: NodePluginRow[]): void => {
  mocks.readJson.mockResolvedValue({ plugins, restartRequired: false } satisfies NodePluginState)
}

const items = () => pluginFailureAttention.fetch('node-a', new AbortController().signal)

beforeEach(() => {
  mocks.readJson.mockReset()
  clearSurfaceFailures()
})

describe('pluginFailureAttention', () => {
  it('puts the node’s own reason on the row, and names the stage it died in', async () => {
    serve([row({ state: 'failed', stage: 'load', failedAt: 5, reason: 'could not import node/index.js: SyntaxError' })])
    expect(await items()).toEqual([{
      id: 'core.pluginFailures:ntfy',
      title: 'Plugin ntfy failed to load',
      detail: 'could not import node/index.js: SyntaxError',
      severity: 'warn',
      at: 5,
    }])
  })

  it('says "failed to start" for a plugin that ran and threw', async () => {
    serve([row({ state: 'failed', stage: 'init', failedAt: 5, reason: "TypeError: Cannot read properties of undefined (reading 'load')" })])
    expect((await items())[0]).toMatchObject({
      title: 'Plugin ntfy failed to start',
      detail: "TypeError: Cannot read properties of undefined (reading 'load')",
    })
  })

  it('falls back to the generic sentence when the node is older than the reason field', async () => {
    serve([row({ state: 'failed', failedAt: 5 })])
    expect((await items())[0]?.detail).toContain('its start-up threw')
  })

  it('reports a surface this device could not register, under the node that offers the plugin', async () => {
    recordSurfaceFailure('ntfy', 'board', new Error("pane 'board' is already registered"))
    serve([row({})])
    expect(await items()).toEqual([{
      id: 'core.pluginFailures:surface:ntfy:board',
      title: "Plugin ntfy could not contribute 'board'",
      detail: "pane 'board' is already registered",
      severity: 'warn',
      at: expect.any(Number),
    }])
  })

  it('keeps a surface failure off the card of a node that does not have the plugin', async () => {
    // The registration pass merges every node's roster, so the failure is not node-scoped at source. A
    // fetcher that ignored that would report it under every node in the fleet.
    recordSurfaceFailure('ntfy', 'board', new Error('nope'))
    serve([row({ name: 'github' })])
    expect(await items()).toEqual([])
  })

  it('keeps the first timestamp when a surface fails again', async () => {
    recordSurfaceFailure('ntfy', 'board', new Error('first'))
    serve([row({})])
    const first = (await items())[0]!.at
    recordSurfaceFailure('ntfy', 'board', new Error('second'))
    const again = (await items())[0]!
    // One row, stamped when the state began: the inbox renders relative time, and re-stamping it on every
    // registration pass would make a week-old collision read as "just now" forever.
    expect(again).toMatchObject({ at: first, detail: 'second' })
  })
})
