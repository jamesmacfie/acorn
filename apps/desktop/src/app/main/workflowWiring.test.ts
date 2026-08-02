import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { schema } from '@acorn/node-core/server/db/index.ts'
import { makeTestDb, type TestDb } from '@acorn/node-core/server/routes/testDb.ts'
import { failingChecksFor } from './workflowWiring'

describe('workflow mirror identity', () => {
  let testDb: TestDb

  beforeEach(async () => {
    testDb = makeTestDb()
    await testDb.db.insert(schema.tasks).values({
      id: 'task-1',
      title: 'Review',
      origin: 'github-pr',
      repoOwner: 'acme',
      repoName: 'web',
      branch: 'feature',
      pullNumber: 7,
      status: 'active',
      sort: 0,
      createdAt: 1,
      updatedAt: 1,
    })
    await testDb.db.insert(schema.repos).values([
      { userId: 'alice', id: 10, owner: 'acme', name: 'web', private: true, fetchedAt: 1 },
      { userId: 'bob', id: 10, owner: 'acme', name: 'web', private: true, fetchedAt: 1 },
    ])
    await testDb.db.insert(schema.checks).values([
      { userId: 'alice', repoId: 10, number: 7, name: 'alice-check', status: 'failure' },
      { userId: 'bob', repoId: 10, number: 7, name: 'bob-check', status: 'success' },
    ])
  })

  afterEach(() => testDb.cleanup())

  it('reads checks only from the explicitly active GitHub identity', async () => {
    expect(await failingChecksFor(testDb.db, 'alice', 'task-1')).toBe('- alice-check: failure')
    expect(await failingChecksFor(testDb.db, 'bob', 'task-1')).toBe('')
    expect(await failingChecksFor(testDb.db, null, 'task-1')).toBeNull()
  })
})
