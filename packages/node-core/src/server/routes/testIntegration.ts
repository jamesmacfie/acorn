import { randomUUID } from 'node:crypto'
import { SecretService } from '../../main/core/secrets'
import { schema, type AppDatabase } from '../db'

// Seed a stored provider connection, for route tests that need a credential the route will actually read.
// Alongside testDb and testAuth, and in core for the same reason as both: `integrations` is CORE's table.
//
// It exists because a provider credential is no longer part of the caller's identity. A route test used to
// get one for free by putting `token: 'gh'` on the principal; a device principal has no provider
// credential, so a test that asserts the provider client was called with a token has to seed the row the
// route reads. Seeding through the real `SecretService.seal` keeps that assertion honest: it exercises the
// same decrypt path production does, rather than a shortcut that would keep passing if the encryption broke.
//
// This lived in plugins/github as `seedGithubIntegration` until Phase 2. It moved here when that plugin
// took ownership of its own database: the helper is not a `*.test.ts` file, so leaving it in the plugin
// would have kept github on the schema ratchet for a table it does not own — and every provider plugin
// needs the same seeding, so `providerId` is a parameter rather than a hardcoded 'github'.
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
