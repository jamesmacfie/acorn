// Where a task's merge request stands, in the corners of its `mr` pane button, as GitHub's pull
// request button does: the pipeline top right, approval bottom right, conflicts bottom left, and draft,
// merged, or closed top left.
// Its own entrypoint, because the client entry imports it eagerly and the views barrel would pull every
// shared view into first paint.
import { changeRequestRailMarker } from '@acorn/change-request-ui/railMarker'
import { mergeRequestRoute } from '../../shared/api'
import { taskMergeRequest } from '../clientRoutes'

export const mrRailMarkerContribution = changeRequestRailMarker({
  id: 'mr-status',
  pane: 'mr',
  pluginId: 'gitlab',
  target: (task) => {
    const at = taskMergeRequest(task)
    return at ? { repository: at.address, number: at.number } : null
  },
  route: (at) => mergeRequestRoute(at.repository, at.number),
  synced: (payload) => {
    const event = (payload ?? {}) as { projectAddress?: unknown; number?: unknown }
    return typeof event.projectAddress === 'string' && typeof event.number === 'number'
      ? { repository: event.projectAddress, number: event.number }
      : null
  },
})
