import { render } from 'solid-js/web'
import { expect, it, vi } from 'vitest'

vi.mock('@solidjs/router', () => ({ useNavigate: () => () => {}, useParams: () => ({}) }))
vi.mock('@tanstack/solid-query', () => ({ createQuery: () => ({ data: [] }) }))
vi.mock('../sessions/managedClient', () => ({ managedAgentApi: {
  providers: async () => [], sessions: async () => ({ sessions: [] }), search: async () => [],
} }))
vi.mock('../sessions/managedStore', () => ({ managedAgentStore: {
  sessions: () => [], upsertSessions: () => {}, activate: () => () => {},
} }))
vi.mock('@acorn/plugin-api/client', async (original) => ({
  ...await original<Record<string, unknown>>(),
  createFleetQuery: () => [() => ({ rows: [], unavailable: [] })],
}))

const { default: AgentCenter } = await import('./AgentCenter')

it('opens the center before any provider or session data is available', () => {
  const host = document.createElement('div')
  let dispose: (() => void) | undefined
  try {
    expect(() => { dispose = render(() => <AgentCenter />, host) }).not.toThrow()
    expect(host.textContent).toContain('Agent Center')
  } finally { dispose?.() }
})
