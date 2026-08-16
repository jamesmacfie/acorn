import type { ToolRisk } from '@acorn/protocol/api.ts'
import { dispatchPluginRoute } from '../plugin/dispatch'
import type { Env } from '../../main/bindings'

// What a USER schedule may point at (docs/future/cron/targets.md § node-action).
//
// The target is a context-free chrome-verb dispatch — the same `runNodeAction` path a panel row
// action or a command takes — and deliberately NOT a new execution surface. What a scheduled action
// can do is exactly what that action could do if clicked; the schedule only owns *when*.
//
// ── Why this registry exists at all ────────────────────────────────────────────────────────────
//
// The design assumed the node could already enumerate clickable actions with their risk tiers. It
// cannot. A `runNodeAction` chrome action declares no `risk` (only a COLLECTION ROW action does),
// and a compiled plugin registers its chrome client-side, where the node cannot see it. So the
// offerable set had to come from somewhere, and this is the cheapest somewhere: one node-side line
// per action, naming the route constant the plugin's contract module already exports — exactly the
// shape the collection read registry takes one directory over.
//
// It does NOT grow the plugin wire contract, which the scheduler's invariants cap at one new
// descriptor kind. A loaded plugin's entries are synthesised from manifest COMMANDS whose verb is
// `runNodeAction`, which are already declared, already parsed and already confined.

export type NodeAction = {
  pluginId: string
  /** Unique within the plugin. Together with `pluginId` it is what a stored schedule target names,
   *  which is why it must be stable across updates: renaming one makes every schedule pointing at it
   *  fail closed, which is the correct outcome but a rude one. */
  actionId: string
  /** What the picker and the settings row call it. */
  name: string
  /** POST → whatever. Confined to the plugin's own namespace on every fire, not merely at
   *  registration (../plugin/dispatch.ts). */
  path: string
  /** The tier the host's confirmation is drawn from, and what gets stamped onto the schedule row at
   *  creation. Absent means `execute` — see `riskOf` below. */
  risk?: ToolRisk
}

export type NodeActionRegistration = Omit<NodeAction, 'pluginId'>

/** An action that declares no tier is treated as the HIGHEST, not the lowest.
 *
 *  This is the one place the design's assumption is repaired rather than met, so it fails in the safe
 *  direction: an undeclared tier means nobody has said what this does, and arming the strongest
 *  confirmation for that is the answer that cannot be wrong in a way that matters. It also means an
 *  action that LATER declares a real tier can only ever go down, so the tier-rise check below never
 *  fires spuriously on a plugin that started declaring what it always did. */
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

/** What the creation flow may offer. The picker shows only what resolves NOW, so a schedule can never
 *  be created against something this node cannot run. */
export const nodeActions = (): NodeAction[] =>
  [...actions.values()].sort((a, b) => a.pluginId.localeCompare(b.pluginId) || a.name.localeCompare(b.name))

/** How much of the plugin's answer reaches the run row. An action is not a data channel. */
const DETAIL_MAX = 200

/** Fire one action as this node. Throws on anything that is not a 2xx, because throwing is how the
 *  engine records a failure and starts backing off. */
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
    // The params ride in the BODY, matching what the click site posts. A scheduled fire and a clicked
    // one have to be indistinguishable to the handler, or the plugin has two code paths for one verb.
    { method: 'POST', body: JSON.stringify(params) },
    signal,
  )
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`${response.status} from ${action.path}${body ? `: ${body.slice(0, DETAIL_MAX)}` : ''}`)
  }
}
