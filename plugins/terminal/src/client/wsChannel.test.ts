// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest'
import { encodeIdFrame } from '@acorn/protocol/ws.ts'
import { setActiveNode } from '@acorn/plugin-api/testkit/client'
import { evictScope } from '@acorn/plugin-api/testkit/client'
import { _resetWsClient } from '@acorn/plugin-api/testkit/ws-client'
import { initPtyChannel, wsAttach, wsWrite } from './wsChannel'

const SESSION = '11111111-2222-3333-4444-555555555555'
type Bridge = {
  sent: { nodeId: string; frame: unknown }[]
  frame(frame: unknown, nodeId?: string): void
  bytes(frame: Uint8Array, nodeId?: string): void
  online(nodeId?: string): void
}

function bridge(): Bridge {
  const sent: Bridge['sent'] = []
  const frames: ((nodeId: string, frame: unknown) => void)[] = []
  const bytes: ((nodeId: string, frame: Uint8Array) => void)[] = []
  const statuses: ((status: { nodeId: string; state: 'online' }) => void)[] = []
  Object.assign(window, { acorn: {
    desktop: true,
    nodeFetch: () => Promise.reject(new Error('unused')),
    nodeSend: (nodeId: string, frame: unknown) => sent.push({ nodeId, frame }),
    onNodeFrame: (cb: (nodeId: string, frame: unknown) => void) => { frames.push(cb); return () => {} },
    onNodeBytes: (cb: (nodeId: string, frame: Uint8Array) => void) => { bytes.push(cb); return () => {} },
    onNodeStatus: (cb: (status: { nodeId: string; state: 'online' }) => void) => { statuses.push(cb); return () => {} },
  } })
  return {
    sent,
    frame: (value, nodeId = 'n1') => frames.forEach((cb) => cb(nodeId, value)),
    bytes: (value, nodeId = 'n1') => bytes.forEach((cb) => cb(nodeId, value)),
    online: (nodeId = 'n1') => statuses.forEach((cb) => cb({ nodeId, state: 'online' })),
  }
}

let transport: Bridge
let dispose: () => void
beforeEach(() => {
  transport = bridge()
  _resetWsClient()
  setActiveNode('n1')
  dispose = initPtyChannel()
})
afterEach(() => {
  dispose()
  _resetWsClient()
  setActiveNode(null)
  delete (window as { acorn?: unknown }).acorn
})

it('attaches once, validates JSON payloads, and detaches after the last reader', () => {
  const output: string[] = []
  const first = wsAttach(SESSION, (message) => { if (message.type === 'output') output.push(message.data) })
  const second = wsAttach(SESSION, () => {})
  expect(transport.sent.filter(({ frame }) => (frame as { channel: string }).channel === 'term:attach')).toHaveLength(1)
  transport.frame({ channel: 'term:out', id: SESSION, msg: { type: 'output', data: 'valid' } })
  transport.frame({ channel: 'term:out', id: SESSION, msg: { type: 'output', data: 7 } })
  transport.frame({ channel: 'term:out', id: SESSION, msg: { type: 'output', data: 'other node' } }, 'n2')
  expect(output).toEqual(['valid'])
  first()
  expect(transport.sent.some(({ frame }) => (frame as { channel: string }).channel === 'term:detach')).toBe(false)
  second()
  expect(transport.sent.at(-1)).toEqual({ nodeId: 'n1', frame: { channel: 'term:detach', id: SESSION } })
})

it('decodes binary output and keeps input on the selected node', () => {
  const output: string[] = []
  wsAttach(SESSION, (message) => { if (message.type === 'output') output.push(message.data) })
  transport.bytes(encodeIdFrame(SESSION, new TextEncoder().encode('hello 🌰'))!)
  transport.bytes(encodeIdFrame(SESSION, new TextEncoder().encode('wrong'))!, 'n2')
  wsWrite(SESSION, 'echo hi\n')
  expect(output).toEqual(['hello 🌰'])
  expect(transport.sent.at(-1)).toEqual({ nodeId: 'n1', frame: { channel: 'term:input', id: SESSION, data: 'echo hi\n' } })
})

it('clears attachments on node switch, even when the other node has the same session ID', () => {
  const output: string[] = []
  wsAttach(SESSION, (message) => { if (message.type === 'output') output.push(message.data) })
  setActiveNode('n2')
  evictScope({ scope: 'node-switched' })
  transport.frame({ channel: 'term:out', id: SESSION, msg: { type: 'output', data: 'stale' } }, 'n2')
  wsWrite(SESSION, 'stale')
  expect(output).toEqual([])
  expect(transport.sent.every(({ frame }) => (frame as { data?: string }).data !== 'stale')).toBe(true)
})

it('re-attaches only the selected node after a reconnect and stops on disposal', () => {
  wsAttach(SESSION, () => {})
  transport.online()
  transport.sent.length = 0
  transport.online('n2')
  expect(transport.sent).toEqual([])
  transport.online()
  expect(transport.sent).toEqual([{ nodeId: 'n1', frame: { channel: 'term:attach', id: SESSION } }])
  dispose()
  transport.sent.length = 0
  transport.online()
  expect(transport.sent).toEqual([])
})
