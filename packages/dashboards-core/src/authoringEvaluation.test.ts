import { describe, expect, it } from 'vitest'
import { runAuthoringTurn, type AuthoringTurnRequest } from '@acorn/protocol/authoring.ts'
import { panelPlanSchema, type PanelPlan } from '@acorn/protocol/dashboards.ts'
import { dataSourceDescriptionSchema } from '@acorn/protocol/dataSources.ts'
import { bindPanelRows, runPlanStages, sortPlanRows, validatePanelPlan, type PlanSource } from './plan'

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
  instanceId: 'work', label: 'Work', description,
  query: candidate.sources[0]!.reference.kind === 'inline' ? candidate.sources[0]!.reference.content.query : reference('pulls', 'github-acme').content.query,
  result: {
    records: [
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
  { id: '12-worktrees', request: 'Worktrees and unfinished changes', result: 'unavailable', requiredColumns: [], requiredStages: [], expectedRows: [], reach: 'worktree source absent' },
  { id: '13-assigned', request: 'My assigned work across trackers', result: 'unavailable', requiredColumns: [], requiredStages: [], expectedRows: [], reach: 'identity and tracker sources absent' },
  { id: '18-usage', request: 'AI usage and cost by task', result: 'unavailable', requiredColumns: [], requiredStages: [], expectedRows: [], reach: 'usage source and summary absent' },
  { id: 'variant-two-accounts', request: 'My pull requests in either account', result: 'clarification', requiredColumns: [], requiredStages: [], expectedRows: [], reach: 'github-acme or github-personal' },
  { id: 'variant-ambiguous-reach', request: 'All pull requests', result: 'clarification', requiredColumns: [], requiredStages: [], expectedRows: [], reach: 'one repository or all repositories' },
  { id: 'variant-unadded-source', request: 'My calendar conflicts', result: 'unavailable', requiredColumns: [], requiredStages: [], expectedRows: [], reach: 'calendar source absent' },
  { id: 'variant-no-answer', request: 'Show the weather on Mars', result: 'unavailable', requiredColumns: [], requiredStages: [], expectedRows: [], reach: 'weather source absent' },
]

describe('scripted dashboard authoring evaluation', () => {
  it.each(cases)('$id', async testCase => {
    const candidate = plan()
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
      expect(rows.map(row => row.values.title)).toEqual(testCase.expectedRows)
    }
  })
})
