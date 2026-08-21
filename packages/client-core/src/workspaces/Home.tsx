import { createMemo, For, Show } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { useNavigate } from '@solidjs/router'
import DashboardTabs from '../dashboards/DashboardTabs'
import { activeHomeTab, homeTabDomId, HOME_TAB_PANEL_ID, setActiveHomeTab } from '../dashboards/homeTab'
import { dashboards, homeTabs, HOME_PLACEMENT, homeTabScope } from '../dashboards/persist'
import PanelGrid from '../dashboards/PanelGrid'
import { projectsOptions, tasksOptions, workspacesOptions } from '../queries'
import { activateTaskSignals, pathForTask } from '../tasks/activate'
import { taskStatus } from '../tasks/taskStatus'
import { workspaceForProject } from './activeWorkspace'
import './home.css'

// The core home is provider-neutral. It is the stable landing source when no optional integration
// is connected; provider plugins contribute their own browse sources beside it.
//
// It is also the default panel placement, additive below the active-task list (docs/dashboards.md
// § Placements).
export default function Home() {
  const navigate = useNavigate()
  const tasks = createQuery(() => tasksOptions(true))
  const projects = createQuery(() => projectsOptions(true))
  const workspaces = createQuery(() => workspacesOptions(true))
  const visibleTasks = () => (tasks.data ?? []).filter((task) => {
    const project = projects.data?.find((candidate) => candidate.id === task.projectId)
    return !project?.hidden
  })

  // Dashboards (docs/dashboards.md § Placements): a tab is a placement scope, so all Home owns is
  // which one the grid is pointed at.
  //
  // The bar is built once, outside the memo, and only conditionally handed to the grid. Solid
  // props are lazy getters, so it stays reactive, but rebuilding it whenever the tab list changed
  // would discard the rename it is in the middle of, which is the write that changes the tab list.
  const tabs = createMemo(() => homeTabs(dashboards()))
  // See docs/dashboards.md § Placements for why a deleted tab falls back to the default.
  const activeTab = () => (tabs().some((tab) => tab.id === activeHomeTab()) ? activeHomeTab() : '')
  const bar = <DashboardTabs tabs={tabs()} active={activeTab()} onSelect={setActiveHomeTab} />

  return (
    <main class="panes home-source">
      <header class="fleet-home-head">
        <h1>Home</h1>
        <p class="muted">Your projects and active tasks.</p>
      </header>
      <Show when={visibleTasks().length} fallback={<p class="muted home-empty">Add a project in Settings to start a task.</p>}>
        <ul class="fleet-cards home-task-list">
          <For each={visibleTasks()}>
            {(task) => {
              const project = () => projects.data?.find((candidate) => candidate.id === task.projectId)
              const workspace = () => workspaceForProject(workspaces.data, task.projectId)
              const status = () => taskStatus(task.id)
              return (
                <li class="fleet-card home-task-card">
                  <button type="button" class="home-task-button" onClick={() => { activateTaskSignals(task); navigate(pathForTask(task)) }}>
                    <span class="home-task-title">{task.title}</span>
                    <span class="muted">{project()?.name ?? 'Project'} · {workspace()?.name ?? 'No workspace'}</span>
                    <Show when={status()?.dirty}><span class="fleet-card-badge">Changes</span></Show>
                  </button>
                </li>
              )
            }}
          </For>
        </ul>
      </Show>
      <PanelGrid
        scope={tabs().length > 1 ? homeTabScope(activeTab()) : HOME_PLACEMENT}
        heading={tabs().length > 1 ? bar : undefined}
        panelAria={tabs().length > 1 ? { id: HOME_TAB_PANEL_ID, labelledBy: homeTabDomId(activeTab()) } : undefined}
      />
    </main>
  )
}
