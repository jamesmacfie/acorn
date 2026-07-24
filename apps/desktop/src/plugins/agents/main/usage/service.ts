import { mkdir } from 'node:fs/promises'
import type {
  AgentProviderUsage,
  AgentUsageError,
  AgentUsageProviderId,
  AgentUsageSnapshot,
} from '../../shared/usage'
import { emptyProviderUsage } from '../../shared/usage'
import { collectClaudeUsage } from './claudeUsage'
import { collectCodexUsage } from './codexUsage'
import { UsageProcessError } from './processRunner'

const DEFAULT_TTL_MS = 5 * 60_000

type Collector = () => Promise<AgentProviderUsage>

export type AgentUsageServiceOptions = {
  probeDir: string
  ttlMs?: number
  now?: () => number
  claude?: Collector
  codex?: Collector
}

export type AgentUsageService = {
  read(options?: { force?: boolean }): Promise<AgentUsageSnapshot>
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
  const collectors: Record<AgentUsageProviderId, Collector> = {
    claude: options.claude ?? (() => collectClaudeUsage({ probeDir: options.probeDir, now })),
    codex: options.codex ?? (() => collectCodexUsage({ cwd: options.probeDir, now })),
  }
  const lastSuccess = new Map<AgentUsageProviderId, AgentProviderUsage>()
  let cached: AgentUsageSnapshot | null = null
  let inFlight: Promise<AgentUsageSnapshot> | null = null

  const refresh = async (): Promise<AgentUsageSnapshot> => {
    await mkdir(options.probeDir, { recursive: true })
    const providerIds: AgentUsageProviderId[] = ['claude', 'codex']
    const settled = await Promise.allSettled(providerIds.map((provider) => collectors[provider]()))
    const providers = settled.map((result, index) => {
      const provider = providerIds[index]
      if (result.status === 'fulfilled') {
        lastSuccess.set(provider, result.value)
        return result.value
      }
      return failedProvider(provider, result.reason, lastSuccess.get(provider))
    })
    cached = { providers, refreshedAt: now() }
    return cached
  }

  return {
    read({ force = false } = {}) {
      if (inFlight) return inFlight
      if (!force && cached && now() - cached.refreshedAt < ttlMs) return Promise.resolve(cached)
      inFlight = refresh().finally(() => {
        inFlight = null
      })
      return inFlight
    },
  }
}
