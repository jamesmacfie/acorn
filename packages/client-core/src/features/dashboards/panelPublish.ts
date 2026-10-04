import type { QueryClient } from '@tanstack/solid-query'
import type { DashboardDraft, DashboardScope, PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { DataSourceDescription } from '@acorn/protocol/dataSources.ts'
import { writeJson } from '../../infra/node/apiClient'
import { queriesClient } from '../queries/queriesClient'
import { dashboardClient, publishedDashboardPanelKey } from './dashboardClient'
import type { dashboardRecoveryStore } from './dashboardRecovery'
import { regionRefusal, type PanelRegion } from './region'

// Publishing a panel plan, shared by the studio and the panel menu's quick edits
// (docs/dashboards/placements.md § Placements). The caller keeps the panel definition and its placement.

export type PanelPublicationMetadata = { sources: string[]; fieldRoles: string[] }

/** The `plugin:source` keys a plan reads and the field roles they declare, by describing each source.
 *  A region checks these, so a panel is refused before it is published rather than hidden after. */
export async function describePanelSources(nodeId: string, scope: DashboardScope, plan: PanelPlan): Promise<PanelPublicationMetadata> {
  const metadata = await Promise.all(plan.sources.map(async source => {
    const resolved = await queriesClient(nodeId, scope).resolve(source.reference, {})
    const description = await writeJson<DataSourceDescription>('/v1/core/data-sources/describe', {
      method: 'POST', nodeId, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation: 'describe', source: resolved.query.source, scope: resolved.query.scope }),
    })
    return { key: `${resolved.query.source.pluginId}:${resolved.query.source.sourceId}`, roles: description.fields.flatMap(field => field.display?.role ?? []) }
  }))
  return { sources: [...new Set(metadata.map(entry => entry.key))], fieldRoles: [...new Set(metadata.flatMap(entry => entry.roles))] }
}

export class PanelRegionRefusal extends Error {}

/** Saves the plan, checks it against the region, publishes it, and refreshes every panel showing it. */
export async function publishPanelPlan(input: {
  nodeId: string
  scope: DashboardScope
  plan: PanelPlan
  region?: PanelRegion
  /** Writes the plan to the Node draft and returns the saved draft. */
  flush: (plan: PanelPlan) => Promise<DashboardDraft>
  queryClient: QueryClient
  recovery: ReturnType<typeof dashboardRecoveryStore>
}): Promise<{ id: string } & PanelPublicationMetadata> {
  const { nodeId, scope, plan } = input
  const saved = await input.flush(plan)
  const metadata = await describePanelSources(nodeId, scope, plan)
  const refusal = input.region && regionRefusal(input.region, plan.view.kind, metadata)
  if (refusal) throw new PanelRegionRefusal(refusal)
  await dashboardClient(nodeId, scope).publish(saved.id, saved.draftRevision)
  void input.queryClient.invalidateQueries({ queryKey: publishedDashboardPanelKey(nodeId, scope, saved.id).slice(0, 5) }).catch(() => {})
  void input.queryClient.invalidateQueries({ queryKey: ['dashboard-revision', nodeId, scope.workspaceId, saved.id] }).catch(() => {})
  input.recovery.discard(nodeId, saved.id)
  return { id: saved.id, ...metadata }
}
