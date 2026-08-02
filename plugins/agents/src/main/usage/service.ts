import { mkdir } from 'node:fs/promises'
import type {
  AgentProviderUsage,
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
import { collectClaudeUsage } from './claudeUsage'
import { collectCodexUsage } from './codexUsage'
import { UsageProcessError } from './processRunner'

const DEFAULT_TTL_MS = 5 * 60_000

type Collector = (pricing: AgentPricingPreferences) => Promise<AgentProviderUsage>
type PricingReader = (userId: string) => Promise<AgentPricingPreferences>

export type AgentUsageServiceOptions = {
  probeDir: string
  ttlMs?: number
  now?: () => number
  pricingForUser?: PricingReader
  claude?: Collector
  codex?: Collector
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
  provider: AgentUsageProviderId,
  error: unknown,
  lastSuccess: AgentProviderUsage | undefined,
): AgentProviderUsage {
  const normalized = normalizeError(error)
  if (lastSuccess) return { ...lastSuccess, stale: true, error: normalized }
  return emptyProviderUsage(provider, normalized.code === 'cli_missing' ? 'missing' : 'error', normalized)
}

export function createAgentUsageService(options: AgentUsageServiceOptions): AgentUsageService {
  const now = options.now ?? Date.now
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
  const pricingForUser = options.pricingForUser ?? (async () => emptyAgentPricingPreferences())
  const collectors: Record<AgentUsageProviderId, Collector> = {
    claude: options.claude ?? ((pricing) => collectClaudeUsage({ probeDir: options.probeDir, now, pricing })),
    codex: options.codex ?? (() => collectCodexUsage({ cwd: options.probeDir, now })),
  }
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
    const providerIds: AgentUsageProviderId[] = ['claude', 'codex']
    const settled = await Promise.allSettled(providerIds.map((provider) => collectors[provider](pricing)))
    const providers = settled.map((result, index) => {
      const provider = providerIds[index]
      if (result.status === 'fulfilled') {
        lastSuccess.set(provider, result.value)
        return result.value
      }
      return failedProvider(provider, result.reason, lastSuccess.get(provider))
    })
    const snapshot = { providers, refreshedAt: now() }
    cached = { key, snapshot }
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
