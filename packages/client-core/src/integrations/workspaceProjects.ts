// Slicing a workspace's combined external-project set by provider, for a caller that replaces its own
// provider's mappings in bulk and must leave its siblings' alone.
//
// The host's own picker (settings/WorkspaceExternalProjects.tsx) doesn't use these: it adds or removes
// one pair at a time against the current set, so every other provider's rows, and any row belonging to
// a connection whose list failed to load, are carried through verbatim. These stay because a bulk
// provider-scoped replace is still the right shape for a plugin doing one, and they're the
// plugin-facing form exported through @acorn/plugin-api/client.
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
