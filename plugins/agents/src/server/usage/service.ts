import { mkdir } from 'node:fs/promises'
import type {
  AgentProviderUsage,
  AgentProviderUsageReading,
  AgentUsageError,
  AgentUsageProviderId,
  AgentUsageSnapshot,
} from '../../shared/usage'
import { emptyProviderUsage } from '../../shared/usage'
import {
  agentPricingFingerprint,
  emptyAgentPricingPreferences,
  type AgentPricingPreferences,
} from '../../shared/pricing'
import { agentUsageCollectors, type AgentUsageCollectorEntry, type AgentUsageCollectorRegistry } from './collectors'
import { UsageProcessError } from './processRunner'

const DEFAULT_TTL_MS = 5 * 60_000

type PricingReader = (userId: string) => Promise<AgentPricingPreferences>

export type AgentUsageServiceOptions = {
  probeDir: string
  ttlMs?: number
  now?: () => number
  pricingForUser?: PricingReader
  // Read per refresh, never captured. Harnesses arrive and leave with the plugins that contribute them
  // (./collectors.ts), so resolving the list at construction would freeze the boot-time set.
  collectors?: AgentUsageCollectorRegistry
  /** A fresh snapshot landed; a consumer re-reads the route rather than running its own poll. */
  onRefreshed?: () => void
}

export type AgentUsageService = {
  read(options: { userId: string; force?: boolean }): Promise<AgentUsageSnapshot>
  refreshProvider(options: { userId: string; providerId: string }): Promise<AgentUsageSnapshot | null>
  /** Freshly confirm that every depleted quota for one harness has a known future reset, then return
   *  the latest of those resets. `null` means the runtime cannot schedule safely. */
  depletedUntil(options: { userId: string; providerId: string }): Promise<number | null>
}

function normalizeError(error: unknown): AgentUsageError {
  if (error instanceof UsageProcessError) return { code: error.code, message: error.message }
  return {
    code: 'execution_failure',
    message: error instanceof Error ? error.message : 'Provider usage could not be read.',
  }
}

function failedProvider(
  entry: AgentUsageCollectorEntry,
  error: unknown,
  lastSuccess: AgentProviderUsage | undefined,
): AgentProviderUsage {
  const normalized = normalizeError(error)
  if (lastSuccess) return { ...lastSuccess, stale: true, error: normalized }
  return emptyProviderUsage(entry.provider, entry.label, normalized.code === 'cli_missing' ? 'missing' : 'error', normalized)
}

// The collector answers about usage, the registration owns the naming. Stamped here so a collector
// never repeats its own id and label, and the two cannot disagree.
const named = (entry: AgentUsageCollectorEntry, usage: AgentProviderUsageReading): AgentProviderUsage => ({
  ...usage,
  provider: entry.provider,
  label: entry.label,
  ...(entry.glyph ? { glyph: entry.glyph } : {}),
})

export function createAgentUsageService(options: AgentUsageServiceOptions): AgentUsageService {
  const now = options.now ?? Date.now
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
  const pricingForUser = options.pricingForUser ?? (async () => emptyAgentPricingPreferences())
  const collectors = options.collectors ?? agentUsageCollectors
  const lastSuccess = new Map<AgentUsageProviderId, AgentProviderUsage>()
  let activeKey: string | null = null
  let cached: { key: string; snapshot: AgentUsageSnapshot } | null = null
  let inFlight: { key: string; providerId: string | null; promise: Promise<AgentUsageSnapshot> } | null = null

  const refresh = async (
    pricing: AgentPricingPreferences,
    key: string,
    providerId: string | null = null,
  ): Promise<AgentUsageSnapshot> => {
    if (activeKey !== key) {
      lastSuccess.clear()
      activeKey = key
    }
    await mkdir(options.probeDir, { recursive: true })
    const entries = collectors.entries()
    const previous = cached?.key === key ? new Map(cached.snapshot.providers.map((item) => [item.provider, item])) : null
    // A cold cache or a changed registry needs one complete snapshot before individual rows can be
    // replaced. Otherwise a manual refresh could silently hide a newly registered harness.
    const partial = providerId !== null && previous?.has(providerId)
      && entries.every((entry) => previous.has(entry.provider))
    const selected = partial ? entries.filter((entry) => entry.provider === providerId) : entries
    const settled = await Promise.allSettled(selected.map((entry) => entry.collect(pricing)))
    const updated = new Map(selected.map((entry, index) => {
      const result = settled[index]
      if (result.status === 'fulfilled') {
        const usage = named(entry, result.value)
        lastSuccess.set(entry.provider, usage)
        return [entry.provider, usage] as const
      }
      return [entry.provider, failedProvider(entry, result.reason, lastSuccess.get(entry.provider))] as const
    }))
    const providers = entries.flatMap((entry) => {
      const item = updated.get(entry.provider) ?? previous?.get(entry.provider)
      return item ? [item] : []
    })
    // The TTL belongs to the complete probe. Refreshing Claude must not postpone the next Codex
    // check, even though the returned snapshot contains the newer Claude row.
    const snapshot = { providers, refreshedAt: partial ? cached!.snapshot.refreshedAt : now() }
    cached = { key, snapshot }
    options.onRefreshed?.()
    return snapshot
  }

  const read: AgentUsageService['read'] = async ({ userId, force = false }) => {
    const pricing = await pricingForUser(userId)
    const key = `${userId}\u0000${agentPricingFingerprint(pricing)}`
    if (inFlight) {
      if (inFlight.key === key && (!force || inFlight.providerId === null)) return inFlight.promise
      await inFlight.promise
      return read({ userId, force })
    }
    if (
      !force
      && cached?.key === key
      && now() - cached.snapshot.refreshedAt < ttlMs
    ) {
      return cached.snapshot
    }
    const promise = refresh(pricing, key).finally(() => {
      if (inFlight?.promise === promise) inFlight = null
    })
    inFlight = { key, providerId: null, promise }
    return promise
  }

  const refreshProvider: AgentUsageService['refreshProvider'] = async ({ userId, providerId }) => {
    if (!collectors.get(providerId)) return null
    const pricing = await pricingForUser(userId)
    const key = `${userId}\u0000${agentPricingFingerprint(pricing)}`
    if (inFlight) {
      if (inFlight.key === key && (inFlight.providerId === null || inFlight.providerId === providerId)) {
        return inFlight.promise
      }
      await inFlight.promise
      return refreshProvider({ userId, providerId })
    }
    const promise = refresh(pricing, key, providerId).finally(() => {
      if (inFlight?.promise === promise) inFlight = null
    })
    inFlight = { key, providerId, promise }
    return promise
  }

  const depletedUntil: AgentUsageService['depletedUntil'] = async ({ userId, providerId }) => {
    const entry = collectors.get(providerId)
    if (!entry) return null
    const pricing = await pricingForUser(userId)
    let usage: AgentProviderUsageReading
    try {
      await mkdir(options.probeDir, { recursive: true })
      usage = await entry.collect(pricing)
    } catch {
      return null
    }
    const depleted = usage.quotas.filter((quota) => quota.health === 'depleted' || quota.percentRemaining <= 0)
    if (!depleted.length || depleted.some((quota) => quota.resetsAt == null)) return null
    const resetAt = Math.max(...depleted.map((quota) => quota.resetsAt!))
    return Number.isFinite(resetAt) && resetAt > now() ? resetAt : null
  }

  return { read, refreshProvider, depletedUntil }
}
