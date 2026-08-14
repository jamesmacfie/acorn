import { routeCapability } from '../bridge'
import type { PluginRosterEntry } from './host'
import type { InstalledPluginInfo } from '../../main/pluginLoader'
import type {
  InstalledPluginRow,
  NodePluginRow,
  PluginInstallResult,
  PluginInstallSource,
  PluginUninstallResult,
  PluginUpdateResult,
} from '@acorn/protocol/api.ts'

// Which plugins this node runs, and the owner's toggle (docs/ui-design.md § New surfaces, "Settings →
// Plugins"). A bridge rather than a direct read, because the roster only exists once the composition
// root has run the plugin host, and the persisted list is a file in the data root rather than a table —
// both live one layer above the server (main/disabledPlugins.ts).
//
// The bridge and the reconciliation below sit together, one layer under the route, because they answer
// one question: what is the plugin situation on this node, and does it need a restart. The route above
// is parse → call → respond; this module is testable with plain objects, no Hono.
//
// `restartRequired` is honest rather than clever: a plugin's routes, tables and jobs are wired at init,
// so nothing short of a restart can add or remove them. plugins.md says the same ("disabling
// unregisters contributions at next startup"), and the alternative — re-running the host in a live
// process — would have to tear down SQLite handles under in-flight requests.
export type PluginsBridge = {
  roster(): readonly PluginRosterEntry[]
  // Every package on disk RIGHT NOW, including the client-only ones the host never saw. Separate
  // from `roster()` because the roster describes what this PROCESS assembled, and a package with no
  // node half never enters the plugin host at all — but its bundle is exactly what phase 2
  // distributes, so it still has to appear.
  //
  // Re-read per call rather than snapshotted at boot: after an install or an uninstall the two answers
  // differ, and that difference IS the pending state this route reports.
  installed(): readonly InstalledPluginInfo[]
  // What this process actually loaded, at the version it loaded. The counterpart to `installed()`, and
  // the only way to tell "installed and running" from "installed since the last restart".
  booted(): readonly { id: string; version: string }[]
  // The client bundle's bytes, hashed at read time. Kept on the bridge rather than done in the
  // route because the file lives under the data root, which the server layer has no handle on.
  clientBundle(id: string): Promise<{ bytes: Uint8Array<ArrayBuffer>; hash: string } | null>
  // The names the owner currently has turned off, which is NOT derivable from the roster after a
  // restart-pending write: the roster describes the RUNNING process.
  disabled(): readonly string[]
  setDisabled(names: readonly string[]): void
  // The installer (main/pluginInstaller.ts), reached the same way everything else here is: it needs the
  // data root, which the server layer has no handle on. Each throws a plain Error carrying a sentence
  // for the owner; the handlers turn that into one 400.
  install(source: PluginInstallSource, options: { allowDowngrade?: boolean }): Promise<PluginInstallResult>
  update(id: string, options: { allowDowngrade?: boolean }): Promise<PluginUpdateResult>
  uninstall(id: string, options: { purgeData?: boolean }): PluginUninstallResult
}

export const PLUGIN_STATE = routeCapability<PluginsBridge>('core.pluginStateRoute')

// What `declared()` below sends to a device: everything the loader knows about a package, minus the
// two fields that are this node's own bookkeeping.
type DeclaredRow = Omit<InstalledPluginInfo, 'id' | 'hasNode'>

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

// `declared()` builds the wire row by rest-spread, which keeps one projection instead of the two this
// module used to have — but a spread FAILS OPEN. TypeScript does not apply excess-property checks to a
// value that arrives through a variable, so a field added to `InstalledPluginInfo` for the node's own
// use would ship to every paired device, silently, forever.
//
// This is the check that makes it fail closed instead. Adding a field to either side is now a build
// error that says so, and the fix is a deliberate one line: name it in the `Omit` above to keep it on
// the node, or add it to `InstalledPluginRow` to publish it on purpose.
const DECLARED_ROW_IS_EXACTLY_THE_WIRE_ROW: Exact<keyof DeclaredRow, keyof InstalledPluginRow> = true
void DECLARED_ROW_IS_EXACTLY_THE_WIRE_ROW

// The running plugin set, plus the pending one. They differ exactly when a toggle has been saved and
// the node has not restarted, which is the state the UI has to render.
export const pluginState = (bridge: PluginsBridge): { plugins: NodePluginRow[]; restartRequired: boolean } => {
  const pending = new Set(bridge.disabled())
  const installed = new Map(bridge.installed().map((entry) => [entry.id, entry]))
  // What this process loaded, at the version it loaded. A package on disk that is absent here, or here
  // at a different version, arrived after the last start; one here but no longer on disk was
  // uninstalled and is still serving. Both are the same answer for the owner: restart.
  const booted = new Map(bridge.booted().map((entry) => [entry.id, entry.version]))
  const stale = (id: string): boolean => {
    const running = booted.get(id)
    const onDisk = installed.get(id)?.version
    if (!onDisk) return running !== undefined
    return running !== onDisk
  }
  // Present only for a package that came off disk. A built-in's version is the app's, and it has no
  // manifest and no bundle to distribute, so the whole block is absent rather than filled with nulls.
  //
  // A spread of what `installedPluginInfo` already built, minus the two fields the row does not carry.
  // This used to re-list all nine members, which made it a second projection of the same manifest
  // kept in step with the first by hand — the exact habit the one-declaration contract exists to end.
  // What keeps the spread honest is the exactness assertion at the top of this file.
  const declared = (name: string): Pick<NodePluginRow, 'installed'> => {
    const entry = installed.get(name)
    if (!entry) return {}
    const { id: _id, hasNode: _hasNode, ...row } = entry satisfies InstalledPluginInfo
    return { installed: row satisfies DeclaredRow }
  }
  // `disabled` is what will be true after a restart; `running` is what is true now. A required plugin is
  // never disabled either way, whatever the file says.
  const rows: NodePluginRow[] = bridge.roster().map((entry) => ({
    name: entry.name,
    required: entry.required,
    disabled: !entry.required && pending.has(entry.name),
    // An uninstalled-but-still-serving plugin is genuinely running; a plugin whose directory changed
    // under it is running the OLD code. Either way `running` describes this process, and `state` is what
    // says the disk has moved on.
    running: !entry.disabled,
    // The outcome for THIS boot, passed through untouched — except that a package the disk no longer
    // agrees with outranks it. A failed row still reports `running: true` on purpose (see the note on
    // NodePluginRow), and 'failed' is deliberately NOT overridden: a restart cannot fix a plugin whose
    // init throws, so it must not raise the banner even if its directory also changed.
    state: entry.state === 'failed' ? 'failed' : stale(entry.name) ? 'pending-restart' : entry.state,
    ...(entry.failedAt === undefined ? {} : { failedAt: entry.failedAt }),
    ...declared(entry.name),
  }))
  // Packages the plugin host never saw. Two kinds, and they are not the same answer:
  //
  //   client-only — nothing to init, ever. `running` tracks `disabled` exactly so it never raises a
  //     restart banner: its contributions are all client-side, and the client re-initialises its plugin
  //     host on a roster change (apps/desktop client/activate.ts disposes-then-registers).
  //   just installed — it HAS a node half that this process never loaded. Not running, and a restart is
  //     exactly what makes it run.
  const known = new Set(rows.map((row) => row.name))
  for (const entry of installed.values()) {
    if (known.has(entry.id)) continue
    const off = pending.has(entry.id)
    const waiting = entry.hasNode && !off && booted.get(entry.id) !== entry.version
    rows.push({
      name: entry.id,
      required: false,
      disabled: off,
      running: !off && !waiting,
      state: off ? 'disabled' : waiting ? 'pending-restart' : 'active',
      ...declared(entry.id),
    })
  }
  // A restart is needed exactly where what WOULD run differs from what IS running. That covers the
  // toggle in both directions — a plugin just turned off but still serving, one turned back on that has
  // not loaded — and, since phase 5, every way the install directory can disagree with this process.
  const restartRequired = rows.some((row) => !row.disabled !== row.running || row.state === 'pending-restart')
  return { plugins: rows, restartRequired }
}
