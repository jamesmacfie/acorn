import { Hono } from 'hono'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { pluginStateKey } from '@acorn/protocol/plugin/state.ts'
import { makeTestDb, testEnv, type TestDb } from '../../testkit/db'
import { writePreference } from '../core/prefs'
import type { AppEnv } from '../middleware/auth'
import { prefs } from './prefs'

let db: TestDb
beforeEach(() => {
  db = makeTestDb()
})
afterEach(() => db.cleanup())

const read = async (query = '') => {
  const app = new Hono<AppEnv>()
    .use('*', async (c, next) => {
      c.set('principal', { kind: 'device', userId: 'u1', deviceId: 'd1' })
      await next()
    })
    .route('/v1/core/prefs', prefs)
  const res = await app.request(`/v1/core/prefs${query}`, {}, testEnv({ DB: db.db }))
  return res.json() as Promise<Record<string, string>>
}

// One plugin's state can be megabytes, such as a database pane's last result set, and every window reads
// the whole map at launch.
it('leaves plugin state out of the whole map and answers one key on request', async () => {
  const snapshot = pluginStateKey('database', 'workspace:v1:task-1')
  writePreference(db.db, 'u1', 'theme', 'dark')
  writePreference(db.db, 'u1', snapshot, JSON.stringify({ rows: 'x'.repeat(100_000) }))
  writePreference(db.db, 'u2', 'theme', 'light')

  expect(await read()).toEqual({ theme: 'dark' })
  expect(Object.keys(await read(`?key=${encodeURIComponent(snapshot)}`))).toEqual([snapshot])
  expect(await read('?key=theme')).toEqual({ theme: 'dark' })
  expect(await read('?key=missing')).toEqual({})
})
