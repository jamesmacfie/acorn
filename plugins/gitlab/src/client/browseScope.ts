import { createQuery } from '@tanstack/solid-query'
import { useParams } from '@solidjs/router'
import { projectsOptions } from '@acorn/plugin-api/client'

// What both halves of the browse surface need: the routed project and its gitlab.com path. The two
// regions draw in two panels in a terminal, and must agree on whether there is anything to list.
export function createBrowseScope() {
  const params = useParams()
  const projects = createQuery(() => projectsOptions(true))
  const project = () => projects.data?.find((candidate) => candidate.id === params.projectId)
  const repository = () => (project()?.repository?.provider === 'gitlab' ? project()!.repository! : null)
  return {
    projectId: () => params.projectId ?? '',
    path: () => repository()?.path ?? '',
    linked: () => !!repository(),
    /** Why there's nothing to list, or undefined while the projects load. */
    emptyMessage: () => {
      if (!projects.data) return undefined
      const selected = project()
      if (!selected)
        return { title: 'Choose a project', body: 'Pick one in the project menu to see its merge requests.' }
      return {
        title: `${selected.name} isn't on GitLab`,
        body: 'Its folder has no gitlab.com remote, so there are no merge requests to show.',
      }
    },
  }
}
