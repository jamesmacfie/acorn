import { createEffect, createMemo, createSignal, Show, type Accessor } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { Alert, Button, CodeBlock, Inline, Stack, Text } from '@acorn/plugin-api/ui'
import {
  activeNodeId,
  allProjects,
  openPane,
  readJson,
  taskById,
  tasksOptions,
  writeJson,
} from '@acorn/plugin-api/client'
import type { AgentToolCardProps } from '@acorn/protocol/extensionPoints.ts'
import {
  APPS_PANE_ID,
  appRestoreRoute,
  appRevisionRoute,
  appRoute,
  appShowInput,
  appShowResultSchema,
  type AppRevisionFiles,
  type AppShowResult,
  type AppSummary,
} from '../shared/api'
import { appById } from './appsStore'
import AppView, { type AppPlacement } from './AppView'
import { PublishButton } from './PublishButton'

// The transcript card for `app_show` (docs/agent-built-apps.md § Cards). Each card pins the revision
// its call published. Only the card showing the app's head is interactive; the others collapse to a
// line that can draw their own revision, read only, or restore it. A card in an archived task's
// transcript draws nothing, because the task's data may not resolve.

/** A call's JSON as a transcript recorded it, unwrapping the MCP content envelope. */
function json(text: string | undefined): unknown {
  try {
    const value: unknown = text ? JSON.parse(text) : undefined
    const content = (value as { content?: { text?: unknown }[] } | undefined)?.content
    return Array.isArray(content) ? json(content.find((part) => typeof part?.text === 'string')?.text as string) : value
  } catch {
    return undefined
  }
}

export default function AppToolCard(props: AgentToolCardProps) {
  const input = createMemo(() => appShowInput.safeParse(json(props.tool.input)).data)
  // A harness records a refused call as completed, with the error as its output, so a finished call
  // with no result is an app that didn't pass its checks.
  const result = createMemo(
    () => (props.tool.status === 'completed' ? appShowResultSchema.safeParse(json(props.tool.output)).data : undefined),
    undefined,
    { equals: (a, b) => a?.appId === b?.appId && a?.revision === b?.revision },
  )
  const checking = () => props.tool.status === 'pending' || props.tool.status === 'running'
  return (
    <Show
      when={result()}
      keyed
      fallback={
        <Show when={!checking()} fallback={<Text tone="muted">Checking the app…</Text>}>
          <Stack gap="row">
            <Alert tone="warn">This app didn't pass its checks, so nothing was drawn.</Alert>
            <Show when={props.tool.output}>
              {(output) => (
                <CodeBlock wrap maxHeight="block">
                  {output()}
                </CodeBlock>
              )}
            </Show>
          </Stack>
        </Show>
      }
    >
      {(shown) => <AppCard taskId={props.taskId} shown={shown} note={input()?.note ?? ''} />}
    </Show>
  )
}

function AppCard(props: { taskId: string; shown: AppShowResult; note: string }) {
  const nodeId = activeNodeId() ?? ''
  const queryClient = useQueryClient()
  const summaryKey = ['trellis-app', nodeId, props.shown.appId]
  const summary = createQuery(() => ({
    queryKey: summaryKey,
    queryFn: () => readJson<AppSummary>(appRoute(props.shown.appId), { nodeId }),
    staleTime: 30_000,
  }))
  // Every card of an app shares the summary, so a newer card arriving tells the older ones.
  createEffect(() => {
    if (summary.data && summary.data.head < props.shown.revision) void summary.refetch()
  })
  const head = () => summary.data?.head ?? props.shown.revision
  // A restore publishes an old revision's files anew; the card that showed them draws the result.
  const drawn = () =>
    summary.data?.revisions.find((revision) => revision.revision === head())?.restoredFrom === props.shown.revision
      ? head()
      : props.shown.revision
  const current = () => drawn() === head()
  const [showOld, setShowOld] = createSignal(false)
  const [restoreError, setRestoreError] = createSignal('')
  // The active task list holds no archived task. Unknown until it loads, which isn't archived.
  const tasks = createQuery(() => tasksOptions(true))
  const archived = () => tasks.isSuccess && !tasks.data.some((task) => task.id === props.taskId)

  const projectId = () => taskById(props.taskId)?.projectId
  const workspaceId = () => allProjects().find((project) => project.id === projectId())?.workspaceId ?? ''
  const restore = async () => {
    setRestoreError('')
    try {
      await writeJson(appRestoreRoute(props.shown.appId), {
        method: 'POST',
        nodeId,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ revision: props.shown.revision }),
      })
      setShowOld(false)
      await queryClient.invalidateQueries({ queryKey: summaryKey })
    } catch {
      setRestoreError(`Couldn't restore v${props.shown.revision}. Try again.`)
    }
  }

  const label = () => {
    const restoredFrom = summary.data?.revisions.find((revision) => revision.revision === drawn())?.restoredFrom
    return `${props.shown.name} · v${drawn()}${restoredFrom ? `, restored from v${restoredFrom}` : ''}`
  }

  return (
    <Show
      when={!archived()}
      fallback={<Text tone="muted" wrap>{`${label()}. This task is archived, so the app isn't drawn.`}</Text>}
    >
      <Stack gap="row">
        <Show
          when={current()}
          fallback={
            <Inline spread wrap>
              <Text
                tone="muted"
                wrap
              >{`v${props.shown.revision}: ${props.note.replace(/([^.!?])$/, '$1.')} Replaced by v${head()}.`}</Text>
              <Inline gap="inline">
                <Button size="sm" variant="ghost" onPress={() => setShowOld((value) => !value)}>
                  {showOld() ? `Hide v${props.shown.revision}` : `Show v${props.shown.revision}`}
                </Button>
                <Button size="sm" variant="ghost" onPress={() => void restore()}>
                  {`Restore v${props.shown.revision}`}
                </Button>
              </Inline>
            </Inline>
          }
        >
          <Inline spread wrap>
            <Text emphasis="strong">{label()}</Text>
            <Inline gap="inline">
              <Show when={appById(props.shown.appId)}>{(app) => <PublishButton app={app()} addToDashboard />}</Show>
              <Button
                size="sm"
                variant="ghost"
                onPress={() => openPane(props.taskId, APPS_PANE_ID, { kind: 'plugin:select', item: props.shown.appId })}
              >
                Open
              </Button>
            </Inline>
          </Inline>
        </Show>
        <Show when={restoreError()}>{(message) => <Alert tone="danger">{message()}</Alert>}</Show>
        <Show when={current() || showOld()}>
          <Revision
            appId={props.shown.appId}
            revision={current() ? drawn() : props.shown.revision}
            taskId={props.taskId}
            workspaceId={workspaceId()}
            nodeId={nodeId}
            readOnly={!current()}
            placement="card"
          />
        </Show>
      </Stack>
    </Show>
  )
}

/** One revision's files. A revision never changes, so they're read once. */
export const revisionFilesOptions = (nodeId: string, appId: string, revision: number) => ({
  queryKey: ['trellis-revision', nodeId, appId, revision],
  queryFn: () => readJson<AppRevisionFiles>(appRevisionRoute(appId, revision), { nodeId }),
  staleTime: Infinity,
})

/** One revision of an app, running, once its files are read. The card, the Apps pane, and the Apps
 *  source draw it, and a dashboard cell. A project app has no task. */
export function Revision(props: {
  appId: string
  revision: number
  taskId?: string
  workspaceId: string
  nodeId: string
  readOnly: boolean
  placement: AppPlacement
  refreshes?: Accessor<number>
}) {
  const files = createQuery(() => revisionFilesOptions(props.nodeId, props.appId, props.revision))
  return (
    <Show
      when={files.data}
      keyed
      fallback={<Text tone="muted">{files.isError ? "Couldn't load this app." : 'Loading…'}</Text>}
    >
      {(loaded) => (
        <AppView
          appId={props.appId}
          taskId={props.taskId}
          workspaceId={props.workspaceId}
          files={loaded}
          nodeId={props.nodeId}
          readOnly={props.readOnly}
          placement={props.placement}
          refreshes={props.refreshes}
        />
      )}
    </Show>
  )
}
