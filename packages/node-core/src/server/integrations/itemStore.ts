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
  /** Every item this connection has cached — the membership read behind a provider's list resource. */
  listForConnection(connectionId: string): Promise<ExternalItemRow[]>
  /**
   * The same identifiers across EVERY connection of the provider. Linear's batch enrichment needs
   * this: a bare `ENG-42` is resolved by trying each connected workspace in turn, so the read cannot
   * be scoped to a single connection before the resolution has happened.
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
   * Collection-level freshness for a provider resource, in core's `sync_state`. A list endpoint's
   * fetch time has no per-row home, and a provider's list membership is defined as "the rows stamped
   * with THIS marker's time" (docs/caching.md), so the marker has to be readable beside the items.
   *
   * The key space is `provider:<providerId>:<connectionId>:…` — which is what `db/cascade.ts` matches
   * on to evict a disconnected integration's markers, and what the store now ENFORCES (see below).
   * github's `sync_state` is a different table in a different file (plugins/github/src/node/schema.ts);
   * the key spaces are kept separate by ownership rather than convention.
   */
  readMarker(resource: string): Promise<number | null>
  writeMarker(resource: string, fetchedAt: number): Promise<void>
}

/**
 * Scoped to ONE provider at construction, not per call. The ownership check at the ask
 * (`assertOwnedProvider` in plugin/requestContext.ts) gates who can build a store; baking the
 * provider in here is what makes that check the truth about every row the store can touch —
 * otherwise a store built for `linear` could pass `github` to a method and read or write another
 * provider's cache. Every query below carries the provider, and a marker key outside the provider's
 * own `provider:<id>:` namespace is refused rather than written.
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
