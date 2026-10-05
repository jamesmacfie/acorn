export type Crumb = { label: string; route?: string }

export type BreadcrumbInput = {
  task: { projectId: string; title: string } | null
  params: { projectId?: string; number?: string }
  isNew: boolean
  /** Whether the rail's selected source reads the routed project. */
  projectScoped: boolean
  pathname: string
  projectName: (id: string) => string
  projectRoute: (id: string) => string
}

/** The topbar's trail. Picking a rail source keeps the URL, so a source that ignores the routed
 *  project would otherwise be titled with whatever project and pull request were open before it. */
export function topbarBreadcrumb(input: BreadcrumbInput): Crumb[] {
  // A crumb links only to somewhere else. The one naming the page you are on is plain text.
  const routeUnlessHere = (route: string) => (route === input.pathname ? undefined : route)
  if (input.task) {
    // `/t/:taskId` carries no project, so the task names it: the project, then the task itself.
    return [
      { label: input.projectName(input.task.projectId), route: input.projectRoute(input.task.projectId) },
      { label: input.task.title },
    ]
  }
  const projectId = input.params.projectId
  if (!projectId || !input.projectScoped) return []
  return [
    { label: input.projectName(projectId), route: routeUnlessHere(input.projectRoute(projectId)) },
    ...(input.params.number ? [{ label: `#${input.params.number}` }] : []),
    ...(input.isNew ? [{ label: 'new' }] : []),
  ]
}
