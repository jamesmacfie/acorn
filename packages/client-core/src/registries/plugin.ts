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
//   palette         → LEFT OUT. Commands and keybindings are registered at COMPONENT MOUNT (nine
//                     sites) and disposed on unmount, which is correct: a pane's shortcuts should
//                     exist only while the pane does. There is no init-time caller to serve.
//   contextSections → LEFT OUT. No such registry exists on the client; core's context assembler is
//                     still one node-side slot (apps/node/src/wiring/contextSectionsWiring.ts).
//                     `agentContexts` below is a different thing and is included on its own merits.
//   attention       → LEFT OUT. The attention inbox is Phase 4; there is nothing to register into.
//   api             → LEFT OUT. Plugins already call the typed fetchers in client-core directly; a
//                     second way to reach the same node would be a parallel idiom with no consumer.
//   events          → LEFT OUT. registries/clientEvents.ts is imported directly by the handful of
//                     plugins that use it, at mount time, not during init.
//   desktop         → LEFT OUT. There is no DesktopServices object; native residue is reached
//                     through client-core's typed `window.acorn` accessors (capabilities.ts).
//
// And four registries the doc does not name but which have real plugin contributions today, so they
// are here: `agentContexts`, `agentToolRenderers`, `pollers`, `persistedState`.
import type { AgentContextContribution } from '@acorn/protocol/agentContext.ts'
import { persistedStateRegistry, type PersistedStateSlice } from '../persistence/persistedState'
import { agentContextRegistry } from './agentContexts'
import { agentToolRendererRegistry, type AgentToolRendererContribution } from './agentToolRenderers'
import { paneRegistry, type PaneContribution } from './panes'
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
  agentContexts: ClientContributionPoint<AgentContextContribution>
  agentToolRenderers: ClientContributionPoint<AgentToolRendererContribution>
  pollers: ClientContributionPoint<PollerContribution>
  persistedState: ClientContributionPoint<PersistedStateSlice<unknown>>
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
    agentContexts: own(agentContextRegistry),
    agentToolRenderers: own(agentToolRendererRegistry),
    pollers: own(pollerRegistry),
    persistedState: own(persistedStateRegistry),
  }
}

// Runs every enabled plugin's init, in declaration order.
//
// Declaration order IS observable here, unlike on the node side, and in exactly one place: the rail's
// Source order is `sourceRegistry.entries()` in registration order (tabs/sources.ts prepends GitHub
// and appends the rest unsorted). Everything else sorts — panes and settings pages by `order`, slots
// by `order` within a slot, agent contexts by label — so the list's order is load-bearing for the rail
// and for nothing else. apps/desktop/src/app/client/plugins.ts says so at the top.
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
