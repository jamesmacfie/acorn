import { For, Show } from 'solid-js'
import type { Task } from '@acorn/plugin-api/client'
import { Alert, Badge, Card, CodeBlock, Fold, Icon, Inline, Link, Stack, Text } from '@acorn/plugin-api/ui'
import type { WorkflowChildRunSummary, WorkflowRunProjection, WorkflowStepProjection } from '../../shared/api'
import { formatUsage, runGlyph, runTone } from './runDisplay'

const TERMINAL = new Set(['done', 'failed', 'safety-rail', 'cancelled'])
const FAILED = new Set(['failed', 'safety-rail', 'cancelled'])

type OpenTarget = (taskId: string, runId?: string) => void

const taskLink = (tasks: readonly Task[], taskId: string, onOpen: OpenTarget) => {
  const task = tasks.find((candidate) => candidate.id === taskId)
  return task
    ? <Link onPress={() => onOpen(taskId)}>{task.title}</Link>
    : <Text emphasis="mono">{taskId}</Text>
}

const runLink = (tasks: readonly Task[], taskId: string, runId: string, label: string, onOpen: OpenTarget) => {
  const task = tasks.find((candidate) => candidate.id === taskId)
  return task
    ? <Link onPress={() => onOpen(taskId, runId)}>{label}</Link>
    : <Text emphasis="mono">{runId}</Text>
}

/** Explicit ancestor links for a child run. */
export function RunLineage(props: {
  run: WorkflowRunProjection | undefined
  tasks: readonly Task[]
  onOpen: OpenTarget
}) {
  return (
    <Show when={props.run?.parentRunId && props.run.parentTaskId}>
      <Card pad="sm">
        <Stack gap="row">
          <Inline wrap>
            <Text emphasis="muted">{props.run!.rootRunId === props.run!.parentRunId ? 'Parent and root task' : 'Parent task'}</Text>
            {taskLink(props.tasks, props.run!.parentTaskId!, props.onOpen)}
            <Text emphasis="muted">{props.run!.rootRunId === props.run!.parentRunId ? 'Parent and root run' : 'Parent run'}</Text>
            {runLink(props.tasks, props.run!.parentTaskId!, props.run!.parentRunId!, props.run!.parentRunName ?? props.run!.parentRunId!, props.onOpen)}
          </Inline>
          <Show when={props.run!.rootRunId !== props.run!.parentRunId}>
            <Inline wrap>
              <Text emphasis="muted">Root task</Text>
              {taskLink(props.tasks, props.run!.rootTaskId, props.onOpen)}
              <Text emphasis="muted">Root run</Text>
              {runLink(props.tasks, props.run!.rootTaskId, props.run!.rootRunId!, props.run!.rootRunName, props.onOpen)}
            </Inline>
          </Show>
        </Stack>
      </Card>
    </Show>
  )
}

const childLabel = (child: WorkflowChildRunSummary): string => child.itemKey
  ? `${child.name ?? 'Child workflow'} · ${child.itemKey}`
  : child.name ?? 'Child workflow'

/** Progress, navigation, results, and failures for a workflow dispatch step. */
export function ChildRuns(props: {
  step: WorkflowStepProjection
  tasks: readonly Task[]
  onOpen: OpenTarget
}) {
  const children = () => props.step.children ?? []
  const finished = () => children().filter((child) => child.runStatus && TERMINAL.has(child.runStatus)).length
  const failed = () => children().filter((child) => child.runStatus && FAILED.has(child.runStatus)).length
  const gated = () => children().filter((child) => child.runStatus === 'gated').length

  return (
    <Show when={children().length}>
      <Stack gap="row">
        <Inline wrap>
          <Text emphasis="strong">Child runs</Text>
          <Text emphasis="muted">{finished()} of {children().length} finished</Text>
          <Show when={gated()}>{(count) => <Badge size="xs" tone="warn">{count()} need approval</Badge>}</Show>
          <Show when={failed()}>{(count) => <Badge size="xs" tone="danger">{count()} failed</Badge>}</Show>
        </Inline>
        <Show when={FAILED.has(props.step.status)}>
          <Text emphasis="muted" wrap>Retry reuses these tasks and runs. It does not create replacements.</Text>
        </Show>
        <For each={children()}>
          {(child) => (
            <Card
              pad="sm"
              stripe={child.runStatus === 'gated' ? 'warn' : child.runStatus && FAILED.has(child.runStatus) ? 'danger' : child.runStatus === 'done' ? 'ok' : undefined}
            >
              <Stack gap="row">
                <Inline wrap>
                  <Icon name={runGlyph(child.runStatus ?? child.dispatchState)} tone={runTone(child.runStatus ?? child.dispatchState)} spin={child.runStatus === 'running'} />
                  <Text emphasis="strong">{childLabel(child)}</Text>
                  <Badge size="xs" tone={child.runStatus === 'gated' ? 'warn' : undefined}>{child.runStatus ?? child.dispatchState}</Badge>
                  <Show when={formatUsage(child.usage)}>{(usage) => <Text emphasis="muted">{usage()}</Text>}</Show>
                </Inline>
                <Inline wrap>
                  <Text emphasis="muted">Task</Text>
                  {taskLink(props.tasks, child.taskId, props.onOpen)}
                  <Text emphasis="muted">Run</Text>
                  {runLink(props.tasks, child.taskId, child.runId, child.name ?? child.runId, props.onOpen)}
                </Inline>
                <Show when={child.runStatus === 'gated'}>
                  <Alert title="Approval required">Open the child run to review its gate.</Alert>
                </Show>
                <Show when={child.error}>{(error) => <Alert title="Child run stopped">{error()}</Alert>}</Show>
                <Show when={child.resultSummary}>
                  {(result) => <Fold label="Result"><CodeBlock wrap maxHeight="block">{result()}</CodeBlock></Fold>}
                </Show>
              </Stack>
            </Card>
          )}
        </For>
      </Stack>
    </Show>
  )
}
