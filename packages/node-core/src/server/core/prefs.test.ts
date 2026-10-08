import { afterEach, beforeEach, expect, it } from 'vitest'
import { WORKSPACES_PREF_KEY } from '@acorn/protocol/workspacesMode.ts'
import { schema } from '../db'
import { makeTestDb, type TestDb } from '../../testkit/db'
import { createPrefService } from './prefs'

let testDb: TestDb
beforeEach(() => { testDb = makeTestDb() })
afterEach(() => { testDb.cleanup() })

it('guards the raw preference seam and rolls back refused writes', async () => {
  const prefs = createPrefService(testDb.db)
  await expect(prefs.write('owner', WORKSPACES_PREF_KEY, 'invalid')).rejects.toMatchObject({ status: 400, code: 'bad_request' })
  expect(await prefs.read('owner', WORKSPACES_PREF_KEY)).toBeNull()
  await prefs.write('owner', WORKSPACES_PREF_KEY, 'off')
  await prefs.write('owner', WORKSPACES_PREF_KEY, 'off')
  await prefs.write('owner', WORKSPACES_PREF_KEY, 'on')
  await expect(prefs.write('owner', WORKSPACES_PREF_KEY, 'off')).rejects.toMatchObject({ status: 409, code: 'workspaces_fixed' })
  expect(await prefs.read('owner', WORKSPACES_PREF_KEY)).toBe('on')
  await prefs.write('owner', 'plugin:example:setting', 'enabled')
  expect(await prefs.read('owner', 'plugin:example:setting')).toBe('enabled')
})

it('keeps an existing project grouped before its owner has written a mode', async () => {
  testDb.db.insert(schema.workspaces).values({ id: 'default', name: 'Default', isDefault: true, sort: 0, createdAt: 1, updatedAt: 1 }).run()
  testDb.db.insert(schema.projects).values({ id: 'old', name: 'Old', workspaceId: 'default', createdAt: 1, updatedAt: 1 }).run()
  const prefs = createPrefService(testDb.db)
  await expect(prefs.write('owner', WORKSPACES_PREF_KEY, 'off')).rejects.toMatchObject({ status: 409, code: 'workspaces_fixed' })
  expect(await prefs.read('owner', WORKSPACES_PREF_KEY)).toBeNull()
  await prefs.write('owner', WORKSPACES_PREF_KEY, 'on')
  expect(await prefs.read('owner', WORKSPACES_PREF_KEY)).toBe('on')
})
