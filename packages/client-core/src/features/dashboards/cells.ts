import type { Accessor, Component } from 'solid-js'
import { Registry } from '../../kit/lib/state/registry'
import type { MenuContext } from '../../kit/components/overlays/Menu'
import { sizePresets } from './layout'
import type { PanelDefinition } from './model'
import { dashboards, homeTabs, homeTabScope, panelsAt, placePanelAt, savePanel, type DashboardTab } from './persist'

export type { DashboardTab }

// Dashboard cells a plugin draws (docs/dashboards/placements.md § Cells a plugin draws). A definition
// with no publication names its kind in `view.kind`, and the grid looks the kind up here. The grid
// keeps the frame, the header, the layout gestures, and Remove, so a cell draws only its body and adds
// only its own menu items. With nothing registered for its kind, the cell draws inert.

/** A stored definition with the fields its cell wrote, read as untrusted preference data. */
export type DashboardCellDefinition = PanelDefinition & Readonly<Record<string, unknown>>

export type DashboardCellProps = {
  definition: DashboardCellDefinition
  workspaceId?: string
  /** Counts the dashboard's refreshes: the window regaining focus, and a reported plugin or account
   *  change. A cell that runs its own reads runs them again on each. */
  refreshes: Accessor<number>
  /** Takes the cell off this dashboard, as the menu's Remove does. */
  remove: () => void
}

export type DashboardCellMenuProps = { definition: DashboardCellDefinition; menu: MenuContext }

type DashboardCellContribution = {
  /** The view kind this cell draws, such as `app`. */
  id: string
  component: Component<DashboardCellProps>
  /** Menu items above the grid's own layout items and Remove. */
  menuItems?: Component<DashboardCellMenuProps>
}

export const dashboardCellRegistry = new Registry<DashboardCellContribution>('dashboard-cell')

// Add to dashboard, for anything that puts a definition on Home: an agent's panel card, and a plugin's
// own cell such as an app. Home tabs only, of one workspace (docs/dashboards/placements.md § Home tabs).
// The tabs are a list, not menu items, so each caller draws them in its own menu.

/** A workspace's Home tabs to add to. A workspace with one dashboard names it Home. */
export const homeTabsToAddTo = (workspaceId: string): DashboardTab[] => {
  const named = homeTabs(dashboards(), workspaceId)
  return named.length ? named : [{ id: '', name: 'Home' }]
}

/** Saves a definition and places it on a Home tab at its kind's arrival size. Placing it again on a
 *  tab that has it leaves it where it is. */
export function placeOnHomeTab(definition: PanelDefinition, workspaceId: string, tab: DashboardTab): void {
  savePanel(definition)
  const scope = homeTabScope(tab.id, workspaceId)
  if (!panelsAt(scope).some((placed) => placed.id === definition.id))
    placePanelAt(scope, definition.id, sizePresets(definition.view.kind).m)
}
