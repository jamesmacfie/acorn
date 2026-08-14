import { createComponent, lazy } from 'solid-js'
import type { NodePluginRow, PluginChromeAction, PluginCommandDescriptor, PluginSourceEmptyState } from '@acorn/protocol/api.ts'
import { isPluginShortcutChord, qualifiedPluginCommandId } from '@acorn/protocol/keybindings.ts'
import { isPluginOpenableUrl } from '@acorn/protocol/externalUrl.ts'
import { activeNodeId } from '../../node/activeNode'
import { agentContextRegistry } from '../../registries/agentContexts'
import { attentionRegistry, type AttentionItem } from '../../registries/attention'
import { nodeStatRegistry } from '../../registries/nodeStats'
import { commandRegistry } from '../../registries/commands'
import { keybindingRegistry } from '../../registries/keybindings'
import type { Disposable } from '../../registries/registry'
import { sourceRegistry } from '../../registries/sources'
import { taskSlotRegistry } from '../../registries/slots'
import { brandMarkRegistry } from '../../ui/brandMarks'
import {
  bundleAccepted,
  installedByNode,
  loadedPluginStateOnNode,
  pluginEnabledOnNode,
  pluginInstalledAtOnNode,
} from '../distribution'
import { runChromeAction } from './actions'
import {
  captureAgentContext,
  ownsRoute,
  readAgentContextOptions,
  readAttention,
  readStat,
  resolveRefs,
  unwatchChrome,
  watchChrome,
} from './data'
import { descriptorPromotion } from './promotion'
import { compileContentLinkPattern } from '@acorn/protocol/contentLinkPattern.ts'
import { contentLinkRegistry } from '../../registries/contentLinks'
import { refResolverRegistry } from '../../registries/refResolvers'

// Turning accepted manifests into NATIVE shell contributions — the descriptor half of what
// plugins/frames/register.tsx does for rectangles (docs/plugins.md).
//
// Same shape as that file, deliberately: one module-level map of per-plugin disposables, a
// dispose-then-register pass so a re-run replaces a plugin's whole contribution set rather than
// reconciling it, and a per-surface try/catch so one duplicate id does not cost the plugin its other
// chrome. What differs is the gate, and it differs because chrome is DATA:
//
//   frames  gate on `bundleAccepted` — bytes execute, and this device said yes to these exact bytes.
//   chrome  gate on "no client bundle, OR its bundle was accepted". A descriptor executes nothing, so
//           a plugin that ships no code at all needs no trust prompt and gets its chrome. A plugin
//           whose code this device REFUSED gets none: its panes were never registered, so its chrome
//           would be offering an `openPane` that cannot land, and decorating the shell on behalf of
//           something the owner declined is the wrong answer regardless.
//
// Per-node presence stays the render-time gate. A plugin installed on node A contributes nothing to a
// surface looking at node B, because its routes are not there.

// `.tsx` behind `lazy`, so this module stays importable from a bare-Node test suite: the repo's vitest
// configs have no Solid transform, and a module that reaches a JSX file cannot be imported at all
// (registries/slots.ts explains the same split). `lazy` never resolves the import until something renders.
const ChromeSourcePanel = lazy(() => import('./ChromeSourcePanel'))
const ChromeBadge = lazy(() => import('./ChromeBadge'))

const registered = new Map<string, Disposable[]>()

// The node the rail and the task footer are looking at. There is no other candidate — a task belongs to
// whichever node the window is talking to.
const chromeNode = (): string => activeNodeId() ?? ''

// The surface ids a manifest declared, as the DEVICE read them, split by what each verb may name.
export type DeclaredSurfaces = { panes: ReadonlySet<string>; overlays: ReadonlySet<string> }

// Can this action actually do anything from a click site with no row and no routed project? The node
// checked all three when it parsed the manifest; a roster row is wire input, so the device checks them
// again. Shared by commands, palette rows and a source's empty-state button, which take the same
// narrowed verb set for the same reason (node-core/main/pluginManifest.ts § contextFreeAction).
const contextFreeActionUsable = (pluginId: string, surfaces: DeclaredSurfaces, action: PluginChromeAction): boolean => {
  if (action.verb === 'openPane') return surfaces.panes.has(action.pane)
  if (action.verb === 'openOverlay') return surfaces.overlays.has(action.overlay)
  if (action.verb === 'runNodeAction') return ownsRoute(pluginId, action.path)
  if (action.verb === 'openUrl') return isPluginOpenableUrl(action.url)
  // `createTask` needs a selected rail row, `navigate` needs a routed project and a navigator. Refused
  // rather than read, because the verb does not carry the field the site would need.
  return false
}

/** An authored empty state with an unusable action reduced to its message. Exported because the
 * descriptor it sanitises is captured inside a component closure, where a test cannot reach it — and a
 * button that can only toast is exactly the failure worth pinning. */
export const usableEmptyState = (
  pluginId: string,
  surfaces: DeclaredSurfaces,
  empty: PluginSourceEmptyState | undefined,
): PluginSourceEmptyState | undefined =>
  // The message survives on its own: it is the part the rail was missing, and losing a sentence over a
  // button would be the worse trade.
  empty?.action && !contextFreeActionUsable(pluginId, surfaces, empty.action) ? { message: empty.message } : empty

// Every plugin whose chrome this device may draw, one row per plugin id. The manifest travels with the
// roster row and one version wins per id, so the first node offering it is as good as any.
function eligible(): Map<string, NodePluginRow> {
  const rows = new Map<string, NodePluginRow>()
  for (const roster of installedByNode().values()) {
    for (const row of roster) {
      if (!row.installed || rows.has(row.name)) continue
      const client = row.installed.client
      if (client && !bundleAccepted(row.name, client.hash)) continue
      rows.set(row.name, row)
    }
  }
  return rows
}

function registerChrome(pluginId: string, row: NodePluginRow, refreshes: number[]): Disposable[] {
  const installed = row.installed!
  const contributions = installed.contributions
  const disposables: Disposable[] = []
  const add = (what: string, id: string, register: () => Disposable): void => {
    try {
      disposables.push(register())
    } catch (error) {
      // A duplicate id is the expected failure: contribution ids are un-namespaced by design, so a
      // third-party descriptor can collide with a first-party source or slot.
      console.warn(`[plugin-chrome] ${pluginId} could not contribute ${what} '${id}':`, error)
    }
  }
  const note = (seconds: number | undefined): void => void (seconds !== undefined && refreshes.push(seconds))

  // Brand marks first, so a contribution registered below can already name `brand:<id>` — Icon reads
  // the registry reactively, so ordering is a nicety rather than a correctness rule.
  //
  // The name is stamped from the plugin id and never read off the manifest, the same rule
  // contentLinks' `providerId` follows below: a package cannot claim another package's mark, with
  // `icons` no more able to than `icon`. `add` already warns on a collision with a core mark, and
  // core wins, which is the correct precedence while both exist.
  if (installed.icon) {
    const { d } = installed.icon
    add('icon', pluginId, () => brandMarkRegistry.register({ id: pluginId, d }))
  }
  for (const [key, mark] of Object.entries(installed.icons ?? {})) {
    const id = `${pluginId}/${key}`
    add('icon', id, () => brandMarkRegistry.register({ id, d: mark.d }))
  }

  const frames = contributions.frames ?? []
  const surfaceIds = new Set(frames.map((surface) => surface.id))
  // TASK-scoped panes only. Everything below that consumes this set puts a pane into a task's layout —
  // `openPane` on a command, a content link's retained intent, an agent-context deep link's `?pane=` — so a
  // project-scoped surface in here would be an offer that can only fail. It reaches the shell through
  // plugins/frames/register.tsx and the project-surface registry instead.
  const taskPanes = new Set(frames.filter((frame) => frame.target === 'webview' || (frame.target === 'pane' && frame.scope !== 'project')).map((frame) => frame.id))
  // The other set a context-free verb may name. An overlay is not a pane — it belongs to no task layout
  // — so it is kept apart rather than folded into the set above, where `openPane` would then accept it.
  const surfaces: DeclaredSurfaces = {
    panes: taskPanes,
    overlays: new Set(frames.filter((frame) => frame.target === 'overlay').map((frame) => frame.id)),
  }

  // `palette` is the one-release compatibility alias. Both forms become commands, and the palette's
  // existing command-registry pass renders only those whose `palette` flag is true.
  const commands: PluginCommandDescriptor[] = [
    ...(contributions.commands ?? []),
    ...(contributions.palette ?? []).flatMap((descriptor): PluginCommandDescriptor[] =>
      // The two verbs a command cannot carry, dropped rather than promoted. `createTask` needs a selected
      // rail row and `navigate` needs a routed project plus a navigator, and a palette row has none of them.
      descriptor.action.verb === 'createTask' || descriptor.action.verb === 'navigate'
        ? []
        : [{ ...descriptor, category: 'action', palette: true, action: descriptor.action }]),
  ].filter((descriptor) => contextFreeActionUsable(pluginId, surfaces, descriptor.action))
  const commandById = new Map(commands.map((descriptor) => [descriptor.id, descriptor]))
  for (const descriptor of commands) {
    add('command', descriptor.id, () => commandRegistry.register({
      id: qualifiedPluginCommandId(pluginId, descriptor.id),
      title: descriptor.title,
      category: descriptor.category,
      palette: descriptor.palette,
      when: () => pluginEnabledOnNode(chromeNode(), pluginId),
      run: () => runChromeAction(descriptor.action, { pluginId, nodeId: chromeNode(), commandId: descriptor.id }),
    }))
  }

  for (const descriptor of contributions.keybindings ?? []) {
    const command = commandById.get(descriptor.command)
    if (!command || !isPluginShortcutChord(descriptor.defaultChord)) {
      console.warn(`[plugin-chrome] ${pluginId} ignored an invalid keybinding for '${descriptor.command}'.`)
      continue
    }
    if (descriptor.when === 'surface' && (!descriptor.surface || !surfaceIds.has(descriptor.surface))) continue
    const id = qualifiedPluginCommandId(pluginId, descriptor.command)
    add('keybinding', id, () => keybindingRegistry.register({
      id,
      command: id,
      description: command.title,
      category: row.name,
      defaultChord: descriptor.defaultChord,
      when: descriptor.when === 'surface' ? 'pane' : descriptor.when,
      ...(descriptor.surface ? { pane: descriptor.surface } : {}),
      active: () => loadedPluginStateOnNode(chromeNode(), pluginId) === 'enabled',
      plugin: {
        id: pluginId,
        name: row.name,
        installedAt: () => pluginInstalledAtOnNode(chromeNode(), pluginId),
        state: () => loadedPluginStateOnNode(chromeNode(), pluginId),
      },
    }))
  }

  for (const descriptor of contributions.contentLinks ?? []) {
    // `openPane` is optional: a plugin whose only home for a matched item is its own reference panel
    // declares no pane at all, and the host resolves the panel by provider at click time. An openPane that
    // IS named still has to be a declared task pane — a roster row is bytes a node sent, so the node's
    // parse-time check is re-run here rather than trusted.
    const pane = descriptor.openPane
    if (pane !== undefined && !taskPanes.has(pane)) {
      console.warn(`[plugin-chrome] ${pluginId} content link '${descriptor.id}' names an undeclared pane '${pane}'.`)
      continue
    }
    add('content link', descriptor.id, () => {
      const pattern = compileContentLinkPattern(descriptor.match)
      if (!pattern.captures.includes(descriptor.item)) {
        throw new Error(`item '${descriptor.item}' is not captured by its pattern`)
      }
      return contentLinkRegistry.register({
        id: descriptor.id,
        // Stamped from the plugin id, never read off the descriptor. It is what makes the plugin's own
        // reference panel reachable from one of its links, and a manifest that could state it would be a
        // manifest that could point a link at another plugin's panel.
        providerId: pluginId,
        parse: (href) => {
          const captures = pattern.match(href)
          if (!captures) return null
          return { ...captures, kind: descriptor.id, ...(pane ? { pane } : {}), item: captures[descriptor.item] }
        },
      })
    })
  }

  for (const rawSource of contributions.sources ?? []) {
    note(rawSource.refresh)
    // The empty state's action is re-checked on the device for the same reason a command's is: it came
    // off a roster row.
    const emptyState = usableEmptyState(pluginId, surfaces, rawSource.emptyState)
    const descriptor = emptyState === rawSource.emptyState ? rawSource : { ...rawSource, emptyState }
    add('source', descriptor.id, () => sourceRegistry.register({
      id: descriptor.id,
      label: descriptor.label,
      glyph: descriptor.glyph,
      order: descriptor.order,
      ...(descriptor.providerId ? { providerId: descriptor.providerId } : {}),
      when: () => pluginEnabledOnNode(chromeNode(), pluginId),
      component: () => createComponent(ChromeSourcePanel, { pluginId, descriptor }),
      // A row's `task` block is the promotion capability. Register it independently of row selection
      // so an integration can use the row click for detail navigation and a separate host-drawn
      // +TASK affordance for promotion.
      promotion: descriptorPromotion(pluginId),
      // Still no `routes` on the source contribution, and that is now a placement decision rather than a
      // deferral. The reason a descriptor source could not have them was that `SourceRouteContribution`
      // takes a bare pattern, so a manifest claiming one could claim core's `/p/:projectId` and take over
      // project navigation for the whole shell. The host-minted prefix that fixes that arrived with
      // `contributions.routes` — but a manifest route belongs to the SURFACE it addresses, not to a rail
      // list, so it is registered next to that surface's component (registries/projectSurfaces.ts) and the
      // shell picks up both from there.
    }))
  }

  for (const descriptor of contributions.slots ?? []) {
    note(descriptor.refresh)
    add('slot', descriptor.id, () => taskSlotRegistry.register({
      id: descriptor.id,
      // The manifest's one slot name. `docker-footer-badge` is the precedent, and it is a task slot.
      slot: 'task.footer',
      order: 500,
      component: () => createComponent(ChromeBadge, { pluginId, descriptor }),
    }))
  }

  for (const descriptor of contributions.attention ?? []) {
    note(descriptor.refresh)
    add('attention', descriptor.id, () => attentionRegistry.register({
      id: descriptor.id,
      order: descriptor.order,
      // Addressed per node by the inbox's fan-out, never against the ambient active node. A node that
      // does not run this plugin answers with nothing rather than being asked.
      fetch: async (nodeId, signal): Promise<AttentionItem[]> => {
        if (!pluginEnabledOnNode(nodeId, pluginId)) return []
        const items = await readAttention(pluginId, descriptor.items, nodeId, signal)
        // Namespaced with the contribution id, as registries/attention.ts requires: the id is the row
        // key across refetches, and two plugins reporting `stuck` must not collide in one merged list.
        return items.map((item) => ({ ...item, id: `${descriptor.id}:${item.id}` }))
      },
    }))
  }

  for (const descriptor of contributions.nodeStats ?? []) {
    note(descriptor.refresh)
    add('nodeStat', descriptor.id, () => nodeStatRegistry.register({
      id: descriptor.id,
      order: descriptor.order,
      label: descriptor.label,
      // `0` is hidden on the card, which is the right answer for a node that does not run this plugin.
      fetch: async (nodeId, signal) =>
        pluginEnabledOnNode(nodeId, pluginId) ? readStat(pluginId, descriptor.data, nodeId, signal) : 0,
    }))
  }

  for (const descriptor of contributions.agentContexts ?? []) {
    // The composer groups and replaces snapshots by `source`, so `source` is a namespace and the host
    // binds it — from the plugin id plus the contribution id, in the same colon form `ownsTaskOrigin`
    // accepts. A manifest never gets to name it: `http` claiming `context.task` would evict acorn's
    // own task-context snapshot from someone's draft.
    const source = `${pluginId}:${descriptor.id}`
    // No `revision`. It is synchronous and a descriptor answers across a fetch, so there is no number
    // to return in time; the invalidation ping the rest of the chrome rides covers the same freshness.
    add('agent context', descriptor.id, () => agentContextRegistry.register({
      id: descriptor.id,
      source,
      label: descriptor.label,
      ...(descriptor.description ? { description: descriptor.description } : {}),
      options: async (scope) => pluginEnabledOnNode(chromeNode(), pluginId)
        ? readAgentContextOptions(pluginId, descriptor.options, chromeNode(), scope)
        : [],
      capture: async (scope, optionIds) => pluginEnabledOnNode(chromeNode(), pluginId)
        ? captureAgentContext(pluginId, descriptor.capture, chromeNode(), scope, optionIds, { source, panes: taskPanes })
        : [],
    }))
  }

  for (const descriptor of contributions.refResolvers ?? []) {
    // `providerId` is the plugin id and nothing else. The descriptor cannot state one, because a
    // resolver claiming another provider's name is how a plugin would get its own rows rendered as
    // that provider's items — the same line the content-link stamp holds one registry over.
    add('ref resolver', descriptor.id, () => refResolverRegistry.register({
      id: descriptor.id,
      providerId: pluginId,
      kind: descriptor.kind,
      // Asking a node that is not running the plugin spends a round trip to be told nothing, and the
      // consumer's fallback (the bare identifier) is the same either way.
      resolve: async (identifiers) => pluginEnabledOnNode(chromeNode(), pluginId)
        ? resolveRefs(pluginId, descriptor.resolve, chromeNode(), identifiers)
        : [],
    }))
  }

  return disposables
}

/**
 * Register every eligible plugin's declared chrome. Idempotent: called after the distribution pass and
 * again when a trust decision lands, and each call replaces what the previous one contributed.
 */
export function syncChromeContributions(): void {
  disposeAll()
  const refreshes: number[] = []
  for (const [pluginId, row] of eligible()) registered.set(pluginId, registerChrome(pluginId, row, refreshes))
  // One timer at the smallest declared interval, rather than one per descriptor. The polling fallback is
  // for data that changes with no node-side trigger; the primary path is still the status ping, and a
  // handful of tiny reads sharing a tick is not worth five timers.
  //
  // Not a `pollerContribution`: `startClientPollers()` snapshots the registry once at app mount, and this
  // pass runs after the distribution round trip — a poller registered here would never be started.
  if (registered.size) watchChrome(refreshes.length ? Math.min(...refreshes) : undefined)
  else unwatchChrome()
}

function disposeAll(): void {
  for (const disposables of registered.values()) for (const disposable of disposables.reverse()) disposable.dispose()
  registered.clear()
}

/** Test seam, mirroring _resetFrameContributions: the registries are module-level, so a suite that
 * asserts on one pass must not inherit the previous one's contributions. */
export function _resetChromeContributions(): void {
  disposeAll()
  unwatchChrome()
}
