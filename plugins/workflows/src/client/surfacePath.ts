// Where a definition lives, as a URL.
//
// Its own module rather than a line in ./sourceContribution.tsx, because a palette command is a `.ts`
// file with a node-environment test and that file carries the lazy components
// (docs/plugin-authoring.md § Testing).

export const WORKFLOWS_SOURCE_ID = 'workflows'
export const WORKFLOWS_SURFACE_ID = 'workflows'

/** The pattern both routers match. `x` is the segment core reserves for a plugin's project-scoped
 *  URLs (client-core registries/commands/corePaths.ts). */
export const WORKFLOWS_SURFACE_PATH = '/p/:projectId/x/workflows/:id'

export const workflowsSurfacePath = (projectId: string, item: string): string =>
  `/p/${encodeURIComponent(projectId)}/x/workflows/${encodeURIComponent(item)}`
