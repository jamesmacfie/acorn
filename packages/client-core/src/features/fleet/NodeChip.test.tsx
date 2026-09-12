import { render } from 'solid-js/web'
import { afterEach, expect, it, vi } from 'vitest'
import type { NodeRecord, NodeStatus } from '@acorn/protocol/broker.ts'
import NodeChip from './NodeChip'
import { _resetFleet, refreshFleet } from '../../infra/node/fleet'

// The chip is the one place on screen that says whether the node behind this window is there, and
// since the window opens before the node does (docs/frontend.md § Painting before the node) it has a
// state it never used to need: a supervised node the broker has not reported on at all.
//
// Rendered rather than asserted on a predicate, because the thing that was wrong before was the WORD
// in the chip, and a word is only wrong on screen.

vi.mock('idb-keyval', () => ({ get: vi.fn(), set: vi.fn(), del: vi.fn(async () => {}) }))

const record = (nodeId: string, local: boolean): NodeRecord => ({
  nodeId,
  label: local ? 'This computer' : 'Someone else’s',
  endpoint: `https://127.0.0.1:1/${nodeId}`,
  local,
})

// The fleet as the renderer reads it: membership from the helper's file, statuses from the broker.
// A launch that has not adopted its node yet has the first and not the second.
const seed = async (nodes: NodeRecord[], statuses: NodeStatus[] = []): Promise<void> => {
  vi.stubGlobal('window', {
    acorn: {
      nodeFetch: () => Promise.reject(new Error('this suite makes no requests')),
      fleetList: async () => ({ nodes, statuses }),
      onNodeStatus: () => () => {},
    },
  })
  await refreshFleet()
}

const chipText = (nodeId: string): string => {
  const host = document.createElement('div')
  document.body.append(host)
  render(() => <NodeChip nodeId={nodeId} compact />, host)
  return host.textContent ?? ''
}

afterEach(() => {
  _resetFleet()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

it('says the local node is starting rather than offline before it has reported', async () => {
  await seed([record('local-1', true)])
  const text = chipText('local-1')
  expect(text).toContain('Starting')
  expect(text).not.toContain('Offline')
  // And no age. "never" is true of a node that is coming up and reads as an accusation.
  expect(text).not.toContain('never')
})

it('still calls an unreported remote node offline, because nothing has tried to reach it', async () => {
  await seed([record('remote-1', false)])
  const text = chipText('remote-1')
  expect(text).toContain('Offline')
  expect(text).not.toContain('Starting')
})

it('reads the node as live once its first status lands', async () => {
  await seed([record('local-1', true)], [{ nodeId: 'local-1', state: 'online' }])
  expect(chipText('local-1')).toContain('Live')
})

it('lets a hard error win over starting', async () => {
  // A fingerprint that changed is a security stop (docs/security.md), and "Starting" would hide it.
  await seed(
    [record('local-1', true)],
    [{ nodeId: 'local-1', state: 'offline', error: { code: 'identity_mismatch' } }],
  )
  expect(chipText('local-1')).toContain('Identity changed')
})
