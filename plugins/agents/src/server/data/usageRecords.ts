import type { AgentUsage } from '../../contract/wire'
import { agentModelPrice, type AgentPricingPreferences } from '../../shared/pricing'
import { mergeAgentUsage } from '../../shared/usageFold'
import { estimateUsageEventCost } from '@acorn/protocol/usageCost.ts'

export type UsageEventInput = {
  id: string
  sessionId: string
  turnId: string | null
  taskId: string
  provider: string
  model: string | null
  at: number
  usage: AgentUsage
}

/** The model a turn ran on: the one its policy declared, else the one the provider advertised. */
export const modelAtTurn = (raw: string | null): string | null => {
  if (!raw) return null
  try {
    const policy = JSON.parse(raw) as { model?: unknown; providerAdvertisedPolicy?: unknown }
    if (typeof policy.model === 'string' && policy.model) return policy.model
    if (Array.isArray(policy.providerAdvertisedPolicy)) {
      for (const candidate of policy.providerAdvertisedPolicy) {
        if (
          candidate &&
          typeof candidate === 'object' &&
          candidate.category === 'model' &&
          typeof candidate.value === 'string'
        )
          return candidate.value
      }
    }
  } catch {
    /* The historical turn has no usable model declaration. */
  }
  return null
}

const delta = (current: number | undefined, previous: number | undefined): number | null => {
  if (current === undefined || !Number.isFinite(current) || current < 0) return null
  return previous === undefined || current < previous ? current : current - previous
}

type UsageSnapshot = Pick<UsageEventInput, 'sessionId' | 'turnId' | 'provider' | 'usage'>

const usd = (cost: AgentUsage['cost']): number | undefined =>
  cost?.currency.toUpperCase() === 'USD' ? cost.amount : undefined

/**
 * What each usage event added, in the order given. The ledger keeps snapshots. Codex's tokens run for
 * the whole session while other harnesses' start again each turn, so Codex is keyed by session. A
 * reported cost is the session's running total for every harness, as ACP defines it.
 */
export function usageDeltas<T extends UsageSnapshot>(events: readonly T[]) {
  const previous = new Map<string, AgentUsage>()
  const previousCost = new Map<string, AgentUsage['cost']>()
  return events.map((event) => {
    const key = event.provider === 'codex' ? event.sessionId : `${event.sessionId}:${event.turnId ?? ''}`
    const before = previous.get(key) ?? {}
    const snapshot = mergeAgentUsage(before, event.usage)
    previous.set(key, snapshot)
    const costBefore = previousCost.get(event.sessionId)
    const cost = event.usage.cost ?? costBefore
    if (cost) previousCost.set(event.sessionId, cost)
    return {
      event,
      inputTokens: delta(snapshot.inputTokens, before.inputTokens),
      outputTokens: delta(snapshot.outputTokens, before.outputTokens),
      cacheReadTokens: delta(snapshot.cachedInputTokens, before.cachedInputTokens),
      cacheWriteTokens: delta(snapshot.cacheWriteInputTokens, before.cacheWriteInputTokens),
      reportedCostUsd: usd(cost) === undefined ? null : delta(usd(cost), usd(costBefore)),
    }
  })
}

/** Convert before filtering so a window never absorbs usage from before it. */
export function usageRecords(events: readonly UsageEventInput[], preferences: AgentPricingPreferences) {
  return usageDeltas(events).map(({ event, reportedCostUsd: reported, ...tokens }) => {
    const price = event.model ? agentModelPrice(event.provider, event.model, event.at, preferences) : null
    const estimated = estimateUsageEventCost(
      {
        input: tokens.inputTokens,
        output: tokens.outputTokens,
        cacheRead: tokens.cacheReadTokens,
        cacheWrite: tokens.cacheWriteTokens,
      },
      price,
    )
    return {
      recordId: event.id,
      data: {
        at: event.at,
        sessionId: event.sessionId,
        turnId: event.turnId,
        taskId: event.taskId,
        provider: event.provider,
        model: event.model,
        ...tokens,
        costUsd: reported ?? estimated,
        costSource: reported !== null ? 'reported' : estimated !== null ? 'estimated' : 'unknown',
        priceName: reported !== null ? null : estimated !== null ? event.model : null,
      },
      taskId: event.taskId,
    }
  })
}
