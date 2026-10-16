import { allProjects, type ContentLinkContribution, type InAppTarget } from '@acorn/plugin-api/client'
import {
  formatMergeRequestRef,
  parseMergeRequestRef,
  parseMergeRequestUrl,
  projectAddress,
  samePath,
  splitAddress,
} from '../shared/mergeRequestRef'
import { gitlabBrowsePath } from './clientRoutes'

// GitLab merge request links, resolved in acorn: the reference panel for a glance, the browse route
// when the project is one acorn tracks, and the browser otherwise. The page grammar is the browser
// handoff's, so a project nested in groups at any depth matches.
const gitlabProjects = () => allProjects().filter((project) => project.repository?.provider === 'gitlab')

// gitlab.com, and each company server a tracked project is on. A merge request page on a server no
// project is on opens in the browser, as any other link does.
const isGitlabHost = (host: string): boolean =>
  host === 'gitlab.com' || gitlabProjects().some((project) => project.repository!.host === host)

const projectIdFor = (target: InAppTarget): string | null => {
  const address = typeof target.address === 'string' ? target.address : ''
  return (
    gitlabProjects().find((project) =>
      samePath(projectAddress(project.repository!.host, project.repository!.path), address),
    )?.id ?? null
  )
}

export const gitlabContentLinkContributions: ContentLinkContribution[] = [
  {
    id: 'gitlab.merge-request',
    providerId: 'gitlab',
    target: (item) => {
      const ref = parseMergeRequestRef(item)
      return ref ? { kind: 'gitlab.merge-request', item, ...ref } : null
    },
    presentations: ['route', 'refPanel', 'pane', 'external'],
    parse: (href) => {
      const ref = parseMergeRequestUrl(href)
      if (!ref || !isGitlabHost(splitAddress(ref.address).host)) return null
      return { kind: 'mr', ...ref, item: formatMergeRequestRef(ref.address, ref.number) }
    },
    path: (target) => {
      const projectId = projectIdFor(target)
      return projectId && typeof target.number === 'string' ? `${gitlabBrowsePath(projectId)}/${target.number}` : null
    },
  },
]
