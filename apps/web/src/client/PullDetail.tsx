import { For, Show } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { useParams, useSearchParams } from '@solidjs/router'
import { filesOptions, pullDetailOptions, reposOptions } from './queries'

// Mid (Navigator) pane: PR header + description + changed-files + checks + conversation.
// Bodies are GitHub-sanitized bodyHTML, rendered via innerHTML (docs/ui-style.md §5).
export default function PullDetail() {
  const params = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const repos = createQuery(() => reposOptions(true))
  const repoKnown = () => !!repos.data?.some((r) => r.owner === params.owner && r.name === params.repo)
  const enabled = () => !!params.number && repoKnown()
  const detail = createQuery(() => pullDetailOptions(params.owner ?? '', params.repo ?? '', params.number ?? '', enabled()))
  const files = createQuery(() => filesOptions(params.owner ?? '', params.repo ?? '', params.number ?? '', enabled()))

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
                <span class={`state-badge state-${pull().state}`}>{pull().draft ? 'draft' : pull().state}</span>
                <Show when={pull().author}>{(a) => <span>{a()}</span>}</Show>
                <span>
                  {pull().baseRef} ← {pull().headRef}
                </span>
              </div>
            </div>

            <Show when={pull().body}>
              <details class="nav-section" open>
                <summary>Description</summary>
                <div class="markdown" innerHTML={pull().body!} />
              </details>
            </Show>

            <details class="nav-section" open>
              <summary>
                Files <span class="muted">({files.data?.length ?? 0})</span>
              </summary>
              <ul class="file-list">
                <For each={files.data} fallback={<li class="placeholder">{files.isLoading ? 'Loading…' : 'No files.'}</li>}>
                  {(f) => (
                    <li>
                      <button
                        type="button"
                        class="file-row"
                        classList={{ active: searchParams.file === f.path }}
                        onClick={() => setSearchParams({ file: f.path })}
                      >
                        <span class="file-path">{f.path}</span>
                        <span class="file-stat add">+{f.additions ?? 0}</span>
                        <span class="file-stat del">−{f.deletions ?? 0}</span>
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </details>

            <Show when={detail.data?.checks.length}>
              <details class="nav-section">
                <summary>
                  Checks <span class="muted">({detail.data!.checks.length})</span>
                </summary>
                <ul class="check-list">
                  <For each={detail.data!.checks}>
                    {(ck) => (
                      <li class="check-row">
                        <span class={`check-dot check-${(ck.status ?? '').toLowerCase()}`} />
                        <span class="check-name">{ck.name}</span>
                        <Show when={ck.url}>
                          {(u) => (
                            <a class="muted" href={u()} target="_blank" rel="noreferrer">
                              {ck.status}
                            </a>
                          )}
                        </Show>
                      </li>
                    )}
                  </For>
                </ul>
              </details>
            </Show>

            <Show when={detail.data && (detail.data.comments.length || detail.data.reviews.length)}>
              <details class="nav-section">
                <summary>
                  Conversation <span class="muted">({detail.data!.comments.length + detail.data!.reviews.length})</span>
                </summary>
                <For each={detail.data!.reviews}>
                  {(r) => (
                    <Show when={r.body || r.state}>
                      <div class="comment">
                        <div class="comment-meta muted">
                          {r.author} <span class={`review-state review-${(r.state ?? '').toLowerCase()}`}>{r.state}</span>
                        </div>
                        <Show when={r.body}>
                          <div class="markdown" innerHTML={r.body!} />
                        </Show>
                      </div>
                    </Show>
                  )}
                </For>
                <For each={detail.data!.comments}>
                  {(m) => (
                    <div class="comment">
                      <div class="comment-meta muted">{m.author}</div>
                      <div class="markdown" innerHTML={m.body ?? ''} />
                    </div>
                  )}
                </For>
              </details>
            </Show>
          </>
        )}
      </Show>
    </Show>
  )
}
