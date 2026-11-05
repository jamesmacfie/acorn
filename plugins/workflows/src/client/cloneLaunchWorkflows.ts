import { createResource } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import {
  prefsOptions,
  projectsOptions,
  readJson,
  workspacesOptions,
  WORKSPACES_PREF_KEY,
} from '@acorn/plugin-api/client'
import { workspacesMode } from '@acorn/protocol/workspacesMode.ts'
import type { WorkflowDefSummary } from '../contract/wire.ts'

// The workflows a clone may start, as the Node lists them (docs/workflows/starting-runs.md § After a
// clone). The clone form's picker and Settings → Workflows both read it.

export const cloneLaunchesRoute = '/v1/p/workflows/clone-launches'
export const cloneLaunchRoute = (launchId: string) => `${cloneLaunchesRoute}/${encodeURIComponent(launchId)}`
const cloneLaunchWorkflowsRoute = (workspaceId: string | undefined) =>
  `${cloneLaunchesRoute}/workflows${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ''}`

/** `target` is the workspace a clone lands in: the one named, or else Default on a Node that groups
 *  projects. A Node with workspaces off gives each new project its own, which no saved workflow is in,
 *  so the list is files only. */
export function createCloneLaunchWorkflows(nodeId: string | null, named: () => string | undefined = () => undefined) {
  const prefs = createQuery(() => prefsOptions(true))
  const projects = createQuery(() => projectsOptions(true))
  const workspaces = createQuery(() => workspacesOptions(true))
  const target = () => {
    if (named()) return named()
    if (!prefs.data || !projects.data) return undefined
    if (workspacesMode(prefs.data[WORKSPACES_PREF_KEY], projects.data.length) === 'off') return undefined
    return workspaces.data?.find((workspace) => workspace.isDefault)?.id
  }
  const [listed] = createResource(
    () => ({ workspaceId: target() }),
    ({ workspaceId }) =>
      readJson<{ workflows: WorkflowDefSummary[] }>(cloneLaunchWorkflowsRoute(workspaceId), { nodeId }),
  )
  return { target, workflows: () => listed()?.workflows ?? [], loading: () => listed.loading }
}
