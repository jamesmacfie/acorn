import { Show } from 'solid-js'
import { Portal } from 'solid-js/web'
import type { PlacementScope } from './persist'
import type { PanelDefinition } from './model'
import PanelStudio from './studio/PanelStudio'
import { dashboardClient } from './dashboardClient'
import { activeCacheId } from '../../infra/node/activeNode'
import { layoutAt, panelDefinition, placePanelAt, removePanel, savePanel } from './persist'
import { sizePresets } from './layout'
import type { PanelRegion } from './region'

export type DashboardEditorSession = { dashboardId?: string }

/**
 * Owns the panel studio's persistence hand-off. The grid only decides when the studio opens; this
 * host turns a publication into the stable panel definition and initial placement. The studio is a
 * full-window layer, so it renders in a portal above whatever opened it.
 */
export default function DashboardPanelHost(props: {
  session?: DashboardEditorSession
  scope: PlacementScope
  /** The plugin region the grid draws, which the studio checks a panel against before publishing. */
  region?: PanelRegion
  /** Where the studio was opened from, named on its back button. */
  returnLabel: string
  onClose: () => void
}) {
  return (
    <Show when={props.session}>{session => <Portal><PanelStudio
      scope={props.scope}
      {...(session().dashboardId ? { dashboardId: session().dashboardId } : {})}
      {...(props.region ? { region: props.region } : {})}
      {...(session().dashboardId && layoutAt(props.scope).rects[session().dashboardId!] ? { placed: layoutAt(props.scope).rects[session().dashboardId!] } : {})}
      returnLabel={props.returnLabel}
      onClose={props.onClose}
      onDeleted={id => { if (panelDefinition(id)) removePanel(id) }}
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
    /></Portal>}</Show>
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
