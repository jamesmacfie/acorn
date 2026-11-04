import { render } from 'solid-js/web'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { NodeStatus } from '@acorn/protocol/broker.ts'
import NodeReconnectButton, { RECONNECT_WAIT_MS } from './NodeReconnectButton'
import { _resetFleet, refreshFleet } from '../../infra/node/fleet'
import { activeToasts, dismissToast } from '../notifications/toast'

vi.mock('idb-keyval', () => ({ get: vi.fn(), set: vi.fn(), del: vi.fn(async () => {}) }))

let pushStatus: (status: NodeStatus) => void = () => {}
const nodeReconnect = vi.fn()

beforeEach(async () => {
  vi.useFakeTimers()
  window.acorn = {
    nodeFetch: () => Promise.reject(new Error('this suite makes no requests')),
    fleetList: async () => ({
      nodes: [{ nodeId: 'remote-1', label: 'Hermes', endpoint: 'https://127.0.0.1:1', local: false }],
      statuses: [{ nodeId: 'remote-1', state: 'offline' }],
    }),
    onNodeStatus: (cb: (status: NodeStatus) => void) => {
      pushStatus = cb
      return () => {}
    },
    nodeReconnect,
  } as unknown as typeof window.acorn
  await refreshFleet()
})

afterEach(() => {
  activeToasts().forEach((entry) => dismissToast(entry.id))
  nodeReconnect.mockReset()
  _resetFleet()
  delete window.acorn
  vi.useRealTimers()
  document.body.innerHTML = ''
})

const pressReconnect = (): HTMLElement => {
  const host = document.createElement('div')
  document.body.append(host)
  render(() => <NodeReconnectButton nodeId="remote-1" />, host)
  host.querySelector('button')!.click()
  return host
}

it('says nothing when the node comes back', () => {
  const host = pressReconnect()
  expect(nodeReconnect).toHaveBeenCalledWith('remote-1')
  pushStatus({ nodeId: 'remote-1', state: 'online' })
  vi.advanceTimersByTime(RECONNECT_WAIT_MS)
  expect(activeToasts()).toEqual([])
  expect(host.querySelector('button')).toBeNull()
})

it('raises a failure toast when the node stays offline', () => {
  pressReconnect()
  vi.advanceTimersByTime(RECONNECT_WAIT_MS)
  expect(activeToasts().map((entry) => [entry.message, entry.tone])).toEqual([
    ['Could not reconnect to Hermes.', 'danger'],
  ])
})
