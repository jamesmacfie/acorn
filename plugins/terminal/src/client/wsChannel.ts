import { decodeIdFrame } from '@acorn/protocol/ws.ts'
import { activeNodeId, onScopeEvicted, registerWsBinaryHandler, registerWsChannel, wsSend, wsSendToNode } from '@acorn/plugin-api/client'
import { terminalServerMsgSchema, type ServerMsg } from '../contract/wire'

type Subscriber = (message: ServerMsg) => void
type Attached = { id: string; nodeId: string | null; subscribers: Set<Subscriber>; size?: { cols: number; rows: number } }
const attached = new Map<string, Attached>()
const decoder = new TextDecoder()
const node = (): string | null => activeNodeId()
const key = (nodeId: string | null, id: string): string => JSON.stringify([nodeId, id])
const send = (nodeId: string | null, frame: Parameters<typeof wsSend>[0], cleanup = false): void => {
  if (nodeId !== null) wsSendToNode(nodeId, frame, { cleanup })
  else if (node() === null) wsSend(frame)
}

function retire(nodeId: string | null): void {
  for (const [id, slot] of attached) {
    if (slot.nodeId !== nodeId) continue
    attached.delete(id)
    send(nodeId, { channel: 'term:detach', id: slot.id }, true)
    slot.subscribers.clear()
  }
}

function receive(id: string, message: unknown): void {
  const slot = attached.get(key(node(), id))
  if (!slot || slot.nodeId !== node()) return
  const parsed = terminalServerMsgSchema.safeParse(message)
  if (!parsed.success) return
  for (const subscriber of slot.subscribers) subscriber(parsed.data)
}

export function initPtyChannel(): () => void {
  const scope = onScopeEvicted((event) => {
    if (event.scope !== 'node-switched') return
    if (event.from !== undefined) retire(event.from)
    else for (const slot of [...attached.values()]) if (slot.nodeId !== node()) retire(slot.nodeId)
  })
  const json = registerWsChannel('term', (frame) => {
    if (frame.channel !== 'term:out' || typeof frame.id !== 'string') return
    receive(frame.id, frame.msg)
  }, () => [...attached].filter(([, slot]) => slot.nodeId === node())
    .map(([, slot]) => ({ channel: 'term:attach', id: slot.id, ...slot.size })), (frame) => {
      if (typeof frame.id !== 'string' || (frame.channel !== 'term:attach' && frame.channel !== 'term:detach')) return
      return { key: `term:${frame.id}`, state: frame.channel === 'term:attach' ? 'attached' : 'detached' }
    })
  const binary = registerWsBinaryHandler((frame) => {
    const tagged = decodeIdFrame(frame)
    if (tagged) receive(tagged.id, { type: 'output', data: decoder.decode(tagged.payload) })
  })
  return () => { for (const slot of [...attached.values()]) retire(slot.nodeId); scope(); json.dispose(); binary.dispose() }
}

// `size` rides on the attach frame so the node sizes the session before it takes the snapshot. A
// node from before that ignores it, which is why the surface still checks the size `ready` reports.
export function wsAttach(id: string, on: Subscriber, size?: { cols: number; rows: number }, selected: string | null = node()): () => void {
  if (selected !== node()) return () => {}
  const address = key(selected, id)
  let slot = attached.get(address)
  const first = !slot
  if (!slot) { slot = { id, nodeId: selected, subscribers: new Set(), size }; attached.set(address, slot) }
  slot.subscribers.add(on)
  if (first) send(selected, { channel: 'term:attach', id, ...size })
  let released = false
  return () => {
    if (released) return
    released = true
    const current = attached.get(address)
    if (current !== slot) return
    current.subscribers.delete(on)
    if (current.subscribers.size) return
    attached.delete(address)
    send(selected, { channel: 'term:detach', id }, true)
  }
}

export function wsWrite(id: string, data: string, selected: string | null = node()): void {
  if (selected === node() && attached.has(key(selected, id))) send(selected, { channel: 'term:input', id, data })
}

/** Updates replay intent; resizing the live PTY remains the Terminal HTTP owner's job. */
export function wsRememberSize(id: string, cols: number, rows: number, selected: string | null = node()): void {
  const slot = attached.get(key(selected, id))
  if (selected !== node() || !slot || (slot.size?.cols === cols && slot.size.rows === rows)) return
  slot.size = { cols, rows }
  send(selected, { channel: 'term:attach', id, cols, rows })
}
