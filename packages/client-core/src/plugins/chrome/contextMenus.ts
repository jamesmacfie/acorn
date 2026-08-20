// Turns `contributions.contextMenus` (@acorn/protocol/pluginContract.ts) into a registry contribution.
// Same posture as ./themes.ts and for the same reason: the node already refused a bad descriptor at
// parse time, but a roster row is bytes a node sent, so the location and every `when` key are checked
// again immediately before registration; a failure throws and costs the plugin this one row, not its
// whole manifest (the caller runs inside the chrome pass's per-contribution try/catch).
//
// See docs/plugins.md § Context menus for what the host binds over what a manifest can state: the id
// (`plugin:<pluginId>:<id>`), the per-node running gate, the target id the verb receives, and why there
// is no `tone`.
import { isContextMenuLocation, unknownWhenFacts } from '@acorn/protocol/contextMenus.ts'
import type { PluginContextMenuDescriptor } from '@acorn/protocol/pluginContract.ts'
import { compileWhen, contextMenuRegistry, type ContextMenuContribution } from '../../registries/contextMenus'
import type { Disposable } from '../../registries/registry'
import { runChromeAction } from './actions'

/** `plugin:<pluginId>:<id>`. No core contribution id contains a colon, so a plugin row can never
 *  take the place of one. */
export const pluginContextMenuId = (pluginId: string, id: string): string => `plugin:${pluginId}:${id}`

export type PluginContextMenuBinding = {
  /** The node the surface drawing this menu is looking at. */
  nodeId: () => string
  /** Is the owning plugin installed and running there? */
  enabled: () => boolean
}

/**
 * One validated row. Throws with a reason if the descriptor is unusable on this device.
 *
/**
 * One validated row. Throws with a reason if the descriptor is unusable on this device.
 *
 * Exported separately from the registration below: what is refused, and what the host binds over what
 * the manifest said, is otherwise only observable as a row that did or did not appear in a menu, and no
 * test can render one.
 */
export function pluginContextMenuItem(
  pluginId: string,
  descriptor: PluginContextMenuDescriptor,
  binding: PluginContextMenuBinding,
): ContextMenuContribution {
  const { location } = descriptor
  // A location this shell does not have. Refused rather than skipped silently, so the pass's warning
  // names the plugin: a newer node describing a location this client cannot draw is the expected
  // version-skew case, and the author needs to be able to see it.
  if (!isContextMenuLocation(location)) {
    throw new Error(`context menu '${descriptor.id}' names an unknown location '${location}'`)
  }
  const unknown = unknownWhenFacts(location, descriptor.when ?? {})
  if (unknown.length) {
    throw new Error(`context menu '${descriptor.id}' matches on facts '${location}' does not have: ${unknown.join(', ')}`)
  }
  const matches = compileWhen(descriptor.when)
  return {
    id: pluginContextMenuId(pluginId, descriptor.id),
    location,
    label: descriptor.label,
    ...(descriptor.icon ? { icon: descriptor.icon } : {}),
    order: descriptor.order,
    when: (target) => binding.enabled() && matches(target),
    // The action was already checked against this manifest's declared surfaces by the chrome pass, the
    // same check a command's gets. What is added here is the item, minted from the target the host
    // handed the menu, never from anything the descriptor said.
    run: (target) => runChromeAction(descriptor.action, {
      pluginId,
      nodeId: binding.nodeId(),
      item: { id: target.id, title: target.title },
    }),
  }
}

/** Validate, bind and register one row. The returned disposable belongs to the chrome pass, which
 *  disposes then re-registers on every sync; a row left behind would outlive its plugin. */
export function registerPluginContextMenu(
  pluginId: string,
  descriptor: PluginContextMenuDescriptor,
  binding: PluginContextMenuBinding,
): Disposable {
  return contextMenuRegistry.register(pluginContextMenuItem(pluginId, descriptor, binding))
}
