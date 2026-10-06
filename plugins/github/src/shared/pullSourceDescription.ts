import type { PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { DataBindingAddress } from '@acorn/protocol/dataBindings.ts'
import type { DataSourceDescription } from '@acorn/protocol/dataSources.ts'

// Starter panels for the Add panel launcher (docs/data-sources.md). Their scope names no account: the
// launcher moves each one onto the account and repositories the person picked. Each filter is a step
// of its own, so the Node can hand it to GitHub's search.
type Column = PanelPlan['columns'][number]
const pullColumn = (id: string, label: string, type: Column['type']): Column => ({ id, label, type, bind: { pulls: { field: `/${id}` } } })
const keep = (column: string, right: DataBindingAddress): PanelPlan['stages'][number] =>
  ({ op: 'filter', where: { kind: 'comparison', left: { address: { from: 'item', pointer: `/${column}` } }, operator: 'eq', right: { address: right } } })
const openPulls = keep('state', { from: 'literal', value: 'open' })
const mine = keep('author', { from: 'context', name: 'viewer', pointer: '/login' })
const pullStarter = (title: string, columns: Column[], stages: PanelPlan['stages']): PanelPlan => ({
  version: 2, title, time: { zone: 'UTC', mode: 'viewer', weekStart: 'monday' },
  sources: [{ id: 'pulls', label: 'Pull requests', role: 'primary', reference: { kind: 'inline', bindings: {}, content: {
    name: 'Pull requests', parameters: { type: 'object', properties: {}, additionalProperties: false }, sourceParameters: {},
    query: { source: { pluginId: 'github', sourceId: 'pull-requests' }, scope: { parameters: {} }, sort: [] },
  } } }],
  columns: [pullColumn('title', 'Title', 'text'), pullColumn('repository', 'Repository', 'text'), pullColumn('state', 'State', 'enum'),
    pullColumn('author', 'Author', 'person'), ...columns, pullColumn('updatedAt', 'Updated', 'datetime'), pullColumn('url', 'Link', 'link')],
  stages, sort: [{ column: 'updatedAt', direction: 'desc' }], view: { kind: 'list' },
})
const pullStarterPlans: PanelPlan[] = [
  pullStarter('My open pull requests', [], [openPulls, mine]),
  pullStarter('Waiting for my review', [pullColumn('reviewRequestedFromViewer', 'Review requested from you', 'boolean')],
    [openPulls, keep('reviewRequestedFromViewer', { from: 'literal', value: true })]),
  pullStarter('Ready to merge', [pullColumn('mergeStateStatus', 'Merge readiness', 'enum')],
    [openPulls, mine, keep('mergeStateStatus', { from: 'literal', value: 'CLEAN' })]),
]

export const pullSourceDescription: DataSourceDescription = {
  projectScope: { kind: 'repository', parameter: '/repositories', record: '/repository' },
  revision: '6',
  schema: {
    type: 'object', additionalProperties: false,
    properties: {
      id: { type: 'string' }, number: { type: 'number' }, title: { type: 'string' },
      repository: { type: 'string' }, url: { type: 'string' },
      githubProvider: { type: 'string' }, githubConnectionId: { type: 'string' },
      headRepository: { type: ['string', 'null'] }, headBranch: { type: ['string', 'null'] },
      state: { type: 'string', enum: ['open', 'closed', 'merged'] },
      author: { type: ['string', 'null'] }, draft: { type: 'boolean' },
      createdAt: { type: 'number' }, updatedAt: { type: 'number' },
      closedAt: { type: ['number', 'null'] }, mergedAt: { type: ['number', 'null'] },
      mergeable: { type: 'string' }, mergeStateStatus: { type: 'string' }, autoMergeEnabled: { type: 'boolean' },
      reviewDecision: { type: ['string', 'null'] }, checks: { type: 'string' },
      checkStatuses: { type: 'array', items: { type: 'string' } },
      labels: { type: 'array', items: { type: 'string' } },
      requestedReviewers: { type: 'array', items: { type: 'string' } },
      requestedTeams: { type: 'array', items: { type: 'string' } },
      reviewRequests: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
        kind: { type: 'string' }, name: { type: 'string' }, requestedAt: { type: ['number', 'null'] },
      }, required: ['kind', 'name', 'requestedAt'] } },
      reviewRequestedFromViewer: { type: ['boolean', 'null'] },
      lastActivityAt: { type: 'number' },
    },
    required: ['id', 'number', 'title', 'repository', 'url', 'githubProvider', 'githubConnectionId', 'headRepository', 'headBranch', 'state', 'author', 'draft', 'createdAt', 'updatedAt', 'closedAt', 'mergedAt', 'mergeable', 'mergeStateStatus', 'autoMergeEnabled', 'reviewDecision', 'checks', 'checkStatuses', 'labels', 'requestedReviewers', 'requestedTeams', 'reviewRequests', 'reviewRequestedFromViewer', 'lastActivityAt'],
  },
  fields: [
    { pointer: '/title', label: 'Title', origin: 'declared', display: { kind: 'text', role: 'title' } },
    { pointer: '/number', label: 'Number', origin: 'declared', display: { kind: 'number' }, query: { operators: [], sortable: true } },
    { pointer: '/repository', label: 'Repository', origin: 'declared' },
    { pointer: '/githubProvider', label: 'Provider', origin: 'declared' },
    { pointer: '/githubConnectionId', label: 'GitHub account connection', origin: 'declared' },
    { pointer: '/headRepository', label: 'Head repository', origin: 'declared' },
    { pointer: '/headBranch', label: 'Head branch', origin: 'declared' },
    { pointer: '/url', label: 'URL', origin: 'declared', display: { kind: 'link', role: 'url' } },
    { pointer: '/state', label: 'State', origin: 'declared', display: { kind: 'status', role: 'status' },
      query: { operators: ['eq'], sortable: false }, choices: { kind: 'static', values: [
        { id: 'open', label: 'Open' }, { id: 'closed', label: 'Closed without merge' }, { id: 'merged', label: 'Merged' },
      ] } },
    { pointer: '/author', label: 'Author login', origin: 'declared', display: { kind: 'person' }, viewerMatch: '/login', query: { operators: ['eq'], sortable: false } },
    { pointer: '/reviewRequestedFromViewer', label: 'Review requested from you', origin: 'declared', display: { kind: 'boolean' }, query: { operators: ['eq'], sortable: false } },
    { pointer: '/requestedReviewers', label: 'Requested reviewers', origin: 'declared', display: { kind: 'person', list: true } },
    { pointer: '/requestedTeams', label: 'Requested teams', origin: 'declared', display: { kind: 'text', list: true } },
    { pointer: '/reviewRequests', label: 'Review requests with times', origin: 'declared' },
    { pointer: '/reviewDecision', label: 'Review decision', origin: 'declared', display: { kind: 'status' }, choices: { kind: 'static', values: [
      { id: 'APPROVED', label: 'Approved', tone: 'ok' }, { id: 'CHANGES_REQUESTED', label: 'Changes requested', tone: 'bad' }, { id: 'REVIEW_REQUIRED', label: 'Review required', tone: 'warn' },
    ] } },
    { pointer: '/checks', label: 'Head checks', origin: 'declared', display: { kind: 'status' }, choices: { kind: 'static', values: [
      { id: 'SUCCESS', label: 'Passed', tone: 'ok' }, { id: 'FAILURE', label: 'Failed', tone: 'bad' }, { id: 'PENDING', label: 'Pending', tone: 'warn' },
      { id: 'EXPECTED', label: 'Missing', tone: 'muted' }, { id: 'CANCELLED', label: 'Cancelled', tone: 'muted' },
      { id: 'SKIPPED', label: 'Skipped', tone: 'muted' }, { id: 'NEUTRAL', label: 'Neutral', tone: 'muted' },
      { id: 'UNKNOWN', label: 'Unknown', tone: 'muted' },
    ] } },
    { pointer: '/checkStatuses', label: 'Individual head check states', origin: 'declared', display: { kind: 'text', list: true } },
    { pointer: '/labels', label: 'Labels', origin: 'declared', display: { kind: 'text', list: true } },
    { pointer: '/lastActivityAt', label: 'Last activity', origin: 'declared', display: { kind: 'datetime' }, query: { operators: ['gt', 'gte', 'lt', 'lte'], sortable: true } },
    { pointer: '/draft', label: 'Draft', origin: 'declared', display: { kind: 'boolean' }, query: { operators: ['eq'], sortable: false } },
    ...(['createdAt', 'updatedAt'] as const).map(key => ({
      pointer: `/${key}`, label: key === 'createdAt' ? 'Created' : 'Updated', origin: 'declared' as const,
      display: { kind: 'datetime' as const }, query: { operators: ['gt', 'gte', 'lt', 'lte'] as ('gt' | 'gte' | 'lt' | 'lte')[], sortable: true },
    })),
    { pointer: '/closedAt', label: 'Closed', origin: 'declared', display: { kind: 'datetime' } },
    { pointer: '/mergedAt', label: 'Merged', origin: 'declared', display: { kind: 'datetime' } },
    { pointer: '/mergeable', label: 'Mergeability', origin: 'declared' },
    { pointer: '/mergeStateStatus', label: 'Merge readiness', origin: 'declared', display: { kind: 'status' },
      choices: { kind: 'static', values: [
        { id: 'CLEAN', label: 'Ready', tone: 'ok' }, { id: 'BEHIND', label: 'Behind base', tone: 'warn' },
        { id: 'BLOCKED', label: 'Blocked', tone: 'bad' }, { id: 'DIRTY', label: 'Conflicts', tone: 'bad' },
        { id: 'DRAFT', label: 'Draft', tone: 'muted' }, { id: 'HAS_HOOKS', label: 'Merge hooks', tone: 'warn' },
        { id: 'UNSTABLE', label: 'Unstable', tone: 'warn' }, { id: 'UNKNOWN', label: 'Unknown', tone: 'muted' },
      ] } },
    { pointer: '/autoMergeEnabled', label: 'Auto-merge enabled', origin: 'declared', display: { kind: 'boolean' } },
  ],
  parameters: { type: 'object', properties: { repositories: { type: 'array', items: { type: 'string' } } }, additionalProperties: false },
  parameterFields: [{ pointer: '/repositories', label: 'Repositories', origin: 'declared', display: { kind: 'text', list: true }, choices: { kind: 'dynamic', dependsOn: [] } }],
  operations: { query: true, options: true, details: true, incremental: false, groups: ['all'], identity: true },
  detailSchema: { type: 'object', additionalProperties: false, properties: { state: { type: 'string' } }, required: ['state'] },
  writable: [{ field: '/state', path: '/v1/p/github/data/pulls/write', risk: 'write', values: ['open', 'closed'] }],
  targets: [{ kind: 'github.pull-request' }],
  coverage: { kind: 'snapshot' },
  starterPlans: pullStarterPlans,
  reach: { parameter: '/repositories', itemPlural: 'repositories',
    default: 'repositories linked to this workspace', empty: 'no linked repositories' },
  consistency: 'Workspace reads are restricted to linked repositories. An explicit list selects a subset. Search is eventually consistent, with no snapshot isolation during pagination. Up to 250 matches are fully read. A larger search returns no rows and says it is incomplete, so narrow it with repositories or conditions.',
}
