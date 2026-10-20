import { beforeAll, describe, expect, it } from 'vitest'
import type { PanelPlan } from '@acorn/protocol/dashboards.ts'
import { panelGuide } from '@acorn/dashboards-core/panelGuide.ts'
import { memoryIdentityStore } from '../activeIdentity'
import { schema } from '../db'
import { makeTestDb, testEnv } from '../../testkit/db'
import { planProblems } from '../agentTools/panelShow'
import { runDashboard } from './run'

// Rows an agent supplied, drawn by every view kind through the ordinary runner, with no plugin.
const world = makeTestDb()
const env = testEnv({ DB: world.db, ACTIVE_IDENTITY: memoryIdentityStore('owner'), SECRETS: world.secrets })
const invocation = {
  principal: { kind: 'internal' as const, scope: 'service' as const, userId: 'owner' },
  signal: new AbortController().signal,
}
beforeAll(async () => {
  await world.db
    .insert(schema.workspaces)
    .values({ id: 'w', name: 'W', isDefault: true, sort: 0, createdAt: 1, updatedAt: 1 })
})

const hours = ['2026-10-19T09:00:00Z', '2026-10-19T15:00:00Z', '2026-10-20T09:00:00Z', '2026-10-20T15:00:00Z']
const forecast = (rows: Record<string, unknown>[] = hours.map((at, index) => ({ at, temperature: 12 + index }))) =>
  ({
    id: 'forecast',
    label: 'Forecast',
    role: 'primary',
    reference: {
      kind: 'supplied',
      origin: { says: 'Open-Meteo forecast for Wellington', urls: ['https://open-meteo.com/'], readAt: 1 },
      schema: {
        type: 'object',
        properties: { at: { type: 'string' }, temperature: { type: 'number' } },
        required: ['at', 'temperature'],
      },
      fields: [
        { pointer: '/at', label: 'Time', origin: 'declared', display: { kind: 'datetime' } },
        { pointer: '/temperature', label: 'Temperature', origin: 'declared', display: { kind: 'number', unit: '°C' } },
      ],
      rows,
    },
  }) as PanelPlan['sources'][number]
const column = (id: string, type: 'datetime' | 'number', field = id): PanelPlan['columns'][number] => ({
  id,
  label: id,
  type,
  bind: { forecast: { field: `/${field}` } },
})
const plan = (shape: Partial<PanelPlan>): PanelPlan => ({
  version: 2,
  title: 'Forecast',
  time: { zone: 'UTC', mode: 'fixed', weekStart: 'monday' },
  sources: [forecast()],
  columns: [column('at', 'datetime'), column('temperature', 'number')],
  stages: [],
  view: { kind: 'table' },
  ...shape,
})
const run = (content: PanelPlan) =>
  runDashboard(
    env,
    { scope: { workspaceId: 'w' }, target: { kind: 'draft', content }, mode: 'execution', evaluationTime: 2 },
    invocation,
  )
const errors = (result: Awaited<ReturnType<typeof run>>) =>
  result.diagnostics.problems.filter((problem) => problem.severity === 'error')

describe('supplied rows', () => {
  it('draw a list, a table, and a line from their own rows, read once and complete', async () => {
    for (const view of [{ kind: 'list' }, { kind: 'table' }, { kind: 'chart', shape: 'line', x: 'at' }] as const) {
      const result = await run(plan({ view }))
      expect(errors(result), view.kind).toEqual([])
      expect(result.rows.map((row) => row.values.temperature)).toEqual([12, 13, 14, 15])
      expect(result.diagnostics.sources[0]).toMatchObject({ completeness: { kind: 'complete' }, readTime: 1 })
      expect(result.diagnostics.complete).toBe(true)
    }
  })

  it('draw bars over a summary and a heatmap across two time buckets', async () => {
    const bars = await run(
      plan({
        stages: [
          {
            op: 'summarize',
            by: [{ column: 'at', bucket: 'day' }],
            measures: [{ id: 'warmest', label: 'Warmest', kind: 'maximum', column: 'temperature' }],
          },
        ],
        view: { kind: 'chart', shape: 'bar', x: 'at', aggregate: 'sum', field: 'warmest' },
      }),
    )
    expect(errors(bars)).toEqual([])
    expect(bars.rows.map((row) => row.values.warmest)).toEqual([13, 15])
    const heatmap = await run(
      plan({
        columns: [
          column('weekday', 'datetime', 'at'),
          column('hour', 'datetime', 'at'),
          column('temperature', 'number'),
        ],
        stages: [
          {
            op: 'summarize',
            by: [
              { column: 'weekday', bucket: 'weekday' },
              { column: 'hour', bucket: 'hour' },
            ],
            measures: [{ id: 'average', label: 'Average', kind: 'average', column: 'temperature' }],
          },
        ],
        view: { kind: 'heatmap', y: 'weekday', x: 'hour', aggregate: 'sum', field: 'average' },
      }),
    )
    expect(errors(heatmap)).toEqual([])
    expect(heatmap.rows).toHaveLength(4)
  })

  it("draws the panel guide's worked example", async () => {
    const example = panelGuide('w').examples.at(-1)!.plan as PanelPlan
    expect(await planProblems(env, 'w', example, invocation)).toEqual([])
    const result = await run(example)
    expect(errors(result)).toEqual([])
    expect(result.rows.map((row) => row.values.repository)).toEqual(['acorn', 'site', 'dotfiles'])
  })

  it('fail panel_show naming the row and field at fault, and when they join another source', async () => {
    const broken = forecast([{ at: hours[0], temperature: 'warm' }])
    expect(await planProblems(env, 'w', plan({ sources: [broken] }), invocation)).toEqual([
      '/sources/0/reference/rows/0/temperature: Value does not match number',
    ])
    const second = { ...forecast(), id: 'again' }
    expect(await planProblems(env, 'w', plan({ sources: [forecast(), second] }), invocation)).toEqual([
      "/sources/0/reference: Supplied rows must be the plan's only source, with the primary role.",
      "/sources/1/reference: Supplied rows must be the plan's only source, with the primary role.",
    ])
  })
})
