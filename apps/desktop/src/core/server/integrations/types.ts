import type { ContextItem } from '../../shared/api'
import type { Hono } from 'hono'
import type {
  CredentialField,
  ExternalRef,
  IntegrationAuthKind,
  IntegrationProviderKind,
  MemoryEvidencePolicy,
  ProviderAccountRef,
  ProviderBudgets,
  ProviderCapabilities,
  ProviderErrorCode,
  PublicIntegrationProvider,
} from '../../shared/integrations'
import type { AppDatabase } from '../db'
import { schema } from '../db'
import type { AppEnv } from '../middleware/auth'
import type { Cached, RefreshResult } from '../sync/engine'

export type ProviderCredentials = Record<string, string>
export type CacheState = 'fresh' | 'stale' | 'missing' | 'malformed' | 'deleted'

export type NormalizedConnection = {
  secret: string
  label: string
  account: ProviderAccountRef | null
  scopes: string[]
  config: unknown
  capabilities: Record<string, 'available' | 'missing-scope' | 'degraded'>
}

export type ConnectionHealth = { ok: true } | { ok: false; error: ProviderErrorCode }

export type ConnectionContract<TValidated = unknown> = {
  authKind: IntegrationAuthKind
  fields: CredentialField[]
  connectable: boolean
  disconnectable: boolean
  validate(credentials: ProviderCredentials): Promise<TValidated>
  normalize(credentials: ProviderCredentials, validated: TValidated): NormalizedConnection
  test(secret: string, config: unknown): Promise<ConnectionHealth>
}

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
  db: AppDatabase
  userId: string
  connection: typeof schema.integrations.$inferSelect
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

export type ProviderRouteContribution = {
  providerId: string
  prefix: `/${string}`
  router: Hono<AppEnv>
}

export type IntegrationProviderContribution = {
  id: string
  label: string
  glyph: string
  kind: IntegrationProviderKind
  connection: ConnectionContract<any>
  externalIds: ExternalIdContract
  capabilities: ProviderCapabilities
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
  toPublic(): PublicIntegrationProvider
}

export class ProviderOperationError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    readonly status: 400 | 401 | 403 | 404 | 429 | 502 = 502,
  ) {
    super(code)
  }
}
