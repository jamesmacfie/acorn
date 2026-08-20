import { Show, type JSX } from 'solid-js'
import PanelGrid from '../../dashboards/PanelGrid'
import { regionScope, type PanelRegion } from '../../dashboards/region'
import ExtensionPointHost from '../chrome/ExtensionPointHost'
import '../chrome/extension-points.css'

// A pane whose owner reserved part of its rectangle for somebody else: the owner's frame, and the HOST's
// own markup around it (@acorn/protocol/extensionPoints.ts).
//
// This component is the boundary made visible. Inside the frame is a sandboxed document served from the
// owner's bundle hash; outside it is the shell, drawing either a different package's node route or the
// user's own composed panels. Neither can see the other — neither region is inside the iframe, and the
// iframe is not told they exist. That is the difference between cooperative extension and a content
// script.
//
// TWO LOCATIONS, TWO CONTRIBUTORS, one rule:
//
//   `pane.footer`  a strip UNDER the frame, filled by other plugins' `extensions` — descriptor rows the
//                  host fetches from the contributor's own namespace and draws with its own components.
//   `pane.aside`   a column BESIDE the frame, filled by THE USER: a dashboard they composed, under
//                  constraints the owner declared (docs/dashboards.md § Placements).
//
// THE HOST DRAWS BOTH REGIONS; the owner's layout only RESERVES them. Every future plugin author will
// read "a rectangle for dashboard items" as "inside my iframe", and it cannot mean that — panels are
// host Solid components and a sandboxed frame is a separate realm. No bridge API may pretend otherwise.
//
// The owner ships nothing to get either. `layout` templates exist for panes the host draws PART OF from
// the plugin's own data; these are not those, because the owner's rectangle is unchanged apart from
// losing some height or width. So they need no template entry: one `extensionPoints` line is the whole
// opt-in.
export default function ExtendedPane(props: {
  /** The qualified point id of a `pane.footer`, when this pane reserved one. */
  footerPointId?: string
  /** The reserved `pane.aside` — its qualified point id, which is also the placement's owner id, and
   *  the owner's declared constraints. */
  aside?: { pointId: string; region: PanelRegion }
  children: JSX.Element
}) {
  return (
    <div class="extended-pane" {...(props.aside ? { 'data-aside': '' } : {})}>
      <div class="extended-pane-main">
        <div class="extended-pane-frame">{props.children}</div>
        <Show when={props.footerPointId}>{(pointId) => <ExtensionPointHost pointId={pointId()} />}</Show>
      </div>
      {/* Scoped by the POINT, not by the task: definitions are per-user-per-node and surface-free, so the
          same board renders in this pane in every task. The grid's narrow-window collapse is what makes a
          column this size work at all — too narrow for twelve cells is simply always collapsed, and the
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
