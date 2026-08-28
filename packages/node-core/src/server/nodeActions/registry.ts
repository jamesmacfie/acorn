import type { ToolRisk } from '@acorn/protocol/api.ts'
import { dispatchPluginRoute } from '../plugin/dispatch'
import type { Env } from '../../main/bindings'

// Work a plugin will do when something asks, with no client attached and no request in sight, and the
// registry that makes it askable.
//
// A schedule is the one thing asking today (docs/schedules.md § `node-action`) and it is not the
// definition. An event, a monitor crossing a threshold, a webhook, a run finishing: each of those is a
// different caller of the same actions, and the tier on the record below is what lets them ask for
// different confirmations. Nothing here may grow a schedule-shaped assumption.
//
// The plainer primitive underneath is ../plugin/dispatch.ts, which schedules, collection reads, task
// checks and harnesses all use directly. What this layer adds is the two things an unattended fire
// needs and a dispatch does not have: a stable name a stored record can point at, and a declared risk
// tier stamped onto that record when the owner consents.

export type NodeAction = {
  pluginId: string
  /** Unique within the plugin. Together with `pluginId` it is what a stored schedule target names,
   *  which is why it must be stable across updates: renaming one makes every schedule pointing at it
   *  fail closed, which is the correct outcome but a rude one. */
  actionId: string
  /** What a picker and a settings row call it. */
  name: string
  /** POST → whatever. Confined to the plugin's own namespace on every fire, not merely at
   *  registration (../plugin/dispatch.ts). */
  path: string
  /** The tier the host's confirmation is drawn from, and what gets stamped onto whatever record armed
   *  this — a schedule row today. Absent means `execute`, see `riskOf` below. */
  risk?: ToolRisk
}

export type NodeActionRegistration = Omit<NodeAction, 'pluginId'>

/** An action that declares no tier is treated as `execute`, the strongest (docs/schedules.md
 *  § `node-action`).
 *
 *  This repairs the design's assumption rather than meeting it, so it fails in the safe direction:
 *  an undeclared tier means nobody has said what this does, and arming the strongest confirmation
 *  for that is the answer that cannot be wrong in a way that matters. It also means an action that
 *  later declares a real tier can only ever go down, so the tier-rise check below never fires
 *  spuriously on a plugin that started declaring what it always did. */
export const riskOf = (action: Pick<NodeAction, 'risk'>): ToolRisk => action.risk ?? 'execute'

const key = (pluginId: string, actionId: string): string => `${pluginId}:${actionId}`

// A module singleton, like the route and collection registries beside it, with the same lifecycle
// answer: the plugin host clears a plugin's entries before re-registering them.
const actions = new Map<string, NodeAction>()

export function registerNodeAction(action: NodeAction): void {
  const id = key(action.pluginId, action.actionId)
  const clash = actions.get(id)
  if (clash && clash.path !== action.path) {
    throw new Error(`Duplicate node action '${id}': already registered for ${clash.path}, now for ${action.path}.`)
  }
  actions.set(id, action)
}

export function clearNodeActions(pluginId: string): void {
  for (const [id, action] of actions) if (action.pluginId === pluginId) actions.delete(id)
}

export const nodeAction = (pluginId: string, actionId: string): NodeAction | undefined =>
  actions.get(key(pluginId, actionId))

/** What an arming flow may offer. It lists only what resolves now, so nothing can be armed against
 *  something this node cannot run. */
export const nodeActions = (): NodeAction[] =>
  [...actions.values()].sort((a, b) => a.pluginId.localeCompare(b.pluginId) || a.name.localeCompare(b.name))

/** How much of the plugin's answer reaches the run row. An action is not a data channel. */
const DETAIL_MAX = 200

/** Fire one action as this node. Throws on anything that is not a 2xx: the caller decides what a
 *  failure means, and the scheduler's answer is to record it and start backing off. */
export async function runNodeAction(
  env: Env,
  action: NodeAction,
  params: Record<string, string>,
  signal: AbortSignal,
): Promise<void> {
  const response = await dispatchPluginRoute(
    env,
    action.pluginId,
    action.path,
    // The params ride in the body, matching what the click site posts (docs/schedules.md
    // § `node-action`): every way of firing an action looks the same to the handler, which is the
    // property that keeps a second caller from needing a second route shape.
    { method: 'POST', body: JSON.stringify(params) },
    signal,
  )
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`${response.status} from ${action.path}${body ? `: ${body.slice(0, DETAIL_MAX)}` : ''}`)
  }
}
