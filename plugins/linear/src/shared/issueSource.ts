import type { DataSourceDescription, DataSourceRegistration } from '@acorn/protocol/dataSources.ts'
import type { StarterTrigger } from '@acorn/protocol/starterTriggers.ts'

export const issueSource: DataSourceRegistration = {
  sourceId: 'issues',
  name: 'Linear issues',
  singular: 'Issue',
  plural: 'Issues',
  providerId: 'linear',
  identityScope: 'Linear issue UUID in the selected connection',
  handler: '/v1/p/linear/data/issues',
  titlePointer: '/title',
  urlPointer: '/url',
  icon: 'brand:linear',
}

// Linear's priority numbers, 0 to 4, as the record's choice ids.
export const PRIORITIES = ['none', 'urgent', 'high', 'medium', 'low'] as const

// Suggested triggers (docs/plugin-authoring/triggers.md). Linear has no moment to say its issues
// changed, so these check on the trigger's cadence. "Bug" is a label Linear gives a new workspace,
// and a starting value the person edits.
const fieldIs = (pointer: string, operator: 'eq' | 'contains', value: string | boolean) => ({
  kind: 'comparison' as const,
  left: { address: { from: 'item' as const, pointer } },
  operator,
  right: { address: { from: 'literal' as const, value } },
})
const issueStarterTriggers: StarterTrigger[] = [
  {
    id: 'new-labeled-issue',
    label: 'A new issue with a label',
    description: 'Starts a run once for each new issue that has the label you pick.',
    predicate: fieldIs('/labels', 'contains', 'Bug'),
    change: { on: 'new' },
  },
  {
    id: 'assigned-to-you',
    label: 'An issue is assigned to you',
    description: 'Starts a run when an issue is assigned to you, and again if it’s assigned to you after someone else.',
    predicate: fieldIs('/assignedToViewer', 'eq', true),
    change: { on: 'enters' },
  },
]

export const issueSourceDescription: DataSourceDescription = {
  revision: '3',
  projectScope: { kind: 'external-project', parameter: '/project', record: '/projectId' },
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'string' },
      identifier: { type: 'string' },
      title: { type: 'string' },
      url: { type: 'string' },
      description: { type: ['string', 'null'] },
      projectId: { type: 'string' },
      state: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          category: { type: 'string' },
        },
        required: ['id', 'name', 'category'],
      },
      team: {
        type: 'object',
        additionalProperties: false,
        properties: { id: { type: 'string' }, name: { type: 'string' } },
        required: ['id', 'name'],
      },
      labels: { type: 'array', items: { type: 'string' } },
      cycleId: { type: ['string', 'null'] },
      cycle: { type: ['string', 'null'] },
      assignee: { type: ['string', 'null'] },
      assignedToViewer: { type: 'boolean' },
      priority: { type: 'string' },
      estimate: { type: ['number', 'null'] },
      createdAt: { type: 'number' },
      updatedAt: { type: 'number' },
      completedAt: { type: ['number', 'null'] },
    },
    required: [
      'id',
      'identifier',
      'title',
      'url',
      'description',
      'projectId',
      'state',
      'team',
      'labels',
      'cycleId',
      'cycle',
      'assignee',
      'assignedToViewer',
      'priority',
      'estimate',
      'createdAt',
      'updatedAt',
      'completedAt',
    ],
  },
  fields: [
    { pointer: '/title', label: 'Title', origin: 'declared', display: { kind: 'text', role: 'title' } },
    { pointer: '/identifier', label: 'Identifier', origin: 'declared' },
    { pointer: '/description', label: 'Description', origin: 'declared' },
    { pointer: '/url', label: 'URL', origin: 'declared', display: { kind: 'link', role: 'url' } },
    {
      pointer: '/state/id',
      label: 'State',
      origin: 'declared',
      query: { operators: ['eq'], sortable: false },
      choices: { kind: 'dynamic', dependsOn: ['/project'] },
    },
    { pointer: '/state/name', label: 'State name', origin: 'declared', display: { kind: 'status', role: 'status' } },
    { pointer: '/state/category', label: 'State category', origin: 'declared' },
    {
      pointer: '/team/id',
      label: 'Team',
      origin: 'declared',
      query: { operators: ['eq'], sortable: false },
      choices: { kind: 'dynamic', dependsOn: ['/project'] },
    },
    { pointer: '/team/name', label: 'Team name', origin: 'declared' },
    {
      pointer: '/labels',
      label: 'Labels',
      origin: 'declared',
      display: { kind: 'text', list: true },
      query: { operators: ['contains'], sortable: false },
      choices: { kind: 'dynamic', dependsOn: [] },
    },
    { pointer: '/cycleId', label: 'Cycle ID', origin: 'declared' },
    { pointer: '/cycle', label: 'Cycle', origin: 'declared' },
    { pointer: '/assignee', label: 'Assignee', origin: 'declared', display: { kind: 'person', role: 'assignee' } },
    {
      pointer: '/assignedToViewer',
      label: 'Assigned to you',
      origin: 'declared',
      display: { kind: 'boolean' },
      query: { operators: ['eq'], sortable: false },
    },
    {
      pointer: '/priority',
      label: 'Priority',
      origin: 'declared',
      display: { kind: 'enum' },
      choices: {
        kind: 'static',
        values: [
          { id: 'urgent', label: 'Urgent', tone: 'bad', rank: 1 },
          { id: 'high', label: 'High', tone: 'warn', rank: 2 },
          { id: 'medium', label: 'Medium', tone: 'accent', rank: 3 },
          { id: 'low', label: 'Low', tone: 'muted', rank: 4 },
          { id: 'none', label: 'No priority', tone: 'muted', rank: 5 },
        ],
      },
    },
    { pointer: '/estimate', label: 'Estimate', origin: 'declared', display: { kind: 'number' } },
    ...(['createdAt', 'updatedAt'] as const).map((key) => ({
      pointer: `/${key}`,
      label: key === 'createdAt' ? 'Created' : 'Updated',
      origin: 'declared' as const,
      display: { kind: 'datetime' as const },
      query: { operators: ['gt', 'gte', 'lt', 'lte'] as ('gt' | 'gte' | 'lt' | 'lte')[], sortable: true },
    })),
    { pointer: '/completedAt', label: 'Completed', origin: 'declared', display: { kind: 'datetime' } },
  ],
  parameters: {
    type: 'object',
    properties: { project: { type: 'string' } },
    required: ['project'],
    additionalProperties: false,
  },
  parameterFields: [
    { pointer: '/project', label: 'Project', origin: 'declared', choices: { kind: 'dynamic', dependsOn: [] } },
  ],
  operations: { query: true, options: true, details: false, incremental: false, groups: ['all'] },
  targets: [{ kind: 'linear.issue' }],
  starterTriggers: issueStarterTriggers,
  consistency:
    'Linear project issues, including archived issues, with exact state IDs. No snapshot isolation across upstream pages. At most 5,000 candidates are exhausted before stable sorting; a larger selection is incomplete. Continuations retain the selection for 60 seconds. Each issue page also reads every issue’s team and its first 25 labels, which makes each page cost several times the Linear query complexity it would without them. Labels match by exact name.',
}
