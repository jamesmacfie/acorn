import { createEffect, createMemo, createSignal, on, onCleanup, Show } from 'solid-js'
import { clientEvents, readJson, writeJson } from '@acorn/plugin-api/client'
import { Alert, Button, Field, Inline, Link, Select, Stack, Text } from '@acorn/plugin-api/ui'
import { instructionReviewRoute as route, type InstructionReview, type InstructionReviewTask } from '../../shared/instructionReview'
import InstructionReviewResults from './InstructionReviewResults'

export default function InstructionReviewPanel(props: { nodeId?: string | null; enabled?: boolean; preferredTaskId?: string | null }) {
  const [tasks, setTasks] = createSignal<InstructionReviewTask[]>([])
  const [loadingTasks, setLoadingTasks] = createSignal(true)
  const [taskId, setTaskId] = createSignal('')
  const [review, setReview] = createSignal<InstructionReview | null>(null)
  const [reviewNodeId, setReviewNodeId] = createSignal<string | undefined>()
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  const [approved, setApproved] = createSignal(false)
  let generation = 0
  let request: AbortController | null = null
  const nodeId = () => props.nodeId ?? undefined
  const enabled = createMemo(() => props.enabled ?? false)
  const selectedProject = () => tasks().find((task) => task.id === taskId())?.projectId

  const clear = () => {
    request?.abort(); request = null; ++generation
    setReview(null); setReviewNodeId(undefined); setApproved(false); setBusy(false); setError('')
  }
  createEffect(on(nodeId, (selectedNode) => {
    clear()
    const currentGeneration = generation
    setTasks([])
    setTaskId('')
    setLoadingTasks(true)
    const controller = new AbortController()
    request = controller
    const preferredTask = props.preferredTaskId
    void readJson<InstructionReviewTask[]>(`${route}/tasks`, { nodeId: selectedNode, signal: controller.signal }).then((found) => {
      if (generation !== currentGeneration) return
      setTasks(found)
      setLoadingTasks(false)
      setTaskId(found.some((task) => task.id === preferredTask) ? preferredTask! : found[0]?.id ?? '')
    }).catch(() => {
      if (generation === currentGeneration) { setLoadingTasks(false); setError('Could not load tasks for instruction review. Reopen Settings to try again.') }
    })
  }))
  onCleanup(clear)

  const load = async () => {
    const selectedNode = nodeId()
    const selectedTask = taskId()
    if (!selectedTask) return
    clear()
    const currentGeneration = generation
    const controller = new AbortController()
    request = controller
    setBusy(true)
    try {
      const result = await readJson<InstructionReview>(`${route}?taskId=${encodeURIComponent(selectedTask)}`, { nodeId: selectedNode, signal: controller.signal })
      if (generation === currentGeneration && taskId() === selectedTask) { setReview(result); setReviewNodeId(selectedNode) }
    } catch (cause) { if (generation === currentGeneration) setError(cause instanceof Error ? cause.message : 'Instruction scan incomplete. Retry the review.') }
    finally { if (generation === currentGeneration) setBusy(false) }
  }
  // Opening Settings or enabling review checks the selected worktree before the next agent turn.
  createEffect(on([enabled, taskId], ([reviewEnabled, selectedTask]) => {
    if (reviewEnabled && selectedTask) void load()
  }))
  const approve = async () => {
    const current = review()
    if (!current?.id || nodeId() !== reviewNodeId() || taskId() !== current.taskId) return
    const selectedNode = nodeId()
    const currentGeneration = generation
    const controller = new AbortController()
    request = controller
    setBusy(true); setError('')
    try {
      await writeJson(`${route}/${encodeURIComponent(current.id)}/approve`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ taskId: current.taskId }), nodeId: selectedNode, signal: controller.signal,
      }, (response) => response.status === 409 ? 'The instructions changed while this review was open. Check again before approving.'
        : 'Could not approve these instructions. Try again.')
      if (generation === currentGeneration) { setApproved(true); setReview(null) }
    } catch (cause) { if (generation === currentGeneration) setError(cause instanceof Error ? cause.message : 'Instructions changed. Open a new review.') }
    finally { if (generation === currentGeneration) setBusy(false) }
  }

  return <Stack gap="row">
    <Show when={tasks().length} fallback={<Text emphasis="muted" wrap>{loadingTasks() ? 'Loading tasks…' : 'Create a task on this Node to review its instruction files before starting an agent.'}</Text>}>
      <Field label="Task" hint="Review the instructions in this task’s worktree.">
        <Select label="Task for instruction review" value={taskId()} options={tasks().map((task) => ({ value: task.id, label: task.title }))}
          onChange={(value) => { clear(); setTaskId(value) }} />
      </Field>
      <Button size="sm" busy={busy()} onPress={() => void load()}>{review() || approved() ? 'Check again' : 'Review instruction files'}</Button>
    </Show>
    <Show when={error()}><Alert>{error()}</Alert></Show>
    <Show when={approved()}><Alert variant="banner" tone="ok" title="Instructions approved">Acorn will ask you to review them again if the files change.</Alert></Show>
    <Show when={review()}>{(result) => <InstructionReviewResults review={result()} busy={busy()} onApprove={() => void approve()} />}</Show>
    <Show when={review() && !review()?.approved && !review()?.empty}>
      <Inline wrap><Text emphasis="muted">Other approvals:</Text>
        <Link onPress={() => clientEvents.emit('presentation:open-settings', { tab: 'plugins' })}>Plugins and skills</Link>
        <Show when={selectedProject()}>{(projectId) => <Link onPress={() => clientEvents.emit('presentation:open-settings', { tab: `project/${projectId()}` })}>Project configuration</Link>}</Show>
      </Inline>
    </Show>
  </Stack>
}
