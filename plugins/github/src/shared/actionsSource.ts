import type { DataSourceDescription } from '@acorn/protocol/dataSources.ts'

export const actionsSourceDescription: DataSourceDescription = {
  revision: '2', schema: { type: 'object', additionalProperties: false, properties: {
    repository: { type: 'string' }, runId: { type: 'number' }, attempt: { type: 'number' },
    workflow: { type: 'string' }, job: { type: 'string' }, status: { type: 'string' },
    conclusion: { type: ['string', 'null'] }, startedAt: { type: ['number', 'null'] },
    completedAt: { type: ['number', 'null'] }, durationMs: { type: ['number', 'null'] },
    pullRequests: { type: 'array', items: { type: 'number' } }, url: { type: 'string' },
  }, required: ['repository', 'runId', 'attempt', 'workflow', 'job', 'status', 'conclusion', 'startedAt', 'completedAt', 'durationMs', 'pullRequests', 'url'] },
  fields: [
    { pointer: '/repository', label: 'Repository', origin: 'declared' },
    { pointer: '/workflow', label: 'Workflow', origin: 'declared' },
    { pointer: '/job', label: 'Job', origin: 'declared', display: { kind: 'text', role: 'title' } },
    { pointer: '/runId', label: 'Run ID', origin: 'declared' },
    { pointer: '/attempt', label: 'Attempt', origin: 'declared', display: { kind: 'number' } },
    { pointer: '/status', label: 'Status', origin: 'declared' },
    { pointer: '/conclusion', label: 'Conclusion', origin: 'declared', display: { kind: 'status' }, query: { operators: ['eq'], sortable: false }, choices: { kind: 'static', values: [
      { id: 'success', label: 'Success', tone: 'ok' }, { id: 'failure', label: 'Failure', tone: 'bad' },
      { id: 'cancelled', label: 'Cancelled', tone: 'muted' }, { id: 'skipped', label: 'Skipped', tone: 'muted' },
      { id: 'neutral', label: 'Neutral', tone: 'muted' }, { id: 'timed_out', label: 'Timed out', tone: 'bad' },
      { id: 'action_required', label: 'Action required', tone: 'warn' },
    ] } },
    { pointer: '/startedAt', label: 'Started', origin: 'declared', display: { kind: 'datetime' }, query: { operators: ['gt', 'gte', 'lt', 'lte'], sortable: true } },
    { pointer: '/completedAt', label: 'Finished', origin: 'declared', display: { kind: 'datetime' } },
    { pointer: '/durationMs', label: 'Duration', origin: 'declared', display: { kind: 'number', unit: 'ms' } },
    { pointer: '/pullRequests', label: 'Pull requests', origin: 'declared', display: { kind: 'number', list: true } },
    { pointer: '/url', label: 'Job URL', origin: 'declared', display: { kind: 'link', role: 'url' } },
  ],
  parameters: { type: 'object', additionalProperties: false, properties: { repositories: { type: 'array', items: { type: 'string' } } }, required: ['repositories'] },
  parameterFields: [{ pointer: '/repositories', label: 'Repositories', origin: 'declared', display: { kind: 'text', list: true }, choices: { kind: 'dynamic', dependsOn: [] } }],
  operations: { query: true, options: true, details: false, incremental: false, groups: ['all'] },
  actions: [{ id: 'rerun-job', label: 'Re-run job', risk: 'execute' }],
  coverage: { kind: 'events', retention: 'GitHub repository or organization policy; default 90 days', complete: false },
  consistency: 'GitHub Actions REST reads the selected repositories and run attempts. Repository retention can vary; each read reports its observed range and whether an upstream or host cap stopped it.',
}
