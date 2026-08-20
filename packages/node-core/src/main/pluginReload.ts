// Reloading one loaded plugin's node half in a running process (docs/plugins.md § The dev loop).
//
// The split with server/plugin/host.ts matches the boot path: this half does the disk work (re-scan,
// re-import past Node's module cache, re-resolve the manifest's migrations chain) and the host owns the
// lifecycle, candidate-then-commit and containment. So a reload gets exactly the containment a boot gets.
//
// Loaded plugins only. A built-in is compiled into this binary, so there's no second copy on disk to
// swap in, and its restart-required flow already works.
import { broadcastPluginsChanged } from './notify'
import { loadExternalPlugins } from './pluginLoader'
import type { PluginHostResult } from '../server/plugin/host'
import type { PluginReloadResult } from '@acorn/protocol/api.ts'

export type PluginReloader = {
  reload(id: string): Promise<PluginReloadResult>
  // What has been reloaded since boot, at the version now running. The roster's "is a restart pending"
  // answer compares the disk against what this process loaded, and after a reload the boot snapshot is
  // no longer that: a plugin whose version moved would raise a restart banner for code already live.
  reloaded(): readonly { id: string; version: string }[]
}

export function createPluginReloader(options: {
  dataDir: string
  builtins: readonly string[]
  host: Pick<PluginHostResult, 'reload'>
}): PluginReloader {
  const versions = new Map<string, string>()
  return {
    reloaded: () => [...versions].map(([id, version]) => ({ id, version })),
    reload: async (id) => {
      // The whole install directory, not just this package. `loadExternalPlugins` is the one place that
      // knows how to read a manifest, confine a migrations chain and check an id against its bundle, and
      // duplicating a quarter of it here to save re-importing a handful of cached modules would be a
      // second loader to keep in step. Only `id` is re-evaluated.
      const { loaded, failures } = await loadExternalPlugins(options.dataDir, { builtins: options.builtins, reimport: [id] })
      const entry = loaded.find((candidate) => candidate.manifest.id === id)
      if (!entry) {
        // The loader's own sentence when it has one, such as a bundle that threw on import or a manifest
        // that stopped parsing, because that's what the author has to fix.
        const failure = failures.find((candidate) => candidate.id === id)
        throw new Error(failure ? failure.reason : `No plugin '${id}' with a node half is installed on this node.`)
      }
      const outcome = await options.host.reload(id, {
        plugin: entry.plugin,
        binding: { permissions: entry.manifest.permissions.node, storage: entry.storage },
      })
      // Broadcast either way. A failed reload still changed the roster row the settings page renders, and
      // the client's reconcile is a re-read of state it can already fetch.
      broadcastPluginsChanged()
      if (!outcome.ok) return { id, version: entry.manifest.version, state: 'failed', reason: outcome.error }
      versions.set(id, entry.manifest.version)
      return { id, version: entry.manifest.version, state: 'reloaded' }
    },
  }
}
