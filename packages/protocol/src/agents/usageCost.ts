export type UsageTokenDelta = { input: number | null; output: number | null; cacheRead: number | null; cacheWrite: number | null }
export type UsageTokenPrice = { input: number; output: number; cacheRead: number; cacheWrite: number }

/** Shared USD estimate for one usage event. Unknown or inconsistent counters stay unknown. */
export function estimateUsageEventCost(tokens: UsageTokenDelta, price: UsageTokenPrice | null): number | null {
  if (!price || tokens.input === null || tokens.output === null) return null
  const cacheRead = tokens.cacheRead ?? 0
  const cacheWrite = tokens.cacheWrite ?? 0
  const uncached = tokens.input - cacheRead - cacheWrite
  if (uncached < 0 || [tokens.input, tokens.output, cacheRead, cacheWrite].some(value => !Number.isFinite(value) || value < 0)) return null
  return (uncached * price.input + tokens.output * price.output
    + cacheRead * price.cacheRead + cacheWrite * price.cacheWrite) / 1_000_000
}
