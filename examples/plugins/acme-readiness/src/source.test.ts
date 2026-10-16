import { expect, it } from 'vitest'
import { fixtures, testDerivedSource } from 'acorn-plugin-sdk/testing'
import { source } from './source'

// #region test
// `fixtures` builds core's tasks from their real fields. acme-data's source has no field list in the
// SDK, so its records are written out as `{ ref, data }`.
const deploy = (recordId: string, taskId: string, environment: string, status: string) => ({
  ref: { pluginId: 'acme-data', sourceId: 'deploys', recordId },
  data: { taskId, environment, status, sha: 'a1b2c3d', at: 1 },
})

it('names the furthest environment each task has shipped to', async () => {
  const tasks = fixtures('core:tasks', [{ title: 'Retry webhooks' }, { title: 'VAT on invoices' }])
  const [webhooks, vat] = tasks.map((task) => task.ref.recordId)
  const result = await testDerivedSource(source, {
    tasks,
    deploys: [
      deploy('d1', webhooks!, 'staging', 'succeeded'),
      deploy('d2', webhooks!, 'production', 'succeeded'),
      deploy('d3', vat!, 'staging', 'failed'),
    ],
  })
  expect(result.rows.map((row) => row.data)).toEqual([
    { title: 'Retry webhooks', stage: 'production', deploys: 2 },
    { title: 'VAT on invoices', stage: 'none', deploys: 1 },
  ])
  expect(result.dropped).toEqual([])
})
// #endregion
