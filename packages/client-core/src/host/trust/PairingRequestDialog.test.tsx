import { render } from 'solid-js/web'
import { afterEach, expect, it, vi } from 'vitest'

// The dialog opens on the Node's ping, shows the request read from the Node, and answers the request
// it showed on the Node that sent the ping.
let ping: (nodeId: string) => void = () => {}
vi.mock('../../infra/node/wsClient', () => ({
  wsOnFleetPairingRequested: (cb: (nodeId: string) => void) => {
    ping = cb
    return () => {}
  },
}))
vi.mock('../../infra/node/fleet', () => ({
  nodes: () => [
    { nodeId: 'node-1', label: 'This computer', local: true },
    { nodeId: 'node-2', label: 'Build box', local: false },
  ],
}))
vi.mock('../../features/notifications/toast', () => ({ toast: vi.fn() }))
vi.mock('../../infra/node/fleetActions', () => ({
  readPairingRequest: vi.fn(async (): Promise<{ request: unknown }> => ({
    request: {
      id: 'req-1',
      deviceName: 'acorn on laptop',
      phrase: 'maple river stone',
      expiresAt: Date.now() + 60_000,
    },
  })),
  answerPairingRequest: vi.fn(async () => {}),
}))

const { toast } = await import('../../features/notifications/toast')
const { answerPairingRequest, readPairingRequest } = await import('../../infra/node/fleetActions')
const { default: PairingRequestDialog } = await import('./PairingRequestDialog')

let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  document.body.innerHTML = ''
})

const dialog = () => document.querySelector<HTMLElement>('[role="alertdialog"]')
const button = (text: string) =>
  [...dialog()!.querySelectorAll<HTMLButtonElement>('button')].find((candidate) => candidate.textContent === text)!
const press = (text: string) => button(text).click()
// Allow waits a second after the dialog opens.
const allowEnabled = () => vi.waitFor(() => expect(button('Allow').disabled).toBe(false), { timeout: 2_000 })

it('shows the request a Node announces, and allows that request on that Node', async () => {
  vi.mocked(readPairingRequest).mockResolvedValueOnce({ request: null })
  dispose = render(() => <PairingRequestDialog />, document.body.appendChild(document.createElement('div')))
  await vi.waitFor(() => expect(readPairingRequest).toHaveBeenCalledTimes(1))
  expect(dialog()).toBeNull()

  ping('node-1')
  await vi.waitFor(() => expect(dialog()).not.toBeNull())
  expect(readPairingRequest).toHaveBeenCalledWith('node-1')
  const text = dialog()!.textContent ?? ''
  expect(text).toContain('acorn on laptop')
  expect(text).toContain('This computer')
  expect(text).toContain('maple river stone')

  expect(button('Allow').disabled).toBe(true)
  await allowEnabled()
  press('Allow')
  await vi.waitFor(() => expect(dialog()).toBeNull())
  expect(answerPairingRequest).toHaveBeenCalledWith('node-1', 'req-1', 'allow')
})

// Another ask landing while the owner reads cancels the request on the Node, so the read comes back
// empty or with a request that started after.
it.each([
  ['nothing', null],
  [
    'a different request',
    { id: 'req-2', deviceName: 'Chrome', phrase: 'oak ridge cloud', expiresAt: Date.now() + 60_000 },
  ],
])('closes the dialog and tells the owner when a frame brings %s', async (_name, next) => {
  dispose = render(() => <PairingRequestDialog />, document.body.appendChild(document.createElement('div')))
  await vi.waitFor(() => expect(dialog()).not.toBeNull())
  await allowEnabled()

  vi.mocked(readPairingRequest).mockResolvedValueOnce({ request: next })
  ping('node-1')
  await vi.waitFor(() => expect(dialog()).toBeNull())
  expect(toast).toHaveBeenCalledWith('Another pairing request arrived, so this one was cancelled.')
  expect(answerPairingRequest).not.toHaveBeenCalledWith('node-1', 'req-2', expect.anything())
})

it('leaves the dialog alone when a frame brings the request it already shows', async () => {
  vi.mocked(toast).mockClear()
  dispose = render(() => <PairingRequestDialog />, document.body.appendChild(document.createElement('div')))
  await vi.waitFor(() => expect(dialog()).not.toBeNull())
  const reads = vi.mocked(readPairingRequest).mock.calls.length
  ping('node-1')
  await vi.waitFor(() => expect(readPairingRequest).toHaveBeenCalledTimes(reads + 1))
  expect(dialog()!.textContent).toContain('maple river stone')
  expect(toast).not.toHaveBeenCalled()
})

// In tray mode the request opens the window, so it arrives before the dialog exists to hear the ping.
it("shows the local Node's waiting request when it mounts", async () => {
  vi.mocked(readPairingRequest).mockClear()
  dispose = render(() => <PairingRequestDialog />, document.body.appendChild(document.createElement('div')))
  await vi.waitFor(() => expect(dialog()).not.toBeNull())
  expect(readPairingRequest).toHaveBeenCalledExactlyOnceWith('node-1')
  expect(dialog()!.textContent).toContain('maple river stone')
})

// A request from the owner's account on another computer says so, and tells the owner when to deny.
it('says when the request came from another computer', async () => {
  vi.mocked(readPairingRequest).mockResolvedValueOnce({
    request: {
      id: 'req-3',
      deviceName: 'MacBook',
      phrase: 'maple river stone',
      expiresAt: Date.now() + 60_000,
      remote: true,
    },
  })
  dispose = render(() => <PairingRequestDialog />, document.body.appendChild(document.createElement('div')))
  await vi.waitFor(() => expect(dialog()).not.toBeNull())
  const text = dialog()!.textContent ?? ''
  expect(text).toContain('MacBook, signed in to your account on another computer')
  expect(text).toContain("If you didn't just click Connect on another computer, deny it.")
  expect(text).not.toContain('on the computer running')
})
