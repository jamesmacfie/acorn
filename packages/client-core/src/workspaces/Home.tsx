import { createEffect, createMemo } from 'solid-js'
import DashboardTabs from '../dashboards/DashboardTabs'
import { activeHomeTab, homeTabDomId, HOME_TAB_PANEL_ID, setActiveHomeTab } from '../dashboards/homeTab'
import { adoptLegacyHomeDashboards, dashboards, homeTabs, homeTabScope } from '../dashboards/persist'
import PanelGrid from '../dashboards/PanelGrid'
import { useActiveWorkspaceId } from './useActiveWorkspaceId'
import './home.css'

// The core home is provider-neutral. It is the stable landing source when no optional integration
// is connected; provider plugins contribute their own browse sources beside it.
//
// It is a dashboard and nothing else. It used to open with the workspace's active tasks above the
// panels, on every visit, for everyone: a list on the screen whether or not it was being read, and
// the one thing a person could not take off their own home page. The same rows are a collection now
// (tasks/tasksCollection.ts), so anyone who wants them places them, sorts them and sizes them, and
// the default is a surface with nothing on it but what its owner put there.
export default function Home() {
  // Dashboards (docs/dashboards.md § Placements): a tab is a placement scope, so all Home owns is
  // which one the grid is pointed at — and which workspace's set of them it is choosing from, since
  // a board is per workspace.
  //
  // The bar is built once, outside the memo, and only conditionally handed to the grid. Solid
  // props are lazy getters, so it stays reactive, but rebuilding it whenever the tab list changed
  // would discard the rename it is in the middle of, which is the write that changes the tab list.
  const workspaceId = useActiveWorkspaceId()
  const tabs = createMemo(() => homeTabs(dashboards(), workspaceId()))
  // See docs/dashboards.md § Placements for why a deleted tab falls back to the default. A tab the
  // other workspace owned is the same case, so switching workspaces lands on its default board.
  const activeTab = () => (tabs().some((tab) => tab.id === activeHomeTab()) ? activeHomeTab() : '')
  const bar = <DashboardTabs tabs={tabs()} workspaceId={workspaceId()} active={activeTab()} onSelect={setActiveHomeTab} />

  // The one-shot adoption of a board written before Home was per-workspace. Idempotent and a no-op
  // once there is nothing left to adopt, which is why it can live in a render effect rather than in
  // boot: it needs a workspace, and Home is where one is first both known and about to be drawn.
  createEffect(() => {
    const ws = workspaceId()
    if (ws) adoptLegacyHomeDashboards(ws)
  })

  return (
    <main class="panes home-source">
      <header class="fleet-home-head">
        <h1>Home</h1>
      </header>
      <PanelGrid
        scope={homeTabScope(activeTab(), workspaceId())}
        heading={tabs().length > 1 ? bar : undefined}
        panelAria={tabs().length > 1 ? { id: HOME_TAB_PANEL_ID, labelledBy: homeTabDomId(activeTab()) } : undefined}
      />
    </main>
  )
}
