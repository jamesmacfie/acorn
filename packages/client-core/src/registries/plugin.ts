import type { AgentContextContribution } from '@acorn/protocol/agentContext.ts'
import { persistedStateRegistry, type PersistedStateSlice } from '../persistence/persistedState'
import { agentContextRegistry } from './agentContexts'
import { agentToolRendererRegistry, type AgentToolRendererContribution } from './agentToolRenderers'
import { contextSectionRegistry, type ContextSectionContribution } from './contextSections'
import { paletteRowRegistry, type PaletteRowSource } from './paletteRows'
import { attentionRegistry, type AttentionSourceContribution } from './attention'
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
  commands: ClientContributionPoint<CommandContribution>
  keybindings: ClientContributionPoint<KeybindingContribution>
  integrationFlows: ClientContributionPoint<IntegrationFlowContribution>
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
  // One number on a Fleet home node card. Core supplies the task count; "agents running" is the agents
  // plugin's, and client-core cannot import it (registries/nodeStats.ts).
  nodeStats: ClientContributionPoint<NodeStatContribution>
  // Rows for the attention inbox — states on a node that need the owner, fetched per node
  // (registries/attention.ts).
  attention: ClientContributionPoint<AttentionSourceContribution>
  contribute<T extends { id: string }>(registry: Registry<T>, entry: T): void
  // Publish a typed capability for another plugin to resolve at call time, mirroring the node's
  // ctx.capabilities.provide. Disposal is the host's, exactly like every registry contribution above:
  // a second activation in one process must not hit "already provided".
  capability<T>(id: ClientCapabilityId<T>, impl: T): void
}

export type ClientPlugin = {
  name: string
  // github, terminal, agents, memory and notes: the shell (or core's context assembler behind it)
  // assumes their contributions exist, so they cannot be disabled. Same five as the node half, and for
  // the same reason. This list said "same three" while the node half had five — `memory` and `notes`
  // were togglable on the client and not on the node, so a user could untick half of one plugin.
  required?: boolean
  // Registration only, and synchronous: it publishes descriptors into signals. Nothing here awaits
  // anything, and nothing here performs I/O — making it async would put a promise between `render()`
  // and the first paint for no gain.
  init(ctx: ClientPluginContext): void
  // The side-effect phase, run after EVERY plugin's `init`. This is where a plugin does the once-per-
  // activation work that is not registration: subscribing to the event bus, priming a store, reading
  // localStorage. It exists because two plugins were doing exactly that inside `init` — plugins/http
  // enumerated `localStorage` and plugins/agents issued a `fetch` — which contradicted the paragraph
  // above and, worse, ran while half the registries were still empty. A plugin disabled in this pass
  // never reaches it.
  //
  // Still synchronous: a plugin that wants a network read fires it and handles its own rejection. The
  // host will not await a plugin before the first paint.
  activate?(ctx: ClientPluginContext): void
}

export type ClientPluginHostOptions = {
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
// `docker-footer-badge` are persisted layout keys and user-visible chord targets (docs/ui-design.md: panes keep
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
  const commands = own(commandRegistry)
  const keybindings = own(keybindingRegistry)
  const ownIntegrationFlow: ClientContributionPoint<IntegrationFlowContribution> = {
    register: (entry) => {
      if (entry.id !== name) throw new Error(`Plugin '${name}' registered integration flow '${entry.id}'`)
      record(integrationFlowRegistry.register(entry))
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
    // Straight through `own`, so a plugin-published registry gets the identical treatment: ownership checked,
    // disposable recorded. The only difference from the members above is that the registry arrives as an
    // argument instead of being named here.
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
  // paired with the context each one already owns — a second `makeContext` would hand the plugin a
  // recorder writing into a disposable list nobody holds.
  const activations: { plugin: ClientPlugin; ctx: ClientPluginContext }[] = []

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
