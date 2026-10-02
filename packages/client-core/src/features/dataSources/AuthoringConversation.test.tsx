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
        baseRevision={0} base={{}} label="Draft" bare onApply={() => undefined} sendTurn={async () => reply} />
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
      baseRevision={1} base={{}} label="Draft" bare onApply={() => undefined} />
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
      baseRevision={1} base={{}} label="Draft" bare onApply={() => undefined} />
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
