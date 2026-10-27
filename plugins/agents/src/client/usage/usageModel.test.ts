import { describe, expect, it } from 'vitest'
import type { AgentProviderUsage, AgentUsageQuota, AgentUsageSnapshot } from '../../shared/usage'
import { usageHealth } from '../../shared/usage'
import {
  compactQuotas,
  dailySummary,
  dailyUsageRows,
  formatEstimateUsd,
  formatReset,
  formatTokens,
  planName,
  providerMetaLine,
  providerUsageRows,
  quotaPace,
  usageGroups,
  usageSummaryEntries,
  usageAccountLabel,
} from './usageModel'

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
      windowSeconds: null,
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

  // The order is the node's, which is the collector registration order. Reordering here would have to
  // know the whole harness set, which the client does not.
  it('summarizes every harness the node reported, in the order it reported them', () => {
    const snapshot: AgentUsageSnapshot = { providers: [provider('codex', 34), provider('claude', 82)], refreshedAt: 1 }
    expect(usageSummaryEntries(snapshot)).toEqual([
      {
        health: 'warning',
        label: 'Codex',
        provider: 'codex',
        harness: 'Codex',
        account: null,
        value: '34%',
        timeLeft: null,
        timeLeftLabel: 'Codex Session',
      },
      {
        health: 'healthy',
        label: 'Claude Code',
        provider: 'claude',
        harness: 'Claude Code',
        account: null,
        value: '82%',
        timeLeft: null,
        timeLeftLabel: 'Claude Code Session',
      },
    ])
  })

  it('names no harness it was not told about', () => {
    expect(usageSummaryEntries(null)).toEqual([])
    expect(usageSummaryEntries({ providers: [], refreshedAt: 1 })).toEqual([])
    expect(usageSummaryEntries({ providers: [provider('codex', 0)], refreshedAt: 1 })).toEqual([
      {
        health: 'depleted',
        label: 'Codex',
        provider: 'codex',
        harness: 'Codex',
        account: null,
        value: '0%',
        timeLeft: null,
        timeLeftLabel: 'Codex Session',
      },
    ])
  })

  describe('the time-left pie', () => {
    const now = 1_700_000_000_000
    const hour = 3_600_000
    const window = (id: string, label: string, hoursLeft: number, windowHours: number): AgentUsageQuota => ({
      id,
      label,
      percentRemaining: 60,
      resetsAt: now + hoursLeft * hour,
      resetText: null,
      windowSeconds: windowHours * 3_600,
      health: 'healthy',
    })
    const entry = (quotas: AgentUsageQuota[]) =>
      usageSummaryEntries({ providers: [{ ...provider('codex', 60), quotas }], refreshedAt: 1 }, {}, now)[0]!

    it('reads the five-hour session when there is one', () => {
      const summary = entry([window('session', 'Session (5h)', 2.5, 5), window('weekly', 'Weekly', 24, 168)])
      expect(summary.timeLeft).toBeCloseTo(0.5)
      expect(summary.timeLeftLabel).toBe('Codex Session (5h), resets in 2h 30m')
    })

    it('reads the week on a plan with no session limit, percentage and all', () => {
      const summary = entry([{ ...window('weekly', 'Weekly', 42, 168), percentRemaining: 75 }])
      expect(summary.value).toBe('75%')
      expect(summary.timeLeft).toBeCloseTo(0.25)
    })

    it('draws nothing when the window is unknown', () => {
      expect(entry([{ ...window('session', 'Session', 1, 5), windowSeconds: null }]).timeLeft).toBeNull()
    })
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
    expect(providerUsageRows(claude).map((row) => row.label)).toEqual(['Session', 'Extra usage'])
    expect(dailyUsageRows(claude).map((row) => row.label)).toEqual([
      'Estimated today',
      'Tokens today',
      'Input / output',
      'Cache write / read',
      'Working time',
      'Sessions',
      'Saved by caching (estimate)',
    ])
    expect(dailyUsageRows(claude).find((row) => row.label === 'Estimated today')?.value).toBe('<$1')
    expect(dailySummary(claude)).toBe('Today <$1 · 1,540 tokens · 2 sessions')
  })

  it('has no daily summary or rows without figures for today', () => {
    expect(dailySummary(provider('claude', 82))).toBeNull()
    expect(dailyUsageRows(provider('claude', 82))).toEqual([])
  })

  it('writes an estimate in whole dollars with a separator', () => {
    expect(formatEstimateUsd(1918.12)).toBe('≈$1,918')
    expect(formatEstimateUsd(0.42)).toBe('<$1')
  })

  it('names known plan ids and keeps a name the provider already wrote', () => {
    expect(planName('prolite')).toBe('Pro Lite')
    expect(planName('team')).toBe('Team')
    expect(planName('Claude Max')).toBe('Claude Max')
    expect(planName('enterprise')).toBe('Enterprise')
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

  describe('the small bars on a closed account row', () => {
    const quota = (id: string, label: string, percentRemaining: number): AgentUsageQuota => ({
      id,
      label,
      percentRemaining,
      resetsAt: null,
      resetText: null,
      windowSeconds: null,
      health: usageHealth(percentRemaining),
    })
    const bars = (quotas: AgentUsageQuota[]) =>
      compactQuotas({ ...provider('claude', 50), quotas }).map((bar) => `${bar.label} ${bar.value}`)

    it('reads the session and the week, in that order, whatever else the harness reports', () => {
      const claude = [quota('weekly', 'Weekly', 64), quota('session', 'Session', 12), quota('opus', 'Opus weekly', 90)]
      expect(bars(claude)).toEqual(['5h 12%', 'week 64%'])
      expect(compactQuotas({ ...provider('claude', 50), quotas: claude })[0]).toEqual({
        label: '5h',
        value: '12%',
        fill: 0.12,
        health: 'critical',
      })
    })

    it('reads only the week on a plan with no session limit', () => {
      expect(bars([quota('weekly', 'Weekly', 75)])).toEqual(['week 75%'])
    })

    it("falls back to a contributed harness's first two windows under their own names", () => {
      expect(
        bars([quota('daily', 'Daily', 40), quota('monthly', 'Monthly', 90), quota('yearly', 'Yearly', 99)]),
      ).toEqual(['Daily 40%', 'Monthly 90%'])
    })

    it('draws none for a reading with no quotas', () => {
      expect(bars([])).toEqual([])
    })
  })

  describe('the pace mark under a quota bar', () => {
    const quota = (over: Partial<AgentUsageQuota>): AgentUsageQuota => ({
      id: 'session',
      label: 'Session',
      percentRemaining: 50,
      resetsAt: null,
      resetText: null,
      windowSeconds: 5 * 60 * 60,
      health: 'healthy',
      ...over,
    })
    const now = 1_700_000_000_000
    const hour = 3_600_000

    it('is the share of the window still to run', () => {
      // Four of the five hours left, so a steady spend would still have 80% of the plan.
      expect(quotaPace(quota({ resetsAt: now + 4 * hour }), now)).toBeCloseTo(0.8)
      expect(quotaPace(quota({ resetsAt: now + hour }), now)).toBeCloseTo(0.2)
    })

    it('has nothing to say without both a reset time and a window', () => {
      expect(quotaPace(quota({ resetsAt: null }), now)).toBeNull()
      expect(quotaPace(quota({ resetsAt: now + hour, windowSeconds: null }), now)).toBeNull()
    })

    it('sits at the end of a window that has run out', () => {
      expect(quotaPace(quota({ resetsAt: now - hour }), now)).toBe(0)
    })

    it('gives up when the reset is further out than the whole window', () => {
      expect(quotaPace(quota({ resetsAt: now + 9 * hour }), now)).toBeNull()
    })

    it('rides along on every quota row', () => {
      const claude = provider('claude', 30)
      claude.quotas[0] = quota({ percentRemaining: 30, resetsAt: now + hour, health: 'warning' })
      expect(providerUsageRows(claude, now)[0].meter).toEqual({ fill: 0.3, pace: 0.2, health: 'warning' })
    })
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
    expect(dailyUsageRows(claude)).toEqual(
      expect.arrayContaining([
        { label: 'Estimated today', value: 'No price for this model' },
        { label: 'Unpriced models', value: 'claude-new-model' },
      ]),
    )
  })
})

describe('usage groups', () => {
  it('leaves out a login whose CLI is missing or signed out', () => {
    const work = {
      ...provider('claude', 30),
      label: 'Claude Code · work',
      accountName: 'work',
      error: { code: 'authentication_required' as const, message: 'Not logged in.' },
    }
    const codex = { ...provider('codex', 50), error: { code: 'cli_missing' as const, message: 'Not found.' } }
    const groups = usageGroups({ providers: [provider('claude', 80), work, codex], refreshedAt: 1 })
    expect(groups.map((group) => [group.label, group.readings.map(usageAccountLabel)])).toEqual([
      ['Claude Code', ['Usual sign-in']],
    ])
  })

  it('names the harness without favoring an account when only named accounts are collected', () => {
    const personal = { ...provider('claude', 80), label: 'Claude Code · personal', accountName: 'personal' }
    const work = { ...provider('claude', 30), label: 'Claude Code · work', accountName: 'work' }
    const groups = usageGroups({ providers: [personal, work], refreshedAt: 1 })
    expect(groups[0]?.label).toBe('Claude Code')
    expect(groups[0]?.readings.map(usageAccountLabel)).toEqual(['personal', 'work'])
  })

  it("puts a harness's accounts under its own name, default first, in the node's order", () => {
    const work = { ...provider('claude', 30), label: 'Claude Code · work', accountName: 'work' }
    const groups = usageGroups({ providers: [provider('claude', 80), work, provider('codex', 50)], refreshedAt: 1 })
    expect(groups.map((group) => [group.label, group.readings.map(usageAccountLabel)])).toEqual([
      ['Claude Code', ['Usual sign-in', 'work']],
      ['Codex', ['Usual sign-in']],
    ])
  })

  it('sums up a harness with accounts as the account new sessions start on', () => {
    const work = { ...provider('claude', 30), label: 'Claude Code · work', accountName: 'work' }
    const snapshot = { providers: [provider('claude', 80), work, provider('codex', 50)], refreshedAt: 1 }
    expect(usageSummaryEntries(snapshot).map((entry) => `${entry.label} ${entry.value}`)).toEqual([
      'Claude Code 80%',
      'Codex 50%',
    ])
    expect(usageSummaryEntries(snapshot, { claude: 'work' }).map((entry) => `${entry.label} ${entry.value}`)).toEqual([
      'Claude Code · work 30%',
      'Codex 50%',
    ])
  })
})
