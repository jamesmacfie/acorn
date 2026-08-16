import { RISK_ORDER, type ToolRisk } from '@acorn/protocol/workflow.ts'
import type { Env } from '../../main/bindings'
import { nodeAction, riskOf, runNodeAction } from '../nodeActions/registry'
import { ScheduleSkipped, type Scheduler } from './scheduler'

// The `node-action` schedule target (docs/future/cron/targets.md § node-action).
//
// ── Where consent lives ────────────────────────────────────────────────────────────────────────
//
// AT CREATION, WHOLE. The action's declared risk tier is read when the schedule is made, the creation
// flow arms exactly the confirmation that tier would get on a click — host-drawn, naming the plugin
// and the tier, and it cannot be talked out of asking — and the accepted tier is STAMPED onto the row
// (`userSchedules.risk`). From then on runs never prompt, because an unattended prompt is either
// ignored (the schedule silently does nothing, which is worse than not existing) or auto-accepted
// (a lie about consent). The stamp stays visible on the settings row for the schedule's whole life,
// which is what makes one-time consent honest.
//
// Two consequences, both failing CLOSED and both recorded as `skipped` rather than as errors:
//
//   TIER RISE. A plugin update that declares `execute` where it said `write` invalidates the stamp.
//   Stamped consent covers the tier it stamped and nothing higher, so the run does nothing and the
//   row says to re-confirm.
//
//   UNRESOLVABLE. The plugin is gone, disabled, or renamed the action. The row survives inert —
//   dashboards-style — and reattaches by itself the day the action comes back.

export type NodeActionTarget = {
  pluginId: string
  actionId: string
  params: Record<string, string>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

/** Parse a proposed target. `null` refuses the CREATE — the one non-tolerant edge in the scheduler,
 *  and the right place for it: a schedule pointing at nothing is not a version-skew case, it is a
 *  typo, and the person is standing right there. */
export function parseNodeActionTarget(raw: unknown): NodeActionTarget | null {
  if (!isRecord(raw)) return null
  const pluginId = typeof raw.pluginId === 'string' ? raw.pluginId : ''
  const actionId = typeof raw.actionId === 'string' ? raw.actionId : ''
  if (!pluginId || !actionId) return null
  // Resolved NOW, so the picker's promise ("only what runs is offered") is enforced by the store and
  // not merely by the UI that happened to draw the list.
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
    // Read off the resolved action at CREATE time. This is the value that gets stamped, and therefore
    // the value the confirmation the owner just accepted was drawn from.
    risk: (target) => {
      const parsed = target as NodeActionTarget
      const action = nodeAction(parsed.pluginId, parsed.actionId)
      return action ? riskOf(action) : undefined
    },
    run: async (target, signal, consent) => {
      const parsed = parseNodeActionTarget(target)
      // Not a parse failure — the row parsed fine when it was created. The action has gone.
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
 *  STAMP off the row and a target never sees its own row. Exported for the route that fires a run and
 *  for the settings row that offers the re-arm. */
export function consentStillCovers(stamped: ToolRisk | undefined, current: ToolRisk): boolean {
  // An unstamped row predates the stamp or was created against a target that declared nothing. It is
  // covered only by the tier it would have been armed at, which `riskOf` already pins to `execute` —
  // so an unstamped row covers nothing and re-arms. Fail closed, once.
  if (!stamped) return false
  return RISK_ORDER[current] <= RISK_ORDER[stamped]
}
