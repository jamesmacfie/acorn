import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The header button is the only usage reader that is always mounted. A Popover does not render its
// content until it opens, so if the button stops starting the load itself it sits on "reading usage…"
// until someone clicks it.

const init = vi.fn(() => () => {})

vi.mock('./usageStore', () => ({
  agentUsageStore: {
    init,
    snapshot: () => ({ providers: [], refreshedAt: 0 }),
    loading: () => false,
    refreshing: () => false,
    error: () => '',
    ensure: async () => {},
    refresh: async () => {},
  },
}))

const { default: AgentUsageIndicator } = await import('./AgentUsageIndicator')

const disposers: Array<() => void> = []
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
  init.mockClear()
})

describe('AgentUsageIndicator', () => {
  it('starts the usage load without the popover being opened', () => {
    const host = document.createElement('div')
    document.body.append(host)
    disposers.push(render(() => <AgentUsageIndicator />, host))
    expect(init).toHaveBeenCalledTimes(1)
  })
})
