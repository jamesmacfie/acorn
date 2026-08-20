import { randomUUID } from 'node:crypto'
import { and, asc, eq } from 'drizzle-orm'
import type { Context } from 'hono'
import type { ConnectIntegrationRequest, Integration, RotateIntegrationRequest } from '@acorn/protocol/api.ts'
import type { ExternalRef, ProviderErrorCode } from '@acorn/protocol/integrations.ts'
import type { AppDatabase } from '../db'
import { getDb, schema } from '../db'
import { cascadeDeleteIntegration } from '../db/cascade'
import type { AppEnv } from '../middleware/auth'
import { ownerId } from '../middleware/requireUser'
import { createExternalItemStore, type ExternalItemStore } from './itemStore'
import { SecretUnavailableError, type SecretService } from '../../main/core/secrets'
import { connectionProviderRegistry } from './connectionRegistry'
import { integrationProviderRegistry } from './registry'
import { providerRequestScheduler } from './budgetRuntime'
import { ProviderOperationError, type ProviderCredentials } from './types'

export type StoredConnection = typeof schema.integrations.$inferSelect

const json = <T>(raw: string, fallback: T): T => {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

const resolvedCapabilities = (
  row: StoredConnection,
  providers = connectionProviderRegistry,
): Integration['capabilities'] => {
  const declared = providers.get(row.provider)?.capabilities ?? {}
  const defaults = Object.fromEntries(
    Object.entries(declared)
      .filter(([, value]) => value !== false && value !== undefined && value !== 'none')
      .map(([capability]) => [capability, 'available' as const]),
  )
  return { ...defaults, ...json(row.capabilities, {}) }
}

export const connectionSummary = (row: StoredConnection): Integration => ({
  id: row.id,
  providerId: row.provider,
  label: row.label,
  status: row.status as Integration['status'],
  authKind: row.authKind as Integration['authKind'],
  account: row.account ? json(row.account, null) : null,
  scopes: json(row.scopes, []),
  capabilities: resolvedCapabilities(row),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  lastValidatedAt: row.lastValidatedAt ?? undefined,
  lastError: (row.lastError as ProviderErrorCode | null) ?? undefined,
})

export const connectionHasCapability = (
  row: StoredConnection,
  capability: string,
  providers = connectionProviderRegistry,
): boolean => resolvedCapabilities(row, providers)[capability] === 'available'

export async function listConnections(db: AppDatabase, userId: string): Promise<StoredConnection[]> {
  return db
    .select()
    .from(schema.integrations)
    .where(eq(schema.integrations.userId, userId))
    .orderBy(asc(schema.integrations.createdAt), asc(schema.integrations.id))
}

export async function listProviderConnections(db: AppDatabase, userId: string, providerId: string): Promise<StoredConnection[]> {
  connectionProviderRegistry.require(providerId)
  return db
    .select()
    .from(schema.integrations)
    .where(and(eq(schema.integrations.userId, userId), eq(schema.integrations.provider, providerId)))
    .orderBy(asc(schema.integrations.createdAt), asc(schema.integrations.id))
}

export async function getConnection(db: AppDatabase, userId: string, id: string): Promise<StoredConnection | null> {
  const [row] = await db
    .select()
    .from(schema.integrations)
    .where(and(eq(schema.integrations.id, id), eq(schema.integrations.userId, userId)))
  return row ?? null
}

export async function connectProvider(
  db: AppDatabase,
  userId: string,
  request: ConnectIntegrationRequest,
  secrets: SecretService,
): Promise<Integration> {
  const provider = connectionProviderRegistry.get(request.providerId)
  if (!provider?.connection.connectable) throw new ProviderOperationError('provider_bad_config', 400)
  return providerRequestScheduler.run(
    provider.id,
    `connect:${userId}`,
    { ...provider.budgets, maxConcurrentRequestsPerConnection: 1 },
    async () => {
      if (provider.connection.maxConnections !== undefined) {
        const existing = await listProviderConnections(db, userId, provider.id)
        if (existing.length >= provider.connection.maxConnections) {
          throw new ProviderOperationError('provider_bad_config', 400)
        }
      }
      const validated = await provider.connection.validate(request.credentials)
      const normalized = provider.connection.normalize(request.credentials, validated)
      const now = Date.now()
      const row: StoredConnection = {
        id: randomUUID(),
        userId,
        provider: provider.id,
        label: normalized.label,
        authRef: await secrets.seal(normalized.secret),
        authKind: provider.connection.authKind,
        account: normalized.account ? JSON.stringify(normalized.account) : null,
        scopes: JSON.stringify(normalized.scopes),
        capabilities: JSON.stringify(normalized.capabilities),
        config: JSON.stringify(normalized.config ?? {}),
        status: 'connected',
        lastValidatedAt: now,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      }
      await db.insert(schema.integrations).values(row)
      return connectionSummary(row)
    }
  )
}

export async function rotateConnection(
  db: AppDatabase,
  userId: string,
  id: string,
  request: RotateIntegrationRequest,
  secrets: SecretService,
): Promise<Integration> {
  const row = await getConnection(db, userId, id)
  if (!row) throw new ProviderOperationError('provider_not_connected', 404)
  const provider = connectionProviderRegistry.require(row.provider)
  const validated = await providerRequestScheduler.run(provider.id, row.id, provider.budgets, () =>
    provider.connection.validate(request.credentials),
  )
  const normalized = provider.connection.normalize(request.credentials, validated)
  const now = Date.now()
  await db
    .update(schema.integrations)
    .set({
      authRef: await secrets.seal(normalized.secret),
      authKind: provider.connection.authKind,
      account: normalized.account ? JSON.stringify(normalized.account) : null,
      scopes: JSON.stringify(normalized.scopes),
      capabilities: JSON.stringify(normalized.capabilities),
      config: JSON.stringify(normalized.config ?? {}),
      status: 'connected',
      lastValidatedAt: now,
      lastError: null,
      updatedAt: now,
    })
    .where(eq(schema.integrations.id, id))
  return connectionSummary({
    ...row,
    authRef: '',
    authKind: provider.connection.authKind,
    account: normalized.account ? JSON.stringify(normalized.account) : null,
    scopes: JSON.stringify(normalized.scopes),
    capabilities: JSON.stringify(normalized.capabilities),
    config: JSON.stringify(normalized.config ?? {}),
    status: 'connected',
    lastValidatedAt: now,
    lastError: null,
    updatedAt: now,
  })
}

export async function testConnection(db: AppDatabase, userId: string, id: string, secrets: SecretService): Promise<Integration> {
  const row = await getConnection(db, userId, id)
  if (!row) throw new ProviderOperationError('provider_not_connected', 404)
  const provider = connectionProviderRegistry.require(row.provider)
  // The provider's own "test connection" call runs inside the secret scope, so a provider that echoes
  // the credential in its failure response has it scrubbed before this becomes lastError or a log line.
  const health = await secrets
    .use(row.authRef, `${row.provider}: test connection`, (secret) =>
      providerRequestScheduler.run(provider.id, row.id, provider.budgets, () => provider.connection.test(secret, json(row.config, {}))),
    )
    .catch(async (error: unknown) => {
      if (!(error instanceof SecretUnavailableError)) throw error
      const now = Date.now()
      await db.update(schema.integrations).set({ status: 'needs-auth', lastValidatedAt: now, lastError: 'provider_secret_unreadable', updatedAt: now }).where(eq(schema.integrations.id, id))
      throw new ProviderOperationError('provider_secret_unreadable', 400)
    })
  const now = Date.now()
  const status = health.ok ? 'connected' : health.error === 'provider_needs_auth' ? 'needs-auth' : 'degraded'
  await db
    .update(schema.integrations)
    .set({ status, lastValidatedAt: now, lastError: health.ok ? null : health.error, updatedAt: now })
    .where(eq(schema.integrations.id, id))
  return connectionSummary({ ...row, status, lastValidatedAt: now, lastError: health.ok ? null : health.error, updatedAt: now })
}

export async function setConnectionDisabled(db: AppDatabase, userId: string, id: string, disabled: boolean): Promise<Integration> {
  const row = await getConnection(db, userId, id)
  if (!row) throw new ProviderOperationError('provider_not_connected', 404)
  const status = disabled ? 'disabled' : 'connected'
  const now = Date.now()
  await db.update(schema.integrations).set({ status, updatedAt: now }).where(eq(schema.integrations.id, id))
  return connectionSummary({ ...row, status, updatedAt: now })
}

export async function disconnectConnection(db: AppDatabase, userId: string, id: string): Promise<void> {
  const row = await getConnection(db, userId, id)
  if (!row) return
  const provider = connectionProviderRegistry.require(row.provider)
  if (!provider.connection.disconnectable) throw new ProviderOperationError('provider_bad_config', 400)
  await cascadeDeleteIntegration(db, userId, id)
}

export async function forEachConnection<T>(
  db: AppDatabase,
  userId: string,
  providerId: string,
  secrets: SecretService,
  visit: (connection: StoredConnection, secret: string) => Promise<T | undefined>,
): Promise<T[]> {
  connectionProviderRegistry.require(providerId)
  const rows = await listProviderConnections(db, userId, providerId)
  const out: T[] = []
  for (const row of rows) {
    if (row.status === 'disabled' || row.status === 'needs-auth') continue
    let value: T | undefined
    try {
      // The visitor, which is what actually calls the provider, runs inside the scope.
      value = await secrets.use(row.authRef, `${row.provider}: use connection`, (secret) => visit(row, secret))
    } catch (error) {
      if (!(error instanceof SecretUnavailableError)) throw error
      const now = Date.now()
      await db.update(schema.integrations).set({ status: 'needs-auth', lastError: 'provider_secret_unreadable', updatedAt: now }).where(eq(schema.integrations.id, row.id))
      continue
    }
    if (value !== undefined) out.push(value)
  }
  return out
}

export function externalRefForConnection(row: StoredConnection, identifier: string, input?: Partial<ExternalRef>): ExternalRef {
  if (input?.providerId && input.providerId !== row.provider) throw new ProviderOperationError('provider_bad_config', 400)
  if (input?.connectionId && input.connectionId !== row.id) throw new ProviderOperationError('provider_bad_config', 400)
  const fallback = {
    providerId: row.provider,
    connectionId: row.id,
    displayId: identifier,
    externalId: input?.externalId,
    url: input?.url,
    locator: input?.locator,
  }
  const provider = integrationProviderRegistry.get(row.provider)
  if (!provider) throw new ProviderOperationError('provider_bad_config', 400)
  const parsed = provider.externalIds.parse(fallback, fallback)
  if (!parsed || parsed.connectionId !== row.id || parsed.displayId !== identifier) throw new ProviderOperationError('provider_bad_config', 400)
  return parsed
}

// --- Request-context seams, for provider plugins ---
//
// Core-owned routes pass their database explicitly. Provider plugins use these request-context wrappers,
// which keep the core handle inside the service boundary and scope every read to the caller.

/** Every stored connection for one provider, owned by the calling principal. */
export const ownedConnections = (c: Context<AppEnv>, providerId: string): Promise<StoredConnection[]> =>
  listProviderConnections(getDb(c.env), ownerId(c), providerId)

/** `forEachConnection` for the calling principal: each visit runs inside the credential's secret scope. */
export const withOwnedConnections = <T>(
  c: Context<AppEnv>,
  providerId: string,
  visit: (connection: StoredConnection, secret: string) => Promise<T | undefined>,
): Promise<T[]> => forEachConnection(getDb(c.env), ownerId(c), providerId, c.env.SECRETS, visit)

/**
/**
 * The external-item read model for the calling principal, scoped to one provider
 * (integrations/itemStore.ts). This is how a compiled provider's route reaches core's `issues` table; a
 * provider's mirrored resource gets the same store on `ProviderResourceContext.items`. The compiled tier
 * is trusted, so `providerId` is taken at its word; the loaded tier's twin (`providers.items` on the
 * request context) asserts ownership first.
 */
export const ownedExternalItems = (c: Context<AppEnv>, providerId: string): ExternalItemStore =>
  createExternalItemStore(getDb(c.env), ownerId(c), providerId)

export const credentialsFromBody = (body: unknown): ProviderCredentials => {
  if (!body || typeof body !== 'object') return {}
  const record = body as Record<string, unknown>
  if (record.credentials && typeof record.credentials === 'object') {
    return Object.fromEntries(Object.entries(record.credentials as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  }
  // Accept the legacy token field while clients transition to the provider credential shape.
  return typeof record.token === 'string' ? { token: record.token } : {}
}
