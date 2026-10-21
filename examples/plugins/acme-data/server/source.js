// The `acme-data:deploys` data source: one record per deploy, read by dashboards and workflows. The
// manifest names the source and its handler. This file answers the two operations it supports.

// #region starter
// A panel the Add panel launcher offers for this source. Its scope names no workspace: the launcher
// moves it onto the scope the person picks.
const starter = {
  version: 2,
  title: 'Deploys by environment',
  time: { zone: 'UTC', mode: 'viewer', weekStart: 'monday' },
  sources: [
    {
      id: 'deploys',
      label: 'Acme deploys',
      role: 'primary',
      reference: {
        kind: 'inline',
        bindings: {},
        content: {
          name: 'Acme deploys',
          parameters: { type: 'object', properties: {}, additionalProperties: false },
          sourceParameters: {},
          query: { source: { pluginId: 'acme-data', sourceId: 'deploys' }, scope: { parameters: {} }, sort: [] },
        },
      },
    },
  ],
  columns: [
    { id: 'environment', label: 'Environment', type: 'text', bind: { deploys: { field: '/environment' } } },
    { id: 'status', label: 'Status', type: 'enum', bind: { deploys: { field: '/status' } } },
  ],
  stages: [
    { op: 'summarize', by: [{ column: 'environment' }], measures: [{ id: 'deploys', label: 'Deploys', kind: 'count' }] },
  ],
  sort: [{ column: 'deploys', direction: 'desc' }],
  view: { kind: 'table' },
}
// #endregion

// #region trigger
// A trigger the trigger dialog suggests for this source. It names no workflow or account: the person
// picks those. "Starts matching" fires again if a deploy that failed is retried and fails again.
const failing = {
  id: 'deploy-fails',
  label: 'A deploy fails',
  description: 'Starts a run when a deploy’s status becomes failed.',
  predicate: {
    kind: 'comparison',
    left: { address: { from: 'item', pointer: '/status' } },
    operator: 'eq',
    right: { address: { from: 'literal', value: 'failed' } },
  },
  change: { on: 'enters' },
}
// #endregion

// #region describe
const ENVIRONMENTS = [
  { id: 'staging', label: 'Staging' },
  { id: 'production', label: 'Production' },
]
const STATUSES = [
  { id: 'pending', label: 'Pending', tone: 'muted', rank: 0 },
  { id: 'running', label: 'Running', tone: 'warn', rank: 1 },
  { id: 'succeeded', label: 'Succeeded', tone: 'ok', rank: 2 },
  { id: 'failed', label: 'Failed', tone: 'bad', rank: 3 },
  { id: 'cancelled', label: 'Cancelled', tone: 'muted', rank: 4 },
]

/** What `describe` answers: the record's JSON schema, and what each field means to a person. */
export const description = {
  revision: '1',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      taskId: { type: 'string' },
      environment: { type: 'string', enum: ENVIRONMENTS.map((choice) => choice.id) },
      status: { type: 'string', enum: STATUSES.map((choice) => choice.id) },
      sha: { type: 'string' },
      at: { type: 'number' },
    },
    required: ['taskId', 'environment', 'status', 'sha', 'at'],
  },
  fields: [
    { pointer: '/sha', label: 'Commit', origin: 'declared', display: { kind: 'text', role: 'title' } },
    { pointer: '/taskId', label: 'Task', origin: 'declared' },
    { pointer: '/environment', label: 'Environment', origin: 'declared', choices: { kind: 'static', values: ENVIRONMENTS } },
    {
      pointer: '/status', label: 'Status', origin: 'declared',
      display: { kind: 'status', role: 'status' }, choices: { kind: 'static', values: STATUSES },
      // The one filter this source runs: the host sends it only `status` equal to a value.
      query: { operators: ['eq'], sortable: false },
    },
    { pointer: '/at', label: 'Deployed', origin: 'declared', display: { kind: 'datetime', role: 'updated' } },
  ],
  parameters: { type: 'object', additionalProperties: false, properties: {} },
  parameterFields: [],
  operations: { query: true, options: false, details: false, incremental: false, groups: ['all'] },
  consistency: 'Live reads of this Node’s deploy table.',
  starterPlans: [starter],
  starterTriggers: [failing],
}
// #endregion

// #region query
/**
 * The statuses a query asks for. The host checked the predicate against the description, so it holds
 * only `status` `eq` comparisons, alone or in an `all` group.
 * @param {any} predicate
 * @returns {string[]}
 */
const wantedStatuses = (predicate) =>
  !predicate ? [] : (predicate.kind === 'all' ? predicate.predicates : [predicate]).map((test) => test.right.address.value)

/**
 * Answers a `query`: one page of records, and whether there's more.
 * @param {ReturnType<import('./store.js').createStore>} store
 * @param {{ cursor?: string, pageSize?: number, query?: { predicate?: unknown } }} request
 */
export function queryPage(store, request) {
  const from = Number(request.cursor ?? 0)
  const size = request.pageSize ?? 25
  const statuses = wantedStatuses(request.query?.predicate)
  const deploys = store.all().filter((deploy) => statuses.every((status) => deploy.status === status))
  const page = deploys.slice(from, from + size)
  return {
    records: page.map(({ id, taskId, environment, status, sha, at }) => ({
      recordId: id,
      data: { taskId, environment, status, sha, at },
      // A record that names its task opens that task when someone presses the row.
      taskId,
    })),
    revision: description.revision,
    readTime: Date.now(),
    completeness: from + size < deploys.length ? { kind: 'more', cursor: String(from + size) } : { kind: 'complete' },
  }
}
// #endregion
