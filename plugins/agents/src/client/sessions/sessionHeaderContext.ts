import type {
  AgentEventRecord,
  AgentSession,
  AgentSessionSnapshot,
  AgentTurn,
  AgentUsage,
} from '@acorn/protocol/managedAgents.ts'
import type { AgentSessionHeaderProps } from '@acorn/protocol/extensionPoints.ts'
import { agentModelPrice, type AgentPricingPreferences } from '../../shared/pricing'
import { mergeAgentUsage } from '../../shared/usageFold'

function advertisedModel(turn: AgentTurn): string | null {
  if (typeof turn.effectivePolicy.model === 'string' && turn.effectivePolicy.model) {
    return turn.effectivePolicy.model
  }
  const advertised = turn.effectivePolicy.providerAdvertisedPolicy
  if (!Array.isArray(advertised)) return null
  for (const candidate of advertised) {
    if (!candidate || typeof candidate !== 'object') continue
    const option = candidate as { category?: unknown; value?: unknown }
    if (option.category === 'model' && typeof option.value === 'string' && option.value) return option.value
  }
  return null
}

function currentSessionModel(session: AgentSession): string | null {
  if (session.model) return session.model
  const options = session.config.configOptions
  if (!Array.isArray(options)) return null
  for (const candidate of options) {
    if (!candidate || typeof candidate !== 'object') continue
    const option = candidate as { category?: unknown; currentValue?: unknown }
    if (option.category === 'model' && typeof option.currentValue === 'string' && option.currentValue) {
      return option.currentValue
    }
  }
  return null
}

function usageByTurn(turns: readonly AgentTurn[], events: readonly AgentEventRecord[]): Map<string, AgentUsage> {
  const usage = new Map<string, AgentUsage>()
  for (const turn of turns) if (turn.usage) usage.set(turn.id, turn.usage)
  let openTurnId: string | null = null
  for (const record of [...events].sort((left, right) => left.seq - right.seq)) {
    if (record.event.type !== 'usage') continue
    const turnId: string | null = record.turnId ?? openTurnId
    if (!turnId) continue
    usage.set(turnId, mergeAgentUsage(usage.get(turnId) ?? {}, record.event.usage))
    openTurnId = turnId
  }
  return usage
}

/** The owner-side adapter from the private managed-session ledger to the public header point. It
 *  folds live usage and resolves the model price, but deliberately assigns no monetary meaning to
 *  either. That policy belongs to whichever plugin fills the point. */
export function sessionHeaderContext(
  taskId: string,
  session: AgentSession,
  snapshot: AgentSessionSnapshot | undefined,
  preferences: AgentPricingPreferences,
): AgentSessionHeaderProps {
  const turns = [...(snapshot?.turns ?? [])].sort((left, right) => left.ordinal - right.ordinal)
  const usage = usageByTurn(turns, snapshot?.events ?? [])
  return {
    taskId,
    sessionId: session.id,
    providerId: session.providerId,
    tokenAccounting: session.providerId === 'codex' ? 'cumulative' : 'per-turn',
    costAccounting: 'cumulative',
    turns: turns.flatMap((turn) => {
      const turnUsage = usage.get(turn.id)
      if (!turnUsage) return []
      const model = advertisedModel(turn) ?? currentSessionModel(session)
      return [{
        turnId: turn.id,
        model,
        usage: turnUsage,
        price: model
          ? agentModelPrice(
              session.providerId,
              model,
              turn.completedAt ?? turn.startedAt ?? turn.createdAt,
              preferences,
            )
          : null,
      }]
    }),
  }
}
