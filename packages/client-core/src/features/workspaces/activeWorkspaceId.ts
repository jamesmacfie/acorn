import { useParams } from '@solidjs/router'
import { createQuery } from '@tanstack/solid-query'
import { tasksOptions, workspacesOptions } from '../../infra/queries'
import { activeTaskId } from '../tasks/tasks'
import { workspaceForProject } from './activeWorkspace'

// Its own file, not a second export on `activeWorkspace.ts`: importing `@solidjs/router` throws
// outside a browser, and that module is on the import graph of tests that run in node. A hook that
// only components reach for keeps the pure function reachable from everywhere else.

/** The workspace the shell is showing, for anything that has no query of its own: the routed
 *  project's, or the active task's when the URL carries no project (`/t/:taskId`). The rail derives
 *  the same pair for its roster, and App.tsx for the topbar. It is a hook, so call it during setup.
 *
 *  `undefined` before the workspace mapping has loaded, and when no project is routed and no task
 *  is active. A Home board composed then is the unscoped board, which the next workspace to open
 *  Home adopts (dashboards/persist.ts § adoptUnscopedHome). */
export function createActiveWorkspaceId(): () => string | undefined {
  const params = useParams()
  const tasks = createQuery(() => tasksOptions(true))
  const workspaces = createQuery(() => workspacesOptions(true))
  return () => {
    const projectId = params.projectId ?? tasks.data?.find((task) => task.id === activeTaskId())?.projectId
    return workspaceForProject(workspaces.data, projectId)?.id
  }
}
