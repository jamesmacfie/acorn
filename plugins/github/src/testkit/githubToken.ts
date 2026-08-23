// Test-only helper. It lives in testkit/ because it is scaffolding, not surface.
//
// Reaches core through @acorn/plugin-api/testkit rather than node-core's internals, the same seam a
// third-party plugin's tests get. It wants only core's `AppDatabase` type, because a github route
// test holds core's test database to seed workspaces and tasks.
import { seedProviderConnection, type AppDatabase } from '@acorn/plugin-api/testkit'
import { GITHUB_PROVIDER } from '../server/githubToken'

// The credential half of the mount contract for github route tests, alongside node-core's testDb and
// testAuth. It binds this plugin's provider id onto core's seeding helper. The seeded row lives in
// core's `integrations` table, which this plugin does not own, so the insert stays on core's side of
// the seam (server/routes/testIntegration.ts), and `AppDatabase` is core's handle.
export const seedGithubIntegration = (
  db: AppDatabase,
  userId: string,
  token: string,
  encryptionKey: string,
): Promise<void> => seedProviderConnection(db, GITHUB_PROVIDER, userId, token, encryptionKey)
