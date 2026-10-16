import { allProjects, type ContentLinkContribution, type InAppTarget } from '@acorn/plugin-api/client'
import { formatMergeRequestRef, parseMergeRequestRef, parseMergeRequestUrl, samePath } from '../shared/mergeRequestRef'
import { gitlabBrowsePath } from './clientRoutes'

// gitlab.com merge request links, resolved in acorn: the reference panel for a glance, the browse
// route when the project is one acorn tracks, and the browser otherwise. The page grammar is the
// browser handoff's, so a project nested in groups at any depth matches.
const projectIdFor = (target: InAppTarget): string | null => {
  const path = typeof target.path === 'string' ? target.path : ''
  return (
    allProjects().find(
      (project) => project.repository?.provider === 'gitlab' && samePath(project.repository.path, path),
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
      return ref
        ? { kind: 'mr', path: ref.path, number: ref.number, item: formatMergeRequestRef(ref.path, ref.number) }
        : null
    },
    path: (target) => {
      const projectId = projectIdFor(target)
      return projectId && typeof target.number === 'string' ? `${gitlabBrowsePath(projectId)}/${target.number}` : null
    },
  },
]
