import type { AppDatabase } from '@acorn/node-core/server/db/index.ts'
import { seedProviderConnection } from '@acorn/node-core/server/routes/testIntegration.ts'
import { GITHUB_PROVIDER } from './githubToken'

// The credential half of the mount contract for github route tests, alongside node-core's testDb and
// testAuth. It is now a one-line binding of this plugin's provider id onto core's seeding helper: the row
// being seeded lives in core's `integrations` table, which this plugin does not own, so the INSERT belongs
// on core's side of the seam (server/routes/testIntegration.ts).
//
// The `AppDatabase` type import is deliberate and is core's handle, not github's — the caller is a test
// that already holds core's test database in order to seed workspaces and tasks.
export const seedGithubIntegration = (
  db: AppDatabase,
  userId: string,
  token: string,
  encryptionKey: string,
): Promise<void> => seedProviderConnection(db, GITHUB_PROVIDER, userId, token, encryptionKey)
