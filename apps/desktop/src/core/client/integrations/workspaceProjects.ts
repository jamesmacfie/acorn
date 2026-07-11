import type { Integration, WorkspaceProject } from '../../shared/api'

const connectionIdsFor = (integrations: readonly Integration[], providerId: string): Set<string> =>
  new Set(integrations.filter((integration) => integration.providerId === providerId).map((integration) => integration.id))

/** Select one provider's mappings from the workspace-wide external-project set. */
export function workspaceProjectsForProvider(
  projects: readonly WorkspaceProject[],
  integrations: readonly Integration[],
  providerId: string,
): WorkspaceProject[] {
  const connectionIds = connectionIdsFor(integrations, providerId)
  return projects.filter((project) => connectionIds.has(project.integrationId))
}

/** Replace one provider's mappings without disturbing mappings owned by sibling providers. */
export function replaceWorkspaceProjectsForProvider(
  current: readonly WorkspaceProject[],
  integrations: readonly Integration[],
  providerId: string,
  replacement: readonly WorkspaceProject[],
): WorkspaceProject[] {
  const connectionIds = connectionIdsFor(integrations, providerId)
  return [
    ...current.filter((project) => !connectionIds.has(project.integrationId)),
    ...replacement,
  ]
}
