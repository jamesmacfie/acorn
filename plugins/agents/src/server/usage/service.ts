import { mkdir } from 'node:fs/promises'
import type { PluginTelemetry } from '@acorn/plugin-api/node'
import type {
  AgentProviderUsage,
  AgentProviderUsageReading,
  AgentUsageError,
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
  // Read per refresh, never captured. Harnesses arrive and leave with the plugins that contribute them,
  // so resolving the list at construction would freeze the boot-time set.
  collectors?: AgentUsageCollectorRegistry
  /** A fresh snapshot landed; a consumer re-reads the route rather than running its own poll. */
  onRefreshed?: () => void
  /** A harness's extra logins, read per refresh like the collectors (docs/managed-agents/accounts.md). */
  accounts?: (providerId: string) => Promise<UsageAccount[]>
  /** `ctx.telemetry`, so each collector run and each wait on another read's refresh is a span. */
  telemetry?: Pick<PluginTelemetry, 'startSpan'>
}

type UsageAccount = { name: string; home: string; label?: string }

export type AgentUsageService = {
  read(options: { userId: string; force?: boolean }): Promise<AgentUsageSnapshot>
  refreshProvider(options: { userId: string; providerId: string }): Promise<AgentUsageSnapshot | null>
  /** Freshly confirm that every depleted quota for one harness has a known future reset, then return
   *  the latest of those resets. `null` means the runtime cannot schedule safely. */
  depletedUntil(options: { userId: string; providerId: string; account?: string | null }): Promise<number | null>
}

function normalizeError(error: unknown): AgentUsageError {
  if (error instanceof UsageProcessError) return { code: error.code, message: error.message }
  return {
    code: 'execution_failure',
    message: error instanceof Error ? error.message : 'Provider usage could not be read.',
  }
}

// One row of the snapshot: a harness's default login, or one of its extra accounts.
type UsageTarget = { entry: AgentUsageCollectorEntry; account: UsageAccount | null }

const rowKey = (provider: string, accountName: string | null | undefined): string =>
  accountName ? `${provider}\u0000${accountName}` : provider

const targetKey = (target: UsageTarget): string => rowKey(target.entry.provider, target.account?.name)

function failedProvider(
  target: UsageTarget,
  error: unknown,
  lastSuccess: AgentProviderUsage | undefined,
): AgentProviderUsage {
  const normalized = normalizeError(error)
  if (lastSuccess) return { ...lastSuccess, stale: true, error: normalized }
  return named(
    target,
    emptyProviderUsage(
      target.entry.provider,
      target.entry.label,
      normalized.code === 'cli_missing' ? 'missing' : 'error',
      normalized,
    ),
  )
}

// The collector answers about usage, the registration owns the naming. Stamped here so a collector
// never repeats its own id and label, and the two cannot disagree.
const named = ({ entry, account }: UsageTarget, usage: AgentProviderUsageReading): AgentProviderUsage => ({
  ...usage,
  provider: entry.provider,
  label: account ? `${entry.label} · ${account.label ?? account.name}` : entry.label,
  ...(entry.glyph ? { glyph: entry.glyph } : {}),
  ...(account ? { accountName: account.name } : {}),
  ...(account?.label ? { accountLabel: account.label } : {}),
})

export function createAgentUsageService(options: AgentUsageServiceOptions): AgentUsageService {
  const now = options.now ?? Date.now
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
  const pricingForUser = options.pricingForUser ?? (async () => emptyAgentPricingPreferences())
  const collectors = options.collectors ?? agentUsageCollectors
  const accountsOf = async (entry: AgentUsageCollectorEntry): Promise<UsageAccount[]> =>
    entry.accounts && options.accounts ? options.accounts(entry.provider) : []
  // A harness with accounts is read as those accounts only. Its CLI's own login starts no new session
  // then (`AgentAccounts.defaultAccount`), so its quota answers nothing the person asked.
  const targetsOf = async (entries: AgentUsageCollectorEntry[]): Promise<UsageTarget[]> =>
    (
      await Promise.all(
        entries.map(async (entry) => {
          const accounts = await accountsOf(entry)
          return accounts.length ? accounts.map((account) => ({ entry, account })) : [{ entry, account: null }]
        }),
      )
    ).flat()
  // One span per collector run. The account is the folder name the person chose, such as `work`,
  // never the login inside it (docs/telemetry/model.md § What never leaves the machine).
  const collect = (
    entry: AgentUsageCollectorEntry,
    pricing: AgentPricingPreferences,
    account: UsageAccount | null | undefined,
  ): Promise<AgentProviderUsageReading> => {
    const span = options.telemetry?.startSpan('agents.usage.collect', {
      attrs: { provider: entry.provider, ...(account ? { account: account.name } : {}) },
    })
    const reading = entry.collect(pricing, account?.home)
    if (!span) return reading
    return reading.then(
      (usage) => {
        span.end('ok', { outcome: 'ok' })
        return usage
      },
      (error: unknown) => {
        span.end('error', { outcome: normalizeError(error).code })
        throw error
      },
    )
  }
  // A read that waits on another read's refresh. Its own span, so a chain of waits shows as one
  // under the request that sat in it.
  const joined = (wait: Promise<AgentUsageSnapshot>): Promise<AgentUsageSnapshot> => {
    const span = options.telemetry?.startSpan('agents.usage.wait')
    return span ? wait.finally(() => span.end()) : wait
  }
  const lastSuccess = new Map<string, AgentProviderUsage>()
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
    const targets = await targetsOf(collectors.entries())
    const previous =
      cached?.key === key
        ? new Map(cached.snapshot.providers.map((item) => [rowKey(item.provider, item.accountName), item]))
        : null
    // A cold cache or a changed registry needs one complete snapshot before individual rows can be
    // replaced. Otherwise a manual refresh could silently hide a newly registered harness or account.
    const partial =
      providerId !== null && previous?.has(providerId) && targets.every((target) => previous.has(targetKey(target)))
    // A harness's refresh reads all of its accounts, so its rows stay comparable.
    const selected = partial ? targets.filter((target) => target.entry.provider === providerId) : targets
    const settled = await Promise.allSettled(selected.map((target) => collect(target.entry, pricing, target.account)))
    const updated = new Map(
      selected.map((target, index) => {
        const result = settled[index]
        const id = targetKey(target)
        if (result.status === 'fulfilled') {
          const usage = named(target, result.value)
          lastSuccess.set(id, usage)
          return [id, usage] as const
        }
        return [id, failedProvider(target, result.reason, lastSuccess.get(id))] as const
      }),
    )
    const providers = targets.flatMap((target) => {
      const item = updated.get(targetKey(target)) ?? previous?.get(targetKey(target))
      return item ? [item] : []
    })
    // The TTL belongs to the complete probe. Refreshing Claude must not postpone the next Codex
    // check, even though the returned snapshot contains the newer Claude row.
    const snapshot = { providers, refreshedAt: partial ? cached!.snapshot.refreshedAt : now() }
    cached = { key, snapshot }
    options.onRefreshed?.()
    return snapshot
  }

  const startRefresh = (pricing: AgentPricingPreferences, key: string, providerId: string | null) => {
    const promise = refresh(pricing, key, providerId).finally(() => {
      if (inFlight?.promise === promise) inFlight = null
    })
    inFlight = { key, providerId, promise }
    return promise
  }

  const read: AgentUsageService['read'] = async ({ userId, force = false }) => {
    const pricing = await pricingForUser(userId)
    const key = `${userId}\u0000${agentPricingFingerprint(pricing)}`
    // A snapshot past its TTL still answers at once. The refresh behind it raises `onRefreshed`, and the
    // client reads again then. Only a read with nothing to show waits for a probe.
    if (!force && cached?.key === key) {
      if (!inFlight && now() - cached.snapshot.refreshedAt >= ttlMs)
        void startRefresh(pricing, key, null).catch(() => {})
      return cached.snapshot
    }
    if (inFlight) {
      if (inFlight.key === key && (!force || inFlight.providerId === null)) return joined(inFlight.promise)
      await joined(inFlight.promise)
      return read({ userId, force })
    }
    return startRefresh(pricing, key, null)
  }

  const refreshProvider: AgentUsageService['refreshProvider'] = async ({ userId, providerId }) => {
    if (!collectors.get(providerId)) return null
    const pricing = await pricingForUser(userId)
    const key = `${userId}\u0000${agentPricingFingerprint(pricing)}`
    if (inFlight) {
      if (inFlight.key === key && (inFlight.providerId === null || inFlight.providerId === providerId)) {
        return joined(inFlight.promise)
      }
      await joined(inFlight.promise)
      return refreshProvider({ userId, providerId })
    }
    return startRefresh(pricing, key, providerId)
  }

  const depletedUntil: AgentUsageService['depletedUntil'] = async ({ userId, providerId, account = null }) => {
    const entry = collectors.get(providerId)
    if (!entry) return null
    // The quota of the login that ran out. An account the collector can't read has no known reset.
    const found = account ? (await accountsOf(entry)).find((candidate) => candidate.name === account) : undefined
    if (account && !found) return null
    const pricing = await pricingForUser(userId)
    let usage: AgentProviderUsageReading
    try {
      await mkdir(options.probeDir, { recursive: true })
      usage = await collect(entry, pricing, found)
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
