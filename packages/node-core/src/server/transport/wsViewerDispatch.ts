import type { InternalClaims } from '../auth/internalTokens'
import { WS_MAX_VIEWERS, wsFrameSchema, wsViewerFrameSchema, wsViewerCloseSchema, type WsServerFrame } from '@acorn/protocol/ws.ts'
import type { StreamHandlers, StreamSink, WsChannelHandler } from './wsHub'
import type { EventViewer, WsViewers } from './wsViewers'

type Parent = { viewers: WsViewers; multiplexed: boolean; internal?: InternalClaims }
type Outputs = {
  send(frame: WsServerFrame, viewerId?: string | null): void
  stream(viewer: EventViewer, id: string, message: Parameters<StreamSink>[0]): void
  release(id: string): void
  invoke(action: () => unknown): void
}

export const isTaskConfinedWs = (parent: { internal?: InternalClaims }): boolean => !!parent.internal && parent.internal.scope !== 'service'

/** Dispatches viewer-owned resources using the authenticated physical parent's authority. */
export function createWsViewerDispatch(parent: Parent, streams: () => StreamHandlers | null, channels: ReadonlyMap<string, WsChannelHandler>, output: Outputs) {
  const retire = (owner: EventViewer) => {
    for (const [id, sink] of owner.sinks) {
      owner.sinks.delete(id)
      output.invoke(() => streams()?.detach(id, sink))
      if (!parent.viewers.hasStream(id)) output.release(id)
    }
    for (const handler of channels.values()) output.invoke(() => handler.onDisconnect(owner))
  }

  return {
    close: () => parent.viewers.clear(retire),
    receive(raw: string): unknown {
      let parsed: unknown
      try { parsed = JSON.parse(raw) } catch { return }
      const envelope = wsFrameSchema.safeParse(parsed)
      if (!envelope.success) return
      let frame = envelope.data
      let owner = parent.viewers.legacy
      if (parent.multiplexed) {
        if (frame.channel === 'ws:viewer-close') {
          const closing = wsViewerCloseSchema.safeParse(frame)
          if (closing.success) {
            const held = parent.viewers.remove(closing.data.viewerId)
            if (held) retire(held)
          }
          return
        }
        const nested = wsViewerFrameSchema.safeParse(frame)
        if (!nested.success) return
        const held = parent.viewers.acquire(nested.data.viewerId)
        if (!held) {
          output.send({ channel: 'ws:viewer-error', viewerId: nested.data.viewerId, code: 'viewer_limit', message: `This Node connection has reached its ${WS_MAX_VIEWERS}-viewer limit.` })
          return
        }
        owner = held
        frame = nested.data.frame
      }
      const handlers = streams()
      if (frame.channel.startsWith('term:')) {
        const { id, data, cols, rows } = frame
        if (!handlers || typeof id !== 'string') return
        // The viewer carries no claims. Read the physical parent's claims on every dispatch.
        if (isTaskConfinedWs(parent) && (!parent.internal?.taskId || handlers.streamTaskId(id) !== parent.internal.taskId)) return
        if (frame.channel === 'term:input') {
          if (typeof data === 'string') return handlers.input(id, data)
        } else if (frame.channel === 'term:attach') {
          if (owner.sinks.has(id)) return
          const sink: StreamSink = (message) => output.stream(owner, id, message)
          owner.sinks.set(id, sink)
          return handlers.attach(id, sink, typeof cols === 'number' && typeof rows === 'number' ? { cols, rows } : undefined)
        } else if (frame.channel === 'term:detach') {
          const sink = owner.sinks.get(id)
          if (sink) {
            owner.sinks.delete(id)
            if (!parent.viewers.hasStream(id)) output.release(id)
            return handlers.detach(id, sink)
          }
        }
        return
      }
      if (isTaskConfinedWs(parent)) return
      return channels.get(frame.channel.split(':', 1)[0])?.onFrame(frame, (reply) => { if (owner.active) output.send(reply, owner.id) }, owner)
    },
  }
}
