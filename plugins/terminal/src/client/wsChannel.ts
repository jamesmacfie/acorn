import { decodeIdFrame } from '@acorn/protocol/ws.ts'
import { activeNodeId, onScopeEvicted, registerWsBinaryHandler, registerWsChannel, wsSend } from '@acorn/plugin-api/client'
import { terminalServerMsgSchema, type ServerMsg } from '../contract/wire'

type Subscriber = (message: ServerMsg) => void
type Attached = { nodeId: string; subscribers: Set<Subscriber> }
const attached = new Map<string, Attached>()
const decoder = new TextDecoder()
const node = (): string => activeNodeId() ?? ''

function receive(id: string, message: unknown): void {
  const slot = attached.get(id)
  if (!slot || slot.nodeId !== node()) return
  const parsed = terminalServerMsgSchema.safeParse(message)
  if (!parsed.success) return
  for (const subscriber of slot.subscribers) subscriber(parsed.data)
}

export function initPtyChannel(): () => void {
  const scope = onScopeEvicted((event) => { if (event.scope === 'node-switched') attached.clear() })
  const json = registerWsChannel('term', (frame) => {
    if (frame.channel !== 'term:out' || typeof frame.id !== 'string') return
    receive(frame.id, frame.msg)
  }, () => [...attached].filter(([, slot]) => slot.nodeId === node())
    .map(([id]) => ({ channel: 'term:attach', id })))
  const binary = registerWsBinaryHandler((frame) => {
    const tagged = decodeIdFrame(frame)
    if (tagged) receive(tagged.id, { type: 'output', data: decoder.decode(tagged.payload) })
  })
  return () => { scope(); json.dispose(); binary.dispose(); attached.clear() }
}

// `size` rides on the attach frame so the node sizes the session before it takes the snapshot. A
// node from before that ignores it, which is why the surface still checks the size `ready` reports.
export function wsAttach(id: string, on: Subscriber, size?: { cols: number; rows: number }): () => void {
  const selected = node()
  let slot = attached.get(id)
  const first = !slot || slot.nodeId !== selected
  if (first) { slot = { nodeId: selected, subscribers: new Set() }; attached.set(id, slot) }
  slot!.subscribers.add(on)
  if (first) wsSend({ channel: 'term:attach', id, ...size })
  return () => {
    const current = attached.get(id)
    if (!current || current !== slot) return
    current.subscribers.delete(on)
    if (current.subscribers.size) return
    attached.delete(id)
    if (selected === node()) wsSend({ channel: 'term:detach', id })
  }
}

export function wsWrite(id: string, data: string): void {
  if (attached.get(id)?.nodeId === node()) wsSend({ channel: 'term:input', id, data })
}
