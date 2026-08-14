// Test-only helper, in testkit/ for the same reason node-core's is: it is scaffolding, not surface,
// and it was sitting in server/ where every import read like production code.
//
// It reaches core through @acorn/plugin-api/testkit rather than node-core's internals — the same seam a
// third-party plugin's tests get, and this file is the first thing that moved onto it. What that
// migration wanted was small and telling: core's `AppDatabase` type, because a github route test holds
// core's test database in order to seed workspaces and tasks.
import { seedProviderConnection, type AppDatabase } from '@acorn/plugin-api/testkit'
import { GITHUB_PROVIDER } from '../server/githubToken'

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
