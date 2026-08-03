import { and, eq } from 'drizzle-orm'
import type { IdentityService } from '@acorn/node-core/main/core/index.ts'
import type { PluginDatabase } from '@acorn/node-core/main/pluginStorage.ts'
import { SecretUnavailableError, type SecretService } from '@acorn/node-core/main/core/secrets.ts'
import { httpRequests, httpVariables } from '../node/schema'

const LEGACY_USER = '__legacy_unscoped__'

export class HttpStorageError extends Error {}

export async function protectHttpValue(value: string, secrets: SecretService): Promise<string> {
  return secrets.seal(value)
}

// reveal(), and deliberately so: this is the API panel's OWN saved data being handed back to the
// owner who typed it. docs/vNext/security.md § Secrets names that exemption explicitly ("The
// user-facing HTTP client pane is exempt by design… but is owner-invoked only"), and the router
// enforces the owner-invoked half by requiring a `device` principal.
export async function openHttpValue(value: string, encrypted: boolean, secrets: SecretService): Promise<string> {
  if (!encrypted) throw new HttpStorageError('Saved HTTP data has not been encrypted')
  try {
    return await secrets.reveal(value, 'http panel: saved request field')
  } catch (error) {
    if (error instanceof SecretUnavailableError) throw new HttpStorageError('Saved HTTP data could not be decrypted')
    throw error
  }
}

// Pre-listener upgrade for rows written by releases that stored HTTP drafts in plaintext. All
// sensitive fields are encrypted in one row update after their ciphertexts are ready. Legacy
// ownership can be recovered only when the node knows exactly one identity; otherwise the sentinel
// remains and no authenticated identity can query those rows.
//
// It runs from this plugin's init (node/index.ts) rather than from apps/node/src/wiring/startupSecurity.ts,
// which is where it lived while the app owned this plugin's tables. NodePlugin.init is awaited before the
// listener binds — the property this migration has always depended on — so the move is a relocation, not
// a change in ordering guarantees.
//
// `identity` is CoreServices.identity, not two queries. This function used to compute the sole identity
// itself by reading core's `prefs` AND github's `repos` with core's database handle: the first a plugin
// reading a core table, the second a plugin reading ANOTHER PLUGIN's table. Neither is reachable now, and
// "which identities does this node know?" was never this plugin's question to answer.
export async function protectLegacyHttpStorage(db: PluginDatabase, secrets: SecretService, identity: IdentityService): Promise<void> {
  const soleIdentity = await identity.sole()

  const requests = await db.select().from(httpRequests).where(eq(httpRequests.encrypted, false))
  const variables = await db.select().from(httpVariables).where(eq(httpVariables.encrypted, false))

  const requestUpdates = await Promise.all(
    requests.map(async (row) => ({
      id: row.id,
      userId: row.userId === LEGACY_USER && soleIdentity ? soleIdentity : row.userId,
      url: await protectHttpValue(row.url, secrets),
      headers: await protectHttpValue(row.headers, secrets),
      body: await protectHttpValue(row.body, secrets),
      auth: await protectHttpValue(row.auth, secrets),
      vars: await protectHttpValue(row.vars, secrets),
    })),
  )
  const variableUpdates = await Promise.all(
    variables.map(async (row) => {
      let plaintext = row.value
      // Secret variables were the one legacy kind already encrypted. Open and re-seal them so all
      // values now have exactly one encryption layer and corrupt credentials fail boot closed.
      if (row.kind === 'secret') {
        const opened = await secrets.reveal(row.value, 'http panel: legacy migration').catch(() => null)
        if (opened === null) throw new HttpStorageError(`Secret HTTP variable "${row.name}" could not be decrypted`)
        plaintext = opened
      }
      return {
        id: row.id,
        userId: row.userId === LEGACY_USER && soleIdentity ? soleIdentity : row.userId,
        value: await protectHttpValue(plaintext, secrets),
      }
    }),
  )

  const updates = [
    ...requestUpdates.map((row) =>
      db
        .update(httpRequests)
        .set({ userId: row.userId, url: row.url, headers: row.headers, body: row.body, auth: row.auth, vars: row.vars, encrypted: true })
        .where(and(eq(httpRequests.id, row.id), eq(httpRequests.encrypted, false))),
    ),
    ...variableUpdates.map((row) =>
      db
        .update(httpVariables)
        .set({ userId: row.userId, value: row.value, encrypted: true })
        .where(and(eq(httpVariables.id, row.id), eq(httpVariables.encrypted, false))),
    ),
  ]
  if (updates.length) await db.batch(updates as [typeof updates[number], ...typeof updates[number][]])
}
