import type { PolicyContribution } from '@acorn/plugin-workflows/contract/extensions.ts'

// What Bitbucket's two workflow policies say about themselves. Apart from their evaluation, so the Node
// registers them at boot without loading the mirror code an evaluation needs.

const MIN_INTERVAL_MS = 30_000

export const ciSettledDescription: PolicyContribution['describe'] = {
  label: 'CI finished',
  description: "Wait for every build status on the pull request's head commit to finish. Passes when they all passed.",
  icon: 'brand:bitbucket',
  minIntervalMs: MIN_INTERVAL_MS,
  fields: [
    {
      id: 'missing',
      label: 'When there are no build statuses',
      type: 'select',
      options: [
        { value: 'fail', label: 'Fail' },
        { value: 'wait', label: 'Wait for them to appear' },
      ],
      hint: 'Defaults to fail. Choose wait when a build takes a minute to report after a push.',
    },
  ],
}

export const reviewReceivedDescription: PolicyContribution['describe'] = {
  label: 'Review received',
  description:
    'Wait for someone other than the author to approve, ask for changes, or comment on the pull request after the wait started.',
  icon: 'brand:bitbucket',
  minIntervalMs: MIN_INTERVAL_MS,
  fields: [{ id: 'include_bots', label: 'Count bots', type: 'boolean', hint: 'Off by default.' }],
}

export const validateReviewReceived: NonNullable<PolicyContribution['validate']> = (settings) =>
  settings.include_bots === undefined || typeof settings.include_bots === 'boolean'
    ? []
    : ['include_bots must be true or false']
