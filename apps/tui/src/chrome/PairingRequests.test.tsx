/** @jsxImportSource @acorn/tui/jsx */
import { createRoot, createSignal } from 'solid-js'
import { afterEach, expect, it, vi } from 'vitest'
import { activeConfirmation, finishConfirmation, resetConfirmations } from './confirmStore'

// The terminal's side of pairing by approval: the model that decides when there is a request is the
// desktop dialog's, so this fakes it and tests only how the request becomes a question and an answer.
const [asking, setAsking] = createSignal<{ nodeId: string; request: Record<string, unknown> } | null>(null)
const answer = vi.fn(async () => {})
vi.mock('@acorn/client-core/host/trust/pairingRequestModel.ts', () => ({
  createPairingRequests: () => ({ asking, answer, error: () => '', close: () => setAsking(null) }),
  askerLine: () => 'MacBook is asking for full access.',
  denyAdvice: () => 'If you did not just ask, deny it.',
}))
vi.mock('@acorn/client-core/features/notifications', () => ({ toast: vi.fn() }))

const { PairingRequests } = await import('./PairingRequests')

let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  setAsking(null)
  resetConfirmations()
  answer.mockClear()
})

const request = (id: string) => ({
  nodeId: 'node-1',
  request: { id, deviceName: 'MacBook', phrase: 'maple river stone' },
})
const mount = () =>
  createRoot((disposeRoot) => {
    dispose = disposeRoot
    PairingRequests()
  })

it('asks the owner with the three words, and allows what they confirm', async () => {
  mount()
  setAsking(request('req-1'))
  expect(activeConfirmation()).toMatchObject({ title: 'Allow a new client?', actionLabel: 'Allow' })
  expect(activeConfirmation()?.goes).toContain('maple river stone')
  finishConfirmation(true)
  await vi.waitFor(() => expect(answer).toHaveBeenCalledWith('allow'))
})

it('denies when the owner cancels', async () => {
  mount()
  setAsking(request('req-1'))
  finishConfirmation(false)
  await vi.waitFor(() => expect(answer).toHaveBeenCalledWith('deny'))
})

it('takes the question down, without answering, when the request ends first', async () => {
  mount()
  setAsking(request('req-1'))
  expect(activeConfirmation()).not.toBeNull()
  setAsking(null)
  expect(activeConfirmation()).toBeNull()
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(answer).not.toHaveBeenCalled()
})
