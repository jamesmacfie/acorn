import { describe, expect, it } from 'vitest'
import { datasetCreateSchema } from '@acorn/protocol/datasets.ts'
import { panelPlanSchema, type PanelPlan, type SuppliedRows } from '@acorn/protocol/dashboards.ts'
import {
  identityProblem,
  keepProblem,
  keptDatasetInput,
  keptPlan,
  refreshPrompt,
  suggestIdentity,
  suggestMode,
} from './keepUpdated'

const READ = Date.parse('2026-10-20T05:31:00Z')

const supplied = (
  properties: Record<string, { type: 'string' | 'number' }>,
  rows: Record<string, unknown>[],
): SuppliedRows =>
  ({
    kind: 'supplied',
    origin: { says: 'Open-Meteo forecast for Wellington', urls: ['https://open-meteo.com'], readAt: READ },
    schema: { type: 'object', properties, additionalProperties: false },
    fields: Object.keys(properties).map((name) => ({ pointer: `/${name}`, label: name, origin: 'declared' })),
    rows,
  }) as SuppliedRows

const forecast = supplied({ day: { type: 'string' }, high: { type: 'number' } }, [
  { day: '2026-10-20', high: 17 },
  { day: '2026-10-21', high: 15 },
])
const commits = supplied({ commits: { type: 'number' }, repo: { type: 'string' } }, [
  { commits: 12, repo: 'acorn' },
  { commits: 3, repo: 'site' },
])
const releases = supplied({ tag: { type: 'string' }, published: { type: 'string' } }, [
  { tag: 'v1.2.0', published: '2026-09-01' },
  { tag: 'v1.3.0', published: '2026-10-01' },
])

describe('suggestions', () => {
  it('keeps a forecast as its latest state, keyed by day', () => {
    expect(suggestMode(forecast)).toEqual({ mode: 'current-mirror' })
    expect(suggestIdentity(forecast)).toEqual(['/day'])
  })

  it('keeps counts with no time as daily snapshots, keyed by the name and not the count', () => {
    expect(suggestMode(commits)).toEqual({ mode: 'snapshot-history' })
    expect(suggestIdentity(commits)).toEqual(['/repo'])
  })

  it('keeps rows with past times as events', () => {
    expect(suggestMode(releases)).toEqual({ mode: 'event-archive', eventTimeField: '/published' })
  })

  it('combines fields when no one field tells the rows apart', () => {
    const daily = supplied({ repo: { type: 'string' }, day: { type: 'string' }, commits: { type: 'number' } }, [
      { repo: 'acorn', day: '2026-10-19', commits: 4 },
      { repo: 'acorn', day: '2026-10-20', commits: 4 },
      { repo: 'site', day: '2026-10-20', commits: 1 },
    ])
    expect(suggestIdentity(daily)).toEqual(['/repo', '/day'])
  })

  it('says why fields can not identify the rows', () => {
    expect(identityProblem(forecast.rows, [])).toMatch(/at least one/)
    expect(identityProblem([{ day: 'a' }, { day: 'a' }], ['/day'])).toMatch(/share/)
    expect(identityProblem([{ day: null }], ['/day'])).toMatch(/needs a value/)
  })
})

describe('keeping', () => {
  it('refuses rows whose fields clash with what a dataset adds', () => {
    expect(keepProblem(supplied({ reason: { type: 'string' } }, [{ reason: 'x' }]))).toMatch(/reason/)
    expect(keepProblem(supplied({ day: { type: 'string' } }, []))).toMatch(/no rows/)
    expect(keepProblem(forecast)).toBeUndefined()
  })

  it('builds a workspace agent dataset the Node accepts, with the origin as each row’s evidence', () => {
    const input = keptDatasetInput(forecast, {
      name: 'Forecast',
      workspaceId: 'ws',
      mode: 'current-mirror',
      identityFields: ['/day'],
      refresh: { projectId: 'project', taskId: 'task', every: 86_400 },
    })
    const parsed = datasetCreateSchema.parse(input)
    expect(parsed.projectId).toBeUndefined()
    expect(parsed.refresh).toEqual({
      projectId: 'project',
      taskId: 'task',
      origin: { says: 'Open-Meteo forecast for Wellington', urls: ['https://open-meteo.com'] },
      every: 86_400,
    })
    expect(parsed.rows?.[0]).toMatchObject({ data: { day: '2026-10-20', high: 17 }, evidence: forecast.origin })
  })

  it('points the plan at the dataset and leaves its columns and view alone', () => {
    const plan = panelPlanSchema.parse({
      version: 2,
      title: 'Forecast',
      time: { zone: 'UTC', mode: 'fixed', weekStart: 'monday' },
      sources: [{ id: 'rows', label: 'Forecast', role: 'primary', reference: forecast }],
      columns: [{ id: 'day', label: 'Day', type: 'text', bind: { rows: { field: '/day' } } }],
      stages: [],
      view: { kind: 'table' },
    }) as PanelPlan
    const kept = panelPlanSchema.parse(keptPlan(plan, 'd1', 'ws'))
    expect(kept.sources[0]!.reference).toMatchObject({
      kind: 'inline',
      content: { query: { source: { pluginId: 'core', sourceId: 'dataset:d1' }, scope: { workspaceId: 'ws' } } },
    })
    expect(kept.columns).toEqual(plan.columns)
    expect(kept.view).toEqual(plan.view)
  })

  it('asks the agent to describe the dataset and write through dataset_write', () => {
    const prompt = refreshPrompt('d1', 'Forecast', { says: 'Open-Meteo', urls: ['https://open-meteo.com'] })
    expect(prompt).toContain('sourceId "dataset:d1"')
    expect(prompt).toContain('dataset_write: datasetId "d1"')
    expect(prompt).toContain('Open-Meteo (https://open-meteo.com)')
  })
})
