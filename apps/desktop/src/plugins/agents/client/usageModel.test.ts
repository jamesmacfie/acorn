import { describe, expect, it } from 'vitest'
import type { AgentProviderUsage, AgentUsageSnapshot } from '../shared/usage'
import { usageHealth } from '../shared/usage'
import { formatReset, providerUsageRows, usageTooltipSummary } from './usageModel'

const provider = (id: 'claude' | 'codex', percent: number): AgentProviderUsage => ({
  provider: id,
  availability: 'available',
  health: usageHealth(percent),
  plan: null,
  account: null,
  quotas: [
    {
      id: 'session',
      label: 'Session',
      percentRemaining: percent,
      resetsAt: null,
      resetText: null,
      health: usageHealth(percent),
    },
  ],
  cost: null,
  daily: null,
  capturedAt: 1,
  stale: false,
  error: null,
})

describe('agent usage health and tooltip', () => {
  it.each([
    [null, 'unknown'],
    [0, 'depleted'],
    [0.1, 'critical'],
    [19.9, 'critical'],
    [20, 'warning'],
    [49.9, 'warning'],
    [50, 'healthy'],
    [100, 'healthy'],
  ] as const)('%s remaining is %s', (percent, health) => {
    expect(usageHealth(percent)).toBe(health)
  })

  it('orders Claude before Codex regardless of response order', () => {
    const snapshot: AgentUsageSnapshot = { providers: [provider('codex', 34), provider('claude', 82)], refreshedAt: 1 }
    expect(usageTooltipSummary(snapshot)).toBe('🟢 Claude 82% · 🟡 Codex 34%')
  })

  it('uses neutral placeholders for loading or unavailable providers', () => {
    expect(usageTooltipSummary(null)).toBe('⚪ Claude — · ⚪ Codex —')
    expect(usageTooltipSummary({ providers: [provider('codex', 0)], refreshedAt: 1 })).toBe('⚪ Claude — · ⚪ Codex 0%')
  })
})

describe('agent usage detail formatting', () => {
  it('prefers a live reset countdown but preserves provider text without a timestamp', () => {
    expect(formatReset(1_000 + 135 * 60_000, null, 1_000)).toBe('resets in 2h 15m')
    expect(formatReset(null, 'Resets Friday', 1_000)).toBe('resets Friday')
  })

  it('projects quotas, reported cost, and estimated daily data into explicit key/value rows', () => {
    const claude: AgentProviderUsage = {
      ...provider('claude', 82),
      cost: {
        source: 'extra_usage',
        spentUsd: 5.41,
        budgetUsd: 20,
        remainingUsd: 14.59,
        resetsAt: null,
        resetText: null,
        apiDurationSeconds: null,
        estimated: false,
      },
      daily: {
        skippedFileCount: 0,
        yesterday: null,
        today: {
          day: '2026-07-24',
          inputTokens: 1_200,
          outputTokens: 340,
          cacheWriteTokens: 10,
          cacheReadTokens: 20,
          totalNonCacheTokens: 1_540,
          workingSeconds: 3_720,
          sessionCount: 2,
          estimatedCostUsd: 0.42,
          estimatedCacheSavingsUsd: 0.03,
          pricingFallback: false,
        },
      },
    }
    expect(providerUsageRows(claude).map((row) => row.label)).toEqual([
      'Session',
      'Extra usage',
      'Estimated today',
      'Tokens today',
      'Input / output',
      'Cache write / read',
      'Working time',
      'Sessions',
      'Est. cache savings',
    ])
    expect(providerUsageRows(claude).find((row) => row.label === 'Estimated today')?.value).toBe('≈$0.42')
  })
})
