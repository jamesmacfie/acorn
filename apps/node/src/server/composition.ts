import type { AppDatabase } from '@acorn/node-core/server/db/index.ts'
import { drainWithDeadline } from '@acorn/node-core/main/server.ts'
import { reconcileWorktrees } from '@acorn/node-core/main/taskWorktree.ts'
import { logStorageFootprint } from '@acorn/node-core/main/storageFootprint.ts'
import type { CapabilityRegistry } from '@acorn/node-core/server/plugin/capabilities.ts'
import type { NodePlugin } from '@acorn/node-core/server/plugin/types.ts'
import type { LoadedPluginBinding } from '@acorn/node-core/server/plugin/host.ts'
import { loadExternalPlugins, type InstalledPlugin, type PluginLoadFailure } from '@acorn/node-core/main/pluginLoader.ts'
import { reconcileBundledPlugins } from '@acorn/node-core/main/bundledPlugins.ts'
import { bundledPluginStatePath, userManagedPluginIds } from '@acorn/node-core/main/bundledPluginState.ts'
import { AGENTS_RUNTIME } from '@acorn/plugin-agents/contract/runtime.ts'
import { GITHUB_MIRROR } from '@acorn/plugin-github/contract/mirror.ts'
import { reconcileTmux } from '@acorn/plugin-terminal/main/index.ts'
import { WORKFLOWS_RUNNER } from '@acorn/plugin-workflows/contract/runner.ts'
import { nodePlugins, type NodePluginDeps } from './plugins'

// Both Node hosts assemble the same graph here (docs/node-distribution.md § Runtime); the Electron
// app supervises it rather than owning a second implementation. Keeping this in apps/node keeps the
// dependency direction right: the graph names plugins, and node-core stays independent of them
// (docs/architecture-overview.md § Package boundaries).
export const NODE_DRAIN_ORDER = ['listener', 'reconciliation', 'schedules', 'plugin state', 'plugins', 'sqlite', 'data root'] as const

export type NodeComposition = {
  plugins: NodePlugin[]
  // The subset that came off disk, keyed by name, carrying its manifest-shaped permissions and
  // storage. The host takes this as the one signal that a plugin is contained.
  loaded: ReadonlyMap<string, LoadedPluginBinding>
  // Every package on disk, including the client-only ones that produced no NodePlugin. This is what
  // the roster route distributes from; `loaded` above is only what this process runs.
  installed: readonly InstalledPlugin[]
  // Why the rest of the install directory produced nothing (docs/plugins.md § Loaded plugins,
  // "Failures are contained, and every failure names itself"). Both roots hand this to the
  // PLUGIN_STATE bridge, which is how it reaches the roster row and the attention inbox.
  failures: readonly PluginLoadFailure[]
  drainOrder: typeof NODE_DRAIN_ORDER
}

// Async because loading a plugin from disk is an `await import()`. Both composition roots already
// awaited initPlugins around this call, so the graph assembles at the same point it always did.
//
// A fresh install's empty directory gets exactly the static list. Anything extra arrived through the
// installer, an owner-authenticated route (docs/plugins.md § Loaded plugins).
export async function assembleNodeGraph(dataDir: string, deps: NodePluginDeps): Promise<NodeComposition> {
  const builtins = nodePlugins(dataDir, deps)
  const { loaded, installed, failures } = await loadExternalPlugins(dataDir, { builtins: builtins.map((plugin) => plugin.name) })
  // A loaded plugin may replace a built-in of the same id, which is how the loader gets dogfooded
  // (scripts/build-plugin.mjs). Only one of them lands in the graph: the ids are route namespaces and
  // database filenames, and initPlugins rejects a duplicate name outright.
  const shadowed = new Set(loaded.filter((entry) => entry.shadowsBuiltin).map((entry) => entry.manifest.id))
  return {
    plugins: [...builtins.filter((plugin) => !shadowed.has(plugin.name)), ...loaded.map((entry) => entry.plugin)],
    loaded: new Map(loaded.map((entry) => [
      entry.manifest.id,
      {
        permissions: entry.manifest.permissions.node,
        storage: entry.storage,
        schedules: entry.manifest.contributions.schedules,
        collections: entry.manifest.contributions.collections,
        commands: entry.manifest.contributions.commands,
        taskChecks: entry.manifest.contributions.taskChecks,
      },
    ])),
    installed,
    failures,
    drainOrder: NODE_DRAIN_ORDER,
  }
}

// The compiled-in list only, not derived from assembleNodeGraph: it is the parity fixture the
// standalone/supervised comparison uses (docs/testing.md § Composition-root tests), and it must
// describe what the build contains, not what happens to be installed in whichever data root the
// process was pointed at.
export const nodePluginNames = (): string[] => nodePlugins('', {} as NodePluginDeps).map((plugin) => plugin.name)

export type BundledReconcileOptions = {
  dataDir: string
  /** Where the app's own read-only plugin packages live. Absent means there is nothing to reconcile
   * from: a service-managed standalone node has no `resourcesPath` (docs/node-distribution.md §
   * Plugins). */
  bundledRoot?: string | undefined
  /** A packaged app is not a development build. Only used to decide whether to print the escape hatch
   * for a frozen ownership row, which is a developer's problem and a user's normal state. */
  development: boolean
}

/** Reconcile app-owned plugin packages into the data root, then report every outcome
 * (docs/node-distribution.md § Plugins). Shared by both Node hosts rather than copied into each: this
 * used to be inline in the supervised root only, so `pnpm dev:node` ran whatever `build:plugin` last
 * left behind and printed none of these lines. */
export function reconcileBundledPackages({ dataDir, bundledRoot, development }: BundledReconcileOptions): void {
  const preserved: string[] = []
  if (bundledRoot) {
    const bundled = reconcileBundledPlugins(dataDir, bundledRoot)
    preserved.push(...bundled.preserved)
    if (bundled.installed.length || bundled.updated.length) {
      console.log(`[plugins] bundled packages: installed ${bundled.installed.join(', ') || 'none'}; updated ${bundled.updated.join(', ') || 'none'}`)
    }
    // Tombstoned outside the package directory so a later app update cannot restore it
    // (docs/plugins.md § Loaded plugins).
    if (bundled.removed.length) {
      console.log(`[plugins] bundled packages NOT restored (uninstalled on this node; install again to get them back): ${bundled.removed.join(', ')}`)
    }
    for (const failure of bundled.failures) {
      console.error(`[plugins] bundled ${failure.id} was not reconciled: ${failure.reason}`)
    }
  }

  // `preserved` alone cannot name a package frozen on a node with no newer copy to decline
  // (docs/plugins.md § Loaded plugins), so the ownership rows are read directly and unioned in: the
  // row is what freezes the package.
  const frozen = [...new Set([...preserved, ...userManagedPluginIds(dataDir)])].sort()
  if (frozen.length === 0) return
  console.log(`[plugins] NOT taking app updates (installed by the owner on this node): ${frozen.join(', ')}`)
  if (development) {
    // Development only (docs/plugins.md § Loaded plugins): for a user this row is correct and
    // permanent, an owner install must never be replaced by a bundled copy.
    console.log(`[plugins] an ownership row is never replaced by an app build. To hand one back, delete its entry from ${bundledPluginStatePath(dataDir)} — \`build:plugin <id>\` already does that for a package it writes into this data root.`)
  }
}

export type ReconcileOptions = {
  db: AppDatabase
  dataDir: string
  capabilities: Pick<CapabilityRegistry, 'get' | 'require'>
  mark?(step: string): void
}

// The post-listener sequence shared by both hosts (docs/node-distribution.md § Runtime).
// Host-specific work, Electron MCP registration, state transitions, the final ready signal, stays at
// the call site.
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
  // After the listener and before plugins and SQLite (docs/schedules.md § Why the node, and only the
  // node): a scheduled run holds a database handle and may call into a plugin's capability.
  schedules: () => Promise<unknown>
  pluginState: () => Promise<unknown>
  plugins: () => Promise<unknown>
  sqlite: () => Promise<unknown>
  dataRoot: () => Promise<unknown>
}

export function drainNode(resources: NodeDrainResources): Promise<'drained' | 'timeout'> {
  return drainWithDeadline([
    ['listener', resources.listener],
    ['reconciliation', resources.reconciliation],
    ['schedules', resources.schedules],
    ['plugin state', resources.pluginState],
    ['plugins', resources.plugins],
    ['sqlite', resources.sqlite],
    ['data root', resources.dataRoot],
  ])
}
