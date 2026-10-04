import { describe, expect, it } from 'vitest'
import type { PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { PlanSource } from '@acorn/dashboards-core/plan.ts'
import { sourceCoverageProblem } from './coverage'

const at = Date.parse('2026-09-01T00:00:00Z')
const plan = { columns: [{ id: 'at', type: 'datetime', bind: { jobs: { field: '/startedAt' } } }],
  stages: [{ op: 'filter', where: { kind: 'comparison', left: { address: { from: 'item', pointer: '/at' } },
    operator: 'gte', right: { address: { from: 'literal', value: at } } } }] } as unknown as PanelPlan
const source = { instanceId: 'jobs', label: 'Actions jobs', description: { coverage: { kind: 'events',
  complete: true, earliestTime: at + 86_400_000 }, fields: [] }, query: {}, result: { coveredRange: {
  start: at + 86_400_000, end: at + 2 * 86_400_000 } } } as unknown as PlanSource

describe('event coverage', () => {
  it('reports the uncovered part of an otherwise empty window', () => {
    expect(sourceCoverageProblem(plan, source)).toContain('an empty result cannot establish absence')
  })

  it('accepts a window starting inside the verified range', () => {
    const covered = { ...plan, stages: [{ ...plan.stages[0]!, where: { kind: 'comparison',
      left: { address: { from: 'item', pointer: '/at' } }, operator: 'gte',
      right: { address: { from: 'literal', value: at + 86_400_000 } } } }] } as PanelPlan
    expect(sourceCoverageProblem(covered, source, at + 2 * 86_400_000)).toBeUndefined()
  })
})
