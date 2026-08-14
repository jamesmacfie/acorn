import { lazy, Show } from 'solid-js'
import { Portal } from 'solid-js/web'
import type { NodePluginRow, PluginFrameSurface } from '@acorn/protocol/api.ts'
import { isPluginKeyClaim } from '@acorn/protocol/keybindings.ts'
import { activeNodeId } from '../../node/activeNode'
import { commandRegistry } from '../../registries/commands'
import { pluginProjectRoutePrefix } from '../../registries/corePaths'
import { keybindingRegistry } from '../../registries/keybindings'
import { paneRegistry } from '../../registries/panes'
import { projectImporterRegistry } from '../../registries/projectImporters'
import { projectSurfaceRegistry } from '../../registries/projectSurfaces'
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
import PluginFrame from './PluginFrame'
import PluginWebview from './PluginWebview'
import type { FrameBinding } from './broker'
import { documentRegionFor, isHostOwnedSurface } from './documentSurfaces'
import { closePluginOverlay, pluginOverlayOpen } from './overlays'
import { Button, Toolbar } from '../../ui/primitives'

// Turning accepted manifests into shell contributions (docs/plugins.md
// § Frame contribution kind).
//
// A DELIBERATE DEVIATION from the phase doc, which sketches a `kind: 'component' | 'frame'` union on
// each of the four contribution types. The union would put a branch in every consumer — TaskPaneHost,
// SettingsModal, WorkspaceProjectAssignments, the ref-panel site in github's PullDetail — to express one
// thing: which component renders. So instead this file registers ordinary contributions whose component
// IS a PluginFrame, pre-bound to the plugin, surface and bundle. The registries and their consumers are
// untouched, component and frame contributions coexist because to the shell there is only one kind, and
// pane ids keep working as the persisted layout keys they are.
//
// The importer is the one surface where the doc's reasoning still bites: a frame cannot be handed
// callbacks. It does not need to be — the host passes `onClose`/`onImported` into PluginFrame, which
// turns them into the two bridge verbs. The shell still owns the modal chrome and the post-import
// refresh; the frame only says when it is done.
//
// Two gates decide whether a surface is registered at all:
//
//   accepted   this device said yes to these exact bytes. A cached-but-undecided or rejected bundle
//              never reaches a registry, so "never auto-run code a Node pushed" holds at the
//              registration boundary rather than at the iframe.
//   bound      every id, provider and surface comes from the manifest as the HOST read it. Plugin code
//              cannot register a shell contribution at all — only a manifest can.

const registered = new Map<string, Disposable[]>()

// Lazy, like every Monaco-bearing pane in this repo, and here it is required rather than tidy: this
// file is evaluated on every shell boot, and a static import would put Monaco's tree in the boot
// graph for a pane most sessions never open — including in the client-graph test suites, where
// `monaco-editor` reads `window.location` at module scope and there is no real window.
const DocumentSurface = lazy(() => import('../../editor/DocumentSurface'))
// The composed template. Its own lazy boundary rather than a branch inside the one above, so a shell
// that only ever opens a whole-pane document never pulls the frame half in either.
const DocumentOverFrame = lazy(() => import('./DocumentOverFrame'))

// `activeNodeId()` is the frame's node, and there is no other candidate: a task belongs to whichever node
// the window is talking to (Task has no nodeId of its own), and a rail-scoped surface is looking at that
// node too. The frame never names one — docs/plugins.md: "The host pins which Node the frame talks to."
//
// READ PER FRAME, not per registration, which is what makes a plain string safe here rather than an
// accessor. `bindingFor` is called inside each contribution's `component`, so the id is resolved when a
// frame MOUNTS; the pin cannot then go stale under it, because a node switch moves `activeCacheId()` and
// the composition root keys the whole shell on that value — every mounted frame is disposed and rebuilt
// (node/fleet.test.ts pins the switch half of that). Registration cannot lose the race to selection
// either: `selectActiveNode()` is awaited before anything that leads here. This has been misread as a
// snapshot taken at registration time; it is not, and the `when` gates below are getters because what a
// REGISTRATION reads has to stay reactive across the same switch.
//
// `''` when there is no node at all is deliberate rather than a hole: that is the browser-served
// `dev:node` mode, where the origin IS the node and apiClient's same-origin fallback is the right target.
const frameNode = (): string => activeNodeId() ?? ''

const bindingFor = (pluginId: string, surface: PluginFrameSurface, row: NodePluginRow, extra: Partial<FrameBinding> = {}): FrameBinding => ({
  pluginId,
  surface: surface.id,
  target: surface.target,
  nodeId: frameNode(),
  api: row.installed?.permissions.api ?? [],
  events: row.installed?.permissions.events ?? [],
  ...(surface.target === 'webview' ? { hosts: surface.hosts ?? [] } : {}),
  // The plugin's own TASK-scoped pane ids, which is the allowlist for the `openPane` verb. Project-scoped
  // surfaces are excluded because the verb opens into a task's layout and there is nothing there for one
  // of them to become — `services.openPane` below already refuses when the frame has no task.
  panes: (row.installed?.contributions.frames ?? []).filter(isTaskPane).map((entry) => entry.id),
  // Roster rows are wire input. The node parsed these already, but the device re-applies the closed
  // claim policy before handing the declaration to a frame.
  claimsKeys: (surface.claimsKeys ?? []).filter(isPluginKeyClaim),
  ...extra,
})

// Registered per plugin, and torn down as a unit: a re-run replaces a plugin's whole contribution set
// rather than reconciling it, the way the client plugin host does (registries/plugin.ts).
function registerSurfaces(pluginId: string, hash: string, row: NodePluginRow, trusted: boolean): Disposable[] {
  const disposables: Disposable[] = []
  for (const surface of row.installed?.contributions.frames ?? []) {
    // A surface a future mobile shell would have to render unusably in a phone viewport. Costless to
    // honour now, and the reason the field exists (docs/future/remote.md).
    if (!surface.formFactor.includes('desktop')) continue
    // A host-owned document surface runs no plugin code on this device — the host draws the editor
    // and the plugin's contribution is two routes on a node. So it is gated like a DESCRIPTOR rather
    // than like a frame (chrome/register.ts draws the same line): no bytes execute, so there is
    // nothing for a bytes-hash prompt to be about, and a plugin that ships only document surfaces
    // needs no client bundle at all.
    if (!trusted && !isHostOwnedSurface(surface)) continue
    try {
      disposables.push(registerSurface(pluginId, hash, row, surface))
    } catch (error) {
      // A duplicate id is the expected failure — contribution ids are un-namespaced by design, so a
      // third-party plugin can collide with a first-party pane. One bad surface is skipped; the rest of
      // the plugin still works, and the shell does not lose a pane it already had.
      //
      // Recorded as well as logged. On its own the warn was invisible — the author saw a pane that did not
      // exist and nothing to explain it — so this also reaches the attention inbox through
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
        component: (props) => {
          const binding = bindingFor(pluginId, surface, row, { taskId: props.task.id, projectId: props.task.projectId })
          return <PluginWebview pluginId={pluginId} surface={surface} binding={binding} hash={hash} />
        },
      })
    case 'pane':
      // A host-owned document surface: no iframe, no plugin code in this pane at all
      // (docs/future/monaco.md). The host draws the editor and the plugin supplies the document
      // through two of its own routes, which is why this branch comes before everything else the
      // `pane` case does — there is no bundle to mount and no bridge to open.
      //
      // The routes were confined to `/v2/p/<id>/` when the node parsed the manifest and are confined
      // AGAIN here, for the reason chrome/data.ts states: the manifest reached this device as a roster
      // row, and a node could have sent something its own parser would have rejected.
      {
        // Throws — and is therefore skipped and logged by registerSurfaces — when a roster row carried
        // a route the node's own parser would have refused.
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
              // bundle in an iframe — which is why `isHostOwnedSurface` above excluded it from the
              // trust bypass and why there is a `hash` to hand over here at all.
              return composed
                ? (
                  <DocumentOverFrame
                    pluginId={pluginId}
                    binding={bindingFor(pluginId, surface, row, { taskId: props.task.id, projectId: props.task.projectId })}
                    hash={hash}
                    region={region}
                    scope={scope}
                  />
                )
                : (
                  <DocumentSurface
                    pluginId={pluginId}
                    surfaceId={surface.id}
                    nodeId={frameNode()}
                    region={region}
                    scope={scope}
                  />
                )
            },
          })
        }
      }
      // Project scope lands in its own registry: the surface is drawn beside its plugin's rail list, with
      // no task to hand it and no layout key to persist (registries/projectSurfaces.ts says why the two
      // are not one registry). The manifest guarantees both a route and a source that navigates to it, so
      // the address and the mount site exist before this runs — but the manifest reached this device as a
      // ROSTER ROW, so the confinement is re-applied here for the same reason chrome/data.ts re-applies
      // the node one: a node could have sent something its own parser would have rejected.
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
          // own descriptor rail panel, and the source registry already gates THAT on the plugin running on
          // the node being looked at; a second copy of the same predicate here could only disagree with it.
          component: (props) => (
            <PluginFrame
              binding={bindingFor(pluginId, surface, row, { projectId: props.projectId })}
              hash={hash}
              item={props.item}
            />
          ),
        })
      }
      return paneRegistry.register({
        id: surface.id,
        label: surface.label,
        glyph: surface.glyph,
        order: surface.order,
        // The per-node gate. A plugin installed on node A contributes nothing to a task on node B, so the
        // switcher never offers a pane whose routes are not there (distribution.ts states the argument).
        when: () => pluginEnabledOnNode(frameNode(), pluginId),
        component: (props) => (
          <PluginFrame binding={bindingFor(pluginId, surface, row, { taskId: props.task.id, projectId: props.task.projectId })} hash={hash} />
        ),
      })
    case 'refPanel': {
      // A panel names the provider whose items it renders, and may only name its own — the same check the
      // client plugin host runs over first-party contributions, applied to a manifest instead of a call.
      if (surface.providerId && surface.providerId !== pluginId) {
        throw new Error(`declared provider '${surface.providerId}' is not '${pluginId}'`)
      }
      return refPanelRegistry.register({
        id: surface.id,
        providerId: pluginId,
        // The same per-node gate the task pane above carries, and for the same reason: the panel's frame
        // talks to routes on the node being looked at, so a plugin stopped there has no panel to offer.
        // It belongs on the REGISTRY rather than only in `RefPanelHost` because `openRefPanel` consults
        // it to decide whether to claim the click at all.
        when: () => pluginEnabledOnNode(frameNode(), pluginId),
        // The overlay is the HOST's here, unlike a first-party panel that draws its own. Two reasons, both
        // structural rather than stylistic. A frame is an iframe: it cannot Portal out of the box the
        // consumer put it in, so `position: fixed` inside the frame positions against the frame, and a
        // ref panel rendered inline into a PR conversation would be a 150px letterbox in the middle of a
        // page. And a refPanel frame has no way to CALL `onClose` — the bridge's close verb is gated to
        // importer surfaces (frames/broker.ts), deliberately, so the dismiss affordance has to live on
        // this side of the port too. Same classes the first-party panels use, so the two look identical.
        component: (props) => (
          <Portal>
            <div class="integrations-panel-backdrop" onClick={props.onClose} />
            <aside class="integrations-panel plugin-ref-panel">
              <header class="integrations-panel-head">
                {/* No fallback, deliberately. `openRefPanel` refuses a falsy `displayId`, so a panel with
                    no subject is unreachable and a `?? 'Reference'` here would only be able to hide a bug
                    — which is precisely what it would have done: the empty title was the visible half of
                    the reserved-`ref`-prop defect, and the reason it was found at all. */}
                <span class="integrations-panel-title">{props.target.displayId}</span>
                <Toolbar.Spacer />
                <Button variant="bare" class="integrations-panel-close" onClick={props.onClose} aria-label="Close">✕</Button>
              </header>
              <PluginFrame
                binding={bindingFor(pluginId, surface, row)}
                hash={hash}
                refId={props.target.displayId}
                onClose={props.onClose}
              />
            </aside>
          </Portal>
        ),
      })
    }
    case 'overlay': {
      // The full-screen picker slot — what the editor's ⌘P file palette occupies as a compiled
      // contribution, and the last component slot that had no manifest form. Same division of labour as
      // the reference panel above: the HOST draws the backdrop, the box and the dismiss affordance,
      // because an iframe cannot position itself against anything outside its own rectangle.
      //
      // Nothing here decides when it appears. An overlay has no click site of its own — the only thing
      // that opens one is the `openOverlay` verb (plugins/chrome/actions.ts), and the manifest refuses an
      // overlay that no action opens, so a picker without its chord is a parse error rather than a
      // surface nobody can reach.
      const open = (): boolean => pluginOverlayOpen(pluginId, surface.id)
      const closeId = `plugin.${pluginId}.overlay-close.${surface.id}`
      const disposables = [
        commandRegistry.register({
          id: closeId,
          title: `Close ${surface.label}`,
          category: 'action',
          // Kept out of the palette: it is only ever available while an overlay covers the palette.
          palette: false,
          when: open,
          run: closePluginOverlay,
        }),
        // Escape, through the keybinding registry rather than a window listener on the host component,
        // because once an overlay is up the focus is normally INSIDE the iframe — those keydowns never
        // reach the shell's window, they cross the bridge and are resolved against this registry
        // (PluginFrame's `keydown` service). `typing-exempt` is the one scope both paths agree on.
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
          component: () => (
            <Show when={open()}>
              <div class="overlay-backdrop" onClick={closePluginOverlay}>
                <div class="overlay plugin-overlay" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
                  <header class="overlay-title plugin-overlay-head">
                    <span>{surface.label}</span>
                    <button type="button" class="plugin-overlay-close" onClick={closePluginOverlay} aria-label="Close">✕</button>
                  </header>
                  <div class="plugin-overlay-body">
                    {/* The active task, because a picker's job is usually to put something into one —
                        and it is read HERE, when the overlay mounts, so it is the task that was on
                        screen when the reader asked for it. */}
                    <PluginFrame
                      binding={bindingFor(pluginId, surface, row, activeTaskId() ? { taskId: activeTaskId()! } : {})}
                      hash={hash}
                      onClose={closePluginOverlay}
                    />
                  </div>
                </div>
              </div>
            </Show>
          ),
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
        component: () => <PluginFrame binding={bindingFor(pluginId, surface, row)} hash={hash} />,
      })
    case 'importer':
      return projectImporterRegistry.register({
        id: surface.id,
        label: surface.label,
        glyph: surface.glyph,
        component: (props) => (
          <PluginFrame
            binding={bindingFor(pluginId, surface, row)}
            hash={hash}
            onImported={props.onImported}
            onClose={props.onClose}
          />
        ),
      })
  }
}

/**
 * Register every accepted plugin's declared surfaces. Idempotent: called after the distribution pass and
 * again when a trust decision lands, and each call replaces what the previous one contributed. NOT called
 * on a node switch, and it does not need to be — nothing registered here holds a node id (see `frameNode`).
 */
export function syncFrameContributions(): void {
  // Still gated on the distribution pass having run: a frame mounts BYTES, and until one bundle has
  // won per plugin id there is nothing to mount. The chrome pass has no such gate.
  if (!activeBundles()) return

  for (const disposables of registered.values()) for (const disposable of disposables.reverse()) disposable.dispose()
  registered.clear()
  // This pass replaces every contribution, so it also replaces every reason one was missing.
  clearSurfaceFailures()

  // Driven by the ROSTER rather than by the bundle map, because not every surface needs a bundle any
  // more. A document surface is host-drawn and executes nothing here, so the loop has to be able to
  // reach a plugin that has no client half at all.
  // Trust binds to bytes, and ../contributions.ts decided against which bytes — the resolved winner's,
  // never a hash a roster row merely claims. An untrusted row is KEPT here rather than dropped the way
  // the chrome pass drops it: what acceptance withholds is the code-bearing surfaces only, and a
  // document surface is host-drawn and executes nothing.
  //
  // A package with no client half is `trusted: false` for the same reason, and that is load-bearing
  // rather than pedantic: its webview surfaces would otherwise mount external web content with no
  // prompt ever firing, because the trust queue only ever holds bundles.
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
