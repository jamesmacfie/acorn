// Shared contract for the one sanctioned state channel between a loaded plugin's Node half and its
// sandboxed frame. Both sides persist through core prefs, so the namespace and quota must not drift.
export const MAX_PLUGIN_STATE_BYTES = 1024 * 1024

export const pluginStateKey = (pluginId: string, key: string): string => `plugin:${pluginId}:${key}`

// ── The live channel ──────────────────────────────────────────────────────────────────────────────
//
// The WS channel namespace a loaded plugin owns. Its node half may broadcast on this and nothing
// else, its own frames may subscribe to it, and a frame arriving on it invalidates that plugin's
// chrome alone. Same rule its routes follow: your own namespace is always allowed, another plugin's
// is always denied.
//
// Here rather than beside either consumer because three sides have to agree on one spelling: the node
// that stamps it, the renderer that routes it, and the manifest that declares it as an event grant.
//
// `plugin` is one letter from core's own `plugins` prefix (client-core/wsClient.ts), which carries the
// roster's `plugins:changed`. They are different tokens and coexist in the registry; the test that
// pins wsChannelPrefixes() is what keeps the near-miss from turning into a silent drop.
export const PLUGIN_CHANNEL_PREFIX = 'plugin'

export const pluginChannel = (pluginId: string, verb: string): string => `${PLUGIN_CHANNEL_PREFIX}:${pluginId}:${verb}`

// Both halves are constrained, not merely non-empty. The id half matches the manifest's own id pattern
// so a channel cannot name something no plugin could be called; the verb half is held to the same
// alphabet so an arbitrary string cannot ride into a surface that renders it. The trust prompt draws
// host-owned copy for this grant and never the verb, but a channel name is manifest input reaching a
// renderer, and "it parsed" should mean "it is a name" rather than "it had two colons in it".
const CHANNEL_PART = /^[a-z][a-z0-9-]{0,63}$/

/** The inverse, and the ownership check both ends run. `null` for anything that is not one of ours:
 *  another prefix, a missing or malformed half, or a verb containing the delimiter. */
export function parsePluginChannel(channel: string): { pluginId: string; verb: string } | null {
  const parts = channel.split(':')
  if (parts.length !== 3) return null
  const [prefix, pluginId, verb] = parts
  if (prefix !== PLUGIN_CHANNEL_PREFIX) return null
  if (!pluginId || !verb || !CHANNEL_PART.test(pluginId) || !CHANNEL_PART.test(verb)) return null
  return { pluginId, verb }
}
