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

const { answerPairingRequest, readPairingRequest } = await import('../../infra/node/fleetActions')
const { default: PairingRequestDialog } = await import('./PairingRequestDialog')

let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  document.body.innerHTML = ''
})

const dialog = () => document.querySelector<HTMLElement>('[role="alertdialog"]')
const press = (text: string) =>
  [...dialog()!.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === text)!.click()

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

  press('Allow')
  await vi.waitFor(() => expect(dialog()).toBeNull())
  expect(answerPairingRequest).toHaveBeenCalledWith('node-1', 'req-1', 'allow')
})

// In tray mode the request opens the window, so it arrives before the dialog exists to hear the ping.
it("shows the local Node's waiting request when it mounts", async () => {
  vi.mocked(readPairingRequest).mockClear()
  dispose = render(() => <PairingRequestDialog />, document.body.appendChild(document.createElement('div')))
  await vi.waitFor(() => expect(dialog()).not.toBeNull())
  expect(readPairingRequest).toHaveBeenCalledExactlyOnceWith('node-1')
  expect(dialog()!.textContent).toContain('maple river stone')
})
