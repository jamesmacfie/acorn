import { and, eq, inArray } from 'drizzle-orm'
import type { AppDatabase } from '../db'
import { schema } from '../db'

/** One cached external item: the provider's opaque envelope plus when it was last written. */
export type ExternalItemRow = { integrationId: string; identifier: string; data: string; fetchedAt: number }

/** One provider-owned child payload of an item (a Rollbar occurrence list, an occurrence detail). */
export type ExternalResourceRow = { identifier: string; data: string; fetchedAt: number }

export type ExternalItemStore = {
  /** One item within one connection. */
  read(connectionId: string, identifier: string): Promise<ExternalItemRow | null>
  /** Every item this connection has cached, the membership read behind a provider's list resource. */
  listForConnection(connectionId: string): Promise<ExternalItemRow[]>
  /**
  /**
   * The same identifiers across every connection of the provider; see docs/integrations.md § Linear
   * for why a bare id is resolved by trying each connected workspace in turn.
   */
  listByIdentifier(identifiers: string[]): Promise<ExternalItemRow[]>
  write(row: { connectionId: string; identifier: string; data: string; fetchedAt: number }): Promise<void>
  readResource(connectionId: string, issueIdentifier: string, resource: string, identifier: string): Promise<ExternalResourceRow | null>
  writeResource(row: {
    connectionId: string
    issueIdentifier: string
    resource: string
    identifier: string
    data: string
    fetchedAt: number
  }): Promise<void>
  /**
  /**
   * Collection-level freshness for a provider resource, in core's `sync_state`. The key is
   * `provider:<providerId>:<connectionId>:...`, which `db/cascade.ts` matches on to evict a
   * disconnected integration's markers and which the store below enforces on writes.
   *
   * GitHub keeps a separate `sync_state` table in its own schema (plugins/github/src/node/schema.ts);
   * the two key spaces stay apart by ownership, not by convention.
   */
  readMarker(resource: string): Promise<number | null>
  writeMarker(resource: string, fetchedAt: number): Promise<void>
}

/**
/**
 * Scoped to one provider at construction, not per call; see docs/integrations.md § Connection
 * lifecycle for why that is what makes the ownership check at the ask (`assertOwnedProvider` in
 * plugin/requestContext.ts) the truth about every row the store can touch.
 */
export function createExternalItemStore(db: AppDatabase, userId: string, provider: string): ExternalItemStore {
  const item = (row: typeof schema.issues.$inferSelect): ExternalItemRow => ({
    integrationId: row.integrationId,
    identifier: row.identifier,
    data: row.data,
    fetchedAt: row.fetchedAt,
  })

  const markerPrefix = `provider:${provider}:`
  const ownMarker = (resource: string): string => {
    if (!resource.startsWith(markerPrefix)) {
      throw new Error(`External-item marker keys for ${provider} must start with "${markerPrefix}" — got "${resource}".`)
    }
    return resource
  }

  return {
    async read(connectionId, identifier) {
      const [row] = await db
        .select()
        .from(schema.issues)
        .where(
          and(
            eq(schema.issues.userId, userId),
            eq(schema.issues.provider, provider),
            eq(schema.issues.integrationId, connectionId),
            eq(schema.issues.identifier, identifier),
          ),
        )
      return row ? item(row) : null
    },

    async listForConnection(connectionId) {
      const rows = await db
        .select()
        .from(schema.issues)
        .where(and(eq(schema.issues.userId, userId), eq(schema.issues.integrationId, connectionId), eq(schema.issues.provider, provider)))
      return rows.map(item)
    },

    async listByIdentifier(identifiers) {
      // This signature used to be (provider, identifiers); a plugin bundle built before the store was
      // provider-scoped passes its provider id here, where it would reach `inArray` as a string and
      // die as a malformed-SQL error three layers down. Say what is actually wrong instead.
      if (!Array.isArray(identifiers)) {
        throw new TypeError(`listByIdentifier takes an array of identifiers — got ${typeof identifiers}. A plugin bundle built before the store was provider-scoped needs rebuilding (build:plugin).`)
      }
      // `inArray` with an empty list is a SQL syntax error in SQLite rather than an empty result, and
      // the caller legitimately reaches here with nothing to resolve.
      if (!identifiers.length) return []
      const rows = await db
        .select()
        .from(schema.issues)
        .where(and(eq(schema.issues.userId, userId), eq(schema.issues.provider, provider), inArray(schema.issues.identifier, identifiers)))
      return rows.map(item)
    },

    async write(row) {
      await db
        .insert(schema.issues)
        .values({ userId, integrationId: row.connectionId, provider, identifier: row.identifier, data: row.data, fetchedAt: row.fetchedAt })
        .onConflictDoUpdate({
          target: [schema.issues.userId, schema.issues.integrationId, schema.issues.identifier],
          set: { data: row.data, fetchedAt: row.fetchedAt },
        })
    },

    async readResource(connectionId, issueIdentifier, resource, identifier) {
      const [row] = await db
        .select()
        .from(schema.issueResources)
        .where(
          and(
            eq(schema.issueResources.userId, userId),
            eq(schema.issueResources.provider, provider),
            eq(schema.issueResources.integrationId, connectionId),
            eq(schema.issueResources.issueIdentifier, issueIdentifier),
            eq(schema.issueResources.resource, resource),
            eq(schema.issueResources.identifier, identifier),
          ),
        )
      return row ? { identifier: row.identifier, data: row.data, fetchedAt: row.fetchedAt } : null
    },

    async writeResource(row) {
      await db
        .insert(schema.issueResources)
        .values({
          userId,
          integrationId: row.connectionId,
          provider,
          issueIdentifier: row.issueIdentifier,
          resource: row.resource,
          identifier: row.identifier,
          data: row.data,
          fetchedAt: row.fetchedAt,
        })
        .onConflictDoUpdate({
          target: [
            schema.issueResources.userId,
            schema.issueResources.integrationId,
            schema.issueResources.issueIdentifier,
            schema.issueResources.resource,
            schema.issueResources.identifier,
          ],
          set: { data: row.data, fetchedAt: row.fetchedAt },
        })
    },

    async readMarker(resource) {
      const [row] = await db
        .select({ fetchedAt: schema.syncState.fetchedAt })
        .from(schema.syncState)
        .where(and(eq(schema.syncState.userId, userId), eq(schema.syncState.resource, ownMarker(resource))))
      return row?.fetchedAt ?? null
    },

    async writeMarker(resource, fetchedAt) {
      await db
        .insert(schema.syncState)
        .values({ userId, resource: ownMarker(resource), fetchedAt })
        .onConflictDoUpdate({ target: [schema.syncState.userId, schema.syncState.resource], set: { fetchedAt } })
    },
  }
}
