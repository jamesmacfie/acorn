import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { schema } from '../../../core/server/db'
import { makeTestDb, type TestDb } from '../../../core/server/routes/testDb'
import { deleteRepoMirrorStatements, pruneOrphanedGithubMirror } from './mirrorRetention'

const USER = 'octocat'

describe('GitHub mirror retention repair', () => {
  let testDb: TestDb

  beforeEach(() => {
    testDb = makeTestDb()
  })

  afterEach(() => testDb.cleanup())

  it('deletes children without a PR and PR lineages without a repository', async () => {
    await testDb.db.insert(schema.repos).values({
      userId: USER,
      id: 1,
      owner: 'acme',
      name: 'web',
      private: true,
      fetchedAt: 1,
    })
    await testDb.db.insert(schema.pullRequests).values([
      { userId: USER, repoId: 1, number: 1, state: 'open', title: 'valid', fetchedAt: 1 },
      { userId: USER, repoId: 999, number: 3, state: 'open', title: 'orphan repo', fetchedAt: 1 },
    ])
    await testDb.db.insert(schema.comments).values([
      { userId: USER, repoId: 1, number: 1, id: 'valid', body: 'keep' },
      { userId: USER, repoId: 1, number: 2, id: 'orphan-pr', body: 'remove' },
      { userId: USER, repoId: 999, number: 3, id: 'orphan-repo', body: 'remove' },
    ])
    await testDb.db.insert(schema.checks).values({
      userId: USER,
      repoId: 1,
      number: 2,
      name: 'orphan-check',
      status: 'failure',
    })

    expect(await pruneOrphanedGithubMirror(testDb.db)).toEqual({ removedPulls: 2 })

    expect((await testDb.db.select().from(schema.pullRequests)).map((row) => row.number)).toEqual([1])
    expect((await testDb.db.select().from(schema.comments)).map((row) => row.id)).toEqual(['valid'])
    expect(await testDb.db.select().from(schema.checks)).toEqual([])
  })

  it('deletes the full PR lineage when a repository leaves the refreshed repo list', async () => {
    await testDb.db.insert(schema.pullRequests).values({
      userId: USER,
      repoId: 99,
      number: 4,
      state: 'open',
      title: 'removed repo',
      fetchedAt: 1,
    })
    await testDb.db.insert(schema.prFiles).values({
      userId: USER,
      repoId: 99,
      number: 4,
      path: 'private.ts',
    })
    await testDb.db.insert(schema.reviews).values({
      userId: USER,
      repoId: 99,
      number: 4,
      id: 'review',
      body: 'private review',
    })

    const statements = deleteRepoMirrorStatements(testDb.db, USER, [99])
    await testDb.db.batch(statements as [typeof statements[number], ...typeof statements[number][]])

    expect(await testDb.db.select().from(schema.pullRequests)).toEqual([])
    expect(await testDb.db.select().from(schema.prFiles)).toEqual([])
    expect(await testDb.db.select().from(schema.reviews)).toEqual([])
  })
})
