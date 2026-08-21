import type { PaneContribution } from '../registries/panes'
import PanelGrid from './PanelGrid'
import { type PlacementScope } from './persist'
import './dashboards.css'

// A dashboard as a pane inside a task (docs/dashboards.md § Placements): the second placement,
// nearly free by construction since the scope key, the placement-agnostic panel and the
// scope-taking grid were all built before there was a second surface to want them. What is here is
// the container.
//
// The grid's narrow-window collapse (docs/dashboards.md § The grid) is what makes a pane-sized
// placement work at all: a pane too narrow for twelve cells is simply always collapsed, and its
// stored geometry comes back intact the moment the pane is widened.

const PANE_ID = 'dashboard'

const DASHBOARD_PANE_PLACEMENT: PlacementScope = { surface: 'pane', ownerId: PANE_ID }

function DashboardPane() {
  return (
    <div class="dash-pane">
      <PanelGrid scope={DASHBOARD_PANE_PLACEMENT} />
    </div>
  )
}

export const dashboardPaneContribution: PaneContribution = {
  id: PANE_ID,
  label: 'Dashboard',
  glyph: 'layout-dashboard',
  description: 'Your composed panels, beside the task',
  order: 90,
  component: DashboardPane,
}
