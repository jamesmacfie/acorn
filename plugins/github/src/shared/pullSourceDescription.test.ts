import { describe, expect, it } from 'vitest'
import { panelPlanSchema } from '@acorn/protocol/dashboards.ts'
import { validatePanelPlan } from '@acorn/dashboards-core/plan.ts'
import { panelGuideExamples } from '@acorn/dashboards-core/panelGuide.ts'
import { starterTriggerCheck } from '@acorn/protocol/starterTriggers.ts'
import { pullSourceDescription } from './pullSourceDescription'

describe('GitHub pull request starter plans', () => {
  it("fit the source's own description", () => {
    expect(pullSourceDescription.starterPlans?.length).toBeGreaterThan(0)
    for (const starter of pullSourceDescription.starterPlans ?? []) {
      const plan = panelPlanSchema.parse(starter)
      const sources = plan.sources.map((source) => {
        if (source.reference.kind !== 'inline') throw new Error('A starter reads its source inline.')
        return {
          instanceId: source.id,
          label: source.label,
          query: source.reference.content.query,
          description: pullSourceDescription,
        }
      })
      expect(validatePanelPlan(plan, sources), plan.title).toEqual([])
    }
  })
})

describe('GitHub pull request suggested triggers', () => {
  it("pass the Node's check against the source's own description", () => {
    const { kept, dropped } = starterTriggerCheck(pullSourceDescription, pullSourceDescription.starterTriggers)
    expect(dropped).toEqual([])
    expect(kept.map((starter) => starter.label)).toEqual([
      'A pull request asks for your review',
      'A new pull request',
      'Checks fail on a pull request',
    ])
  })
})

describe('panel_guide worked examples', () => {
  it("fit the GitHub pull request source's own description", () => {
    for (const { plan: example } of panelGuideExamples('workspace')) {
      const plan = panelPlanSchema.parse(example)
      const sources = plan.sources.map((source) => {
        if (source.reference.kind !== 'inline') throw new Error('An example reads its source inline.')
        return {
          instanceId: source.id,
          label: source.label,
          query: source.reference.content.query,
          description: pullSourceDescription,
        }
      })
      expect(validatePanelPlan(plan, sources), plan.title).toEqual([])
    }
  })
})
