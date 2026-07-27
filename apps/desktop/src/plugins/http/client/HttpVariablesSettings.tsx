// The settings-page mount for repo variables. Variables are repo-scoped, but the settings context
// only carries a workspace, so this picks the repo itself. The same component is reachable from the
// Variables tab inside the API panel, where the repo is already known.
import { createQuery } from '@tanstack/solid-query'
import { createSignal, Show } from 'solid-js'
import RepoPicker from '../../../core/client/ui/RepoPicker'
import { pinsOptions, reposOptions } from '../../../core/client/queries'
import HttpVariables from './HttpVariables'
import './http.css'

export default function HttpVariablesSettings() {
  const repos = createQuery(() => reposOptions(true))
  const pins = createQuery(() => pinsOptions(true))
  const [selected, setSelected] = createSignal('')
  const parts = () => selected().split('/')

  return (
    <div class="settings-page">
      <p class="settings-hint">
        Variables for the API panel, saved per repo. Pick a repo to edit its variables.
      </p>
      <RepoPicker repos={repos.data ?? []} pinned={pins.data ?? []} selected={selected()} onSelect={setSelected} />
      <Show when={parts().length === 2 && parts()[0] && parts()[1]}>
        <HttpVariables owner={parts()[0]} repo={parts()[1]} />
      </Show>
    </div>
  )
}
