import { routeCapability } from '../bridge'
import { pendingPluginRequests } from '../agentTools/pluginRequests'
import { contributesNodeData } from '../plugins/manifest'
import type { PluginRosterEntry } from './host'
import type { InstalledPluginInfo, PluginLoadFailure } from '../plugins/loader'
import type { ActivePluginSnapshot } from '../plugins/loader'
import type { PendingPluginReview } from '../plugins/pendingReview'
import { pluginInputs, type InputGrantsStore } from '../plugins/inputGrants'
import type { SkillStateStore } from '../plugins/skillState'
import { pluginSkills } from './skills'
import type { PluginDevelopment } from '../plugins/development'
import { registeredDataSource } from '../dataSources/registry'
import { parseDataSourceInputRef } from '@acorn/protocol/dataSources.ts'
import type {
  InstalledPluginRow,
  NodePluginRow,
  PluginRuntimeIdentity,
  PluginApprovalRequest,
  PluginInstallResult,
  PluginInstallSource,
  PluginReloadResult,
  PluginUninstallResult,
  PluginUpdateResult,
} from '@acorn/protocol/api.ts'

// Which plugins this node runs, and the owner's toggle (docs/frontend/settings-groups.md § Plugins).
// A bridge rather than a direct read, because the roster only exists once the composition root has
// run the plugin host, and the disabled list is a file in the data root rather than a table.
//
// The bridge and the reconciliation below answer one question: what is the plugin situation on this
// node, and does it need a restart. This module is testable with plain objects, no Hono.
//
// A plugin's routes, tables, and jobs are wired at init. Toggling, installing, or uninstalling one takes
// effect at the next start, so those raise `restartRequired`. The one exception is `reload()`, which
// swaps a single loaded plugin in place.
export type PluginsBridge = {
  roster(): readonly PluginRosterEntry[]
  // Every package on disk right now, including the client-only ones the host never saw. Separate from
  // `roster()` because the roster describes what this process assembled, and a package with no node half
  // never enters the plugin host, but its client bundle still goes to devices, so it has to appear.
  //
  // Re-read per call rather than snapshotted at boot: after an install or an uninstall the two answers
  // differ, and that difference is the pending state this route reports.
  installed(): readonly InstalledPluginInfo[]
  // What this process actually loaded, at the version it loaded. The counterpart to `installed()`, and
  // the only way to tell "installed and running" from "installed since the last restart".
  booted(): readonly ActivePluginSnapshot[]
  // Why a package on disk produced no plugin at this boot: a manifest that does not parse, an apiVersion
  // mismatch, an id collision, a bundle that threw on import, a wrong default export.
  //
  // A boot snapshot, unlike `installed()`, because that is what it is a fact about. The consequence is
  // named where it bites, in `rows` below.
  loadFailures(): readonly PluginLoadFailure[]
  pendingReview(id: string): PendingPluginReview | { corrupt: true } | null
  pendingReviewIds(): readonly string[]
  approveReview(id: string, reviewId: string, fingerprint: string): PendingPluginReview
  // The client bundle's bytes, hashed at read time. Kept on the bridge rather than done in the route
  // because the file lives under the data root, which the server layer has no handle on.
  clientBundle(id: string, hash: string): Promise<{ bytes: Uint8Array<ArrayBuffer>; hash: string } | null>
  // The names the owner currently has turned off, which is not derivable from the roster after a
  // restart-pending write: the roster describes the running process.
  disabled(): readonly string[]
  setDisabled(names: readonly string[]): void
  // The installer, reached the same way everything else here is: it needs the data root, which the
  // server layer has no handle on. Each throws a plain Error carrying a sentence for
  // the owner; the handlers turn that into one 400.
  install(
    source: PluginInstallSource,
    options: { allowDowngrade?: boolean; reviewRequestId?: string },
  ): Promise<PluginInstallResult>
  update(id: string, options: { allowDowngrade?: boolean; reviewRequestId?: string }): Promise<PluginUpdateResult>
  // Async because a purge reaches the core database as well as the disk (`cascadeDeletePluginData`).
  uninstall(id: string, options: { purgeData?: boolean }): PluginUninstallResult | Promise<PluginUninstallResult>
  // The one mutation that changes what is running without a restart, and only for a loaded plugin. It
  // throws for a name this node did not load from disk; a plugin whose new code fails to start resolves
  // with `state: 'failed'`, because that is not an error in the request. The previous instance keeps
  // serving.
  reload(id: string): Promise<PluginReloadResult>
  // The person's approvals of what loaded plugins' derived sources read. A fresh read per call, as the
  // input handles do, so a grant written elsewhere shows at once.
  inputGrants(): InputGrantsStore
  // The owner's approvals and switches for loaded plugins' skills, read fresh per call like the input
  // grants above.
  skillState(): SkillStateStore
  // Development mode for folder-installed node plugins: the watch, the reload, the log lines, and the
  // development grant.
  development: PluginDevelopment
}

export const PLUGIN_STATE = routeCapability<PluginsBridge>('core.pluginStateRoute')

// What `declared()` below sends to a device: everything the loader knows about a package, minus the two
// fields that are this node's own bookkeeping and the label, which travels on the row itself.
type DeclaredRow = Omit<InstalledPluginInfo, 'id' | 'label' | 'hasNode'>

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

// `declared()` builds the wire row by rest-spread, and a spread fails open. TypeScript does not apply
// excess-property checks to a value that arrives through a variable, so a field added to
// `InstalledPluginInfo` for the node's own use would ship to every paired device without a word.
//
// This check makes it fail closed. Adding a field to either side is a build error, and the fix is one
// line: name it in the `Omit` above to keep it on the node, or add it to `InstalledPluginRow` to publish it.
const DECLARED_ROW_IS_EXACTLY_THE_WIRE_ROW: Exact<keyof DeclaredRow, keyof InstalledPluginRow> = true
void DECLARED_ROW_IS_EXACTLY_THE_WIRE_ROW

type RuntimeDeclaration = Omit<InstalledPluginInfo, 'id' | 'label' | 'hasNode' | 'source' | 'installedAt' | 'bundled'>
const RUNTIME_DECLARATION_IS_EXACTLY_THE_WIRE_ROW: Exact<
  keyof RuntimeDeclaration,
  keyof Omit<PluginRuntimeIdentity, 'activation'>
> = true
void RUNTIME_DECLARATION_IS_EXACTLY_THE_WIRE_ROW

const runtimeFromInstalled = (entry: InstalledPluginInfo): PluginRuntimeIdentity => {
  const {
    id: _id,
    label: _label,
    hasNode,
    source: _source,
    installedAt: _installedAt,
    bundled: _bundled,
    ...declaration
  } = entry
  return {
    ...declaration,
    activation: hasNode || contributesNodeData(declaration.contributions) ? 'node' : 'client-only',
  }
}

// The ceiling on failure text leaving this node. A thrown message can be a whole stack, a Zod dump or
// whatever a third-party bundle chose to put in an Error; this row is read by a notification row and a
// settings line, and one sentence is what either can render. Capped here rather than at the two render
// sites so there is one number, and truncated rather than dropped because the first sentence is almost
// always the useful one.
const MAX_REASON_CHARS = 400

const trimReason = (reason: string | undefined): { reason?: string } => {
  const text = reason?.trim()
  if (!text) return {}
  return { reason: text.length > MAX_REASON_CHARS ? `${text.slice(0, MAX_REASON_CHARS - 1)}…` : text }
}

// The running plugin set, plus the pending one. They differ exactly when a toggle has been saved and the
// node has not restarted, which is the state the UI has to render.
export const pluginState = (
  bridge: PluginsBridge,
): { plugins: NodePluginRow[]; restartRequired: boolean; requests: PluginApprovalRequest[] } => {
  const pending = new Set(bridge.disabled())
  const loadFailed = new Map(bridge.loadFailures().map((failure) => [failure.id, failure]))
  const installed = new Map(bridge.installed().map((entry) => [entry.id, entry]))
  // What this process loaded, at the version it loaded. A package on disk that is absent here, or here at
  // a different version, arrived after the last start; one here but no longer on disk was uninstalled and
  // is still serving. Both are the same answer for the owner: restart.
  const booted = new Map(bridge.booted().map((entry) => [entry.id, entry]))
  const review = (id: string): Pick<NodePluginRow, 'pendingReview'> => {
    const pending = bridge.pendingReview(id)
    if (!pending) return {}
    if ('corrupt' in pending) return { pendingReview: { corrupt: true } }
    return {
      pendingReview: { reviewId: pending.reviewId, fingerprint: pending.fingerprint, stagedAt: pending.stagedAt },
    }
  }
  const activeFor = (id: string): PluginRuntimeIdentity | null => {
    // A process that booted a node half keeps serving it until restart or successful reload,
    // even if the replacement package on disk has since become client-only.
    const serving = booted.get(id)?.identity
    if (serving) return serving
    const onDisk = installed.get(id)
    // A package with no process registrations can take effect immediately. Its declaration and
    // candidate bundle were read in the same installed scan, and the hash route verifies the bytes.
    if (onDisk && !pending.has(id) && !loadFailed.has(id) && !bridge.pendingReview(id)) {
      const candidate = runtimeFromInstalled(onDisk)
      if (candidate.activation === 'client-only') return candidate
    }
    return null
  }
  const stale = (id: string): boolean => {
    const running = booted.get(id)?.identity
    const onDisk = installed.get(id)
    if (!onDisk) return running !== undefined
    const candidate = runtimeFromInstalled(onDisk)
    if (!running) return candidate.activation === 'node'
    return JSON.stringify(running) !== JSON.stringify(candidate)
  }
  const grants = bridge.inputGrants()
  const skillState = bridge.skillState().get()
  const roster = new Map(bridge.roster().map((entry) => [entry.name, entry]))
  // An input names its source by the plugin that owns it. A compiled owner's label is acorn's own words;
  // a loaded owner wrote its label itself, so the id stands in, as it does in the trust prompt.
  const describeInput = (source: string): { plural?: string; provider?: string } => {
    const ref = parseDataSourceInputRef(source)
    const registered = registeredDataSource(ref)
    const owner =
      ref.pluginId === 'core'
        ? 'Acorn'
        : installed.has(ref.pluginId)
          ? ref.pluginId
          : (roster.get(ref.pluginId)?.label ?? ref.pluginId)
    return {
      ...(registered ? { plural: registered.plural } : {}),
      ...(!registered || registered.providerId ? { provider: owner } : {}),
    }
  }
  // Present only for a package that came off disk. A built-in's version is the app's, and it has no
  // manifest and no bundle to distribute, so the whole block is absent rather than filled with nulls.
  // The row is a spread of what `installedPluginInfo` built; the exactness assertion above keeps it honest.
  const declared = (name: string): Pick<NodePluginRow, 'installed' | 'inputs' | 'skills' | 'development'> => {
    const entry = installed.get(name)
    if (!entry) return {}
    const { id: _id, label: _label, hasNode: _hasNode, ...row } = entry satisfies InstalledPluginInfo
    const inputs = pluginInputs(entry.contributions.dataSources, grants.get(name), describeInput)
    // From the catalogue, which holds what the running version loaded, never the disk candidate: a
    // skill is approved as the bytes an agent will be pointed at.
    const skills = pluginSkills(name, skillState)
    const development = entry.hasNode ? bridge.development.state(name) : undefined
    return {
      installed: row satisfies DeclaredRow,
      ...(inputs ? { inputs } : {}),
      ...(skills ? { skills } : {}),
      ...(development
        ? {
            development: {
              on: development.on,
              ...(development.reloadedAt ? { reloadedAt: development.reloadedAt } : {}),
            },
          }
        : {}),
    }
  }
  // A reload in development mode that the loader refused never reached the host, so the roster entry
  // still says active. It shows as a failed load does, while the previous version keeps serving.
  const reloadFailure = (row: NodePluginRow): void => {
    const failure =
      row.development?.on && row.state === 'active' ? bridge.development.state(row.name)?.failure : undefined
    if (!failure) return
    Object.assign(row, { state: 'failed', stage: 'load', failedAt: failure.at }, trimReason(failure.reason))
  }
  // The name a person reads. A package on disk names itself in its manifest, and that wins over a
  // compiled definition of the same id, because the disk copy is the one the owner installed.
  const labelFor = (id: string, compiled?: string): Pick<NodePluginRow, 'label'> => {
    const label = installed.get(id)?.label ?? compiled
    return label ? { label } : {}
  }
  // `disabled` is what will be true after a restart; `running` is what is true now. A required plugin is
  // never disabled either way, whatever the file says.
  const rows: NodePluginRow[] = bridge.roster().map((entry) => {
    const active = activeFor(entry.name)
    const emits = active?.emits ?? entry.emits ?? installed.get(entry.name)?.emits
    return {
      name: entry.name,
      ...labelFor(entry.name, entry.label),
      ...(emits?.length ? { emits } : {}),
      required: entry.required,
      disabled: !entry.required && pending.has(entry.name),
      // An uninstalled-but-still-serving plugin is genuinely running; a plugin whose directory changed under
      // it is running the old code. Either way `running` describes this process, and `state` is what says
      // the disk has moved on.
      running: !entry.disabled,
      active,
      // The outcome for this boot, passed through untouched, except that a package the disk no longer agrees
      // with outranks it. A failed row still reports `running: true` on purpose (see the note on
      // NodePluginRow), and 'failed' is deliberately not overridden: a restart cannot fix a plugin whose init
      // throws, so it must not raise the banner even if its directory also changed.
      state: review(entry.name).pendingReview
        ? 'pending-review'
        : entry.state === 'failed'
          ? 'failed'
          : stale(entry.name)
            ? 'pending-restart'
            : entry.state,
      ...(entry.failedAt === undefined ? {} : { failedAt: entry.failedAt }),
      ...(entry.state === 'failed' ? trimReason(entry.reason) : {}),
      ...(entry.stage === undefined ? {} : { stage: entry.stage }),
      ...declared(entry.name),
      ...review(entry.name),
    }
  })
  // Packages the plugin host never saw. Three kinds, and they are not the same answer:
  //
  //   client-only. Nothing to init, ever. `running` tracks `disabled` exactly so it never raises a restart
  //     banner: its contributions are all client-side, and the client re-registers its plugins on a
  //     roster change.
  //   just installed. It has a node half that this process never loaded. Not running, and a restart is
  //     exactly what makes it run.
  //   failed to load. It has a node half that this process tried to load and could not. It is absent from
  //     `booted()` just as a fresh install is, but it reports 'failed', not 'pending-restart': restarting
  //     re-runs the same failing import, so a Restart banner could never clear.
  const known = new Set(rows.map((row) => row.name))
  for (const entry of installed.values()) {
    if (known.has(entry.id)) continue
    const off = pending.has(entry.id)
    const failure = loadFailed.get(entry.id)
    const held = !!bridge.pendingReview(entry.id)
    const active = off || failure || held ? null : activeFor(entry.id)
    const waiting = !held && runtimeFromInstalled(entry).activation === 'node' && !off && !failure && !active
    rows.push({
      name: entry.id,
      ...labelFor(entry.id),
      ...(entry.emits?.length ? { emits: entry.emits } : {}),
      required: false,
      disabled: off,
      // `true` for a failed row, matching what the roster does with a contained plugin: `running` is what
      // `restartRequired` is computed from, and a restart cannot fix a bundle that will not import.
      running: !off && !waiting && !held,
      active,
      state: held ? 'pending-review' : off ? 'disabled' : failure ? 'failed' : waiting ? 'pending-restart' : 'active',
      ...(failure && !off ? { stage: 'load' as const, failedAt: failure.at, ...trimReason(failure.reason) } : {}),
      ...declared(entry.id),
      ...review(entry.id),
    })
  }
  // And the packages that never even got a row: a manifest that does not parse, an apiVersion this node
  // does not speak, an id a second directory already claimed. `scanInstalled` drops all three, so without
  // this loop the owner would see an installed plugin missing from the list.
  //
  // A boot snapshot, so a package fixed on disk keeps its boot-time reason until the restart that re-reads
  // it, rather than flipping to 'pending-restart'. Telling the two apart needs the version that failed,
  // which for an unparseable manifest does not exist. The reason text says what to fix.
  for (const failure of loadFailed.values()) {
    const shadowed = rows.find((row) => row.name === failure.id)
    // The name is already taken by something that is running. Two ways to get here, and the loader's own
    // message distinguishes them: a package dogfooding a built-in (build-plugin.mjs installs the disk copy
    // and the compiled-in one steps aside, but only if the disk copy actually loads), or a second directory
    // claiming an id the first one won. The row says 'active', truthfully, so the reason is the only thing
    // that tells the owner the copy they installed is not the code they are running.
    //
    // The running row's `state` stays as it is. The render side reads "a reason with no failure" as
    // exactly this case.
    if (shadowed) {
      // A marker is authoritative even when the installed manifest no longer parses. Keep the
      // recovery controls visible on the existing row instead of reporting only the load failure.
      const held = review(failure.id)
      if (held.pendingReview) {
        shadowed.pendingReview = held.pendingReview
        shadowed.state = 'pending-review'
        if (!booted.has(failure.id)) {
          shadowed.running = false
          shadowed.active = null
        }
      }
      if (shadowed.state !== 'failed' && shadowed.reason === undefined) {
        shadowed.stage = 'load'
        shadowed.failedAt = failure.at
        Object.assign(shadowed, trimReason(failure.reason))
      }
      continue
    }
    const off = pending.has(failure.id)
    const held = review(failure.id)
    rows.push({
      name: failure.id,
      required: false,
      disabled: off,
      running: !off && !held.pendingReview,
      active: null,
      state: held.pendingReview ? 'pending-review' : off ? 'disabled' : 'failed',
      ...(off ? {} : { stage: 'load' as const, failedAt: failure.at, ...trimReason(failure.reason) }),
      ...held,
    })
  }
  for (const row of rows) reloadFailure(row)
  // A crash after publishing a marker but before placing the package leaves no installed row.
  // Keep that gate visible so the owner can discard it without hand-editing the data root.
  const listed = new Set(rows.map((entry) => entry.name))
  for (const id of bridge.pendingReviewIds()) {
    if (listed.has(id)) continue
    rows.push({
      name: id,
      required: false,
      disabled: false,
      running: false,
      active: null,
      state: 'pending-review',
      ...review(id),
    })
  }
  // A restart is needed exactly where what would run differs from what is running. That covers the toggle
  // in both directions, a plugin just turned off but still serving, one turned back on that has not
  // loaded, and every way the install directory can disagree with this process.
  const restartRequired = rows.some(
    (row) =>
      !row.pendingReview &&
      (!row.disabled !== row.running || row.state === 'pending-restart' || (row.active !== null && stale(row.name))),
  )
  // The agent-raised approval queue rides the roster rather than getting a GET of its own: it is read by
  // the same device-only mount, refreshed by the same `plugins:changed` reconcile, and a second route
  // would be a second thing to remember to gate (docs/plugins/agent-install.md § Approval-mediated install).
  return { plugins: rows, restartRequired, requests: pendingPluginRequests() }
}
