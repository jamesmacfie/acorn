export const agentUsageRoute = '/api/agents/usage'
export const agentUsageRefreshRoute = '/api/agents/usage/refresh'

export type AgentUsageProviderId = 'claude' | 'codex'
export type AgentUsageHealth = 'healthy' | 'warning' | 'critical' | 'depleted' | 'unknown'
export type AgentUsageAvailability = 'available' | 'missing' | 'error'

export type AgentUsageQuota = {
  id: string
  label: string
  percentRemaining: number
  resetsAt: number | null
  resetText: string | null
  health: AgentUsageHealth
}

export type AgentUsageCost = {
  source: 'extra_usage' | 'cli_cost'
  spentUsd: number
  budgetUsd: number | null
  remainingUsd: number | null
  resetsAt: number | null
  resetText: string | null
  apiDurationSeconds: number | null
  estimated: false
}

export type AgentDailyUsagePeriod = {
  day: string
  inputTokens: number
  outputTokens: number
  cacheWriteTokens: number
  cacheReadTokens: number
  totalNonCacheTokens: number
  workingSeconds: number
  sessionCount: number
  estimatedCostUsd: number | null
  estimatedCacheSavingsUsd: number | null
  pricingFallback: boolean
}

export type AgentDailyUsage = {
  today: AgentDailyUsagePeriod
  yesterday: AgentDailyUsagePeriod | null
  skippedFileCount: number
}

export type AgentUsageErrorCode =
  | 'cli_missing'
  | 'authentication_required'
  | 'update_required'
  | 'trust_failure'
  | 'timeout'
  | 'output_limit'
  | 'parse_failure'
  | 'execution_failure'

export type AgentUsageError = {
  code: AgentUsageErrorCode
  message: string
}

export type AgentProviderUsage = {
  provider: AgentUsageProviderId
  availability: AgentUsageAvailability
  health: AgentUsageHealth
  plan: string | null
  account: { email: string | null; organization: string | null } | null
  quotas: AgentUsageQuota[]
  cost: AgentUsageCost | null
  daily: AgentDailyUsage | null
  capturedAt: number | null
  stale: boolean
  error: AgentUsageError | null
}

export type AgentUsageSnapshot = {
  providers: AgentProviderUsage[]
  refreshedAt: number
}

const HEALTH_ORDER: Record<AgentUsageHealth, number> = {
  unknown: 0,
  healthy: 1,
  warning: 2,
  critical: 3,
  depleted: 4,
}

export function clampRemaining(percent: number): number {
  if (!Number.isFinite(percent)) return 0
  return Math.min(100, Math.max(0, percent))
}

export function usageHealth(percentRemaining: number | null | undefined): AgentUsageHealth {
  if (percentRemaining == null || !Number.isFinite(percentRemaining)) return 'unknown'
  const percent = clampRemaining(percentRemaining)
  if (percent <= 0) return 'depleted'
  if (percent < 20) return 'critical'
  if (percent < 50) return 'warning'
  return 'healthy'
}

export function worstUsageHealth(quotas: readonly AgentUsageQuota[]): AgentUsageHealth {
  if (quotas.length === 0) return 'unknown'
  return quotas.reduce<AgentUsageHealth>(
    (worst, quota) => (HEALTH_ORDER[quota.health] > HEALTH_ORDER[worst] ? quota.health : worst),
    'healthy',
  )
}

export function sessionQuota(provider: AgentProviderUsage): AgentUsageQuota | undefined {
  return provider.quotas.find((quota) => quota.id === 'session')
}

export function emptyProviderUsage(
  provider: AgentUsageProviderId,
  availability: Exclude<AgentUsageAvailability, 'available'>,
  error: AgentUsageError,
): AgentProviderUsage {
  return {
    provider,
    availability,
    health: 'unknown',
    plan: null,
    account: null,
    quotas: [],
    cost: null,
    daily: null,
    capturedAt: null,
    stale: false,
    error,
  }
}
