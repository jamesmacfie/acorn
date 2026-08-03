import { and, eq } from 'drizzle-orm'
import type { AppDatabase } from '@acorn/node-core/server/db/index.ts'
import { schema } from '@acorn/node-core/server/db/index.ts'
import { decryptSecret, encryptSecret } from '@acorn/node-core/server/secretBox.ts'

const LEGACY_USER = '__legacy_unscoped__'

export class HttpStorageError extends Error {}

export async function protectHttpValue(value: string, encryptionKey: string): Promise<string> {
  return encryptSecret(value, encryptionKey)
}

export async function openHttpValue(value: string, encrypted: boolean, encryptionKey: string): Promise<string> {
  if (!encrypted) throw new HttpStorageError('Saved HTTP data has not been encrypted')
  const plaintext = await decryptSecret(value, encryptionKey)
  if (plaintext === null) throw new HttpStorageError('Saved HTTP data could not be decrypted')
  return plaintext
}

// Pre-listener upgrade for rows written by releases that stored HTTP drafts in plaintext. All
// sensitive fields are encrypted in one row update after their ciphertexts are ready. Legacy
// ownership can be recovered only when the database contains exactly one GitHub identity;
// otherwise the sentinel remains and no authenticated identity can query those rows.
export async function protectLegacyHttpStorage(db: AppDatabase, encryptionKey: string): Promise<void> {
  const [prefUsers, repoUsers] = await Promise.all([
    db.selectDistinct({ userId: schema.prefs.userId }).from(schema.prefs),
    db.selectDistinct({ userId: schema.repos.userId }).from(schema.repos),
  ])
  const identities = new Set([...prefUsers, ...repoUsers].map((row) => row.userId))
  const soleIdentity = identities.size === 1 ? [...identities][0]! : null

  const requests = await db.select().from(schema.httpRequests).where(eq(schema.httpRequests.encrypted, false))
  const variables = await db.select().from(schema.httpVariables).where(eq(schema.httpVariables.encrypted, false))

  const requestUpdates = await Promise.all(
    requests.map(async (row) => ({
      id: row.id,
      userId: row.userId === LEGACY_USER && soleIdentity ? soleIdentity : row.userId,
      url: await protectHttpValue(row.url, encryptionKey),
      headers: await protectHttpValue(row.headers, encryptionKey),
      body: await protectHttpValue(row.body, encryptionKey),
      auth: await protectHttpValue(row.auth, encryptionKey),
      vars: await protectHttpValue(row.vars, encryptionKey),
    })),
  )
  const variableUpdates = await Promise.all(
    variables.map(async (row) => {
      let plaintext = row.value
      // Secret variables were the one legacy kind already encrypted. Open and re-seal them so all
      // values now have exactly one encryption layer and corrupt credentials fail boot closed.
      if (row.kind === 'secret') {
        const opened = await decryptSecret(row.value, encryptionKey)
        if (opened === null) throw new HttpStorageError(`Secret HTTP variable "${row.name}" could not be decrypted`)
        plaintext = opened
      }
      return {
        id: row.id,
        userId: row.userId === LEGACY_USER && soleIdentity ? soleIdentity : row.userId,
        value: await protectHttpValue(plaintext, encryptionKey),
      }
    }),
  )

  const updates = [
    ...requestUpdates.map((row) =>
      db
        .update(schema.httpRequests)
        .set({ userId: row.userId, url: row.url, headers: row.headers, body: row.body, auth: row.auth, vars: row.vars, encrypted: true })
        .where(and(eq(schema.httpRequests.id, row.id), eq(schema.httpRequests.encrypted, false))),
    ),
    ...variableUpdates.map((row) =>
      db
        .update(schema.httpVariables)
        .set({ userId: row.userId, value: row.value, encrypted: true })
        .where(and(eq(schema.httpVariables.id, row.id), eq(schema.httpVariables.encrypted, false))),
    ),
  ]
  if (updates.length) await db.batch(updates as [typeof updates[number], ...typeof updates[number][]])
}
