// Shared contract for the one sanctioned state channel between a loaded plugin's Node half and its
// sandboxed frame. Both sides persist through core prefs, so the namespace and quota must not drift.
export const MAX_PLUGIN_STATE_BYTES = 1024 * 1024

export const pluginStateKey = (pluginId: string, key: string): string => `plugin:${pluginId}:${key}`
