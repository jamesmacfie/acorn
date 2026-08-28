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
  // (main/usage/collectors.ts), so resolving the list at construction would freeze the boot-time set.
  collectors?: AgentUsageCollectorRegistry
  /** A fresh snapshot landed; a consumer re-reads the route rather than running its own poll. */
  onRefreshed?: () => void
}

export type AgentUsageService = {
  read(options: { userId: string; force?: boolean }): Promise<AgentUsageSnapshot>
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
  let inFlight: { key: string; promise: Promise<AgentUsageSnapshot> } | null = null

  const refresh = async (
    pricing: AgentPricingPreferences,
    key: string,
  ): Promise<AgentUsageSnapshot> => {
    if (activeKey !== key) {
      lastSuccess.clear()
      activeKey = key
    }
    await mkdir(options.probeDir, { recursive: true })
    const entries = collectors.entries()
    const settled = await Promise.allSettled(entries.map((entry) => entry.collect(pricing)))
    const providers = settled.map((result, index) => {
      const entry = entries[index]
      if (result.status === 'fulfilled') {
        const usage = named(entry, result.value)
        lastSuccess.set(entry.provider, usage)
        return usage
      }
      return failedProvider(entry, result.reason, lastSuccess.get(entry.provider))
    })
    const snapshot = { providers, refreshedAt: now() }
    cached = { key, snapshot }
    options.onRefreshed?.()
    return snapshot
  }

  const read: AgentUsageService['read'] = async ({ userId, force = false }) => {
    const pricing = await pricingForUser(userId)
    const key = `${userId}\u0000${agentPricingFingerprint(pricing)}`
    if (inFlight) {
      if (inFlight.key === key) return inFlight.promise
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
    inFlight = { key, promise }
    return promise
  }
  return { read }
}
