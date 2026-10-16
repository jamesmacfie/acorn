import { lazy } from 'solid-js'
import type { PaneLayoutContribution } from '@acorn/plugin-api/client'
import { pullRequestUrl } from '../../shared/pullRequestRef'
import { taskPullRequest } from '../clientRoutes'

// The `bitbucket-pr` pane's registration, apart from the pane, so the pane and the review views behind
// it stay out of the first paint.
const PrPane = lazy(async () => ({ default: (await import('./PrPane')).PrPane }))

export const prPaneContribution: PaneLayoutContribution = {
  id: 'bitbucket-pr',
  label: 'Pull request',
  glyph: 'git-pull-request',
  description: 'Details, files, and diff',
  order: 10,
  defaultChord: 'meta+shift+k',
  when: (task) => !!taskPullRequest(task),
  url: (task) => {
    const at = taskPullRequest(task)
    return at ? pullRequestUrl(at.repository, at.number) : undefined
  },
  minWidth: 520,
  layout: 'single',
  regions: { body: PrPane },
}
