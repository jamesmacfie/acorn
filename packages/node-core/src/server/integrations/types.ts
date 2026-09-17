import type { ContextItem } from '@acorn/protocol/api.ts'
import { PROVIDER_ERROR_CODES } from '@acorn/protocol/integrations.ts'
import type { Hono } from 'hono'
import type {
  CredentialField,
  ExternalRef,
  IntegrationAuthKind,
  IntegrationProviderKind,
  MemoryEvidencePolicy,
  ModelCatalogEntry,
  ProviderAccountRef,
  ProviderBudgets,
  ProviderCapabilities,
  ProviderErrorCode,
  PublicIntegrationProvider,
} from '@acorn/protocol/integrations.ts'
import type { AppEnv } from '../middleware/auth'
import type { StoredConnection } from './connections'
import type { ExternalItemStore } from './itemStore'
import type { Cached, RefreshResult, RouteResult } from '../sync/engine'
import type { PluginFetchHandler } from '../pluginHost/types'

export type ProviderCredentials = Record<string, string>
export type CacheState = 'fresh' | 'stale' | 'missing' | 'malformed' | 'deleted'
export type ProviderRequestBudgets = Pick<
  ProviderBudgets,
  'maxConcurrentRequests' | 'maxConcurrentRequestsPerConnection'
>

export type NormalizedConnection = {
  secret: string
  label: string
  account: ProviderAccountRef | null
  scopes: string[]
  config: unknown
  capabilities: Record<string, 'available' | 'missing-scope' | 'degraded'>
}

export type ConnectionHealth = { ok: true } | { ok: false; error: ProviderErrorCode }

export type TypedConnectionContract<TValidated> = {
  authKind: IntegrationAuthKind
  // Projected onto the public descriptor; see PublicIntegrationProvider. Absent means 'fields'.
  kind?: 'fields' | 'device-flow'
  fields: CredentialField[]
  connectable: boolean
  disconnectable: boolean
  maxConnections?: number
  validate(credentials: ProviderCredentials): Promise<TValidated>
  normalize(credentials: ProviderCredentials, validated: TValidated): NormalizedConnection
  test(secret: string, config: unknown): Promise<ConnectionHealth>
}

export type ConnectionContract = TypedConnectionContract<unknown>

export type CachedExternalItem<TSummary = unknown, TDetail = unknown> = {
  ref: ExternalRef
  summary: TSummary
  detail?: TDetail
  listFetchedAt?: number
  detailFetchedAt?: number
  schemaVersion: number
  deletedAt?: number
  truncated?: boolean
}

export type CodecResult<T> = { ok: true; value: T; migrated: boolean } | { ok: false; error: string }

export type CachedItemCodec<TSummary = unknown, TDetail = unknown, TPublic = unknown> = {
  schemaVersion: number
  parse(raw: unknown, fallbackRef: ExternalRef): CodecResult<CachedExternalItem<TSummary, TDetail>>
  mergeSummary(
    existing: CachedExternalItem<TSummary, TDetail> | null,
    ref: ExternalRef,
    summary: TSummary,
    fetchedAt: number,
  ): CachedExternalItem<TSummary, TDetail>
  withDetail(ref: ExternalRef, summary: TSummary, detail: TDetail, fetchedAt: number): CachedExternalItem<TSummary, TDetail>
  toPublic(item: CachedExternalItem<TSummary, TDetail>): TPublic
  summary(item: CachedExternalItem<TSummary, TDetail>): TSummary
}

export type LinkContextFormatter = {
  summarize(ref: ExternalRef, item: CachedExternalItem | null, state: CacheState): ContextItem
}

// What core lends a provider so it can answer `issue_detail` (docs/agent-tools.md § issue_detail).
// One method, and it is the same resource runtime the provider's own routes go through, so the cache,
// the TTL, the request budget and the credential scope are the ones already in place.
export type ProviderDetailContext = {
  resource<TInput, TOutput>(resourceId: string, input: TInput, force?: boolean): Promise<RouteResult<TOutput>>
}

// One item, in as much depth as the provider can give. The provider composes its own resources rather
// than declaring a pointer at one, because only it knows how many the answer takes: Linear reads the
// issue, and Rollbar reads the item, its occurrence list and the newest occurrence.
//
// Return null for "not in this connection". Core is calling it once per connected workspace and takes
// the first that answers, so null is the ordinary case, not a failure.
export type ProviderItemDetail = (context: ProviderDetailContext, identifier: string) => Promise<unknown | null>

export type ReferenceCandidate = { displayId: string; url?: string; confidence: 'exact-url' | 'bare-id' }
export type ReferenceResolver = {
  detectRefs(text: string): ReferenceCandidate[]
  toRef(connectionId: string, candidate: ReferenceCandidate): ExternalRef
  canAutoLink(ref: ExternalRef): 'attach' | 'suggest' | 'linkify-only'
}

export type ExternalIdContract = {
  fromDisplay(connectionId: string, displayId: string): ExternalRef
  parse(raw: unknown, fallback: ExternalRef): ExternalRef | null
}

export type ProviderMutation = {
  id: string
  capability: string
  risk: 'write' | 'execute'
  freshness?: 'live-fetch-first'
  invalidates: string[]
  idempotent: boolean
  run?: (args: { secret: string; input: Record<string, unknown> }) => Promise<unknown>
}

export type ProviderResourceContext = {
  // The external-item read model, not core's database handle, scoped to this provider's own rows at
  // construction (docs/integrations.md § Connection and integration contributions); a provider
  // cannot read or write another provider's cache through it.
  items: ExternalItemStore
  userId: string
  connection: StoredConnection
  now: number
  limits: Pick<ProviderBudgets, 'maxPages' | 'maxCachedItemBytes'>
}

export type ProviderResourceRefreshContext = ProviderResourceContext & { secret: string }

export type MirroredResourceContribution<TInput = unknown, TOutput = unknown> = {
  id: string
  ttlMs: number
  merge: 'summary-preserves-detail' | 'replace'
  key(connectionId: string, input: TInput): string
  read(context: ProviderResourceContext, input: TInput): Promise<Cached<TOutput> | null>
  refresh(context: ProviderResourceRefreshContext, input: TInput): Promise<RefreshResult>
}

// One selectable project inside a connection, as the provider reports it; see docs/integrations.md §
// Project sources for how the host bounds and re-checks the list before it is offered for selection.
export type ProviderProject = { id: string; label: string }

export type ProviderProjectContext = { connection: StoredConnection; secret: string }

/**
/** How the host enumerates a connection's projects for its own workspace-mapping picker; see
 * docs/integrations.md § Project sources for the full contract, including why this is not a
 * `MirroredResourceContribution`. */
export type ProviderProjectSource = {
  list(context: ProviderProjectContext): Promise<ProviderProject[]>
}

// A provider-owned HTTP router. `prefix` is relative to the provider's own plugin namespace
// (`/v2/p/<providerId>`), so it is empty for a provider that owns its whole namespace; the namespace
// segment comes from the declared providerId, never from the prefix string.
export type ProviderRouteContribution = { providerId: string; prefix: '' | `/${string}` } & (
  | { router: Hono<AppEnv>; fetch?: never }
  | { fetch: PluginFetchHandler; router?: never }
)

export type ConnectionProviderContribution = {
  id: string
  label: string
  glyph: string
  kind: IntegrationProviderKind
  connection: ConnectionContract
  capabilities: ProviderCapabilities
  budgets: ProviderRequestBudgets
  // On the connection contribution rather than the integration one; see docs/integrations.md §
  // Connection and integration contributions for why.
  projects?: ProviderProjectSource
  models?: ModelCatalogEntry[]
  defaultModelId?: string
  toPublic(): PublicIntegrationProvider
}

export type ConnectionProviderDefinition<TValidated> = Omit<
  ConnectionProviderContribution,
  'connection' | 'toPublic'
> & {
  connection: TypedConnectionContract<TValidated>
}

export type IntegrationProviderContribution = ConnectionProviderContribution & {
  externalIds: ExternalIdContract
  resources: MirroredResourceContribution<any, any>[]
  codec?: CachedItemCodec<any, any, any>
  taskContext?: LinkContextFormatter
  // The read behind core's `issue_detail` agent tool. Absent means this provider offers summaries
  // only, and the tool says so rather than guessing at a resource input shape.
  detail?: ProviderItemDetail
  refs?: ReferenceResolver
  mutations?: ProviderMutation[]
  budgets: ProviderBudgets
  memory: MemoryEvidencePolicy
  conformance?: {
    ref: ExternalRef
    legacyCache: unknown
    summary: unknown
    detail?: unknown
  }
}

export type IntegrationProviderDefinition<TValidated> = Omit<
  IntegrationProviderContribution,
  'connection' | 'toPublic'
> & {
  connection: TypedConnectionContract<TValidated>
}

export class ProviderOperationError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    readonly status: 400 | 401 | 403 | 404 | 429 | 502 = 502,
    // Which check refused, in the reader's words. The code names a category; on a route with several
    // ways to answer `provider_bad_config` the category alone sends whoever hit it to read the
    // source. It rides in `message` rather than in a field of its own, because that is what survives
    // a bundle boundary (`isProviderOperationError` below). Never put a credential or a secret here.
    detail?: string,
  ) {
    super(detail ?? code)
    // Without this the name is 'Error', which is what a log line shows for a failure somebody threw
    // on purpose and named precisely.
    this.name = 'ProviderOperationError'
  }
}

/**
 * Whether a thrown value is one of these, by shape rather than by identity.
 *
 * `instanceof` is the wrong question here and answers it wrongly. Every plugin bundle inlines its
 * whole dependency graph, this class included, because a loaded plugin's directory has no
 * node_modules to resolve against (apps/node/scripts/build-plugin.mjs). So a provider error thrown
 * inside a plugin bundle and caught by a host route is an instance of the plugin's copy of the
 * class, never the host's, and the reverse holds for a host error caught inside a plugin. Every
 * `instanceof` across that boundary was false, which sent typed failures like `provider_needs_auth`
 * to the catch-all and told the owner a working provider was unavailable.
 *
 * The shape is checked rather than a brand, because a brand only reaches a plugin package that has
 * been rebuilt since, and a plugin installed from a folder is rebuilt when its author says so.
 */
export const isProviderOperationError = (error: unknown): error is ProviderOperationError => {
  if (!(error instanceof Error)) return false
  const failure = error as Partial<ProviderOperationError>
  return typeof failure.status === 'number'
    && typeof failure.code === 'string'
    && (PROVIDER_ERROR_CODES as readonly string[]).includes(failure.code)
}
