import type { PaneContribution } from '../registries/panes'
import PanelGrid from './PanelGrid'
import { type PlacementScope } from './persist'
import './dashboards.css'

// A dashboard as a pane inside a task — the SECOND placement (docs/dashboards.md § Placements), and
// nearly free by construction: the scope key, the placement-agnostic panel and the scope-taking grid
// were all built before there was a second surface to want them. What is here is the container.
//
// SCOPED BY PANE, NOT BY TASK, and the `task` prop is ignored on purpose. Definitions are
// per-user-per-node and surface-free, so the same board renders in this pane in every task. A board
// per task is a non-goal: a task is ephemeral, and composing one is labour nobody repeats. If
// per-something boards are ever wanted the answer is the scope's `projectId` segment, which is
// already in the key format, not a task segment.
//
// The narrow-window collapse the grid already has is what makes a pane-sized placement work at all:
// a pane too narrow for twelve cells is simply always collapsed, and its stored geometry comes back
// intact the moment the pane is widened.

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
