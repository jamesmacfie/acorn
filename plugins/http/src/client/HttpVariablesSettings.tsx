// The settings-page mount for project variables. Variables are project-scoped, but the settings context
// only carries a workspace, so this picks the repo itself. The same component is reachable from the
// Variables tab inside the API panel, where the repo is already known.
import { createQuery } from '@tanstack/solid-query'
import { createSignal, For, Show } from 'solid-js'
import { projectsOptions } from '@acorn/client-core/queries.ts'
import HttpVariables from './HttpVariables'
import './http.css'

export default function HttpVariablesSettings() {
  const projects = createQuery(() => projectsOptions(true))
  const [selected, setSelected] = createSignal('')
  const project = () => projects.data?.find((candidate) => candidate.id === selected())

  return (
    <div class="settings-page">
      <p class="settings-hint">
        Variables for the API panel, saved per project. Pick a project to edit its variables.
      </p>
      <select class="ui-input" aria-label="Project" value={selected()} onChange={(event) => setSelected(event.currentTarget.value)}>
        <option value="">Choose a project…</option>
        <For each={(projects.data ?? []).filter((candidate) => !candidate.hidden)}>{(candidate) => <option value={candidate.id}>{candidate.name}</option>}</For>
      </select>
      <Show when={project()}>
        {(candidate) => <HttpVariables projectId={candidate().id} projectName={candidate().name} />}
      </Show>
    </div>
  )
}
