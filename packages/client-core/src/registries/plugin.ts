// The client-side plugin interface and its host (docs/vNext/plugins.md § The plugin API).
//
// The deliberate mirror of packages/node-core/src/server/plugin/{types,host}.ts: same vocabulary
// (`name`, `required`, `init(ctx)`, a `disabled` list the host applies, ownership bound by the host),
// so a reader who has learned one half has learned both. What it replaces is
// apps/desktop/src/app/client/activate.ts — 91 lines in which the APP named every plugin's
// contribution modules one by one and pushed them into fifteen registries, so adding a pane meant
// editing the app, and no plugin could be turned off without deleting lines.
//
// The registries themselves are UNCHANGED. This owns *who calls them*, not how they work.
//
// Which of plugins.md's ten context members are here, and why the rest are not:
//
//   panes           → registries/panes.ts (paneRegistry)
//   sources         → registries/sources.ts (sourceRegistry)
//   settingsPages   → registries/settings.ts (settingsRegistry)
//   slots           → registries/uiSlots.tsx — TWO registries, because the doc's single `slots` name
//                     covers two different props contracts: shell slots get the whole UiSlotContext,
//                     task slots get just a taskId. Hence `slots` and `taskSlots`.
//   palette         → registries/paletteRows.ts, as `paletteRows`. Commands and keybindings still register at
//                     COMPONENT MOUNT (nine sites) and that stays correct — a pane's shortcuts should exist
//                     only while the pane does. What mount-time registration cannot serve is the palette's
//                     other half: rows FETCHED per task from repo config (run targets, layout recipes,
//                     committed workflows), which CommandPalette used to read by importing two plugins.
//   contextSections → registries/contextSections.ts. Was LEFT OUT in Phase 2 for having no consumer; it
//                     has one now. plugins/context's pane used to render plugins/memory's section by
//                     importing it, which was both a coupling edge and the reason memory had no
//                     ClientPlugin. Note this is the CLIENT registry — extra controls rendered under a
//                     section — not the node one that supplies a section's data.
//                     `agentContexts` below is a different thing and is included on its own merits.
//   attention       → LEFT OUT. The attention inbox is Phase 4; there is nothing to register into.
//   api             → LEFT OUT. Plugins already call the typed fetchers in client-core directly; a
//                     second way to reach the same node would be a parallel idiom with no consumer.
//   events          → LEFT OUT. registries/clientEvents.ts is imported directly by the handful of
//                     plugins that use it, at mount time, not during init.
//   desktop         → LEFT OUT. There is no DesktopServices object; native residue is reached
//                     through client-core's typed `window.acorn` accessors (capabilities.ts).
//
// And five registries the doc does not name but which have real plugin contributions today, so they are
// here: `agentContexts`, `agentToolRenderers`, `pollers`, `persistedState`, and `refPanels` — which the doc
// describes as "linear registers a panel into github's PR-detail slot"; it is keyed on providerId instead, so
// github asks who renders a ref rather than hosting a hole named after one plugin (registries/refPanels.ts).
import type { AgentContextContribution } from '@acorn/protocol/agentContext.ts'
import { persistedStateRegistry, type PersistedStateSlice } from '../persistence/persistedState'
import { agentContextRegistry } from './agentContexts'
import { agentToolRendererRegistry, type AgentToolRendererContribution } from './agentToolRenderers'
import { contextSectionRegistry, type ContextSectionContribution } from './contextSections'
import { paletteRowRegistry, type PaletteRowSource } from './paletteRows'
import { paneRegistry, type PaneContribution } from './panes'
import { refPanelRegistry, type RefPanelContribution } from './refPanels'
import { pollerRegistry, type PollerContribution } from './pollers'
import type { Disposable, Registry } from './registry'
import { settingsRegistry, type SettingsContribution } from './settings'
import { sourceRegistry, type SourceContribution } from './sources'
// From ./slots, not ./uiSlots — the slot HOSTS contain JSX, and reaching a JSX module from here would
// make this file (and so the whole host) unimportable in a bare-Node vitest run. See slots.ts.
import { taskSlotRegistry, uiSlotRegistry, type TaskSlotContribution, type UiSlotContribution } from './slots'

// One contribution point. `register` returns nothing on purpose: the HOST owns the disposable, which
// is what makes a re-init replace a plugin's contributions instead of appending a second copy.
export type ClientContributionPoint<T> = {
  register(entry: T): void
}

export type ClientPluginContext = {
  readonly name: string
  panes: ClientContributionPoint<PaneContribution>
  // Generic per call, because a source's promotion is typed on the item it promotes. The underlying
  // registry erases that (it holds a heterogeneous list); a plugin still declares its own item type.
  sources: { register<Item>(entry: SourceContribution<Item>): void }
  settingsPages: ClientContributionPoint<SettingsContribution>
  slots: ClientContributionPoint<UiSlotContribution>
  taskSlots: ClientContributionPoint<TaskSlotContribution>
  contextSections: ClientContributionPoint<ContextSectionContribution>
  refPanels: ClientContributionPoint<RefPanelContribution>
  paletteRows: ClientContributionPoint<PaletteRowSource>
  agentContexts: ClientContributionPoint<AgentContextContribution>
  agentToolRenderers: ClientContributionPoint<AgentToolRendererContribution>
  pollers: ClientContributionPoint<PollerContribution>
  persistedState: ClientContributionPoint<PersistedStateSlice<unknown>>
  // Registration into a registry client-core does not own — a registry a PLUGIN publishes.
  //
  // There is exactly one today: plugins/github's `contentLinkRegistry`, which decides which hrefs inside
  // rendered markdown acorn opens itself. It cannot be a named member above, because client-core would have to
  // import the plugin's type to declare it, which is the dependency direction the whole plugin API exists to
  // prevent. Before this it was registered by calling `contentLinkRegistry.register(...)` directly, so the host
  // held no disposable — meaning Phase 4's disable could not take it back and a re-activation appended a second
  // copy (which the registry's duplicate-id guard turns into a throw, so re-enabling github would have failed
  // the boot).
  //
  // Same rules as every named point: the provider-ownership check applies and the host owns the disposable. It
  // is not a general escape hatch — the constraint is only that client-core cannot NAME the registry's type,
  // not that the contribution gets to skip the rules.
  contribute<T extends { id: string }>(registry: Registry<T>, entry: T): void
}

export type ClientPlugin = {
  name: string
  // github, terminal and agents: the shell assumes their contributions exist, so they cannot be
  // disabled. Same three as the node half, and for the same reason.
  required?: boolean
  // Synchronous, unlike NodePlugin.init. Nothing here awaits anything: registration publishes a
  // descriptor into a signal, and the activation side effects (preview's event subscription, docker's
  // archive concern, the managed-agent stores) attach listeners rather than performing I/O. Making it
  // async would put a promise between `render()` and the first paint for no gain.
  init(ctx: ClientPluginContext): void
}

export type ClientPluginHostOptions = {
  // Plugin ids the owner has turned off for this node. `required` plugins ignore it, exactly as on
  // the node side. Nothing populates this yet on either half — Settings → Plugins is Phase 4 — but
  // the mechanism is where it has to be for that UI to be a list, not a refactor.
  disabled?: readonly string[]
}

export type ClientPluginHostResult = {
  enabled: readonly string[]
  skipped: readonly string[]
}

// Everything a plugin has registered, so a second activation can take it back out again. Module-level
// because the registries are module-level: there is exactly one renderer per window, and a per-host
// map would let two hosts fight over one registry without either noticing.
const contributed = new Map<string, Disposable[]>()

// A contribution that names a provider must name its OWN plugin. This is the client's version of the
// node host binding the route namespace: there, a plugin cannot mount under another's path; here, it
// cannot claim another provider's integration rows, which is what `providerId` selects (a source is
// shown iff a connected integration with that id exists — tabs/sources.ts). It replaces the identical
// check that apps/desktop's deleted registerIntegrationProvider ran over linear and rollbar, and now
// covers every plugin instead of those two.
//
// Contribution IDS are deliberately NOT namespaced. `pr`, `changes`, `notes`, `palette.files` and
// `docker-footer-badge` are persisted layout keys and user-visible chord targets (ui.md: panes keep
// their ids); prefixing them would be a storage break dressed up as hygiene.
const declaredProvider = (entry: object): string | undefined =>
  'providerId' in entry && typeof (entry as { providerId?: unknown }).providerId === 'string'
    ? (entry as { providerId: string }).providerId
    : undefined

function makeContext(name: string, record: (disposable: Disposable) => void): ClientPluginContext {
  const own = <T extends { id: string }>(registry: Registry<T>): ClientContributionPoint<T> => ({
    register: (entry: T) => {
      const provider = declaredProvider(entry)
      if (provider !== undefined && provider !== name) {
        throw new Error(`Plugin '${name}' registered '${entry.id}' under provider '${provider}'`)
      }
      record(registry.register(entry))
    },
  })
  const sources = own(sourceRegistry)
  return {
    name,
    panes: own(paneRegistry),
    // The registry is heterogeneous by construction, so widening the item type here is the erasure,
    // not a hole: nothing downstream reads a promotion without first selecting the source by id.
    sources: { register: <Item>(entry: SourceContribution<Item>) => sources.register(entry) },
    settingsPages: own(settingsRegistry),
    slots: own(uiSlotRegistry),
    taskSlots: own(taskSlotRegistry),
    contextSections: own(contextSectionRegistry),
    refPanels: own(refPanelRegistry),
    paletteRows: own(paletteRowRegistry),
    agentContexts: own(agentContextRegistry),
    agentToolRenderers: own(agentToolRendererRegistry),
    pollers: own(pollerRegistry),
    persistedState: own(persistedStateRegistry),
    // Straight through `own`, so a plugin-published registry gets the identical treatment: ownership checked,
    // disposable recorded. The only difference from the members above is that the registry arrives as an
    // argument instead of being named here.
    contribute: (registry, entry) => own(registry).register(entry),
  }
}

// Runs every enabled plugin's init, in declaration order.
//
// Declaration order is observable NOWHERE, which matches the node side. It used to be observable in exactly one
// place — the rail's Source order was `sourceRegistry.entries()` unsorted — and `SourceContribution.order`
// closed that: every client registry now sorts on a declared field (panes and settings pages by `order`, slots
// by `order` within a slot, palette rows by `order`, agent contexts by label, sources by `order`).
export function initClientPlugins(
  plugins: readonly ClientPlugin[],
  options: ClientPluginHostOptions = {},
): ClientPluginHostResult {
  const seen = new Set<string>()
  for (const plugin of plugins) {
    if (seen.has(plugin.name)) throw new Error(`Duplicate client plugin: ${plugin.name}`)
    seen.add(plugin.name)
  }
  const disabled = new Set(options.disabled ?? [])
  const enabled: string[] = []
  const skipped: string[] = []

  for (const plugin of plugins) {
    // Take back whatever this plugin registered on a previous activation, before it registers again.
    // The node host does the same thing (removePluginRoutes / removeAgentTools) for the same reason:
    // Registry.register THROWS on a duplicate id, so without this a second activate() in one process
    // — a test, or a dev-server module invalidation that re-evaluates the entry — would not append a
    // stale copy, it would take the whole shell down on the first pane.
    for (const disposable of [...(contributed.get(plugin.name) ?? [])].reverse()) disposable.dispose()
    const disposables: Disposable[] = []
    contributed.set(plugin.name, disposables)

    if (disabled.has(plugin.name) && !plugin.required) {
      skipped.push(plugin.name)
      continue
    }
    // Not caught, matching the node host: every plugin here is first-party code shipped in the same
    // bundle, and a shell that half-registered is a worse outcome than one that fails loudly at boot.
    plugin.init(makeContext(plugin.name, (disposable) => disposables.push(disposable)))
    enabled.push(plugin.name)
  }

  return { enabled, skipped }
}
