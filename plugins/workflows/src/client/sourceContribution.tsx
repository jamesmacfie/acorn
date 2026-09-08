import { lazy } from 'solid-js'
import type { ProjectSurfaceContribution, SourceContribution, SourceRouteContribution } from '@acorn/plugin-api/client'
import { WORKFLOWS_SOURCE_ID, WORKFLOWS_SURFACE_ID, WORKFLOWS_SURFACE_PATH } from './surfacePath'

// The Workflows rail source, and the project-scoped surface its rows address.
//
// Two lazy chunks off one module, as github's browse does, because the source names its list and its
// detail separately and a terminal shell draws them in two different panels
// (client-core registries/sources.ts § regions).
//
// No `providerId`: nothing has to be connected for a workspace to have workflows, so the row is in
// every rail. `projectScoped`, because a definition is saved against a project and the editor's URL
// carries one, which is what makes the shell offer the project picker here.

const WorkflowsBrowseList = lazy(() => import('./WorkflowsBrowse').then((module) => ({ default: module.WorkflowsBrowseList })))
const WorkflowsBrowseDetail = lazy(() => import('./WorkflowsBrowse').then((module) => ({ default: module.WorkflowsBrowseDetail })))
const WorkflowEditor = lazy(() => import('./editor/WorkflowEditor'))

export { WORKFLOWS_SOURCE_ID, WORKFLOWS_SURFACE_ID, WORKFLOWS_SURFACE_PATH, workflowsSurfacePath } from './surfacePath'

// Registered as a source route as well as a surface, so the terminal's "which source owns this path"
// question has an answer and the shell keeps Workflows selected when the address is a definition
// (client-core sources.ts § sourceIdForPath).
export const workflowsRouteContributions: readonly SourceRouteContribution[] = [
  { id: 'workflows.editor', path: WORKFLOWS_SURFACE_PATH, order: 30 },
]

export const workflowsSurfaceContribution: ProjectSurfaceContribution = {
  id: WORKFLOWS_SURFACE_ID,
  path: WORKFLOWS_SURFACE_PATH,
  item: 'id',
  order: 30,
  component: WorkflowEditor,
}

export const workflowsSourceContribution: SourceContribution<never> = {
  id: WORKFLOWS_SOURCE_ID,
  // After Docker (40) and before Agents (60), which is where "things this workspace can run" belongs.
  order: 50,
  glyph: 'workflow',
  label: 'Workflows',
  projectScoped: true,
  routes: workflowsRouteContributions,
  regions: { list: WorkflowsBrowseList, detail: WorkflowsBrowseDetail },
}
