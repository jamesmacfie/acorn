import { For, Show } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { useParams } from '@solidjs/router'
import { pullDetailOptions, reposOptions } from './queries'

// Mid (Navigator) pane: PR header + changed-files list for the routed PR.
// ponytail: reviews/comments/checks are fetched + mirrored but not rendered yet — later slices.
export default function PullDetail() {
  const params = useParams()
  const repos = createQuery(() => reposOptions(true))
  const repoKnown = () => !!repos.data?.some((r) => r.owner === params.owner && r.name === params.repo)
  const detail = createQuery(() =>
    pullDetailOptions(params.owner ?? '', params.repo ?? '', params.number ?? '', !!params.number && repoKnown()),
  )

  return (
    <Show when={params.number} fallback={<p class="placeholder">Select a PR.</p>}>
      <Show when={detail.data?.pull} fallback={<p class="placeholder">{detail.isError ? 'Failed to load PR.' : 'Loading…'}</p>}>
        {(pull) => (
          <>
            <div class="pr-detail-header">
              <div class="pr-detail-title">
                <span class="pr-num">#{pull().number}</span> {pull().title}
              </div>
              <div class="pr-detail-meta muted">
                <span class={`state-badge state-${pull().state}`}>{pull().state}</span>
                <Show when={pull().author}>{(a) => <span>{a()}</span>}</Show>
                <span>
                  {pull().baseRef} ← {pull().headRef}
                </span>
              </div>
            </div>
            <ul class="file-list">
              <For each={detail.data?.files} fallback={<li class="placeholder">No files.</li>}>
                {(f) => (
                  <li class="file-row">
                    <span class="file-path">{f.path}</span>
                    <span class="file-stat add">+{f.additions ?? 0}</span>
                    <span class="file-stat del">−{f.deletions ?? 0}</span>
                  </li>
                )}
              </For>
            </ul>
          </>
        )}
      </Show>
    </Show>
  )
}
