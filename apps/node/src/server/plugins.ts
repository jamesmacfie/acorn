// The node plugin list (docs/vNext/plugins.md § The plugin API). One place, one array — a plugin that
// is not here does not exist, which is the same contribution rule the client side has always had.
//
// This replaces, for each converted plugin, three separate app-layer edits: a registerRoute call in
// server/routes.ts, a setXBridge call in wiring/serverBridges.ts, and (for plugins with tables) core
// owning their schema. Everything a plugin needs now arrives through NodePluginContext.
import type { NodePlugin } from '@acorn/node-core/server/plugin/types.ts'
import { agentsPlugin, type AgentsPluginDeps } from '@acorn/plugin-agents/node/index.ts'
import { changesPlugin } from '@acorn/plugin-changes/node/index.ts'
import { databasePlugin } from '@acorn/plugin-database/node/index.ts'
import { dockerPlugin } from '@acorn/plugin-docker/node/index.ts'
import { editorPlugin } from '@acorn/plugin-editor/node/index.ts'
import { githubPlugin } from '@acorn/plugin-github/node/index.ts'
import { httpPlugin } from '@acorn/plugin-http/node/index.ts'
import { linearPlugin } from '@acorn/plugin-linear/node/index.ts'
import { memoryPlugin, type MemoryPluginDeps } from '@acorn/plugin-memory/node/index.ts'
import { modelProvidersPlugin } from '@acorn/plugin-model-providers/node/index.ts'
import { notesPlugin } from '@acorn/plugin-notes/node/index.ts'
import { previewPlugin, type PreviewPluginDeps } from '@acorn/plugin-preview/node/index.ts'
import { rollbarPlugin } from '@acorn/plugin-rollbar/node/index.ts'
import { terminalPlugin, type TerminalPluginDeps } from '@acorn/plugin-terminal/node/index.ts'
import { workflowsPlugin, type WorkflowsPluginDeps } from '@acorn/plugin-workflows/node/index.ts'

// What a converted plugin cannot resolve for itself yet. Keeping them in one narrow bag is what makes
// it obvious when each seam closes — memory's bag lost `sendToAgent` the moment terminal became a
// NodePlugin able to publish `terminal.sendToAgent`.
//
//   - agents.currentUserId / memory.currentUserId — the node's active GitHub identity, which lives in
//     the runtime bindings.
//   - agents.internalEnv — the same blocker terminal's has, below: it closes over the listener origin
//     and the internal signing KEY.
//   - agents.memoryReviewTrigger — plugins/memory's, as a thunk, for the same capability-id reason
//     terminal's three have.
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
//   - workflows.failingChecks — re-derives CI state from github's `repos`/`checks`. This one CLOSED: it
//     is `github.mirror.failingChecks` now, resolved from the registry at call time, and
//     wiring/workflowWiring.ts is deleted. It arrives as a dep only because the composition root also has
//     to supply the node's active GitHub identity, which is not a plugin's to read.
//
// Seven plugins take NO deps at all: github, notes, docker, editor, and the three that arrived last —
// linear, rollbar, model-providers and preview. github owns thirteen tables, fourteen routers and one
// capability and still needs nothing but CoreServices; the provider trio contributes descriptors and
// adapters through `ctx.providers`; preview publishes one capability over two core reads.
//
// The last four are also what emptied apps/node/src/server/providers.ts. A provider used to be registered
// by a side-effect import in the composition root, which meant the app named every provider package AND
// that registration happened once per PROCESS rather than once per boot — so the registries had to grow a
// `removeForPlugin` counterpart to `removePluginRoutes` before this could move (server/plugin/host.ts).
export type NodePluginDeps = {
  agents: AgentsPluginDeps
  memory: MemoryPluginDeps
  // The Electron-main browser driver behind the six `browser_*` agent tools. A native adapter, so it stays
  // an app-supplied dep: a plugin may not import electron (tools/arch/boundaries.test.ts enumerates the
  // three that may, and preview's node/ is not one of them).
  preview: PreviewPluginDeps
  terminal: TerminalPluginDeps
  workflows: WorkflowsPluginDeps
}

// `dataDir` is threaded in because a plugin's SQLite file lives under the node's data root, and only
// the composition root knows where that is. Declaration order is init order, and nothing here may rely
// on it — cross-plugin needs resolve through the capability registry at CALL time (server/plugin/host.ts).
export const nodePlugins = (dataDir: string, deps: NodePluginDeps): NodePlugin[] => [
  agentsPlugin(dataDir, deps.agents),
  changesPlugin(dataDir),
  databasePlugin(dataDir),
  dockerPlugin(),
  editorPlugin(),
  githubPlugin(dataDir),
  httpPlugin(dataDir),
  linearPlugin(),
  memoryPlugin(dataDir, deps.memory),
  modelProvidersPlugin(),
  notesPlugin(dataDir),
  previewPlugin(deps.preview),
  rollbarPlugin(),
  terminalPlugin(dataDir, deps.terminal),
  workflowsPlugin(dataDir, deps.workflows),
]
