// The live channel a loaded plugin owns, on the renderer's side. See docs/plugins.md § The live
// channel for the cadence rules and why a loaded plugin cannot claim a prefix of its own.
//
// Core claims the one `plugin` prefix and routes by the plugin id inside the channel name. A
// subscribed frame gets every frame; chrome gets a coalesced nudge, because a rail row costs a
// network read per node. Core reads the channel and nothing else in the payload.
import { parsePluginChannel, PLUGIN_CHANNEL_PREFIX } from '@acorn/protocol/pluginState.ts'
import type { WsServerFrame } from '@acorn/protocol/ws.ts'
import { registerWsChannel, type Disposable } from '../../infra/node/wsChannels'
import { wsConnect } from '../../infra/node/wsClient'

// Caps chrome at two passes a second per plugin. A plugin sampling every 2s never touches the limit.
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

// Both edges. Leading alone drops the last sample of a burst, the one a reader is looking at, and
// trailing alone delays the first update after an idle period by half a second.
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
  // The node refuses to send a malformed plugin channel, so this is version skew or a forgery. Drop it.
  if (!parsed) return
  const listeners = frameListeners.get(frame.channel)
  if (listeners?.size) {
    const { channel: _channel, ...payload } = frame
    for (const listener of [...listeners]) listener(payload)
  }
  nudge(parsed.pluginId)
}

/** Claim the prefix. Idempotent, and called from the client composition root so the claim lands at
 *  boot beside core's own and the guard test can pin it
 *  (apps/desktop/test/client/wsChannelPrefixes.test.ts). Claiming does not open the socket. The
 *  subscribers below do, the same bargain wsClient.ts strikes. */
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

/** One frame's subscription to a plugin channel: its own, or another plugin's that the manifest named
 *  in `permissions.events` (docs/plugins.md § Hearing another plugin). The grant
 *  check is the broker's, before this is reached; this only refuses a malformed channel.
 *
 *  Whether the producer declared the verb in its `emits` is enforced on the node for node halves and not
 *  here: a frame's frames arrive over the socket whatever this does, so the check would be cosmetic. An
 *  absent producer delivers nothing, which is the contract. */
export function onPluginFrame(_pluginId: string, channel: string, listener: FrameListener): () => void {
  const parsed = parsePluginChannel(channel)
  if (!parsed) throw new Error(`${channel} is not a plugin channel`)
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
