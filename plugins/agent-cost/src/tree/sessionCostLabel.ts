import type { SessionCacheUsage } from './sessionCost'

export function sessionCostLabel(amountUsd: number, approximate: boolean): string {
  const prefix = approximate ? '≈' : ''
  if (amountUsd > 0 && amountUsd < 0.01) return `${prefix}<$0.01`
  return `${prefix}$${amountUsd.toFixed(2)}`
}

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

export function sessionCacheLabel(usage: SessionCacheUsage): string {
  const share = Math.round((usage.readTokens / usage.inputTokens) * 100)
  const written = usage.writeTokens === null ? '' : `, ${compact.format(usage.writeTokens)} written to it`
  return `${share}% of ${compact.format(usage.inputTokens)} input tokens came from the prompt cache${written}.`
}
