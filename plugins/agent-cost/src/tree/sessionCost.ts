import type {
  SessionHeaderProps,
  SessionHeaderTokenPrice,
  SessionHeaderUsage,
} from './sessionHeaderContract'
import { estimateUsageEventCost } from '@acorn/protocol/usageCost.ts'

export type SessionCostEstimate = {
  amountUsd: number
  source: 'provider' | 'estimated'
}

const finiteCount = (value: number | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null

function tokenCost(
  usage: SessionHeaderUsage,
  previous: SessionHeaderUsage,
  price: SessionHeaderTokenPrice,
): number | null {
  const inputTotal = finiteCount(usage.inputTokens)
  if (inputTotal === null) return null
  const outputTotal = finiteCount(usage.outputTokens) ?? 0
  const cachedTotal = finiteCount(usage.cachedInputTokens) ?? 0
  const writeTotal = finiteCount(usage.cacheWriteInputTokens) ?? 0
  const input = inputTotal - (finiteCount(previous.inputTokens) ?? 0)
  const output = outputTotal - (finiteCount(previous.outputTokens) ?? 0)
  const cached = cachedTotal - (finiteCount(previous.cachedInputTokens) ?? 0)
  const cacheWrite = writeTotal - (finiteCount(previous.cacheWriteInputTokens) ?? 0)
  if ([input, output, cached, cacheWrite].some((count) => count < 0)) return null
  return estimateUsageEventCost({ input, output, cacheRead: cached, cacheWrite }, price)
}

/** Sum the same per-event reported-or-estimated policy used by the ledger source. */
export function estimateSessionCost(props: SessionHeaderProps): SessionCostEstimate | null {
  let previousUsage: SessionHeaderUsage = {}
  let previousReported: number | null = null
  let amountUsd = 0
  let estimated = false
  let counted = false
  for (const turn of props.turns) {
    const raw = turn.usage.cost
    const amount = raw?.currency.toUpperCase() === 'USD' ? finiteCount(raw.amount) : null
    const reported = amount === null ? null : props.costAccounting === 'cumulative'
      ? previousReported === null || amount < previousReported ? amount : amount - previousReported : amount
    const cost = reported ?? (turn.price ? tokenCost(turn.usage,
      props.tokenAccounting === 'cumulative' ? previousUsage : {}, turn.price) : null)
    if (cost === null) return null
    amountUsd += cost
    estimated ||= reported === null
    counted = true
    if (amount !== null) previousReported = amount
    previousUsage = turn.usage
  }
  return counted ? { amountUsd, source: estimated ? 'estimated' : 'provider' } : null
}
