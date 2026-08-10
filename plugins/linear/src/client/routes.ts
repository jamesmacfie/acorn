import type { SourceRouteContribution } from '@acorn/plugin-api/client'

// Linear owns one addressable thing: an issue. The browse itself renders at core's `/p/:projectId`, the
// same as every other Source — a route is for ADDRESSING something inside a surface, not for deciding
// whether the surface appears (plugins/github GithubBrowse.tsx has the long version of that argument).
//
// Project-scoped because the issue list is derived from the routed project's WORKSPACE: linked Linear
// projects hang off the workspace (docs/workspaces-and-tasks.md), and the route has no workspace in it.
//
// Keyed by identifier alone, while an issue is really (integrationId, identifier). Two connected
// Linear workspaces whose teams share a prefix would collide here and open whichever loaded first. The
// upgrade is a connection id in the path; not worth the URL noise until someone has two.
export const linearRouteContributions: readonly SourceRouteContribution[] = [
  { id: 'linear.issue', path: '/p/:projectId/issues/:identifier', order: 60 },
]

export const linearIssuePath = (projectId: string, identifier: string): string =>
  `/p/${encodeURIComponent(projectId)}/issues/${encodeURIComponent(identifier)}`
