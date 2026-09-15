import { render } from 'solid-js/web'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { afterEach, expect, it } from 'vitest'
import type { AgentToolCall } from '@acorn/protocol/managedAgents.ts'
import { AgentToolCallCard } from './toolRendererRegistry'
import { AgentToolFoldContext, type AgentToolFoldSetting } from './toolFoldPrefs'

// Which body a call gets, which is the whole of this feature's selection rule: the payload decides,
// not the call's kind, not its title, and not which harness produced it.

const hosts: Array<() => void> = []
afterEach(() => { for (const dispose of hosts.splice(0).reverse()) dispose() })

const draw = (tool: AgentToolCall, startsOpen = true) => {
  const host = document.createElement('div')
  document.body.append(host)
  const setting: AgentToolFoldSetting = { startsOpen: () => startsOpen, onToggle: () => {} }
  // The card goes through the `agents:tool-card` slot, and the slot reads the reader's prefs through
  // a query. Nothing contributes to the point here, so what is under test is the built-in fallback.
  const dispose = render(() => (
    <QueryClientProvider client={new QueryClient()}>
      <AgentToolFoldContext.Provider value={setting}>
        <AgentToolCallCard tool={tool} taskId="task-1" />
      </AgentToolFoldContext.Provider>
    </QueryClientProvider>
  ), host)
  hosts.push(() => { dispose(); host.remove() })
  return host
}

it('gives a call with a web payload the web body, however its kind is spelled', () => {
  for (const kind of ['search', 'fetch', undefined]) {
    const host = draw({
      id: 't', title: 'Search web', kind, status: 'completed',
      web: { action: { type: 'search', queries: ['piranhagram'] }, results: [{ url: 'https://docs.example/a', title: 'A' }] },
    })
    expect(host.textContent, String(kind)).toContain('piranhagram')
    expect(host.querySelector('a')?.getAttribute('href'), String(kind)).toBe('https://docs.example/a')
  }
})

it('leaves a call with the same kind and no payload on the generic body', () => {
  const host = draw({ id: 't', title: 'Grep the repo', kind: 'search', status: 'completed', input: '{"pattern":"signIn"}' })
  expect(host.textContent).toContain('{"pattern":"signIn"}')
  expect(host.querySelector('a')).toBeNull()
})

it('drops the request said twice, once as a query and once as JSON', () => {
  const host = draw({
    id: 't', title: 'Search web', status: 'completed',
    input: '{\n "query": "piranhagram"\n}',
    web: { action: { type: 'search', queries: ['piranhagram'] } },
  })
  expect(host.textContent).toContain('piranhagram')
  expect(host.textContent).not.toContain('"query"')
})

it('opens a web call that has only a query, where the generic card would draw a flat row', () => {
  // Before this, a Codex web call normalized to an id, a title, a kind and a status, which is exactly
  // the shape the generic card renders with no disclosure at all.
  const host = draw({ id: 't', title: 'Search web', status: 'running', web: { action: { type: 'search', queries: ['piranhagram'] } } })
  expect(host.querySelector('details')).not.toBeNull()
  expect(host.textContent).toContain('piranhagram')
})

it('says which call a closed row was without opening it', () => {
  const host = draw({
    id: 't', title: 'Search web', status: 'completed',
    web: { action: { type: 'search', queries: ['piranhagram'] } },
  }, false)
  const summary = host.querySelector('summary')
  expect(summary?.textContent).toContain('Search web')
  expect(summary?.textContent).toContain('piranhagram')
})

it('honours the reader’s fold setting rather than the call’s status', () => {
  expect(draw({ id: 't', title: 'Search web', web: { action: { type: 'search', queries: ['q'] } } }, false)
    .querySelector('details')?.open).toBe(false)
  expect(draw({ id: 't', title: 'Search web', web: { action: { type: 'search', queries: ['q'] } } }, true)
    .querySelector('details')?.open).toBe(true)
})

it('still draws a historic status-only row as the flat one it has always been', () => {
  // Every Codex web call recorded before this change: normalization threw the rest away, and no
  // migration puts it back.
  const host = draw({ id: 't', title: 'Web search', kind: 'search', status: 'completed' })
  expect(host.querySelector('details')).toBeNull()
  expect(host.textContent).toContain('Web search')
})
