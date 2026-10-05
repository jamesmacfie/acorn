import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NodePluginRow } from '@acorn/protocol/api.ts'
import type { DevicePluginEntry } from '../../../host/plugins/distributionModel'

// Installed lists the node's plugins and this device's side by side, filters them down to what needs the
// person or what this device holds, and opens one plugin's page with its three tabs and its danger zone.
const permissions = { api: [], events: [], node: { core: [], capabilities: [], secrets: false, exec: false, net: [], sockets: false } }
const installed = (version: string) => ({ version, apiVersion: '1', permissions, contributions: { frames: [] }, client: null, source: 'github:someone/beta' })
const ROWS: NodePluginRow[] = [
  { name: 'alpha', required: false, disabled: false, running: true, state: 'active' },
  { name: 'beta', required: false, disabled: false, running: false, state: 'pending-review', installed: installed('1.3.0'), pendingReview: { reviewId: 'r1', fingerprint: 'f', stagedAt: 1 } },
]
// A loaded plugin with a derived source that reads GitHub pull requests, approved.
const READINESS: NodePluginRow = {
  name: 'readiness', required: false, disabled: false, running: true, state: 'active',
  installed: { ...installed('1.0.0'), contributions: { frames: [], dataSources: [{ sourceId: 'board', name: 'Release readiness', singular: 'Issue', plural: 'Issues', identityScope: 'issue', handler: '/v1/p/readiness/board' }] } },
  inputs: { granted: true, inputs: [{ sourceId: 'board', name: 'pulls', source: 'github:pull-requests', optional: false, label: 'Pull requests', plural: 'Pull requests', provider: 'GitHub', approved: true }] },
}
const DEVICE: DevicePluginEntry[] = [{
  hash: 'h1', sourceLabel: 'npm:gamma', nodeIds: [], sameHashNodeIds: [],
  row: { name: 'gamma', required: false, disabled: false, running: true, state: 'active', installed: { ...installed('0.1.0'), client: { hash: 'h1', bytes: 1 } } },
}]
// A node whose read the test answers by hand; every other node answers ROWS at once.
const slowReads = vi.hoisted(() => new Map<string, () => Promise<unknown>>())
vi.mock('../../../infra/node/nodePlugins', () => ({
  refreshNodePlugins: async (nodeId: string) => (await slowReads.get(nodeId)?.()) ?? { plugins: ROWS, restartRequired: false },
  nodePlugins: () => null,
  readPluginInputGrant: vi.fn(async () => ({ inputs: [], grant: null, usage: { board: { pulls: { panels: 2, connectionIds: ['work'] } } } })),
  revokePluginInputs: vi.fn(),
  installNodePlugin: vi.fn(), reviewNodePlugin: vi.fn(), uninstallNodePlugin: vi.fn(), updateNodePlugin: vi.fn(), saveDisabledNodePlugins: vi.fn(),
  setNodePluginDevelopment: vi.fn(), readNodePluginLogs: vi.fn(async () => ({ lines: [{ at: 0, level: 'warn', message: 'refreshed 3 issues' }] })),
}))
vi.mock('../../../host/plugins/host', () => ({
  readPluginHostState: async () => ({ cached: {}, acks: [], devGrants: [] }),
  installPluginOnDevice: vi.fn(), removePluginFromDevice: vi.fn(), forgetPluginTrust: vi.fn(), setPluginDevGrant: vi.fn(), pluginHostAvailable: () => false,
}))
vi.mock('../../../host/plugins/distribution', async (original) => ({
  ...(await original<typeof import('../../../host/plugins/distribution')>()),
  devicePlugins: () => DEVICE,
}))
vi.mock('../../agent/reference', () => ({ sendReferenceToAgent: vi.fn() }))
// One answer stands in for every query: the integrations the plugin page reads, and the node's source catalog.
vi.mock('@tanstack/solid-query', () => ({ createQuery: () => ({ isPending: false, isError: false, data: {
  integrations: [{ id: 'work', name: 'Work' }],
  sources: [{ pluginId: 'linear', sourceId: 'issues', name: 'Linear issues' }, { pluginId: 'github', sourceId: 'pull-requests', name: 'GitHub pull requests' }],
} }), useQueryClient: () => ({}) }))
vi.mock('../../tasks/tasks', async (original) => ({ ...(await original<typeof import('../../tasks/tasks')>()), activeTaskId: () => 'task-1' }))
vi.mock('../../../infra/queries', () => ({ prefsOptions: () => ({ queryKey: ['prefs'] }), integrationsOptions: () => ({ queryKey: ['integrations'] }) }))

import PluginsSettings from './PluginsSettings'
import { openPluginPage } from './installed'
import { readPluginInputGrant, saveDisabledNodePlugins, setNodePluginDevelopment } from '../../../infra/node/nodePlugins'
import { setPluginDevGrant } from '../../../host/plugins/host'
import { sendReferenceToAgent } from '../../agent/reference'

let host: HTMLElement
let dispose: (() => void) | undefined
beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(() => <PluginsSettings context={{ scope: { nodeId: 'node-a' }, navigate: () => {}, onWorkspaceDeleted: () => {} }} />, host)
})
afterEach(() => {
  dispose?.()
  host.remove()
})

const listed = () => [...host.querySelectorAll('[data-settings-section="installed"] .ui-setting-label')].map((label) => label.textContent)
const press = (text: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.startsWith(text))!.click()

describe('Installed', () => {
  it('lists node and device plugins, and filters to what needs you and to this device', async () => {
    await vi.waitFor(() => expect(listed()).toEqual(['alpha', 'beta', 'gamma']))
    // beta waits for its review and gamma for this device's approval; alpha is running.
    press('Needs you')
    expect(listed()).toEqual(['beta', 'gamma'])
    press('This device')
    expect(listed()).toEqual(['gamma'])
    press('All')
    expect(listed()).toEqual(['alpha', 'beta', 'gamma'])
  })

  it('opens a plugin\'s page with its three tabs, its review, and both ways to uninstall', async () => {
    await vi.waitFor(() => expect(listed()).toContain('beta'))
    openPluginPage((_target, opened) => opened?.(), 'beta', 'node')
    await vi.waitFor(() => expect(host.querySelector('[role="tablist"]')).not.toBeNull())
    expect([...host.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)).toEqual(['Overview', 'Permissions', 'Versions'])
    expect(host.textContent).toContain('Approve this package')
    const danger = host.querySelector('[data-settings-section="danger"]')!
    expect([...danger.querySelectorAll('button')].map((button) => button.textContent)).toEqual(['Keep its data', 'Delete its data'])
  })

  it('lists and writes only the node the header names, after a switch', async () => {
    dispose?.()
    host.textContent = ''
    const [nodeId, setNodeId] = createSignal('node-a')
    // Node A has beta switched off; node B has nothing off.
    slowReads.set('node-a', async () => ({ plugins: [ROWS[0], { ...ROWS[1], disabled: true }], restartRequired: false }))
    let answerB!: (state: unknown) => void
    slowReads.set('node-b', () => new Promise((resolve) => { answerB = resolve }))
    const context = { scope: { get nodeId() { return nodeId() } }, navigate: () => {}, onWorkspaceDeleted: () => {} }
    dispose = render(() => <PluginsSettings context={context} />, host)
    await vi.waitFor(() => expect(listed()).toEqual(['alpha', 'beta', 'gamma']))
    openPluginPage((_target, opened) => opened?.(), 'alpha', 'node')
    const toggle = () => host.querySelector<HTMLInputElement>('input[aria-label="Enable alpha"]')
    await vi.waitFor(() => expect(toggle()).not.toBeNull())

    // While node B is read, node A's plugins are not passed off as B's, and alpha's page waits.
    setNodeId('node-b')
    expect(toggle()).toBeNull()
    expect(host.textContent).toContain('Reading the plugin list')

    answerB({ plugins: [ROWS[0]], restartRequired: false })
    await vi.waitFor(() => expect(toggle()).not.toBeNull())
    vi.mocked(saveDisabledNodePlugins).mockResolvedValue({ plugins: [{ ...ROWS[0], disabled: true }], restartRequired: true })
    toggle()!.click()
    // Built from B's rows, so A's disabled beta is not sent to B.
    await vi.waitFor(() => expect(saveDisabledNodePlugins).toHaveBeenCalledWith(['alpha'], 'node-b'))
    slowReads.clear()
  })

  it('shows the data sources a plugin provides, and what it reads with a panel count', async () => {
    dispose?.()
    host.textContent = ''
    slowReads.set('node-a', async () => ({ plugins: [READINESS], restartRequired: false }))
    dispose = render(() => <PluginsSettings context={{ scope: { nodeId: 'node-a' }, navigate: () => {}, onWorkspaceDeleted: () => {} }} />, host)
    await vi.waitFor(() => expect(listed()).toContain('readiness'))
    openPluginPage((_target, opened) => opened?.(), 'readiness', 'node')
    await vi.waitFor(() => expect(host.querySelector('[role="tablist"]')).not.toBeNull())
    const adds = host.querySelector('[data-settings-section="adds"]')!
    expect(adds.textContent).toContain('Data sources')
    expect(adds.textContent).toContain('Release readiness')

    // The count scans every published plan, so it's read only once the tab opens.
    expect(readPluginInputGrant).not.toHaveBeenCalled()
    press('Permissions')
    await vi.waitFor(() => expect(host.querySelector('[data-settings-section="reads"]')?.textContent)
      .toContain('Pull requests · GitHub · used by 2 panels with the Work account'))
    expect(readPluginInputGrant).toHaveBeenCalledWith('readiness', 'node-a')
    expect(host.querySelector('[data-settings-section="reads"]')!.textContent).toContain('Revoke')
    slowReads.clear()
  })

  it('turns on development mode for a folder plugin on both the node and this computer, then shows its logs', async () => {
    dispose?.()
    host.textContent = ''
    const folder: NodePluginRow = { ...READINESS, installed: { ...READINESS.installed!, source: 'path:/src/readiness' }, development: { on: false } }
    const developing: NodePluginRow = { ...folder, development: { on: true } }
    slowReads.set('node-a', async () => ({ plugins: [folder], restartRequired: false }))
    vi.mocked(setNodePluginDevelopment).mockResolvedValue({ plugins: [developing], restartRequired: false })
    dispose = render(() => <PluginsSettings context={{ scope: { nodeId: 'node-a' }, navigate: () => {}, onWorkspaceDeleted: () => {} }} />, host)
    await vi.waitFor(() => expect(listed()).toContain('readiness'))
    openPluginPage((_target, opened) => opened?.(), 'readiness', 'node')
    await vi.waitFor(() => expect(host.querySelector('[role="tablist"]')).not.toBeNull())
    press('Permissions')
    await vi.waitFor(() => expect(host.querySelector('[data-settings-section="dev"]')?.textContent).toContain('reloads it when its built files change'))
    press('Turn on')
    await vi.waitFor(() => expect(setPluginDevGrant).toHaveBeenCalledWith({ pluginId: 'readiness', nodeId: 'node-a', grant: true }))
    expect(setNodePluginDevelopment).toHaveBeenCalledWith('readiness', true, 'node-a')
    await vi.waitFor(() => expect([...host.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)).toContain('Logs'))
    press('Logs')
    await vi.waitFor(() => expect(host.querySelector('[data-settings-section="logs"]')?.textContent).toContain('WARN   refreshed 3 issues'))
    slowReads.clear()
  })

  it('asks what a row is and which data it reads, then drafts the data source prompt for the agent', async () => {
    vi.mocked(sendReferenceToAgent).mockResolvedValue({ ok: true })
    press('Start')
    const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!
    await vi.waitFor(() => expect(dialog()?.textContent).toContain('What should one row be?'))
    const start = () => [...dialog().querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Start')!
    expect(start().disabled).toBe(true)
    const row = dialog().querySelector<HTMLInputElement>('input:not([type="checkbox"])')!
    row.value = 'An issue with its pull request'
    row.dispatchEvent(new InputEvent('input', { bubbles: true }))
    for (const box of dialog().querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) box.click()
    start().click()
    await vi.waitFor(() => expect(sendReferenceToAgent).toHaveBeenCalled())
    const [taskId, prompt] = vi.mocked(sendReferenceToAgent).mock.calls.at(-1)!
    expect(taskId).toBe('task-1')
    expect(prompt).toContain('One row is: An issue with its pull request')
    expect(prompt).toContain('- Linear issues (`linear:issues`)\n- GitHub pull requests (`github:pull-requests`)')
    expect(prompt).toContain('--data-source')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
})
