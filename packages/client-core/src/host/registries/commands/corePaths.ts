// Core's own URL shapes, in one place, so the persistence slices, `pathForTask` and the shell's route
// contributions spell them once and core never asks the source registry for a path it owns.
//
// Plugin routes are not here. A plugin owns its own patterns and contributes them through
// `SourceContribution.routes`; the only thing core asks a plugin for is `taskPath`, and it asks every
// source rather than naming one.

// The patterns the Router matches on, and what the source contributions declare against.
export const PROJECT_ROUTE = '/p/:projectId'
export const CREATE_TASK_ROUTE = '/p/:projectId/new'
export const TASK_ROUTE = '/t/:taskId'

// The prefix every project-scoped URL shares, plugin-contributed ones included.
const PROJECT_PATH_PREFIX = '/p/'

// The one segment core reserves for a loaded plugin's project-scoped URLs, and the per-plugin prefix
// minted from it (docs/architecture/packages.md § Two spellings that must not
// drift).
//
// Compiled plugins are not confined this way: github writes `/p/:projectId/pulls` directly through
// `SourceContribution.routes`, because it is part of the binary and its patterns are reviewed with the
// rest of it. A manifest is not, which is the whole difference and the reason this prefix exists.
const PLUGIN_ROUTE_SEGMENT = 'x'
export const pluginProjectRoutePrefix = (pluginId: string): string =>
  `${PROJECT_ROUTE}/${PLUGIN_ROUTE_SEGMENT}/${pluginId}/`

export const projectPath = (projectId: string): string => `/p/${encodeURIComponent(projectId)}`
export const taskPath = (taskId: string): string => `/t/${encodeURIComponent(taskId)}`

export const isProjectPath = (path: string): boolean => path.startsWith(PROJECT_PATH_PREFIX)

// The project id in a project-scoped path, or null. Used by the workspace view memory to check a
// remembered page still belongs to its workspace (features/workspaces/workspaceViewTransition.ts).
export function projectIdFromPath(path: string): string | null {
  const match = /^\/p\/([^/?#]+)/.exec(path)
  return match ? decodeURIComponent(match[1]) : null
}
