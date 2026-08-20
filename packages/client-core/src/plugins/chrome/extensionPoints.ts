// Turns `contributions.extensionPoints` and `contributions.extensions` (@acorn/protocol/pluginContract.ts)
// into registry entries. The node already refused a bad descriptor at parse time, but a roster row is
// bytes a node sent, so the location, the point reference and the route are checked again immediately
// before registration; a failure throws and costs the plugin this one entry, not its whole manifest
// (every caller runs inside the chrome pass's per-contribution try/catch).
//
// See docs/plugins.md § Cooperative extension points for what the host binds over what a manifest can
// state (the point id, the provenance, the fetch confinement, the both-running gate) and for why no
// component, callback, or DOM crosses the seam.
import {
  isExtensionPointLocation,
  parseExtensionPointRef,
  qualifiedExtensionPointId,
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
import { ownsRoute, readExtensionItems } from './data'

/** `plugin:<pluginId>:<id>`. No core contribution id contains a colon, so a plugin's contribution can
 *  never take its place. Same shape a context-menu row's id takes (docs/plugins.md § Context menus). */
export const pluginExtensionId = (pluginId: string, id: string): string => `plugin:${pluginId}:${id}`

export type PluginExtensionBinding = {
  /** The node the surface drawing this is looking at. */
  nodeId: () => string
  /** Is the declaring plugin installed and running there? */
  enabled: () => boolean
}

/**
 * One validated point. Throws with a reason if the descriptor is unusable on this device.
 *
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
  const { location } = descriptor
  // A location this shell does not have. Refused rather than skipped silently, so the pass's warning
  // names the plugin: a newer node describing a location this client cannot draw is the expected
  // version-skew case, and the author needs to be able to see it.
  if (!isExtensionPointLocation(location)) {
    throw new Error(`extension point '${descriptor.id}' names an unknown location '${location}'`)
  }
  return {
    id: qualifiedExtensionPointId(pluginId, descriptor.id),
    ownerId: pluginId,
    label: descriptor.label,
    location,
    surface: descriptor.surface,
    when: () => binding.enabled(),
  }
}

/** One validated contribution. Throws with a reason if the descriptor is unusable on this device. */
export function pluginExtension(
  pluginId: string,
  descriptor: PluginExtensionDescriptor,
  binding: PluginExtensionBinding,
): ExtensionContribution {
  // The reference has to be a reference. It is not checked against the registry here, and that omission
  // Checked for shape only, not resolved against the registry: the two manifests register in an order
  // nobody controls (docs/plugins.md § Cooperative extension points).
  if (!parseExtensionPointRef(descriptor.point)) {
    throw new Error(`extension '${descriptor.id}' names '${descriptor.point}', which is not a '<pluginId>:<pointId>' reference`)
  }
  // Confines the contribution to the contributor's own namespace (docs/plugins.md § Cooperative
  // extension points; chrome/data.ts for why a roster row is re-checked here at all).
  if (!ownsRoute(pluginId, descriptor.items)) {
    throw new Error(`extension '${descriptor.id}' reads '${descriptor.items}', which is not ${pluginId}'s`)
  }
  return {
    id: pluginExtensionId(pluginId, descriptor.id),
    pluginId,
    point: descriptor.point,
    label: descriptor.label,
    order: descriptor.order,
    when: () => binding.enabled(),
    fetch: (signal) => readExtensionItems(pluginId, descriptor.items, binding.nodeId(), signal),
    ...(descriptor.onSelect
      ? {
        // Verb already checked against this manifest's surfaces by the chrome pass. The item passed here
        // is minted from the row the host drew, not from the point owner or another plugin.
        run: (item) => runChromeAction(descriptor.onSelect!, {
          pluginId,
          nodeId: binding.nodeId(),
          item: { id: item.id, title: item.title },
        }),
      }
      : {}),
  }
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
