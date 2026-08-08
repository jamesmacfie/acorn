// The Node plugin activation list. A plugin that is not registered here does not exist in this Node.
// The host supplies routes, capabilities, CoreServices, tools, providers, context sections, storage,
// and lifecycle hooks through NodePluginContext.
import type { NodePlugin } from '@acorn/node-core/server/plugin/types.ts'
import { agentsPlugin, type AgentsPluginDeps } from '@acorn/plugin-agents/node/index.ts'
import { changesPlugin } from '@acorn/plugin-changes/node/index.ts'
import { databasePlugin } from '@acorn/plugin-database/node/index.ts'
import { dockerPlugin } from '@acorn/plugin-docker/node/index.ts'
import { editorPlugin } from '@acorn/plugin-editor/node/index.ts'
import { githubPlugin } from '@acorn/plugin-github/node/index.ts'
import { httpPlugin } from '@acorn/plugin-http/node/index.ts'
import { linearPlugin } from '@acorn/plugin-linear/node/index.ts'
import { memoryPlugin } from '@acorn/plugin-memory/node/index.ts'
import { modelProvidersPlugin } from '@acorn/plugin-model-providers/node/index.ts'
import { notesPlugin } from '@acorn/plugin-notes/node/index.ts'
import { previewPlugin, type PreviewPluginDeps } from '@acorn/plugin-preview/node/index.ts'
import { rollbarPlugin } from '@acorn/plugin-rollbar/node/index.ts'
import { terminalPlugin, type TerminalPluginDeps } from '@acorn/plugin-terminal/node/index.ts'
import { workflowsPlugin, type WorkflowsPluginDeps } from '@acorn/plugin-workflows/node/index.ts'

// Composition-only dependencies are adapters owned by the composition root: active identity, child
// process environments, native browser capabilities, and runtime engines that must be shared without
// a plugin importing another plugin's implementation. Cross-plugin domain behavior stays in the
// capability and provider registries; this bag is for runtime seams that are not domain contracts.
export type NodePluginDeps = {
  agents: AgentsPluginDeps
  // The Electron-main browser driver behind the six `browser_*` agent tools. A native adapter, so it stays
  // an app-supplied dep: a plugin may not import electron (tools/arch/boundaries.test.ts enumerates the
  // three that may, and preview's node/ is not one of them).
  preview: PreviewPluginDeps
  notes: { internalEnv: import('@acorn/node-core/server/auth/internalTokens.ts').InternalEnvFactory }
  terminal: TerminalPluginDeps
  workflows: WorkflowsPluginDeps
}

// `dataDir` is threaded in because plugin SQLite files live under the Node data root. Cross-plugin
// dependencies resolve through the capability/provider registries at call time; array order is not a
// feature contract.
export const nodePlugins = (dataDir: string, deps: NodePluginDeps): NodePlugin[] => [
  agentsPlugin(dataDir, deps.agents),
  changesPlugin(dataDir),
  databasePlugin(dataDir),
  dockerPlugin(),
  editorPlugin(),
  githubPlugin(dataDir),
  httpPlugin(dataDir),
  linearPlugin(),
  memoryPlugin(dataDir),
  modelProvidersPlugin(),
  notesPlugin(dataDir, deps.notes),
  previewPlugin(deps.preview),
  rollbarPlugin(),
  terminalPlugin(dataDir, deps.terminal),
  workflowsPlugin(dataDir, deps.workflows),
]
