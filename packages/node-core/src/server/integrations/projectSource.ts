// Running a provider's declared project source (integrations/types.ts § ProviderProjectSource), for
// core's own workspace↔external-project picker.
//
// The credential handling here is deliberately the same shape as resourceRuntime.ts's: the provider
// call happens INSIDE `secrets.use`, so a provider that echoes its token back in an error body gets it
// scrubbed at the one boundary that sees both, and inside the request scheduler, so a picker opening
// over four connections cannot outrun the provider's declared concurrency.
//
// What it does NOT reuse is the mirror. A project list is not an external item and has no business in
// core's `issues` table, so there is no cache here: the picker asks the provider, every time. That is
// what the deleted Linear picker did by hand (`projects.refetch()` past a disabled query) for the
// reason that matters — a picker's empty state is a claim about the provider NOW, and serving it from
// a five-minute cache tells the user "you have no projects" when they have just created one.
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

// The host binds every namespace, and a provider's project list is plugin-supplied data on its way
// into core state — one of these ids becomes a `workspace_external_projects` row the moment the owner
// ticks it. So the same bounding the PUT body gets from Zod is applied to the list as well, before it
// is even offered for selection. Generous enough that no honest provider notices.
export const PROVIDER_PROJECT_LIMITS = { maxProjects: 500, maxIdBytes: 200, maxLabelBytes: 200 } as const

/**
 * A provider's claimed project list, reduced to what core is willing to store and show.
 *
 * An over-long or empty `id` DROPS the entry rather than being truncated: a truncated id is a
 * different project, and silently mapping a workspace to one the owner did not pick is worse than
 * omitting a row. A label is display-only, so it is truncated, and falls back to the id when the
 * provider gives nothing usable — a checkbox with no text beside it is not a choice.
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
 * The projects one connection offers, or a typed failure for THAT connection. Per connection rather
 * than per provider on purpose: the picker shows a row per connection and one connection failing must
 * not erase a sibling's list, which is far easier to honour when the failure never leaves the
 * connection it belongs to.
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
  // offered projects — the descriptor it filtered on said otherwise, so the roster moved under it (a
  // plugin disabled mid-session). A misconfiguration, not something the owner did.
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
