import type { PolicyContribution } from '@acorn/plugin-workflows/contract/extensions.ts'

// What GitLab's two workflow policies say about themselves. Apart from their evaluation, so the Node
// registers them at boot without loading the mirror code an evaluation needs.

const MIN_INTERVAL_MS = 30_000

export const ciSettledDescription: PolicyContribution['describe'] = {
  label: 'CI finished',
  description: "Wait for every job in the merge request's pipeline to finish. Passes when they all passed.",
  icon: 'brand:gitlab',
  minIntervalMs: MIN_INTERVAL_MS,
  fields: [
    {
      id: 'missing',
      label: 'When there are no jobs',
      type: 'select',
      options: [
        { value: 'fail', label: 'Fail' },
        { value: 'wait', label: 'Wait for them to appear' },
      ],
      hint: 'Defaults to fail. Choose wait when a pipeline takes a minute to start after a push.',
    },
  ],
}

export const reviewReceivedDescription: PolicyContribution['describe'] = {
  label: 'Review received',
  description:
    'Wait for someone other than the author to approve or comment on the merge request after the wait started.',
  icon: 'brand:gitlab',
  minIntervalMs: MIN_INTERVAL_MS,
  fields: [{ id: 'include_bots', label: 'Count bots', type: 'boolean', hint: 'Off by default.' }],
}

export const validateReviewReceived: NonNullable<PolicyContribution['validate']> = (settings) =>
  settings.include_bots === undefined || typeof settings.include_bots === 'boolean'
    ? []
    : ['include_bots must be true or false']
