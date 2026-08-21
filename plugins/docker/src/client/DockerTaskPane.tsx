// The Docker task pane: containers linked to this task (matched main-side by worktree/slug), a
// chip per container switching the shared ContainerDetail, the same shape as RollbarPane.
import { createEffect, createResource, createSignal, For, on, onCleanup, Show } from 'solid-js'
import type { Task } from '@acorn/protocol/api.ts'
import type { DockerContainerSummary } from '../shared/model'
import { fetchTaskContainers } from './dockerClient'
import { wsOnDockerChanged } from './wsChannel'
import { containerTone, dockerSelection, rememberDockerSelection } from './dockerViewState'
import ContainerDetail from './ContainerDetail'
import './docker.css'
import { Chip, EmptyState, StatusDot } from '@acorn/plugin-api/ui'

export default function DockerTaskPane(props: { task: Task }) {
  const [selected, setSelected] = createSignal<string | null>(dockerSelection(props.task.id) ?? null)
  const [linked, { refetch }] = createResource(() => props.task.id, fetchTaskContainers)

  const off = wsOnDockerChanged((scopes) => {
    if (scopes.includes('containers')) void refetch()
  })
  onCleanup(off)

  // Land selection on the first container (and heal it when the selected one disappears).
  createEffect(on(linked, (list) => {
    if (!list?.length) return setSelected(null)
    if (!selected() || !list.some((c) => c.id === selected())) setSelected(list[0].id)
  }))

  // Session-only: revisiting the pane lands on the same container.
  createEffect(on(selected, (id) => {
    if (id) rememberDockerSelection(props.task.id, id)
  }))

  const chipLabel = (c: DockerContainerSummary): string => c.composeService ?? c.name

  return (
    <section class="pane docker-task-pane">
      <Show when={(linked() ?? []).length} fallback={<div class="pane-empty"><EmptyState align="start" busy={linked.loading}>{linked.loading ? 'Loading…' : 'No containers linked to this task.'}</EmptyState></div>}>
        <div class="docker-chips">
          <For each={linked()}>
            {(c) => (
              <Chip
                class="docker-chip"
                classList={{ active: selected() === c.id }}
                title={c.name}
                leading={<StatusDot tone={containerTone(c.state)} />}
                onActivate={() => void setSelected(c.id)}
              >
                {chipLabel(c)}
              </Chip>
            )}
          </For>
        </div>
        <Show when={selected()}>
          {(id) => <ContainerDetail target={id()} taskId={props.task.id} onRemoved={() => void refetch()} />}
        </Show>
      </Show>
    </section>
  )
}
