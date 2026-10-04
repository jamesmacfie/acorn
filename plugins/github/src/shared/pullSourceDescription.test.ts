import { describe, expect, it } from 'vitest'
import { panelPlanSchema } from '@acorn/protocol/dashboards.ts'
import { validatePanelPlan } from '@acorn/dashboards-core/plan.ts'
import { pullSourceDescription } from './pullSourceDescription'

describe('GitHub pull request starter plans', () => {
  it('fit the source\'s own description', () => {
    expect(pullSourceDescription.starterPlans?.length).toBeGreaterThan(0)
    for (const starter of pullSourceDescription.starterPlans ?? []) {
      const plan = panelPlanSchema.parse(starter)
      const sources = plan.sources.map(source => {
        if (source.reference.kind !== 'inline') throw new Error('A starter reads its source inline.')
        return { instanceId: source.id, label: source.label, query: source.reference.content.query, description: pullSourceDescription }
      })
      expect(validatePanelPlan(plan, sources), plan.title).toEqual([])
    }
  })
})
