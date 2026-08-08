import type { AppDatabase } from '@acorn/node-core/server/db/index.ts'
import { drainWithDeadline } from '@acorn/node-core/main/server.ts'
import { reconcileWorktrees } from '@acorn/node-core/main/taskWorktree.ts'
import { logStorageFootprint } from '@acorn/node-core/main/storageFootprint.ts'
import type { CapabilityRegistry } from '@acorn/node-core/server/plugin/capabilities.ts'
import type { NodePlugin } from '@acorn/node-core/server/plugin/types.ts'
import { AGENTS_RUNTIME } from '@acorn/plugin-agents/contract/runtime.ts'
import { GITHUB_MIRROR } from '@acorn/plugin-github/contract/mirror.ts'
import { reconcileTmux } from '@acorn/plugin-terminal/main/index.ts'
import { WORKFLOWS_RUNNER } from '@acorn/plugin-workflows/contract/runner.ts'
import { nodePlugins, type NodePluginDeps } from './plugins'

// Both Node hosts assemble the same graph. The Electron app supervises this graph; it does not own a
// second implementation of it. Keeping this in apps/node preserves the dependency direction: the graph
// names plugins, while node-core must remain independent of plugins.
export const NODE_DRAIN_ORDER = ['listener', 'reconciliation', 'plugin state', 'plugins', 'sqlite', 'data root'] as const

export type NodeComposition = { plugins: NodePlugin[]; drainOrder: typeof NODE_DRAIN_ORDER }

export function assembleNodeGraph(dataDir: string, deps: NodePluginDeps): NodeComposition {
  return { plugins: nodePlugins(dataDir, deps), drainOrder: NODE_DRAIN_ORDER }
}

export const nodePluginNames = (): string[] => assembleNodeGraph('', {} as NodePluginDeps).plugins.map((plugin) => plugin.name)

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
