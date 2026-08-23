// The Node activation list (docs/plugins.md § Activation). The host supplies routes, capabilities,
// CoreServices, tools, providers, context sections, storage, and lifecycle hooks through
// NodePluginContext.
import type { NodePlugin } from '@acorn/node-core/server/plugin/types.ts'
import { agentsPlugin, type AgentsPluginDeps } from '@acorn/plugin-agents/node/index.ts'
import { browserPlugin } from '@acorn/plugin-browser/node/index.ts'
import { changesPlugin } from '@acorn/plugin-changes/node/index.ts'
import { dockerPlugin } from '@acorn/plugin-docker/node/index.ts'
import { editorPlugin } from '@acorn/plugin-editor/node/index.ts'
import { githubPlugin } from '@acorn/plugin-github/node/index.ts'
import { memoryPlugin } from '@acorn/plugin-memory/node/index.ts'
import { notesPlugin } from '@acorn/plugin-notes/node/index.ts'
import { previewPlugin } from '@acorn/plugin-preview/node/index.ts'
import { terminalPlugin, type TerminalPluginDeps } from '@acorn/plugin-terminal/node/index.ts'
import { workflowsPlugin, type WorkflowsPluginDeps } from '@acorn/plugin-workflows/node/index.ts'

// Composition-only dependencies are adapters owned by the composition root: active identity, child
// process environments, and runtime engines that must be shared without a plugin importing another
// plugin's implementation. Cross-plugin domain behavior stays in the
// capability and provider registries; this bag is for runtime seams that are not domain contracts.
export type NodePluginDeps = {
  agents: AgentsPluginDeps
  notes: { internalEnv: import('@acorn/node-core/server/auth/internalTokens.ts').InternalEnvFactory }
  terminal: TerminalPluginDeps
  workflows: WorkflowsPluginDeps
}

// `dataDir` is threaded in for the three plugins that write files of their own under the data root:
// agents' attachments and artifacts, memory's index sources, notes' markdown. A plugin does not need
// it to open a database, because the host does that behind `ctx.storage` from the plugin's declared
// `migrationsModule`. Cross-plugin dependencies resolve through the capability and provider
// registries at call time, and array order is not a feature contract.
export const nodePlugins = (dataDir: string, deps: NodePluginDeps): NodePlugin[] => [
  agentsPlugin(dataDir, deps.agents),
  browserPlugin(),
  changesPlugin(),
  dockerPlugin(),
  editorPlugin(),
  githubPlugin(),
  memoryPlugin(dataDir),
  notesPlugin(dataDir, deps.notes),
  previewPlugin(),
  terminalPlugin(deps.terminal),
  workflowsPlugin(deps.workflows),
]
