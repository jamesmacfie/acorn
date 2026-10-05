import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PLUGIN_API_MAJOR, type NodePluginRow } from '@acorn/protocol/api.ts'

// A plugin with no client half never had a bundle to ask about, so before input approval it never
// asked anything. These pin that it now asks before its derived sources read anyone's data, and that
// Accept approves exactly the list it showed.
vi.mock('../plugins/host', () => ({
  recordPluginTrust: vi.fn(),
  pluginHostAvailable: () => true,
  readPluginHostState: async () => ({ cached: {}, acks: [], devGrants: [] }),
  cachePluginBundle: async () => ({ error: 'unreachable' }),
}))
vi.mock('../../infra/node/apiClient', () => ({ readJson: vi.fn(async () => ({ plugins: [], restartRequired: false })), sendRaw: vi.fn(), writeJson: vi.fn(async () => ({ ok: true })) }))

const { _resetPluginDistribution, _seedPluginDistribution } = await import('../plugins/distribution')
const { writeJson } = await import('../../infra/node/apiClient')
const { default: PluginTrustDialog } = await import('./PluginTrustDialog')

const NODE_ONLY: NodePluginRow = {
  name: 'readiness', required: false, disabled: false, running: true, state: 'active',
  installed: {
    version: '1.0.0', apiVersion: PLUGIN_API_MAJOR, client: null,
    permissions: { api: [], events: [], node: { core: [], capabilities: [], secrets: false, exec: false, net: [], sockets: false } },
    contributions: { frames: [], dataSources: [{ sourceId: 'board', name: 'Release readiness', singular: 'Issue', plural: 'Issues', identityScope: 'issue', handler: '/v1/p/readiness/board' }] },
  },
  inputs: {
    granted: false,
    inputs: [
      { sourceId: 'board', name: 'pulls', source: 'github:pull-requests', optional: false, label: 'Pulls', plural: 'Pull requests', provider: 'GitHub', approved: false },
      { sourceId: 'board', name: 'issues', source: 'linear:issues', optional: true, label: 'Issues', plural: 'Issues', provider: 'Linear', approved: false },
    ],
  },
}

let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  _resetPluginDistribution()
  vi.mocked(writeJson).mockClear()
})

const dialog = () => document.querySelector<HTMLElement>('.plugin-trust-dialog')
const press = (text: string) => [...dialog()!.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === text)!.click()

describe('PluginTrustDialog for what a plugin reads', () => {
  it('asks about a node-only plugin with inputs, and Accept posts the exact list shown', async () => {
    _seedPluginDistribution([['node-a', [NODE_ONLY]]])
    dispose = render(() => <PluginTrustDialog />, document.body.appendChild(document.createElement('div')))
    await vi.waitFor(() => expect(dialog()).not.toBeNull())
    const text = dialog()!.textContent ?? ''
    expect(text).toContain('Reads your data')
    expect(text).toContain('Read pull requests from GitHub')
    expect(text).toContain('Read issues from Linear, if you choose an account')
    expect(text).toContain('A data source, Release readiness')

    press('Accept')
    await vi.waitFor(() => expect(writeJson).toHaveBeenCalled())
    const [url, init] = vi.mocked(writeJson).mock.calls[0]!
    expect(url).toBe('/v1/core/plugins/readiness/input-grant')
    expect(init).toMatchObject({ method: 'POST', nodeId: 'node-a' })
    expect(JSON.parse(String(init!.body))).toEqual({
      sources: { board: { pulls: { source: 'github:pull-requests', optional: false }, issues: { source: 'linear:issues', optional: true } } },
    })
  })
})
