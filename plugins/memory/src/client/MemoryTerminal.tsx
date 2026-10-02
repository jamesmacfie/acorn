import { attachPty, Rectangle, type PtyIo } from '@acorn/plugin-api/ui'
import { registerWsChannel, wsConnect, wsSend } from '@acorn/plugin-api/client'

const listeners = new Map<string, (frame: { channel: string; data?: string; body?: string; code?: number }) => void>()
registerWsChannel('memory', (frame) => {
  if (typeof frame.id === 'string') listeners.get(frame.id)?.(frame)
})

export default function MemoryTerminal(props: { body: string; onExit: (body?: string) => void }) {
  const id = crypto.randomUUID()
  const io: PtyIo = {
    open: ({ cols, rows }, onEvent) => {
      listeners.set(id, (frame) => {
        if (frame.channel === 'memory:editor:out' && typeof frame.data === 'string') onEvent({ kind: 'out', data: frame.data })
        if (frame.channel === 'memory:editor:exit') props.onExit(frame.code === 0 ? frame.body : undefined)
      })
      wsConnect(); wsSend({ channel: 'memory:editor:open', id, body: props.body, cols, rows })
      return () => { listeners.delete(id); wsSend({ channel: 'memory:editor:kill', id }) }
    },
    input: (data) => wsSend({ channel: 'memory:editor:input', id, data }),
    resize: ({ cols, rows }) => wsSend({ channel: 'memory:editor:resize', id, cols, rows }),
  }
  return <Rectangle kind="pty" label="Editing memory body" mount={(handle) => attachPty(handle, io)} />
}
