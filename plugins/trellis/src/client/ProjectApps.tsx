import { createSignal, For, Show } from 'solid-js'
import { useNavigate, useParams } from '@solidjs/router'
import { useQueryClient } from '@tanstack/solid-query'
import {
  Alert,
  Button,
  ConfirmButton,
  EmptyState,
  Fold,
  Heading,
  Inline,
  Menu,
  Row,
  RowActions,
  Rows,
  Section,
  SectionHeader,
  Stack,
  Text,
  Toolbar,
} from '@acorn/plugin-api/ui'
import {
  activateTaskSignals,
  activeNodeId,
  activeTaskId,
  allProjects,
  clientCapability,
  createTask,
  formatRelativeTime,
  openPane,
  pathForTask,
  taskById,
  tasksOptions,
  writeJson,
  type Task,
} from '@acorn/plugin-api/client'
import { AGENTS_CONVERSATION } from '@acorn/plugin-agents/contract/conversation.ts'
import {
  APPS_PANE_ID,
  appDeletedRoute,
  appDraftsRoute,
  appRoute,
  projectAppsPath,
  type AppListing,
} from '../shared/api'
import {
  addAppToDashboard,
  AddToDashboardMenu,
  canAddToDashboard,
  HomeTabMenuItems,
  projectWorkspaceId,
} from './addToDashboard'
import { appById, projectApps, refreshApps } from './appsStore'
import { Revision } from './AppToolCard'
import { startEditingSession } from './editingSession'

// The Apps source's two regions (./index.ts registers it): the routed project's apps, and the selected one
// at full size with `$placement` set to `project`. Editing needs a session, and sessions belong to
// tasks, so Edit makes a draft in a task.

const projectName = (projectId: string) => allProjects().find((project) => project.id === projectId)?.name

export function ProjectAppList() {
  const params = useParams()
  return (
    <Show when={params.projectId} keyed fallback={<EmptyState>Select a project to see its apps.</EmptyState>}>
      {(projectId) => <AppsOfProject projectId={projectId} selected={params.appId} />}
    </Show>
  )
}

function AppsOfProject(props: { projectId: string; selected?: string }) {
  const navigate = useNavigate()
  const live = () => projectApps(props.projectId)
  const deleted = () => projectApps(props.projectId, true)
  return (
    <>
      <SectionHeader count={live().length}>Apps</SectionHeader>
      <Show
        when={live().length}
        fallback={
          <EmptyState size="sm">
            {`${projectName(props.projectId) ?? 'This project'} has no apps. Publish one from a task's Apps pane.`}
          </EmptyState>
        }
      >
        <Rows
          id={`trellis.project.${props.projectId}`}
          ariaLabel="Apps"
          items={live().map((app) => ({ key: app.appId, label: app.name, app }))}
        >
          {(entry, item) => (
            <Row
              item={item}
              variant="stacked"
              selected={props.selected === entry.app.appId}
              onPress={() => navigate(projectAppsPath(props.projectId, entry.app.appId))}
              meta={<Text emphasis="muted">{`v${entry.app.head}`}</Text>}
              trailing={
                <Show when={canAddToDashboard(props.projectId)}>
                  <RowActions ariaLabel={`Actions for ${entry.app.name}`}>
                    {(menu) => (
                      <>
                        <Menu.Label>Add to dashboard</Menu.Label>
                        <HomeTabMenuItems
                          menu={menu}
                          projectId={props.projectId}
                          onSelect={(tab) => addAppToDashboard({ ...entry.app, projectId: props.projectId }, tab)}
                        />
                      </>
                    )}
                  </RowActions>
                </Show>
              }
            >
              <Text emphasis="strong">{entry.app.name}</Text>
              <Show when={entry.app.description}>
                <Text emphasis="muted" wrap>
                  {entry.app.description}
                </Text>
              </Show>
              <Text emphasis="muted">{`Changed ${formatRelativeTime(entry.app.updatedAt)}`}</Text>
            </Row>
          )}
        </Rows>
      </Show>
      <Show when={deleted().length}>
        <Fold label="Archived apps" count={deleted().length}>
          <Stack gap="row">
            <For each={deleted()}>{(app) => <ArchivedApp app={app} />}</For>
          </Stack>
        </Fold>
      </Show>
    </>
  )
}

/** A deleted project app: Restore brings it back at its head, and Remove for good deletes its files. */
function ArchivedApp(props: { app: AppListing }) {
  const nodeId = activeNodeId() ?? ''
  const [failed, setFailed] = createSignal(false)
  const act = async (request: Promise<unknown>) => {
    setFailed(false)
    await request.catch(() => setFailed(true))
    await refreshApps().catch(() => undefined)
  }
  return (
    <Stack gap="row">
      <Inline spread wrap>
        <Text>{`${props.app.name} · v${props.app.head}`}</Text>
        <Inline gap="inline">
          <Button size="sm" variant="ghost" onPress={() => void act(setDeleted(nodeId, props.app.appId, false))}>
            Restore
          </Button>
          <ConfirmButton
            size="sm"
            variant="ghost"
            tone="danger"
            confirmLabel={`Remove ${props.app.name} for good?`}
            onConfirm={() => void act(writeJson(appRoute(props.app.appId), { method: 'DELETE', nodeId }))}
          >
            Remove for good
          </ConfirmButton>
        </Inline>
      </Inline>
      <Show when={failed()}>
        <Text tone="danger">That didn't work. Try again.</Text>
      </Show>
    </Stack>
  )
}

export const setDeleted = (nodeId: string, appId: string, deleted: boolean) =>
  writeJson(appDeletedRoute(appId), {
    method: 'PUT',
    nodeId,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deleted }),
  })

export function ProjectAppDetail() {
  const params = useParams()
  const app = () => {
    const found = params.appId ? appById(params.appId) : undefined
    return found?.projectId === params.projectId && !found?.deletedAt ? found : undefined
  }
  return (
    <Show
      when={app()?.appId}
      keyed
      fallback={<EmptyState title="No app selected">Choose an app to open it.</EmptyState>}
    >
      {(appId) => <ProjectApp app={() => appById(appId) ?? app()!} />}
    </Show>
  )
}

/** Editing a project app: a draft in a task, opened in the task's Apps pane. The Apps source and an
 *  app's dashboard cell both edit this way. */
export function useAppEditing() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const nodeId = activeNodeId() ?? ''
  const surface = clientCapability(AGENTS_CONVERSATION)
  const draftIn = async (app: AppListing, task: Task) => {
    const draft = await writeJson<{ appId: string }>(appDraftsRoute(app.appId), {
      method: 'POST',
      nodeId,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ taskId: task.id }),
    })
    await refreshApps()
    return draft.appId
  }
  const open = (task: Task, appId: string) => {
    activateTaskSignals(task)
    navigate(pathForTask(task))
    openPane(task.id, APPS_PANE_ID, { kind: 'plugin:select', item: appId })
  }
  return {
    editIn: async (app: AppListing, task: Task) => open(task, await draftIn(app, task)),
    /** Creates a task named after the app, with the draft in it and an editing session started. */
    editInNewTask: async (app: AppListing) => {
      const task = await createTask({ origin: 'manual', projectId: app.projectId!, title: app.name })
      await queryClient.invalidateQueries({ queryKey: tasksOptions(true).queryKey })
      const draftId = await draftIn(app, task)
      const draft = appById(draftId)
      if (surface && draft) await startEditingSession(surface, queryClient, nodeId, task.id, draft)
      open(task, draftId)
    },
  }
}

function ProjectApp(props: { app: () => AppListing }) {
  const navigate = useNavigate()
  const nodeId = activeNodeId() ?? ''
  const editing = useAppEditing()
  const projectId = () => props.app().projectId!
  const workspaceId = () => projectWorkspaceId(projectId())
  // The task open behind this page, when it's an active task of the same project.
  const openTask = () => {
    const task = taskById(activeTaskId() ?? '')
    return task?.projectId === projectId() && task.status !== 'archived' ? task : undefined
  }
  const [busy, setBusy] = createSignal<'this' | 'new' | 'delete'>()
  const [error, setError] = createSignal('')
  const run = async (kind: 'this' | 'new' | 'delete', work: () => Promise<void>, failure: string) => {
    setBusy(kind)
    setError('')
    try {
      await work()
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : failure)
    } finally {
      setBusy(undefined)
    }
  }

  const editHere = (task: Task) =>
    run('this', () => editing.editIn(props.app(), task), "Couldn't make a draft in this task.")
  const editInNewTask = () =>
    run('new', () => editing.editInNewTask(props.app()), "Couldn't make a task to edit this app.")
  const remove = () =>
    run(
      'delete',
      async () => {
        await setDeleted(nodeId, props.app().appId, true)
        await refreshApps()
        navigate(projectAppsPath(projectId()))
      },
      "Couldn't delete this app.",
    )

  return (
    <>
      <Toolbar ariaLabel="App">
        <Heading level={2}>{props.app().name}</Heading>
        <Toolbar.Spacer />
        <AddToDashboardMenu
          label="Add to dashboard"
          projectId={projectId()}
          onSelect={(tab) => addAppToDashboard({ ...props.app(), projectId: projectId() }, tab)}
        />
        <Show when={openTask()}>
          {(task) => (
            <Button
              size="sm"
              variant="ghost"
              busy={busy() === 'this'}
              tip={`Make a draft in ${task().title}`}
              onPress={() => void editHere(task())}
            >
              Edit in this task
            </Button>
          )}
        </Show>
        <Button size="sm" variant="ghost" busy={busy() === 'new'} onPress={() => void editInNewTask()}>
          Edit in a new task
        </Button>
        <ConfirmButton
          size="sm"
          variant="ghost"
          tone="danger"
          confirmLabel={`Delete ${props.app().name}?`}
          disabled={!!busy()}
          onConfirm={() => void remove()}
        >
          Delete
        </ConfirmButton>
      </Toolbar>
      <Show when={error()}>{(message) => <Alert tone="danger">{message()}</Alert>}</Show>
      <Section label={`Version ${props.app().head}`}>
        <Show when={props.app().head} keyed>
          {(head) => (
            <Revision
              appId={props.app().appId}
              revision={head}
              workspaceId={workspaceId()}
              nodeId={nodeId}
              readOnly={false}
              placement="project"
            />
          )}
        </Show>
      </Section>
    </>
  )
}
