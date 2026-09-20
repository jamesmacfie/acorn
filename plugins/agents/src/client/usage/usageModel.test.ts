import { describe, expect, it } from 'vitest'
import type { AgentProviderUsage, AgentUsageSnapshot } from '../../shared/usage'
import { usageHealth } from '../../shared/usage'
import { formatReset, formatTokens, providerMetaLine, providerUsageRows, usageSummaryEntries } from './usageModel'

const provider = (id: 'claude' | 'codex', percent: number): AgentProviderUsage => ({
  provider: id,
  label: id === 'claude' ? 'Claude Code' : 'Codex',
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

  // The order is the node's, which is the collector registration order (server/usage/collectors.ts).
  // Reordering here would have to know the whole harness set, which is the thing that is now open.
  it('summarizes every harness the node reported, in the order it reported them', () => {
    const snapshot: AgentUsageSnapshot = { providers: [provider('codex', 34), provider('claude', 82)], refreshedAt: 1 }
    expect(usageSummaryEntries(snapshot)).toEqual([
      { health: 'warning', label: 'Codex', value: '34%' },
      { health: 'healthy', label: 'Claude Code', value: '82%' },
    ])
  })

  it('names no harness it was not told about', () => {
    expect(usageSummaryEntries(null)).toEqual([])
    expect(usageSummaryEntries({ providers: [], refreshedAt: 1 })).toEqual([])
    expect(usageSummaryEntries({ providers: [provider('codex', 0)], refreshedAt: 1 })).toEqual([
      { health: 'depleted', label: 'Codex', value: '0%' },
    ])
  })
})

describe('agent usage detail formatting', () => {
  it('prefers a live reset countdown but preserves provider text without a timestamp', () => {
    expect(formatReset(1_000 + 135 * 60_000, null, 1_000)).toBe('resets in 2h 15m')
    expect(formatReset(null, 'Resets Friday', 1_000)).toBe('resets Friday')
    expect(formatReset(null, 'Resets Jul 31 at 12am (Pacific/Auckland)', 1_000)).toBe('resets Jul 31 at 12am')
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
          unpricedModels: [],
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

  it('keeps a decimal on every compacted token count', () => {
    // "1M" beside "132.4M" read as a rounder number than it was.
    expect([7_890, 1_038_000, 132_400_000].map(formatTokens)).toEqual(['7,890', '1.0M', '132.4M'])
  })

  it('says who and when in one line, without repeating the harness name', () => {
    const claude: AgentProviderUsage = {
      ...provider('claude', 82),
      plan: 'Claude Max',
      account: { email: 'james@runn.io', organization: 'James' },
      capturedAt: 1_000,
    }
    expect(providerMetaLine(claude, 1_000)).toBe('Claude Max · james@runn.io · James · updated just now')
    expect(providerMetaLine(claude, 1_000)).not.toContain('Claude Code')
  })

  it('names models that prevent a daily estimate', () => {
    const claude: AgentProviderUsage = {
      ...provider('claude', 82),
      daily: {
        skippedFileCount: 0,
        yesterday: null,
        today: {
          day: '2026-07-29',
          inputTokens: 100,
          outputTokens: 20,
          cacheWriteTokens: 0,
          cacheReadTokens: 0,
          totalNonCacheTokens: 120,
          workingSeconds: 10,
          sessionCount: 1,
          estimatedCostUsd: null,
          estimatedCacheSavingsUsd: null,
          pricingFallback: true,
          unpricedModels: ['claude-new-model'],
        },
      },
    }
    expect(providerUsageRows(claude)).toEqual(expect.arrayContaining([
      { label: 'Estimated today', value: 'pricing unavailable' },
      { label: 'Unpriced models', value: 'claude-new-model' },
    ]))
  })
})
