import { Show } from 'solid-js'
import type { PlacementScope } from './persist'
import type { PanelDefinition } from './model'
import DashboardEditor from './DashboardEditor'
import { dashboardClient } from './dashboardClient'
import { activeCacheId } from '../../infra/node/activeNode'
import { panelDefinition, placePanelAt, removePanel, savePanel } from './persist'
import { sizePresets } from './layout'

export type DashboardEditorSession = { dashboardId?: string }

/**
 * Owns the core dashboard editor's persistence hand-off. The grid only decides when an editor opens;
 * this host turns a publication into the stable panel definition and initial placement.
 */
export default function DashboardPanelHost(props: {
  session?: DashboardEditorSession
  scope: PlacementScope
  onClose: () => void
}) {
  return (
    <Show when={props.session}>{session => <DashboardEditor
      scope={props.scope}
      {...(session().dashboardId ? { dashboardId: session().dashboardId } : {})}
      onClose={props.onClose}
      onPublished={(id, title, destination, view, sources, fieldRoles) => {
        const existing = panelDefinition(id)
        savePanel({
          id, title, shaping: {}, view,
          publication: { dashboardId: id, sources, fieldRoles },
        })
        // A later publication updates the stable definition without disturbing any placement or
        // layout. Only the first publication chooses an initial rectangle.
        if (!existing) placePanelAt(destination, id, sizePresets(view.kind).m)
      }}
    />}</Show>
  )
}

/** Deletes core state before the local definition, so a failed Node request never strands placements. */
export async function deletePanelDefinition(
  definition: PanelDefinition,
  workspaceId: string | undefined,
): Promise<void> {
  if (definition.publication) {
    const client = dashboardClient(activeCacheId(), { workspaceId: workspaceId ?? '' })
    const draft = await client.get(definition.publication.dashboardId)
    await client.delete(draft.id, draft.draftRevision)
  }
  removePanel(definition.id)
}
