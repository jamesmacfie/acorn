import { createQuery } from '@tanstack/solid-query'
import { integrationsOptions, workspaceExternalProjectsOptions } from '../../infra/queries'
import type { SourceScope } from './railSources'

/** The external-project mapping the rail gate reads, for one workspace. Shared rather than derived at
 *  each call site: the rail hides a source's row and App resets the selection when a source goes away,
 *  and those two must never disagree about which sources the active workspace has. */
/** `enabled` is for a caller created before the startup gate releases, which App is. */
export function createSourceScope(workspaceId: () => string | null | undefined, enabled: () => boolean = () => true): () => SourceScope {
  const integrations = createQuery(() => integrationsOptions(enabled()))
  const linked = createQuery(() => workspaceExternalProjectsOptions(workspaceId() ?? null, enabled()))
  return () => ({
    providers: integrations.data?.providers,
    linked: linked.data?.projects,
  })
}
