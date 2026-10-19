import { createMemo, createSignal, For, Show } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import {
  Alert,
  Button,
  CodeBlock,
  EmptyState,
  Fold,
  Heading,
  Row,
  Rows,
  Section,
  Stack,
  Text,
  ToggleButton,
  Toolbar,
} from '@acorn/plugin-api/ui'
import {
  activeNodeId,
  allProjects,
  clientCapability,
  formatRelativeTime,
  readJson,
  type Task,
} from '@acorn/plugin-api/client'
import { AGENTS_CONVERSATION } from '@acorn/plugin-agents/contract/conversation.ts'
import { appRoute, type AppListing, type AppSummary } from '../shared/api'
import { appById, taskApps } from './appsStore'
import { Revision, revisionFilesOptions } from './AppToolCard'
import { startEditingSession } from './editingSession'
import { PublishButton } from './PublishButton'
import type { AppsPaneModel } from './paneContribution'

// The Apps pane's two regions (./paneContribution.ts).
//
// The detail is a fragment, not a Stack, for the reason the workflows run pane gives: the editing
// conversation's timeline is the scroller and has to be the region's own child. The app sits in a
// Section above it, and the shell caps a section beside a transcript at 40% of the column.

export function AppList(props: { task: Task; model: AppsPaneModel }) {
  const apps = () => taskApps(props.task.id)
  return (
    <Rows
      id={`trellis.${props.task.id}`}
      ariaLabel="Apps"
      items={apps().map((app) => ({ key: app.appId, label: app.name, app }))}
    >
      {(entry, item) => (
        <Row
          item={item}
          variant="stacked"
          selected={props.model.selected()?.appId === entry.app.appId}
          onPress={() => props.model.select(entry.app.appId)}
          meta={<Text emphasis="muted">{`v${entry.app.head}`}</Text>}
        >
          <Text emphasis="strong">{entry.app.name}</Text>
          <Show when={entry.app.description}>
            <Text emphasis="muted" wrap>
              {entry.app.description}
            </Text>
          </Show>
          <Show when={entry.app.draftOf}>
            {(draftOf) => (
              <Text emphasis="muted">{`Draft of ${appById(draftOf().appId)?.name ?? 'a removed app'} v${draftOf().revision}`}</Text>
            )}
          </Show>
          <Text emphasis="muted">{`Changed ${formatRelativeTime(entry.app.updatedAt)}`}</Text>
        </Row>
      )}
    </Rows>
  )
}

export function AppDetail(props: { task: Task; model: AppsPaneModel }) {
  // Keyed by id, so a new head redraws the app and leaves the conversation where it is.
  return (
    <Show
      when={props.model.selected()?.appId}
      keyed
      fallback={<EmptyState title="No app selected">Choose an app to open it.</EmptyState>}
    >
      {(appId) => {
        // This app's row, which a refresh replaces. Kept while a refresh briefly lacks it.
        const app = createMemo(
          (last: AppListing) => taskApps(props.task.id).find((candidate) => candidate.appId === appId) ?? last,
          props.model.selected()!,
        )
        return props.task.status === 'archived' ? (
          <ArchivedApp app={app()} />
        ) : (
          <>
            <Toolbar ariaLabel="App">
              <Heading level={2}>{app().name}</Heading>
              <Toolbar.Spacer />
              <PublishButton app={app()} />
              <ToggleButton size="sm" pressed={props.model.editing()} onPressedChange={props.model.setEditing}>
                Edit with agent
              </ToggleButton>
            </Toolbar>
            <Section label={`Version ${app().head}`}>
              <Show when={app().head} keyed>
                {(head) => (
                  <Revision
                    appId={app().appId}
                    revision={head}
                    taskId={props.task.id}
                    workspaceId={
                      allProjects().find((project) => project.id === props.task.projectId)?.workspaceId ?? ''
                    }
                    nodeId={activeNodeId() ?? ''}
                    readOnly={false}
                    placement="pane"
                  />
                )}
              </Show>
            </Section>
            <Show when={props.model.editing()}>
              <EditingConversation task={props.task} app={app} />
            </Show>
          </>
        )
      }}
    </Show>
  )
}

/** The building session's conversation, or a way to start one that knows the app. */
function EditingConversation(props: { task: Task; app: () => AppListing }) {
  const surface = clientCapability(AGENTS_CONVERSATION)
  const nodeId = activeNodeId() ?? ''
  const queryClient = useQueryClient()
  const open = createQuery(() => ({
    queryKey: ['trellis-session-open', nodeId, props.app().sessionId],
    queryFn: () => surface!.sessionOpen(props.app().sessionId!),
    enabled: !!surface && !!props.app().sessionId,
  }))
  const [starting, setStarting] = createSignal(false)
  const [error, setError] = createSignal('')

  const start = async () => {
    setStarting(true)
    setError('')
    try {
      await startEditingSession(surface!, queryClient, nodeId, props.task.id, props.app())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn't start an editing session.")
    } finally {
      setStarting(false)
    }
  }

  return (
    <Show
      when={surface}
      fallback={<EmptyState size="sm">The Agents plugin isn't running, so there's no conversation here.</EmptyState>}
    >
      {(conversation) => (
        <Show
          when={open.data ? props.app().sessionId : undefined}
          keyed
          fallback={
            <Show when={!open.isLoading} fallback={<EmptyState size="sm" busy />}>
              <Stack gap="row">
                <EmptyState
                  size="sm"
                  action={
                    <Button size="sm" variant="solid" busy={starting()} onPress={() => void start()}>
                      Start an editing session
                    </Button>
                  }
                >
                  The session that built this app is archived or gone. A new one starts with the app attached.
                </EmptyState>
                <Show when={error()}>{(message) => <Alert tone="danger">{message()}</Alert>}</Show>
              </Stack>
            </Show>
          }
        >
          {(sessionId) => (
            <Dynamic component={conversation().Conversation} sessionId={sessionId} viewKeyPrefix="trellis-apps" />
          )}
        </Show>
      )}
    </Show>
  )
}

/** An archived task's app: its revisions and their programs, read only, never run. */
function ArchivedApp(props: { app: AppListing }) {
  const nodeId = activeNodeId() ?? ''
  const summary = createQuery(() => ({
    queryKey: ['trellis-app', nodeId, props.app.appId],
    queryFn: () => readJson<AppSummary>(appRoute(props.app.appId), { nodeId }),
  }))
  return (
    <>
      <Toolbar ariaLabel="App">
        <Heading level={2}>{props.app.name}</Heading>
      </Toolbar>
      <Stack gap="section">
        <Show when={props.app.description}>
          <Text wrap>{props.app.description}</Text>
        </Show>
        <Text tone="muted" wrap>
          This task is archived, so the app isn't drawn. Restore the task to run it at v{props.app.head}.
        </Text>
        <For each={[...(summary.data?.revisions ?? [])].reverse()}>
          {(revision) => (
            <Fold level="sub" label={`v${revision.revision}: ${revision.note}`}>
              <RevisionFiles appId={props.app.appId} revision={revision.revision} />
            </Fold>
          )}
        </For>
      </Stack>
    </>
  )
}

function RevisionFiles(props: { appId: string; revision: number }) {
  const files = createQuery(() => revisionFilesOptions(activeNodeId() ?? '', props.appId, props.revision))
  return (
    <Show when={files.data} fallback={<Text tone="muted">{files.isError ? "Couldn't load it." : 'Loading…'}</Text>}>
      {(loaded) => (
        <Stack gap="row">
          <Text emphasis="strong">program</Text>
          <CodeBlock wrap>{loaded().program}</CodeBlock>
          <For each={Object.entries(loaded().plans)}>
            {([name, plan]) => (
              <>
                <Text emphasis="strong">{`plans/${name}`}</Text>
                <CodeBlock wrap>{JSON.stringify(plan, null, 2)}</CodeBlock>
              </>
            )}
          </For>
        </Stack>
      )}
    </Show>
  )
}
