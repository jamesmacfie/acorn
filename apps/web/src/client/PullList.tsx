import { For, Show } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { A, useParams } from '@solidjs/router'
import { pullsOptions, reposOptions } from './queries'

// Left-pane PR list for the routed repo. Reads the shared repos cache to gate the request
// until the repo is known to the server (avoids a 404 race on a cold URL).
export default function PullList() {
  const params = useParams()
  const repos = createQuery(() => reposOptions(true))
  const repoKnown = () => !!repos.data?.some((r) => r.owner === params.owner && r.name === params.repo)
  const pulls = createQuery(() => pullsOptions(params.owner ?? '', params.repo ?? '', repoKnown()))

  return (
    <Show when={pulls.data} fallback={<p class="placeholder">{pulls.isError ? 'Failed to load PRs.' : 'Loading…'}</p>}>
      {(list) => (
        <Show when={list().length} fallback={<p class="placeholder">No open PRs.</p>}>
          <ul class="pr-list">
            <For each={list()}>
              {(pr) => (
                <li>
                  <A
                    class="pr-row"
                    classList={{ active: params.number === String(pr.number) }}
                    href={`/${params.owner}/${params.repo}/${pr.number}`}
                  >
                    <span class="pr-num">#{pr.number}</span>
                    <span class="pr-title">{pr.title}</span>
                    <Show when={pr.draft}>
                      <span class="pr-badge">draft</span>
                    </Show>
                    <Show when={pr.author}>
                      <span class="pr-author muted">{pr.author}</span>
                    </Show>
                  </A>
                </li>
              )}
            </For>
          </ul>
        </Show>
      )}
    </Show>
  )
}
