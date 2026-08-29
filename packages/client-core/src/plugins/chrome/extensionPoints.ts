// Turns `contributions.extensionPoints` and `contributions.extensions` (@acorn/protocol/pluginContract.ts)
// into registry entries. The node already refused a bad descriptor at parse time, but a roster row is
// bytes a node sent, so the kind, the location, the point reference and the route are checked again
// immediately before registration; a failure throws and costs the plugin this one entry, not its whole
// manifest (every caller runs inside the chrome pass's per-contribution try/catch).
//
// Five kinds through one door, because the four rules are the same for all of them: the owner consents
// in its manifest, the host mints every name, both sides appear in the trust prompt, and code does not
// cross. See docs/plugins.md § Cooperative extension points for what the host binds over what a
// manifest can state, and for why no component, callback, or DOM crosses the seam.
import {
  isExtensionPointKind,
  isExtensionPointLocation,
  parseExtensionPointRef,
  qualifiedExtensionPointId,
  type ArbitrationMode,
  type ExtensionPointKind,
} from '@acorn/protocol/extensionPoints.ts'
import type { PluginExtensionDescriptor, PluginExtensionPointDescriptor } from '@acorn/protocol/pluginContract.ts'
import {
  extensionPointRegistry,
  extensionRegistry,
  type ExtensionContribution,
  type ExtensionPointContribution,
} from '../../registries/extensionPoints'
import type { Disposable } from '../../registries/registry'
import { runChromeAction } from './actions'
import { ownsRoute, readAnnotationMarks, readExtensionItems } from './data'

/** `plugin:<pluginId>:<id>`. No core contribution id contains a colon, so a plugin's contribution can
 *  never take its place. Same shape a context-menu row's id takes (docs/plugins.md § Context menus). */
export const pluginExtensionId = (pluginId: string, id: string): string => `plugin:${pluginId}:${id}`

export type PluginExtensionBinding = {
  /** The node the surface drawing this is looking at. */
  nodeId: () => string
  /** Is the declaring plugin installed and running there? */
  enabled: () => boolean
  /** The bundle this device accepted, for a `remote` contribution. Absent for a plugin with no client
   *  bundle, which is refused below rather than mounted from nothing. */
  hash?: string
}

/**
 * One validated point. Throws with a reason if the descriptor is unusable on this device.
 *
 * Exported separately from the registration below: the minted id and what the host binds over the
 * manifest are otherwise only observable as a strip that did or did not appear in a pane, and no test
 * can render one.
 */
export function pluginExtensionPoint(
  pluginId: string,
  descriptor: PluginExtensionPointDescriptor,
  binding: PluginExtensionBinding,
): ExtensionPointContribution {
  // A kind this shell does not have. Refused rather than skipped silently, so the pass's warning names
  // the plugin: a newer node describing a kind this client cannot draw is the expected version-skew
  // case, and the author needs to be able to see it. Same rule for the location below.
  const { kind } = descriptor
  if (!isExtensionPointKind(kind)) {
    throw new Error(`extension point '${descriptor.id}' names an unknown kind '${kind}'`)
  }
  const located = kind === 'rows' || kind === 'rectangle'
  if (located && !isExtensionPointLocation(descriptor.location)) {
    throw new Error(`extension point '${descriptor.id}' names an unknown location '${descriptor.location}'`)
  }
  // An annotation with no key would draw nothing forever: the host mints its lookup strings from these
  // fields, and no fields means no lookup and no match.
  if (kind === 'annotation' && !descriptor.key) {
    throw new Error(`annotation point '${descriptor.id}' does not say what its items are keyed by`)
  }
  return {
    id: qualifiedExtensionPointId(pluginId, descriptor.id),
    ownerId: pluginId,
    label: descriptor.label,
    kind,
    ...(located && isExtensionPointLocation(descriptor.location)
      ? { location: descriptor.location, surface: descriptor.surface }
      : {}),
    // Frozen in the owner's declared order: the lookup string is minted from these fields in this
    // sequence, so a set rather than a list would make two devices disagree about what a key is.
    ...(descriptor.key ? { key: Object.keys(descriptor.key) } : {}),
    ...(descriptor.mode === 'stack' || descriptor.mode === 'replace' ? { mode: descriptor.mode as ArbitrationMode } : {}),
    // An older node's roster row carries no ceiling; four is the schema's own default.
    max: descriptor.max ?? 4,
    when: () => binding.enabled(),
  }
}

/** One validated contribution. Throws with a reason if the descriptor is unusable on this device. */
export function pluginExtension(
  pluginId: string,
  descriptor: PluginExtensionDescriptor,
  binding: PluginExtensionBinding,
): ExtensionContribution {
  // Checked for shape only, not resolved against the registry: the two manifests register in an order
  // nobody controls (docs/plugins.md § Cooperative extension points).
  if (!parseExtensionPointRef(descriptor.point)) {
    throw new Error(`extension '${descriptor.id}' names '${descriptor.point}', which is not a '<pluginId>:<pointId>' reference`)
  }
  const base = {
    id: pluginExtensionId(pluginId, descriptor.id),
    pluginId,
    point: descriptor.point,
    label: descriptor.label,
    order: descriptor.order,
    when: () => binding.enabled(),
    ...(descriptor.matches ? { matches: descriptor.matches } : {}),
  }
  if (descriptor.items !== undefined) {
    // Confines the contribution to the contributor's own namespace (docs/plugins.md § Cooperative
    // extension points; chrome/data.ts for why a roster row is re-checked here at all).
    if (!ownsRoute(pluginId, descriptor.items)) {
      throw new Error(`extension '${descriptor.id}' reads '${descriptor.items}', which is not ${pluginId}'s`)
    }
    const items = descriptor.items
    return {
      ...base,
      carrier: 'items',
      // Both readers, because the same route shape serves rows and annotations and only the owner's
      // point says which is asked for. Binding both here means the delivery site picks without a
      // second pass over the manifest.
      fetch: (signal) => readExtensionItems(pluginId, items, binding.nodeId(), signal),
      marks: (keys, signal) => readAnnotationMarks(pluginId, items, binding.nodeId(), keys, signal),
      ...(descriptor.onSelect
        ? {
          // Verb already checked against this manifest's surfaces by the chrome pass. The item passed
          // here is minted from the row the host drew, not from the point owner or another plugin.
          run: (item: { id: string; title: string }) => runChromeAction(descriptor.onSelect!, {
            pluginId,
            nodeId: binding.nodeId(),
            item: { id: item.id, title: item.title },
          }),
        }
        : {}),
    }
  }
  if (descriptor.remote !== undefined) {
    // A remote entry runs the plugin's own bytes in a worker, so it is gated exactly as a frame is: no
    // accepted bundle on this device, nothing to mount.
    if (!binding.hash) throw new Error(`extension '${descriptor.id}' draws a tree, but no bundle is trusted on this device`)
    return { ...base, carrier: 'remote', entry: descriptor.remote, hash: binding.hash }
  }
  if (descriptor.frame !== undefined) {
    return { ...base, carrier: 'frame', frame: descriptor.frame }
  }
  if (descriptor.route !== undefined) {
    // A hook handler. Registered here only so the developer view can list it beside the drawing kinds;
    // the chain that calls it runs on the node and never reads this registry.
    if (!ownsRoute(pluginId, descriptor.route)) {
      throw new Error(`extension '${descriptor.id}' answers on '${descriptor.route}', which is not ${pluginId}'s`)
    }
    return { ...base, carrier: 'route' }
  }
  throw new Error(`extension '${descriptor.id}' names no items, remote, frame or route`)
}

/** Validate, bind and register one point. The returned disposable belongs to the chrome pass, which
 *  disposes then re-registers on every sync; a point left behind would outlive its plugin. */
export const registerPluginExtensionPoint = (
  pluginId: string,
  descriptor: PluginExtensionPointDescriptor,
  binding: PluginExtensionBinding,
): Disposable => extensionPointRegistry.register(pluginExtensionPoint(pluginId, descriptor, binding))

/** Validate, bind and register one contribution. */
export const registerPluginExtension = (
  pluginId: string,
  descriptor: PluginExtensionDescriptor,
  binding: PluginExtensionBinding,
): Disposable => extensionRegistry.register(pluginExtension(pluginId, descriptor, binding))

/** Every kind this shell can draw, for the developer view's own header. Derived rather than typed out,
 *  so a kind added to the protocol shows up here without a second edit. */
export type { ExtensionPointKind }
