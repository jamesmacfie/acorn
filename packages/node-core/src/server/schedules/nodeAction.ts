import { RISK_ORDER, type ToolRisk } from '@acorn/protocol/workflow.ts'
import type { Env } from '../../main/bindings'
import { nodeAction, riskOf, runNodeAction } from '../nodeActions/registry'
import { ScheduleSkipped, type Scheduler } from './scheduler'

// The `node-action` schedule target: what it may do (docs/schedules.md § `node-action`) and where
// its consent lives (docs/schedules.md § Consent, and the two ways it fails closed).

export type NodeActionTarget = {
  pluginId: string
  actionId: string
  params: Record<string, string>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

/** Parse a proposed target. Returns null to refuse the create, the one non-tolerant edge in the
 *  scheduler: a schedule pointing at nothing is not a version-skew case, it is a typo, and the
 *  person is standing right there. */
export function parseNodeActionTarget(raw: unknown): NodeActionTarget | null {
  if (!isRecord(raw)) return null
  const pluginId = typeof raw.pluginId === 'string' ? raw.pluginId : ''
  const actionId = typeof raw.actionId === 'string' ? raw.actionId : ''
  if (!pluginId || !actionId) return null
  // Resolved now, so the picker's promise, "only what runs is offered", is enforced by the store and
  // not just by the UI that draws the list.
  if (!nodeAction(pluginId, actionId)) return null
  const params: Record<string, string> = {}
  if (isRecord(raw.params)) {
    for (const [name, value] of Object.entries(raw.params)) if (typeof value === 'string') params[name] = value
  }
  return { pluginId, actionId, params }
}

/** Register the target on a scheduler. Core's, not a plugin's: the dispatch is core dispatching a
 *  plugin's own route the way a click does, and that is not something a plugin registers on its own
 *  behalf. */
export function registerNodeActionTarget(scheduler: Scheduler, env: Env): { dispose(): void } {
  return scheduler.registerTarget({
    kind: 'node-action',
    parse: (raw) => parseNodeActionTarget(raw),
    // Read off the resolved action at create time. This is the value that gets stamped, and the value
    // the confirmation the owner just accepted was drawn from.
    risk: (target) => {
      const parsed = target as NodeActionTarget
      const action = nodeAction(parsed.pluginId, parsed.actionId)
      return action ? riskOf(action) : undefined
    },
    run: async (target, signal, consent) => {
      const parsed = parseNodeActionTarget(target)
      // Not a parse failure. The row parsed fine when it was created; the action has gone.
      if (!parsed) {
        const named = isRecord(target) ? `${String(target.pluginId)}:${String(target.actionId)}` : 'that action'
        throw new ScheduleSkipped(`${named} is not available on this node right now`)
      }
      const action = nodeAction(parsed.pluginId, parsed.actionId)!
      const current = riskOf(action)
      if (!consentStillCovers(consent.risk, current)) {
        throw new ScheduleSkipped(`risk changed to '${current}' — re-confirm to resume`)
      }
      await runNodeAction(env, action, parsed.params, signal)
      return `ran ${action.pluginId}: ${action.name}`
    },
  })
}

/** The tier check, applied by the scheduler's caller rather than inside `run`, because it needs the
 *  stamp off the row and a target never sees its own row. Exported for the route that fires a run and
 *  for the settings row that offers the re-arm. */
export function consentStillCovers(stamped: ToolRisk | undefined, current: ToolRisk): boolean {
  // An unstamped row predates the stamp, or was created against a target that declared nothing.
  // It is covered only by the tier it would have been armed at, which `riskOf` pins to `execute`,
  // so an unstamped row covers nothing and re-arms once. Fail closed.
  if (!stamped) return false
  return RISK_ORDER[current] <= RISK_ORDER[stamped]
}
