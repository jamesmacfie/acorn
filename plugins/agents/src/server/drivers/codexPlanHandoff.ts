import { createHash } from 'node:crypto'
import type { AgentTurn } from '../../contract/wire.ts'
import { codexModeOption, codexPlanHandoffState } from '../../shared/codexPlanHandoff'
import type { AgentStore } from '../sessions/store'

/**
 * Accepts one completed Codex plan proposal: switches the session's mode from Plan to Default and
 * queues the turn that implements the plan, as one store transaction. Two clients accepting the same
 * proposal queue one turn. A proposal that is no longer the session's latest, or that a turn already
 * accepted, is refused and leaves the session in Plan (../../shared/codexPlanHandoff.ts).
 */
export function acceptCodexPlan(
  store: Pick<AgentStore, 'enqueueAfterLatestTurn'>,
  sessionId: string,
  itemId: string,
  prompt: string,
): Promise<{ turn: AgentTurn; inserted: boolean }> {
  const key = `codex-plan:${createHash('sha256').update(itemId).digest('hex')}`
  return store.enqueueAfterLatestTurn(sessionId, key, (session, latest) => {
    const proposal = latest?.events.findLast((record) => record.event.type === 'plan_proposal'
      && record.event.itemId === itemId)
    if (!latest || !proposal || codexPlanHandoffState(session, [latest.turn], latest.events, proposal) !== 'actionable') {
      throw new Error('This plan is no longer available to implement.')
    }
    const mode = codexModeOption(session)!
    const options = session.config.configOptions as Array<{
      id: string; label: string; category: string; currentValue: string | null
    }>
    const configOptions = options.map((option) => option.id === mode.id
      ? { ...option, currentValue: 'default' }
      : option)
    // Codex reads the model and the effort off the turn's policy, so the session's options go there
    // too, with `reasoning` under the name Codex uses.
    const policy = Object.fromEntries(configOptions.flatMap((option) =>
      option.currentValue == null ? [] : [[option.id === 'reasoning' ? 'effort' : option.id, option.currentValue]]))
    return {
      config: { ...session.config, configOptions },
      input: [{ type: 'text', text: prompt }],
      policy: { ...policy, mode: 'default', acceptedPlanItemId: itemId, acceptedPlanTurnId: latest.turn.id },
    }
  })
}
