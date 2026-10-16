// Where a task's pull request stands, in the corners of its `bitbucket-pr` pane button, as GitHub's and
// GitLab's buttons do: build statuses top right, the review decision bottom right, and draft, merged,
// or declined top left.
// Its own entrypoint, because the client entry imports it eagerly and the views barrel would pull every
// shared view into first paint.
import { changeRequestRailMarker } from '@acorn/change-request-ui/railMarker'
import { pullRequestRoute } from '../../shared/api'
import { taskPullRequest } from '../clientRoutes'

export const prRailMarkerContribution = changeRequestRailMarker({
  id: 'bitbucket-pr-status',
  pane: 'bitbucket-pr',
  pluginId: 'bitbucket',
  target: taskPullRequest,
  route: (at) => pullRequestRoute(at.repository, at.number),
  synced: (payload) => {
    const event = (payload ?? {}) as { repository?: unknown; number?: unknown }
    return typeof event.repository === 'string' && typeof event.number === 'number'
      ? { repository: event.repository, number: event.number }
      : null
  },
})
