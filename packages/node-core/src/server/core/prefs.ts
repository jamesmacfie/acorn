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
// plugins get a `plugin:<id>:*` projection from server/plugins/permissions.ts, so they share a namespace
// with their frame without reading core or another plugin's state.
//
// Never a home for anything secret: credentials go through CoreServices.secrets, which encrypts at rest
// and scopes the plaintext to one use.
import { and, eq } from 'drizzle-orm'
import { WORKSPACES_PREF_KEY } from '@acorn/protocol/workspacesMode.ts'
import type { AppDatabase } from '../db'
import { schema } from '../db'
import { projectCount, storedWorkspacesMode } from '../workspacesMode'

export class PreferenceWriteError extends Error {
  constructor(readonly status: 400 | 409, readonly code: 'bad_request' | 'workspaces_fixed', message: string) {
    super(message)
  }
}

/** Validate and write in one synchronous transaction so no project can settle the mode between them. */
export function writePreference(db: AppDatabase, userId: string, key: string, value: string): void {
  db.transaction((tx) => {
    if (key === WORKSPACES_PREF_KEY) {
      if (value !== 'on' && value !== 'off') {
        throw new PreferenceWriteError(400, 'bad_request', 'core.workspaces must be on or off.')
      }
      const stored = storedWorkspacesMode(tx, userId)
      if (stored !== null && stored !== value) {
        throw new PreferenceWriteError(409, 'workspaces_fixed', 'Workspace mode is fixed once set.')
      }
      if (stored === null && projectCount(tx) > 0 && value !== 'on') {
        throw new PreferenceWriteError(409, 'workspaces_fixed', 'Existing projects use grouped workspaces.')
      }
    }
    tx.insert(schema.prefs).values({ userId, key, value })
      .onConflictDoUpdate({ target: [schema.prefs.userId, schema.prefs.key], set: { value } }).run()
  })
}

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
      writePreference(db, userId, key, value)
    },
  }
}
