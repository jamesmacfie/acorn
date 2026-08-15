// A plugin-declared extension point, and a plugin-declared contribution to somebody else's, turned into
// registry entries by the HOST.
//
// The manifest halves are `contributions.extensionPoints` and `contributions.extensions`
// (@acorn/protocol/pluginContract.ts). Same posture as ./themes.ts and ./contextMenus.ts, and for the
// same reason: the node already refused a bad descriptor at parse time, but a roster row is bytes a node
// sent — possibly an older node, possibly one whose schema predates a location — so the location, the
// point reference and the route are checked again immediately before registration, and anything that
// fails throws rather than being coerced. Every caller is inside the chrome pass's per-contribution
// try/catch, so a throw costs the plugin this one entry and not its whole manifest.
//
// WHAT THE HOST BINDS AND A MANIFEST CANNOT STATE — this is the whole security content of the seam:
//
//   the point id   `<ownerPluginId>:<pointId>`, minted from the plugin the manifest was read from. A
//                  package cannot open a point in another package's name, which is what would let B
//                  advertise a point and harvest C's rows.
//   the provenance every delivered group carries the CONTRIBUTING plugin's id, stamped from the same
//                  place. It is rendered beside the rows, so an owner looking at somebody else's items
//                  inside a pane can always see whose they are — the rule content links already follow
//                  with `providerId`, which is never read from the body.
//   the fetch      the rows come from the contributor's OWN namespace, re-confined here. A contribution
//                  cannot make the host read the point owner's routes on its behalf: that is exactly the
//                  "reading another plugin's routes" this design refuses, and it is refused by
//                  construction rather than by a rule somebody has to remember.
//   the gate       nothing is delivered unless BOTH plugins are running on the node being looked at.
//
// AND WHAT DOES NOT CROSS: no component, no callback, no DOM. B declares data and a verb; the host draws
// the pixels with its own components. A ships no code to be extendable beyond the one manifest line.
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

/** `plugin:<pluginId>:<id>` — no core contribution id contains a colon, so a plugin's contribution can
 *  never take the place of one. The same shape a plugin context-menu row's id takes. */
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
 * Exported separately from the registration below because the interesting half — the minted id and what
 * the host binds over what the manifest said — is otherwise only observable as a strip that did or did
 * not appear in a pane nobody can render in a Node test.
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
  // is the design rather than an oversight: a point registers from a DIFFERENT manifest in a pass whose
  // order nobody controls, so refusing an unresolved point at registration would make delivery depend on
  // which plugin the roster listed first.
  if (!parseExtensionPointRef(descriptor.point)) {
    throw new Error(`extension '${descriptor.id}' names '${descriptor.point}', which is not a '<pluginId>:<pointId>' reference`)
  }
  // The contributor's own namespace, re-checked for the reason chrome/data.ts states at length: the
  // manifest arrived as a roster row, and this one is the check that keeps a contribution from making the
  // host read the POINT OWNER's routes on its behalf.
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
        // The action was already checked against this manifest's declared surfaces by the chrome pass,
        // the same check a command's gets. What is added here is the item, and it is minted from the row
        // the host drew — never from anything the point owner or another plugin said.
        run: (item) => runChromeAction(descriptor.onSelect!, {
          pluginId,
          nodeId: binding.nodeId(),
          item: { id: item.id, title: item.title },
        }),
      }
      : {}),
  }
}

/** Validate, bind and register one point. The returned disposable is the chrome pass's — it
 *  disposes-then-registers on every sync, and a point left behind would outlive its plugin. */
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
