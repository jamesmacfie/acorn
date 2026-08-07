// Test-only helper. See testkit/db.ts for why this directory exists.
import { randomUUID } from 'node:crypto'
import { SecretService } from '../main/core/secrets'
import { schema, type AppDatabase } from '../server/db'

export async function seedProviderConnection(
  db: AppDatabase,
  providerId: string,
  userId: string,
  token: string,
  encryptionKey: string,
  authKind = 'oauth',
): Promise<void> {
  const now = Date.now()
  await db.insert(schema.integrations).values({
    id: randomUUID(),
    userId,
    provider: providerId,
    label: userId,
    authRef: await new SecretService(encryptionKey).seal(token),
    authKind,
    createdAt: now,
    updatedAt: now,
  })
}
