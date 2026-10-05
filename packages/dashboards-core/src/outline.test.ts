import { describe, expect, it } from 'vitest'
import { dataSourceDescriptionSchema } from '@acorn/protocol/dataSources.ts'
import { panelPlanSchema, type PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { DataPredicate } from '@acorn/protocol/dataBindings.ts'
import { describePanelPlan, type PlanSource } from './plan'
import { availableOperations, availableViews, columnParts, countsByPart, diffOutline, inputChain, partForPath, planOutline, problemsByPart, switchView, type PlanInputs } from './outline'

const description = dataSourceDescriptionSchema.parse({
  schema: { type: 'object', properties: {
    title: { type: 'string' }, repo: { type: 'string' }, state: { type: 'string' }, author: { type: 'string' },
    updated: { type: 'string' }, closed: { type: 'string' }, labels: { type: 'array', items: { type: 'string' } },
  }, additionalProperties: false },
  fields: ['title', 'repo', 'state', 'author', 'updated', 'closed', 'labels'].map(name => ({ pointer: `/${name}`, label: name, origin: 'declared' })),
  parameters: { type: 'object', additionalProperties: false }, parameterFields: [],
  operations: { query: true, options: false, details: false, incremental: false, groups: ['all', 'any'] },
  revision: 'one', consistency: 'fixture',
  reach: { parameter: '/repositories', itemPlural: 'repositories', default: 'Everything {account} can see', empty: 'No repositories' },
  targets: [{ kind: 'github.pull-request' }],
})
const query = (sourceId: string) => ({ source: { pluginId: 'fixture', sourceId }, scope: { workspaceId: 'w', parameters: {} }, sort: [] })
const reference = (sourceId: string) => ({ kind: 'inline', content: {
  name: sourceId, parameters: { type: 'object', additionalProperties: false }, sourceParameters: {}, query: query(sourceId),
}, bindings: {} })
const pullSource: PlanSource = {
  instanceId: 'prs', label: 'Pull requests', accountLabel: 'GitHub (Work)', description,
  query: { ...query('pulls'), scope: { workspaceId: 'w', connectionId: 'work', parameters: {} } },
}
const where = (column: string, operator: string, right?: unknown): DataPredicate => ({
  kind: 'comparison', left: { address: { from: 'item', pointer: `/${column}` } }, operator,
  ...(right ? { right: { address: right } } : {}),
} as DataPredicate)
const bind = (...ids: string[]) => Object.fromEntries(ids.map(id => [id, { field: '/title' }]))

/** One source, every step kind but expand and overlap, and every arrange, look, and behaviour field. */
const pulls = (): PanelPlan => panelPlanSchema.parse({
  version: 2, title: 'My pull requests', time: { zone: 'Pacific/Auckland', mode: 'fixed', weekStart: 'monday' },
  sources: [{ id: 'prs', label: 'Pull requests', role: 'primary', reference: reference('pulls') }],
  columns: [
    { id: 'title', label: 'Title', type: 'text', bind: bind('prs') },
    { id: 'repo', label: 'Repository', type: 'text', bind: bind('prs') },
    { id: 'state', label: 'State', type: 'enum', choices: [{ id: 'open', label: 'Open' }, { id: 'draft', label: 'Draft' }], bind: bind('prs') },
    { id: 'author', label: 'Author', type: 'person', bind: bind('prs') },
    { id: 'updated', label: 'Updated', type: 'datetime', bind: bind('prs') },
  ],
  stages: [
    { op: 'filter', where: where('author', 'eq', { from: 'context', name: 'viewer', pointer: '/login' }) },
    { op: 'filter', where: { kind: 'all', predicates: [
      where('state', 'in', { from: 'literal', value: ['open', 'draft'] }),
      where('updated', 'gt', { from: 'context', name: 'now', offset: '-P7D' }),
    ] } },
    { op: 'compute', columns: [{ id: 'age', label: 'Age in days', expression: { kind: 'duration', start: { kind: 'column', column: 'updated' }, end: { kind: 'clock', name: 'now' }, unit: 'days' } }] },
    { op: 'summarize', by: [{ column: 'repo' }], measures: [{ id: 'count', label: 'Count', kind: 'count' }, { id: 'oldest', label: 'Oldest', kind: 'earliest', column: 'updated' }] },
  ],
  sort: [{ column: 'count', direction: 'desc' }], group: [{ column: 'repo' }], limit: 50,
  view: { kind: 'table' }, refresh: 300,
  actions: { press: { kind: 'record', source: 'prs', prefer: 'refPanel' }, buttons: [
    { kind: 'createTask', label: 'Start task' }, { kind: 'open', label: 'Open', reference: { kind: 'record', prefer: 'external' } },
  ] },
})

/** Two sources joined by a relation, with a list column and two date columns. */
const joined = (): PanelPlan => panelPlanSchema.parse({
  version: 2, title: 'Work', time: { zone: 'UTC', mode: 'viewer', weekStart: 'sunday' },
  sources: [
    { id: 'issues', label: 'Issues', role: 'primary', reference: reference('issues') },
    { id: 'reviews', label: 'Reviews', role: 'children', reference: reference('reviews') },
  ],
  relations: [{ id: 'reviewed', from: 'issues', to: 'reviews', kind: 'references', cardinality: 'one-to-many',
    keys: [{ from: '/id', to: '/issue', scope: 'identity' }], output: 'labels' }],
  columns: [
    { id: 'title', label: 'Title', type: 'text', bind: bind('issues') },
    { id: 'state', label: 'State', type: 'enum', bind: bind('issues') },
    { id: 'updated', label: 'Updated', type: 'datetime', bind: bind('issues') },
    { id: 'closed', label: 'Closed', type: 'datetime', bind: bind('issues') },
    { id: 'labels', label: 'Labels', type: 'text', list: true, bind: bind('issues') },
  ],
  stages: [{ op: 'filter', where: { kind: 'any', predicates: [
    where('closed', 'missing'),
    where('closed', 'gte', { from: 'context', name: 'calendar', boundary: 'startOfWeek', offset: '-P1W' }),
  ] } }],
  view: { kind: 'board' }, group: [{ column: 'state' }],
  actions: { press: { kind: 'task', prefer: 'pane' }, buttons: [] },
})

describe('describePanelPlan', () => {
  it('describes each fixture in the same order, in plain words', () => {
    expect(describePanelPlan(pulls(), [pullSource])).toMatchInlineSnapshot(`
      [
        "One row per Repository.",
        "Pull requests reaches Everything GitHub (Work) can see.",
        "Columns: Title, Repository, State, Author, Updated.",
        "Keep rows where Author is you.",
        "Keep rows where State is one of Open, Draft and Updated is after 7 days ago.",
        "Compute Age in days.",
        "One row per Repository; measure Count, Oldest.",
        "Sort by Count newest or highest first.",
        "Group by Repository.",
        "Show at most 50 rows after filtering and sorting.",
        "Pressing a row opens the pull request in a side panel.",
      ]
    `)
    expect(describePanelPlan(pulls())).toMatchInlineSnapshot(`
      [
        "One row per Repository.",
        "Columns: Title, Repository, State, Author, Updated.",
        "Keep rows where Author is you.",
        "Keep rows where State is one of Open, Draft and Updated is after 7 days ago.",
        "Compute Age in days.",
        "One row per Repository; measure Count, Oldest.",
        "Sort by Count newest or highest first.",
        "Group by Repository.",
        "Show at most 50 rows after filtering and sorting.",
        "Pressing a row opens the source record in a side panel.",
      ]
    `)
    expect(describePanelPlan(joined())).toMatchInlineSnapshot(`
      [
        "One row per record from Issues and Reviews.",
        "Columns: Title, State, Updated, Closed, Labels.",
        "Attach children from Reviews through reviewed; keep unmatched rows.",
        "Keep rows where Closed is empty or Closed is at least the start of the week 1 week ago.",
        "Group by State.",
        "Pressing a row opens its task in a task pane.",
      ]
    `)
  })
})


const brief = (plan: PanelPlan, sources: readonly PlanSource[] = []) => planOutline(plan, sources).map(({ key, section, title, detail }) => ({ key, section, title, ...(detail ? { detail } : {}) }))

describe('planOutline', () => {
  it('lists a one-source plan in outline order, naming the account and reach once a run supplies them', () => {
    expect(brief(pulls(), [pullSource])).toEqual([
      { key: 'source:prs', section: 'data', title: 'Pull requests · GitHub (Work)', detail: 'Everything GitHub (Work) can see' },
      { key: 'columns', section: 'columns', title: 'Title, Repository, State, Author, Updated', detail: '5 columns' },
      { key: 'stage:0', section: 'steps', title: 'Keep where Author is you' },
      { key: 'stage:1', section: 'steps', title: 'Keep where State is one of Open, Draft and Updated is after 7 days ago' },
      { key: 'stage:2', section: 'steps', title: 'Calculate Age in days' },
      { key: 'stage:3', section: 'steps', title: 'One row per Repository', detail: 'Count, Oldest' },
      { key: 'arrange', section: 'arrange', title: 'Count, highest first', detail: 'Grouped by Repository · at most 50 rows' },
      { key: 'look', section: 'look', title: 'Table' },
      { key: 'behaviour', section: 'look', title: 'Click opens the pull request', detail: 'In a side panel · 2 buttons' },
      { key: 'settings', section: 'settings', title: 'Refresh every 5 minutes', detail: 'Pacific/Auckland · week starts Monday' },
    ])
    expect(brief(pulls())[0]).toEqual({ key: 'source:prs', section: 'data', title: 'Pull requests' })
  })

  it('adds relations for a joined plan and keeps columns out of the top level', () => {
    expect(brief(joined())).toEqual([
      { key: 'source:issues', section: 'data', title: 'Issues', detail: 'Adds rows' },
      { key: 'source:reviews', section: 'data', title: 'Reviews', detail: 'Adds a list to each row' },
      { key: 'relations', section: 'data', title: 'Attach Reviews', detail: '2 sources' },
      { key: 'columns', section: 'columns', title: 'Title, State, Updated, Closed, Labels', detail: '5 columns' },
      { key: 'stage:0', section: 'steps', title: 'Keep where Closed is empty or Closed is at least the start of the week 1 week ago' },
      { key: 'arrange', section: 'arrange', title: 'In source order', detail: 'Grouped by State' },
      { key: 'look', section: 'look', title: 'Board' },
      { key: 'behaviour', section: 'look', title: 'Click opens its task', detail: 'In a task pane' },
      { key: 'settings', section: 'settings', title: "Refresh on the source's schedule", detail: "Each viewer's time zone · week starts Sunday" },
    ])
    expect(columnParts(joined()).map(({ key, detail }) => [key, detail])).toEqual([
      ['column:title', 'Text'], ['column:state', 'Choice'], ['column:updated', 'Date and time'], ['column:closed', 'Date and time'], ['column:labels', 'List of text'],
    ])
  })
})

describe('mapping onto parts', () => {
  it('finds the part that owns each pointer shape the validator writes', () => {
    const plan = joined()
    expect(partForPath(plan, '/sources/1')).toBe('source:reviews')
    expect(partForPath(plan, '/sources/0/reference')).toBe('source:issues')
    expect(partForPath(plan, '/columns/3/bind/issues')).toBe('column:closed')
    expect(partForPath(plan, '/columns')).toBe('columns')
    expect(partForPath(plan, '/relations/0/keys')).toBe('relations')
    expect(partForPath(plan, '/stages/0/where')).toBe('stage:0')
    expect(partForPath(plan, '/view/x')).toBe('look')
    expect(partForPath(plan, '/sort/0/column')).toBe('arrange')
    expect(partForPath(plan, '/group/0/bucket')).toBe('arrange')
    expect(partForPath(plan, '/actions/buttons/0/reference')).toBe('behaviour')
    expect(partForPath(plan, '/time/zone')).toBe('settings')
    expect(partForPath(plan, '/sources')).toBeUndefined()
    expect(partForPath(plan, '/stages/12')).toBeUndefined()
    expect(partForPath(plan, '/requirements/0/reason')).toBeUndefined()
  })

  it('groups problems by part and keeps the rest for the status bar', () => {
    const error = (path: string) => ({ path, message: path, severity: 'error' as const })
    expect(problemsByPart(pulls(), [error('/stages/1/where'), error('/columns/0/bind/prs'), error('/sources'), error('/stages/1')])).toEqual({
      'stage:1': [error('/stages/1/where'), error('/stages/1')], 'column:title': [error('/columns/0/bind/prs')], plan: [error('/sources')],
    })
  })

  it('maps step counts and takes the source total from the first step', () => {
    const counts = [{ path: '/stages/0', input: 40, output: 12 }, { path: '/stages/1', input: 12, output: 3 }]
    expect(countsByPart(pulls(), counts)).toEqual({ stages: { 'stage:0': counts[0], 'stage:1': counts[1] }, sourceTotal: 40, inputs: {} })
    expect(countsByPart(joined(), counts).sourceTotal).toBeUndefined()
  })
})

describe('derived source inputs', () => {
  const inputs: PlanInputs = { prs: [
    { name: 'pulls', label: 'Pull requests', provider: 'GitHub', account: 'Work', reach: 'Everything Work can see' },
    { name: 'issues', label: 'Cycle issues', provider: 'Linear', optional: true },
  ] }

  it('lists each input under its source, keyed by source and name', () => {
    expect(planOutline(pulls(), [], inputs).slice(0, 3).map(({ key, title, detail, paths }) => ({ key, title, detail, paths }))).toEqual([
      { key: 'source:prs', title: 'Pull requests', detail: undefined, paths: ['/sources/0'] },
      { key: 'input:prs:pulls', title: 'Pull requests', detail: 'GitHub · Work · Everything Work can see',
        paths: ['/sources/0/reference/content/query/scope/inputs/pulls'] },
      { key: 'input:prs:issues', title: 'Cycle issues (optional)', detail: 'Linear · no account chosen',
        paths: ['/sources/0/reference/content/query/scope/inputs/issues'] },
    ])
    expect(planOutline(pulls()).some(part => part.key.startsWith('input:'))).toBe(false)
  })

  it('maps an input pointer to its own part, and to the source without the input list', () => {
    const path = '/sources/0/reference/content/query/scope/inputs/issues'
    expect(partForPath(pulls(), path, inputs)).toBe('input:prs:issues')
    expect(partForPath(pulls(), `${path}/connectionId`, inputs)).toBe('input:prs:issues')
    expect(partForPath(pulls(), path)).toBe('source:prs')
    const problem = { path, message: 'Cycle issues needs a Linear account.', severity: 'error' as const }
    expect(problemsByPart(pulls(), [problem], inputs)).toEqual({ 'input:prs:issues': [problem] })
  })

  it("counts each input's records from the run's source diagnostics", () => {
    expect(countsByPart(pulls(), [], [{ id: 'prs', label: 'Pull requests', inputs: {
      pulls: { records: 12, completeness: { kind: 'complete' } },
    } }]).inputs).toEqual({ 'input:prs:pulls': 12 })
  })

  it('names the chain for About this panel', () => {
    expect(inputChain(inputs.prs!)).toBe('Pull requests (GitHub · Work) and Cycle issues (Linear)')
    expect(inputChain([inputs.prs![0]!])).toBe('Pull requests (GitHub · Work)')
  })
})

describe('what can be added', () => {
  const reasons = (plan: PanelPlan) => Object.fromEntries(availableOperations(plan).map(operation => [operation.id, operation.reason]))

  it('gives a reason for every operation it refuses', () => {
    expect(reasons({ ...pulls(), columns: [] })).toEqual({ filter: 'Add a column first.', compute: 'Add a column first.', summarize: 'Add a column first.', expand: 'Add a column first.', overlap: 'Add a column first.' })
    const full = pulls()
    full.stages = Array.from({ length: 8 }, () => full.stages[0]!)
    expect(reasons(full).filter).toBe('A panel has at most eight steps.')
    const summaries = pulls()
    summaries.stages = [summaries.stages[3]!, summaries.stages[3]!, summaries.stages[3]!]
    expect(reasons(summaries).summarize).toBe('A panel has at most three summaries.')
    expect(reasons(pulls())).toEqual({ filter: undefined, compute: undefined, summarize: undefined, expand: 'Needs a column that holds a list.', overlap: 'Needs two date columns.' })
    const overlapped = joined()
    expect(reasons(overlapped)).toEqual({ filter: undefined, compute: undefined, summarize: undefined, expand: undefined, overlap: undefined })
    overlapped.stages = [{ op: 'overlap', start: 'updated', end: 'closed', maxPairs: 5000 }]
    expect(reasons(overlapped).overlap).toBe('A panel has one overlap step.')
  })

  it('reads each view\'s needs', () => {
    const views = (plan: PanelPlan) => Object.fromEntries(availableViews(plan).map(view => [view.id, view.reason]))
    expect(views(joined())).toEqual({ stat: undefined, list: undefined, table: undefined, board: undefined, chart: undefined })
    expect(views({ ...joined(), group: [{ column: 'title' }] }).board).toBe('Group by a Choice column first.')
    expect(views({ ...joined(), columns: joined().columns.filter(column => column.id === 'title') }).chart).toBe('Needs a date or Choice column.')
  })

  it('switches view, keeping the options the new view has and starting a chart on the summary', () => {
    expect(switchView({ ...pulls(), view: { kind: 'chart', shape: 'line', x: 'repo' } }, 'chart').view).toEqual({ kind: 'chart', shape: 'line', x: 'repo', aggregate: 'sum', field: 'count' })
    expect(switchView({ ...pulls(), view: { kind: 'chart', shape: 'line', x: 'repo' } }, 'list').view).toEqual({ kind: 'list' })
    expect(switchView({ ...pulls(), stages: [] }, 'stat').view).toEqual({ kind: 'stat' })
  })
})

describe('diffOutline', () => {
  const filter = (column: string, value: string) => ({ op: 'filter' as const, where: where(column, 'eq', { from: 'literal', value }) })
  const withStages = (stages: PanelPlan['stages']): PanelPlan => ({ ...pulls(), stages })
  const stagesOf = (diff: ReturnType<typeof diffOutline>) => Object.entries(diff.parts).filter(([key]) => key.startsWith('stage:'))
  const a = filter('repo', 'a'), b = filter('repo', 'b'), c = filter('state', 'open')

  it('marks a filter added at the end and leaves the other parts the same', () => {
    const diff = diffOutline(withStages([a, b]), withStages([a, b, c]))
    expect(stagesOf(diff)).toEqual([['stage:0', 'same'], ['stage:1', 'same'], ['stage:2', 'added']])
    expect(diff.parts.columns).toBe('same')
    expect(diff.parts.arrange).toBe('same')
    expect(diff.removed).toEqual([])
  })

  it('keeps later steps the same when a filter is added in the middle', () => {
    expect(stagesOf(diffOutline(withStages([a, b]), withStages([a, c, b])))).toEqual([['stage:0', 'same'], ['stage:1', 'added'], ['stage:2', 'same']])
  })

  it('marks a changed operator as a changed step', () => {
    const changed = { op: 'filter' as const, where: where('repo', 'ne', { from: 'literal', value: 'a' }) }
    expect(stagesOf(diffOutline(withStages([a, b]), withStages([changed, b])))).toEqual([['stage:0', 'changed'], ['stage:1', 'same']])
  })

  it('lists a removed step under its before index', () => {
    const diff = diffOutline(withStages([a, b, c]), withStages([a, c]))
    expect(stagesOf(diff)).toEqual([['stage:0', 'same'], ['stage:1', 'same']])
    expect(diff.removed.map(part => [part.key, part.title])).toEqual([['stage:1', 'Keep where Repository is "b"']])
  })

  it('reports a column swap by id and as a changed columns part', () => {
    const after = pulls()
    after.columns = [...after.columns.filter(column => column.id !== 'author'), { id: 'approval', label: 'Approval', type: 'enum', bind: bind('prs') }]
    const diff = diffOutline(pulls(), after)
    expect(diff.parts.columns).toBe('changed')
    expect(diff.columnChanges).toEqual({ added: ['approval'], removed: ['author'], changed: [] })
  })

  it('marks parts that only one plan has', () => {
    const diff = diffOutline(pulls(), joined())
    expect(diff.parts['source:prs']).toBe('removed')
    expect(diff.parts['source:issues']).toBe('added')
    expect(diff.parts.relations).toBe('added')
  })
})
