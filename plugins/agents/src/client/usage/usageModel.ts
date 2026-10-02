import type {
  AgentProviderUsage,
  AgentUsageHealth,
  AgentUsageQuota,
  AgentUsageSnapshot,
} from '../../shared/usage'
import { clampRemaining, sessionQuota } from '../../shared/usage'

/** The bar under a quota row: how much is left, and where a steady spend would have left it by now.
 *  Both are 0-1 on the same scale, so the mark reads against the fill. */
export type UsageMeter = { fill: number; pace: number | null; health: AgentUsageHealth }
export type UsageDetailRow = { label: string; value: string; meter?: UsageMeter }
export type UsageSummaryEntry = { health: AgentUsageHealth; label: string; value: string }

export function formatPercent(percent: number): string {
  return `${Math.round(percent)}%`
}

export function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`
}

// An estimate in whole dollars with a thousands separator: "≈$1,918". Cents would claim a precision
// the estimate does not have, so anything under a dollar reads "<$1". Real spend keeps `formatUsd`.
export function formatEstimateUsd(value: number): string {
  if (value < 1) return '<$1'
  return `≈${new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)}`
}

export function formatTokens(value: number): string {
  if (value < 10_000) return new Intl.NumberFormat().format(value)
  // One decimal always, so a column of compact counts lines up: 1,038,000 formatted as "1M" next to
  // "132.4M" read like a rounder number than it is.
  return new Intl.NumberFormat(undefined, { notation: 'compact', minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)
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
  // the CLI appends its own zone ("… 12am (Pacific/Auckland)"); it's always the user's, so drop it
  return resetText?.replace(/^resets?\s*/i, 'resets ').replace(/\s*\([^()]*\)\s*$/, '') ?? null
}

export function formatUpdated(capturedAt: number | null, now = Date.now()): string {
  if (capturedAt == null) return 'not updated'
  const minutes = Math.max(0, Math.floor((now - capturedAt) / 60_000))
  if (minutes < 1) return 'updated just now'
  if (minutes < 60) return `updated ${minutes}m ago`
  return `updated ${Math.floor(minutes / 60)}h ago`
}

// The plan ids a provider reports, as people write them. Codex reports `prolite` and `team`; Claude
// reports a name already ("Claude Max"), which falls through to the sentence case below.
const PLAN_NAMES: Record<string, string> = { prolite: 'Pro Lite', team: 'Team', max: 'Max', pro: 'Pro', plus: 'Plus' }

export const planName = (plan: string): string => PLAN_NAMES[plan.toLowerCase()] ?? plan[0].toUpperCase() + plan.slice(1)

// Whose account it is and how fresh the reading is, as one line. The harness's own name is not in it:
// the block that draws this is already headed by the name.
export function providerMetaLine(provider: AgentProviderUsage, now = Date.now()): string {
  return [
    // The snapshot keeps whatever the provider said (see the note in formatReset); the name is this
    // line's business.
    provider.plan && planName(provider.plan),
    provider.account?.email,
    provider.account?.organization,
    `${provider.stale ? 'stale · ' : ''}${formatUpdated(provider.capturedAt, now)}`,
  ]
    .filter(Boolean)
    .join(' · ')
}

// Whatever harnesses the snapshot came back with, in the node's order. The label travels with the row
// (shared/usage.ts), so a harness the client has never heard of still gets named.
export function usageSummaryEntries(snapshot: AgentUsageSnapshot | null): UsageSummaryEntry[] {
  return (snapshot?.providers ?? []).map((provider) => {
    const quota = sessionQuota(provider)
    return {
      health: quota?.health ?? 'unknown',
      label: provider.label,
      value: quota ? formatPercent(quota.percentRemaining) : '—',
    }
  })
}

// Where the bar would sit if the window were being spent evenly: the share of it still to run. On a
// bar that shows what is left, that is the time left over the window, no arithmetic in between. The
// fill above the mark means there is room to spare, below it means the plan runs out early.
//
// A reset further out than the whole window says the window is not the one acorn assumed — Codex
// labels a row "Session (5h)" and then reports it resetting in four days — and a mark pinned to the
// right end would read as "miles ahead" when the truth is that we do not know. No mark instead.
export function quotaPace(quota: AgentUsageQuota, now = Date.now()): number | null {
  if (quota.resetsAt == null || quota.windowSeconds == null || quota.windowSeconds <= 0) return null
  const share = (quota.resetsAt - now) / (quota.windowSeconds * 1_000)
  return share > 1 ? null : Math.max(0, share)
}

export function providerUsageRows(provider: AgentProviderUsage, now = Date.now()): UsageDetailRow[] {
  const rows: UsageDetailRow[] = provider.quotas.map((quota) => {
    const reset = formatReset(quota.resetsAt, quota.resetText, now)
    return {
      label: quota.label,
      value: `${formatPercent(quota.percentRemaining)} remaining${reset ? ` · ${reset}` : ''}`,
      meter: {
        fill: clampRemaining(quota.percentRemaining) / 100,
        pace: quotaPace(quota, now),
        health: quota.health,
      },
    }
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
      value: daily.estimatedCostUsd == null ? 'No price for this model' : formatEstimateUsd(daily.estimatedCostUsd),
    })
    if (daily.unpricedModels.length > 0) {
      rows.push({ label: 'Unpriced models', value: daily.unpricedModels.join(', ') })
    }
    rows.push({ label: 'Tokens today', value: formatTokens(daily.totalNonCacheTokens) })
    rows.push({ label: 'Input / output', value: `${formatTokens(daily.inputTokens)} / ${formatTokens(daily.outputTokens)}` })
    if (daily.cacheWriteTokens || daily.cacheReadTokens) {
      rows.push({ label: 'Cache write / read', value: `${formatTokens(daily.cacheWriteTokens)} / ${formatTokens(daily.cacheReadTokens)}` })
    }
    rows.push({ label: 'Working time', value: formatDuration(daily.workingSeconds) })
    rows.push({ label: 'Sessions', value: String(daily.sessionCount) })
    if (daily.estimatedCacheSavingsUsd != null && daily.estimatedCacheSavingsUsd > 0) {
      rows.push({ label: 'Saved by caching (estimate)', value: formatEstimateUsd(daily.estimatedCacheSavingsUsd) })
    }
  }
  return rows
}
