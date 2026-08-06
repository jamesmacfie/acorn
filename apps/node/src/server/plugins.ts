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
import { httpPlugin } from '@acorn/plugin-http/node/index.ts'
import { memoryPlugin, type MemoryPluginDeps } from '@acorn/plugin-memory/node/index.ts'
import { notesPlugin } from '@acorn/plugin-notes/node/index.ts'
import { terminalPlugin, type TerminalPluginDeps } from '@acorn/plugin-terminal/node/index.ts'
import { workflowsPlugin, type WorkflowsPluginDeps } from '@acorn/plugin-workflows/node/index.ts'

// What a converted plugin cannot resolve for itself yet. Keeping them in one narrow bag is what makes
// it obvious when each seam closes — memory's bag lost `sendToAgent` the moment terminal became a
// NodePlugin able to publish `terminal.sendToAgent`.
//
//   - memory.currentUserId — the node's active GitHub identity, which lives in the runtime bindings.
//   - terminal.internalEnv — mints a per-session loopback credential. It closes over the listener's
//     origin (which does not exist until after every init has run) and over the internal signing KEY,
//     which no plugin should be handed.
//   - terminal's launchInjector / memoryReviewTrigger / seedTaskNotes — plugins/memory's and
//     plugins/notes'. `memory.knowledge`'s id deliberately lives in that plugin's main/ rather than a
//     contract/ (its value includes two internal stores), so terminal importing it would ADD a
//     plugin→plugin coupling edge. The composition root resolves the capability at CALL time instead,
//     which is why these arrive as thunks rather than as the resolved functions.
//   - terminal.reconciled / workflows.reconciled — the composition root's own post-listener reconcile
//     pass.
//   - workflows.failingChecks — re-derives CI state from github's `repos`/`checks` mirror tables. github
//     is not a NodePlugin, so there is no `github.checkState` capability to resolve. Left in
//     wiring/workflowWiring.ts rather than moved to CoreServices, because it is github's question, not
//     core's, and putting it on CoreServices now would mean moving it again when github converts.
//
// plugins/notes takes NO deps: it owns its note files outright and everything it reads about a task
// arrives through CoreServices.
export type NodePluginDeps = {
  memory: MemoryPluginDeps
  terminal: TerminalPluginDeps
  workflows: WorkflowsPluginDeps
}

// `dataDir` is threaded in because a plugin's SQLite file lives under the node's data root, and only
// the composition root knows where that is. Declaration order is init order, and nothing here may rely
// on it — cross-plugin needs resolve through the capability registry at CALL time (server/plugin/host.ts).
export const nodePlugins = (dataDir: string, deps: NodePluginDeps): NodePlugin[] => [
  changesPlugin(dataDir),
  databasePlugin(dataDir),
  dockerPlugin(),
  editorPlugin(),
  httpPlugin(dataDir),
  memoryPlugin(dataDir, deps.memory),
  notesPlugin(dataDir),
  terminalPlugin(dataDir, deps.terminal),
  workflowsPlugin(dataDir, deps.workflows),
]
