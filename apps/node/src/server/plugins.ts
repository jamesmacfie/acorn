// The node plugin list (docs/vNext/plugins.md § The plugin API). One place, one array — a plugin that
// is not here does not exist, which is the same contribution rule the client side has always had.
//
// This replaces, for each converted plugin, three separate app-layer edits: a registerRoute call in
// server/routes.ts, a setXBridge call in wiring/serverBridges.ts, and (for plugins with tables) core
// owning their schema. Everything a plugin needs now arrives through NodePluginContext.
import type { NodePlugin } from '@acorn/node-core/server/plugin/types.ts'
import { changesPlugin } from '@acorn/plugin-changes/node/index.ts'
import { databasePlugin } from '@acorn/plugin-database/node/index.ts'
import { dockerPlugin } from '@acorn/plugin-docker/node/index.ts'
import { editorPlugin } from '@acorn/plugin-editor/node/index.ts'
import { memoryPlugin, type MemoryPluginDeps } from '@acorn/plugin-memory/node/index.ts'

// What a converted plugin cannot resolve for itself yet. Only memory needs anything: its launch
// injector queues a block into a PTY-backed agent session (plugins/terminal's sender — and terminal is
// not a NodePlugin yet, so it cannot publish a capability to resolve instead), and it needs the node's
// active GitHub identity from the runtime bindings. Both come from the composition root until those two
// seams exist; keeping them in one narrow bag is what makes it obvious when they close.
export type NodePluginDeps = {
  memory: MemoryPluginDeps
}

// `dataDir` is threaded in because a plugin's SQLite file lives under the node's data root, and only
// the composition root knows where that is. Declaration order is init order, and nothing here may rely
// on it — cross-plugin needs resolve through the capability registry at CALL time (server/plugin/host.ts).
export const nodePlugins = (dataDir: string, deps: NodePluginDeps): NodePlugin[] => [
  changesPlugin(dataDir),
  databasePlugin(dataDir),
  dockerPlugin(),
  editorPlugin(),
  memoryPlugin(dataDir, deps.memory),
]
