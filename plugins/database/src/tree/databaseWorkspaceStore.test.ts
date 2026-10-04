import { expect, it } from 'vitest'
import type { AcornBridge } from '@acorn/plugin-api/ui/sdk'
import { loadDatabaseWorkspace, saveDatabaseWorkspace, type DatabaseWorkspace } from './databaseWorkspaceStore'

it('restores complete results larger than one bridge value, including multibyte cells and NULL', async () => {
  const values = new Map<string, unknown>()
  const state: AcornBridge['state'] = {
    get: async <T>(key: string) => (values.get(key) ?? null) as T | null,
    set: async (key, value) => {
      if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 1024 * 1024) throw new Error('Bridge value too large')
      values.set(key, structuredClone(value))
    },
  }
  const largeCell = 'é🪴'.repeat(180_000)
  const workspace: DatabaseWorkspace = {
    dbName: 'dev', tables: [], filter: 'accounts', selected: null, columns: [],
    result: { columns: ['body', 'optional'], rows: [[largeCell, null]], rowCount: 1, command: 'SELECT' },
    resultTable: null, footer: 'SELECT · 1 rows', activeRow: 0, loadedName: '', savedQueries: [],
    modelBackends: [], inserting: false, rowDraft: null,
  }
  await saveDatabaseWorkspace(state, 'task-a', workspace)
  expect(await loadDatabaseWorkspace(state, 'task-a')).toEqual(workspace)
  expect(await loadDatabaseWorkspace(state, 'task-b')).toBeUndefined()

  // Interrupted writes must not splice an older result into a newer one.
  const partKey = [...values.keys()].find((key) => key.includes(':part:'))!
  const part = values.get(partKey) as { revision: string; text: string }
  values.set(partKey, { ...part, revision: 'another-save' })
  expect(await loadDatabaseWorkspace(state, 'task-a')).toBeUndefined()
})
