// Reloading one loaded plugin's node half in a running process (docs/plugins/dev-loop.md § The dev loop).
//
// The split with server/pluginHost/host.ts matches the boot path. This half does the disk work: re-scan,
// start a fresh worker realm with a fresh module graph, re-resolve the manifest's migrations chain. The host owns the
// lifecycle, candidate-then-commit, and containment, so a reload gets the containment a boot gets.
//
// Loaded plugins only. A built-in is compiled into this binary, so there is no second copy on disk
// to swap in.
import { broadcastPluginsChanged } from '../notify'
import { loadedPluginBinding, loadExternalPlugins, snapshotActivePlugin, type ActivePluginSnapshot } from './loader'
import { disposeUnstartedPlugin } from './isolation'
import type { PluginHostResult } from '../pluginHost/host'
import type { PluginReloadResult } from '@acorn/protocol/api.ts'

export type PluginReloader = {
  reload(id: string): Promise<PluginReloadResult>
  // What has been reloaded since boot, at the version running. The roster answers "is a restart
  // pending" by comparing the disk against what this process loaded, and after a reload the boot
  // snapshot is stale: a plugin whose version moved would raise a banner for code already live.
  reloaded(): readonly ActivePluginSnapshot[]
  /** A replay failure after commit removed the previous service; its old boot snapshot is invalid. */
  lost(): readonly string[]
}

export function createPluginReloader(options: {
  dataDir: string
  builtins: readonly string[]
  host: Pick<PluginHostResult, 'reload'>
}): PluginReloader {
  const committed = new Map<string, ActivePluginSnapshot>()
  const lost = new Set<string>()
  return {
    reloaded: () => [...committed.values()],
    lost: () => [...lost],
    reload: async (id) => {
      // The whole install directory, not just this package. `loadExternalPlugins` is the one place
      // that reads a manifest, confines a migrations chain, and checks an id against its bundle, so
      // duplicating a quarter of it here would be a second loader to keep in step. Only `id` is
      // considered.
      const { loaded, installed, failures } = await loadExternalPlugins(options.dataDir, { builtins: options.builtins, reimport: [id] })
      const entry = loaded.find((candidate) => candidate.manifest.id === id)
      for (const candidate of loaded) if (candidate !== entry) disposeUnstartedPlugin(candidate.plugin)
      if (!entry) {
        // The loader's own sentence when it has one, such as a bundle that threw on import, because
        // that names what the author has to fix.
        const failure = failures.find((candidate) => candidate.id === id)
        throw new Error(failure ? failure.reason : `No plugin '${id}' with a node half is installed on this node.`)
      }
      const packageEntry = installed.find((candidate) => candidate.manifest.id === id)
      if (!packageEntry) throw new Error(`No installed declaration for '${id}' was retained by the loader.`)
      const snapshot = await snapshotActivePlugin(packageEntry)
      const outcome = await options.host.reload(id, {
        plugin: entry.plugin,
        // The same binding a boot builds. A reload that dropped part of it would take away the
        // plugin's schedules, checks, data sources, audit verbs, or harnesses until the next boot.
        binding: loadedPluginBinding(entry),
      })
      // Broadcast either way. A failed reload still changed the roster row the settings page
      // renders, and the client's reconcile is a re-read of state it can already fetch.
      broadcastPluginsChanged()
      if (!outcome.ok) {
        if (outcome.retained === false) {
          committed.delete(id)
          lost.add(id)
        }
        return { id, version: entry.manifest.version, state: 'failed', reason: outcome.error }
      }
      committed.set(id, snapshot)
      lost.delete(id)
      return { id, version: entry.manifest.version, state: 'reloaded' }
    },
  }
}
