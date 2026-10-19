import { describe, expect, it } from 'vitest'
import { panelPlanSchema } from '@acorn/protocol/dashboards.ts'
import { dataSourceDescriptionSchema } from '@acorn/protocol/dataSources.ts'
import { validatePanelPlan } from '@acorn/dashboards-core/plan.ts'
import { sessionTotalsSourceDescription } from './sessionTotalsSource'
import { turnSourceDescription } from './turnSource'
import { usageSourceDescription } from './usageSource'

describe.each([
  ['Agent usage records', usageSourceDescription],
  ['Agent turns', turnSourceDescription],
  ['Agent session totals', sessionTotalsSourceDescription],
])('%s starter plans', (_name, description) => {
  it("fit the source's own description", () => {
    dataSourceDescriptionSchema.parse(description)
    expect(description.starterPlans?.length).toBeGreaterThan(0)
    for (const starter of description.starterPlans ?? []) {
      const plan = panelPlanSchema.parse(starter)
      const sources = plan.sources.map((source) => {
        if (source.reference.kind !== 'inline') throw new Error('A starter reads its source inline.')
        return { instanceId: source.id, label: source.label, query: source.reference.content.query, description }
      })
      expect(validatePanelPlan(plan, sources), plan.title).toEqual([])
    }
  })
})
