import type { ContextItem } from '@acorn/protocol/api.ts'
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
import type { Cached, RefreshResult } from '../sync/engine'

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
  // The external-item read model, NOT core's database handle. A provider plugin gets exactly the six
  // reads/writes it performs against core's `issues` / `issue_resources` / freshness markers
  // (integrations/itemStore.ts explains why those tables stayed core's and this store exists instead of
  // a per-plugin migration). Handing over `db: AppDatabase` was the coupling: it let a provider write
  // any core table, and it is what kept linear and rollbar on the schema ratchet.
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

// A provider-owned HTTP router. `prefix` is relative to the provider's own plugin namespace
// (`/v2/p/<providerId>`), so it is empty for a provider that owns its whole namespace — the
// namespace segment comes from the declared providerId, never from the prefix string.
export type ProviderRouteContribution = {
  providerId: string
  prefix: '' | `/${string}`
  router: Hono<AppEnv>
}

export type ConnectionProviderContribution = {
  id: string
  label: string
  glyph: string
  kind: IntegrationProviderKind
  connection: ConnectionContract
  capabilities: ProviderCapabilities
  budgets: ProviderRequestBudgets
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
  ) {
    super(code)
  }
}
