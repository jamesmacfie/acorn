import { render } from 'solid-js/web'
import type { NodeRecord } from '@acorn/protocol/broker.ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const pairing = vi.hoisted(() => ({ open: vi.fn(), close: vi.fn() }))
vi.mock('../../../infra/node/fleetActions', () => ({
  openNodePairingWindow: pairing.open,
  closeNodePairingWindow: pairing.close,
}))

import { createNodePairing, NodePairingButton, NodePairingPanel } from './NodePairingCode'

const node: NodeRecord = {
  nodeId: 'node-a', label: 'This computer', endpoint: 'https://127.0.0.1:4317', local: true,
  fingerprint: 'a1'.repeat(32),
}
let host: HTMLElement
let dispose: () => void

beforeEach(() => {
  pairing.open.mockReset().mockResolvedValue({ code: 'pairing-secret', expiresInMs: 600_000 })
  pairing.close.mockReset().mockResolvedValue(undefined)
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(() => {
    const pairingState = createNodePairing(() => node.nodeId)
    return <><NodePairingButton pairing={pairingState} /><NodePairingPanel node={node} pairing={pairingState} /></>
  }, host)
})

afterEach(() => {
  dispose()
  host.remove()
})

describe('Settings → Nodes pairing', () => {
  it('shows a code and identity for the selected node, then closes its pairing window', async () => {
    host.querySelector('button')!.click()
    await vi.waitFor(() => expect(host.textContent).toContain('pairing-secret'))
    expect(pairing.open).toHaveBeenCalledWith('node-a')
    expect(host.querySelector('.node-fingerprint-words')?.textContent?.split(' ')).toHaveLength(6)

    const closeButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Close pairing')!
    closeButton.click()
    await vi.waitFor(() => expect(host.textContent).not.toContain('pairing-secret'))
    expect(pairing.close).toHaveBeenCalledWith('node-a')
  })
})
