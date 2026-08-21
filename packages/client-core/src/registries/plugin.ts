import type { AgentContextContribution } from '@acorn/protocol/agentContext.ts'
import { persistedStateRegistry, type PersistedStateSlice } from '../persistence/persistedState'
import { agentContextRegistry } from './agentContexts'
import { agentToolRendererRegistry, type AgentToolRendererContribution } from './agentToolRenderers'
import { contextSectionRegistry, type ContextSectionContribution } from './contextSections'
import { paletteRowRegistry, type PaletteRowSource } from './paletteRows'
import { attentionRegistry, type AttentionSourceContribution } from './attention'
import { collectionKey, collectionRegistry, type CollectionRegistration } from './collections'
import { nodeStatRegistry, type NodeStatContribution } from './nodeStats'
import { paneRegistry, type PaneContribution } from './panes'
import { refPanelRegistry, type RefPanelContribution } from './refPanels'
import { pollerRegistry, type PollerContribution } from './pollers'
import { provideClientCapability, type ClientCapabilityId } from '../clientCapabilities'
import type { Disposable, Registry } from './registry'
import { settingsRegistry, type SettingsContribution } from './settings'
import { sourceRegistry, type SourceContribution } from './sources'
import { commandRegistry, type CommandContribution } from './commands'
import { keybindingRegistry, type KeybindingContribution } from './keybindings'
import { integrationFlowRegistry, type IntegrationFlowContribution } from './integrationFlows'
import { projectImporterRegistry, type ProjectImporterContribution } from './projectImporters'
// From ./slots, not ./uiSlots: the slot hosts contain JSX, and reaching one from here would make this
// file (and the whole host) unimportable in a bare-Node vitest run (docs/frontend.md § Registries and
// plugins).
import { taskSlotRegistry, uiSlotRegistry, type TaskSlotContribution, type UiSlotContribution } from './slots'

// One contribution point. `register` returns nothing: the host owns the disposable (docs/plugins.md
// § Activation), which is what makes a re-init replace a plugin's contributions instead of appending
// a second copy.
export type ClientContributionPoint<T> = {
  register(entry: T): void
}

export type ClientPluginContext = {
  readonly name: string
  panes: ClientContributionPoint<PaneContribution>
  // Generic per call: a source's promotion is typed on the item it promotes, but the underlying
  // registry erases that (it holds a heterogeneous list), so a plugin still declares its own item
  // type here.
  sources: { register<Item>(entry: SourceContribution<Item>): void }
  commands: ClientContributionPoint<CommandContribution>
  keybindings: ClientContributionPoint<KeybindingContribution>
  integrationFlows: ClientContributionPoint<IntegrationFlowContribution>
  projectImporters: ClientContributionPoint<ProjectImporterContribution>
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
  // One number on a Fleet home node card (docs/frontend.md § Registries and plugins;
  // registries/nodeStats.ts).
  nodeStats: ClientContributionPoint<NodeStatContribution>
  // Rows for the attention inbox: states on a node that need the owner, fetched per node
  // (docs/frontend.md § Shell state; registries/attention.ts).
  attention: ClientContributionPoint<AttentionSourceContribution>
  // A typed set of records a user can compose a panel over (docs/dashboards.md § Collections). The
  // compiled feeder; a loaded plugin declares `collections` in its manifest and the descriptor pass
  // builds the same contribution. `pluginId` and the registry id are bound here, not declared.
  collections: ClientContributionPoint<CollectionRegistration>
  contribute<T extends { id: string }>(registry: Registry<T>, entry: T): void
  // Publish a typed capability for another plugin to resolve at call time, mirroring the node's
  // ctx.capabilities.provide. Disposal is the host's, like every contribution above: a second
  // activation in one process must not hit "already provided".
  capability<T>(id: ClientCapabilityId<T>, impl: T): void
}

export type ClientPlugin = {
  name: string
  // Required plugins and why (docs/plugins.md § Activation): the shell assumes their contributions
  // exist, so they cannot be disabled. GitHub is optional; its PR rail and importer are
  // gated/removed as one plugin contribution.
  required?: boolean
  // Registration only, and synchronous (docs/plugins.md § "Frame authoring and the UI kit"): nothing
  // here awaits or performs I/O, so making it async would put a promise between `render()` and the
  // first paint for no gain.
  init(ctx: ClientPluginContext): void
  // The side-effect phase, run after every plugin's `init` (docs/plugins.md § "Frame authoring and
  // the UI kit"). It exists because plugins/http and plugins/agents were doing I/O inside a
  // synchronous `init` while half the registries were still empty. A plugin disabled in this pass
  // never reaches it, and this stays synchronous too: a plugin wanting a network read fires it and
  // handles its own rejection.
  activate?(ctx: ClientPluginContext): void
}

export type ClientPluginHostOptions = {
  disabled?: readonly string[]
}

export type ClientPluginHostResult = {
  enabled: readonly string[]
  skipped: readonly string[]
}

// Everything a plugin has registered, so a second activation can take it back out again.
// Module-level because the registries are module-level: there is exactly one renderer per window, and
// a per-host map would let two hosts fight over one registry without either noticing.
const contributed = new Map<string, Disposable[]>()

// A contribution that names a provider must name its own plugin (docs/plugins.md § "Frame authoring
// and the UI kit"). Contribution ids are not namespaced (same section): `pr`, `changes`, `notes`,
// `palette.files` and `docker-footer-badge` are persisted layout keys and chord targets, so
// prefixing them would be a storage break dressed up as hygiene.
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
  const commands = own(commandRegistry)
  const keybindings = own(keybindingRegistry)
  const ownIntegrationFlow: ClientContributionPoint<IntegrationFlowContribution> = {
    register: (entry) => {
      if (entry.id !== name) throw new Error(`Plugin '${name}' registered integration flow '${entry.id}'`)
      record(integrationFlowRegistry.register(entry))
    },
  }
  // Not `own`: the entry arrives without the two fields the host binds, so there is nothing for the
  // provider check to look at until they are stamped. Same shape as `ownIntegrationFlow`, for the
  // same reason: the id is the host's to mint.
  const ownCollection: ClientContributionPoint<CollectionRegistration> = {
    register: (entry) => {
      record(collectionRegistry.register({ ...entry, id: collectionKey(name, entry.collectionId), pluginId: name }))
    },
  }
  return {
    name,
    panes: own(paneRegistry),
    // The registry is heterogeneous by construction, so widening the item type here is the erasure,
    // not a hole: nothing downstream reads a promotion without first selecting the source by id.
    sources: { register: <Item>(entry: SourceContribution<Item>) => sources.register(entry) },
    commands,
    keybindings,
    integrationFlows: ownIntegrationFlow,
    projectImporters: own(projectImporterRegistry),
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
    nodeStats: own(nodeStatRegistry),
    attention: own(attentionRegistry),
    collections: ownCollection,
    // Straight through `own`, so a plugin-published registry gets identical treatment: ownership
    // checked, disposable recorded. The only difference from the members above is that the registry
    // arrives as an argument instead of being named here.
    contribute: (registry, entry) => own(registry).register(entry),
    capability: (id, impl) => record(provideClientCapability(id, impl)),
  }
}

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
  // Kept so the activate pass runs in declaration order over exactly the plugins that initialized,
  // paired with the context each one already owns: a second `makeContext` would hand the plugin a
  // recorder writing into a disposable list nobody holds.
  const activations: { plugin: ClientPlugin; ctx: ClientPluginContext }[] = []

  for (const plugin of plugins) {
    // Take back whatever this plugin registered on a previous activation, before it registers again.
    // Registry.register throws on a duplicate id, so without this a second activate() in one process
    // (a test, or a dev-server module reload) would not append a stale copy; it would take the whole
    // shell down on the first pane. The node host takes the same precaution for the same reason.
    for (const disposable of [...(contributed.get(plugin.name) ?? [])].reverse()) disposable.dispose()
    const disposables: Disposable[] = []
    contributed.set(plugin.name, disposables)

    if (disabled.has(plugin.name) && !plugin.required) {
      skipped.push(plugin.name)
      continue
    }
    // Not caught, matching the node host: every plugin here is first-party code shipped in the same
    // bundle, and a shell that half-registered is a worse outcome than one that fails loudly at boot.
    const ctx = makeContext(plugin.name, (disposable) => disposables.push(disposable))
    plugin.init(ctx)
    enabled.push(plugin.name)
    if (plugin.activate) activations.push({ plugin, ctx })
  }

  // Second pass, mirroring the node host's `ready`: by here every registry holds every enabled
  // plugin's contributions, so a plugin priming a store can look up a sibling's descriptor.
  for (const { plugin, ctx } of activations) plugin.activate?.(ctx)

  return { enabled, skipped }
}
