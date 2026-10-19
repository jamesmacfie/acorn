import type { PanelPlan } from '@acorn/protocol/dashboards.ts'
import { PANEL_CAPABILITIES } from './capabilities'

// What a model is told about writing a panel plan. The panel studio's AI and a chat agent's
// `panel_guide` tool both read PANEL_AUTHORING_INSTRUCTIONS, so a change here changes both writers
// (docs/agent-tools.md § Panels).

export const PANEL_AUTHORING_INSTRUCTIONS = `The candidate must be one PanelPlan version 2 object. Start with list-sources and list-accounts metadata. Primary sources supply rows; lookup and children sources need declared exact-key relations. Only equivalence merges mirrored records. Use the supported operations and bounds. Account names are choices, never guesses. A source whose catalog entry lists inputs is a derived source: give it no connectionId, bind every required input in scope.inputs by name with { connectionId, parameters }, and choose each input's account under the same rule. When more than one of the person's accounts fits an input, ask with a clarification whose choices are those accounts. Board writes need a source-declared writable bound field and an exact writeValues entry per choice and source; list them as requirements with paths into columns, choices, and writeValues. A missing mapping is unavailable, never guessed. A field the panel only sorts, groups, or filters by still needs a column; mark it hidden when the person doesn't ask to see it or asks to hide it (capabilities.hiddenColumns). Propose a dataset only when the request needs history that live sources cannot provide; say which mode and coverage are needed. The person's request and requirements checklist belong in the plan; partial and unavailable items need reasons. An instruction that starts with [Focus: <paths> "<title>"] is about those plan paths; change other parts only when the request needs it. Capabilities: ${JSON.stringify(PANEL_CAPABILITIES)}.`

const ACCOUNT = '<account id from data_sources_list>'

const pullRequests = (workspaceId: string, repositories: string[]): PanelPlan['sources'][number] => ({
  id: 'pulls',
  label: 'Pull requests',
  role: 'primary',
  reference: {
    kind: 'inline',
    bindings: {},
    content: {
      name: 'Pull requests',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      sourceParameters: {},
      query: {
        source: { pluginId: 'github', sourceId: 'pull-requests' },
        scope: { workspaceId, connectionId: ACCOUNT, parameters: { repositories } },
        sort: [],
      },
    },
  },
})
const pullColumn = (
  id: string,
  label: string,
  type: PanelPlan['columns'][number]['type'],
  hidden?: boolean,
): PanelPlan['columns'][number] => ({
  id,
  label,
  type,
  ...(hidden ? { hidden } : {}),
  bind: { pulls: { field: `/${id}` } },
})
const openedSince = (offset: string): PanelPlan['stages'][number] => ({
  op: 'filter',
  where: {
    kind: 'comparison',
    left: { address: { from: 'item', pointer: '/createdAt' } },
    operator: 'gte',
    right: { address: { from: 'context', name: 'now', offset } },
  },
})
const TIME = { zone: 'UTC', mode: 'viewer', weekStart: 'monday' } as const

/** Two plans for the GitHub pull requests source, for a model to copy the shape of. */
export const panelGuideExamples = (workspaceId: string) => [
  {
    request: 'Graph pull requests over the last month in acme/api by person',
    plan: {
      version: 2,
      title: 'Pull requests by author, last 30 days',
      request: 'Graph pull requests over the last month in acme/api by person',
      time: TIME,
      sources: [pullRequests(workspaceId, ['acme/api'])],
      columns: [pullColumn('author', 'Author', 'person'), pullColumn('createdAt', 'Opened', 'datetime', true)],
      stages: [
        openedSince('-P30D'),
        {
          op: 'summarize',
          by: [{ column: 'author' }],
          measures: [{ id: 'count', label: 'Pull requests', kind: 'count' }],
        },
      ],
      sort: [{ column: 'count', direction: 'desc' }],
      view: { kind: 'chart', shape: 'bar', x: 'author', aggregate: 'sum', field: 'count' },
    } satisfies PanelPlan,
  },
  {
    request: 'Chart the pull requests I opened each day this quarter, in acme/api and acme/web',
    plan: {
      version: 2,
      title: 'My pull requests per day, last 90 days',
      request: 'Chart the pull requests I opened each day this quarter, in acme/api and acme/web',
      time: TIME,
      sources: [pullRequests(workspaceId, ['acme/api', 'acme/web'])],
      columns: [pullColumn('createdAt', 'Opened', 'datetime'), pullColumn('author', 'Author', 'person', true)],
      stages: [
        {
          op: 'filter',
          where: {
            kind: 'comparison',
            left: { address: { from: 'item', pointer: '/author' } },
            operator: 'eq',
            right: { address: { from: 'context', name: 'viewer', pointer: '/login' } },
          },
        },
        openedSince('-P90D'),
      ],
      view: { kind: 'chart', shape: 'line', x: 'createdAt' },
    } satisfies PanelPlan,
  },
]

/** What `panel_guide` returns: the studio's instructions, and what a chat agent needs on top of them. */
export const panelGuide = (workspaceId: string) => ({
  instructions: PANEL_AUTHORING_INSTRUCTIONS,
  inAChat: [
    'Metadata means the data_sources_list, data_source_describe, and data_source_options tools. Take source ids, field pointers, operators, account ids, and option ids from them, never from memory.',
    `Every inline query's scope is { workspaceId: "${workspaceId}", connectionId, parameters }, with connectionId only for a source that needs an account. Leave out projectId: the panel can go on a Home tab, which has no project or task.`,
    'Write the repository, project, and account as values. A plan names nothing from this task, because a panel on Home has no task.',
    'Write a window the person stated relatively, such as "last month" or "this week", as a relative date: { from: "context", name: "now", offset: "-P30D" }. The panel then moves with time. Use a fixed date only when the person gave one.',
    'Write "me" and "mine" with the person filter\'s You: { from: "context", name: "viewer", pointer: "/login" }, on a source whose account has an identity. It resolves to whoever looks at the panel.',
    "Put the person's words in request. A checklist of requirements is welcome but not required here.",
    'Draw the plan with panel_show. It returns every problem with its path into the plan and draws nothing until there are none; fix them and call it again. To change a panel you showed, pass the panelId it returned, which keeps the earlier version in the conversation.',
  ],
  choosingAView: [
    'stat: one number, such as how many pull requests are open.',
    'list: records a person reads and opens, such as their open pull requests.',
    'table: records compared across several columns.',
    'board: records grouped by one enum column, such as issues by state.',
    'chart: a bar counts or sums across categories, with an enum or person axis: summarize by it, then chart the measure with aggregate sum. A line counts the rows by day over a date axis: chart the rows themselves, not a summary.',
    'Totals per week or month are a table over a summary bucketed by week or month; a line only draws days.',
  ],
  examples: panelGuideExamples(workspaceId),
})
