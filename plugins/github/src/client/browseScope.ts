// What both halves of the browse surface need to know: which project is routed, and whether it has a
// GitHub remote to list pulls from.
//
// Extracted when the surface split into a `list` and a `detail` region so a terminal shell could draw
// them in two different panels (client-core § SourceContribution.regions). Both halves ask the same
// three questions and must never answer them differently — a list that thinks the project is linked
// beside a detail that thinks it is not is worse than either error alone.
//
// A function rather than a context: each half calls it in its own scope, and the queries underneath
// are the same cached ones, so there is nothing to share but the derivation.
import { createQuery } from '@tanstack/solid-query'
import { useParams } from '@solidjs/router'
import { projectsOptions } from '@acorn/plugin-api/client'

export type BrowseScope = {
  projectId: () => string
  owner: () => string
  repo: () => string
  /** Pull requests need the GitHub facet, not only a project: a project with no github.com remote has
   *  no pulls to list, and without this gate the list sits on "Loading…" forever because its queries
   *  never enable. */
  linked: () => boolean
  /** Why the routed project is missing, or `undefined` while the query is in flight — so the first
   *  paint shows the brand mark rather than flashing "select a project". */
  emptyMessage: () => string | undefined
}

export function createBrowseScope(): BrowseScope {
  const params = useParams()
  const projects = createQuery(() => projectsOptions(true))
  const project = () => projects.data?.find((candidate) => candidate.id === params.projectId)
  return {
    projectId: () => params.projectId ?? '',
    owner: () => project()?.github?.owner ?? '',
    repo: () => project()?.github?.name ?? '',
    linked: () => !!project()?.github,
    emptyMessage: () => {
      if (!projects.data) return undefined
      const selected = project()
      if (!selected) return 'Select a project from the project menu to browse pull requests.'
      return `${selected.name} has no GitHub remote.`
    },
  }
}
