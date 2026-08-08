import type { Integration, WorkspaceExternalProject } from '@acorn/protocol/api.ts'

const connectionIdsFor = (integrations: readonly Integration[], providerId: string): Set<string> =>
  new Set(integrations.filter((integration) => integration.providerId === providerId).map((integration) => integration.id))

/** Select one provider's mappings from the workspace-wide external-project set. */
export function workspaceExternalProjectsForProvider(
  projects: readonly WorkspaceExternalProject[],
  integrations: readonly Integration[],
  providerId: string,
): WorkspaceExternalProject[] {
  const connectionIds = connectionIdsFor(integrations, providerId)
  return projects.filter((project) => connectionIds.has(project.integrationId))
}

/** Replace one provider's mappings without disturbing mappings owned by sibling providers. */
export function replaceWorkspaceExternalProjectsForProvider(
  current: readonly WorkspaceExternalProject[],
  integrations: readonly Integration[],
  providerId: string,
  replacement: readonly WorkspaceExternalProject[],
): WorkspaceExternalProject[] {
  const connectionIds = connectionIdsFor(integrations, providerId)
  return [
    ...current.filter((project) => !connectionIds.has(project.integrationId)),
    ...replacement,
  ]
}
