import { describe, expect, it } from 'vitest'
import type { PluginApprovalRequest } from '@acorn/protocol/api.ts'
import { describePluginRequest, describePluginSource, pluginRequestOutcomeMessage } from './approval'

// The two sentences that cross the boundary in opposite directions: what the OWNER is shown about a
// request an agent raised, and what the AGENT is told once they answer. The dialog that draws them is a
// `.tsx` and therefore untestable here (docs/testing.md), which is exactly why they live in a plain
// module.

const request = (over: Partial<PluginApprovalRequest> = {}): PluginApprovalRequest => ({
  requestId: 'r1',
  taskId: 't1',
  action: 'install',
  source: { github: 'acorn/board' },
  dev: false,
  requestedAt: 0,
  ...over,
})

describe('what the owner is shown', () => {
  it('names the source in the form it was written', () => {
    expect(describePluginSource({ github: 'acorn/board' })).toBe('github:acorn/board')
    expect(describePluginSource({ github: 'acorn/board', tag: 'v1.2.0' })).toBe('github:acorn/board@v1.2.0')
    expect(describePluginSource({ npm: '@acorn/board', version: '2.0.0' })).toBe('npm:@acorn/board@2.0.0')
    expect(describePluginSource({ url: 'https://example.test/p.tgz' })).toBe('https://example.test/p.tgz')
    expect(describePluginSource({ path: '/src/board' })).toBe('/src/board')
  })

  it('leads with the action, and says when data is going with it', () => {
    expect(describePluginRequest(request())).toBe('Install github:acorn/board')
    expect(describePluginRequest(request({ action: 'update', source: undefined, pluginId: 'board' }))).toBe('Update board')
    expect(describePluginRequest(request({ action: 'uninstall', source: undefined, pluginId: 'board' }))).toBe('Remove board')
    expect(describePluginRequest(request({ action: 'uninstall', source: undefined, pluginId: 'board', purgeData: true }))).toBe(
      'Remove board and delete its data',
    )
  })
})

describe('what the agent is told', () => {
  it('refuses without explaining how to get a different answer', () => {
    expect(pluginRequestOutcomeMessage(request(), { decision: 'denied' })).toBe('The owner declined this install. Do not retry it.')
    expect(pluginRequestOutcomeMessage(request(), { decision: 'denied', removed: true })).toContain('Do not ask again')
  })

  it('distinguishes installed-and-running from installed-and-waiting', () => {
    // The difference matters to the agent: a reloaded plugin's tools and routes exist NOW, and a
    // restart-pending one's do not. Getting it wrong sends the agent looking for a route that is not there.
    expect(pluginRequestOutcomeMessage(request(), { decision: 'approved', version: '1.0.0', reloaded: true })).toBe(
      'github:acorn/board at 1.0.0 is installed and reloaded; its node half is running now.',
    )
    expect(pluginRequestOutcomeMessage(request(), { decision: 'approved', version: '1.0.0' })).toBe(
      'github:acorn/board at 1.0.0 is installed. It starts when the node next restarts.',
    )
  })

  it('says what happened for an uninstall', () => {
    expect(pluginRequestOutcomeMessage(request({ action: 'uninstall', source: undefined, pluginId: 'board' }), { decision: 'approved' })).toBe(
      'board was removed from this node.',
    )
  })
})
