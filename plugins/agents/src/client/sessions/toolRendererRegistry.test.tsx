import { render } from 'solid-js/web'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { afterEach, expect, it } from 'vitest'
import type { AgentToolCall } from '../../contract/wire.ts'
import type { AgentToolCardProps } from '@acorn/protocol/extensionPoints.ts'
import { AgentToolCallCard } from './toolRendererRegistry'
import { AgentToolFoldContext, type AgentToolFoldSetting } from './toolFoldPrefs'

// Which body a call gets, which is the whole of this feature's selection rule: the payload decides,
// not the call's kind, not its title, and not which harness produced it.

const hosts: Array<() => void> = []
afterEach(() => { for (const dispose of hosts.splice(0).reverse()) dispose() })

const draw = (tool: AgentToolCall, startsOpen = true, createdAt = Date.parse('2026-09-25T03:24:18Z'), fileChanges?: AgentToolCardProps['fileChanges']) => {
  const host = document.createElement('div')
  document.body.append(host)
  const setting: AgentToolFoldSetting = { startsOpen: () => startsOpen, onToggle: () => {} }
  // The card goes through the `agents:tool-card` slot, and the slot reads the reader's prefs through
  // a query. Nothing contributes to the point here, so what is under test is the built-in fallback.
  const dispose = render(() => (
    <QueryClientProvider client={new QueryClient()}>
      <AgentToolFoldContext.Provider value={setting}>
        <AgentToolCallCard tool={tool} taskId="task-1" createdAt={createdAt} fileChanges={fileChanges} />
      </AgentToolFoldContext.Provider>
    </QueryClientProvider>
  ), host)
  hosts.push(() => { dispose(); host.remove() })
  return host
}

it('shows recorded patches in the fallback when no plugin contributes a file-tool card', () => {
  const host = draw({ id: 'edit', title: 'Edit' }, false, 0, [
    { path: 'a.ts', patch: '@@ -1 +1 @@\n-old\n+new' },
  ])
  const fold = host.querySelector('details')!
  expect(host.querySelector('.diff-row')).toBeNull()
  fold.open = true
  fold.dispatchEvent(new Event('toggle'))
  expect(host.querySelector('.diff-add')?.textContent).toContain('new')
  expect(host.textContent).toContain('Open in Changes')
})

it('shows the local and relative time below an expanded command, with no row hover time', () => {
  const at = Date.now() - 2 * 60_000
  const host = draw({ id: 't', title: 'Run command', status: 'completed', input: 'pwd', output: '/repo' }, false, at)
  const fold = host.querySelector('details')!
  expect(fold.open).toBe(false)
  expect(host.querySelector('[data-tip]')).toBeNull()
  fold.open = true
  fold.dispatchEvent(new Event('toggle'))
  const body = fold.querySelector('.ui-fold-body') ?? fold
  expect(body.textContent).toContain('Started ')
  expect(body.textContent).toContain(Intl.DateTimeFormat().resolvedOptions().timeZone)
  expect(body.textContent).toContain('2m ago')
  expect(body.textContent?.indexOf('pwd')).toBeLessThan(body.textContent!.indexOf('Started '))
})

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

it('names a skill in the closed row and keeps its JSON behind the disclosure', () => {
  const host = draw({
    id: 't', title: 'Skill', status: 'completed',
    input: '{\n  "skill": "readable"\n}', output: 'Launching skill: readable',
  }, false)
  const fold = host.querySelector('details')!
  expect(fold.open).toBe(false)
  expect(fold.querySelector('summary')?.textContent).toContain('Launching skill: readable')
  expect(host.textContent).not.toContain('"skill"')
  fold.open = true
  fold.dispatchEvent(new Event('toggle'))
  expect(host.textContent).toContain('"skill": "readable"')
  expect(host.querySelectorAll('.ui-code')).toHaveLength(1)
})

it('leaves malformed or unrelated tool inputs under their provider titles', () => {
  expect(draw({ id: 'a', title: 'Skill', input: '{bad' }).querySelector('summary')?.textContent).toContain('Skill')
  expect(draw({ id: 'b', title: 'Bash', input: '{"skill":"readable"}' }).querySelector('summary')?.textContent).toContain('Bash')
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

it('builds nothing behind a closed card until the reader opens it', () => {
  // A transcript holds hundreds of tool calls, most of them closed. Their output is the expensive part,
  // and a closed disclosure has not built it (client-core kit/components/layout/Fold.tsx).
  const host = draw({ id: 't', title: 'Run tests', status: 'completed', input: '{"cmd":"pnpm test"}', output: 'PASS 412 tests' }, false)
  const details = host.querySelector('details')!
  expect(details.querySelector('.ui-code')).toBeNull()
  expect(host.textContent).not.toContain('PASS 412 tests')
  details.open = true
  details.dispatchEvent(new Event('toggle'))
  expect(host.textContent).toContain('PASS 412 tests')
})
