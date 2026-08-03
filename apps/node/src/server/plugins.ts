// The node plugin list (docs/vNext/plugins.md § The plugin API). One place, one array — a plugin that
// is not here does not exist, which is the same contribution rule the client side has always had.
//
// This replaces, for each converted plugin, three separate app-layer edits: a registerRoute call in
// server/routes.ts, a setXBridge call in wiring/serverBridges.ts, and (for plugins with tables) core
// owning their schema. Everything a plugin needs now arrives through NodePluginContext.
import type { NodePlugin } from '@acorn/node-core/server/plugin/types.ts'
import { changesPlugin } from '@acorn/plugin-changes/node/index.ts'

// `dataDir` is threaded in because a plugin's SQLite file lives under the node's data root, and only
// the composition root knows where that is.
export const nodePlugins = (dataDir: string): NodePlugin[] => [changesPlugin(dataDir)]
