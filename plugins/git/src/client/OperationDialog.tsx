import { createEffect, createSignal, onCleanup, Show } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { activateTaskSignals, activeNodeId, latestSignal, pathForTask, tasksOptions, toast, type Task } from '@acorn/plugin-api/client'
import { Alert, Button, Facts, Modal, Select, Stack, Text } from '@acorn/plugin-api/ui'
import type { OperationKind } from '../shared/api'
import { operationActions, operationKey, operationLabel, operationOptions } from './operationClient'

export type OperationRequest = { operation: OperationKind; source: { id: string; label: string } }

const summary: Record<OperationKind, string> = {
  merge: 'Merge this commit into the task checkout',
  rebase: 'Rebase the task branch onto this commit',
  'cherry-pick': 'Apply this commit to the task checkout',
  revert: 'Revert this commit in the task checkout',
}

/** Starts one operation on an explicit task. The repository source asks for the task; the task pane fixes it.
 *  The dialog keeps the Node and project it opened with and refuses to write once either changes. */
export function OperationDialog(props: OperationRequest & { projectId: string; task?: Task; onClose: () => void }) {
  const nodeId = activeNodeId()
  const cache = useQueryClient()
  const navigate = useNavigate()
  const tasks = createQuery(() => tasksOptions(true))
  const candidates = () => (tasks.data ?? []).filter((task) => task.status === 'active' && task.projectId === props.projectId)
  const [taskId, setTaskId] = createSignal(props.task?.id ?? '')
  createEffect(() => { if (!taskId() && candidates()[0]) setTaskId(candidates()[0]!.id) })
  const target = createQuery(() => operationOptions(taskId()))
  const observed = () => target.data?.taskId === taskId() ? target.data : null
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  const [stopped, setStopped] = createSignal<string | null>(null)
  const operationStart = latestSignal()
  onCleanup(() => operationStart.abort())
  const label = operationLabel[props.operation]
  const submit = async () => {
    if (activeNodeId() !== nodeId) { setError('The Node changed. Close and reopen this action.'); return }
    const state = observed()
    if (!state?.head) { setError('Target checkout state is unavailable. Refresh and try again.'); return }
    const signal = operationStart.next(), queryKey = operationKey(state.taskId)
    setBusy(true); setError(''); setStopped(null)
    try {
      const result = await operationActions.start(state.taskId, { expectedPath: state.checkout, expectedHead: state.head, operation: props.operation, source: props.source.id })
      if (result.state) cache.setQueryData(queryKey, result.state)
      else void cache.invalidateQueries({ queryKey })
      if (signal.aborted) return
      if (result.ok) { toast(`${label} finished.`, { tone: 'success' }); props.onClose(); return }
      setError(result.error ?? 'Git refused the operation.')
      if (result.state?.operation || result.state?.conflicts.length) setStopped(state.taskId)
    } catch (cause) {
      void cache.invalidateQueries({ queryKey })
      if (!signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
    } finally { if (!signal.aborted) setBusy(false) }
  }
  const openTask = (id: string) => {
    const task = (tasks.data ?? []).find((item) => item.id === id)
    props.onClose()
    if (task) { activateTaskSignals(task, { pane: 'git' }); navigate(pathForTask(task)) }
  }
  return <Modal title={`${label} in a task`} size="md" onDismiss={props.onClose}>
    <Modal.Body><Stack gap="section">
      <Text>Node {nodeId ?? 'unavailable'} · Project {props.projectId}</Text>
      <Text>{summary[props.operation]}: {props.source.label} · {props.source.id.slice(0, 12)}</Text>
      <Show when={!props.task} fallback={<Text>Target task: {props.task?.title}</Text>}>
        <Select label="Target task" value={taskId()} options={candidates().map((task) => ({ value: task.id, label: `${task.title} · ${task.branch ?? 'project checkout'}` }))}
          onChange={(id) => { setTaskId(id); setError(''); setStopped(null) }} />
      </Show>
      <Show when={!taskId()}><Alert tone="muted">This project has no active task to change.</Alert></Show>
      <Show when={observed()}>{(state) => <Facts grouping="rows" items={[
        { label: 'Branch', value: state().branch ?? 'Detached HEAD' },
        { label: 'HEAD', value: state().head ?? 'No commits', mono: true },
      ]} />}</Show>
      <Show when={target.error}><Alert tone="warn">{String(target.error)}</Alert></Show>
      <Show when={observed()?.busy.length}><Alert tone="warn">Checkout is busy: {observed()!.busy.join(', ')}. Acorn refuses the {label.toLowerCase()} until that work stops.</Alert></Show>
      <Show when={!stopped() && (observed()?.operation || observed()?.conflicts.length)}>
        <Alert tone="warn">This checkout has an unfinished operation or conflicts. Finish or abort it in the task's Git pane first.</Alert>
      </Show>
      <Show when={error()}><Alert tone="danger">{error()}</Alert></Show>
      <Show when={stopped()}>{(id) => <Button onPress={() => openTask(id())}>Resolve in the task's Git pane</Button>}</Show>
    </Stack></Modal.Body>
    <Modal.Actions>
      <Button variant="ghost" onPress={props.onClose}>{stopped() ? 'Close' : 'Cancel'}</Button>
      <Show when={!stopped()}><Button busy={busy()} disabled={busy() || !observed()?.head} onPress={() => void submit()}>{label}</Button></Show>
    </Modal.Actions>
  </Modal>
}
