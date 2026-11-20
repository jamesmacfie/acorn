import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const actions = vi.hoisted(() => ({ read: vi.fn(), revoke: vi.fn(), shell: vi.fn() }))
vi.mock('../../../infra/node/fleetActions', () => ({
  readNodeDevices: actions.read,
  revokeNodeDevice: actions.revoke,
  setNodeDeviceShellAccess: actions.shell,
}))

import { NodeDevicesSetting } from './NodeDevicesSetting'

const devices = [
  {
    id: 'd-phone',
    name: 'iPhone Safari 1a2b',
    createdAt: 3,
    lastSeenAt: Date.now() - 60_000,
    revokedAt: null,
    kind: 'phone',
    shellAccess: false,
  },
  {
    id: 'd-other',
    name: 'iPhone Safari 9f9f',
    createdAt: 2,
    lastSeenAt: null,
    revokedAt: null,
    kind: 'phone',
    shellAccess: true,
  },
  { id: 'd-laptop', name: 'acorn on MacIntel', createdAt: 1, lastSeenAt: Date.now(), revokedAt: null },
  { id: 'd-gone', name: 'Old laptop', createdAt: 0, lastSeenAt: 1, revokedAt: 5 },
]
let host: HTMLElement
let dispose: () => void

beforeEach(() => {
  actions.read.mockReset().mockResolvedValue({ devices })
  actions.revoke.mockReset().mockResolvedValue(undefined)
  actions.shell.mockReset().mockResolvedValue(undefined)
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(() => <NodeDevicesSetting nodeId="node-a" />, host)
})

afterEach(() => {
  dispose()
  host.remove()
})

const button = (label: string, nth = 0) =>
  Array.from(host.querySelectorAll('button')).filter((candidate) => candidate.textContent === label)[nth]!

describe('Settings → Nodes devices', () => {
  it('lists each paired device, marks the phones, and leaves out the revoked', async () => {
    await vi.waitFor(() => expect(host.textContent).toContain('iPhone Safari 1a2b'))
    expect(actions.read).toHaveBeenCalledWith('node-a')
    expect(host.textContent).toContain('acorn on MacIntel')
    expect(host.textContent).not.toContain('Old laptop')
    expect(host.textContent?.match(/Phone(?!\s)/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
    expect(host.textContent).toContain('not used yet')
  })

  it('revokes only the device whose button was armed and pressed, then reads the list again', async () => {
    await vi.waitFor(() => expect(host.textContent).toContain('iPhone Safari 1a2b'))
    // The first press arms the button, and the second confirms it.
    button('Revoke').click()
    await vi.waitFor(() => expect(button('Revoke device?')).toBeDefined())
    button('Revoke device?').click()
    await vi.waitFor(() => expect(actions.revoke).toHaveBeenCalledWith('node-a', 'd-phone'))
    expect(actions.revoke).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(actions.read).toHaveBeenCalledTimes(2))
  })

  it('gives a phone shell access only once the warning is confirmed, and offers none to a computer', async () => {
    await vi.waitFor(() => expect(host.textContent).toContain('iPhone Safari 1a2b'))
    expect(host.querySelectorAll('button').length).toBe(5)
    button('Give shell access').click()
    expect(actions.shell).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(button('Let it run commands?')).toBeDefined())
    button('Let it run commands?').click()
    await vi.waitFor(() => expect(actions.shell).toHaveBeenCalledWith('node-a', 'd-phone', true))
    await vi.waitFor(() => expect(actions.read).toHaveBeenCalledTimes(2))
  })

  it('marks a phone that has shell access, and takes it away in one press', async () => {
    await vi.waitFor(() => expect(host.textContent).toContain('Shell access'))
    button('Remove shell access').click()
    await vi.waitFor(() => expect(actions.shell).toHaveBeenCalledWith('node-a', 'd-other', false))
  })

  it('shows nothing for a Node that has no devices route', async () => {
    dispose()
    actions.read.mockRejectedValue(new Error('404'))
    dispose = render(() => <NodeDevicesSetting nodeId="node-b" />, host)
    await vi.waitFor(() => expect(actions.read).toHaveBeenCalledWith('node-b'))
    expect(host.textContent).not.toContain('Paired devices')
  })
})
