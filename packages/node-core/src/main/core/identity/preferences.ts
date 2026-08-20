// The user-preference read/write seam (CoreServices.prefs).
//
// `prefs` is a core table, one row per (userId, key), holding non-secret app state that's ours rather
// than a provider's. Most plugin preferences never touch the node: plugins/docker reads `docker_prefs`
// client-side out of the prefs query, which is the right shape when only the UI cares. The agents usage
// service reads model-pricing overrides on the node before pricing a token count, so those need a
// service seam as well as the HTTP route.
//
// A general (userId, key) accessor rather than one named method per preference. Built-in plugins get
// this raw service because several core and client preference keys predate loaded plugins. Loaded
// plugins get a `plugin:<id>:*` projection from main/pluginPermissions.ts, so they share a namespace
// with their frame without reading core or another plugin's state.
//
// Never a home for anything secret: credentials go through CoreServices.secrets, which encrypts at rest
// and scopes the plaintext to one use.
import { and, eq } from 'drizzle-orm'
import type { AppDatabase } from '../../../server/db'
import { schema } from '../../../server/db'

export type PrefService = {
  // null when the owner has never set this key, which differs from '', a value a caller may have written.
  read(userId: string, key: string): Promise<string | null>
  // Upsert, at the same target as the HTTP route's, so a value written here is the value the client reads.
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
