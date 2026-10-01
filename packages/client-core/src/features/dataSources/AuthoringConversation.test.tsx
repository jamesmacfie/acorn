import { render } from 'solid-js/web'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { afterEach, expect, it, vi } from 'vitest'
import type { AuthoringTurnResult } from '@acorn/protocol/authoring.ts'

vi.mock('../../infra/node/apiClient', () => ({
  ApiError: class ApiError extends Error {},
  readJson: async (path: string) => path.includes('model')
    ? { backends: [{ id: 'c1', kind: 'connection', label: 'Mine', models: [{ id: 'opus', label: 'Opus' }], defaultModelId: '' }] }
    : {},
  writeJson: async () => ({}),
}))

const { default: AuthoringConversation } = await import('./AuthoringConversation')

let dispose: (() => void) | undefined
let host: HTMLDivElement
const settle = async () => { for (let turn = 0; turn < 5; turn += 1) await new Promise(resolve => setTimeout(resolve, 0)) }

afterEach(() => {
  dispose?.()
  host.remove()
  localStorage.clear()
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
