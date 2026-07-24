import type {
  AgentProviderUsage,
  AgentUsageHealth,
  AgentUsageSnapshot,
} from '../shared/usage'
import { sessionQuota } from '../shared/usage'

export type UsageDetailRow = { label: string; value: string }

const HEALTH_ICON: Record<AgentUsageHealth, string> = {
  healthy: '🟢',
  warning: '🟡',
  critical: '🔴',
  depleted: '⚪',
  unknown: '⚪',
}

export function usageHealthIcon(health: AgentUsageHealth): string {
  return HEALTH_ICON[health]
}

export function formatPercent(percent: number): string {
  return `${Math.round(percent)}%`
}

export function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`
}

export function formatTokens(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: value >= 10_000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value)
}

export function formatDuration(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds))
  const hours = Math.floor(rounded / 3_600)
  const minutes = Math.floor((rounded % 3_600) / 60)
  const remainder = rounded % 60
  return [hours ? `${hours}h` : '', minutes ? `${minutes}m` : '', !hours && remainder ? `${remainder}s` : ''].filter(Boolean).join(' ') || '0s'
}

export function formatReset(resetsAt: number | null, resetText: string | null, now = Date.now()): string | null {
  if (resetsAt != null) {
    const remaining = Math.max(0, resetsAt - now)
    const minutes = Math.round(remaining / 60_000)
    if (minutes < 60) return `resets in ${minutes}m`
    const hours = Math.floor(minutes / 60)
    const leftover = minutes % 60
    if (hours < 24) return `resets in ${hours}h${leftover ? ` ${leftover}m` : ''}`
    const days = Math.floor(hours / 24)
    return `resets in ${days}d ${hours % 24}h`
  }
  return resetText?.replace(/^resets?\s*/i, 'resets ') ?? null
}

export function formatUpdated(capturedAt: number | null, now = Date.now()): string {
  if (capturedAt == null) return 'not updated'
  const minutes = Math.max(0, Math.floor((now - capturedAt) / 60_000))
  if (minutes < 1) return 'updated just now'
  if (minutes < 60) return `updated ${minutes}m ago`
  return `updated ${Math.floor(minutes / 60)}h ago`
}

export function usageTooltipSummary(snapshot: AgentUsageSnapshot | null): string {
  return (['claude', 'codex'] as const)
    .map((id) => {
      const provider = snapshot?.providers.find((item) => item.provider === id)
      const quota = provider ? sessionQuota(provider) : undefined
      const label = id === 'claude' ? 'Claude' : 'Codex'
      return quota ? `${usageHealthIcon(quota.health)} ${label} ${formatPercent(quota.percentRemaining)}` : `⚪ ${label} —`
    })
    .join(' · ')
}

export function providerUsageRows(provider: AgentProviderUsage, now = Date.now()): UsageDetailRow[] {
  const rows: UsageDetailRow[] = provider.quotas.map((quota) => {
    const reset = formatReset(quota.resetsAt, quota.resetText, now)
    return { label: quota.label, value: `${formatPercent(quota.percentRemaining)} remaining${reset ? ` · ${reset}` : ''}` }
  })
  if (provider.cost) {
    if (provider.cost.source === 'extra_usage') {
      rows.push({
        label: 'Extra usage',
        value:
          provider.cost.budgetUsd == null
            ? `${formatUsd(provider.cost.spentUsd)} spent`
            : `${formatUsd(provider.cost.spentUsd)} / ${formatUsd(provider.cost.budgetUsd)} spent${
                provider.cost.remainingUsd == null ? '' : ` · ${formatUsd(provider.cost.remainingUsd)} left`
              }`,
      })
    } else {
      rows.push({ label: 'CLI session cost', value: formatUsd(provider.cost.spentUsd) })
      if (provider.cost.apiDurationSeconds != null) {
        rows.push({ label: 'API duration', value: formatDuration(provider.cost.apiDurationSeconds) })
      }
    }
  }
  const daily = provider.daily?.today
  if (daily) {
    rows.push({
      label: 'Estimated today',
      value: daily.estimatedCostUsd == null ? 'pricing unavailable' : `≈${formatUsd(daily.estimatedCostUsd)}`,
    })
    rows.push({ label: 'Tokens today', value: formatTokens(daily.totalNonCacheTokens) })
    rows.push({ label: 'Input / output', value: `${formatTokens(daily.inputTokens)} / ${formatTokens(daily.outputTokens)}` })
    if (daily.cacheWriteTokens || daily.cacheReadTokens) {
      rows.push({ label: 'Cache write / read', value: `${formatTokens(daily.cacheWriteTokens)} / ${formatTokens(daily.cacheReadTokens)}` })
    }
    rows.push({ label: 'Working time', value: formatDuration(daily.workingSeconds) })
    rows.push({ label: 'Sessions', value: String(daily.sessionCount) })
    if (daily.estimatedCacheSavingsUsd != null && daily.estimatedCacheSavingsUsd > 0) {
      rows.push({ label: 'Est. cache savings', value: `≈${formatUsd(daily.estimatedCacheSavingsUsd)}` })
    }
  }
  return rows
}
