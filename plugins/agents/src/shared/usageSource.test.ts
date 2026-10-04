import { describe, expect, it } from 'vitest'
import { panelPlanSchema } from '@acorn/protocol/dashboards.ts'
import { validatePanelPlan } from '@acorn/dashboards-core/plan.ts'
import { usageSourceDescription } from './usageSource'

describe('Agent usage records starter plans', () => {
  it('fit the source\'s own description', () => {
    expect(usageSourceDescription.starterPlans?.length).toBeGreaterThan(0)
    for (const starter of usageSourceDescription.starterPlans ?? []) {
      const plan = panelPlanSchema.parse(starter)
      const sources = plan.sources.map(source => {
        if (source.reference.kind !== 'inline') throw new Error('A starter reads its source inline.')
        return { instanceId: source.id, label: source.label, query: source.reference.content.query, description: usageSourceDescription }
      })
      expect(validatePanelPlan(plan, sources), plan.title).toEqual([])
    }
  })
})
