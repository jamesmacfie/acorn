import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { memoryIdentityStore } from '../../main/activeIdentity'
import { makeTestDb, testEnv, type TestDb } from '../../testkit/db'
import { idempotencyStore } from '../auth/idempotency'
import { schema } from '../db'
import { createScheduler } from './index'

// What core itself puts on the scheduler, and the one thing that decides it: whether the composition
// root handed over the node's bindings (docs/schedules.md § What is registered today). Every entry
// here replaced a boot-time call or an invisible interval, and the failure mode of getting it wrong
// is silence: a node that boots fine and quietly stops doing its housekeeping.

let test: TestDb
beforeEach(() => (test = makeTestDb()))
afterEach(() => test.cleanup())

const keys = async (scheduler: { list: () => Promise<{ key: string }[]> }): Promise<string[]> =>
  (await scheduler.list()).map((row) => row.key).sort()

describe('what core declares', () => {
  it('declares only the pure-database job without env', async () => {
    // A scheduler built without bindings is a test's scheduler. The three jobs below all reach out of
    // the process, into plugin routes and the identity store, so declaring them here would mean a
    // suite firing real work at a temp data root.
    expect(await keys(createScheduler(test.db))).toEqual(['core:audit-prune'])
  })

  it('declares the housekeeping and sampling jobs when the composition root passes env', async () => {
    const scheduler = createScheduler(test.db, { env: testEnv({ DB: test.db, ACTIVE_IDENTITY: memoryIdentityStore('owner-1') }) })
    expect(await keys(scheduler)).toEqual([
      'core:audit-prune',
      'core:compact-history',
      'core:idempotency-sweep',
      'core:sample-measures',
    ])
  })

  it('actually reclaims expired replay rows when the sweep runs', async () => {
    // The point of the migration, in one assertion: this used to be a boot-time call, so a node left
    // running for months never reclaimed a single row. Expired rows already read as absent, which is
    // why this is about space and why it went unnoticed.
    const now = Date.now()
    // `testEnv` fills in secrets and nothing else, so the store is supplied explicitly, the same one
    // `makeBindings` constructs, over this suite's database.
    const env = testEnv({ DB: test.db, ACTIVE_IDENTITY: memoryIdentityStore('owner-1'), IDEMPOTENCY: idempotencyStore(test.db) })
    await test.db.insert(schema.idempotency).values([
      { deviceId: 'd1', key: 'stale', requestHash: 'h', responseStatus: 200, responseBody: '{}', createdAt: now - 200_000, expiresAt: now - 100_000 },
      { deviceId: 'd1', key: 'live', requestHash: 'h', responseStatus: 200, responseBody: '{}', createdAt: now, expiresAt: now + 100_000 },
    ])

    const scheduler = createScheduler(test.db, { env })
    await scheduler.start()
    try {
      await scheduler.runNow('core:idempotency-sweep')
      const rows = await test.db.select({ key: schema.idempotency.key }).from(schema.idempotency)
      expect(rows.map((row) => row.key)).toEqual(['live'])
      expect((await scheduler.runs('core:idempotency-sweep'))[0]).toMatchObject({ status: 'ok' })
    } finally {
      await scheduler.stop()
    }
  })
})
