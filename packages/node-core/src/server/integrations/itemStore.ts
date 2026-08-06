// The external-item read model, as a narrow store instead of a raw database handle.
//
// WHY `issues` / `issue_resources` STAYED CORE TABLES while every other plugin's tables moved out
// (docs/vNext/data.md § Plugin DBs). Two plugins — linear and rollbar — write these, and data.md is
// explicit that a table has exactly one owner, so the choice was "give one of them the table and make
// the other reach across a database file", "give each its own copy", or "keep it in core". Core wins on
// four counts, and it is worth stating them because the tempting answer is the second:
//
//   1. **The shape is core's, not a provider's.** One opaque JSON `data` column keyed by
//      `(userId, integrationId, identifier)`, where `integrationId` points at core's `integrations`. It
//      is the generic projection of "an external item some connection told us about" — a third provider
//      adds rows, not a table. Neither `linear` nor `rollbar` appears anywhere in the column list.
//   2. **`task_links` is core's, and its primary-key tail is deliberately the same
//      `(integrationId, identifier)`** so a link resolves straight to cached detail (schema.ts says so
//      at the table). Core's context assembler walks exactly that join to answer "what external items
//      is this task about?" (server/agentTools/contextSections.ts § issues). Move `issues` into a
//      plugin and that single query becomes a fan-out of per-provider capability calls that returns
//      NOTHING for a disabled plugin — the section would silently shrink rather than fail, which is the
//      worst of the available failure modes. Copy it per plugin and the question stops having one
//      answer at all.
//   3. **Disconnecting an integration stays atomic.** `db/cascade.ts` deletes `workspace_projects`,
//      `issues`, `issue_resources`, the `provider:%` freshness markers, `task_links` and the
//      `integrations` row in ONE `db.batch`. Keeping these here keeps all six inside one SQLite file,
//      so that batch is still a transaction. Splitting them turns disconnect into a cross-database saga
//      — which data.md says needs an `operations` row, and phase2-notes.md records that there is no
//      `operations` table and no other consumer that would justify inventing one for this.
//   4. **Core already owns the machinery.** `integrations/resourceRuntime.ts` runs serve-then-revalidate
//      for every provider resource, keyed on core's `integrations` row and gated by
//      `requireProviderAccess`. The plugins never opened a database; they were handed core's handle and
//      wrote raw drizzle against core's tables. The coupling to remove was the HANDLE, not the storage.
//
// So the fix is this store rather than a migration: a typed, user-scoped surface carrying only the six
// operations the two providers actually perform. `ProviderResourceContext` hands it out in place of
// `db: AppDatabase`, which is what lets both plugins stop importing `@acorn/node-core/server/db` — the
// thing tools/arch/boundaries.test.ts' schema ratchet measures — without either of them owning a table
// it shares with the other. Consequence, stated plainly rather than hidden: linear and rollbar own no
// database and therefore have no `dispose`, exactly like docker, editor and notes.
//
// Scoped to ONE userId at construction. That is not ergonomics: it means a provider plugin cannot
// address another owner's cached items even by accident, and it deletes the `eq(userId, …)` clause that
// every one of these call sites previously had to remember.
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
  listForConnection(connectionId: string, provider: string): Promise<ExternalItemRow[]>
  /**
   * The same identifiers across EVERY connection of one provider. Linear's batch enrichment needs this:
   * a bare `ENG-42` is resolved by trying each connected workspace in turn, so the read cannot be
   * scoped to a single connection before the resolution has happened.
   */
  listByIdentifier(provider: string, identifiers: string[]): Promise<ExternalItemRow[]>
  write(row: { connectionId: string; provider: string; identifier: string; data: string; fetchedAt: number }): Promise<void>
  readResource(connectionId: string, issueIdentifier: string, resource: string, identifier: string): Promise<ExternalResourceRow | null>
  writeResource(row: {
    connectionId: string
    provider: string
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
   * The key space is the caller's — `provider:<id>:<connectionId>:…` by convention, which is what
   * `cascade.ts` matches on to evict a disconnected integration's markers. github's `sync_state` is a
   * DIFFERENT table in a different file now (plugins/github/src/node/schema.ts); the two key spaces
   * used to share one table and only conventions kept them apart.
   */
  readMarker(resource: string): Promise<number | null>
  writeMarker(resource: string, fetchedAt: number): Promise<void>
}

export function createExternalItemStore(db: AppDatabase, userId: string): ExternalItemStore {
  const item = (row: typeof schema.issues.$inferSelect): ExternalItemRow => ({
    integrationId: row.integrationId,
    identifier: row.identifier,
    data: row.data,
    fetchedAt: row.fetchedAt,
  })

  return {
    async read(connectionId, identifier) {
      const [row] = await db
        .select()
        .from(schema.issues)
        .where(and(eq(schema.issues.userId, userId), eq(schema.issues.integrationId, connectionId), eq(schema.issues.identifier, identifier)))
      return row ? item(row) : null
    },

    async listForConnection(connectionId, provider) {
      const rows = await db
        .select()
        .from(schema.issues)
        .where(and(eq(schema.issues.userId, userId), eq(schema.issues.integrationId, connectionId), eq(schema.issues.provider, provider)))
      return rows.map(item)
    },

    async listByIdentifier(provider, identifiers) {
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
        .values({ userId, integrationId: row.connectionId, provider: row.provider, identifier: row.identifier, data: row.data, fetchedAt: row.fetchedAt })
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
          provider: row.provider,
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
        .where(and(eq(schema.syncState.userId, userId), eq(schema.syncState.resource, resource)))
      return row?.fetchedAt ?? null
    },

    async writeMarker(resource, fetchedAt) {
      await db
        .insert(schema.syncState)
        .values({ userId, resource, fetchedAt })
        .onConflictDoUpdate({ target: [schema.syncState.userId, schema.syncState.resource], set: { fetchedAt } })
    },
  }
}
