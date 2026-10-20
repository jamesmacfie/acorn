import { describe, expect, it } from 'vitest'
import { panelPlanSchema } from '@acorn/protocol/dashboards.ts'
import { dataSourceDescriptionSchema } from '@acorn/protocol/dataSources.ts'
import { validatePanelPlan } from '@acorn/dashboards-core/plan.ts'
import { memorySourceDescription } from './memorySource'

describe('Memories starter plans', () => {
  it("fit the source's own description", () => {
    dataSourceDescriptionSchema.parse(memorySourceDescription)
    expect(memorySourceDescription.starterPlans?.length).toBeGreaterThan(0)
    for (const starter of memorySourceDescription.starterPlans ?? []) {
      const plan = panelPlanSchema.parse(starter)
      const sources = plan.sources.map((source) => {
        if (source.reference.kind !== 'inline') throw new Error('A starter reads its source inline.')
        return {
          instanceId: source.id,
          label: source.label,
          query: source.reference.content.query,
          description: memorySourceDescription,
        }
      })
      expect(validatePanelPlan(plan, sources), plan.title).toEqual([])
    }
  })
})
