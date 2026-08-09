// The user-preference read/write seam (CoreServices.prefs).
//
// `prefs` is a CORE table — one row per (userId, key), holding non-secret app state that is ours
// rather than a provider's (server/routes/prefs.ts). Most plugin preferences never touch the node at
// all: plugins/docker reads `docker_prefs` client-side out of the prefs query, and that is the right
// shape when only the UI cares.
//
// The agents usage service reads model-pricing overrides on the Node before it prices a token count, so
// those values need a service seam in addition to the HTTP preference route.
//
// Deliberately a general (userId, key) accessor rather than one named method per preference. Built-in
// plugins receive this raw service because several core/client preference keys predate loaded plugins.
// Loaded plugins receive a `plugin:<id>:*` projection from main/pluginPermissions.ts, so they share a
// namespace with their frame without reading core or another plugin's state.
//
// What it must NOT become is a home for anything secret — credentials go through CoreServices.secrets,
// which encrypts at rest and scopes the plaintext to one use.
import { and, eq } from 'drizzle-orm'
import type { AppDatabase } from '../../../server/db'
import { schema } from '../../../server/db'

export type PrefService = {
  // null when the owner has never set this key — distinct from '' , which a caller may have written.
  read(userId: string, key: string): Promise<string | null>
  // Upsert. Same target as the HTTP route's, so a value written here is the value the client reads.
  write(userId: string, key: string, value: string): Promise<void>
}

export function createPrefService(db: AppDatabase): PrefService {
  return {
    read: async (userId, key) => {
      const [row] = await db
        .select({ value: schema.prefs.value })
        .from(schema.prefs)
        .where(and(eq(schema.prefs.userId, userId), eq(schema.prefs.key, key)))
        .limit(1)
      return row?.value ?? null
    },
    write: async (userId, key, value) => {
      await db
        .insert(schema.prefs)
        .values({ userId, key, value })
        .onConflictDoUpdate({ target: [schema.prefs.userId, schema.prefs.key], set: { value } })
    },
  }
}
