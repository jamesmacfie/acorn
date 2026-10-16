import { allProjects, type ContentLinkContribution, type InAppTarget } from '@acorn/plugin-api/client'
import {
  formatPullRequestRef,
  parsePullRequestRef,
  parsePullRequestUrl,
  sameRepository,
} from '../shared/pullRequestRef'
import { bitbucketBrowsePath } from './clientRoutes'

// Bitbucket pull request links, resolved in acorn: the reference panel for a glance, the browse route
// when the repository is one acorn tracks, and the browser otherwise. The page grammar is the browser
// handoff's.
const projectIdFor = (target: InAppTarget): string | null => {
  const repository = typeof target.repository === 'string' ? target.repository : ''
  return (
    allProjects().find(
      (project) => project.repository?.provider === 'bitbucket' && sameRepository(project.repository.path, repository),
    )?.id ?? null
  )
}

export const bitbucketContentLinkContributions: ContentLinkContribution[] = [
  {
    id: 'bitbucket.pull-request',
    providerId: 'bitbucket',
    target: (item) => {
      const ref = parsePullRequestRef(item)
      return ref ? { kind: 'bitbucket.pull-request', item, ...ref } : null
    },
    presentations: ['route', 'refPanel', 'pane', 'external'],
    parse: (href) => {
      const ref = parsePullRequestUrl(href)
      return ref ? { kind: 'pr', ...ref, item: formatPullRequestRef(ref.repository, ref.number) } : null
    },
    path: (target) => {
      const projectId = projectIdFor(target)
      return projectId && typeof target.number === 'string'
        ? `${bitbucketBrowsePath(projectId)}/${target.number}`
        : null
    },
  },
]
