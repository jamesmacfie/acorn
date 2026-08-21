// Test-only helper, in testkit/ for the same reason node-core's is: it is scaffolding, not surface,
// and it was sitting in server/ where every import read like production code.
//
// Reaches core through @acorn/plugin-api/testkit rather than node-core's internals, the same seam a
// third-party plugin's tests get. This file is the first thing that moved onto it, wanting only
// core's `AppDatabase` type, because a github route test holds core's test database in order to seed
// workspaces and tasks.
import { seedProviderConnection, type AppDatabase } from '@acorn/plugin-api/testkit'
import { GITHUB_PROVIDER } from '../server/githubToken'

// The credential half of the mount contract for github route tests, alongside node-core's testDb and
// testAuth. It is a one-line binding of this plugin's provider id onto core's seeding helper: the row
// being seeded lives in core's `integrations` table, which this plugin does not own, so the insert
// belongs on core's side of the seam (server/routes/testIntegration.ts). `AppDatabase` is core's
// handle, not github's, for the same reason.
export const seedGithubIntegration = (
  db: AppDatabase,
  userId: string,
  token: string,
  encryptionKey: string,
): Promise<void> => seedProviderConnection(db, GITHUB_PROVIDER, userId, token, encryptionKey)
