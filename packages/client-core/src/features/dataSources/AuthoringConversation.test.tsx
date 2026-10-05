import { render } from 'solid-js/web'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { afterEach, expect, it, vi } from 'vitest'
import { setActiveNode } from '../../infra/node/activeNode'
import { registerQueryOwner } from '../../infra/node/queryOwnership'
import type { AuthoringTurnResult } from '@acorn/protocol/authoring.ts'

const writes = vi.hoisted(() => vi.fn().mockResolvedValue({}))
vi.mock('../../infra/node/apiClient', () => ({
  ApiError: class ApiError extends Error {},
  readJson: async (path: string) => path.includes('model')
    ? { backends: [{ id: 'c1', kind: 'connection', label: 'Mine', models: [{ id: 'opus', label: 'Opus' }], defaultModelId: '' }] }
    : {},
  writeJson: writes,
}))

const { default: AuthoringConversation } = await import('./AuthoringConversation')

let dispose: (() => void) | undefined
let host: HTMLDivElement
const settle = async () => { for (let turn = 0; turn < 5; turn += 1) await new Promise(resolve => setTimeout(resolve, 0)) }

afterEach(() => {
  dispose?.()
  host.remove()
  localStorage.clear()
  writes.mockReset().mockResolvedValue({})
  setActiveNode(null)
})

// A throw while drawing a reply used to stall every later update in the dialog: it stayed on its
// first status line with the prompt still in the box, and the caught error never appeared.
it('reports a reply it cannot draw instead of freezing', async () => {
  const reply = {
    state: 'proposal', base: {}, baseRevision: 0, candidate: {}, summary: 'Broken', diff: [], problems: [],
    context: [{ role: 'user', content: 'go' }], providerId: 'p', modelId: 'm',
  } as unknown as AuthoringTurnResult // no `usage`, so drawing the proposal throws
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(() => (
    <QueryClientProvider client={new QueryClient()}>
      <AuthoringConversation endpoint="/unused" target="workflow" targetId="t" scope={{ workspaceId: 'w', projectId: 'p' }}
        baseRevision={0} base={{}} label="Draft" onClose={() => undefined} onApply={() => undefined} sendTurn={async () => reply} />
    </QueryClientProvider>
  ), host)
  await settle()
  const field = host.querySelector('textarea')!
  field.value = 'go'
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await settle()
  ;[...host.querySelectorAll('button')].find(button => button.textContent === 'Send')!.click()
  await settle()

  expect(host.textContent).toContain('The reply could not be shown')
  expect(host.textContent).toContain("reading 'requests'")
  expect(host.textContent).not.toContain('Checking available sources')
  expect(field.value).toBe('')

  ;[...host.querySelectorAll('button')].find(button => button.textContent === 'Dismiss')!.click()
  await settle()
  expect(host.textContent).not.toContain('The reply could not be shown')
})


it('captures transport and recovery identity and ignores a reply after disposal', async () => {
  const client = new QueryClient()
  registerQueryOwner(client, 'node-A')
  let finish!: (value: unknown) => void
  writes.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
  setActiveNode('node-B')
  host = document.createElement('div'); document.body.append(host)
  dispose = render(() => <QueryClientProvider client={client}>
    <AuthoringConversation endpoint="/workflow/turn" target="workflow" targetId="same" scope={{ workspaceId: 'w', projectId: 'p' }}
      baseRevision={1} base={{}} label="Draft" onApply={() => undefined} />
  </QueryClientProvider>, host)
  await settle()
  const field = host.querySelector('textarea')!
  field.value = 'synthetic instruction'; field.dispatchEvent(new Event('input', { bubbles: true })); await settle()
  ;[...host.querySelectorAll('button')].find(button => button.textContent === 'Send')!.click(); await settle()
  expect(writes).toHaveBeenCalledOnce()
  expect(writes.mock.calls[0][1]).toMatchObject({ nodeId: 'node-A', method: 'POST' })
  const key = 'acorn:ai-authoring:v1:node-A:workflow:same'
  const before = localStorage.getItem(key)
  expect(before).not.toBeNull()
  expect(localStorage.getItem('acorn:ai-authoring:v1:node-B:workflow:same')).toBeNull()
  dispose(); dispose = undefined
  expect(writes.mock.calls[0][1].signal.aborted).toBe(true)
  finish({ state: 'stopped', context: [{ role: 'assistant', content: 'late reply' }], reason: 'Late' }); await settle()
  expect(localStorage.getItem(key)).toBe(before)
})

it('keeps a replacement request busy when a cancelled request settles later', async () => {
  const finish: ((value: unknown) => void)[] = []
  writes.mockImplementation(() => new Promise(resolve => finish.push(resolve)))
  host = document.createElement('div'); document.body.append(host)
  dispose = render(() => <QueryClientProvider client={new QueryClient()}>
    <AuthoringConversation endpoint="/workflow/turn" target="workflow" targetId="same" scope={{ workspaceId: 'w', projectId: 'p' }}
      baseRevision={1} base={{}} label="Draft" onApply={() => undefined} />
  </QueryClientProvider>, host)
  await settle()
  const field = host.querySelector('textarea')!
  field.value = 'synthetic'; field.dispatchEvent(new Event('input', { bubbles: true })); await settle()
  const press = (label: string) => [...host.querySelectorAll('button')].find(button => button.textContent === label)!.click()
  press('Send'); await settle(); press('Cancel'); await settle(); press('Send'); await settle()
  finish[0]({ state: 'stopped', context: [], reason: 'Obsolete' }); await settle()
  expect(host.textContent).not.toContain('Obsolete')
  expect(host.textContent).toContain('Checking available sources')
  finish[1]({ state: 'stopped', context: [], reason: 'Authoritative reply' }); await settle()
  expect(host.textContent).toContain('Authoritative reply')
})

const turnContext = [
  { role: 'user', content: '[Focus: /stages/1 "Keep where Author is you"] About Keep where Author is you: last 14 days' },
  { role: 'assistant', content: JSON.stringify({ kind: 'metadata', request: { operation: 'list-sources' } }) },
  { role: 'tool', content: '{"result":[]}' },
  { role: 'assistant', content: JSON.stringify({ kind: 'proposal', candidate: {}, summary: 'Keeps the last 14 days.' }) },
]
const dockProposal = {
  state: 'proposal', base: {}, baseRevision: 0, candidate: {}, summary: 'Keeps the last 14 days.', diff: [{ path: '/stages/1', change: 'change' }], problems: [],
  context: turnContext, usage: { requests: 2, inputTokens: 10, outputTokens: 5 }, providerId: 'p', modelId: 'm',
} as unknown as AuthoringTurnResult

it('draws a docked conversation: turns, the proposal, and a composer, and sends the focus once', async () => {
  const sent: string[] = []
  const proposals: unknown[] = []
  host = document.createElement('div'); document.body.append(host)
  dispose = render(() => <QueryClientProvider client={new QueryClient()}>
    <AuthoringConversation layout="dock" endpoint="/unused" target="dashboard" targetId="t" scope={{ workspaceId: 'w', projectId: 'p' }}
      baseRevision={0} base={{}} label="Panel" instruction="About Keep where Author is you: " focus={{ paths: ['/stages/1'], title: 'Keep where Author is you' }}
      onApply={() => undefined} onProposal={proposal => proposals.push(proposal)}
      proposalDetail={() => <span>Covered: recent changes</span>}
      sendTurn={async request => { sent.push(request.instruction); return dockProposal }} />
  </QueryClientProvider>, host)
  await settle()
  const field = host.querySelector('textarea')!
  expect(field.placeholder).toBe('Ask for a change')
  expect(field.value).toBe('About Keep where Author is you: ')
  field.value = 'About Keep where Author is you: last 14 days'; field.dispatchEvent(new Event('input', { bubbles: true })); await settle()
  ;[...host.querySelectorAll('button')].find(button => button.textContent === 'Send')!.click(); await settle()

  expect(sent).toEqual(['[Focus: /stages/1 "Keep where Author is you"] About Keep where Author is you: last 14 days'])
  // The person's turn without the prefix, and the proposal once, in its card rather than as a turn too.
  expect(host.textContent).toContain('YouAbout Keep where Author is you: last 14 days')
  expect(host.textContent!.split('Keeps the last 14 days.').length).toBe(2)
  expect(host.textContent).toContain('Covered: recent changes')
  expect(host.textContent).not.toContain('/stages/1')
  expect(host.textContent).not.toContain('input tokens')
  expect(proposals.at(-1)).toBe(dockProposal)

  field.value = 'and newest first'; field.dispatchEvent(new Event('input', { bubbles: true })); await settle()
  ;[...host.querySelectorAll('button')].find(button => button.textContent === 'Send')!.click(); await settle()
  expect(sent[1]).toBe('and newest first')
  ;[...host.querySelectorAll('button')].find(button => button.textContent === 'Discard')!.click(); await settle()
  expect(proposals.at(-1)).toBeUndefined()
})
