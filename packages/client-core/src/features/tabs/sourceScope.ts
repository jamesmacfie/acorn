import { createMemo } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { integrationsOptions, projectsOptions, workspaceExternalProjectsOptions } from '../../infra/queries'
import type { SourceScope } from './railSources'

/** The external-project mapping the rail gate reads, for one workspace. Shared rather than derived at
 *  each call site: the rail hides a source's row and App resets the selection when a source goes away,
 *  and those two must never disagree about which sources the active workspace has. */
/** `enabled` is for a caller created before the startup gate releases, which App is. */
export function createSourceScope(workspaceId: () => string | null | undefined, enabled: () => boolean = () => true): () => SourceScope {
  const integrations = createQuery(() => integrationsOptions(enabled()))
  const linked = createQuery(() => workspaceExternalProjectsOptions(workspaceId() ?? null, enabled()))
  // The same projects query the rail already holds, so this adds no request.
  const projects = createQuery(() => projectsOptions(enabled()))
  // A memo, so readers hear about it only when the answer changes. The workspace id is derived from
  // the task list, and a bare getter made every task edit rebuild the rail's sources and remount its
  // task rows.
  const gitProject = createMemo((): boolean | undefined => {
    const id = workspaceId()
    if (!id || !projects.data) return undefined
    return projects.data.some((project) => project.workspaceId === id && project.vcs === 'git' && project.path !== null)
  })
  return () => ({
    providers: integrations.data?.providers,
    linked: linked.data?.projects,
    gitProject: gitProject(),
  })
}
