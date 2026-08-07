import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestPluginDb, type TestPluginDb } from '@acorn/node-core/testkit/db.ts'
import { migrationsDir } from '../node/migrations'
import { deleteRepoMirrorStatements, pruneOrphanedGithubMirror } from './mirrorRetention'
import { checks, comments, prFiles, pullRequests, repos, reviews } from '../node/schema'

const USER = 'octocat'

// This plugin's OWN migrated SQLite file, not core's: retention only ever touches github's mirror
// tables, which live in <data-root>/plugins/github.sqlite now. Core's handle would not even have the
// tables to seed.
describe('GitHub mirror retention repair', () => {
  let testDb: TestPluginDb

  beforeEach(() => {
    testDb = makeTestPluginDb('github', migrationsDir())
  })

  afterEach(() => testDb.cleanup())

  it('deletes children without a PR and PR lineages without a repository', async () => {
    await testDb.db.insert(repos).values({
      userId: USER,
      id: 1,
      owner: 'acme',
      name: 'web',
      private: true,
      fetchedAt: 1,
    })
    await testDb.db.insert(pullRequests).values([
      { userId: USER, repoId: 1, number: 1, state: 'open', title: 'valid', fetchedAt: 1 },
      { userId: USER, repoId: 999, number: 3, state: 'open', title: 'orphan repo', fetchedAt: 1 },
    ])
    await testDb.db.insert(comments).values([
      { userId: USER, repoId: 1, number: 1, id: 'valid', body: 'keep' },
      { userId: USER, repoId: 1, number: 2, id: 'orphan-pr', body: 'remove' },
      { userId: USER, repoId: 999, number: 3, id: 'orphan-repo', body: 'remove' },
    ])
    await testDb.db.insert(checks).values({
      userId: USER,
      repoId: 1,
      number: 2,
      name: 'orphan-check',
      status: 'failure',
    })

    expect(await pruneOrphanedGithubMirror(testDb.db)).toEqual({ removedPulls: 2 })

    expect((await testDb.db.select().from(pullRequests)).map((row) => row.number)).toEqual([1])
    expect((await testDb.db.select().from(comments)).map((row) => row.id)).toEqual(['valid'])
    expect(await testDb.db.select().from(checks)).toEqual([])
  })

  it('deletes the full PR lineage when a repository leaves the refreshed repo list', async () => {
    await testDb.db.insert(pullRequests).values({
      userId: USER,
      repoId: 99,
      number: 4,
      state: 'open',
      title: 'removed repo',
      fetchedAt: 1,
    })
    await testDb.db.insert(prFiles).values({
      userId: USER,
      repoId: 99,
      number: 4,
      path: 'private.ts',
    })
    await testDb.db.insert(reviews).values({
      userId: USER,
      repoId: 99,
      number: 4,
      id: 'review',
      body: 'private review',
    })

    const statements = deleteRepoMirrorStatements(testDb.db, USER, [99])
    await testDb.db.batch(statements as [typeof statements[number], ...typeof statements[number][]])

    expect(await testDb.db.select().from(pullRequests)).toEqual([])
    expect(await testDb.db.select().from(prFiles)).toEqual([])
    expect(await testDb.db.select().from(reviews)).toEqual([])
  })
})
