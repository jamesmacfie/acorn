import { afterEach, beforeEach, expect, it } from 'vitest'
import { createApp } from '../index'
import { makeTestDb, testEnv, type TestDb } from '../../testkit/db'
import { mintInternalToken } from '../auth/internalTokens'

let db: TestDb
const app = createApp()
const key = 'dashboards-test-key'
beforeEach(() => {
  db = makeTestDb()
})
afterEach(() => db.cleanup())

const asTask = (path: string, init: RequestInit = {}) =>
  app.request(
    path,
    {
      ...init,
      headers: { ...init.headers, 'x-acorn-internal': mintInternalToken(key, { scope: 'task', taskId: 'own' }) },
    },
    testEnv({
      DB: db.db,
      INTERNAL_TOKEN: key,
      ACTIVE_IDENTITY: { get: () => 'owner', set: () => {}, clear: () => {} },
    }),
  )

// A panel id carries no workspace, so the only safe answer to a task token is none at all.
it('refuses a task token on panel history and on the dashboard library', async () => {
  expect((await asTask('/v1/core/dashboards/history?panelId=another-workspaces-panel')).status).toBe(403)
  const list = await asTask('/v1/core/dashboards/list', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ operation: 'list', scope: { kind: 'workspace', workspaceId: 'w' } }),
  })
  expect(list.status).toBe(403)
})
