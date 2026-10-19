import { lazy } from 'solid-js'
import type { ClientPlugin } from '@acorn/plugin-api/client'
import { changeRequestPoints } from '@acorn/change-request-ui/model'
import { parsePullRequestRef, sameRepository } from '../shared/pullRequestRef'
import { bitbucketBrowsePath, bitbucketRouteContributions, taskPullRequest } from './clientRoutes'
import { bitbucketContentLinkContributions } from './contentLinks'
import { bitbucketPullRequestPromotion } from './pullRequestTasks'
import { prPaneContribution } from './pullRequest/paneContribution'
import { prRailMarkerContribution } from './pullRequest/railMarker'
import { BitbucketPushActions, GIT_PUSH_ACTIONS_POINT } from './pushActions'

// Two lazy chunks off one module: the source declares its list and detail apart, and a terminal draws
// them in two panels.
const BitbucketBrowseList = lazy(() =>
  import('./BitbucketBrowse').then((module) => ({ default: module.BitbucketBrowseList })),
)
const BitbucketBrowseDetail = lazy(() =>
  import('./BitbucketBrowse').then((module) => ({ default: module.BitbucketBrowseDetail })),
)
const PullRequestRefPanel = lazy(() => import('./PullRequestRefPanel'))
const BitbucketImporter = lazy(() => import('./BitbucketImporter'))

// The Bitbucket mark, from simple-icons (CC0). The trademark remains Atlassian's.
const BITBUCKET_MARK =
  'M.778 1.213a.768.768 0 00-.768.892l3.263 19.81c.084.5.515.868 1.022.873H19.95a.772.772 0 00.77-.646l3.27-20.03a.768.768 0 00-.768-.891zM14.52 15.53H9.522L8.17 8.466h7.561z'

export const bitbucketClientPlugin: ClientPlugin = {
  name: 'bitbucket',
  required: false,
  init: (ctx) => {
    ctx.brandMarks.register({ id: 'bitbucket', color: '#2684FF', d: BITBUCKET_MARK })
    for (const contribution of bitbucketContentLinkContributions) ctx.contentLinks.register(contribution)
    ctx.refPanels.register({ id: 'bitbucket-pull-request', providerId: 'bitbucket', component: PullRequestRefPanel })
    ctx.sources.register({
      id: 'bitbucket',
      order: 12,
      glyph: 'brand:bitbucket',
      label: 'Bitbucket',
      providerId: 'bitbucket',
      defaultPane: 'bitbucket-pr',
      regions: { list: BitbucketBrowseList, detail: BitbucketBrowseDetail },
      origins: { 'bitbucket-pr': 'git-pull-request' },
      projectScoped: true,
      routes: bitbucketRouteContributions,
      // A task on a pull request lives at its pull request's address in browse.
      taskPath: (task) => {
        const at = taskPullRequest(task)
        return at ? `${bitbucketBrowsePath(task.projectId)}/${at.number}` : undefined
      },
      // Read from the task's primary change request and repository, not the GitHub-named fields.
      tracksRef: (task, ref) => {
        const at = taskPullRequest(task)
        const named = ref.providerId === 'bitbucket' ? parsePullRequestRef(ref.displayId) : null
        return !!at && !!named && sameRepository(named.repository, at.repository) && named.number === String(at.number)
      },
      promotion: bitbucketPullRequestPromotion,
    })
    ctx.projectImporters.register({
      id: 'bitbucket',
      label: 'Import from Bitbucket',
      glyph: 'brand:bitbucket',
      component: BitbucketImporter,
    })
    ctx.panes.register(prPaneContribution)
    ctx.railMarkers.register(prRailMarkerContribution)
    for (const point of changeRequestPoints('Pull request')) ctx.extensionPoints.register(point)
    ctx.extensions.register({
      id: 'bitbucket.push-actions',
      point: GIT_PUSH_ACTIONS_POINT,
      label: 'Open pull request',
      order: 12,
      component: BitbucketPushActions,
    })
  },
}
