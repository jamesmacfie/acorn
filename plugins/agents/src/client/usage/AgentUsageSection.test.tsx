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
let snapshot: AgentUsageSnapshot = {
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
const mount = (defaultAccounts?: Record<string, string>) => {
  const host = document.createElement('div')
  document.body.append(host)
  disposers.push(render(() => <AgentUsageSection showHeader={false} defaultAccounts={defaultAccounts} />, host))
  return host
}
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

  describe('a harness with two accounts', () => {
    const quota = (id: string, label: string, percentRemaining: number) => ({
      id,
      label,
      percentRemaining,
      resetsAt: null,
      resetText: null,
      windowSeconds: null,
      health: 'healthy' as const,
    })
    const reading = (email: string, session: number, accountName?: string): AgentProviderUsage => ({
      ...provider('claude', accountName ? `Claude Code · ${accountName}` : 'Claude Code'),
      account: { email, organization: null },
      quotas: [quota('session', 'Session', session), quota('weekly', 'Weekly', 70)],
      ...(accountName ? { accountName } : {}),
    })
    const rows = (host: HTMLElement) => [...host.querySelectorAll<HTMLDetailsElement>('details')]

    it('opens the default account and shows the other closed, with its bars', async () => {
      snapshot = { providers: [reading('me@home.test', 81), reading('me@work.test', 23, 'work')], refreshedAt: 1 }
      const host = mount()

      const [home, work] = rows(host)
      expect(home!.open).toBe(true)
      expect(work!.open).toBe(false)
      expect(home!.textContent).toContain('me@home.test')
      // Bodies build on first open, so the closed row has its summary and nothing else.
      expect(host.textContent).not.toContain('me@work.test')
      expect(work!.querySelector('summary')!.textContent).toBe('work5h23%week70%')

      work!.querySelector('summary')!.click()
      // The browser fires `toggle` a task after the click, not straight away.
      await new Promise((resolve) => setTimeout(resolve))
      expect(work!.open).toBe(true)
      expect(host.textContent).toContain('me@work.test')
    })

    it('opens the account the selected session is on', () => {
      snapshot = { providers: [reading('me@home.test', 81), reading('me@work.test', 23, 'work')], refreshedAt: 1 }
      const [home, work] = rows(mount({ claude: 'work' }))
      expect(home!.open).toBe(false)
      expect(work!.open).toBe(true)
    })
  })
})
