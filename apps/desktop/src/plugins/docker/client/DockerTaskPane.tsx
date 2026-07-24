// The Docker task pane: containers linked to this task (matched main-side by worktree/slug),
// a chip per container switching the shared ContainerDetail — the RollbarPane shape.
import { createEffect, createResource, createSignal, For, on, onCleanup, Show } from 'solid-js'
import type { Task } from '../../../core/shared/api'
import type { DockerContainerSummary } from '../shared/model'
import { fetchTaskContainers } from './dockerClient'
import { wsOnDockerChanged } from '../../../core/client/wsClient'
import ContainerDetail from './ContainerDetail'
import './docker.css'

export default function DockerTaskPane(props: { task: Task }) {
  const [selected, setSelected] = createSignal<string | null>(null)
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

  const chipLabel = (c: DockerContainerSummary): string => c.composeService ?? c.name

  return (
    <section class="pane docker-task-pane">
      <Show when={(linked() ?? []).length} fallback={<div class="pane-empty"><p class="placeholder">{linked.loading ? 'Loading…' : 'No containers linked to this task.'}</p></div>}>
        <div class="docker-chips">
          <For each={linked()}>
            {(c) => (
              <button type="button" class="docker-chip" classList={{ active: selected() === c.id }} title={c.name} onClick={() => setSelected(c.id)}>
                <span class="docker-dot" data-state={c.state} />
                {chipLabel(c)}
              </button>
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
