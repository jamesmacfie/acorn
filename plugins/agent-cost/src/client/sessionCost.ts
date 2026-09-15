import type {
  AgentSessionHeaderProps,
  AgentSessionHeaderTurn,
  AgentSessionTokenPrice,
} from '@acorn/protocol/extensionPoints.ts'
import type { AgentUsage } from '@acorn/protocol/managedAgents.ts'

export type SessionCostEstimate = {
  amountUsd: number
  source: 'provider' | 'estimated'
}

const finiteCount = (value: number | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null

function reportedUsdCost(props: AgentSessionHeaderProps): number | null {
  const amounts = props.turns.flatMap((turn) => {
    const cost = turn.usage.cost
    return cost?.currency.toUpperCase() === 'USD' && finiteCount(cost.amount) !== null
      ? [cost.amount]
      : []
  })
  if (!amounts.length) return null
  return props.costAccounting === 'cumulative'
    ? amounts.at(-1)!
    : amounts.reduce((sum, amount) => sum + amount, 0)
}

function tokenCost(
  usage: AgentUsage,
  previous: AgentUsage,
  price: AgentSessionTokenPrice,
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
  const uncachedInput = input - cached - cacheWrite
  if (uncachedInput < 0) return null
  return (
    uncachedInput * price.input
    + output * price.output
    + cached * price.cacheRead
    + cacheWrite * price.cacheWrite
  ) / 1_000_000
}

function estimatedTokenCost(
  turns: readonly AgentSessionHeaderTurn[],
  accounting: AgentSessionHeaderProps['tokenAccounting'],
): number | null {
  let previous: AgentUsage = {}
  let amountUsd = 0
  let priced = false
  for (const turn of turns) {
    if (finiteCount(turn.usage.inputTokens) === null) continue
    if (!turn.price) return null
    const turnCost = tokenCost(turn.usage, accounting === 'cumulative' ? previous : {}, turn.price)
    if (turnCost === null) return null
    amountUsd += turnCost
    previous = turn.usage
    priced = true
  }
  return priced ? amountUsd : null
}

/** The plugin's complete pricing policy. Provider-reported USD takes precedence; otherwise the
 *  owner-projected token snapshots are priced according to their declared accounting mode. */
export function estimateSessionCost(props: AgentSessionHeaderProps): SessionCostEstimate | null {
  const reported = reportedUsdCost(props)
  if (reported !== null) return { amountUsd: reported, source: 'provider' }
  const estimated = estimatedTokenCost(props.turns, props.tokenAccounting)
  return estimated === null ? null : { amountUsd: estimated, source: 'estimated' }
}
