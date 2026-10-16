import { randomUUID } from 'node:crypto'
import { and, asc, eq } from 'drizzle-orm'
import type { ConnectIntegrationRequest, Integration, RotateIntegrationRequest } from '@acorn/protocol/api.ts'
import type { ExternalRef, ProviderErrorCode } from '@acorn/protocol/integrations.ts'
import { MAX_CONNECTION_NAME } from '@acorn/protocol/integrations.ts'
import { broadcastConnectionChanged, broadcastTasksChanged, broadcastWorkspaceProjectsChanged } from '../notify'
import type { AppDatabase } from '../db'
import { schema } from '../db'
import { cascadeDeleteIntegration } from '../db/cascade'
import { SecretUnavailableError, type SecretService } from '../core/secrets'
import { connectionProviderRegistry } from './connectionProviders/registry'
import { integrationProviderRegistry } from './registry'
import { providerRequestScheduler } from './budgetRuntime'
import { isProviderOperationError, ProviderOperationError, type ConnectionContract } from './types'
import { resolvedConnectionCapabilities } from './connectionCapabilities'

export { connectionHasCapability } from './connectionCapabilities'

export type StoredConnection = typeof schema.integrations.$inferSelect

const json = <T>(raw: string, fallback: T): T => {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export const connectionSummary = (row: StoredConnection): Integration => ({
  id: row.id,
  providerId: row.provider,
  label: row.label,
  ...(row.name ? { name: row.name } : {}),
  status: row.status as Integration['status'],
  authKind: row.authKind as Integration['authKind'],
  account: row.account ? json(row.account, null) : null,
  scopes: json(row.scopes, []),
  capabilities: resolvedConnectionCapabilities(row),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  lastValidatedAt: row.lastValidatedAt ?? undefined,
  lastError: (row.lastError as ProviderErrorCode | null) ?? undefined,
})

export async function listConnections(db: AppDatabase, userId: string): Promise<StoredConnection[]> {
  return db
    .select()
    .from(schema.integrations)
    .where(eq(schema.integrations.userId, userId))
    .orderBy(asc(schema.integrations.createdAt), asc(schema.integrations.id))
}

export async function listProviderConnections(
  db: AppDatabase,
  userId: string,
  providerId: string,
): Promise<StoredConnection[]> {
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
        // Nobody has named this yet, so every surface falls back to the provider's own label.
        name: null,
        encryptedCredentials: await secrets.seal(normalized.secret),
        encryptedRefreshToken: normalized.refresh ? await secrets.seal(normalized.refresh.refreshToken) : null,
        credentialExpiresAt: normalized.refresh?.expiresAt ?? null,
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
      broadcastConnectionChanged({ integrationId: row.id, providerId: row.provider, status: 'connected' })
      return connectionSummary(row)
    },
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
  const encryptedRefreshToken = normalized.refresh ? await secrets.seal(normalized.refresh.refreshToken) : null
  const credentialExpiresAt = normalized.refresh?.expiresAt ?? null
  await db
    .update(schema.integrations)
    .set({
      encryptedCredentials: await secrets.seal(normalized.secret),
      encryptedRefreshToken,
      credentialExpiresAt,
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
  broadcastConnectionChanged({ integrationId: id, providerId: row.provider, status: 'connected' })
  return connectionSummary({
    ...row,
    encryptedCredentials: '',
    encryptedRefreshToken: null,
    credentialExpiresAt,
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

export async function testConnection(
  db: AppDatabase,
  userId: string,
  id: string,
  secrets: SecretService,
): Promise<Integration> {
  const row = await getConnection(db, userId, id)
  if (!row) throw new ProviderOperationError('provider_not_connected', 404)
  const provider = connectionProviderRegistry.require(row.provider)
  // The provider's own "test connection" call runs inside the secret scope (docs/integrations/provider-boundaries.md §
  // Provider boundaries), so an echoed credential is scrubbed before it becomes `lastError` or a log
  // line.
  const health = await secrets
    .use(row.encryptedCredentials, `${row.provider}: test connection`, (secret) =>
      providerRequestScheduler.run(provider.id, row.id, provider.budgets, () =>
        provider.connection.test(secret, json(row.config, {})),
      ),
    )
    .catch(async (error: unknown) => {
      if (!(error instanceof SecretUnavailableError)) throw error
      const now = Date.now()
      await db
        .update(schema.integrations)
        .set({ status: 'needs-auth', lastValidatedAt: now, lastError: 'provider_secret_unreadable', updatedAt: now })
        .where(eq(schema.integrations.id, id))
      broadcastConnectionChanged({ integrationId: id, providerId: row.provider, status: 'needs-auth' })
      throw new ProviderOperationError('provider_secret_unreadable', 400)
    })
  const now = Date.now()
  const status = health.ok ? 'connected' : health.error === 'provider_needs_auth' ? 'needs-auth' : 'degraded'
  await db
    .update(schema.integrations)
    .set({ status, lastValidatedAt: now, lastError: health.ok ? null : health.error, updatedAt: now })
    .where(eq(schema.integrations.id, id))
  broadcastConnectionChanged({ integrationId: id, providerId: row.provider, status })
  return connectionSummary({
    ...row,
    status,
    lastValidatedAt: now,
    lastError: health.ok ? null : health.error,
    updatedAt: now,
  })
}

export async function setConnectionDisabled(
  db: AppDatabase,
  userId: string,
  id: string,
  disabled: boolean,
): Promise<Integration> {
  const row = await getConnection(db, userId, id)
  if (!row) throw new ProviderOperationError('provider_not_connected', 404)
  const status = disabled ? 'disabled' : 'connected'
  const now = Date.now()
  await db.update(schema.integrations).set({ status, updatedAt: now }).where(eq(schema.integrations.id, id))
  broadcastConnectionChanged({ integrationId: id, providerId: row.provider, status })
  return connectionSummary({ ...row, status, updatedAt: now })
}

// Clearing the name is a real request, not a missing field: it puts the connection back to whatever
// the provider calls it. So `null` and a string of spaces both mean "go back to the label", and
// `rotateConnection` is deliberately not touched here, which is what keeps a rotate from wiping it.
export async function renameConnection(
  db: AppDatabase,
  userId: string,
  id: string,
  name: string | null,
): Promise<Integration> {
  const row = await getConnection(db, userId, id)
  if (!row) throw new ProviderOperationError('provider_not_connected', 404)
  const trimmed = name?.trim() ?? ''
  if (trimmed.length > MAX_CONNECTION_NAME) throw new ProviderOperationError('provider_bad_config', 400)
  const next = trimmed || null
  const now = Date.now()
  await db.update(schema.integrations).set({ name: next, updatedAt: now }).where(eq(schema.integrations.id, id))
  broadcastConnectionChanged({
    integrationId: id,
    providerId: row.provider,
    status: row.status as Integration['status'],
  })
  return connectionSummary({ ...row, name: next, updatedAt: now })
}

export async function disconnectConnection(db: AppDatabase, userId: string, id: string): Promise<void> {
  const row = await getConnection(db, userId, id)
  if (!row) return
  const provider = connectionProviderRegistry.require(row.provider)
  if (!provider.connection.disconnectable) throw new ProviderOperationError('provider_bad_config', 400)
  const mappings = await db
    .select({ workspaceId: schema.workspaceExternalProjects.workspaceId })
    .from(schema.workspaceExternalProjects)
    .where(eq(schema.workspaceExternalProjects.integrationId, id))
  const taskLinks = await db
    .select({ taskId: schema.taskLinks.taskId })
    .from(schema.taskLinks)
    .where(eq(schema.taskLinks.integrationId, id))
  await cascadeDeleteIntegration(db, userId, id)
  broadcastConnectionChanged({ integrationId: id, providerId: row.provider, deleted: true })
  if (mappings.length) {
    broadcastWorkspaceProjectsChanged({
      providerId: row.provider,
      workspaceIds: [...new Set(mappings.map((mapping) => mapping.workspaceId))].sort(),
    })
  }
  if (taskLinks.length) broadcastTasksChanged({ taskId: null })
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
  for (const listed of rows) {
    if (listed.status === 'disabled' || listed.status === 'needs-auth') continue
    const row = await freshConnection(db, listed, secrets)
    if (!row) continue
    let value: T | undefined
    try {
      // The visitor, which is what actually calls the provider, runs inside the scope.
      value = await secrets.use(row.encryptedCredentials, `${row.provider}: use connection`, (secret) =>
        visit(row, secret),
      )
    } catch (error) {
      if (!(error instanceof SecretUnavailableError)) throw error
      const now = Date.now()
      await db
        .update(schema.integrations)
        .set({ status: 'needs-auth', lastError: 'provider_secret_unreadable', updatedAt: now })
        .where(eq(schema.integrations.id, row.id))
      // The demotion the owner never asked for, so it is the one that most needs announcing: nothing on
      // screen and no plugin knows this credential stopped working until something says so.
      broadcastConnectionChanged({ integrationId: row.id, providerId: row.provider, status: 'needs-auth' })
      continue
    }
    if (value !== undefined) out.push(value)
  }
  return out
}

export function externalRefForConnection(
  row: StoredConnection,
  identifier: string,
  input?: Partial<ExternalRef>,
): ExternalRef {
  if (input?.providerId && input.providerId !== row.provider) {
    throw new ProviderOperationError(
      'provider_bad_config',
      400,
      `The reference claims provider '${input.providerId}', but connection ${row.id} is a ${row.provider} connection.`,
    )
  }
  if (input?.connectionId && input.connectionId !== row.id) {
    throw new ProviderOperationError(
      'provider_bad_config',
      400,
      `The reference claims connection '${input.connectionId}', but it is being stamped onto ${row.id}.`,
    )
  }
  const fallback = {
    providerId: row.provider,
    connectionId: row.id,
    displayId: identifier,
    externalId: input?.externalId,
    url: input?.url,
    locator: input?.locator,
  }
  const provider = integrationProviderRegistry.get(row.provider)
  if (!provider)
    throw new ProviderOperationError(
      'provider_bad_config',
      400,
      `No integration provider named '${row.provider}' is registered on this node.`,
    )
  const parsed = provider.externalIds.parse(fallback, fallback)
  if (!parsed || parsed.connectionId !== row.id || parsed.displayId !== identifier) {
    throw new ProviderOperationError(
      'provider_bad_config',
      400,
      `Provider '${row.provider}' did not accept its own reference for '${identifier}'.`,
    )
  }
  return parsed
}

// --- Request-context seams, for provider plugins ---
//

// A refresh this early leaves room for a request that starts just before expiry to finish.
const REFRESH_BEFORE_EXPIRY_MS = 5 * 60_000

// One refresh at a time per connection. A provider that rotates refresh tokens refuses the second of
// two refreshes that spend the same token, and that refusal would sign the person out.
const refreshing = new Map<string, Promise<StoredConnection | null>>()

/**
 * The connection with an access token that is still good. A provider with a `refresh` step renews the
 * token when it is within five minutes of expiry, or whenever `force` is set, which is how a caller
 * answers a `401`. Both tokens are written back sealed. A refused refresh marks the connection as
 * needing sign-in and answers null. Any other failure keeps the connection as it was, so the request
 * goes ahead with the stored token.
 */
export async function freshConnection(
  db: AppDatabase,
  row: StoredConnection,
  secrets: SecretService,
  options: { force?: boolean } = {},
): Promise<StoredConnection | null> {
  const refresh = connectionProviderRegistry.get(row.provider)?.connection.refresh
  // A connection whose refresh was refused waits for the person to sign in again.
  if (!refresh || !row.encryptedRefreshToken || row.status === 'needs-auth') return row
  const due = row.credentialExpiresAt != null && row.credentialExpiresAt - Date.now() < REFRESH_BEFORE_EXPIRY_MS
  if (!options.force && !due) return row
  const held = refreshing.get(row.id)
  if (held) return held
  const work = refreshConnection(db, row, secrets, refresh).finally(() => refreshing.delete(row.id))
  refreshing.set(row.id, work)
  return work
}

async function refreshConnection(
  db: AppDatabase,
  row: StoredConnection,
  secrets: SecretService,
  refresh: NonNullable<ConnectionContract['refresh']>,
): Promise<StoredConnection | null> {
  // A refresh that lost a race to another process still reads the winner's tokens.
  const current = (await getConnection(db, row.userId, row.id)) ?? row
  if (current.encryptedRefreshToken !== row.encryptedRefreshToken) return current
  try {
    const next = await secrets.use(current.encryptedRefreshToken!, `${row.provider}: refresh connection`, (token) =>
      refresh(token),
    )
    const now = Date.now()
    const update = {
      encryptedCredentials: await secrets.seal(next.secret),
      encryptedRefreshToken: await secrets.seal(next.refreshToken),
      credentialExpiresAt: next.expiresAt,
      status: 'connected',
      lastError: null,
      updatedAt: now,
    }
    await db.update(schema.integrations).set(update).where(eq(schema.integrations.id, row.id))
    return { ...current, ...update }
  } catch (error) {
    const refused =
      error instanceof SecretUnavailableError ||
      (isProviderOperationError(error) && error.code === 'provider_needs_auth')
    if (!refused) return current
    const now = Date.now()
    await db
      .update(schema.integrations)
      .set({ status: 'needs-auth', lastError: 'provider_needs_auth', updatedAt: now })
      .where(eq(schema.integrations.id, row.id))
    broadcastConnectionChanged({ integrationId: row.id, providerId: row.provider, status: 'needs-auth' })
    return null
  }
}
