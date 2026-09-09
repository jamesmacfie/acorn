import { createComponent, lazy } from 'solid-js'
import type { NodePluginRow, PluginChromeAction, PluginCommandDescriptor, PluginCommandSelectAction, PluginSourceEmptyState } from '@acorn/protocol/api.ts'
import { isPluginShortcutChord, qualifiedPluginCommandId } from '@acorn/protocol/keybindings.ts'
import { isPluginOpenableUrl } from '@acorn/protocol/externalUrl.ts'
import { activeNodeId } from '../../infra/node/activeNode'
import { agentContextRegistry } from '../registries/sources/agentContexts'
import { attentionRegistry, type AttentionItem } from '../registries/rail/attention'
import { collectionKey, collectionRegistry, emptyCollectionPage } from '../registries/sources/collections'
import { nodeStatRegistry } from '../registries/rail/nodeStats'
import { commandRegistry } from '../registries/commands/commands'
import { keybindingRegistry } from '../registries/commands/keybindings'
import type { Disposable } from '../../kit/lib/registry'
import { sourceRegistry } from '../registries/sources/sources'
import { uiSlotRegistry } from '../registries/extensionPoints/slots'
import { brandMarkRegistry } from '../../kit/tokens/brandMarks'
import {
  loadedPluginStateOnNode,
  pluginEnabledOnNode,
  pluginInstalledAtOnNode,
} from '../plugins/distribution'
import { declaredSurfaces, eligiblePlugins, hasWithheldCode, type DeclaredSurfaces } from '../plugins/contributions'
import { pluginRowTarget, setPluginRowSource } from '../plugins/rowTargets'
import { pluginCommand, usablePluginCommands } from './chromeCommands'
import { suppliedSourcePanel } from './sourcePanel'
import {
  captureAgentContext,
  ownsRoute,
  readAgentContextOptions,
  readAttention,
  readCollection,
  readStat,
  resolveRefs,
  unwatchChrome,
  watchChrome,
} from './chromeData'
import { descriptorPromotion } from './promotion'
import { registerPluginContextMenu } from './chromeContextMenus'
import { registerPluginExtension, registerPluginExtensionPoint } from './chromeExtensionPoints'
import { registerPluginTheme } from './chromeThemes'
import { compileContentLinkPattern } from '@acorn/protocol/contentLinkPattern.ts'
import { contentLinkRegistry } from '../registries/panes/contentLinks'
import { refResolverRegistry } from '../registries/panes/refResolvers'
import { registerNoticeTargetHandler } from '../../features/notifications/notifications'
import { setSelectedSource } from '../../features/tasks/tasks'

// Turning accepted manifests into native shell contributions: the descriptor half of what
// plugins/frames/register.ts does for rectangles (docs/plugins.md).
//
// Same shape as that file: one module-level map of per-plugin disposables, a dispose-then-register pass
// so a re-run replaces a plugin's whole contribution set rather than reconciling it, and a per-surface
// try/catch so one duplicate id doesn't cost the plugin its other chrome. What differs is the gate:
// frames asks `trusted`, chrome asks the weaker `hasWithheldCode` (docs/plugins.md § One shared
// eligibility and trust check).
//
// Per-node presence stays the render-time gate. A plugin installed on node A contributes nothing to a
// surface looking at node B, because its routes aren't there.

// `.tsx` behind `lazy`, so this module stays importable from a bare-Node test suite: the repo's vitest
// configs have no Solid transform, and a module that reaches a JSX file can't be imported at all.
// `lazy` never resolves the import until something renders.
const ChromeSourcePanel = lazy(() => import('./ChromeSourcePanel'))
const ChromeBadge = lazy(() => import('./ChromeBadge'))

const registered = new Map<string, Disposable[]>()

// The node the rail and the task footer are looking at. There's no other candidate: a task belongs to
// whichever node the window is talking to.
const chromeNode = (): string => activeNodeId() ?? ''

// The surface ids a manifest declared, as the device read them, split by what each verb may name.
export type { DeclaredSurfaces }

// Can this action actually do anything from a click site with no row and no routed project? The node
// checked all three when it parsed the manifest, and a roster row is wire input, so the device checks
// again. Shared by commands, palette rows and a source's empty-state button.
const contextFreeActionUsable = (pluginId: string, surfaces: DeclaredSurfaces, action: PluginChromeAction): boolean => {
  if (action.verb === 'openPane') return surfaces.panes.has(action.pane)
  if (action.verb === 'openOverlay') return surfaces.overlays.has(action.overlay)
  if (action.verb === 'runNodeAction') return ownsRoute(pluginId, action.path)
  if (action.verb === 'openUrl') return isPluginOpenableUrl(action.url)
  // The one verb whose effect lands inside the plugin. It needs a pane of this plugin's own that is
  // running its bytes, because that is what receives the event; it needs no task, since a pane nobody
  // has open simply has nothing listening, which is the honest outcome for "do this in the thing I am
  // looking at" (./actions.ts § surfaceAction).
  if (action.verb === 'surfaceAction') return surfaces.actionPanes.has(action.surface)
  // `createTask` needs a selected rail row, and `navigate` needs a routed project and a navigator.
  // Refused rather than read, because the verb doesn't carry the field the site would need.
  return false
}

/** The same question for a search command's `onSelect`, which has a picked row and the project its
 *  scope was resolved against, so `navigate` is answerable there and nowhere else a command runs. The
 *  surface still has to be one this manifest declared as project-scoped, checked here as well as at
 *  parse time because a roster row is bytes a node sent. */
const selectActionUsable = (pluginId: string, surfaces: DeclaredSurfaces, action: PluginCommandSelectAction): boolean =>
  action.verb === 'navigate'
    ? surfaces.projectPanes.has(action.surface)
    : contextFreeActionUsable(pluginId, surfaces, action)

/** An authored empty state with an unusable action reduced to its message. Exported because the
 * descriptor it sanitises is captured inside a component closure, where a test can't reach it, and a
 * button that can only toast is exactly the failure worth pinning. */
export const usableEmptyState = (
  pluginId: string,
  surfaces: DeclaredSurfaces,
  empty: PluginSourceEmptyState | undefined,
): PluginSourceEmptyState | undefined =>
  // The message survives on its own: it's the part the rail was missing, and losing a sentence over a
  // button would be the worse trade.
  empty?.action && !contextFreeActionUsable(pluginId, surfaces, empty.action) ? { message: empty.message } : empty

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

  // Brand marks first, so a contribution registered below can already name `brand:<id>`. Icon reads the
  // registry reactively, so ordering is a nicety rather than a correctness rule.
  //
  // The name is stamped from the plugin id and never read off the manifest, the same rule contentLinks'
  // `providerId` follows below: a package can't claim another package's mark, and `icons` is no more
  // able to than `icon`. `add` already warns on a collision with a core mark, and core wins.
  if (installed.icon) {
    const { d, color } = installed.icon
    add('icon', pluginId, () => brandMarkRegistry.register({ id: pluginId, d, color }))
  }
  for (const [key, mark] of Object.entries(installed.icons ?? {})) {
    const id = `${pluginId}/${key}`
    add('icon', id, () => brandMarkRegistry.register({ id, d: mark.d, color: mark.color }))
  }

  const frames = contributions.frames ?? []
  const surfaceIds = new Set(frames.map((surface) => surface.id))
  // Classified once, in ../contributions.ts, because plugins/frames/register.ts feeds the same
  // `openPane` allowlist from the same declaration.
  const surfaces = declaredSurfaces(contributions)
  const taskPanes = surfaces.panes

  // `palette` is the one-release compatibility alias. Both forms become commands, and the palette's
  // existing command-registry pass renders only those whose `palette` flag is true.
  //
  // Which of the four kinds each one is, whether this device can honour it, and whether its parent is a
  // group of the same plugin's are all ./chromeCommands.ts: the same file builds the contribution, so
  // the check and the thing it lets through cannot drift apart.
  const commandBinding = {
    nodeId: chromeNode,
    enabled: () => pluginEnabledOnNode(chromeNode(), pluginId),
    usableAction: (candidate: PluginChromeAction) => contextFreeActionUsable(pluginId, surfaces, candidate),
    usableSelectAction: (candidate: PluginCommandSelectAction) => selectActionUsable(pluginId, surfaces, candidate),
  }
  const commands = usablePluginCommands(pluginId, [
    ...(contributions.commands ?? []),
    ...(contributions.palette ?? []).flatMap((descriptor): PluginCommandDescriptor[] =>
      // The two verbs a command can't carry, dropped rather than promoted. `createTask` needs a selected
      // rail row and `navigate` needs a routed project plus a navigator.
      descriptor.action.verb === 'createTask' || descriptor.action.verb === 'navigate'
        ? []
        : [{ ...descriptor, category: 'action', palette: true, action: descriptor.action }]),
  ], commandBinding)
  const commandById = new Map(commands.map((descriptor) => [descriptor.id, descriptor]))
  for (const descriptor of commands) {
    add('command', descriptor.id, () => commandRegistry.register(pluginCommand(pluginId, descriptor, commandBinding)))
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
    // declares no pane, and the host resolves the panel by provider at click time. An openPane that is
    // named still has to be a declared task pane, so the node's parse-time check is re-run here rather
    // than trusted.
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
        // Stamped from the plugin id, never read off the descriptor. It's what makes the plugin's own
        // reference panel reachable from one of its links, and a manifest that could state it could
        // point a link at another plugin's panel.
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
    // Same re-check a content link's `openPane` gets below: a named pane has to be one this plugin
    // declared, or a roster row could point core's first-open at somebody else's pane.
    const defaultPane = descriptor.defaultPane && taskPanes.has(descriptor.defaultPane) ? descriptor.defaultPane : undefined
    if (descriptor.defaultPane && !defaultPane) {
      console.warn(`[plugin-chrome] ${pluginId} source '${descriptor.id}' names an undeclared pane '${descriptor.defaultPane}'.`)
    }
    add('source', descriptor.id, () => sourceRegistry.register({
      id: descriptor.id,
      label: descriptor.label,
      glyph: descriptor.glyph,
      order: descriptor.order,
      ...(descriptor.providerId ? { providerId: descriptor.providerId } : {}),
      ...(descriptor.projectScoped ? { projectScoped: true } : {}),
      ...(defaultPane ? { defaultPane } : {}),
      when: () => pluginEnabledOnNode(chromeNode(), pluginId),
      // The rail list, from whichever host is drawing. `ChromeSourcePanel` is the DOM's and stays the
      // fallback, so nothing on the desktop moved; a cell host supplies its own and gets a list
      // instead of a reconciler refusing a `<main>` (./sourcePanel.ts).
      ...(suppliedSourcePanel()?.({ pluginId, descriptor })
        ?? { component: () => createComponent(ChromeSourcePanel, { pluginId, descriptor }) }),
      // A row's `task` block is the promotion capability. Registered independently of row selection, so
      // an integration can use the row click for detail navigation and a separate host-drawn "+Task"
      // affordance for promotion.
      promotion: descriptorPromotion(pluginId),
      // Still no `routes` on the source contribution, and that's a placement decision rather than a
      // deferral. `SourceRouteContribution` takes a bare pattern, so a manifest claiming one could claim
      // core's `/p/:projectId` and take over project navigation for the whole shell. The host-minted
      // prefix that fixes that arrived with `contributions.routes`, but a manifest route belongs to the
      // surface it addresses rather than to a rail list, so it's registered next to that surface's
      // component (registries/projectSurfaces.ts).
    }))
  }

  for (const descriptor of contributions.slots ?? []) {
    note(descriptor.refresh)
    // Two manifest slot names, one registry, two contexts. `footer` is a task slot: it draws inside a
    // task's layout and gets a taskId it doesn't use. `topbar` is a shell slot whose context is the
    // whole window. The badge component ignores both, because its data comes from a node route rather
    // than anything the slot could hand it; what differs is which host draws it and when.
    //
    // A slot name this client doesn't know is skipped rather than mapped to a default. A roster row is
    // bytes a node sent, and a newer node's `topbar.left` must not silently become the footer.
    if (descriptor.slot === 'footer') {
      add('slot', descriptor.id, () => uiSlotRegistry.register({
        id: descriptor.id,
        slot: 'task.footer',
        order: 500,
        component: () => createComponent(ChromeBadge, { pluginId, descriptor }),
      }))
    } else if (descriptor.slot === 'topbar') {
      add('slot', descriptor.id, () => uiSlotRegistry.register({
        id: descriptor.id,
        // The topbar's right end, the app's status bar and the only topbar slot with a host. Order 500
        // puts plugin chips after the notification bell (10) and before the account menu, which isn't a
        // slot at all.
        slot: 'topbar.right',
        order: 500,
        when: () => pluginEnabledOnNode(chromeNode(), pluginId),
        component: () => createComponent(ChromeBadge, { pluginId, descriptor }),
      }))
    } else {
      console.warn(`[plugin-chrome] ${pluginId} slot '${descriptor.id}' names an unknown slot '${descriptor.slot}'.`)
    }
  }

  for (const descriptor of contributions.contextMenus ?? []) {
    // The verb is checked here rather than inside the adapter, because this is where the manifest's own
    // declared surfaces are in scope. Same check a command and a source's empty state get: a row that
    // parses and can only toast is worse for an author than one that's refused.
    if (!contextFreeActionUsable(pluginId, surfaces, descriptor.action)) {
      console.warn(`[plugin-chrome] ${pluginId} context menu '${descriptor.id}' has an action this device cannot honour.`)
      continue
    }
    add('context menu', descriptor.id, () => registerPluginContextMenu(pluginId, descriptor, {
      nodeId: chromeNode,
      enabled: () => pluginEnabledOnNode(chromeNode(), pluginId),
    }))
  }

  // ── Cooperative cross-plugin extension (registries/extensionPoints.ts) ──────────────────────────
  //
  // Both halves ride this pass rather than the frames pass, and both are gated on the same
  // `hasWithheldCode` question every other descriptor is, because both are descriptors: a point is a
  // manifest line and a contribution is a route plus a verb. No plugin code executes on either side.
  const pointBinding = { nodeId: chromeNode, enabled: () => pluginEnabledOnNode(chromeNode(), pluginId) }
  for (const descriptor of contributions.extensionPoints ?? []) {
    // The surface is re-checked here rather than inside the adapter, because this is where the
    // manifest's own declared frames are in scope. A point hanging off a surface this manifest doesn't
    // declare would be a strip with no rectangle above it: the "parses and can never appear" failure the
    // node's parser refuses, re-refused on the device because a roster row is bytes a node sent.
    // Only the two kinds that hang off a surface have one to check. An annotation draws at a site the
    // owner registered in code, a remote slot is a node in the owner's own tree, and a hook draws
    // nothing: none of the three names a surface, so there is nothing here to hold them to.
    if (descriptor.surface !== undefined && !surfaceIds.has(descriptor.surface)) {
      console.warn(`[plugin-chrome] ${pluginId} extension point '${descriptor.id}' names an undeclared surface '${descriptor.surface}'.`)
      continue
    }
    add('extension point', descriptor.id, () => registerPluginExtensionPoint(pluginId, descriptor, pointBinding))
  }

  for (const descriptor of contributions.extensions ?? []) {
    // The two carriers that run this plugin's own bytes register in the frames pass instead, where the
    // accepted bundle hash and the trust answer are both in scope (plugins/frames/register.ts).
    if (descriptor.remote !== undefined || descriptor.frame !== undefined) continue
    // Same check a command and a context-menu row get. The point owner never sees this failure: a
    // contribution the device can't honour simply never delivers.
    if (descriptor.onSelect && !contextFreeActionUsable(pluginId, surfaces, descriptor.onSelect)) {
      console.warn(`[plugin-chrome] ${pluginId} extension '${descriptor.id}' has an action this device cannot honour.`)
      continue
    }
    note(descriptor.refresh)
    add('extension', descriptor.id, () => registerPluginExtension(pluginId, descriptor, pointBinding))
  }

  // Every attention row has to say where clicking it lands (registries/rail/attention.ts), and a
  // descriptor names nothing: the wire carries display strings only. So the host picks the honest
  // answer for this tier, computed by ../plugins/rowTargets.ts.
  //
  // Recorded rather than only used, because the bell needs the same answer for a notice this plugin
  // raises, and that arrives off the socket with nothing but a plugin id on it.
  setPluginRowSource(pluginId, contributions.sources?.[0]?.id)
  const pluginAttentionTarget = pluginRowTarget(pluginId)

  for (const descriptor of contributions.attention ?? []) {
    note(descriptor.refresh)
    add('attention', descriptor.id, () => attentionRegistry.register({
      id: descriptor.id,
      order: descriptor.order,
      // Addressed per node by the inbox's fan-out, never against the ambient active node. A node that
      // doesn't run this plugin answers with nothing rather than being asked.
      fetch: async (nodeId, signal): Promise<AttentionItem[]> => {
        if (!pluginEnabledOnNode(nodeId, pluginId)) return []
        const items = await readAttention(pluginId, descriptor.items, nodeId, signal)
        // Namespaced with the contribution id, as registries/attention.ts requires: the id is the row key
        // across refetches, and two plugins reporting `stuck` must not collide in one merged list.
        return items.map((item) => ({ ...item, id: `${descriptor.id}:${item.id}`, target: pluginAttentionTarget }))
      },
    }))
  }

  for (const descriptor of contributions.nodeStats ?? []) {
    note(descriptor.refresh)
    add('nodeStat', descriptor.id, () => nodeStatRegistry.register({
      id: descriptor.id,
      order: descriptor.order,
      label: descriptor.label,
      // `0` is hidden on the card, which is the right answer for a node that doesn't run this plugin.
      fetch: async (nodeId, signal) =>
        pluginEnabledOnNode(nodeId, pluginId) ? readStat(pluginId, descriptor.data, nodeId, signal) : 0,
    }))
  }

  for (const descriptor of contributions.collections ?? []) {
    note(descriptor.refresh)
    const declared = new Set((descriptor.params ?? []).map((param) => param.id))
    add('collection', descriptor.id, () => collectionRegistry.register({
      // The registry id is the host's, minted from the plugin id, the same stamp `ctx.collections`
      // applies on the compiled side, so a placement addressing `(pluginId, collectionId)` resolves the
      // same contribution whichever feeder supplied it.
      id: collectionKey(pluginId, descriptor.id),
      pluginId,
      collectionId: descriptor.id,
      name: descriptor.name,
      ...(descriptor.params ? { params: descriptor.params } : {}),
      ...(descriptor.schema ? { schema: descriptor.schema } : {}),
      ...(descriptor.refresh !== undefined ? { refresh: descriptor.refresh } : {}),
      // Addressed per node, never against the ambient active node: a node that doesn't run this plugin
      // answers with nothing rather than being asked.
      fetch: async (nodeId, params, signal) => {
        if (!pluginEnabledOnNode(nodeId, pluginId)) return emptyCollectionPage()
        // Only what the manifest declared reaches the route. A caller passing an undeclared key would be
        // inventing a scope the plugin never agreed to answer for.
        const passed = Object.fromEntries(Object.entries(params).filter(([key]) => declared.has(key)))
        return readCollection(pluginId, descriptor.id, descriptor.items, nodeId, passed, signal)
      },
    }))
  }

  for (const descriptor of contributions.agentContexts ?? []) {
    // The composer groups and replaces snapshots by `source`, so `source` is a namespace and the host
    // binds it, from the plugin id plus the contribution id in the colon form `ownsTaskOrigin` accepts.
    // A manifest never names it: `http` claiming `context.task` would evict acorn's own task-context
    // snapshot from someone's draft.
    const source = `${pluginId}:${descriptor.id}`
    // No `revision`. It's synchronous and a descriptor answers across a fetch, so there's no number to
    // return in time; the invalidation ping the rest of the chrome rides covers the same freshness.
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

  for (const descriptor of contributions.themes ?? []) {
    // A theme is a descriptor in the strictest sense: not merely data the host renders, but data the
    // host can't render as anything except colour, because the only thing it becomes is a block of
    // `--token: <colour>` declarations the host composed (./themes.ts). So it rides this pass's gate
    // unchanged.
    //
    // Withholding themes from a refused package is a judgement rather than a necessity, since nothing in
    // a theme executes. A picker entry from a package the owner declined is still the shell decorating
    // itself on behalf of something the owner said no to.
    add('theme', descriptor.id, () => registerPluginTheme(pluginId, descriptor))
  }

  for (const descriptor of contributions.refResolvers ?? []) {
    // `providerId` is the plugin id and nothing else. The descriptor can't state one, because a resolver
    // claiming another provider's name is how a plugin would get its own rows rendered as that
    // provider's items.
    add('ref resolver', descriptor.id, () => refResolverRegistry.register({
      id: descriptor.id,
      providerId: pluginId,
      kind: descriptor.kind,
      // Asking a node that isn't running the plugin spends a round trip to be told nothing, and the
      // consumer's fallback, the bare identifier, is the same either way.
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
  // Gated on `hasWithheldCode`, not `!trusted` (docs/plugins.md § One shared eligibility and trust
  // check): a descriptor-only package, as model-providers ships, has no bytes to accept and must still
  // contribute, so a rail row that opens a pane which will never mount is worse than no rail row.
  for (const entry of eligiblePlugins()) {
    if (hasWithheldCode(entry)) continue
    registered.set(entry.pluginId, registerChrome(entry.pluginId, entry.row, refreshes))
  }
  // One timer at the smallest declared interval rather than one per descriptor. The polling fallback is
  // for data that changes with no node-side trigger; the primary path is still the status ping.
  //
  // Not a `pollerContribution`: `startClientSchedules()` snapshots the registry once at app mount, and
  // this pass runs after the distribution round trip, so a poller registered here would never start.
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

// "Take me to that rail source", for a row whose owner has a surface but no opinion about where
// inside it to land. Registered here rather than in a shell's boot because this file mints the target
// and `setSelectedSource` is core's: both hosts draw from it, so both answer the click.
registerNoticeTargetHandler('source', (_taskId, target) => setSelectedSource(target.resourceId))
