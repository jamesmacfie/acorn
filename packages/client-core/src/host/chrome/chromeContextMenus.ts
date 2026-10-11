// Turns `contributions.contextMenus` (@acorn/protocol/plugin/contract.ts) into a registry contribution.
// Same posture as ./themes.ts and for the same reason: the node already refused a bad descriptor at
// parse time, but a roster row is bytes a node sent, so the location and every `when` key are checked
// again immediately before registration; a failure throws and costs the plugin this one row, not its
// whole manifest (the caller runs inside the chrome pass's per-contribution try/catch).
//
// See docs/plugins/menus-and-markers.md § Context menus for what the host binds over what a manifest can state: the id
// (`plugin:<pluginId>:<id>`), the per-node running gate, the target id the verb receives, and why there
// is no `tone`.
import { isContextMenuLocation, isRailMenuLocation, unknownWhenFacts } from '@acorn/protocol/contextMenus.ts'
import type { PluginContextMenuDescriptor } from '@acorn/protocol/plugin/contract.ts'
import {
  compileWhen,
  contextMenuRegistry,
  type AgentMessageTarget,
  type AgentTurnTarget,
  type ContentSelectionTarget,
  type ContextMenuContribution,
  type FileMenuTarget,
} from '../registries/panes/contextMenus'
import type { Disposable } from '../../kit/lib/state/registry'
import { runChromeAction, type ChromeActionContext } from './actions'
import { sourceRegistry } from '../registries/sources/sources'
import { paneRegistry } from '../registries/panes/panes'
import { taskById } from '../../features/tasks/taskLookup'

/** `plugin:<pluginId>:<id>`. No core contribution id contains a colon, so a plugin row can never
 *  take the place of one. */
export const pluginContextMenuId = (pluginId: string, id: string): string => `plugin:${pluginId}:${id}`

export type PluginContextMenuBinding = {
  /** The node the surface drawing this menu is looking at. */
  nodeId: () => string
  /** Is the owning plugin installed and running there? */
  enabled: () => boolean
  sources?: ReadonlySet<string>
  panes?: ReadonlySet<string>
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
    throw new Error(
      `context menu '${descriptor.id}' matches on facts '${location}' does not have: ${unknown.join(', ')}`,
    )
  }
  if (isRailMenuLocation(location)) {
    const declared = location === 'rail.source' ? binding.sources : binding.panes
    if (!descriptor.surface || !declared?.has(descriptor.surface)) {
      throw new Error(`context menu '${descriptor.id}' names an undeclared ${location} surface`)
    }
  } else if (descriptor.surface !== undefined) {
    throw new Error(`context menu '${descriptor.id}' gives a surface to ${location}`)
  }
  const matches = compileWhen(descriptor.when)
  const item: ContextMenuContribution = {
    id: pluginContextMenuId(pluginId, descriptor.id),
    location,
    ...(descriptor.surface ? { surface: descriptor.surface } : {}),
    label: descriptor.label,
    ...(descriptor.icon ? { icon: descriptor.icon } : {}),
    order: descriptor.order,
    when: (target) =>
      binding.enabled() &&
      (!isRailMenuLocation(location) ||
        ((target.location === 'rail.source' || target.location === 'rail.pane') &&
          target.id === descriptor.surface &&
          target.location === location &&
          (location === 'rail.source' ? sourceRegistry.ownerOf(target.id) : paneRegistry.ownerOf(target.id)) ===
            pluginId)) &&
      matches(target),
    // The action was already checked against this manifest's declared surfaces by the chrome pass, the
    // same check a command's gets. What is added here is the item, minted from the target the host
    // handed the menu, never from anything the descriptor said.
    run: (target) => {
      if (contextMenuRegistry.get(item.id) !== item || !binding.enabled()) return
      if (isRailMenuLocation(location)) {
        if (target.location !== location || target.id !== descriptor.surface || target.nodeId !== binding.nodeId())
          return
        const owner = location === 'rail.source' ? sourceRegistry.ownerOf(target.id) : paneRegistry.ownerOf(target.id)
        if (owner !== pluginId) return
      }
      if (
        target.location === 'file.row' ||
        target.location === 'document.tab' ||
        target.location === 'agent.message' ||
        target.location === 'agent.turn' ||
        target.location === 'content.selection'
      ) {
        // The owner checked that the file, message, turn or selected text is still the one the menu
        // opened on. What is checked here is the binding: the menu's Node is still the one being looked
        // at, and its task is still on it in the same project. A path or a session id alone never
        // reaches another task. A selection in a project's own document has no task to check. A task
        // the client doesn't know is refused, even when the target carries no project to compare.
        if (target.location !== location || target.nodeId !== binding.nodeId()) return
        if (target.taskId !== undefined) {
          const task = taskById(target.taskId)
          if (!task || task.projectId !== target.projectId) return
        }
        void runChromeAction(descriptor.action, {
          pluginId,
          nodeId: binding.nodeId(),
          ...(target.taskId === undefined ? {} : { taskId: target.taskId }),
          ...ownerTargetBody(target),
        })
        return
      }
      void runChromeAction(descriptor.action, {
        pluginId,
        nodeId: binding.nodeId(),
        ...(isRailMenuLocation(location)
          ? {
              rail:
                target.location === 'rail.source'
                  ? { location: 'rail.source' as const, sourceId: target.id, projectId: target.projectId }
                  : target.location === 'rail.pane'
                    ? {
                        location: 'rail.pane' as const,
                        paneId: target.id,
                        taskId: target.taskId,
                        projectId: target.projectId,
                      }
                    : undefined,
              ...(target.location === 'rail.pane' ? { taskId: target.taskId } : {}),
            }
          : { item: { id: target.id, title: target.title } }),
      })
    },
  }
  return item
}

// What a `runNodeAction` row on an owner's target sends. Every key is named here, so the location's
// owner never chooses what leaves the client: no file bytes, and of a message only the text it shows.
// A selection's keys are named by its type, which holds only what the person selected and where from.
const ownerTargetBody = (
  target: FileMenuTarget | AgentMessageTarget | AgentTurnTarget | ContentSelectionTarget,
): Pick<ChromeActionContext, 'resource' | 'message' | 'turn' | 'selection'> => {
  if (target.location === 'content.selection') {
    const { location: _location, nodeId: _nodeId, ...selection } = target
    return { selection }
  }
  const { taskId, projectId } = target
  if (target.location === 'agent.message') {
    const { sessionId, itemId, turnId, role, status, text, revision } = target
    return {
      message: {
        taskId,
        projectId,
        sessionId,
        itemId,
        turnId,
        role,
        status,
        text,
        ...(target.textTruncated ? { textTruncated: true } : {}),
        revision,
      },
    }
  }
  if (target.location === 'agent.turn') {
    const { sessionId, turnId, status, revision } = target
    return { turn: { taskId, projectId, sessionId, turnId, status, revision } }
  }
  return {
    resource: {
      kind: 'file',
      taskId,
      projectId,
      path: target.path,
      directory: target.directory,
      readOnly: target.readOnly,
      ...(target.revision === undefined ? {} : { revision: target.revision }),
    },
  }
}

/** Validate, bind and register one row. The returned disposable belongs to the chrome pass, which
 *  disposes then re-registers on every sync; a row left behind would outlive its plugin. */
export function registerPluginContextMenu(
  pluginId: string,
  descriptor: PluginContextMenuDescriptor,
  binding: PluginContextMenuBinding,
): Disposable {
  return contextMenuRegistry.register(pluginContextMenuItem(pluginId, descriptor, binding), pluginId)
}
