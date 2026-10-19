import { Show } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { Button, EmptyState, Inline, Menu, Stack, Text } from '@acorn/plugin-api/ui'
import {
  activeNodeId,
  allProjects,
  setSelectedSource,
  toast,
  type DashboardCellDefinition,
  type DashboardCellMenuProps,
  type DashboardCellProps,
} from '@acorn/plugin-api/client'
import { APPS_SOURCE_ID, appCellSchema, projectAppsPath, type AppCell, type AppListing } from '../shared/api'
import { Revision } from './AppToolCard'
import { projectWorkspaceId } from './addToDashboard'
import { appById, appsLoaded, refreshApps } from './appsStore'
import { setDeleted, useAppEditing } from './ProjectApps'

// A project app on a Home tab (docs/agent-built-apps/project-apps.md § On a dashboard). The grid draws
// the frame, the title, and Remove. This draws the app's head with `$placement` set to `dashboard`,
// sharing the project app's state with its pane, or says the app is gone.

const projectName = (projectId: string) =>
  allProjects().find((project) => project.id === projectId)?.name ?? 'its project'

/** The app a cell names. A definition is preference data any client wrote, so it's checked. */
const cellOf = (definition: DashboardCellDefinition): AppCell | undefined =>
  appCellSchema.safeParse(definition.app).data

/** The live project app a cell names, if there is one. */
const liveApp = (cell: AppCell): (AppListing & { projectId: string }) | undefined => {
  const app = appById(cell.appId)
  return app?.projectId === cell.projectId && !app.deletedAt ? { ...app, projectId: cell.projectId } : undefined
}

export function AppDashboardCell(props: DashboardCellProps) {
  const restore = (appId: string) =>
    setDeleted(activeNodeId() ?? '', appId, false).then(refreshApps, () =>
      toast("Couldn't restore this app. Try again.", { tone: 'danger' }),
    )
  return (
    <Show
      when={cellOf(props.definition)}
      keyed
      fallback={
        <EmptyState align="start" size="sm">
          This app cell doesn't name an app.
        </EmptyState>
      }
    >
      {(cell) => (
        <Show when={appsLoaded()} fallback={<Text tone="muted">Loading…</Text>}>
          <Show
            when={liveApp(cell)}
            fallback={
              <EmptyState
                align="start"
                size="sm"
                title={`${props.definition.title} isn't available`}
                action={
                  <Inline gap="inline">
                    {/* Here, because the Apps source hides once its project has no live app. */}
                    <Show when={appById(cell.appId)}>
                      <Button size="sm" onPress={() => void restore(cell.appId)}>
                        Restore
                      </Button>
                    </Show>
                    <Button size="sm" variant="ghost" onPress={props.remove}>
                      Remove from this dashboard
                    </Button>
                  </Inline>
                }
              >
                {appById(cell.appId)
                  ? `It was deleted from ${projectName(cell.projectId)}.`
                  : `It was removed from ${projectName(cell.projectId)} for good.`}
              </EmptyState>
            }
          >
            {(app) => (
              <Stack gap="row">
                <Text tone="muted">{`${projectName(cell.projectId)} · v${app().head}`}</Text>
                <Show when={app().head} keyed>
                  {(head) => (
                    <Revision
                      appId={cell.appId}
                      revision={head}
                      workspaceId={projectWorkspaceId(cell.projectId)}
                      nodeId={activeNodeId() ?? ''}
                      readOnly={false}
                      placement="dashboard"
                      refreshes={props.refreshes}
                    />
                  )}
                </Show>
              </Stack>
            )}
          </Show>
        </Show>
      )}
    </Show>
  )
}

/** The cell's own menu items: Open app, and Edit in a new task, while the app is live. */
export function AppDashboardCellMenu(props: DashboardCellMenuProps) {
  const navigate = useNavigate()
  const editing = useAppEditing()
  const app = () => {
    const cell = cellOf(props.definition)
    return cell && liveApp(cell)
  }
  return (
    <Show when={app()}>
      {(live) => (
        <>
          <Menu.Item
            context={props.menu}
            onSelect={() => {
              // The shell draws the selected source, so the address alone would leave Home on screen.
              setSelectedSource(APPS_SOURCE_ID)
              navigate(projectAppsPath(live().projectId, live().appId))
            }}
          >
            Open app
          </Menu.Item>
          <Menu.Item
            context={props.menu}
            onSelect={() =>
              void editing
                .editInNewTask(live())
                .catch(() => toast("Couldn't make a task to edit this app.", { tone: 'danger' }))
            }
          >
            Edit in a new task
          </Menu.Item>
        </>
      )}
    </Show>
  )
}
