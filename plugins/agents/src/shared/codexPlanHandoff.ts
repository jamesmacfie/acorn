import type { AgentEventRecord, AgentSession, AgentTurn } from '../contract/wire.ts'

export const CODEX_PLAN_IMPLEMENTATION_PROMPT = 'Implement the plan you just proposed. Follow its steps, make the changes in this workspace, and verify the result.'

export const codexModeOption = (session: AgentSession) => {
  const options = session.config.configOptions
  return Array.isArray(options)
    ? options.find((option) => option && typeof option === 'object' && option.id === 'mode') as {
        id: string
        currentValue?: unknown
        values?: Array<{ value: string }>
      } | undefined
    : undefined
}

export type CodexPlanHandoffState = 'actionable' | 'handled' | 'unavailable'

/** Both hosts and the Node apply the same visible eligibility rule; the Node repeats it in SQLite. */
export function codexPlanHandoffState(
  session: AgentSession,
  turns: readonly AgentTurn[],
  events: readonly AgentEventRecord[],
  proposal: AgentEventRecord,
): CodexPlanHandoffState {
  if (proposal.event.type !== 'plan_proposal' || !proposal.turnId) return 'unavailable'
  const { itemId, providerTurnId } = proposal.event
  if (turns.some((turn) => turn.effectivePolicy.acceptedPlanItemId === itemId
    && turn.effectivePolicy.acceptedPlanTurnId === proposal.turnId)) return 'handled'
  const lastTurn = turns.at(-1)
  if (!lastTurn || lastTurn.id !== proposal.turnId || lastTurn.status !== 'completed'
    || lastTurn.stopReason !== 'completed'
    || lastTurn.source !== 'interactive' || lastTurn.effectivePolicy.mode !== 'plan'
    || (lastTurn.providerTurnRef && lastTurn.providerTurnRef !== providerTurnId)) return 'unavailable'
  const latestProposal = events.filter((record) => record.turnId === proposal.turnId
    && record.event.type === 'plan_proposal').at(-1)
  if (latestProposal?.id !== proposal.id) return 'unavailable'
  const mode = codexModeOption(session)
  return session.kind === 'interactive' && session.driverKind === 'codex-app-server'
    && session.controller === 'acorn' && !session.archivedAt
    && mode?.currentValue === 'plan' && mode.values?.some((value) => value.value === 'default')
    ? 'actionable'
    : 'unavailable'
}
