import { describe, expect, it } from 'vitest'
import type { WorkflowDef } from '../../shared/workflowContracts'
import { branchLabel, dependencyLabels, referenceLabels, stepSummary } from './outlineModel'

const inlineQuery = (pluginId: string, sourceId: string) => ({
  kind: 'inline' as const,
  content: {
    name: `${pluginId} records`,
    parameters: { type: 'object' as const, properties: {}, additionalProperties: false },
    query: { source: { pluginId, sourceId }, scope: { parameters: {} }, sort: [] },
    sourceParameters: {},
  },
  bindings: {},
})

const def: WorkflowDef = {
  formatVersion: 2,
  name: 'Triage',
  steps: [
    { id: 'find', name: 'Recent issues', kind: 'find-records', after: [], query: { kind: 'saved', queryId: 'q1', bindings: {} } },
    { id: 'each', name: 'For each issue', kind: 'workflow-map', after: ['find'], items: { step: 'find', pointer: '/records' }, childWorkflow: { ref: { source: 'database', id: 'child' } } },
    { id: 'check', name: 'Requires work?', kind: 'if', after: ['each'], branches: { true: 'analyze', otherwise: 'finish' } },
    { id: 'analyze', name: 'Analyze issue', after: ['check'] },
    { id: 'finish', name: 'Finish', after: ['check'] },
  ],
}

describe('outline model', () => {
  it('describes guided record loops and their dependencies', () => {
    expect(stepSummary(def.steps[0]!, def, undefined)).toBe('Find records with a saved query.')
    expect(stepSummary(def.steps[1]!, def, undefined)).toContain('For each result from Recent issues')
    expect(dependencyLabels(def.steps[1]!, def)).toEqual(['Recent issues'])
  })

  it('labels branches and names affected references before deletion', () => {
    expect(branchLabel(def.steps[3]!, def)).toBe('If')
    expect(branchLabel(def.steps[4]!, def)).toBe('Otherwise')
    expect(referenceLabels('find', def)).toEqual(['For each issue dependency', 'For each issue records'])
  })

  it.each([
    ['GitHub PR review', 'github', 'pull-requests'],
    ['Linear issue triage', 'linear', 'issues'],
    ['Rollbar occurrence review', 'rollbar', 'occurrences'],
  ])('keeps the %s authoring journey readable without exposing pointers', (_name, pluginId, sourceId) => {
    const journey: WorkflowDef = {
      formatVersion: 2,
      name: _name,
      steps: [
        { id: 'find', name: 'Find records', kind: 'find-records', after: [], query: inlineQuery(pluginId, sourceId) },
        { id: 'each', name: 'Review each record', kind: 'workflow-map', after: ['find'], items: { step: 'find', pointer: '/records' }, childWorkflow: { ref: { source: 'database', id: 'review-record' } } },
      ],
    }

    expect(stepSummary(journey.steps[0]!, journey, undefined)).toBe(`Find records from ${pluginId} · ${sourceId}.`)
    expect(stepSummary(journey.steps[1]!, journey, undefined)).toBe('For each result from Find records, run an unavailable workflow.')
    expect(dependencyLabels(journey.steps[1]!, journey)).toEqual(['Find records'])
    expect(stepSummary(journey.steps[1]!, journey, undefined)).not.toContain('/records')
  })
})
