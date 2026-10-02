import { createEffect, createMemo, createSignal, Show } from 'solid-js'
import { Heading } from '../../kit/components/content/Heading'
import Icon from '../../kit/components/content/Icon'
import { Inline } from '../../kit/components/layout/Inline'
import { Button, EmptyState } from '../../kit/components/primitives'
import DashboardPanelHost from '../dashboards/DashboardPanelHost'
import DashboardTabs from '../dashboards/DashboardTabs'
import { activeHomeTab, homeTabDomId, HOME_TAB_PANEL_ID, setActiveHomeTab } from '../dashboards/homeTab'
import { adoptLegacyHomeDashboards, dashboards, homeTabs, homeTabScope, panelsAt } from '../dashboards/persist'
import PanelGrid from '../dashboards/PanelGrid'
import { createActiveWorkspaceId } from './activeWorkspaceId'
import './home.css'

// The core home is provider-neutral. It is the stable landing source when no optional integration
// is connected; provider plugins contribute their own browse sources beside it.
//
// It is a dashboard and nothing else. It used to open with the workspace's active tasks above the
// panels, on every visit, for everyone: a list on the screen whether or not it was being read, and
// the one thing a person could not take off their own home page. Tasks are now a shared Node-owned
// source, so anyone who wants them publishes and places a dashboard, and the default is a surface
// with nothing on it but what its owner put there.
export default function Home() {
  // Dashboards (docs/dashboards.md § Placements): a tab is a placement scope, so all Home owns is
  // which one the grid is pointed at — and which workspace's set of them it is choosing from, since
  // a board is per workspace.
  //
  // The bar is built once, outside the memo, and only conditionally handed to the grid. Solid
  // props are lazy getters, so it stays reactive, but rebuilding it whenever the tab list changed
  // would discard the rename it is in the middle of, which is the write that changes the tab list.
  const workspaceId = createActiveWorkspaceId()
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

  // Home owns its Add panel, in the title row once there are panels and in the empty state before,
  // so the page never shows two. The grid still opens the editor for Edit.
  const scope = () => homeTabScope(activeTab(), workspaceId())
  const tabName = () => tabs().find((tab) => tab.id === activeTab())?.name ?? 'Home'
  const [adding, setAdding] = createSignal(false)
  const addButton = (size: 'sm' | 'md') => (
    <Button size={size} onPress={() => setAdding(true)}>
      <Icon name="plus" /> Add panel
    </Button>
  )

  return (
    <main class="panes home-source">
      <Inline spread>
        <Heading level={1}>Home</Heading>
        <Show when={panelsAt(scope()).length}>{addButton('sm')}</Show>
      </Inline>
      <PanelGrid
        scope={scope()}
        heading={tabs().length > 1 ? bar : undefined}
        panelAria={tabs().length > 1 ? { id: HOME_TAB_PANEL_ID, labelledBy: homeTabDomId(activeTab()) } : undefined}
        empty={() => (
          <EmptyState title={`Nothing on ${tabName()} yet`} action={addButton('md')}>
            Add a panel to see tasks, pull requests, issues, or anything else in view.
          </EmptyState>
        )}
      />
      <DashboardPanelHost session={adding() ? {} : undefined} scope={scope()} onClose={() => setAdding(false)} />
    </main>
  )
}
