import { createComponent, createSignal, lazy, type JSX } from 'solid-js'
import type { NodePluginRow, PluginFrameSurface } from '@acorn/protocol/api.ts'
import type { DocumentHandle } from '../../features/editor/documentModel'
import { isPluginKeyClaim } from '@acorn/protocol/keybindings.ts'
import type { PaneLayoutName } from '@acorn/protocol/paneLayouts.ts'
import { isCoreExclusiveSlot, qualifiedExtensionPointId } from '@acorn/protocol/extensionPoints.ts'
import { panelRegion } from '../../features/dashboards/region'
import { activeNodeId } from '../../infra/node/activeNode'
import { registerPluginExtension } from '../chrome/chromeExtensionPoints'
import { commandRegistry } from '../registries/commands/commands'
import { pluginProjectRoutePrefix } from '../registries/commands/corePaths'
import { keybindingRegistry } from '../registries/commands/keybindings'
import { paneRegistry } from '../registries/panes/panes'
import { suppliedExtendedPane } from '../chrome/extendedPane'
import { suppliedLayout } from '../layouts/table'
import { suppliedRemoteTree } from '../tree/table'
import { projectImporterRegistry } from '../registries/sources/projectImporters'
import { projectSurfaceRegistry } from '../registries/panes/projectSurfaces'
import { clearExclusiveSlotFailures, exclusiveSlotRegistry } from '../registries/extensionPoints/exclusiveSlots'
import { refPanelRegistry } from '../registries/panes/refPanels'
import type { Disposable } from '../../kit/lib/registry'
import { settingsRegistry } from '../registries/shell/settings'
import { uiSlotRegistry } from '../registries/extensionPoints/slots'
import { activeTaskId } from '../../features/tasks/tasks'
import {
  activeBundles,
  pluginEnabledOnNode,
  pluginInstalledAtOnNode,
  loadedPluginStateOnNode,
} from '../plugins/distribution'
import { eligiblePlugins, isTaskPane } from '../plugins/contributions'
import { clearSurfaceFailures, recordSurfaceFailure } from '../plugins/surfaceFailures'
import type { FrameBinding } from './broker'
import { isHostOwnedSurface, paneLayoutFor, remoteRegionEntry } from './layouts'
import { closePluginOverlay, pluginOverlayOpen } from './overlays'
import { createLogger } from '../../infra/telemetry/logger'

const log = createLogger('plugins')

// Turning accepted manifests into shell contributions (docs/plugins.md § Frame contribution kind).
//
// This file registers ordinary contributions, pre-bound to the plugin, surface and bundle. What draws
// inside one is the surface's own declaration: a `remote` region is a tree of the host's own components
// emitted by the plugin's worker, a `document` region is the host's editor, and a `frame` region is a
// PluginFrame, the plugin's bundle in a sandboxed iframe. The phase doc sketched a
// `kind: 'component' | 'frame'` union on each contribution type instead, which would put a branch in
// every consumer to express one thing: which component renders. The registries and their consumers are
// untouched, and pane ids keep working as the persisted layout keys they are.
//
// A pane, a reference panel and a settings page have to name a layout, so what fills them is always a
// declaration rather than a default. The three surfaces the host wraps entirely — an overlay, an
// importer, a coreSlot — do not: each is a rectangle by construction, with no arrangement to name and
// no second region, so a layout key there would have one legal value.
//
// The importer is the one surface where the doc's reasoning still bites: a frame can't be handed
// callbacks. It doesn't need to be. The host passes `onClose` and `onImported` into PluginFrame, which
// turns them into bridge verbs, and the shell keeps the modal chrome and the post-import refresh.
//
// Two gates decide whether a surface is registered at all:
//
//   accepted   this device said yes to these exact bytes. A cached-but-undecided or rejected bundle
//              never reaches a registry, so "never auto-run code a node pushed" holds at the
//              registration boundary rather than at the iframe.
//   bound      every id, provider and surface comes from the manifest as the host read it. Plugin code
//              can't register a shell contribution at all; only a manifest can.
//
// `.ts`, not `.tsx`, and that shapes everything below. The repo's vitest configs run in bare Node with
// no Solid transform, so a module that reaches a JSX file can't be imported by a test at all, and this
// module holds the nine registration decisions. So every component below is behind `lazy`, and the two
// surfaces needing real host markup are their own components rather than JSX here.

const PluginFrame = lazy(() => import('./PluginFrame'))
const PluginWebview = lazy(() => import('./PluginWebview'))
const PluginRefPanel = lazy(() => import('./PluginRefPanel'))
const PluginOverlay = lazy(() => import('./PluginOverlay'))
// The pane wrapper for an owner that reserved a strip for other plugins' rows. Only reached by a
// manifest that declared a point: a pane with no point renders the bare frame.
const DomExtendedPane = lazy(() => import('../chrome/ChromeExtendedPane'))
// The tree path's mount point, the counterpart to PluginFrame above: a region, a panel body or a slot
// drawn from the host's own components rather than from the plugin's pixels
// (docs/plugins.md § The tree contract).
//
// Host-supplied, with the DOM's as the fallback, for the reason `paneLayouts` below is: this pass runs
// on every host and a terminal draws a tree in cells (../tree/table.ts).
const RemoteTree = lazy(async () => ({ default: suppliedRemoteTree() ?? (await import('../tree/RemoteTree')).RemoteTree }))
// Lazy for the reason above, plus one more: this file is evaluated on every shell boot, and a static
// import would put the editor and its grammars in the boot graph for a pane most sessions never open.
const DocumentSurface = lazy(() => import('../../features/editor/DocumentSurface'))
// The host's layouts. Its own lazy boundary rather than a branch inside the one above, so a shell that
// only opens whole-pane documents never pulls the splitters and the tab strip in.
const paneLayouts = () => import('../layouts')
// Host-supplied, exactly as the compiled pane path already resolves it (../layouts/table.ts).
const layoutComponent = async (name: PaneLayoutName) => suppliedLayout(name) ?? (await paneLayouts()).LAYOUTS[name]

/** What a pane's regions are being drawn for: a task, or a routed project item. Read per call, never
 *  captured, so a region that mounts late still sees the current subject. */
type LayoutScope = { taskId?: string; projectId?: string; item?: string }

const registered = new Map<string, Disposable[]>()

// `activeNodeId()` is the frame's node, and there's no other candidate: a task belongs to whichever node
// the window is talking to, and a rail-scoped surface is looking at that node too. The frame never names
// one (docs/plugins.md: "The host pins which Node the frame talks to").
//
// Read per frame, not per registration, which is what makes a plain string safe here rather than an
// accessor. `frameBindingFor` is called inside each contribution's `component`, so the id resolves when
// a frame mounts. The pin can't go stale under it: a node switch moves `activeCacheId()`, the
// composition root keys the whole shell on that value, and every mounted frame is disposed and rebuilt.
// Registration can't lose the race either, because `selectActiveNode()` is awaited first. The `when`
// gates below are getters because what a registration reads has to stay reactive across the same switch.
//
// `''` when there's no node at all is the browser-served `dev:node` mode, where the origin is the node
// and apiClient's same-origin fallback is the right target.
const frameNode = (): string => activeNodeId() ?? ''

/**
/**
 * What one frame is, as the host decided it: the value no message can influence.
 *
 * Exported because it's called inside a contribution's `component`, where a bare-Node suite can't reach
 * it, and two of its fields are security answers rather than plumbing. `panes` is the `openPane`
 * allowlist and `claimsKeys` is the closed key policy re-applied to a roster row.
 */
export const frameBindingFor = (pluginId: string, surface: PluginFrameSurface, row: NodePluginRow, extra: Partial<FrameBinding> = {}): FrameBinding => ({
  pluginId,
  surface: surface.id,
  target: surface.target,
  nodeId: frameNode(),
  api: row.installed?.permissions.api ?? [],
  events: row.installed?.permissions.events ?? [],
  ...(surface.target === 'webview' ? { hosts: surface.hosts ?? [] } : {}),
  // The plugin's own task-scoped pane ids, which is the allowlist for the `openPane` verb.
  // Project-scoped surfaces are excluded because the verb opens into a task's layout.
  panes: (row.installed?.contributions.frames ?? []).filter(isTaskPane).map((entry) => entry.id),
  destinations: (surface.destinations ?? []).map(({ id, targetKind }) => ({ id, targetKind })),
  // Roster rows are wire input. The node parsed these, but the device re-applies the closed claim
  // policy before handing the declaration to a frame.
  claimsKeys: (surface.claimsKeys ?? []).filter(isPluginKeyClaim),
  ...extra,
})

// Registered per plugin and torn down as a unit: a re-run replaces a plugin's whole contribution set
// rather than reconciling it, the way the client plugin host does (registries/plugin.ts).
function registerSurfaces(pluginId: string, hash: string, row: NodePluginRow, trusted: boolean): Disposable[] {
  const disposables: Disposable[] = []
  for (const surface of row.installed?.contributions.frames ?? []) {
    // A surface a future mobile shell would have to render unusably in a phone viewport
    // (docs/future/remote.md).
    if (!surface.formFactor.includes('desktop')) continue
    // An `inline` surface registers nothing of its own: it is a rectangle offered into another plugin's
    // `rectangle` point, and the only thing that ever draws it is that plugin's pane (./InlineSlot.tsx).
    // Registering it as a pane here would put it in this plugin's own switcher, which is the opposite
    // of what "somebody else's pane reserved a box" means.
    if (surface.target === 'inline') continue
    // A host-owned document surface runs no plugin code on this device: the host draws the editor and
    // the plugin's contribution is two routes on a node. So it's gated like a descriptor rather than
    // like a frame. No bytes execute, so there's nothing for a bytes-hash prompt to be about, and a
    // plugin that ships only document surfaces needs no client bundle.
    if (!trusted && !isHostOwnedSurface(surface)) continue
    try {
      disposables.push(registerSurface(pluginId, hash, row, surface))
    } catch (error) {
      // A duplicate id is the expected failure, since contribution ids are un-namespaced by design and a
      // third-party plugin can collide with a first-party pane. One bad surface is skipped and the rest
      // of the plugin still works.
      //
      // Recorded as well as logged: on its own the warn was invisible, so the author saw a pane that
      // didn't exist and nothing to explain it. This also reaches the attention inbox through
      // node/pluginFailures.ts.
      log.warn(`${pluginId} could not contribute ${surface.target} '${surface.id}'`, error, { 'plugin.id': pluginId })
      recordSurfaceFailure(pluginId, surface.id, error)
    }
  }
  // The two extension carriers that run the plugin's own bytes: a remote tree in a worker, and an
  // `inline` rectangle in an iframe. Both ride this pass rather than the chrome one, and both are gated
  // on trust for the same reason a pane is and with no second question asked — the prompt the owner
  // answered was about these bytes (docs/shell.md § The plugin worker). The other two
  // carriers, `items` and `route`, are descriptors and register in the chrome pass.
  for (const entry of row.installed?.contributions.extensions ?? []) {
    if (entry.remote === undefined && entry.frame === undefined) continue
    if (!trusted) continue
    try {
      disposables.push(registerPluginExtension(pluginId, entry, {
        nodeId: frameNode,
        enabled: () => pluginEnabledOnNode(frameNode(), pluginId),
        hash,
      }))
    } catch (error) {
      log.warn(`${pluginId} could not contribute extension '${entry.id}'`, error, { 'plugin.id': pluginId })
      recordSurfaceFailure(pluginId, entry.id, error)
    }
  }
  return disposables
}

function registerSurface(pluginId: string, hash: string, row: NodePluginRow, surface: PluginFrameSurface): Disposable {
  // Every registration in this function goes through `own`, so the plugin id reaches each registry's
  // owner side-map and the seams that build a telemetry record can name whose rectangle it was
  // (kit/lib/registry.ts § the owner side-map). The same helper `host/chrome/chromeRegister.ts` uses,
  // and for the same reason: this is the pass that knows the owner, and a manifest cannot state one.
  const own = <T extends { id: string }>(registry: { register(entry: T, owner?: string): Disposable }, entry: T): Disposable =>
    registry.register(entry, pluginId)
  /**
   * The bundle entry this surface's one region names, as a contribution ready to mount, or `null` when
   * the region is `frame` and the body is the plugin's own rectangle.
   *
   * For the surfaces whose chrome the host already draws — a reference panel, a settings page — where
   * `single` is the only layout the manifest parser accepts. There is no arrangement to draw and no
   * layout component to load; what the layout key buys is the same re-checked way of naming a bundle
   * entry that a pane uses, and the explicit `frame` region that says the other answer out loud.
   */
  const singleRegionTree = (candidate: PluginFrameSurface) => {
    const entry = Object.values(paneLayoutFor(pluginId, candidate)?.regions ?? {})
      .map(remoteRegionEntry)
      .find((name) => name !== null)
    return entry ? { id: candidate.id, pluginId, hash, entry } : null
  }

  switch (surface.target) {
    // Unreachable: the loop above skips these before they get here, because an `inline` rectangle has
    // no registry of its own. Spelled rather than left to the exhaustiveness check, so the reason is at
    // the switch a reader is looking at rather than forty lines above it.
    case 'inline':
      throw new Error(`inline surface '${surface.id}' is placed by another plugin's point, not registered here`)
    case 'webview':
      return own(paneRegistry, {
        id: surface.id,
        label: surface.label,
        glyph: surface.glyph,
        order: surface.order,
        when: () => pluginEnabledOnNode(frameNode(), pluginId),
        component: (props) => createComponent(PluginWebview, {
          pluginId,
          surface,
          hash,
          binding: frameBindingFor(pluginId, surface, row, { taskId: props.task.id, projectId: props.task.projectId }),
        }),
      })
    case 'pane':
      // How this pane's inside is drawn, once the layout block below has worked it out. Declared out
      // here because the block that decides it and the block that registers the task pane are two
      // blocks: the second one also owns the provider gate and the extension-point wrapper.
      let paneDraw!: (scope: () => LayoutScope) => JSX.Element
      // Every pane declares one of the host's layouts. The host draws the arrangement and fills each
      // region: a document region is the host's editor and runs no plugin code at all, a `frame` region
      // is the plugin's own bundle in an iframe, and a `remote` region is that same bundle in a worker
      // emitting a tree the host draws (docs/panes.md § Layout model). This comes before everything else
      // the `pane` case does, because a pane whose regions are all documents has no bundle to mount and
      // no bridge to open.
      //
      // The routes were confined to `/v2/p/<id>/` when the node parsed the manifest and are confined
      // again here: the manifest reached this device as a roster row, and a node could have sent
      // something its own parser would have rejected.
      //
      // Throws, and so is skipped and logged by registerSurfaces, when a roster row carried a layout
      // name, a region set or a route the node's own parser would have refused.
      {
        // Never null: the manifest parser refuses a pane that names no layout, and this file re-checks
        // the roster row it arrived in. A pane drawing its own pixels says `regions: { body: 'frame' }`.
        const declared = paneLayoutFor(pluginId, surface)
        if (declared === null) throw new Error(`pane surface '${surface.id}' names no layout`)
        // One region builder for the two registries below, because the only thing that differs between a
        // task pane and a project pane here is what the subject is: a task, or a routed item.
        const drawLayout = (() => {
          const layout = declared.layout
          const Draw = lazy(async () => ({ default: await layoutComponent(layout) }))
          return (scope: () => LayoutScope): JSX.Element => {
            const binding = () => frameBindingFor(pluginId, surface, row, { taskId: scope().taskId, projectId: scope().projectId })
            // Held here rather than passed down, because the regions mount independently: an iframe
            // can connect its bridge before the editor has finished fetching its document. PluginFrame
            // reads through the accessor per call, so a frame that got there first still finds the
            // document when it arrives.
            const [document, setDocument] = createSignal<DocumentHandle | null>(null)
            const regions: Record<string, () => JSX.Element> = {}
            for (const [name, region] of Object.entries(declared.regions)) {
              // Both of these run the plugin's own bytes, which is why `isHostOwnedSurface` excluded such
              // a pane from the trust bypass and why there is a `hash` to hand over. What differs is
              // where they run: an iframe with its own origin, or a worker with no DOM at all.
              if (region === 'frame') {
                regions[name] = () => createComponent(PluginFrame, { binding: binding(), hash, document })
                continue
              }
              if (region.kind === 'remote') {
                // The surface id, not the region name, is the contribution id: `surfaceAction` and the
                // rail's pane intent both address a pane, and a pane with two remote regions is still one
                // pane. Which region a message is for is the plugin's own question, and the plugin is the
                // only side that can answer it.
                const contribution = { id: surface.id, pluginId, hash, entry: region.entry }
                // The document goes to this region as well as to a `frame` one. Both are the plugin's
                // own bytes in the other half of a composed pane, and the grant is structural either
                // way: what makes the `document` verb answerable is standing beside a host editor, not
                // which of the two runtimes the bundle happens to be in
                // (docs/editor.md § Communication between regions).
                regions[name] = () => createComponent(RemoteTree, { contribution, props: scope, scope, document })
                continue
              }
              regions[name] = () => createComponent(DocumentSurface, {
                pluginId,
                surfaceId: surface.id,
                nodeId: frameNode(),
                region,
                scope: scope(),
                // The updater form, because a Solid setter given a bare value it can call would
                // call it, and a document handle is a bag of methods.
                onHandle: (next: DocumentHandle | null) => { setDocument(() => next) },
              })
            }
            return createComponent(Draw, { stateKey: surface.id, label: surface.label, regions })
          }
        })()

        // Project scope lands in its own registry: the surface is drawn beside its plugin's rail list, with
        // no task to hand it and no layout key to persist (registries/projectSurfaces.ts says why the two
        // aren't one registry). The manifest guarantees both a route and a source that navigates to it, but
        // it reached this device as a roster row, so the confinement is re-applied here.
        if (surface.scope === 'project') {
          const route = (row.installed?.contributions.routes ?? []).find((entry) => entry.surface === surface.id)
          if (!route) throw new Error(`project-scoped surface '${surface.id}' has no declared route`)
          if (!route.path.startsWith(pluginProjectRoutePrefix(pluginId))) {
            throw new Error(`route '${route.path}' is outside ${pluginProjectRoutePrefix(pluginId)}`)
          }
          if (!route.path.split('/').includes(`:${route.item}`)) {
            throw new Error(`route '${route.path}' does not capture '${route.item}'`)
          }
          return own(projectSurfaceRegistry, {
            id: surface.id,
            path: route.path,
            item: route.item,
            order: route.order,
            // No `when` gate, unlike the task pane below. The only thing that renders this is the plugin's
            // own descriptor rail panel, and the source registry already gates that on the plugin running
            // on the node being looked at.
            // A getter inside the scope, because the routed item is the project surface's selection and
            // the host updates it in place rather than remounting: `scope` is read per call, so a frame
            // region turns each change into a `select` message and a tree redraws.
            component: (props) => drawLayout(() => ({ projectId: props.projectId, item: props.item })),
          })
        }
        paneDraw = drawLayout
      }
      // Did this manifest reserve part of this pane for somebody else? Two locations, two contributors:
      // a `pane.footer` strip filled by other plugins' rows, and a `pane.aside` column filled by the
      // user's own panels (docs/dashboards.md § Placements). Both are read off the manifest rather
      // than the registry, because the chrome pass registers points on its own schedule and asking the
      // registry here would make the wrapper depend on which pass ran first.
      //
      // A reserved-but-empty footer costs the owner a component and no pixels. An aside is different on
      // purpose: it's the user's rectangle, and it draws its "Add panel" affordance from the moment it's
      // reserved, which is the only way a person can put a first panel in it.
      {
        const points = (row.installed?.contributions.extensionPoints ?? [])
          .filter((entry) => entry.surface === surface.id)
        const point = points.find((entry) => entry.location === 'pane.footer')
        const pointId = point ? qualifiedExtensionPointId(pluginId, point.id) : null
        // The two rectangle locations, each holding another plugin's iframe beside this one's
        // (docs/plugins.md § Cooperative extension points, the `rectangle` kind).
        const inlineId = (location: string): string | null => {
          const entry = points.find((candidate) => candidate.location === location)
          return entry ? qualifiedExtensionPointId(pluginId, entry.id) : null
        }
        const inlineBelow = inlineId('pane.inline-below')
        const inlineBeside = inlineId('pane.inline-beside')
        const asidePoint = points.find((entry) => entry.location === 'pane.aside')
        // The point id doubles as the placement's owner id. It's already `<pluginId>:<pointId>`, minted
        // by the host, so a plugin can't address another package's stored composition.
        const aside = asidePoint
          ? {
            pointId: qualifiedExtensionPointId(pluginId, asidePoint.id),
            region: panelRegion(pluginId, asidePoint.panels),
          }
          : null
        // A pane that names a provider is a linked-items view: on a task with nothing linked it could
        // only draw its own empty state, so the switcher hides it until the task links an item of that
        // provider. Same self-naming rule as the refPanel below. The gate also covers `openPane`, so a
        // rail-row click lands on a task that will not mount the pane unless the item is linked first.
        if (surface.providerId && surface.providerId !== pluginId) {
          throw new Error(`declared provider '${surface.providerId}' is not '${pluginId}'`)
        }
        return own(paneRegistry, {
          id: surface.id,
          label: surface.label,
          glyph: surface.glyph,
          order: surface.order,
          // The per-node gate. A plugin installed on node A contributes nothing to a task on node B, so
          // the switcher never offers a pane whose routes aren't there (distribution.ts).
          when: (task) => pluginEnabledOnNode(frameNode(), pluginId)
            && (!surface.providerId || task.links.some((link) => link.providerId === surface.providerId)),
          component: (props) => {
            // The pane's regions. The wrapper below is separate from them because a footer strip and an
            // aside column belong to the pane rather than to whatever fills it.
            const frame = paneDraw(() => ({ taskId: props.task.id, projectId: props.task.projectId ?? undefined }))
            if (!pointId && !aside && !inlineBelow && !inlineBeside) return frame
            // The host seam, for the same reason the layout table and the remote tree are seams:
            // the DOM's wrapper is a `div` and an `aside` and would be handed to whatever reconciler
            // this host runs (../chrome/extendedPane.ts).
            return createComponent(suppliedExtendedPane() ?? DomExtendedPane, {
              ...(pointId ? { footerPointId: pointId } : {}),
              ...(aside ? { aside } : {}),
              ...(inlineBelow ? { inlineBelowPointId: inlineBelow } : {}),
              ...(inlineBeside ? { inlineBesidePointId: inlineBeside } : {}),
              taskId: props.task.id,
              projectId: props.task.projectId,
              children: frame,
            })
          },
        })
      }
    case 'coreSlot': {
      // The exclusive slot: an offer to draw one of core's own surfaces (registries/exclusiveSlots.ts).
      //
      // Registering seizes nothing. This lands in a registry whose read step is `resolveExclusiveSlot`,
      // which answers "core" for everything except the one plugin the user picked in settings. Three
      // plugins may register for the same slot and the rail keeps drawing its own list.
      //
      // Re-checked against this shell's designated list: a roster row is bytes a node sent, and a newer
      // node's slot name must not be coerced into one this shell has a host for.
      if (!isCoreExclusiveSlot(surface.coreSlot)) {
        throw new Error(`coreSlot surface '${surface.id}' names an unknown core surface '${surface.coreSlot}'`)
      }
      const slot = surface.coreSlot
      return own(exclusiveSlotRegistry, {
        id: `plugin:${pluginId}:${surface.id}`,
        pluginId,
        slot,
        label: surface.label,
        when: () => pluginEnabledOnNode(frameNode(), pluginId),
        // No task and no project in the binding: a core surface isn't inside anybody's task layout, and a
        // replacement that could ask for one would be replacing a different surface.
        component: () => createComponent(PluginFrame, { binding: frameBindingFor(pluginId, surface, row), hash }),
      })
    }
    case 'refPanel': {
      // A panel names the provider whose items it renders, and may only name its own. The same check the
      // client plugin host runs over first-party contributions, applied to a manifest.
      if (surface.providerId && surface.providerId !== pluginId) {
        throw new Error(`declared provider '${surface.providerId}' is not '${pluginId}'`)
      }
      const panelTree = singleRegionTree(surface)
      return own(refPanelRegistry, {
        id: surface.id,
        providerId: pluginId,
        // The same per-node gate the task pane above carries: the panel's frame talks to routes on the
        // node being looked at. It's on the registry rather than only in `RefPanelHost` because
        // `openRefPanel` consults it to decide whether to claim the click at all.
        when: () => pluginEnabledOnNode(frameNode(), pluginId),
        // The host draws the box (./PluginRefPanel.tsx says why it's the host's job, not the frame's).
        // What goes in it is either the plugin's rectangle or a tree it emits: a panel body is a tree,
        // and a panel that declared a layout with a remote region says so.
        component: (props) => createComponent(PluginRefPanel, {
          binding: frameBindingFor(pluginId, surface, row),
          hash,
          ...(panelTree ? { tree: panelTree } : {}),
          get displayId() {
            return props.target.displayId
          },
          get onClose() {
            return props.onClose
          },
        }),
      })
    }
    case 'overlay': {
      // The full-screen picker slot, which the editor's Cmd+P file palette occupies as a compiled
      // contribution. The host draws the box, as it does for the reference panel above.
      //
      // Nothing here decides when it appears. An overlay has no click site of its own: the only thing
      // that opens one is the `openOverlay` verb (plugins/chrome/actions.ts), and the manifest refuses an
      // overlay that no action opens.
      const open = (): boolean => pluginOverlayOpen(pluginId, surface.id)
      const closeId = `plugin.${pluginId}.overlay-close.${surface.id}`
      const disposables = [
        own(commandRegistry, {
          id: closeId,
          title: `Close ${surface.label}`,
          category: 'action',
          // Kept out of the palette: it's only available while an overlay covers the palette.
          palette: false,
          when: open,
          run: closePluginOverlay,
        }),
        // Escape goes through the keybinding registry rather than a window listener, because once an
        // overlay is up the focus is normally inside the iframe. Those keydowns never reach the shell's
        // window; they cross the bridge and resolve against this registry (PluginFrame's `keydown`
        // service). `typing-exempt` is the one scope both paths agree on.
        own(keybindingRegistry, {
          id: closeId,
          command: closeId,
          description: `Close ${surface.label}`,
          category: row.name,
          defaultChord: 'escape',
          when: 'typing-exempt',
          active: open,
          plugin: {
            id: pluginId,
            name: row.name,
            installedAt: () => pluginInstalledAtOnNode(frameNode(), pluginId),
            state: () => loadedPluginStateOnNode(frameNode(), pluginId),
          },
        }),
        own(uiSlotRegistry, {
          id: surface.id,
          slot: 'overlay',
          order: surface.order,
          when: () => pluginEnabledOnNode(frameNode(), pluginId),
          component: () => createComponent(PluginOverlay, {
            label: surface.label,
            hash,
            open,
            // An accessor, so the active task is read when the overlay opens: the task that was on screen
            // when the reader asked for the picker, not whichever one was selected when the slot mounted.
            binding: () => frameBindingFor(pluginId, surface, row, activeTaskId() ? { taskId: activeTaskId()! } : {}),
          }),
        }),
      ]
      return { dispose: () => [...disposables].reverse().forEach((disposable) => disposable.dispose()) }
    }
    case 'settings': {
      // Same question as the reference panel above, same answer: the host draws the page around it, so
      // the surface's one region says whether its body is a tree or the plugin's own rectangle. The
      // manifest parser refuses a settings surface that names no layout, so this is a declaration
      // either way rather than a default.
      const settingsTree = singleRegionTree(surface)
      return own(settingsRegistry, {
        id: surface.id,
        label: surface.label,
        group: surface.group ?? 'general',
        order: surface.order,
        component: () => settingsTree
          ? createComponent(RemoteTree, { contribution: settingsTree, props: () => ({}) })
          : createComponent(PluginFrame, { binding: frameBindingFor(pluginId, surface, row), hash }),
      })
    }
    case 'importer':
      return own(projectImporterRegistry, {
        id: surface.id,
        label: surface.label,
        glyph: surface.glyph,
        component: (props) => createComponent(PluginFrame, {
          binding: frameBindingFor(pluginId, surface, row),
          hash,
          get onImported() {
            return props.onImported
          },
          get onClose() {
            return props.onClose
          },
        }),
      })
  }
}

/**
/**
 * Register every accepted plugin's declared surfaces. Idempotent: called after the distribution pass and
 * again when a trust decision lands, and each call replaces what the previous one contributed. Not called
 * on a node switch, and doesn't need to be, since nothing registered here holds a node id.
 */
export function syncFrameContributions(): void {
  // Still gated on the distribution pass having run: a frame mounts bytes, and until one bundle has won
  // per plugin id there's nothing to mount. The chrome pass has no such gate.
  if (!activeBundles()) return

  for (const disposables of registered.values()) for (const disposable of disposables.reverse()) disposable.dispose()
  registered.clear()
  // This pass replaces every contribution, so it also replaces every reason one was missing.
  clearSurfaceFailures()
  // Including the exclusive-slot providers that threw. A sync is the one moment the bytes behind a
  // provider can have changed, so it's the one moment a provider that fell back to core has earned
  // another attempt (registries/exclusiveSlots.ts).
  clearExclusiveSlotFailures()

  // Driven by the roster rather than the bundle map, because not every surface needs a bundle: a document
  // surface is host-drawn and executes nothing, so the loop has to reach a plugin with no client half.
  //
  // Trust binds to bytes, and ../contributions.ts decided which bytes: the resolved winner's, never a
  // hash a roster row merely claims. An untrusted row is kept here rather than dropped the way the chrome
  // pass drops it, because acceptance withholds only the code-bearing surfaces.
  //
  // A package with no client half is `trusted: false` for the same reason, and that's load-bearing: its
  // webview surfaces would otherwise mount external web content with no prompt ever firing, because the
  // trust queue only holds bundles.
  for (const entry of eligiblePlugins()) {
    reportUnknownDeclarations(entry.pluginId, entry.row)
    const disposables = registerSurfaces(entry.pluginId, entry.hash, entry.row, entry.trusted)
    if (disposables.length) registered.set(entry.pluginId, disposables)
  }
}

// The other half of the forward-compatibility rule (docs/plugins.md § Forward compatibility): the node
// retained what it could not understand, and this is where it gets reported. One row per declaration, on
// the same path a surface that failed to register takes, because the owner's question is the same either
// way — "why is this part of the plugin not doing anything?"
//
// Not a failure of the plugin. A manifest written for a later acorn is the case this exists to make
// legible, and the row says so.
function reportUnknownDeclarations(pluginId: string, row: NodePluginRow): void {
  for (const declaration of row.installed?.unknown ?? []) {
    recordSurfaceFailure(pluginId, declaration, new Error('this version of acorn does not recognise it, so it was ignored'))
  }
}

/** Test seam, mirroring _resetPluginDistribution: the registry is module-level, so a suite that asserts
 * on one pass must not inherit the previous one's contributions. */
export function _resetFrameContributions(): void {
  for (const disposables of registered.values()) for (const disposable of disposables.reverse()) disposable.dispose()
  registered.clear()
}
