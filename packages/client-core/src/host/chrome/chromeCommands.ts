import type {
  PluginCommandAction,
  PluginCommandDescriptor,
  PluginRailItem,
} from '@acorn/protocol/api.ts'
import type { CommandScope, CommandSearchItem } from '@acorn/protocol/commands.ts'
import { qualifiedPluginCommandId } from '@acorn/protocol/keybindings.ts'
import { COMMAND_CLOSED, type CommandContribution, type CommandExecutionContext, type CommandOutcome } from '../registries/commands/commands'
import { ownsRoute, readCommandSearch, submitCommandInput, type CommandRouteScope } from './chromeData'
import { runChromeAction } from './actions'

// Turns `contributions.commands` into command-registry contributions, one per kind.
//
// Same posture as ./chromeContextMenus.ts beside it: the node refused a bad descriptor when it parsed
// the manifest, and this checks the same things again because a roster row is bytes a node sent.
//
// The line this file holds is the one docs/future/command-palette/refused.md draws: a plugin declares
// what it wants asked and what picking a row does, and the host does both. A route's answer is display
// facts and identity — it cannot name a verb, a URL, a route or another command, because the fields
// that would carry one are stripped before the answer reaches here (@acorn/protocol/commands.ts), and
// the action executed afterwards is the static one the manifest declared and a person reviewed.

/** What the host supplies that a manifest cannot state. */
export type PluginCommandBinding = {
  /** The node this window is looking at, for a command whose session captured none. */
  nodeId: () => string
  /** Is the owning plugin installed and running there? */
  enabled: () => boolean
  /** Can this device honour that verb at all? The chrome pass's own check, passed in because it needs
   *  the surfaces this manifest declared and those are only in scope there. */
  usableAction: (action: PluginCommandAction) => boolean
}

/** The manifest's own kind vocabulary, as this build knows it. A newer node may name a fifth. */
const KNOWN_KINDS = new Set(['action', 'group', 'search', 'input'])

const kindOf = (descriptor: PluginCommandDescriptor): string => descriptor.kind ?? 'action'

/** One search row, as the closed action's click site sees it. Display facts only, and the same shape a
 *  rail row has, because `runChromeAction` already knows what to do with one of those. */
const railItem = (item: CommandSearchItem): PluginRailItem => ({
  id: item.id,
  title: item.title,
  ...(item.subtitle ? { subtitle: item.subtitle } : {}),
  ...(item.icon ? { icon: item.icon } : {}),
  ...(item.badge ? { badge: item.badge } : {}),
})

/**
 * The identifiers a scoped route is sent.
 *
 * Host-derived, from the session's own captured context, so a manifest cannot make a project search
 * inherit an unrelated task: the descriptor chose which scope it is in, and this chooses what that
 * scope's identifier currently is.
 */
export const commandRouteScope = (scope: CommandScope, context: CommandExecutionContext): CommandRouteScope => {
  switch (scope) {
    case 'task': return context.taskId ? { taskId: context.taskId } : {}
    case 'project': return context.projectId ? { projectId: context.projectId } : {}
    case 'workspace': return context.workspaceId ? { workspaceId: context.workspaceId } : {}
    // `node` is the default and is not a query parameter: which node answers is an API-client option,
    // never a field a caller writes into a URL (infra/node/apiClient.ts).
    default: return {}
  }
}

/** Run a manifest-declared verb and turn its refusal into the palette's error. The toast has already
 *  fired inside `runChromeAction`; what this adds is the frame staying open with the reason on it. */
const closeOrThrow = async (result: Promise<{ ok: boolean; message?: string }>): Promise<CommandOutcome> => {
  const outcome = await result
  if (!outcome.ok) throw new Error(outcome.message ?? 'the action failed')
  return COMMAND_CLOSED
}

/**
 * The descriptors this device can honour, with their local parent graph already settled.
 *
 * Two passes, and the order matters: a command whose verb this device cannot honour is dropped first,
 * and only then is a parent looked for — otherwise a child of a dropped group would be registered as a
 * top-level row, which is the stray row `graph.ts` refuses for the same reason.
 */
export function usablePluginCommands(
  pluginId: string,
  descriptors: readonly PluginCommandDescriptor[],
  binding: PluginCommandBinding,
): PluginCommandDescriptor[] {
  const honoured = descriptors.filter((descriptor) => {
    switch (descriptor.kind ?? 'action') {
      case 'action': return binding.usableAction((descriptor as { action: PluginCommandAction }).action)
      case 'group': return true
      case 'search': {
        const search = descriptor as { route: string; onSelect: PluginCommandAction }
        return ownsRoute(pluginId, search.route) && binding.usableAction(search.onSelect)
      }
      case 'input': {
        const input = descriptor as { route: string; onSuccess: PluginCommandAction }
        return ownsRoute(pluginId, input.route) && binding.usableAction(input.onSuccess)
      }
      // A kind this build has no frame for. Skipped rather than treated as an action: a newer node's
      // `setting` command must not become a row that runs something.
      default: return false
    }
  }).filter((descriptor) => KNOWN_KINDS.has(kindOf(descriptor)))

  const kinds = new Map(honoured.map((descriptor) => [descriptor.id, kindOf(descriptor)]))
  const parents = new Map(honoured.map((descriptor) => [descriptor.id, descriptor.parentId]))
  const orphaned = (descriptor: PluginCommandDescriptor): boolean => {
    const seen = new Set<string>([descriptor.id])
    for (let above = descriptor.parentId; above !== undefined; above = parents.get(above)) {
      // Missing, not a group, or back where it started. Each is one command dropped and one line in
      // the console, never a palette that will not draw.
      if (kinds.get(above) !== 'group' || seen.has(above)) return true
      seen.add(above)
    }
    return false
  }
  return honoured.filter((descriptor) => {
    if (!orphaned(descriptor)) return true
    console.warn(`[plugin-chrome] ${pluginId} command '${descriptor.id}' names a parent this device will not honour.`)
    return false
  })
}

/**
 * One descriptor, as the command the registry holds.
 *
 * The id, the parent id and the owner are the host's: `plugin.<pluginId>.<localId>` and the plugin id
 * itself, so a manifest can neither claim another plugin's id nor hang its rows inside another
 * plugin's group (docs/future/command-palette/refused.md § Cross-owner command parenting).
 */
export function pluginCommand(
  pluginId: string,
  descriptor: PluginCommandDescriptor,
  binding: PluginCommandBinding,
): CommandContribution {
  const common = {
    id: qualifiedPluginCommandId(pluginId, descriptor.id),
    ownerId: pluginId,
    title: descriptor.title,
    category: descriptor.category,
    palette: descriptor.palette,
    ...(descriptor.hint ? { hint: descriptor.hint } : {}),
    ...(descriptor.keywords ? { keywords: descriptor.keywords } : {}),
    ...(descriptor.order !== undefined ? { order: descriptor.order } : {}),
    ...(descriptor.parentId ? { parentId: qualifiedPluginCommandId(pluginId, descriptor.parentId) } : {}),
    when: () => binding.enabled(),
  }
  switch (descriptor.kind ?? 'action') {
    case 'group':
      return { ...common, kind: 'group' }
    case 'search': {
      const search = descriptor as Extract<PluginCommandDescriptor, { kind: 'search' }>
      return {
        ...common,
        kind: 'search',
        scope: search.scope,
        ...(search.placeholder ? { placeholder: search.placeholder } : {}),
        ...(search.minQueryLength !== undefined ? { minQueryLength: search.minQueryLength } : {}),
        ...(search.debounceMs !== undefined ? { debounceMs: search.debounceMs } : {}),
        query: (text, context, signal) => readCommandSearch(
          pluginId,
          search.route,
          context.nodeId ?? binding.nodeId(),
          text,
          commandRouteScope(search.scope, context),
          signal,
        ),
        select: (item, context) => closeOrThrow(runChromeAction(search.onSelect, {
          pluginId,
          nodeId: context.nodeId ?? binding.nodeId(),
          commandId: descriptor.id,
          item: railItem(item),
          // The task the row named, if it named one, so `openTask` and `openPane` have something to
          // aim at. It went through the same sanitiser as the rest of the row.
          ...(item.taskId ? { taskId: item.taskId } : {}),
        })),
      }
    }
    case 'input': {
      const input = descriptor as Extract<PluginCommandDescriptor, { kind: 'input' }>
      return {
        ...common,
        kind: 'input',
        scope: input.scope,
        ...(input.placeholder ? { placeholder: input.placeholder } : {}),
        submit: async (text, context, signal) => {
          const nodeId = context.nodeId ?? binding.nodeId()
          // The route first, the action second. The success verb runs only because the submission
          // worked; a failure throws out of here with the node's own message and the reader's text is
          // still in the field.
          const result = await submitCommandInput(
            pluginId,
            input.route,
            nodeId,
            text,
            commandRouteScope(input.scope, context),
            signal,
          )
          await closeOrThrow(runChromeAction(input.onSuccess, {
            pluginId,
            nodeId,
            commandId: descriptor.id,
            ...(result.item ? { item: railItem(result.item) } : {}),
            ...(result.item?.taskId ? { taskId: result.item.taskId } : {}),
          }))
          // A route that said something keeps the frame open to say it. Silence closes, which is what
          // an action means.
          return result.message ? { effect: 'stay', status: result.message } : COMMAND_CLOSED
        },
      }
    }
    default: {
      const action = descriptor as Extract<PluginCommandDescriptor, { action: PluginCommandAction }>
      return {
        ...common,
        run: () => closeOrThrow(runChromeAction(action.action, {
          pluginId,
          nodeId: binding.nodeId(),
          commandId: descriptor.id,
        })),
      }
    }
  }
}
