import { Show, type JSX } from 'solid-js'
import PanelGrid from '../../features/dashboards/PanelGrid'
import { regionScope, type PanelRegion } from '../../features/dashboards/region'
import ExtensionPointHost from './ExtensionPointHost'
import { InlineSlot } from '../frames/InlineSlot'
import './extension-points.css'

// A pane whose owner reserved part of its rectangle for somebody else, drawn as `pane.footer` and
// `pane.aside` extension points (docs/plugins.md § Cooperative extension points). The host draws both
// regions; the owner's layout only reserves them, and needs no `layout` template entry for it.
export default function ExtendedPane(props: {
  /** The qualified point id of a `pane.footer`, when this pane reserved one. */
  footerPointId?: string
  /** The reserved `pane.aside`: its qualified point id, which is also the placement's owner id, and
   *  the owner's declared constraints. */
  aside?: { pointId: string; region: PanelRegion }
  /** The reserved `pane.inline-below` and `pane.inline-beside` rectangles, each holding another
   *  plugin's iframe (./InlineSlot.tsx). Two names rather than one plus an orientation, because the
   *  position is a property of the location the owner declared. */
  inlineBelowPointId?: string
  inlineBesidePointId?: string
  taskId?: string
  projectId?: string | null
  children: JSX.Element
}) {
  const scope = () => ({
    ...(props.taskId ? { taskId: props.taskId } : {}),
    ...(props.projectId ? { projectId: props.projectId } : {}),
  })
  return (
    <div class="extended-pane" {...(props.aside ? { 'data-aside': '' } : {})}>
      <div class="extended-pane-main">
        {/* The owner's own rectangle and the one it reserved beside it, as siblings the host sits
            between. Neither can reach into the other. */}
        <div class="extended-pane-frame">
          {props.children}
          <Show when={props.inlineBesidePointId}>
            {(pointId) => <InlineSlot point={pointId()} {...scope()} />}
          </Show>
        </div>
        <Show when={props.inlineBelowPointId}>
          {(pointId) => <InlineSlot point={pointId()} {...scope()} />}
        </Show>
        <Show when={props.footerPointId}>{(pointId) => <ExtensionPointHost pointId={pointId()} />}</Show>
      </div>
      {/* Scoped by the point, not by the task: definitions are per-user-per-node and surface-free, so the
          same board renders in this pane in every task. The grid's narrow-window collapse is what makes a
          column this size work at all: too narrow for twelve cells is simply always collapsed, and the
          stored geometry returns intact when the pane is widened. */}
      <Show when={props.aside}>
        {(aside) => (
          <aside class="extended-pane-aside">
            <PanelGrid scope={regionScope(aside().pointId)} region={aside().region} />
          </aside>
        )}
      </Show>
    </div>
  )
}
