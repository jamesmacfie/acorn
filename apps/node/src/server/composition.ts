import type { AppDatabase } from '@acorn/node-core/server/db/index.ts'
import { drainWithDeadline } from '@acorn/node-core/main/server.ts'
import { reconcileWorktrees } from '@acorn/node-core/main/taskWorktree.ts'
import { logStorageFootprint } from '@acorn/node-core/main/storageFootprint.ts'
import type { CapabilityRegistry } from '@acorn/node-core/server/plugin/capabilities.ts'
import type { NodePlugin } from '@acorn/node-core/server/plugin/types.ts'
import { loadExternalPlugins, type InstalledPlugin } from '@acorn/node-core/main/pluginLoader.ts'
import type { NodePermissions } from '@acorn/node-core/main/pluginManifest.ts'
import { AGENTS_RUNTIME } from '@acorn/plugin-agents/contract/runtime.ts'
import { GITHUB_MIRROR } from '@acorn/plugin-github/contract/mirror.ts'
import { reconcileTmux } from '@acorn/plugin-terminal/main/index.ts'
import { WORKFLOWS_RUNNER } from '@acorn/plugin-workflows/contract/runner.ts'
import { nodePlugins, type NodePluginDeps } from './plugins'

// Both Node hosts assemble the same graph. The Electron app supervises this graph; it does not own a
// second implementation of it. Keeping this in apps/node preserves the dependency direction: the graph
// names plugins, while node-core must remain independent of plugins.
export const NODE_DRAIN_ORDER = ['listener', 'reconciliation', 'plugin state', 'plugins', 'sqlite', 'data root'] as const

export type NodeComposition = {
  plugins: NodePlugin[]
  // The subset that came off disk, keyed by name, carrying its manifest's node permissions. The host
  // takes this as the one signal that a plugin is contained and permission-shaped.
  loaded: ReadonlyMap<string, NodePermissions>
  // Every package on disk, including the client-only ones that produced no NodePlugin. This is what
  // the roster route distributes from; `loaded` above is only what this process runs.
  installed: readonly InstalledPlugin[]
  drainOrder: typeof NODE_DRAIN_ORDER
}

// Async because loading a plugin from disk is an `await import()`. Both composition roots already
// awaited initPlugins around this call, so the graph is assembled at the same point it always was.
//
// The loader is inert without ACORN_UNSAFE_PLUGINS=1 (main/pluginLoader.ts explains why), so an
// unflagged boot — which is every packaged boot today — gets exactly the static list and nothing else.
export async function assembleNodeGraph(dataDir: string, deps: NodePluginDeps): Promise<NodeComposition> {
  const builtins = nodePlugins(dataDir, deps)
  const { loaded, installed } = await loadExternalPlugins(dataDir, { builtins: builtins.map((plugin) => plugin.name) })
  // A loaded plugin may deliberately replace a built-in of the same id — that is how the loader is
  // dogfooded (scripts/build-plugin.mjs). Only one of them may be in the graph: the ids are route
  // namespaces and database filenames, and initPlugins rejects a duplicate name outright.
  const shadowed = new Set(loaded.filter((entry) => entry.shadowsBuiltin).map((entry) => entry.manifest.id))
  return {
    plugins: [...builtins.filter((plugin) => !shadowed.has(plugin.name)), ...loaded.map((entry) => entry.plugin)],
    loaded: new Map(loaded.map((entry) => [entry.manifest.id, entry.manifest.permissions.node])),
    installed,
    drainOrder: NODE_DRAIN_ORDER,
  }
}

// The compiled-in list only. Deliberately not derived from assembleNodeGraph: this is the parity
// fixture the standalone/supervised comparison uses, and it must describe what the BUILD contains,
// not what happens to be installed in whichever data root the process was pointed at.
export const nodePluginNames = (): string[] => nodePlugins('', {} as NodePluginDeps).map((plugin) => plugin.name)

export type ReconcileOptions = {
  db: AppDatabase
  dataDir: string
  capabilities: Pick<CapabilityRegistry, 'get' | 'require'>
  mark?(step: string): void
}

// The post-listener sequence is shared by the supervised and standalone hosts. Host-specific work
// (Electron MCP registration, state transitions, and the final ready signal) remains at the call site.
export async function reconcileNode({ db, dataDir, capabilities, mark = () => {} }: ReconcileOptions): Promise<void> {
  const githubMirror = capabilities.get(GITHUB_MIRROR)
  void logStorageFootprint(
    db,
    dataDir,
    githubMirror ? [{ plugin: 'github', counts: () => githubMirror.footprint() }] : [],
  ).catch((error) => console.warn('[storage] footprint failed:', error))

  try {
    await reconcileTmux()
    mark('reconcile.tmux')
  } catch (error) {
    console.warn('[node:reconcile] tmux reconcile failed:', error)
  }
  try {
    await reconcileWorktrees(db)
    mark('reconcile.worktrees')
  } catch (error) {
    console.warn('[node:reconcile] worktree reconcile failed:', error)
  }
  try {
    await capabilities.get(WORKFLOWS_RUNNER)?.reconcile()
    mark('reconcile.workflow')
  } catch (error) {
    console.warn('[node:reconcile] workflow reconcile failed:', error)
  }
  try {
    await capabilities.require(AGENTS_RUNTIME).reconcile()
    mark('reconcile.agents')
  } catch (error) {
    console.warn('[node:reconcile] managed agents reconcile failed:', error)
  }
}

export type NodeDrainResources = {
  listener: () => Promise<unknown>
  reconciliation: () => Promise<unknown>
  pluginState: () => Promise<unknown>
  plugins: () => Promise<unknown>
  sqlite: () => Promise<unknown>
  dataRoot: () => Promise<unknown>
}

export function drainNode(resources: NodeDrainResources): Promise<'drained' | 'timeout'> {
  return drainWithDeadline([
    ['listener', resources.listener],
    ['reconciliation', resources.reconciliation],
    ['plugin state', resources.pluginState],
    ['plugins', resources.plugins],
    ['sqlite', resources.sqlite],
    ['data root', resources.dataRoot],
  ])
}
