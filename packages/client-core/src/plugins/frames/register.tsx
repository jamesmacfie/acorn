import type { NodePluginRow, PluginFrameSurface } from '@acorn/protocol/api.ts'
import { activeNodeId } from '../../node/activeNode'
import { paneRegistry } from '../../registries/panes'
import { projectImporterRegistry } from '../../registries/projectImporters'
import { refPanelRegistry } from '../../registries/refPanels'
import type { Disposable } from '../../registries/registry'
import { settingsRegistry } from '../../registries/settings'
import { activeBundles, bundleAccepted, installedByNode, pluginEnabledOnNode } from '../distribution'
import PluginFrame from './PluginFrame'
import PluginWebview from './PluginWebview'
import type { FrameBinding } from './broker'

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

// `activeNodeId()` is the frame's node, and there is no other candidate: a task belongs to whichever node
// the window is talking to (Task has no nodeId of its own), and a rail-scoped surface is looking at that
// node too. Read at frame construction, not baked in — a node switch re-runs the client plugin host and
// remounts the panes.
const frameNode = (): string => activeNodeId() ?? ''

const bindingFor = (pluginId: string, surface: PluginFrameSurface, row: NodePluginRow, extra: Partial<FrameBinding> = {}): FrameBinding => ({
  pluginId,
  surface: surface.id,
  target: surface.target,
  nodeId: frameNode(),
  api: row.installed?.permissions.api ?? [],
  events: row.installed?.permissions.events ?? [],
  ...(surface.target === 'webview' ? { hosts: surface.hosts ?? [] } : {}),
  // The plugin's own pane ids, which is the allowlist for the `openPane` verb.
  panes: (row.installed?.contributions.frames ?? []).filter((entry) => entry.target === 'pane' || entry.target === 'webview').map((entry) => entry.id),
  ...extra,
})

// Registered per plugin, and torn down as a unit: a re-run replaces a plugin's whole contribution set
// rather than reconciling it, the way the client plugin host does (registries/plugin.ts).
function registerSurfaces(pluginId: string, hash: string, row: NodePluginRow): Disposable[] {
  const disposables: Disposable[] = []
  for (const surface of row.installed?.contributions.frames ?? []) {
    // A surface a future mobile shell would have to render unusably in a phone viewport. Costless to
    // honour now, and the reason the field exists (docs/future/remote.md).
    if (!surface.formFactor.includes('desktop')) continue
    try {
      disposables.push(registerSurface(pluginId, hash, row, surface))
    } catch (error) {
      // A duplicate id is the expected failure — contribution ids are un-namespaced by design, so a
      // third-party plugin can collide with a first-party pane. One bad surface is skipped; the rest of
      // the plugin still works, and the shell does not lose a pane it already had.
      console.warn(`[plugins] ${pluginId} could not contribute ${surface.target} '${surface.id}':`, error)
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
        component: (props) => (
          <PluginFrame
            binding={bindingFor(pluginId, surface, row)}
            hash={hash}
            refId={props.ref.displayId}
            onClose={props.onClose}
          />
        ),
      })
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
 * again on a node switch, and each call replaces what the previous one contributed.
 */
export function syncFrameContributions(): void {
  const bundles = activeBundles()
  if (!bundles) return

  for (const disposables of registered.values()) for (const disposable of disposables.reverse()) disposable.dispose()
  registered.clear()

  for (const [pluginId, bundle] of bundles) {
    // Trust binds to bytes: a hash this device has not accepted contributes nothing, whether it was
    // rejected or simply never asked about yet.
    if (!bundleAccepted(pluginId, bundle.hash)) continue
    const row = rowFor(pluginId)
    if (!row?.installed) continue
    registered.set(pluginId, registerSurfaces(pluginId, bundle.hash, row))
  }
}

// Any node's row for this plugin. The manifest is the same wherever it came from — one bundle won
// resolution, and its contributions travel with it — so the first node offering this exact bundle is as
// good as any.
const rowFor = (pluginId: string): NodePluginRow | undefined => {
  for (const rows of installedByNode().values()) {
    const row = rows.find((candidate) => candidate.name === pluginId)
    if (row?.installed) return row
  }
  return undefined
}

/** Test seam, mirroring _resetPluginDistribution: the registry is module-level, so a suite that asserts
 * on one pass must not inherit the previous one's contributions. */
export function _resetFrameContributions(): void {
  for (const disposables of registered.values()) for (const disposable of disposables.reverse()) disposable.dispose()
  registered.clear()
}
