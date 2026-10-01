import { expect, it, vi } from 'vitest'
import type { NodeTransportError } from '@acorn/protocol/broker.ts'

vi.mock('@tauri-apps/api/core', () => ({ invoke: async () => ({ port: 1234, secret: 'fixture' }) }))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))

class Socket {
  static OPEN = 1
  static instances: Socket[] = []
  readyState = 1
  binaryType = ''
  onopen?: () => void
  onmessage?: (event: { data: string }) => void
  sent: { method: string; params: unknown }[] = []
  constructor(_url: string) { Socket.instances.push(this); queueMicrotask(() => this.onopen?.()) }
  send(payload: string) { this.sent.push(JSON.parse(payload)) }
  push(message: unknown) { this.onmessage?.({ data: JSON.stringify(message) }) }
}

it('retains a transport refusal before lazy subscription and delivers later refusals without reloading', async () => {
  vi.stubGlobal('WebSocket', Socket)
  const reload = vi.fn()
  vi.stubGlobal('location', { reload })
  await import('./bridge')
  const host = (globalThis as unknown as { acorn: { nodeInterest(nodeId: string | null): void; onNodeTransportError(cb: (nodeId: string, error: NodeTransportError) => void): () => void } }).acorn
  host.nodeInterest('node-a')
  await vi.waitFor(() => expect(Socket.instances[0]?.sent.length).toBeGreaterThan(0))
  const socket = Socket.instances[0]
  const error = { code: 'viewers_unsupported', message: 'Upgrade this Node for another window.' } satisfies NodeTransportError
  socket.push({ push: 'node-transport-error', nodeId: 'node-a', error })
  const received: unknown[] = []
  const off = host.onNodeTransportError((nodeId, error) => received.push({ nodeId, error }))
  expect(received).toEqual([{ nodeId: 'node-a', error }])
  socket.push({ push: 'node-transport-error', nodeId: 'node-b', error: { code: 'viewer_limit', message: 'Viewer limit reached.' } })
  expect(received).toHaveLength(2)
  expect(reload).not.toHaveBeenCalled()
  off()
  vi.unstubAllGlobals()
})
