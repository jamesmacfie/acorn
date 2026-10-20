import type { PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { DataSourceDescription, DataSourceRequest } from '@acorn/protocol/dataSources.ts'
import { cadencePeriodMs, describeCadence } from '@acorn/protocol/schedules.ts'
import type { Env } from '../bindings'
import { getDb, schema } from '../db'
import { SCHEDULER } from '../schedules'
import { createDataSelectionPager, selectDataRecords } from './selection'

// Starter panels for the Add panel launcher (docs/data-sources.md). Their scope names no workspace: the
// launcher moves each one onto the scope the person picked.
const scheduleSource: PanelPlan['sources'][number] = {
  id: 'schedules',
  label: 'Schedules',
  role: 'primary',
  reference: {
    kind: 'inline',
    bindings: {},
    content: {
      name: 'Schedules',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      sourceParameters: {},
      query: { source: { pluginId: 'core', sourceId: 'schedules' }, scope: { parameters: {} }, sort: [] },
    },
  },
}
const column = (
  id: string,
  label: string,
  type: PanelPlan['columns'][number]['type'],
): PanelPlan['columns'][number] => ({ id, label, type, bind: { schedules: { field: `/${id}` } } })
const scheduleStarter = (plan: Pick<PanelPlan, 'title' | 'columns' | 'stages' | 'sort'>): PanelPlan => ({
  version: 2,
  time: { zone: 'UTC', mode: 'viewer', weekStart: 'monday' },
  sources: [scheduleSource],
  view: { kind: 'list' },
  // The record's target opens Settings → Schedules. A schedule has no record action to fall back on.
  actions: { press: { kind: 'record', prefer: 'overlay' }, buttons: [] },
  ...plan,
})
const scheduleStarterPlans: PanelPlan[] = [
  scheduleStarter({
    title: 'Schedules that failed last time',
    columns: [
      column('name', 'Schedule', 'text'),
      column('lastStatus', 'Last outcome', 'enum'),
      column('lastError', 'Error', 'text'),
      column('lastRunAt', 'Ran', 'datetime'),
    ],
    stages: [
      {
        op: 'filter',
        where: {
          kind: 'any',
          predicates: ['error', 'timeout'].map((status) => ({
            kind: 'comparison' as const,
            left: { address: { from: 'item' as const, pointer: '/lastStatus' } },
            operator: 'eq' as const,
            right: { address: { from: 'literal' as const, value: status } },
          })),
        },
      },
    ],
    sort: [{ column: 'lastRunAt', direction: 'desc' }],
  }),
  scheduleStarter({
    title: 'What runs next',
    columns: [
      column('name', 'Schedule', 'text'),
      column('cadence', 'Runs', 'text'),
      column('nextRunAt', 'Next run', 'datetime'),
    ],
    stages: [
      {
        op: 'filter',
        where: {
          kind: 'comparison',
          left: { address: { from: 'item', pointer: '/nextRunAt' } },
          operator: 'ne',
          right: { address: { from: 'literal', value: null } },
        },
      },
    ],
    sort: [{ column: 'nextRunAt', direction: 'asc' }],
  }),
  scheduleStarter({
    title: 'How often schedules run',
    columns: [
      column('name', 'Schedule', 'text'),
      column('owner', 'Owner', 'enum'),
      column('cadence', 'Runs', 'text'),
      column('periodSeconds', 'Seconds between runs', 'number'),
      column('enabled', 'On', 'boolean'),
    ],
    stages: [],
    sort: [{ column: 'periodSeconds', direction: 'asc' }],
  }),
]

export const scheduleSourceDescription: DataSourceDescription = {
  revision: '1',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      name: { type: 'string' },
      owner: { type: 'string' },
      pluginId: { type: ['string', 'null'] },
      kind: { type: 'string' },
      enabled: { type: 'boolean' },
      available: { type: 'boolean' },
      cadence: { type: 'string' },
      periodSeconds: { type: 'number' },
      lastRunAt: { type: ['number', 'null'] },
      lastStatus: { type: ['string', 'null'] },
      lastError: { type: ['string', 'null'] },
      nextRunAt: { type: ['number', 'null'] },
      projectId: { type: ['string', 'null'] },
      project: { type: ['string', 'null'] },
    },
    required: [
      'name',
      'owner',
      'pluginId',
      'kind',
      'enabled',
      'available',
      'cadence',
      'periodSeconds',
      'lastRunAt',
      'lastStatus',
      'lastError',
      'nextRunAt',
      'projectId',
      'project',
    ],
  },
  fields: [
    {
      pointer: '/name',
      label: 'Schedule',
      origin: 'declared',
      display: { kind: 'text', role: 'title' },
      query: { operators: ['eq', 'ne', 'contains'], sortable: false },
    },
    {
      pointer: '/owner',
      label: 'Owner',
      origin: 'declared',
      display: { kind: 'status' },
      query: { operators: ['eq', 'ne'], sortable: false },
      choices: {
        kind: 'static',
        values: [
          { id: 'user', label: 'You' },
          { id: 'plugin', label: 'Plugin' },
          { id: 'core', label: 'Acorn' },
        ],
      },
    },
    { pointer: '/pluginId', label: 'Plugin', origin: 'declared', query: { operators: ['eq', 'ne'], sortable: false } },
    {
      pointer: '/kind',
      label: 'Kind',
      description: 'What the schedule runs: core or plugin work, or a target such as node-action or workflow.',
      origin: 'declared',
      query: { operators: ['eq', 'ne'], sortable: false },
    },
    { pointer: '/enabled', label: 'On', origin: 'declared', display: { kind: 'boolean' } },
    {
      pointer: '/available',
      label: 'Available',
      description: 'False when nothing on this Node can run it, such as a disabled plugin.',
      origin: 'declared',
      display: { kind: 'boolean' },
    },
    { pointer: '/cadence', label: 'Runs', origin: 'declared' },
    {
      pointer: '/periodSeconds',
      label: 'Seconds between runs',
      origin: 'declared',
      display: { kind: 'number' },
      query: { operators: ['lt', 'lte', 'gt', 'gte'], sortable: true },
    },
    {
      pointer: '/lastRunAt',
      label: 'Last run',
      origin: 'declared',
      display: { kind: 'datetime', role: 'updated' },
      query: { operators: ['gt', 'gte', 'lt', 'lte', 'eq', 'ne'], sortable: true },
    },
    {
      pointer: '/lastStatus',
      label: 'Last outcome',
      origin: 'declared',
      display: { kind: 'status', role: 'status' },
      query: { operators: ['eq', 'ne'], sortable: false },
      choices: {
        kind: 'static',
        values: [
          { id: 'ok', label: 'Succeeded', tone: 'ok' },
          { id: 'error', label: 'Failed', tone: 'bad' },
          { id: 'timeout', label: 'Timed out', tone: 'bad' },
          { id: 'skipped', label: 'Skipped', tone: 'muted' },
        ],
      },
    },
    { pointer: '/lastError', label: 'Last error', origin: 'declared' },
    {
      pointer: '/nextRunAt',
      label: 'Next run',
      description: 'Null when the schedule is off, unavailable, or every schedule is paused.',
      origin: 'declared',
      display: { kind: 'datetime' },
      query: { operators: ['gt', 'gte', 'lt', 'lte', 'eq', 'ne'], sortable: true },
    },
    {
      pointer: '/project',
      label: 'Project',
      description: 'Null for work the whole Node does.',
      origin: 'declared',
      query: { operators: ['eq', 'ne'], sortable: false },
    },
  ],
  parameters: { type: 'object', additionalProperties: false, properties: {} },
  parameterFields: [],
  operations: { query: true, options: false, details: false, incremental: false, groups: ['all'] },
  targets: [{ kind: 'core.schedule' }],
  coverage: { kind: 'snapshot' },
  starterPlans: scheduleStarterPlans,
  consistency:
    "This Node's schedules and their last run, as Settings → Schedules lists them. Schedules for the whole Node appear in every workspace; a schedule that works in one workspace or project appears only there.",
}

const page = createDataSelectionPager()

export async function coreSchedules(request: DataSourceRequest, env: Env) {
  if (request.operation === 'describe') return scheduleSourceDescription
  if (request.operation !== 'query') throw new Error('unsupported_operation')
  return page(env.ACTIVE_IDENTITY.get() ?? '', request, async () => {
    const scheduler = env.CAPABILITIES.get(SCHEDULER)
    if (!scheduler) throw new Error('scheduler_unavailable')
    const { workspaceId, projectId } = request.query.scope
    const projects = new Map(
      (
        await getDb(env)
          .select({ id: schema.projects.id, name: schema.projects.name, workspaceId: schema.projects.workspaceId })
          .from(schema.projects)
      ).map((project) => [project.id, project]),
    )
    const paused = scheduler.paused()
    const records = (await scheduler.list()).flatMap((row) => {
      const project = row.projectId ? projects.get(row.projectId) : undefined
      const scoped = row.projectId !== undefined || row.workspaceId !== undefined
      // A project that no longer exists has no workspace, so its schedule leaves every scoped read.
      if (workspaceId && scoped && (project?.workspaceId ?? row.workspaceId) !== workspaceId) return []
      if (projectId && row.projectId && row.projectId !== projectId) return []
      return [
        {
          recordId: row.key,
          data: {
            name: row.name,
            owner: row.owner,
            pluginId: row.pluginId ?? null,
            kind: row.kind,
            enabled: row.enabled,
            available: row.registered,
            cadence: describeCadence(row.cadence),
            periodSeconds: cadencePeriodMs(row.cadence) / 1000,
            lastRunAt: row.lastRunAt ?? null,
            lastStatus: row.lastStatus ?? null,
            lastError: row.lastError ?? null,
            nextRunAt: row.enabled && row.registered && !paused ? row.nextRunAt : null,
            projectId: row.projectId ?? null,
            project: project?.name ?? null,
          },
          display: { title: row.name },
          target: { kind: 'core.schedule', item: row.key },
        },
      ]
    })
    return {
      ...selectDataRecords(records, request.query),
      revision: scheduleSourceDescription.revision,
      readTime: request.evaluationTime,
    }
  })
}
