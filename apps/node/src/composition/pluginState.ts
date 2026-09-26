import { installPlugin, uninstallPlugin, updatePlugin } from '@acorn/node-core/server/plugins'
import { installedPluginInfo, readClientBundle, scanInstalled, snapshotActivePlugin, type ActivePluginSnapshot, type InstalledPlugin } from '@acorn/node-core/server/plugins'
import { createPluginReloader } from '@acorn/node-core/server/plugins'
import { cascadeDeletePluginData } from '@acorn/node-core/server/db/cascade.ts'
import type { AppDatabase } from '@acorn/node-core/server/db/index.ts'
import type { PluginsBridge } from '@acorn/node-core/server/pluginHost'
import type { PluginHostResult, PluginRosterEntry } from '@acorn/node-core/server/pluginHost/host.ts'
import type { PluginLoadFailure } from '@acorn/node-core/server/plugins'
import { nodePluginNames } from './composition'

// The PLUGIN_STATE bridge, built once for both composition roots (docs/node-distribution.md §
// Plugins). Building it once here is what stops the two roots drifting on which build allows
// `{ path }` installs, and on whether the disabled set is the file alone or the file plus the start
// config.
export type DisabledPluginsStore = {
  get(): readonly string[]
  set(names: readonly string[]): void
}

// The file is the owner's setting, and the start config is a test/`dev:node` override
// (docs/node-distribution.md § Plugins). Both have to stay visible to the route, or a plugin disabled
// only in the start config shows as enabled but not running, with a Restart banner nothing can clear.
export const effectiveDisabled =
  (store: DisabledPluginsStore, extra: readonly string[] = []): (() => string[]) =>
  () => [...new Set([...store.get(), ...extra])]

export type PluginStateInput = {
  dataDir: string
  // For the purge half of an uninstall: the prefs rows a plugin's frames wrote and the schedule state
  // its manifest declared both live in the core database, not in the plugin's own file.
  db: AppDatabase
  // What the plugin host assembled in this process, and at which versions. The roster needs
  // closures, not snapshots, because a plugin's state can move after the roots capture it.
  roster(): readonly PluginRosterEntry[]
  booted(): readonly InstalledPlugin[]
  // What the loader refused at this boot, and why. A closure over the graph both roots already hold; a
  // re-scan would answer a different question (what is on disk now) and cannot answer this one at all,
  // because importing a bundle is the only way to find out that it throws.
  loadFailures(): readonly PluginLoadFailure[]
  disabled(): readonly string[]
  setDisabled(names: readonly string[]): void
  // The running plugin host, for the one mutation that does not wait for a restart
  // (@acorn/node-core/server/plugins/reload.ts). Both roots hold the `initPlugins` result already.
  reloadHost: Pick<PluginHostResult, 'reload'>
}

export async function buildPluginStateBridge(input: PluginStateInput): Promise<PluginsBridge> {
  const { dataDir } = input
  // Built here, not in each root, so the two cannot drift the way install/uninstall once did. The
  // built-in names come from the build (composition.ts), not the assembled graph: they only warn when
  // a disk package shadows a compiled one.
  const reloader = createPluginReloader({ dataDir, builtins: nodePluginNames(), host: input.reloadHost })
  // Only a service that survived init and ready can claim a running identity. Keep its bytes in this
  // process even if the package is updated or removed on disk before the next restart.
  const serving = new Set(input.roster().filter((row) => row.state === 'active' && !row.disabled).map((row) => row.name))
  const bootSnapshots = await Promise.all(input.booted().filter((entry) => serving.has(entry.manifest.id)).map(snapshotActivePlugin))
  const active = (): ReadonlyMap<string, ActivePluginSnapshot> => {
    const lost = new Set(reloader.lost())
    return new Map([...bootSnapshots, ...reloader.reloaded()].filter((entry) => !lost.has(entry.id)).map((entry) => [entry.id, entry]))
  }
  const installed = () => scanInstalled(dataDir).installed
  return {
    roster: input.roster,
    // Re-scanned per call, not the boot snapshot: an install has to show up in the roster before the
    // restart that runs it, and the device fetches its bundle from that same row to ask about it.
    installed: () => installed().map(installedPluginInfo),
    // What this process loaded, which lets the roster tell "installed and running" from "installed
    // since the last restart". A reloaded plugin's version lands after the boot snapshot in this
    // list: the consumer builds a map from it, so the later entry wins and a plugin swapped in place
    // stops claiming a restart is pending for code that is already live.
    booted: () => [...active().values()],
    loadFailures: input.loadFailures,
    clientBundle: async (id, hash) => {
      const retained = active().get(id)?.bundle
      if (retained?.hash === hash) return retained
      const candidates = installed()
      const candidate = candidates.find((entry) => entry.manifest.id === id && entry.client?.hash === hash)
      if (!candidate) return null
      const bundle = await readClientBundle([candidate], id)
      // A package can change between the advertised scan and this read. The named hash is the
      // authority for the response; never substitute new bytes under the old address.
      return bundle?.hash === hash ? bundle : null
    },
    disabled: input.disabled,
    setDisabled: input.setDisabled,
    install: (source, options) => installPlugin(dataDir, source, options),
    update: (id, options) => updatePlugin(dataDir, id, options),
    // Two halves, in this order: the package leaves disk, then the core database drops what the plugin
    // owned there. Disk first because a failure after it still leaves the plugin gone, where the reverse
    // leaves a running plugin whose state has been deleted underneath it.
    uninstall: async (id, options) => {
      const result = uninstallPlugin(dataDir, id, options)
      if (options.purgeData) await cascadeDeletePluginData(input.db, id)
      return result
    },
    reload: (id) => reloader.reload(id),
  }
}
