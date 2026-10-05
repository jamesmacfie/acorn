import { createSignal, Show } from 'solid-js'
import { Portal } from 'solid-js/web'
import type { PlacementScope } from './persist'
import type { PanelDefinition } from './model'
import PanelLauncher, { type LaunchResult } from './studio/PanelLauncher'
import PanelStudio from './studio/PanelStudio'
import { dashboardClient } from './dashboardClient'
import { activeCacheId } from '../../infra/node/activeNode'
import { layoutAt, panelDefinition, placePanelAt, removePanel, savePanel } from './persist'
import { sizePresets } from './layout'
import type { PanelRegion } from './region'

/** A panel to edit, or none for Add panel, which asks what to build first. */
/** Which panel to edit, if any, and whether the studio opens with the AI docked and ready to type. */
export type DashboardEditorSession = { dashboardId?: string; withAi?: boolean }

type HostProps = {
  session?: DashboardEditorSession
  scope: PlacementScope
  /** The plugin region the grid draws, which the studio checks a panel against before publishing. */
  region?: PanelRegion
  /** Where the studio was opened from, named on its back button. */
  returnLabel: string
  onClose: () => void
}

/**
 * Owns the panel studio's persistence hand-off. The grid only decides when the studio opens; this
 * host turns a publication into the stable panel definition and initial placement. Add panel opens
 * the launcher first, and the studio opens with what the person chose there. The studio is a
 * full-window layer, so it renders in a portal above whatever opened it.
 */
export default function DashboardPanelHost(props: HostProps) {
  // Keyed, so each session starts at the launcher rather than at the last session's choice.
  return <Show when={props.session} keyed>{session => <PanelSession {...props} session={session} />}</Show>
}

function PanelSession(props: HostProps & { session: DashboardEditorSession }) {
  const [launched, setLaunched] = createSignal<LaunchResult | undefined>(props.session.dashboardId ? { kind: 'draft', dashboardId: props.session.dashboardId } : undefined)
  const dashboardId = () => { const launch = launched(); return launch?.kind === 'draft' ? launch.dashboardId : undefined }
  const start = () => { const launch = launched(); return launch?.kind === 'draft' ? undefined : launch }
  return (
    <Show when={launched()} fallback={<PanelLauncher workspaceId={props.scope.workspaceId ?? ''} {...(props.region ? { region: props.region } : {})}
      onLaunch={setLaunched} onDismiss={props.onClose} />}><Portal><PanelStudio
      scope={props.scope}
      {...(dashboardId() ? { dashboardId: dashboardId() } : {})}
      {...(start() ? { start: start() } : {})}
      withAi={props.session.withAi}
      {...(props.region ? { region: props.region } : {})}
      {...(dashboardId() && layoutAt(props.scope).rects[dashboardId()!] ? { placed: layoutAt(props.scope).rects[dashboardId()!] } : {})}
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
    /></Portal></Show>
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
