import { Hono } from 'hono'
import { datasetCorrectionSchema, datasetCreateSchema, datasetDrilldownSchema, datasetIdSchema, datasetVersionSchema } from '@acorn/protocol/datasets.ts'
import type { AppEnv } from '../middleware/auth'
import { requireDevice } from '../middleware/requireUser'
import { getDb } from '../db'
import { respondError } from '../respond'
import { resolveQuery } from '../queries/runtime'
import { validatePanelPlan } from '@acorn/dashboards-core/plan.ts'

/** Definitions and corrections require a device. This route is absent from plugin frame bridges. */
export const datasetsRoute = new Hono<AppEnv>()
  .use('*', requireDevice)
  .get('/', async c => {
    const { listDatasets, listAllDatasets } = await import('../datasets/store')
    const workspaceId = c.req.query('workspaceId')
    const db = getDb(c.env)
    if (workspaceId) return c.json({ datasets: listDatasets(db, workspaceId, c.req.query('projectId')) })
    return c.json({ datasets: listAllDatasets(db) })
  })
  .post('/', async c => {
    const { createDataset } = await import('../datasets/store')
    const parsed = datasetCreateSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'invalid-request', parsed.error.issues.map(issue => issue.message))
    try {
      const input = parsed.data
      if (input.captureQuery && (input.captureQuery.scope.workspaceId !== input.workspaceId
        || input.captureQuery.scope.projectId !== input.projectId)) return respondError(c, 400, 'invalid-request')
      const dataset = createDataset(getDb(c.env), input)
      return c.json({ dataset }, 201)
    } catch (error) { return datasetError(c, error) }
  })
  .post('/version', async c => {
    const { addDatasetVersion, getDataset } = await import('../datasets/store')
    const parsed = datasetVersionSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'invalid-request')
    try {
      const db = getDb(c.env), dataset = getDataset(db, parsed.data.datasetId)
      return c.json({ version: addDatasetVersion(db, dataset, parsed.data.schema, parsed.data.fields) })
    } catch (error) { return datasetError(c, error) }
  })
  .post('/correct', async c => {
    const { correctDatasetRow, getDataset } = await import('../datasets/store')
    const parsed = datasetCorrectionSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'invalid-request')
    try {
      const db = getDb(c.env), dataset = getDataset(db, parsed.data.datasetId)
      if (dataset.feeder !== 'agent') return respondError(c, 400, 'invalid-request')
      correctDatasetRow(db, dataset, parsed.data.identity, parsed.data.value)
      return c.json({ ok: true })
    } catch (error) { return datasetError(c, error) }
  })
  .post('/drilldown', async c => {
    const [{ getDataset, assertDatasetScope }, { datasetIdFromSource, datasetSourceDescription }] = await Promise.all([
      import('../datasets/store'), import('../datasets/source'),
    ])
    const parsed = datasetDrilldownSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'invalid-request')
    try {
      const input = parsed.data
      if (input.plan.sources.length !== 1 || input.plan.relations?.length) return respondError(c, 400, 'invalid-request')
      const source = input.plan.sources[0]!
      const invocation = { principal: c.get('principal')!, signal: c.req.raw.signal }
      const resolved = await resolveQuery(c.env, input.scope, source.reference, {}, invocation)
      const id = resolved.query.source.pluginId === 'core' ? datasetIdFromSource(resolved.query.source.sourceId) : null
      if (!id) return respondError(c, 400, 'invalid-request')
      const db = getDb(c.env), dataset = getDataset(db, id)
      assertDatasetScope(dataset, input.scope.workspaceId, input.scope.projectId)
      const description = datasetSourceDescription(db, dataset)
      if (validatePanelPlan(input.plan, [{ instanceId: source.id, label: source.label, query: resolved.query, description }]).some(problem => problem.severity === 'error')) {
        return respondError(c, 400, 'invalid-request')
      }
      const { datasetDrilldown } = await import('../datasets/summarySql')
      return c.json(datasetDrilldown(db, dataset, input.plan, resolved.query, description, input.groupValues, input.measureId))
    } catch (error) { return datasetError(c, error) }
  })
  .delete('/:datasetId', async c => {
    const { assertDatasetScope, deleteDataset, getDataset } = await import('../datasets/store')
    const parsed = datasetIdSchema.safeParse({ datasetId: c.req.param('datasetId') })
    if (!parsed.success) return respondError(c, 400, 'invalid-request')
    try {
      const db = getDb(c.env), dataset = getDataset(db, parsed.data.datasetId)
      assertDatasetScope(dataset, c.req.query('workspaceId') ?? '', c.req.query('projectId'))
      deleteDataset(db, dataset.id)
      return c.json({ ok: true })
    } catch (error) { return datasetError(c, error) }
  })

async function datasetError(c: Parameters<typeof respondError>[0], error: unknown) {
  const { DatasetError } = await import('../datasets/store')
  if (!(error instanceof DatasetError)) return respondError(c, 500, 'dataset-error')
  return respondError(c, error.code === 'not-found' ? 404 : error.code === 'forbidden' ? 403 : 400, error.code, [error.message])
}
