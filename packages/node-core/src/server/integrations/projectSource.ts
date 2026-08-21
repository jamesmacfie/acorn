// Runs a provider's declared project source for core's own workspace-project picker; see
// docs/integrations.md § Project sources and § Provider boundaries for the credential handling and
// caching rules this follows.
import type { ProviderErrorCode } from '@acorn/protocol/integrations.ts'
import { eq } from 'drizzle-orm'
import type { AppDatabase } from '../db'
import { schema } from '../db'
import { SecretUnavailableError, type SecretService } from '../../main/core/secrets'
import type { RouteFailure, RouteResult } from '../sync/engine'
import { providerRequestScheduler } from './budgetRuntime'
import { connectionProviderRegistry } from './connectionRegistry'
import { getConnection } from './connections'
import { ProviderOperationError, type ProviderProject } from './types'

const failure = (error: ProviderErrorCode, status: RouteFailure['status']): RouteResult<never> => ({
  ok: false,
  failure: { error, status },
})

// Bounds a provider's claimed project list before any of it becomes a `workspace_external_projects`
// row; see docs/integrations.md § Project sources for the limits and why they match the
// workspace-mapping write's own Zod bounds.
export const PROVIDER_PROJECT_LIMITS = { maxProjects: 500, maxIdBytes: 200, maxLabelBytes: 200 } as const

/**
/**
 * A provider's claimed project list, bounded to what core will store and show; see
 * docs/integrations.md § Project sources for why an over-long or empty id is dropped rather than
 * truncated.
 *
 * A label is display-only, so it is truncated rather than dropped, and falls back to the id when the
 * provider gives nothing usable.
 */
export function boundProviderProjects(raw: unknown): ProviderProject[] {
  if (!Array.isArray(raw)) return []
  const out: ProviderProject[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    if (out.length >= PROVIDER_PROJECT_LIMITS.maxProjects) break
    if (!entry || typeof entry !== 'object') continue
    const { id, label } = entry as { id?: unknown; label?: unknown }
    if (typeof id !== 'string') continue
    const trimmedId = id.trim()
    if (!trimmedId || trimmedId.length > PROVIDER_PROJECT_LIMITS.maxIdBytes) continue
    // Two rows with one id would render as two identical checkboxes writing the same primary key.
    if (seen.has(trimmedId)) continue
    seen.add(trimmedId)
    const text = typeof label === 'string' ? label.trim() : ''
    out.push({ id: trimmedId, label: (text || trimmedId).slice(0, PROVIDER_PROJECT_LIMITS.maxLabelBytes) })
  }
  return out
}

/**
/**
 * The projects one connection offers, or a typed failure for that connection; see
 * docs/integrations.md § Project sources for why this runs per connection rather than per provider.
 */
export async function listConnectionProjects(args: {
  db: AppDatabase
  userId: string
  secrets: SecretService
  connectionId: string
}): Promise<RouteResult<ProviderProject[]>> {
  const connection = await getConnection(args.db, args.userId, args.connectionId)
  if (!connection) return failure('provider_not_connected', 403)

  const provider = connectionProviderRegistry.get(connection.provider)
  const source = provider?.projects
  // Reaching here without a source means the client asked about a connection whose provider never
  // offered projects. The descriptor it filtered on said otherwise, so the roster moved under it (a
  // plugin disabled mid-session), a misconfiguration rather than something the owner did.
  if (!provider || !source) return failure('provider_bad_config', 502)

  // Same rule as the mirrored-resource path: a connection awaiting re-auth or turned off must not
  // generate outbound work. Unlike that path there is no cache to fall back to, so this is the answer.
  if (connection.status === 'needs-auth') return failure('provider_needs_auth', 401)
  if (connection.status === 'disabled') return failure('provider_not_connected', 403)

  try {
    const claimed = await args.secrets.use(
      connection.authRef,
      `${connection.provider}: list projects`,
      (secret) => providerRequestScheduler.run(provider.id, connection.id, provider.budgets, () =>
        source.list({ connection, secret })),
    )
    return { ok: true, value: boundProviderProjects(claimed) }
  } catch (error) {
    if (error instanceof SecretUnavailableError) {
      // The credential is gone or unreadable, which is the definition of needs-auth. Recorded so
      // Settings → Integrations says so too, rather than only this picker knowing.
      await args.db
        .update(schema.integrations)
        .set({ status: 'needs-auth', lastError: 'provider_secret_unreadable', updatedAt: Date.now() })
        .where(eq(schema.integrations.id, connection.id))
      return failure('provider_secret_unreadable', 401)
    }
    // 400 does not survive as a client status: a provider rejecting its own request is this node's
    // configuration problem, and the owner did not send a bad request by opening a picker.
    if (error instanceof ProviderOperationError) {
      return failure(error.code, error.status === 400 ? 502 : error.status)
    }
    return failure('provider_unavailable', 502)
  }
}
