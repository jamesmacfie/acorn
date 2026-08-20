// The renderer's WS channel registry, mirroring the node's `ctx.events.channel`, with the same prefix
// rule and the same contract: core routes by the token before the first ':' and never looks inside a
// payload.
//
// It exists because the client half of the stream was closed in core. `wsClient.ts` held a flat if/else
// over thirteen channel names, each branch hardwired to a module-level subscriber set in the same file,
// plus a reconnect loop that built `docker:${kind}:attach` strings itself and a test reset that
// enumerated every subscriber set by name. A plugin with a new stream had to edit all four.
//
// A duplicate prefix throws rather than replacing, like Registry: silently overwriting would make
// client-plugin registration order observable, and a dropped stream looks like a backend problem for a
// day.
import type { WsClientFrame, WsServerFrame } from '@acorn/protocol/ws.ts'

export type WsChannelHandler = (frame: WsServerFrame) => void

// Recomputed at call time, never captured: only the owner knows what's currently attached, and the set
// changes as panes mount and unmount.
export type WsReattach = () => WsClientFrame[]

type Registration = { handler: WsChannelHandler; reattach?: WsReattach }

const channels = new Map<string, Registration>()

export type Disposable = { dispose(): void }

export function registerWsChannel(prefix: string, handler: WsChannelHandler, reattach?: WsReattach): Disposable {
  if (channels.has(prefix)) throw new Error(`ws channel already registered: ${prefix}`)
  const registration: Registration = { handler, reattach }
  channels.set(prefix, registration)
  let disposed = false
  return {
    dispose: () => {
      if (disposed) return
      disposed = true
      // Only if it's still ours, so a re-register after disposal isn't clobbered by a stale handle.
      if (channels.get(prefix) === registration) channels.delete(prefix)
    },
  }
}

// Route one server frame to its owner. A frame whose prefix nobody claimed is dropped, which is also the
// honest answer when the owning plugin is disabled on this node.
export function routeWsFrame(frame: WsServerFrame): void {
  const separator = frame.channel.indexOf(':')
  channels.get(separator < 0 ? frame.channel : frame.channel.slice(0, separator))?.handler(frame)
}

// Every frame the current owners want replayed after a reconnect. The node treats attach as idempotent
// per connection, so re-sending is safe.
export function wsReattachFrames(): WsClientFrame[] {
  return [...channels.values()].flatMap((registration) => registration.reattach?.() ?? [])
}

// Which prefixes are claimed. Exported for the test that pins the set after client plugins boot: a
// mismatched prefix is a silent drop rather than a dead branch, so it wants an assertion.
export const wsChannelPrefixes = (): string[] => [...channels.keys()].sort()

// Test seam: the map is a module singleton whose lifetime is the renderer's.
export const _resetWsChannels = (): void => channels.clear()
