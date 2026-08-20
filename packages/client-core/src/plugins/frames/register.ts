import { createComponent, lazy } from 'solid-js'
import type { NodePluginRow, PluginFrameSurface } from '@acorn/protocol/api.ts'
import { isPluginKeyClaim } from '@acorn/protocol/keybindings.ts'
import { isCoreExclusiveSlot, qualifiedExtensionPointId } from '@acorn/protocol/extensionPoints.ts'
import { panelRegion } from '../../dashboards/region'
import { activeNodeId } from '../../node/activeNode'
import { commandRegistry } from '../../registries/commands'
import { pluginProjectRoutePrefix } from '../../registries/corePaths'
import { keybindingRegistry } from '../../registries/keybindings'
import { paneRegistry } from '../../registries/panes'
import { projectImporterRegistry } from '../../registries/projectImporters'
import { projectSurfaceRegistry } from '../../registries/projectSurfaces'
import { clearExclusiveSlotFailures, exclusiveSlotRegistry } from '../../registries/exclusiveSlots'
import { refPanelRegistry } from '../../registries/refPanels'
import type { Disposable } from '../../registries/registry'
import { settingsRegistry } from '../../registries/settings'
import { uiSlotRegistry } from '../../registries/slots'
import { activeTaskId } from '../../tasks/tasks'
import {
  activeBundles,
  pluginEnabledOnNode,
  pluginInstalledAtOnNode,
  loadedPluginStateOnNode,
} from '../distribution'
import { eligiblePlugins, isTaskPane } from '../contributions'
import { clearSurfaceFailures, recordSurfaceFailure } from '../surfaceFailures'
import type { FrameBinding } from './broker'
import { documentRegionFor, isHostOwnedSurface } from './documentSurfaces'
import { closePluginOverlay, pluginOverlayOpen } from './overlays'

// Turning accepted manifests into shell contributions (docs/plugins.md § Frame contribution kind).
//
// This file registers ordinary contributions whose component is a PluginFrame, pre-bound to the plugin,
// surface and bundle. The phase doc sketched a `kind: 'component' | 'frame'` union on each contribution
// type instead, which would put a branch in every consumer to express one thing: which component
// renders. The registries and their consumers are untouched, and pane ids keep working as the persisted
// layout keys they are.
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
const ExtendedPane = lazy(() => import('./ExtendedPane'))
// Lazy for the reason above, plus one more: this file is evaluated on every shell boot, and a static
// import would put Monaco's tree in the boot graph for a pane most sessions never open. That includes
// the client-graph test suites, where `monaco-editor` reads `window.location` at module scope and there
// is no real window.
const DocumentSurface = lazy(() => import('../../editor/DocumentSurface'))
// The composed template. Its own lazy boundary rather than a branch inside the one above, so a shell
// that only opens whole-pane documents never pulls the frame half in.
const DocumentOverFrame = lazy(() => import('./DocumentOverFrame'))

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
      console.warn(`[plugins] ${pluginId} could not contribute ${surface.target} '${surface.id}':`, error)
      recordSurfaceFailure(pluginId, surface.id, error)
    }
  }
  return disposables
}

function registerSurface(pluginId: string, hash: string, row: NodePluginRow, surface: PluginFrameSurface): Disposable {
  switch (surface.target) {
    case 'webview':
      return paneRegistry.register({
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
      // A host-owned document surface: no iframe, no plugin code in this pane at all
      // (docs/third-party/monaco.md). There's no bundle to mount and no bridge to open, which is why
      // this branch comes before everything else the `pane` case does.
      //
      // The routes were confined to `/v2/p/<id>/` when the node parsed the manifest and are confined
      // again here: the manifest reached this device as a roster row, and a node could have sent
      // something its own parser would have rejected.
      {
        // Throws, and so is skipped and logged by registerSurfaces, when a roster row carried a route
        // the node's own parser would have refused.
        const region = documentRegionFor(pluginId, surface)
        if (region) {
          const composed = surface.layout?.template === 'document-over-frame'
          return paneRegistry.register({
            id: surface.id,
            label: surface.label,
            glyph: surface.glyph,
            order: surface.order,
            when: () => pluginEnabledOnNode(frameNode(), pluginId),
            component: (props) => {
              const scope = { taskId: props.task.id, projectId: props.task.projectId ?? undefined }
              // `document-over-frame` has a frame region, so half this rectangle is the plugin's own
              // bundle in an iframe. That's why `isHostOwnedSurface` above excluded it from the trust
              // bypass, and why there's a `hash` to hand over.
              return composed
                ? createComponent(DocumentOverFrame, {
                  pluginId,
                  binding: frameBindingFor(pluginId, surface, row, { taskId: props.task.id, projectId: props.task.projectId }),
                  hash,
                  region,
                  scope,
                })
                : createComponent(DocumentSurface, {
                  pluginId,
                  surfaceId: surface.id,
                  nodeId: frameNode(),
                  region,
                  scope,
                })
            },
          })
        }
      }
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
        return projectSurfaceRegistry.register({
          id: surface.id,
          path: route.path,
          item: route.item,
          order: route.order,
          // No `when` gate, unlike the task pane below. The only thing that renders this is the plugin's
          // own descriptor rail panel, and the source registry already gates that on the plugin running
          // on the node being looked at.
          component: (props) => createComponent(PluginFrame, {
            binding: frameBindingFor(pluginId, surface, row, { projectId: props.projectId }),
            hash,
            // A getter, because the routed item is the project surface's selection and the host updates
            // it in place rather than remounting (PluginFrame turns each change into a `select` message).
            get item() {
              return props.item
            },
          }),
        })
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
        const asidePoint = points.find((entry) => entry.location === 'pane.aside')
        // The point id doubles as the placement's owner id. It's already `<pluginId>:<pointId>`, minted
        // by the host, so a plugin can't address another package's stored composition.
        const aside = asidePoint
          ? {
            pointId: qualifiedExtensionPointId(pluginId, asidePoint.id),
            region: panelRegion(pluginId, asidePoint.panels),
          }
          : null
        return paneRegistry.register({
          id: surface.id,
          label: surface.label,
          glyph: surface.glyph,
          order: surface.order,
          // The per-node gate. A plugin installed on node A contributes nothing to a task on node B, so
          // the switcher never offers a pane whose routes aren't there (distribution.ts).
          when: () => pluginEnabledOnNode(frameNode(), pluginId),
          component: (props) => {
            const frame = createComponent(PluginFrame, {
              binding: frameBindingFor(pluginId, surface, row, { taskId: props.task.id, projectId: props.task.projectId }),
              hash,
            })
            if (!pointId && !aside) return frame
            return createComponent(ExtendedPane, {
              ...(pointId ? { footerPointId: pointId } : {}),
              ...(aside ? { aside } : {}),
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
      return exclusiveSlotRegistry.register({
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
      return refPanelRegistry.register({
        id: surface.id,
        providerId: pluginId,
        // The same per-node gate the task pane above carries: the panel's frame talks to routes on the
        // node being looked at. It's on the registry rather than only in `RefPanelHost` because
        // `openRefPanel` consults it to decide whether to claim the click at all.
        when: () => pluginEnabledOnNode(frameNode(), pluginId),
        // The host draws the box (./PluginRefPanel.tsx says why it's the host's job, not the frame's).
        component: (props) => createComponent(PluginRefPanel, {
          binding: frameBindingFor(pluginId, surface, row),
          hash,
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
        commandRegistry.register({
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
        keybindingRegistry.register({
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
        uiSlotRegistry.register({
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
    case 'settings':
      return settingsRegistry.register({
        id: surface.id,
        label: surface.label,
        group: surface.group ?? 'general',
        order: surface.order,
        component: () => createComponent(PluginFrame, { binding: frameBindingFor(pluginId, surface, row), hash }),
      })
    case 'importer':
      return projectImporterRegistry.register({
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
    const disposables = registerSurfaces(entry.pluginId, entry.hash, entry.row, entry.trusted)
    if (disposables.length) registered.set(entry.pluginId, disposables)
  }
}

/** Test seam, mirroring _resetPluginDistribution: the registry is module-level, so a suite that asserts
 * on one pass must not inherit the previous one's contributions. */
export function _resetFrameContributions(): void {
  for (const disposables of registered.values()) for (const disposable of disposables.reverse()) disposable.dispose()
  registered.clear()
}
