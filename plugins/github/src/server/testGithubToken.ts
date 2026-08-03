import { randomUUID } from 'node:crypto'
import { schema, type AppDatabase } from '@acorn/node-core/server/db/index.ts'
import { SecretService } from '@acorn/node-core/main/core/secrets.ts'
import { GITHUB_PROVIDER } from './githubToken'

// The credential half of the mount contract for github route tests, alongside node-core's testDb and
// testAuth.
//
// It exists because the GitHub token is no longer part of the caller's identity. A route test used to
// get one for free by putting `token: 'gh'` on the principal; a device principal has no provider
// credential, so a test that asserts `gh()` was called with a token now has to seed the row the route
// actually reads. Seeding it through the real encryptSecret keeps that assertion honest: it exercises
// the same decrypt path production does, rather than a shortcut that would keep passing if the
// encryption broke.
export async function seedGithubIntegration(
  db: AppDatabase,
  userId: string,
  token: string,
  encryptionKey: string,
): Promise<void> {
  const now = Date.now()
  await db.insert(schema.integrations).values({
    id: randomUUID(),
    userId,
    provider: GITHUB_PROVIDER,
    label: userId,
    authRef: await new SecretService(encryptionKey).seal(token),
    authKind: 'oauth',
    createdAt: now,
    updatedAt: now,
  })
}
