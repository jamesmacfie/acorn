import { installPlugin, uninstallPlugin, updatePlugin } from '@acorn/node-core/main/pluginInstaller.ts'
import { installedPluginInfo, readClientBundle, scanInstalled } from '@acorn/node-core/main/pluginLoader.ts'
import { createPluginReloader } from '@acorn/node-core/main/pluginReload.ts'
import type { PluginsBridge } from '@acorn/node-core/server/plugin/pluginState.ts'
import type { PluginHostResult, PluginRosterEntry } from '@acorn/node-core/server/plugin/host.ts'
import type { PluginLoadFailure } from '@acorn/node-core/main/pluginLoader.ts'
import { nodePluginNames } from './composition'

// The PLUGIN_STATE bridge, built once for both composition roots — the other half of the extraction
// pluginDeps.ts started. It was written out twice (service/runtime.ts and server/standalone.ts) and had
// already drifted four ways: which builds allow `{ path }` installs, whether the disabled set was the
// file alone or the file plus the start config, and which of those two the plugin host was handed.
// Kept in step by hand, invisible to every test. The differences that are real are options now.
export type DisabledPluginsStore = {
  get(): readonly string[]
  set(names: readonly string[]): void
}

// The file is the owner's setting; the start config is a test/`dev:node` override. Both are honoured,
// and both have to be visible to the route, or it reports a state a restart cannot reach: a plugin
// disabled at start showed as enabled-but-not-running with a Restart banner nothing could clear. The
// Electron root had that fix and the standalone one did not, because the fix landed in one copy of a
// paste. The union lives here now, so a root that grows an override gets it for free.
export const effectiveDisabled =
  (store: DisabledPluginsStore, extra: readonly string[] = []): (() => string[]) =>
  () => [...new Set([...store.get(), ...extra])]

export type PluginStateInput = {
  dataDir: string
  // What the plugin host assembled in THIS process, and at which versions. Snapshots rather than
  // thunks would be wrong for the roster (a plugin's state can move), so both are passed as closures
  // the roots already hold.
  roster(): readonly PluginRosterEntry[]
  booted(): readonly { id: string; version: string }[]
  // What the loader refused at this boot, and why. A closure over the graph both roots already hold; a
  // re-scan would answer a different question (what is on disk now) and cannot answer this one at all,
  // because importing a bundle is the only way to find out that it throws.
  loadFailures(): readonly PluginLoadFailure[]
  disabled(): readonly string[]
  setDisabled(names: readonly string[]): void
  // `{ path }` installs symlink an author's working tree into the install directory, so they are a
  // development affordance and gated on the build being one. The two roots answer "is this a dev
  // build" differently because they genuinely have different evidence: Electron has a packaging flag,
  // and a standalone node has only NODE_ENV. That is the one divergence kept on purpose.
  allowLocalPathInstalls: boolean
  // The running plugin host, for the one mutation that does not wait for a restart
  // (@acorn/node-core/main/pluginReload.ts). Both roots hold the `initPlugins` result already.
  reloadHost: Pick<PluginHostResult, 'reload'>
}

export function buildPluginStateBridge(input: PluginStateInput): PluginsBridge {
  const { dataDir, allowLocalPathInstalls: allowLocalPath } = input
  // Built here rather than in each root, so the two cannot drift the way install/uninstall once did. The
  // built-in names come from the BUILD (composition.ts), not from the assembled graph: they are only used
  // to warn when a disk package shadows a compiled one.
  const reloader = createPluginReloader({ dataDir, builtins: nodePluginNames(), host: input.reloadHost })
  return {
    roster: input.roster,
    // Re-scanned per call, not the boot snapshot: an install has to show up in the roster before the
    // restart that runs it, and the device fetches its bundle from that same row to ask about it.
    installed: () => scanInstalled(dataDir).installed.map(installedPluginInfo),
    // What this process loaded, which is how the roster tells "installed and running" from
    // "installed since the last restart". A reloaded plugin's version lands AFTER the boot snapshot on
    // purpose: the consumer builds a Map from this list, so the later entry wins and a plugin swapped in
    // place stops claiming a restart is pending for code that is already live.
    booted: () => [...input.booted(), ...reloader.reloaded()],
    loadFailures: input.loadFailures,
    clientBundle: (id) => readClientBundle(scanInstalled(dataDir).installed, id),
    disabled: input.disabled,
    setDisabled: input.setDisabled,
    install: (source, options) => installPlugin(dataDir, source, { ...options, allowLocalPath }),
    update: (id, options) => updatePlugin(dataDir, id, { ...options, allowLocalPath }),
    uninstall: (id, options) => uninstallPlugin(dataDir, id, options),
    reload: (id) => reloader.reload(id),
  }
}
