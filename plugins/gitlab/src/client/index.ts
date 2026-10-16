import { lazy } from 'solid-js'
import { type ClientPlugin, setSelectedSource } from '@acorn/plugin-api/client'
import { changeRequestPoints } from '@acorn/change-request-ui/model'
import { parseMergeRequestRef, samePath } from '../shared/mergeRequestRef'
import { gitlabBrowsePath, gitlabRouteContributions, taskMergeRequest } from './clientRoutes'
import { gitlabContentLinkContributions } from './contentLinks'
import { gitlabIntegrationFlow } from './integrationFlow'
import { gitlabMergeRequestPromotion } from './mergeRequestTasks'
import { mrPaneContribution } from './mergeRequest/paneContribution'
import { mrRailMarkerContribution } from './mergeRequest/railMarker'
import { GIT_PUSH_ACTIONS_POINT, GitlabPushActions } from './pushActions'

// Two lazy chunks off one module: the source declares its list and detail apart, and a terminal draws
// them in two panels.
const GitlabBrowseList = lazy(() => import('./GitlabBrowse').then((module) => ({ default: module.GitlabBrowseList })))
const GitlabBrowseDetail = lazy(() =>
  import('./GitlabBrowse').then((module) => ({ default: module.GitlabBrowseDetail })),
)
const MergeRequestRefPanel = lazy(() => import('./MergeRequestRefPanel'))
const GitlabImporter = lazy(() => import('./GitlabImporter'))

// The GitLab mark, from simple-icons (CC0). The trademark remains GitLab's.
const GITLAB_MARK =
  'm23.6004 9.5927-.0337-.0862L20.3.9814a.851.851 0 0 0-.3362-.405.8748.8748 0 0 0-.9997.0539.8748.8748 0 0 0-.29.4399l-2.2055 6.748H7.5375l-2.2057-6.748a.8573.8573 0 0 0-.29-.4412.8748.8748 0 0 0-.9997-.0537.8585.8585 0 0 0-.3362.4049L.4332 9.5015l-.0325.0862a6.0657 6.0657 0 0 0 2.0119 7.0105l.0113.0087.03.0213 4.976 3.7264 2.462 1.8633 1.4995 1.1321a1.0085 1.0085 0 0 0 1.2197 0l1.4995-1.1321 2.4619-1.8633 5.006-3.7489.0125-.01a6.0682 6.0682 0 0 0 2.0094-7.003z'

export const gitlabClientPlugin: ClientPlugin = {
  name: 'gitlab',
  required: false,
  init: (ctx) => {
    ctx.brandMarks.register({ id: 'gitlab', color: '#FC6D26', d: GITLAB_MARK })
    for (const contribution of gitlabContentLinkContributions) ctx.contentLinks.register(contribution)
    ctx.refPanels.register({ id: 'gitlab-merge-request', providerId: 'gitlab', component: MergeRequestRefPanel })
    ctx.sources.register({
      id: 'gitlab',
      order: 11,
      glyph: 'brand:gitlab',
      label: 'GitLab',
      providerId: 'gitlab',
      defaultPane: 'mr',
      regions: { list: GitlabBrowseList, detail: GitlabBrowseDetail },
      origins: { 'gitlab-mr': 'git-pull-request' },
      projectScoped: true,
      routes: gitlabRouteContributions,
      // A task on a merge request lives at its merge request's address in browse.
      taskPath: (task) => {
        const at = taskMergeRequest(task)
        return at ? `${gitlabBrowsePath(task.projectId)}/${at.number}` : undefined
      },
      // Read from the task's primary change request and repository, not the GitHub-named fields.
      tracksRef: (task, ref) => {
        const at = taskMergeRequest(task)
        const named = ref.providerId === 'gitlab' ? parseMergeRequestRef(ref.displayId) : null
        return !!at && !!named && samePath(named.path, at.path) && named.number === String(at.number)
      },
      promotion: gitlabMergeRequestPromotion,
    })
    ctx.projectImporters.register({
      id: 'gitlab',
      label: 'Import from GitLab',
      glyph: 'brand:gitlab',
      component: GitlabImporter,
    })
    ctx.commands.register({
      id: 'source.gitlab.open',
      title: 'Open GitLab',
      category: 'navigation',
      palette: true,
      run: () => setSelectedSource('gitlab'),
    })
    ctx.integrationFlows.register(gitlabIntegrationFlow)
    ctx.panes.register(mrPaneContribution)
    ctx.railMarkers.register(mrRailMarkerContribution)
    for (const point of changeRequestPoints('Merge request')) ctx.extensionPoints.register(point)
    ctx.extensions.register({
      id: 'gitlab.push-actions',
      point: GIT_PUSH_ACTIONS_POINT,
      label: 'Open merge request',
      order: 11,
      component: GitlabPushActions,
    })
  },
}
