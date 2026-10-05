import type { QueryClient } from '@tanstack/solid-query'
import type { DashboardDraft, DashboardRevision, DashboardScope, PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { DataSourceDescription } from '@acorn/protocol/dataSources.ts'
import { ApiError, writeJson } from '../../infra/node/apiClient'
import { queriesClient } from '../queries/queriesClient'
import { dashboardClient, publishedDashboardPanelKey } from './dashboardClient'
import type { dashboardRecoveryStore } from './dashboardRecovery'
import { regionRefusal, type PanelRegion } from './region'

// Publishing a panel plan, shared by the studio, the panel menu's quick edits and Duplicate, and the
// drill-down's Add as panel (docs/dashboards/placements.md § The panel menu). The caller keeps the panel
// definition and its placement.

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

/** What to say when publishing fails: the region's or the Node's reason when there is one. */
export const publishFailureMessage = (error: unknown, fallback: string): string =>
  error instanceof PanelRegionRefusal || (error instanceof ApiError && error.code === 'invalid-dashboard') ? error.message : fallback

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

type PublishContext = Omit<Parameters<typeof publishPanelPlan>[0], 'plan' | 'flush'>
export type PublishedPanel = { plan: PanelPlan } & Awaited<ReturnType<typeof publishPanelPlan>>

/** True when the draft holds edits the published revision doesn't, or was never published. */
export function hasUnpublishedEdits(draft: Pick<DashboardDraft, 'content' | 'publishedRevision'>, published: Pick<DashboardRevision, 'content'> | undefined): boolean {
  return draft.publishedRevision == null || !published || JSON.stringify(draft.content) !== JSON.stringify(published.content)
}

export class PanelHasUnpublishedEdits extends Error {
  constructor() { super('This panel has unpublished edits. Open it to finish or discard them.') }
}

/** Makes one change to a published panel and publishes it. Refuses when the studio left edits behind,
 *  on the Node or in the device copy it keeps until the Node has them, because publishing would ship
 *  them unseen or, for the device copy, throw them away. */
export async function publishQuickEdit(input: PublishContext & { dashboardId: string; edit: (plan: PanelPlan) => PanelPlan }): Promise<PublishedPanel> {
  const client = dashboardClient(input.nodeId, input.scope)
  const [draft, published] = await Promise.all([client.get(input.dashboardId), client.published(input.dashboardId)])
  const local = input.recovery.read(input.nodeId, input.dashboardId)
  if (hasUnpublishedEdits(draft, published) || (local && JSON.stringify(local.content) !== JSON.stringify(published.content))) throw new PanelHasUnpublishedEdits()
  const plan = input.edit(published.content)
  return { plan, ...await publishPanelPlan({ ...input, plan, flush: next => client.save(draft.id, draft.draftRevision, next) }) }
}

/** Publishes a plan as a new panel, such as a copy of another or a drill-down's rows. */
export async function publishNewPanel(input: PublishContext & { plan: PanelPlan }): Promise<PublishedPanel> {
  const client = dashboardClient(input.nodeId, input.scope)
  return { plan: input.plan, ...await publishPanelPlan({ ...input, flush: client.create }) }
}
