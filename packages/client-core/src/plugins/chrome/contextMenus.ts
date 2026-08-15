// A plugin-contributed context-menu row, turned into a registry contribution by the HOST.
//
// The manifest half is `contributions.contextMenus` (@acorn/protocol/pluginContract.ts). Same posture
// as ./themes.ts, and for the same reason: the node already refused a bad descriptor at parse time,
// but a roster row is bytes a node sent — possibly an older node, possibly one whose schema predates a
// location — so the location and every `when` key are checked again immediately before registration,
// and anything that fails throws rather than being coerced. The caller is inside the chrome pass's
// per-contribution try/catch, so a throw costs the plugin this one row and not its whole manifest.
//
// THREE THINGS THE HOST BINDS AND A MANIFEST CANNOT STATE:
//
//   the id     `plugin:<pluginId>:<id>`, so a package cannot collide with core's own rows or with
//              another package's. The same shape a plugin theme's id takes.
//   the gate   every row is invisible unless its plugin is running on the node being looked at. A
//              menu row that would post into a node with no such route is worse than no row.
//   the target the verb receives the target's id as its item. The descriptor names no id of its own,
//              so a plugin cannot make a menu row act on a task the owner did not right-click.
//
// There is no `tone`. A red row is a claim that an action destroys something, and it is core's claim
// to make about core's resources — a plugin declaring it would be styling the shell's own warning
// vocabulary from a manifest.
import { isContextMenuLocation, unknownWhenFacts } from '@acorn/protocol/contextMenus.ts'
import type { PluginContextMenuDescriptor } from '@acorn/protocol/pluginContract.ts'
import { compileWhen, contextMenuRegistry, type ContextMenuContribution } from '../../registries/contextMenus'
import type { Disposable } from '../../registries/registry'
import { runChromeAction } from './actions'

/** `plugin:<pluginId>:<id>` — no core contribution id contains a colon, so a plugin row can never
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
 * Exported separately from the registration below because the interesting half — what is refused, and
 * what the host binds over what the manifest said — is otherwise only observable as a row that did or
 * did not appear in a menu nobody can render in a Node test.
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
    // same check a command's gets. What is added here is the item, and it is minted from the target the
    // host handed the menu — never from anything the descriptor said.
    run: (target) => runChromeAction(descriptor.action, {
      pluginId,
      nodeId: binding.nodeId(),
      item: { id: target.id, title: target.title },
    }),
  }
}

/** Validate, bind and register one row. The returned disposable is the chrome pass's — it
 *  disposes-then-registers on every sync, and a row left behind would outlive its plugin. */
export function registerPluginContextMenu(
  pluginId: string,
  descriptor: PluginContextMenuDescriptor,
  binding: PluginContextMenuBinding,
): Disposable {
  return contextMenuRegistry.register(pluginContextMenuItem(pluginId, descriptor, binding))
}
