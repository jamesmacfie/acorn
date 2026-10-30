// The `review-guide:generate` workflow step (docs/first-party-plugins/review-guide.md § In a workflow). It runs
// the pane's generation for the run's task and waits for it, so the guide is in the Guide tab when the
// person opens the change request.
import type { StepHandler, StepKindDescription } from '@acorn/plugin-workflows/contract/extensions.ts'
import type { Guide } from '../shared/guide'
import { GuideError, type Guides } from './guides'

export const describeGuideStep: StepKindDescription = {
  label: 'Generate a review guide',
  description: "Have a harness write the guide for the task's change request, and wait until it's ready.",
  icon: 'list-checks',
  fields: [
    {
      id: 'profileId',
      label: 'Harness',
      type: 'select',
      optionsRoute: '/v1/p/review-guide/profiles',
      hint: 'Empty uses the harness you picked in the Guide pane.',
    },
  ],
  output: { description: "The guide's summary and its step titles, in reading order." },
}

const guideText = (guide: Guide) => [guide.summary, '', ...guide.steps.map((step) => `- ${step.title}`)].join('\n')

/** `owner` is the node's bound owner. A run has no request to take a user from, and the harness
 *  choice is that person's pref. */
export function guideStepHandler(guides: Guides, owner: () => string | null): StepHandler {
  return async (ctx) => {
    const userId = owner()
    if (!userId) return { status: 'failed', error: 'This node has no bound owner, so it has no harness choice to use.' }
    const picked = ctx.def.with?.profileId
    ctx.emit({ at: Date.now(), event: { type: 'progress', text: 'Writing the review guide' } })
    let finished
    try {
      finished = await guides.generateAndWait(
        userId,
        ctx.run.taskId,
        typeof picked === 'string' && picked ? picked : undefined,
        ctx.signal,
      )
    } catch (error) {
      if (error instanceof GuideError) return { status: 'failed', error: error.message }
      throw error
    }
    const cost = { costUsd: finished.costUsd, ...(finished.usage ? { usage: finished.usage } : {}) }
    if (!finished.guide) return { status: 'failed', error: finished.error ?? 'The guide failed.', ...cost }
    // Text in `result` rather than the guide in `structured`: the runner hands a later step the
    // structured value in place of the text when a step has both.
    return { status: 'done', result: { result: guideText(finished.guide) }, ...cost }
  }
}
