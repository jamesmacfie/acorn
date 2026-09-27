import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentProviderUsage, AgentUsageSnapshot } from '../../shared/usage'

const provider = (id: string, label: string): AgentProviderUsage => ({
  provider: id,
  label,
  availability: 'available',
  health: 'healthy',
  plan: null,
  account: null,
  quotas: [],
  cost: null,
  daily: null,
  capturedAt: 1,
  stale: false,
  error: null,
})
const snapshot: AgentUsageSnapshot = {
  providers: [provider('claude', 'Claude Code'), provider('codex', 'Codex')],
  refreshedAt: 1,
}
const refreshProvider = vi.fn(async (_providerId: string) => {})

vi.mock('./usageStore', () => ({
  agentUsageStore: {
    init: () => () => {},
    snapshot: () => snapshot,
    loading: () => false,
    refreshing: () => false,
    refreshingProviderId: () => null,
    error: () => '',
    refresh: async () => {},
    refreshProvider,
  },
}))

const { default: AgentUsageSection } = await import('./AgentUsageSection')
const disposers: Array<() => void> = []
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
  refreshProvider.mockClear()
})

describe('AgentUsageSection', () => {
  it('offers a separate refresh action beside each provider', () => {
    const host = document.createElement('div')
    document.body.append(host)
    disposers.push(render(() => <AgentUsageSection showHeader={false} />, host))

    const claude = host.querySelector<HTMLButtonElement>('button[aria-label="Refresh Claude Code usage"]')
    const codex = host.querySelector<HTMLButtonElement>('button[aria-label="Refresh Codex usage"]')
    expect(claude).not.toBeNull()
    expect(codex).not.toBeNull()
    claude?.click()
    codex?.click()
    expect(refreshProvider.mock.calls).toEqual([['claude'], ['codex']])
  })
})
