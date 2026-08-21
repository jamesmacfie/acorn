// The live channel a loaded plugin owns, on the renderer's side.
//
// A loaded plugin cannot claim a WS prefix: `ctx.events.channel` is withheld from it, because a prefix
// is infrastructure exactly one owner may hold and it does not survive a message-passing boundary
// (node-core/server/plugin/context.ts). But its node half still has data that changes, and before this
// module the only push it had was `ctx.events.status()` — content-free, global, and it makes every
// client re-pull everything it is showing. Sampling anything at 1 Hz through that is not a fast path,
// it is a denial of service with good manners.
//
// So core claims the one prefix on every loaded plugin's behalf and routes by the plugin id inside the
// channel name. `plugin:<id>:<verb>` is that plugin's namespace and no other's, which is the rule its
// routes already follow. Two consumers, deliberately different:
//
//   - a **frame** that subscribed gets every frame, uncoalesced. It asked for the stream and it pays
//     for it through the bridge's own message budget (plugins/frames/broker.ts).
//   - **chrome** gets a coalesced nudge, at most one per plugin per COALESCE_MS. A rail row is a
//     network read per node; a plugin sampling at 2 Hz must not turn that into a refetch storm.
//
// Core reads only the channel. What a plugin puts on the frame beside `channel` is the payload, handed
// to its own frames unchanged — nothing here looks inside it.
import { parsePluginChannel, PLUGIN_CHANNEL_PREFIX } from '@acorn/protocol/pluginState.ts'
import type { WsServerFrame } from '@acorn/protocol/ws.ts'
import { registerWsChannel, type Disposable } from '../wsChannels'
import { wsConnect } from '../wsClient'

// Fast enough that a live number reads as live, slow enough that the descriptor reads behind it stay a
// rounding error. A plugin sampling every 2s never touches the limit; one sampling in a loop is capped
// at two chrome passes a second whatever it does.
const COALESCE_MS = 500

type FrameListener = (payload: unknown) => void

// Keyed by the full channel name, because two frames of the same plugin may want different verbs.
const frameListeners = new Map<string, Set<FrameListener>>()
const pushListeners = new Set<(pluginId: string) => void>()

const lastPushAt = new Map<string, number>()
const trailing = new Map<string, ReturnType<typeof setTimeout>>()

let registration: Disposable | null = null

const announce = (pluginId: string): void => {
  lastPushAt.set(pluginId, Date.now())
  for (const listener of [...pushListeners]) listener(pluginId)
}

// Leading and trailing edge both, because either alone is wrong here: leading-only drops the last
// sample of a burst, which is the one a reader is looking at, and trailing-only makes the first update
// after an idle period arrive half a second late.
const nudge = (pluginId: string): void => {
  const since = Date.now() - (lastPushAt.get(pluginId) ?? 0)
  if (since >= COALESCE_MS) return announce(pluginId)
  if (trailing.has(pluginId)) return
  trailing.set(pluginId, setTimeout(() => {
    trailing.delete(pluginId)
    announce(pluginId)
  }, COALESCE_MS - since))
}

const route = (frame: WsServerFrame): void => {
  const parsed = parsePluginChannel(frame.channel)
  // A frame on our prefix that is not a well-formed plugin channel is dropped, not guessed at: the node
  // refuses to send one, so this is either a version skew or something forging frames.
  if (!parsed) return
  const listeners = frameListeners.get(frame.channel)
  if (listeners?.size) {
    const { channel: _channel, ...payload } = frame
    for (const listener of [...listeners]) listener(payload)
  }
  nudge(parsed.pluginId)
}

/** Claim the prefix. Idempotent, and called from the client composition root so the claim is made at
 *  boot like core's own three and can be pinned by the test that guards against a silent drop
 *  (apps/desktop/test/client/wsChannelPrefixes.test.ts). Claiming does not open the socket: that stays
 *  with the subscribers below, the same bargain wsClient.ts strikes. */
export function ensurePluginChannel(): void {
  registration ??= registerWsChannel(PLUGIN_CHANNEL_PREFIX, route)
}

/** Every push from one plugin's node half, coalesced per plugin. For chrome, which re-reads descriptor
 *  routes and so must not be driven at the sender's cadence. */
export function onPluginPush(listener: (pluginId: string) => void): () => void {
  ensurePluginChannel()
  wsConnect()
  pushListeners.add(listener)
  return () => void pushListeners.delete(listener)
}

/** One frame's subscription to one of its own plugin's channels. Throws for a channel belonging to
 *  another plugin, which is the same answer its routes give: another plugin's namespace is always
 *  denied, and the caller turns a throw into the bridge's own refusal. */
export function onPluginFrame(pluginId: string, channel: string, listener: FrameListener): () => void {
  const parsed = parsePluginChannel(channel)
  if (!parsed) throw new Error(`${channel} is not a plugin channel`)
  if (parsed.pluginId !== pluginId) throw new Error(`${channel} belongs to '${parsed.pluginId}', not '${pluginId}'`)
  ensurePluginChannel()
  wsConnect()
  let set = frameListeners.get(channel)
  if (!set) {
    set = new Set()
    frameListeners.set(channel, set)
  }
  set.add(listener)
  return () => {
    const current = frameListeners.get(channel)
    if (!current) return
    current.delete(listener)
    if (!current.size) frameListeners.delete(channel)
  }
}

// Test seam: the maps and the claimed prefix are module singletons whose lifetime is the renderer's.
export function _resetPluginChannels(): void {
  for (const timer of trailing.values()) clearTimeout(timer)
  trailing.clear()
  lastPushAt.clear()
  frameListeners.clear()
  pushListeners.clear()
  registration?.dispose()
  registration = null
}
