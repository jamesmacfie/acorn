import { describe, expect, it } from 'vitest'
import { runAuthoringTurn, type AuthoringTurnRequest } from '@acorn/protocol/authoring.ts'
import { panelPlanSchema, type PanelPlan } from '@acorn/protocol/dashboards.ts'
import { dataSourceDescriptionSchema } from '@acorn/protocol/dataSources.ts'
import { parseDataValue } from '@acorn/protocol/dataValues.ts'
import { bindPanelRows, describePanelPlan, runPlanStages, sortPlanRows, validatePanelPlan, type PlanSource } from './plan'
import { PANEL_CAPABILITIES } from './capabilities'

// Scripted cases exercise the actual model-response loop and plan validator. These are fixture
// expectations; acceptance labels from people are collected separately.
const description = dataSourceDescriptionSchema.parse({
  schema: { type: 'object', properties: { title: { type: 'string' }, state: { type: 'string' }, updated: { type: 'string' } } },
  fields: [
    { pointer: '/title', label: 'Title', origin: 'declared', display: { kind: 'text', role: 'title' } },
    { pointer: '/state', label: 'State', origin: 'declared', display: { kind: 'status' } },
    { pointer: '/updated', label: 'Updated', origin: 'declared', display: { kind: 'datetime' } },
  ],
  parameters: { type: 'object' }, parameterFields: [],
  operations: { query: true, options: false, details: false, incremental: false, groups: ['all', 'any'] },
  revision: 'fixture', consistency: 'fixture records',
})
const worktreeDescription = dataSourceDescriptionSchema.parse({
  schema: { type: 'object', properties: { path: { type: 'string' }, modifiedCount: { type: 'number' }, untrackedCount: { type: 'number' } } },
  fields: [
    { pointer: '/path', label: 'Worktree path', origin: 'declared', display: { kind: 'text', role: 'title' } },
    { pointer: '/modifiedCount', label: 'Modified files', origin: 'declared', display: { kind: 'number' } },
    { pointer: '/untrackedCount', label: 'Untracked files', origin: 'declared', display: { kind: 'number' } },
  ], parameters: { type: 'object' }, parameterFields: [],
  operations: { query: true, options: false, details: false, incremental: false, groups: ['all'] },
  revision: 'fixture-worktrees', consistency: 'All local worktrees in the selected project', coverage: { kind: 'snapshot' },
})
const reference = (sourceId: string, connectionId: string) => ({
  kind: 'inline' as const, bindings: {}, content: {
    name: sourceId, parameters: { type: 'object', additionalProperties: false }, sourceParameters: {},
    query: { source: { pluginId: 'fixture', sourceId }, scope: { workspaceId: 'w', connectionId, parameters: {} }, sort: [] },
  },
})
const plan = (sourceId = 'pulls', connectionId = 'github-acme'): PanelPlan => panelPlanSchema.parse({
  version: 2, title: 'Work', request: 'Show work', time: { zone: 'UTC', mode: 'fixed', weekStart: 'monday' },
  sources: [{ id: 'work', label: 'Work', role: 'primary', reference: reference(sourceId, connectionId) }],
  columns: [
    { id: 'title', label: 'Title', type: 'text', bind: { work: { field: '/title' } } },
    { id: 'state', label: 'State', type: 'enum', bind: { work: { field: '/state' } } },
    { id: 'updated', label: 'Updated', type: 'datetime', bind: { work: { field: '/updated' } } },
  ], stages: [], view: { kind: 'table' },
})
const fixture = (candidate: PanelPlan): PlanSource[] => [{
  instanceId: 'work', label: 'Work', description: candidate.sources[0]?.reference.kind === 'inline'
    && candidate.sources[0].reference.content.query.source.sourceId === 'local-worktrees' ? worktreeDescription : description,
  query: candidate.sources[0]!.reference.kind === 'inline' ? candidate.sources[0]!.reference.content.query : reference('pulls', 'github-acme').content.query,
  result: {
    records: candidate.sources[0]?.reference.kind === 'inline' && candidate.sources[0].reference.content.query.source.sourceId === 'local-worktrees'
      ? [{ ref: { pluginId: 'fixture', sourceId: 'local-worktrees', recordId: 'tree' }, data: { path: '/repo/task', modifiedCount: 2, untrackedCount: 1 } }] : [
      { ref: { pluginId: 'fixture', sourceId: 'pulls', recordId: '1' }, data: { title: 'Review API', state: 'open', updated: '2026-10-01' } },
      { ref: { pluginId: 'fixture', sourceId: 'pulls', recordId: '2' }, data: { title: 'Fix auth', state: 'closed', updated: '2026-10-02' } },
    ], revision: 'fixture', mode: 'execution', readTime: 0, evaluationTime: 0, completeness: { kind: 'complete' },
  },
}]

type Case = { id: string; request: string; result: 'proposal' | 'clarification' | 'unavailable';
  requiredColumns: string[]; requiredStages: string[]; expectedRows: string[]; reach: string }
const cases: Case[] = [
  { id: '1-all-pulls', request: 'All my pull requests', result: 'proposal', requiredColumns: ['title', 'state'], requiredStages: [], expectedRows: ['Review API', 'Fix auth'], reach: 'github-acme' },
  { id: '2-review', request: 'Pull requests waiting for my review', result: 'unavailable', requiredColumns: [], requiredStages: [], expectedRows: [], reach: 'requested reviewer source absent' },
  { id: '3-ready', request: 'Open pull requests ready to merge', result: 'proposal', requiredColumns: ['state'], requiredStages: ['filter'], expectedRows: ['Review API'], reach: 'github-acme' },
  { id: '4-inactive', request: 'Pull requests with no recent activity', result: 'unavailable', requiredColumns: [], requiredStages: [], expectedRows: [], reach: 'last activity source absent' },
  { id: '5-summary', request: 'Pull request summary by repository', result: 'unavailable', requiredColumns: [], requiredStages: [], expectedRows: [], reach: 'summary operation unavailable' },
  { id: '12-worktrees', request: 'Worktrees and unfinished changes', result: 'proposal', requiredColumns: ['path', 'modifiedCount', 'untrackedCount'], requiredStages: [], expectedRows: ['/repo/task'], reach: 'all local worktrees for this project' },
  { id: '13-assigned', request: 'My assigned work across trackers', result: 'unavailable', requiredColumns: [], requiredStages: [], expectedRows: [], reach: 'identity and tracker sources absent' },
  { id: '18-usage', request: 'AI usage and cost by task', result: 'unavailable', requiredColumns: [], requiredStages: [], expectedRows: [], reach: 'usage source and summary absent' },
  { id: '26-awaiting-reply', request: 'Messages awaiting a direct reply', result: 'unavailable', requiredColumns: [], requiredStages: [], expectedRows: [], reach: 'evidence-backed classification and complete thread coverage absent' },
  { id: 'variant-two-accounts', request: 'My pull requests in either account', result: 'clarification', requiredColumns: [], requiredStages: [], expectedRows: [], reach: 'github-acme or github-personal' },
  { id: 'variant-ambiguous-reach', request: 'All pull requests', result: 'clarification', requiredColumns: [], requiredStages: [], expectedRows: [], reach: 'one repository or all repositories' },
  { id: 'variant-unadded-source', request: 'My calendar conflicts', result: 'unavailable', requiredColumns: [], requiredStages: [], expectedRows: [], reach: 'calendar source absent' },
  { id: 'variant-no-answer', request: 'Show the weather on Mars', result: 'unavailable', requiredColumns: [], requiredStages: [], expectedRows: [], reach: 'weather source absent' },
]

describe('scripted dashboard authoring evaluation', () => {
  it('requires a declared value for a requested board write and describes that exact mapping', () => {
    const candidate = plan()
    candidate.view = { kind: 'board' }
    candidate.group = [{ column: 'state' }]
    candidate.columns[1]!.choices = [{ id: 'done', label: 'Done', writeValues: { work: 'closed' } }]
    candidate.requirements = [{ id: 'move', text: 'Move a pull request to Done', status: 'covered',
      paths: ['/columns/state/choices/done/writeValues/work'] }]
    const source = fixture(candidate)[0]!
    const writable = { ...source, description: { ...source.description,
      writable: [{ field: '/state', path: '/v1/p/fixture/write', risk: 'write' as const, values: ['open', 'closed'] }] } }
    expect(validatePanelPlan(candidate, [writable])).toEqual([])
    expect(describePanelPlan(candidate, [writable]).join(' ')).toContain('Dropping a Work record on Done sets State to "closed".')
    candidate.columns[1]!.choices![0]!.writeValues = { work: 'unknown' }
    expect(validatePanelPlan(candidate, [writable]).some(problem => problem.path.includes('/writeValues/'))).toBe(true)
  })
  it.each(cases)('$id', async testCase => {
    const candidate = testCase.id === '12-worktrees' ? panelPlanSchema.parse({ ...plan('local-worktrees'), columns: [
      { id: 'path', label: 'Worktree path', type: 'text', bind: { work: { field: '/path' } } },
      { id: 'modifiedCount', label: 'Modified', type: 'number', bind: { work: { field: '/modifiedCount' } } },
      { id: 'untrackedCount', label: 'Untracked', type: 'number', bind: { work: { field: '/untrackedCount' } } },
    ] }) : plan()
    if (testCase.requiredStages.includes('filter')) candidate.stages = [{ op: 'filter', where: {
      kind: 'comparison', left: { address: { from: 'item', pointer: '/state' } }, operator: 'eq', right: { address: { from: 'literal', value: 'open' } },
    } }]
    candidate.request = testCase.request
    candidate.requirements = [{ id: 'reach', text: testCase.reach, status: testCase.result === 'proposal' ? 'covered' : 'unavailable',
      ...(testCase.result === 'proposal' ? { paths: ['/sources/work'] } : { reason: testCase.reach }) }]
    const reply = testCase.result === 'proposal' ? { kind: 'proposal', candidate, summary: 'Fixture proposal.' }
      : testCase.result === 'clarification' ? { kind: 'clarification', question: 'Which reach?', choices: [{ id: 'a', label: 'One' }, { id: 'b', label: 'All' }] }
        : { kind: 'unavailable', reasons: [{ capability: testCase.reach, reason: 'No described source or operation provides it.' }] }
    const request: AuthoringTurnRequest = { target: 'dashboard', scope: { workspaceId: 'w' }, targetId: testCase.id,
      baseRevision: 0, base: plan(), backendId: 'scripted:fixture', instruction: testCase.request, context: [], samplesEnabled: false }
    const result = await runAuthoringTurn({ request, system: 'Only described capabilities.', facts: { accounts: ['github-acme', 'github-personal'] },
      generate: async () => ({ text: JSON.stringify(reply), providerId: 'scripted', modelId: 'fixture' }),
      metadata: async () => ({ sources: ['pulls'] }),
      validate: async value => {
        const parsed = panelPlanSchema.safeParse(value)
        if (!parsed.success) return { problems: ['Invalid plan schema.'] }
        const problems = validatePanelPlan(parsed.data, fixture(parsed.data)).filter(item => item.severity === 'error').map(item => item.message)
        return { candidate: parsed.data, problems }
      },
    })
    expect(result.state).toBe(testCase.result)
    if (result.state === 'proposal') {
      expect(result.problems).toEqual([])
      const authored = panelPlanSchema.parse(result.candidate)
      for (const id of testCase.requiredColumns) expect(authored.columns.some(column => column.id === id)).toBe(true)
      for (const op of testCase.requiredStages) expect(authored.stages.some(stage => stage.op === op)).toBe(true)
      const rows = sortPlanRows(authored, runPlanStages(authored, bindPanelRows(authored, fixture(authored))).rows)
      expect(rows.map(row => row.values[testCase.id === '12-worktrees' ? 'path' : 'title'])).toEqual(testCase.expectedRows)
    }
  })

  it.each([
    { id: 'local branches', sourceId: 'local-branches', reach: 'selected local project',
      fields: [{ id: 'name', type: 'text' }, { id: 'aheadDefault', type: 'number' }],
      data: { name: 'topic', aheadDefault: 2 }, expected: ['topic', 2] },
    { id: 'usage events', sourceId: 'usage-records', reach: 'ledger events inside the requested time window',
      fields: [{ id: 'model', type: 'text' }, { id: 'costUsd', type: 'number' }, { id: 'costSource', type: 'text' }],
      data: { model: 'model-a', costUsd: null, costSource: 'unknown' }, expected: ['model-a', null, 'unknown'] },
    { id: 'Actions jobs', sourceId: 'actions-jobs', reach: 'chosen repositories with bounded event coverage',
      fields: [{ id: 'job', type: 'text' }, { id: 'conclusion', type: 'enum' }, { id: 'attempt', type: 'number' }],
      data: { job: 'build', conclusion: 'failure', attempt: 2 }, expected: ['build', 'failure', 2] },
  ] as const)('accepts a $id source proposal', async testCase => {
    const columns = testCase.fields.map(field => ({ id: field.id, label: field.id, type: field.type,
      bind: { work: { field: `/${field.id}` } } }))
    const candidate = panelPlanSchema.parse({ ...plan(testCase.sourceId), columns,
      requirements: [{ id: 'reach', text: testCase.reach, status: 'covered', paths: ['/sources/work'] }] })
    const sourceDescription = dataSourceDescriptionSchema.parse({
      revision: 'phase03-fixture', consistency: testCase.reach,
      schema: { type: 'object', properties: Object.fromEntries(testCase.fields.map(field => [field.id,
        { type: field.type === 'number' && testCase.sourceId === 'usage-records' ? ['number', 'null']
          : field.type === 'number' ? 'number' : 'string' }])) },
      fields: testCase.fields.map(field => ({ pointer: `/${field.id}`, label: field.id, origin: 'declared',
        display: { kind: field.type === 'enum' ? 'status' : field.type } })),
      parameters: { type: 'object' }, parameterFields: [],
      operations: { query: true, options: false, details: false, incremental: false, groups: ['all'] },
      coverage: testCase.sourceId === 'local-branches' ? { kind: 'snapshot' } : { kind: 'events', complete: false },
    })
    const source: PlanSource = { instanceId: 'work', label: 'Work', description: sourceDescription,
      query: candidate.sources[0]!.reference.kind === 'inline' ? candidate.sources[0]!.reference.content.query : reference(testCase.sourceId, 'account').content.query,
      result: { records: [{ ref: { pluginId: 'fixture', sourceId: testCase.sourceId, recordId: 'record' }, data: parseDataValue(testCase.data) }],
        revision: 'phase03-fixture', mode: 'execution', readTime: 0, evaluationTime: 0, completeness: { kind: 'complete' } } }
    const request: AuthoringTurnRequest = { target: 'dashboard', scope: { workspaceId: 'w' }, targetId: testCase.sourceId,
      baseRevision: 0, base: plan(), backendId: 'scripted:fixture', instruction: `Show ${testCase.id}`, context: [], samplesEnabled: false }
    const result = await runAuthoringTurn({ request, system: 'Only described capabilities.', facts: {},
      generate: async () => ({ text: JSON.stringify({ kind: 'proposal', candidate, summary: 'Fixture proposal.' }), providerId: 'scripted', modelId: 'fixture' }),
      metadata: async () => ({ sources: [testCase.sourceId] }),
      validate: async value => {
        const parsed = panelPlanSchema.safeParse(value)
        if (!parsed.success) return { problems: ['Invalid plan schema.'] }
        return { candidate: parsed.data, problems: validatePanelPlan(parsed.data, [source]).filter(item => item.severity === 'error').map(item => item.message) }
      },
    })
    expect(result.state).toBe('proposal')
    if (result.state !== 'proposal') return
    expect(result.problems).toEqual([])
    const authored = panelPlanSchema.parse(result.candidate)
    const rows = bindPanelRows(authored, [source])
    expect(rows).toHaveLength(1)
    expect(testCase.fields.map(field => rows[0]!.values[field.id])).toEqual(testCase.expected)
  })
})

// One scripted proposal per operation, so a new operation can't ship without an evaluation case. The
// extra columns hold constant values, which gives the list and second date the fixture source lacks.
type Stage = PanelPlan['stages'][number]
const OPERATION_CASES: { [Op in Stage['op']]: { stage: Extract<Stage, { op: Op }>; columns?: PanelPlan['columns'] } } = {
  filter: { stage: { op: 'filter', where: { kind: 'comparison', left: { address: { from: 'item', pointer: '/state' } }, operator: 'eq', right: { address: { from: 'literal', value: 'open' } } } } },
  compute: { stage: { op: 'compute', columns: [{ id: 'age', label: 'Age', expression: { kind: 'duration', start: { kind: 'column', column: 'updated' }, end: { kind: 'clock', name: 'now' }, unit: 'days' } }] } },
  summarize: { stage: { op: 'summarize', by: [{ column: 'state' }], measures: [{ id: 'count', label: 'Count', kind: 'count' }] } },
  expand: { stage: { op: 'expand', column: 'tags', output: 'tag', perRow: 100 }, columns: [{ id: 'tags', label: 'Tags', type: 'text', list: true, bind: { work: { value: ['a', 'b'] } } }] },
  overlap: { stage: { op: 'overlap', start: 'updated', end: 'due', maxPairs: 5000 }, columns: [{ id: 'due', label: 'Due', type: 'datetime', bind: { work: { value: '2026-10-09' } } }] },
}

describe('an evaluation case for every operation', () => {
  it.each(PANEL_CAPABILITIES.operations.map(operation => operation.id))('accepts a proposal that uses %s', async op => {
    const testCase = OPERATION_CASES[op]
    expect(testCase).toBeDefined()
    const base = plan()
    const candidate = panelPlanSchema.parse({ ...base, columns: [...base.columns, ...testCase.columns ?? []], stages: [testCase.stage] })
    const request: AuthoringTurnRequest = { target: 'dashboard', scope: { workspaceId: 'w' }, targetId: op, baseRevision: 0, base,
      backendId: 'scripted:fixture', instruction: `Use ${op}`, context: [], samplesEnabled: false }
    const result = await runAuthoringTurn({ request, system: 'Only described capabilities.', facts: {},
      generate: async () => ({ text: JSON.stringify({ kind: 'proposal', candidate, summary: 'Fixture proposal.' }), providerId: 'scripted', modelId: 'fixture' }),
      metadata: async () => ({ sources: ['pulls'] }),
      validate: async value => {
        const parsed = panelPlanSchema.safeParse(value)
        if (!parsed.success) return { problems: ['Invalid plan schema.'] }
        return { candidate: parsed.data, problems: validatePanelPlan(parsed.data, fixture(parsed.data)).filter(item => item.severity === 'error').map(item => item.message) }
      },
    })
    expect(result.state).toBe('proposal')
    if (result.state !== 'proposal') return
    expect(result.problems).toEqual([])
    expect(panelPlanSchema.parse(result.candidate).stages.map(stage => stage.op)).toEqual([op])
  })
})
