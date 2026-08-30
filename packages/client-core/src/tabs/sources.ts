import type { Integration, WorkspaceExternalProject } from '@acorn/protocol/api.ts'
import type { ProviderCapabilityName, PublicIntegrationProvider } from '@acorn/protocol/integrations.ts'
import type { SourceId } from '../tasks/tasks'
import { hasHostCapability } from '../infra/node/hostCapabilities'
import { sourceRegistry } from '../registries/sources'

export type SourceEntry = { id: SourceId; glyph: string; label: string }

/** What the active workspace links, for the third gate below. Both halves are the shell's own queries;
 *  omit them (or leave either undefined while it loads) and the gate doesn't apply. */
export type SourceScope = {
  providers?: readonly PublicIntegrationProvider[]
  linked?: readonly WorkspaceExternalProject[]
}

export function availableSources(integrations: Integration[] | undefined, scope?: SourceScope): SourceEntry[] {
  const rows = integrations ?? []
  const has = (providerId: string, capability?: ProviderCapabilityName) => rows.some(
    (i) => i.providerId === providerId && i.status !== 'disabled' && i.status !== 'needs-auth' && (!capability || i.capabilities[capability] === 'available'),
  )
  // A provider that enumerates projects (`supportsProjects`) shows its items per linked project, so
  // its rail row is only worth drawing once the active workspace links one. Connected but unlinked
  // used to draw a row whose surface either sat empty or, worse, listed another workspace's items.
  //
  // Both queries have to have answered: mid-load, `linked` is undefined and no source is hidden, so
  // the rail doesn't flicker a row away and back on every workspace switch.
  const linkedConnectionIds = scope?.providers && scope?.linked
    ? new Set(scope.linked.map((row) => row.integrationId))
    : null
  const linked = (providerId: string) => {
    if (!linkedConnectionIds) return true
    if (!scope?.providers?.some((provider) => provider.id === providerId && provider.supportsProjects)) return true
    return rows.some((i) => i.providerId === providerId && linkedConnectionIds.has(i.id))
  }
  return sourceRegistry
    .entries()
    // Four independent gates, all AND-ed: `requires` asks the platform question, `providerId` asks "is
    // the integration behind this connected?", the mapping asks "does this workspace follow anything of
    // its?", and `when` asks anything else the contribution needs (Fleet home: more than one node
    // paired).
    .filter((source) => hasHostCapability(source.requires)
      && (!source.providerId || (has(source.providerId, source.requiresProvider) && linked(source.providerId)))
      && (source.when?.() ?? true))
    // `id` breaks a tie, so two sources declaring the same order still produce a stable rail
    // rather than one that depends on registration after all, the same tiebreak the slot hosts
    // use.
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map(({ id, glyph, label }) => ({ id, glyph, label }))
}
