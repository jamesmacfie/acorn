import type { AgentUsage } from '../../contract/wire'
import { agentModelPrice, type AgentPricingPreferences } from '../../shared/pricing'
import { mergeAgentUsage } from '../../shared/usageFold'
import { estimateUsageEventCost } from '@acorn/protocol/usageCost.ts'

export type UsageEventInput = {
  id: string; sessionId: string; turnId: string | null; taskId: string; provider: string
  model: string | null; at: number; usage: AgentUsage
}

const delta = (current: number | undefined, previous: number | undefined): number | null => {
  if (current === undefined || !Number.isFinite(current) || current < 0) return null
  return previous === undefined || current < previous ? current : current - previous
}

/** The ledger keeps snapshots. Convert before filtering so a window never absorbs usage from before it. */
export function usageRecords(events: readonly UsageEventInput[], preferences: AgentPricingPreferences) {
  const previous = new Map<string, AgentUsage>()
  return events.map(event => {
    const key = event.provider === 'codex' ? event.sessionId : `${event.sessionId}:${event.turnId ?? ''}`
    const before = previous.get(key) ?? {}
    const snapshot = mergeAgentUsage(before, event.usage)
    const inputTokens = delta(snapshot.inputTokens, before.inputTokens)
    const outputTokens = delta(snapshot.outputTokens, before.outputTokens)
    const cacheReadTokens = delta(snapshot.cachedInputTokens, before.cachedInputTokens)
    const cacheWriteTokens = delta(snapshot.cacheWriteInputTokens, before.cacheWriteInputTokens)
    const reported = snapshot.cost?.currency.toUpperCase() === 'USD'
      ? delta(snapshot.cost.amount, before.cost?.currency.toUpperCase() === 'USD' ? before.cost.amount : undefined) : null
    const price = event.model ? agentModelPrice(event.provider, event.model, event.at, preferences) : null
    const estimated = estimateUsageEventCost({ input: inputTokens, output: outputTokens,
      cacheRead: cacheReadTokens, cacheWrite: cacheWriteTokens }, price)
    previous.set(key, snapshot)
    return { recordId: event.id, data: {
      at: event.at, sessionId: event.sessionId, turnId: event.turnId, taskId: event.taskId,
      provider: event.provider, model: event.model, inputTokens, outputTokens,
      cacheReadTokens, cacheWriteTokens, costUsd: reported ?? estimated,
      costSource: reported !== null ? 'reported' : estimated !== null ? 'estimated' : 'unknown',
      priceName: reported !== null ? null : estimated !== null ? event.model : null,
    }, taskId: event.taskId }
  })
}
