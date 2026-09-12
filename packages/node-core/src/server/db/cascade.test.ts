import { afterEach, describe, expect, it } from 'vitest'
import { pluginStateKey } from '@acorn/protocol/plugin/state.ts'
import { makeTestDb, type TestDb } from '../../testkit/db'
import { cascadeDeletePluginData } from './cascade'
import { schema } from './index'

// The purge half of an uninstall (docs/plugins.md § Uninstalling). This exists because
// `dataPurged: true` used to be audited over rows that were still there.
describe('cascadeDeletePluginData', () => {
  let core: TestDb
  afterEach(() => core?.cleanup())

  it('takes the plugin’s prefs and schedule rows, and leaves everything else', async () => {
    core = makeTestDb()
    await core.db.insert(schema.prefs).values([
      { userId: 'u1', key: pluginStateKey('ntfy', 'board'), value: '1' },
      { userId: 'u2', key: pluginStateKey('ntfy', 'board'), value: '2' },
      // A second plugin whose id starts with the same letters, and a core key. Neither may move.
      { userId: 'u1', key: pluginStateKey('ntfy-pro', 'board'), value: '3' },
      { userId: 'u1', key: 'core:task-layouts', value: '{}' },
    ])
    await core.db.insert(schema.scheduleState).values([
      { key: 'ntfy:sweep', nextRunAt: 0 },
      { key: 'ntfy-pro:sweep', nextRunAt: 0 },
      { key: 'core:measures', nextRunAt: 0 },
    ])
    await core.db.insert(schema.scheduleRuns).values([
      { key: 'ntfy:sweep', startedAt: 1, status: 'ok' },
      { key: 'core:measures', startedAt: 1, status: 'ok' },
    ])

    await cascadeDeletePluginData(core.db, 'ntfy')

    expect((await core.db.select().from(schema.prefs)).map((row) => row.key).sort())
      .toEqual(['core:task-layouts', pluginStateKey('ntfy-pro', 'board')])
    expect((await core.db.select().from(schema.scheduleState)).map((row) => row.key).sort())
      .toEqual(['core:measures', 'ntfy-pro:sweep'])
    expect((await core.db.select().from(schema.scheduleRuns)).map((row) => row.key)).toEqual(['core:measures'])
  })
})
