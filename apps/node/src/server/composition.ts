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

// Both Node hosts assemble the same graph. The Electron app supervises this graph; it does not own a
// second implementation of it. Keeping this in apps/node preserves the dependency direction: the graph
// names plugins, while node-core must remain independent of plugins.
export const NODE_DRAIN_ORDER = ['listener', 'reconciliation', 'schedules', 'plugin state', 'plugins', 'sqlite', 'data root'] as const

export type NodeComposition = {
  plugins: NodePlugin[]
  // The subset that came off disk, keyed by name, carrying its manifest-shaped permissions and
  // storage. The host takes this as the one signal that a plugin is contained.
  loaded: ReadonlyMap<string, LoadedPluginBinding>
  // Every package on disk, including the client-only ones that produced no NodePlugin. This is what
  // the roster route distributes from; `loaded` above is only what this process runs.
  installed: readonly InstalledPlugin[]
  // Why the rest of the install directory produced nothing. Kept rather than dropped: the loader's report
  // is the only place a bad manifest or an unimportable bundle is ever explained, and it used to end at a
  // console.error. Both roots hand this to the PLUGIN_STATE bridge, which is how it reaches the roster
  // row and the attention bell.
  failures: readonly PluginLoadFailure[]
  drainOrder: typeof NODE_DRAIN_ORDER
}

// Async because loading a plugin from disk is an `await import()`. Both composition roots already
// awaited initPlugins around this call, so the graph is assembled at the same point it always was.
//
// A boot with an empty install directory — which is every fresh install — gets exactly the static list
// and nothing else. Anything extra arrived through the installer, which is an owner-authenticated route
// (docs/plugins.md).
export async function assembleNodeGraph(dataDir: string, deps: NodePluginDeps): Promise<NodeComposition> {
  const builtins = nodePlugins(dataDir, deps)
  const { loaded, installed, failures } = await loadExternalPlugins(dataDir, { builtins: builtins.map((plugin) => plugin.name) })
  // A loaded plugin may deliberately replace a built-in of the same id — that is how the loader is
  // dogfooded (scripts/build-plugin.mjs). Only one of them may be in the graph: the ids are route
  // namespaces and database filenames, and initPlugins rejects a duplicate name outright.
  const shadowed = new Set(loaded.filter((entry) => entry.shadowsBuiltin).map((entry) => entry.manifest.id))
  return {
    plugins: [...builtins.filter((plugin) => !shadowed.has(plugin.name)), ...loaded.map((entry) => entry.plugin)],
    loaded: new Map(loaded.map((entry) => [
      entry.manifest.id,
      { permissions: entry.manifest.permissions.node, storage: entry.storage, schedules: entry.manifest.contributions.schedules },
    ])),
    installed,
    failures,
    drainOrder: NODE_DRAIN_ORDER,
  }
}

// The compiled-in list only. Deliberately not derived from assembleNodeGraph: this is the parity
// fixture the standalone/supervised comparison uses, and it must describe what the BUILD contains,
// not what happens to be installed in whichever data root the process was pointed at.
export const nodePluginNames = (): string[] => nodePlugins('', {} as NodePluginDeps).map((plugin) => plugin.name)

export type BundledReconcileOptions = {
  dataDir: string
  /** Where the app's own read-only plugin packages live. Absent means there are none to reconcile FROM:
   * a service-managed standalone node has no `resourcesPath`, and that is the whole difference between
   * the two hosts here (docs/node-distribution.md § Plugins). */
  bundledRoot?: string | undefined
  /** A packaged app is not a development build. Only used to decide whether to print the escape hatch
   * for a frozen ownership row, which is a developer's problem and a user's normal state. */
  development: boolean
}

/** Reconcile app-owned plugin packages into the data root, then account for every outcome — including
 * the ones that used to be silent.
 *
 * Shared by both Node hosts rather than copied into each: this used to be an inline block in the
 * supervised root only, so `pnpm dev:node` ran whatever the last `build:plugin` left behind forever and
 * printed none of these lines. Reconciliation itself is still gated on a bundled root, so nothing
 * changes for a node that has none. */
export function reconcileBundledPackages({ dataDir, bundledRoot, development }: BundledReconcileOptions): void {
  const preserved: string[] = []
  if (bundledRoot) {
    const bundled = reconcileBundledPlugins(dataDir, bundledRoot)
    preserved.push(...bundled.preserved)
    if (bundled.installed.length || bundled.updated.length) {
      console.log(`[plugins] bundled packages: installed ${bundled.installed.join(', ') || 'none'}; updated ${bundled.updated.join(', ') || 'none'}`)
    }
    // An uninstall writes a tombstone outside the package directory so a later app update cannot restore
    // it (main/bundledPluginState.ts) — deliberate, and indistinguishable from a feature that was never
    // built: the plugin ships in every app version from then on and never appears, with no output
    // anywhere. Reinstalling it is the fix, and nothing said so.
    if (bundled.removed.length) {
      console.log(`[plugins] bundled packages NOT restored (uninstalled on this node; install again to get them back): ${bundled.removed.join(', ')}`)
    }
    for (const failure of bundled.failures) {
      console.error(`[plugins] bundled ${failure.id} was not reconciled: ${failure.reason}`)
    }
  }

  // `preserved` used to be the only account of this, which is how a package that had quietly stopped
  // taking updates looked exactly like one that had never needed any. It is also the account a node with
  // no bundled root cannot give, so the ownership rows are read directly and unioned in: the row is what
  // freezes the package, whether or not there was a newer copy to refuse this boot.
  const frozen = [...new Set([...preserved, ...userManagedPluginIds(dataDir)])].sort()
  if (frozen.length === 0) return
  console.log(`[plugins] NOT taking app updates (installed by the owner on this node): ${frozen.join(', ')}`)
  if (development) {
    // Only in a development build, because for a user this row is correct and permanent — an owner
    // install must never be replaced by a bundled copy. For a developer it is a trap that is easy to
    // acquire (a hand-copied directory earns one) and used to have no visible escape at all.
    console.log(`[plugins] an ownership row is never replaced by an app build. To hand one back, delete its entry from ${bundledPluginStatePath(dataDir)} — \`build:plugin <id>\` already does that for a package it writes into this data root.`)
  }
}

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
  // After the listener (so `run now` cannot arrive mid-drain) and before plugins and SQLite, because a
  // scheduled run holds a database handle and may be calling into a plugin's capability.
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
