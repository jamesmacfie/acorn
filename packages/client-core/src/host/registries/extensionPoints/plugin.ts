import type { AgentContextContribution } from '@acorn/protocol/agentContext.ts'
import { persistedStateRegistry, type PersistedStateSlice } from '../../../infra/persistence/persistedState'
import { agentContextRegistry } from '../sources/agentContexts'
import { paletteRowRegistry, type PaletteRowSource } from '../palette/paletteRows'
import { attentionRegistry, type AttentionSourceContribution } from '../rail/attention'
import { collectionKey, collectionRegistry, type CollectionRegistration } from '../sources/collections'
import { nodeStatRegistry, type NodeStatContribution } from '../rail/nodeStats'
import { paneRegistry, type PaneRegistration } from '../panes/panes'
import { refPanelRegistry, type RefPanelContribution } from '../panes/refPanels'
import { clientScheduleRegistry, type ClientScheduleContribution } from '../shell/schedules'
import { contentLinkRegistry, type ContentLinkContribution } from '../panes/contentLinks'
import { extensionPointRegistry, extensionRegistry, type ExtensionContribution, type ExtensionPointContribution } from './extensionPoints'
import { qualifiedExtensionPointId } from '@acorn/protocol/extensionPoints.ts'
import { brandMarkRegistry, type BrandMark } from '../../../kit/lib/brandMarks'
import { railMarkerRegistry, type RailMarkerContribution } from '../rail/railMarkerFeed'
import { clientCapability, clientCapabilityIds, provideClientCapability, requireClientCapability, type ClientCapabilityId } from '../../../infra/node/clientCapabilities'
import type { Disposable, Registry } from '../../../kit/lib/registry'
import { settingsRegistry, type SettingsContribution } from '../shell/settings'
import { sourceRegistry, type SourceContribution } from '../sources/sources'
import { commandRegistry, type CommandContribution } from '../commands/commands'
import { keybindingRegistry, type KeybindingContribution } from '../commands/keybindings'
import { integrationFlowRegistry, type IntegrationFlowContribution } from '../sources/integrationFlows'
import { projectImporterRegistry, type ProjectImporterContribution } from '../sources/projectImporters'
// From ./slots, not ./uiSlots. The slot hosts contain JSX, which makes this file unimportable in a
// bare-Node vitest run (docs/frontend.md § Registries and plugins).
import { uiSlotRegistry, type UiSlotContribution } from './slots'

// One contribution point. `register` returns nothing, because the host owns the disposable
// (docs/plugins.md § Activation), so a re-init replaces a plugin's contributions instead of appending.
export type ClientContributionPoint<T> = {
  register(entry: T): void
}

/** What a compiled plugin declares when it opens a point. The two fields the host owns are missing:
 *  `id` here is the bare point id, and `ownerId` is stamped from the plugin doing the registering. */
export type CompiledExtensionPoint =
  Omit<ExtensionPointContribution, 'ownerId' | 'max'> & { max?: number }

/** What a compiled plugin declares when it fills somebody else's point. `pluginId` and `carrier` are
 *  the host's; `component` is the only carrier a plugin in this process can bring. */
export type CompiledExtension =
  Omit<ExtensionContribution, 'pluginId' | 'carrier' | 'component' | 'entry' | 'hash' | 'frame' | 'fetch' | 'marks' | 'run'>
  & { component: NonNullable<ExtensionContribution['component']> }

export type ClientPluginContext = {
  readonly name: string
  panes: ClientContributionPoint<PaneRegistration>
  // Generic per call. A source's promotion is typed on the item it promotes, and the registry holds a
  // heterogeneous list, so a plugin declares its own item type here.
  sources: { register<Item>(entry: SourceContribution<Item>): void }
  commands: ClientContributionPoint<CommandContribution>
  keybindings: ClientContributionPoint<KeybindingContribution>
  integrationFlows: ClientContributionPoint<IntegrationFlowContribution>
  projectImporters: ClientContributionPoint<ProjectImporterContribution>
  settingsPages: ClientContributionPoint<SettingsContribution>
  // One registry for both shapes: the slot id picks whether the component is handed the shell context
  // or just a task id (registries/slots.ts).
  slots: ClientContributionPoint<UiSlotContribution>
  // A place in this plugin's own tree that another plugin may fill (docs/plugins.md § Cooperative
  // extension points). The compiled half of the manifest's `extensionPoints`; the host mints
  // `<pluginId>:<id>` and stamps the owner, so a plugin cannot open a point in somebody else's name.
  extensionPoints: ClientContributionPoint<CompiledExtensionPoint>
  // What this plugin brings to somebody else's point. The compiled half of the manifest's
  // `extensions`, and the only carrier available here is a component: a loaded plugin ships bytes for a
  // worker, and a compiled one is already in this process (registries/extensionPoints.ts).
  extensions: ClientContributionPoint<CompiledExtension>
  refPanels: ClientContributionPoint<RefPanelContribution>
  paletteRows: ClientContributionPoint<PaletteRowSource>
  agentContexts: ClientContributionPoint<AgentContextContribution>
  // The same word the node uses for the same idea, and deliberately not the same shape
  // (registries/schedules.ts).
  schedules: ClientContributionPoint<ClientScheduleContribution>
  // Status markers drawn on a rail control by the host, published from the state that owns them
  // (registries/railMarkers.ts). Data only; a marker has no click verb.
  railMarkers: ClientContributionPoint<RailMarkerContribution>
  persistedStateSlices: ClientContributionPoint<PersistedStateSlice<unknown>>
  // One number on a Fleet home node card (docs/frontend.md § Registries and plugins;
  // registries/nodeStats.ts).
  nodeStats: ClientContributionPoint<NodeStatContribution>
  // Rows for the attention inbox: states on a node that need the owner, fetched per node
  // (docs/frontend.md § Shell state; registries/attention.ts).
  attentionSources: ClientContributionPoint<AttentionSourceContribution>
  // A typed set of records a user can compose a panel over (docs/dashboards.md § Collections). The
  // compiled feeder. A loaded plugin declares `collections` in its manifest and the descriptor pass
  // builds the same contribution. `pluginId` and the registry id are bound here, not declared.
  collections: ClientContributionPoint<CollectionRegistration>
  // A brand logo as one SVG path, looked up under the `brand:` glyph prefix (docs/ui-design.md §
  // Icons).
  brandMarks: ClientContributionPoint<BrandMark>
  // A recogniser that turns an external URL into an in-app destination (registries/contentLinks.ts).
  contentLinks: ClientContributionPoint<ContentLinkContribution>
  // The escape hatch, and the line it sits on: a registry the HOST owns gets a named member above; a
  // registry another PLUGIN published has no member to give it, and goes through here. Same ownership
  // check and same recorded disposable either way, so the only difference is who declared the
  // registry. Both of core's own targets got names on 2026-08-27; before that the line was drawn
  // nowhere and every contribution count that read this file was two short.
  contribute<T extends { id: string }>(registry: Registry<T>, entry: T): void
  // Plugin-to-plugin functions, the same four methods as the node's `ctx.capabilities`
  // (../clientCapabilities.ts). Disposal is the host's, so a second activation in one process does not
  // hit "already provided".
  //
  // Not the platform gate. That is `requires` on a contribution, answered by hostCapabilities.ts.
  capabilities: ClientCapabilities
}

// The client half of the node's `Pick<CapabilityRegistry, 'provide' | 'get' | 'require' | 'ids'>`. Same
// four verbs, so an author who learned one half does not get the other backwards.
export type ClientCapabilities = {
  provide<T>(id: ClientCapabilityId<T>, impl: T): void
  get<T>(id: ClientCapabilityId<T>): T | undefined
  // For a capability whose provider cannot be disabled. Throws rather than returning undefined, so a
  // missing one fails where it is missed.
  require<T>(id: ClientCapabilityId<T>): T
  ids(): string[]
}

export type ClientPlugin = {
  name: string
  // The shell assumes a required plugin's contributions exist, so it cannot be disabled
  // (docs/plugins.md § Activation).
  required?: boolean
  // Registration only, and synchronous. Nothing here does I/O, so async would put a promise between
  // `render()` and the first paint for no gain.
  init(ctx: ClientPluginContext): void
  // The side-effect phase, run after every plugin's `init`, so no plugin does I/O while half the
  // registries are empty. A disabled plugin never reaches it. Synchronous as well, so a plugin wanting
  // a network read fires it and handles its own rejection.
  activate?(ctx: ClientPluginContext): void
}

export type ClientPluginHostOptions = {
  disabled?: readonly string[]
}

export type ClientPluginHostResult = {
  enabled: readonly string[]
  skipped: readonly string[]
}

// Everything a plugin registered, so a second activation can take it back out. Module-level because
// the registries are, and a per-host map would let two hosts fight over one registry unnoticed.
const contributed = new Map<string, Disposable[]>()

// A contribution that names a provider must name its own plugin. Contribution ids stay un-namespaced,
// because `pr`, `changes` and `palette.files` are persisted layout keys and chord targets, so
// prefixing them breaks stored state.
const declaredProvider = (entry: object): string | undefined =>
  'providerId' in entry && typeof (entry as { providerId?: unknown }).providerId === 'string'
    ? (entry as { providerId: string }).providerId
    : undefined

function makeContext(name: string, record: (disposable: Disposable) => void): ClientPluginContext {
  // Structural rather than `Registry<T>`, because the pane registry accepts a wider entry than it
  // stores: a pane may declare a layout and regions, and the registry turns that into a component.
  const own = <T extends { id: string }>(registry: { register: (entry: T) => Disposable }): ClientContributionPoint<T> => ({
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
  // Not `own`. The entry arrives without the two fields the host binds, so the provider check has
  // nothing to look at until they are stamped. The id is the host's to mint.
  // Neither goes through `own`. Both arrive without the field the host stamps, and the point's id is
  // qualified here rather than declared, which is the same rule the manifest path follows
  // (plugins/chrome/extensionPoints.ts).
  const ownExtensionPoint: ClientContributionPoint<CompiledExtensionPoint> = {
    register: (entry) => {
      record(extensionPointRegistry.register({
        ...entry,
        id: qualifiedExtensionPointId(name, entry.id),
        ownerId: name,
        max: entry.max ?? 1,
      }))
    },
  }
  const ownExtension: ClientContributionPoint<CompiledExtension> = {
    register: (entry) => {
      record(extensionRegistry.register({ ...entry, pluginId: name, carrier: 'component' }))
    },
  }
  const ownCollection: ClientContributionPoint<CollectionRegistration> = {
    register: (entry) => {
      record(collectionRegistry.register({ ...entry, id: collectionKey(name, entry.collectionId), pluginId: name }))
    },
  }
  return {
    name,
    panes: own<PaneRegistration>(paneRegistry),
    // The registry is heterogeneous by construction, so widening the item type here is the erasure
    // rather than a hole. Nothing downstream reads a promotion without selecting the source by id.
    sources: { register: <Item>(entry: SourceContribution<Item>) => sources.register(entry) },
    commands,
    keybindings,
    integrationFlows: ownIntegrationFlow,
    projectImporters: own(projectImporterRegistry),
    settingsPages: own(settingsRegistry),
    slots: own(uiSlotRegistry),
    extensionPoints: ownExtensionPoint,
    extensions: ownExtension,
    refPanels: own(refPanelRegistry),
    paletteRows: own(paletteRowRegistry),
    agentContexts: own(agentContextRegistry),
    schedules: own(clientScheduleRegistry),
    railMarkers: own(railMarkerRegistry),
    persistedStateSlices: own(persistedStateRegistry),
    nodeStats: own(nodeStatRegistry),
    attentionSources: own(attentionRegistry),
    collections: ownCollection,
    brandMarks: own(brandMarkRegistry),
    contentLinks: own(contentLinkRegistry),
    // Straight through `own`, so a plugin-published registry gets the same ownership check and the
    // same recorded disposable. Only the registry arrives as an argument.
    contribute: (registry, entry) => own(registry).register(entry),
    capabilities: {
      provide: (id, impl) => record(provideClientCapability(id, impl)),
      get: (id) => clientCapability(id),
      require: (id) => requireClientCapability(id),
      ids: () => clientCapabilityIds(),
    },
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
  // Kept so the activate pass runs in declaration order over the plugins that initialized, paired with
  // the context each one owns. A second `makeContext` would write disposables into a list nobody holds.
  const activations: { plugin: ClientPlugin; ctx: ClientPluginContext }[] = []

  for (const plugin of plugins) {
    // Take back whatever this plugin registered on a previous activation, before it registers again.
    // Registry.register throws on a duplicate id, so a second activate() in one process, from a test
    // or a dev-server reload, takes the shell down on the first pane without this.
    for (const disposable of [...(contributed.get(plugin.name) ?? [])].reverse()) disposable.dispose()
    const disposables: Disposable[] = []
    contributed.set(plugin.name, disposables)

    if (disabled.has(plugin.name) && !plugin.required) {
      skipped.push(plugin.name)
      continue
    }
    // Not caught, matching the node host. Every plugin here ships in the same bundle, and a
    // half-registered shell is worse than one that fails loudly at boot.
    const ctx = makeContext(plugin.name, (disposable) => disposables.push(disposable))
    plugin.init(ctx)
    enabled.push(plugin.name)
    if (plugin.activate) activations.push({ plugin, ctx })
  }

  // Second pass, mirroring the node host's `ready`. Every registry now holds every enabled plugin's
  // contributions, so a plugin priming a store can look up a sibling's descriptor.
  for (const { plugin, ctx } of activations) plugin.activate?.(ctx)

  return { enabled, skipped }
}
