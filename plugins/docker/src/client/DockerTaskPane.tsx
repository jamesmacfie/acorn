// The Docker task pane: containers linked to this task (matched main-side by worktree/slug), a chip
// per container switching the shared ContainerDetail, the same shape as RollbarPane.
//
// A `header-body` pane: the chips are the header and do not scroll, the detail is the body and does
// (docs/panes.md § Layout model). The two regions share a selection, so it lives in ./dockerViewState
// rather than in either of them.
import { createEffect, createResource, createRoot, createSignal, For, on, onCleanup, Show } from 'solid-js'
import { onScopeEvicted } from '@acorn/plugin-api/client'
import type { Task } from '@acorn/protocol/api.ts'
import type { DockerContainerSummary } from '../shared/model'
import { fetchTaskContainers } from './dockerClient'
import { wsOnDockerChanged } from './wsChannel'
import { containerTone, dockerSelection, rememberDockerSelection } from './dockerViewState'
import ContainerDetail from './ContainerDetail'
import { Chip, ChipRow, EmptyState, StatusDot } from '@acorn/plugin-api/ui'

// One resource per task, shared by the two regions. The chips list the containers and the body draws
// the selected one, and a second fetch for the same list would be one poll too many.
//
// In its own reactive root, keyed by task, the same as notes', context's and changes' models: the two
// regions are mounted and unmounted independently by the host, so a resource owned by whichever of
// them happened to ask first would be disposed under the other.
const roots = new Map<string, { model: TaskContainers; dispose: () => void }>()

type TaskContainers = ReturnType<typeof linkedContainers>

function linkedContainers(taskId: string) {
  const [linked, { refetch }] = createResource(() => taskId, fetchTaskContainers)
  const [selected, setSelected] = createSignal<string | null>(dockerSelection(taskId) ?? null)

  // Land selection on the first container (and heal it when the selected one disappears).
  createEffect(on(linked, (list) => {
    if (!list?.length) return setSelected(null)
    if (!selected() || !list.some((c) => c.id === selected())) setSelected(list[0].id)
  }))
  // Session-only: revisiting the pane lands on the same container.
  createEffect(on(selected, (id) => {
    if (id) rememberDockerSelection(taskId, id)
  }))

  return { linked, refetch, selected, setSelected }
}

const model = (taskId: string): TaskContainers => {
  const held = roots.get(taskId)
  if (held) return held.model
  // One task is on screen at a time; anything else here is a task somebody navigated away from.
  for (const [id, entry] of roots) if (id !== taskId) { entry.dispose(); roots.delete(id) }
  const entry = createRoot((dispose) => ({ model: linkedContainers(taskId), dispose }))
  roots.set(taskId, entry)
  return entry.model
}

onScopeEvicted((event) => {
  if (event.scope !== 'task') return
  roots.get(event.taskId)?.dispose()
  roots.delete(event.taskId)
})

const chipLabel = (c: DockerContainerSummary): string => c.composeService ?? c.name

export function DockerChips(props: { task: Task }) {
  const state = () => model(props.task.id)
  const off = wsOnDockerChanged((scopes) => {
    if (scopes.includes('containers')) void state().refetch()
  })
  onCleanup(off)

  return (
    <ChipRow ariaLabel="Linked containers">
      <For each={state().linked()}>
        {(c) => (
          <Chip
            title={c.name}
            selected={state().selected() === c.id}
            leading={<StatusDot tone={containerTone(c.state)} />}
            onPress={() => state().setSelected(c.id)}
          >
            {chipLabel(c)}
          </Chip>
        )}
      </For>
    </ChipRow>
  )
}

export function DockerTaskDetail(props: { task: Task }) {
  const state = () => model(props.task.id)
  return (
    <Show
      when={state().selected()}
      fallback={
        <EmptyState align="start" busy={state().linked.loading}>
          {state().linked.loading ? 'Loading…' : 'No containers linked to this task.'}
        </EmptyState>
      }
    >
      {(id) => <ContainerDetail target={id()} taskId={props.task.id} onRemoved={() => void state().refetch()} />}
    </Show>
  )
}
