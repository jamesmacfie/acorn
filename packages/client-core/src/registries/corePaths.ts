// Core's own URL shapes, in one place.
//
// These strings were already hardcoded in three files — the last-path persistence slice built
// `/p/${projectId}` by hand, `pathForTask` built `/t/${id}`, and the shell's route contributions
// declared the patterns a fourth time. Collecting them here is what lets the kind-based route lookup go:
// core no longer has to ask the source registry for a path it owns, and a caller that wants a project URL
// can no longer be answered by whichever plugin happened to register a matching `kind` first.
//
// Plugin routes are NOT here. A plugin owns its own patterns (plugins/github/src/client/routes.ts) and
// contributes them through `SourceContribution.routes`; the only thing core asks a plugin for is
// `taskPath` (registries/sources.ts), and it asks every source rather than naming one.

// Route PATTERNS — what the Router matches on and what the source contributions declare.
export const PROJECT_ROUTE = '/p/:projectId'
export const CREATE_TASK_ROUTE = '/p/:projectId/new'
export const TASK_ROUTE = '/t/:taskId'

// The prefix every project-scoped URL shares, plugin-contributed ones included. The last-path slice uses
// it to decide whether the current location is worth remembering.
export const PROJECT_PATH_PREFIX = '/p/'

// The one segment core reserves for a LOADED plugin's project-scoped URLs, and the per-plugin prefix
// minted from it. This is the declaration that `x` is taken: core will not add a `/p/:projectId/x` of its
// own, so a manifest confined to `/p/:projectId/x/<pluginId>/` cannot collide with core's paths, and two
// plugins cannot collide with each other because exactly one bundle wins per plugin id.
//
// Compiled plugins are deliberately NOT confined — github writes `/p/:projectId/pulls` directly through
// `SourceContribution.routes`, because it is part of the binary and its patterns are reviewed with the
// rest of it. A manifest is not, which is the whole difference and the reason this prefix exists.
//
// node-core/main/pluginManifest.ts re-spells the same string to check it at parse time; it cannot import
// this, because the client is downstream of the node. The two are one edit apart on purpose.
export const PLUGIN_ROUTE_SEGMENT = 'x'
export const pluginProjectRoutePrefix = (pluginId: string): string =>
  `${PROJECT_ROUTE}/${PLUGIN_ROUTE_SEGMENT}/${pluginId}/`

export const projectPath = (projectId: string): string => `/p/${encodeURIComponent(projectId)}`
export const createTaskPath = (projectId: string): string => `${projectPath(projectId)}/new`
export const taskPath = (taskId: string): string => `/t/${encodeURIComponent(taskId)}`

export const isProjectPath = (path: string): boolean => path.startsWith(PROJECT_PATH_PREFIX)

// The project id in a project-scoped path, or null. Used by the last-path restore to check a remembered
// URL still names a project this node has.
export function projectIdFromPath(path: string): string | null {
  const match = /^\/p\/([^/?#]+)/.exec(path)
  return match ? decodeURIComponent(match[1]) : null
}
