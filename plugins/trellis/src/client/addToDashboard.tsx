import { For, Show } from 'solid-js'
import { Button, Menu } from '@acorn/plugin-api/ui'
import { homeTabsToAddTo, placeOnHomeTab, type DashboardTab } from '@acorn/plugin-api/ui/dashboards'
import { allProjects, toast, type DashboardCellDefinition } from '@acorn/plugin-api/client'
import { APP_CELL_KIND, type AppCell, type AppListing } from '../shared/api'

// Add to dashboard for a project app (docs/agent-built-apps/project-apps.md § On a dashboard). Home
// belongs to a workspace and an app to a project, so the app goes only on Home tabs of the workspace
// that holds its project. The cell has no publication: it names the app and always runs its head. A
// host that offers no tabs, the terminal, gets no Add to dashboard.

export const projectWorkspaceId = (projectId: string): string =>
  allProjects().find((project) => project.id === projectId)?.workspaceId ?? ''

/** Puts a project app on a Home tab of its project's workspace. One definition per app, so placing it
 *  on a second tab shows the same app, with the same state, in both. */
export function addAppToDashboard(app: AppListing & { projectId: string }, tab: DashboardTab): void {
  const cell: AppCell = { projectId: app.projectId, appId: app.appId }
  const definition: DashboardCellDefinition = {
    id: `cell-${app.appId}`,
    title: app.name,
    shaping: {},
    view: { kind: APP_CELL_KIND },
    app: cell,
  }
  placeOnHomeTab(definition, projectWorkspaceId(app.projectId), tab)
  toast(`Added ${app.name} to ${tab.name}.`)
}

/** The Home tabs of a project's workspace as items in a menu. */
export function HomeTabMenuItems(props: {
  menu: Parameters<typeof Menu.Item>[0]['context']
  projectId: string
  onSelect: (tab: DashboardTab) => void
}) {
  return (
    <For each={homeTabsToAddTo(projectWorkspaceId(props.projectId))}>
      {(tab) => (
        <Menu.Item context={props.menu} onSelect={() => props.onSelect(tab)}>
          {tab.name}
        </Menu.Item>
      )}
    </For>
  )
}

/** Whether this host has a Home tab to add a project's app to. */
export const canAddToDashboard = (projectId: string): boolean =>
  homeTabsToAddTo(projectWorkspaceId(projectId)).length > 0

/** A button whose menu lists the Home tabs of a project's workspace. */
export function AddToDashboardMenu(props: {
  label: string
  projectId: string
  busy?: boolean
  onSelect: (tab: DashboardTab) => void
}) {
  return (
    <Show when={canAddToDashboard(props.projectId)}>
      <Menu
        ariaLabel={props.label}
        placement="bottom-end"
        trigger={({ open, toggle }) => (
          <Button size="sm" variant="ghost" busy={props.busy} opens="menu" expanded={open()} onPress={toggle}>
            {props.label}
          </Button>
        )}
      >
        {(menu) => <HomeTabMenuItems menu={menu} projectId={props.projectId} onSelect={props.onSelect} />}
      </Menu>
    </Show>
  )
}
