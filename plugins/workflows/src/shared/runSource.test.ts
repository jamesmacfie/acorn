import { expect, it } from 'vitest'
import { panelPlanSchema } from '@acorn/protocol/dashboards.ts'
import { dataSourceDescriptionSchema } from '@acorn/protocol/dataSources.ts'
import { validatePanelPlan } from '@acorn/dashboards-core/plan.ts'
import { runSourceDescription } from './runSource'

it("Workflow runs starter plans fit the source's own description", () => {
  dataSourceDescriptionSchema.parse(runSourceDescription)
  expect(runSourceDescription.starterPlans?.length).toBeGreaterThan(0)
  for (const starter of runSourceDescription.starterPlans ?? []) {
    const plan = panelPlanSchema.parse(starter)
    const sources = plan.sources.map((source) => {
      if (source.reference.kind !== 'inline') throw new Error('A starter reads its source inline.')
      return {
        instanceId: source.id,
        label: source.label,
        query: source.reference.content.query,
        description: runSourceDescription,
      }
    })
    expect(validatePanelPlan(plan, sources), plan.title).toEqual([])
  }
})
